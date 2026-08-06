#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { prisma } from '../src/config/prisma.js';
import {
  BILLING_INTERVALS, PLANS, type BillingInterval, type PlanDefinition,
} from '../src/modules/billing/catalogue.js';
import { syncPriceCatalogue } from '../src/modules/billing/billing.service.js';
import { grossPaise, sellerTaxIdentity } from '../src/modules/billing/gst.js';

// Create the Razorpay plans, and write their ids into .env.
//
//   npx tsx scripts/razorpay-plans.ts             # REPORT ONLY. Never creates.
//   npx tsx scripts/razorpay-plans.ts --create    # create genuinely missing plans
//   npx tsx scripts/razorpay-plans.ts --create --reprice
//                                                 # also replace plans whose
//                                                 # amount has changed
//
// **Creating is opt-in, and repricing is opt-in again.**
//
// Razorpay has no API to delete or deactivate a plan. Everything this script
// creates is permanent, public on the account, and impossible to clean up — so
// the default is to report and change nothing. A bare run cannot create.
//
// The rule this enforces: *only generate a plan if that plan+interval is
// genuinely absent from the Razorpay console.*
//
// This matters because matching is on the notes plus the **exact amount**, which
// is right for spotting drift and wrong as a safety net: change a price — as
// adding GST on top did — and every plan stops matching, so a script that
// created "what is missing" would silently mint a whole second set. Now a
// plan+interval that already exists at a different amount is reported as a
// REPRICE and skipped unless `--reprice` says otherwise.
//
// Note that repricing is not a migration: existing subscribers keep billing the
// old plan id until they are moved individually.
//
// Amounts come from the approved catalogue in paise. Nothing here computes a
// price.

const CREATE = process.argv.includes('--create');
const REPRICE = process.argv.includes('--reprice');
/** Anything that is not an explicit `--create` reports and writes nothing. */
const DRY_RUN = !CREATE;
const ENV_PATH = path.resolve(process.cwd(), '.env');

const keyId = process.env.RAZORPAY_KEY_ID ?? '';
const keySecret = process.env.RAZORPAY_KEY_SECRET ?? '';

interface RazorpayPlan {
  id: string;
  period: string;
  interval: number;
  item: { name: string; amount: number; currency: string };
  notes?: Record<string, string>;
}

/**
 * How an interval maps onto Razorpay's model.
 *
 * Razorpay has no "quarterly" period — it is monthly with an interval of 3.
 * Getting this wrong bills someone every month for a quarterly plan, so it is
 * stated once here rather than inline.
 */
const RAZORPAY_PERIOD: Record<BillingInterval, { period: 'monthly' | 'yearly'; interval: number }> = {
  MONTHLY: { period: 'monthly', interval: 1 },
  QUARTERLY: { period: 'monthly', interval: 3 },
  YEARLY: { period: 'yearly', interval: 1 },
};

const envVar = (plan: PlanDefinition, interval: BillingInterval): string =>
  `RAZORPAY_${plan.code}_${interval}_PLAN_ID`;

const client = axios.create({
  baseURL: 'https://api.razorpay.com/v1',
  auth: { username: keyId, password: keySecret },
  timeout: 20_000,
});

const describe = (err: unknown): string => (axios.isAxiosError(err)
  ? (err.response?.data as { error?: { description?: string } })?.error?.description ?? err.message
  : String(err));

/** Every plan on the account, following Razorpay's paging. */
const listExistingPlans = async (): Promise<RazorpayPlan[]> => {
  const all: RazorpayPlan[] = [];
  for (let skip = 0; skip < 1_000; skip += 100) {
    const { data } = await client.get<{ items: RazorpayPlan[]; count: number }>('/plans', {
      params: { count: 100, skip },
    });
    all.push(...data.items);
    if (data.items.length < 100) break;
  }
  return all;
};

/**
 * Write the ids back into .env, replacing the existing lines in place.
 *
 * Line-based rather than rewriting the file from a parsed object: .env holds
 * comments and unrelated secrets, and a round-trip through a parser would lose
 * the comments and reorder everything.
 */
const writeEnv = (ids: Record<string, string>): void => {
  const original = fs.readFileSync(ENV_PATH, 'utf8');
  let updated = original;

  for (const [key, value] of Object.entries(ids)) {
    const line = `${key}=${value}`;
    const existing = new RegExp(`^${key}=.*$`, 'm');
    updated = existing.test(updated) ? updated.replace(existing, line) : `${updated.trimEnd()}\n${line}\n`;
  }

  if (updated === original) return;
  // Keep a copy before touching a file full of credentials.
  fs.writeFileSync(`${ENV_PATH}.bak`, original, 'utf8');
  fs.writeFileSync(ENV_PATH, updated, 'utf8');
};

const main = async () => {
  if (!keyId || !keySecret) {
    console.error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env');
    process.exit(1);
  }

  const mode = keyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST';
  const banner = DRY_RUN ? '  ·  report only' : `  ·  CREATING${REPRICE ? ' + REPRICING' : ''}`;
  console.log(`\nRazorpay ${mode} mode (${keyId.slice(0, 12)}…)${banner}\n`);

  // Whether GST is included in the amounts about to be created changes what
  // every customer is charged, so it is stated before anything is created rather
  // than left to be inferred from the numbers.
  const seller = sellerTaxIdentity();
  if (seller.registered) {
    console.log(`GST 18% will be added on top (GSTIN ${seller.gstin}, ${seller.stateName}).\n`);
  } else {
    console.log(
      'COMPANY_GSTIN is not set, so plans will be created at the bare listed price with no GST.\n'
      + 'Set it and re-run if these should be GST-inclusive amounts.\n',
    );
  }

  const existing = await listExistingPlans();
  console.log(`${existing.length} plan${existing.length === 1 ? '' : 's'} already on the account.\n`);

  const ids: Record<string, string> = {};
  let created = 0;
  let reused = 0;
  let skipped = 0;

  for (const plan of PLANS) {
    if (!plan.selfServe) continue;

    for (const interval of BILLING_INTERVALS) {
      const taxable = plan.prices[interval];
      if (!taxable) continue;

      // What Razorpay collects is the **gross**: GST is charged on top of the
      // approved price, so a plan created at the bare ₹999 would collect no tax
      // while the invoice showed some. The taxable value stays in the catalogue
      // and on the `Price` row; only the amount charged lives here.
      //
      // The rate is uniform across states — only the CGST/SGST vs IGST *split*
      // varies — so one plan amount still serves every buyer.
      const amount = grossPaise(taxable);

      const { period, interval: multiplier } = RAZORPAY_PERIOD[interval];
      const variable = envVar(plan, interval);

      // Match on our own notes *and* the amount. Notes alone would reuse a plan
      // created at a price that has since changed, which would bill the old
      // amount while the product displayed the new one.
      const match = existing.find((candidate) => candidate.notes?.zunopilot_plan === plan.code
        && candidate.notes?.zunopilot_interval === interval
        && candidate.item.amount === amount
        && candidate.period === period
        && candidate.interval === multiplier);

      if (match) {
        ids[variable] = match.id;
        reused += 1;
        console.log(`  ↺ ${plan.name.padEnd(9)} ${interval.padEnd(9)} ${match.id}  (existing)`);
        continue;
      }

      // Same plan and interval already on the account, at a different amount.
      //
      // This is a repricing, not a gap, and it is the case that quietly doubled
      // the plan list when GST moved every amount. Creating here leaves two live
      // plans for one product with no way to remove either, so it is refused
      // unless explicitly asked for.
      const repriced = existing.filter((candidate) => candidate.notes?.zunopilot_plan === plan.code
        && candidate.notes?.zunopilot_interval === interval);

      if (repriced.length && !REPRICE) {
        const current = repriced.map((c) => `${c.id} ₹${c.item.amount / 100}`).join(', ');
        console.log(
          `  ! ${plan.name.padEnd(9)} ${interval.padEnd(9)} EXISTS at a different amount — skipped\n`
          + `      on the account: ${current}\n`
          + `      catalogue says: ₹${amount / 100} (₹${taxable / 100} + GST)\n`
          + '      Pass --reprice to create a new plan anyway. Existing subscribers stay on the old id.',
        );
        skipped += 1;
        // Keep the id that is actually on the account, so .env is never left
        // pointing at a plan that does not exist.
        ids[variable] = repriced[0]!.id;
        continue;
      }

      if (DRY_RUN) {
        const label = repriced.length ? 'would REPRICE' : 'would create ';
        console.log(`  + ${plan.name.padEnd(9)} ${interval.padEnd(9)} ${label}  ₹${amount / 100} (₹${taxable / 100} + GST)`);
        continue;
      }

      try {
        const { data } = await client.post<RazorpayPlan>('/plans', {
          period,
          interval: multiplier,
          item: {
            name: `ZunoPilot ${plan.name} — ${interval.charAt(0)}${interval.slice(1).toLowerCase()}`,
            amount,
            currency: 'INR',
            description: plan.tagline,
          },
          notes: {
            zunopilot_plan: plan.code,
            zunopilot_interval: interval,
          },
        });

        ids[variable] = data.id;
        created += 1;
        console.log(`  + ${plan.name.padEnd(9)} ${interval.padEnd(9)} ${data.id}  ₹${amount / 100} (₹${taxable / 100} + GST)`);
      } catch (err) {
        console.error(`  ✗ ${plan.name} ${interval}: ${describe(err)}`);
        process.exitCode = 1;
      }
    }
  }

  if (DRY_RUN) {
    console.log(
      '\nReport only — nothing was created and .env was not touched.'
      + '\nEvery plan created here is permanent: Razorpay has no delete API.'
      + '\nPass --create to create genuinely missing plans.\n',
    );
    return;
  }

  if (skipped) {
    console.log(`\n${skipped} plan${skipped === 1 ? '' : 's'} left alone because they already exist at another amount.`);
  }

  if (Object.keys(ids).length) {
    writeEnv(ids);
    console.log(`\n.env updated (previous copy at .env.bak). ${created} created, ${reused} reused.`);

    // Copy the ids onto the Price rows, so an invoice can be traced to the
    // exact Razorpay plan that was charged.
    Object.assign(process.env, ids);
    const synced = await syncPriceCatalogue();
    console.log(`Price rows updated: ${synced.created} written, ${synced.archived} archived.`);
    console.log('\nRestart the backend — .env is read at startup, and tsx watch does not watch it.\n');
  }
};

main()
  .catch((err: Error) => { console.error(describe(err)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
