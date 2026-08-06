import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { PlansResponse } from '../lib/api';

/*
 * The plans screen, and the two properties that make it safe.
 *
 * **It must stay read-only.** A price is an approved value: `PLANS` in `billing/catalogue.ts`
 * is the source, and `syncPriceCatalogue()` writes it into `Price` rows. A price edited only in
 * the database is archived and replaced by the code value the next time the sync runs — so a
 * form here would appear to work and then silently undo itself at the next deploy. Razorpay
 * plan ids are worse: they are permanent once created and cannot be deleted.
 *
 * So the test is a negative one. There is no edit affordance today; what this file does is make
 * adding one a deliberate act that turns a suite red, rather than a plausible-looking
 * improvement that reviews cleanly.
 *
 * **And it must alarm on drift.** When the database and the catalogue disagree, checkout is
 * charging an amount the pricing page is not showing. That is the one thing on this screen
 * somebody has to act on.
 */

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, sa: { ...actual.sa, plans: vi.fn() } };
});

const { sa } = await import('../lib/api');
const { default: Plans } = await import('./Plans');

const price = (over: Partial<PlansResponse['plans'][0]['prices'][0]> = {}) => ({
  interval: 'MONTHLY',
  catalogueAmountPaise: 49900,
  livePriceId: 'price_1',
  liveAmountPaise: 49900,
  payablePaise: 58882,
  razorpayPlanId: 'plan_live_1',
  outOfSync: false,
  notSynced: false,
  ...over,
});

const response = (over: Partial<PlansResponse> = {}): PlansResponse => ({
  editable: false,
  source: 'billing/catalogue.ts',
  howToChange: ['Edit PLANS in billing/catalogue.ts', 'Run npx tsx scripts/sync-prices.ts'],
  gst: { ratePercent: 18 },
  plans: [{
    code: 'GROWTH',
    name: 'Growth',
    tagline: 'For a business that has outgrown the free tier',
    includes: ['Everything in Starter'],
    entitlements: {},
    selfServe: true,
    badges: ['popular'],
    subscribers: 12,
    overage: { ratePaise: 50, defaultCapPaise: 500000 },
    prices: [price()],
  }],
  archivedPrices: [],
  ...over,
});

const renderPlans = (data: PlansResponse) => {
  vi.mocked(sa.plans).mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Plans />, { wrapper: Wrapper });
};

describe('the screen stays read-only', () => {
  it('**offers no control that could change a price**', async () => {
    renderPlans(response());
    expect(await screen.findByText('Growth')).toBeInTheDocument();

    // No form controls at all. Deliberately broad: a select, a checkbox or a contenteditable
    // would each be a way to edit, and naming only "input" would miss them.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it('says where prices actually come from, so nobody hunts for the edit button', async () => {
    renderPlans(response());
    expect(await screen.findByText(/changed in code, not here/i)).toBeInTheDocument();
    expect(screen.getByText('billing/catalogue.ts')).toBeInTheDocument();
  });

  it('lists the steps for changing one', async () => {
    renderPlans(response());
    expect(await screen.findByText(/Run npx tsx scripts\/sync-prices\.ts/)).toBeInTheDocument();
  });
});

describe('drift between the catalogue and the database', () => {
  it('**warns when a live price disagrees with the code** — checkout is charging the wrong amount', async () => {
    renderPlans(response({
      plans: [{
        ...response().plans[0],
        prices: [price({ liveAmountPaise: 39900, outOfSync: true })],
      }],
    }));

    expect(await screen.findByText(/1 price out of sync/i)).toBeInTheDocument();
    expect(screen.getByText(/checkout is charging an amount the pricing page is not showing/i))
      .toBeInTheDocument();
  });

  it('flags a price that was never synced at all', async () => {
    renderPlans(response({
      plans: [{ ...response().plans[0], prices: [price({ livePriceId: null, liveAmountPaise: null, notSynced: true })] }],
    }));
    expect(await screen.findByText(/1 price out of sync/i)).toBeInTheDocument();
  });

  it('counts every drifting price, not just the first', async () => {
    renderPlans(response({
      plans: [{
        ...response().plans[0],
        prices: [price({ outOfSync: true }), price({ interval: 'YEARLY', notSynced: true })],
      }],
    }));
    expect(await screen.findByText(/2 prices out of sync/i)).toBeInTheDocument();
  });

  it('stays quiet when everything agrees', async () => {
    renderPlans(response());
    expect(await screen.findByText('Growth')).toBeInTheDocument();
    expect(screen.queryByText(/out of sync/i)).not.toBeInTheDocument();
  });
});

describe('what the header says about tax', () => {
  it('states the GST rate that will be added at checkout', async () => {
    // Prices are listed ex-GST; the operator needs to know the listed number is not the charge.
    renderPlans(response());
    expect(await screen.findByText(/18% is added at checkout/i)).toBeInTheDocument();
  });

  it('says so plainly when GST is not configured, rather than showing a blank rate', async () => {
    renderPlans(response({ gst: null }));
    expect(await screen.findByText(/GST is not configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/% is added at checkout/i)).not.toBeInTheDocument();
  });
});
