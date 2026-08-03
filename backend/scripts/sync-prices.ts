#!/usr/bin/env tsx
import { prisma } from '../src/config/prisma.js';
import { syncPriceCatalogue } from '../src/modules/billing/billing.service.js';
import { PLANS, BILLING_INTERVALS, effectiveMonthlyPaise, savingsPercent } from '../src/modules/billing/catalogue.js';
import { formatPaise } from '../src/modules/billing/invoice.service.js';

// Write the approved prices into immutable Price rows.
//
// Safe to run repeatedly. An unchanged price is left alone; a changed one
// archives the old row and inserts a new one, so nothing an invoice points at
// is ever edited.

const main = async () => {
  const { created, archived } = await syncPriceCatalogue();
  console.log(`\nPrice catalogue: ${created} written, ${archived} archived.\n`);

  for (const plan of PLANS) {
    if (!plan.selfServe) {
      console.log(`${plan.name.padEnd(11)} custom pricing — contact sales, no self-service checkout`);
      continue;
    }
    const parts = BILLING_INTERVALS.map((interval) => {
      const amount = plan.prices[interval];
      if (!amount) return null;
      const monthly = formatPaise(effectiveMonthlyPaise(amount, interval));
      const saving = savingsPercent(plan, interval);
      return `${interval.toLowerCase().padEnd(9)} ${formatPaise(amount).padStart(12)}`
        + `  (${monthly}/mo effective${saving ? `, ~${saving}% cheaper` : ''})`;
    }).filter(Boolean);
    console.log(`${plan.name}`);
    for (const part of parts) console.log(`  ${part}`);
  }
  console.log('');
};

main().catch((e: Error) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
