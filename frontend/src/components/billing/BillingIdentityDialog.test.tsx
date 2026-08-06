import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInApp } from '@/test/render';
import type { BillingIdentity } from './billing-identity';

// The address step that sits between choosing a plan and paying.
//
// What matters here is not the fields — those are the same inputs the settings card has always
// had — but the three behaviours that make it a *step* rather than an obstacle: it only asks for
// what is missing, it cannot be submitted into a refusal, and saving continues to payment
// instead of returning the customer to the plan grid.

const identity = (over: Partial<BillingIdentity> = {}): BillingIdentity => ({
  gstin: null,
  gstStateCode: null,
  stateName: null,
  states: [{ code: '36', name: 'Telangana' }, { code: '27', name: 'Maharashtra' }],
  gst: { ratePercent: 18, sellerState: 'Telangana' },
  billingAddressLine1: null,
  billingAddressLine2: null,
  billingCity: null,
  billingPostalCode: null,
  billingCountry: 'IN',
  ...over,
});

const get = vi.fn();
const put = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { BillingIdentityDialog } = await import('./BillingIdentityDialog');

const open = async (data: BillingIdentity, onComplete = vi.fn(), canManage = true) => {
  get.mockResolvedValue({ data: { data } });
  put.mockResolvedValue({ data: { data } });
  renderInApp(<BillingIdentityDialog
    open
    onOpenChange={vi.fn()}
    onComplete={onComplete}
    canManage={canManage}
  />);
  await screen.findByRole('heading', { name: /where should we invoice you/i });
  return { onComplete };
};

const submit = () => screen.getByRole('button', { name: /save and continue to payment/i });

describe('when it appears', () => {
  it('says why it is asking, not just that a field is required', async () => {
    // The one moment a customer has a reason to care about an invoice field. "Required" invites
    // the question; naming the invoice answers it.
    await open(identity());
    expect(screen.getByText(/goes on your GST invoice/i)).toBeInTheDocument();
    expect(screen.getByText(/only ask once/i)).toBeInTheDocument();
  });

  it('offers the state selector when tax is charged', async () => {
    await open(identity());
    expect(screen.getByLabelText('State')).toBeInTheDocument();
  });

  it('**hides the state selector when the seller charges no tax**', async () => {
    // With no seller GSTIN there is no place of supply to record. Showing a required field that
    // means nothing would be asking for something to satisfy a rule that does not apply.
    await open(identity({ gst: null }));
    expect(screen.queryByLabelText('State')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/GSTIN/i)).not.toBeInTheDocument();
  });
});

describe('what it will not let you do', () => {
  it('**cannot be submitted while a required field is empty**', async () => {
    // The server would refuse anyway. Finding that out after a round trip, having just watched
    // a spinner, is a worse version of the same answer.
    await open(identity());
    expect(submit()).toBeDisabled();
  });

  it('stays disabled with an address but no state, when tax is charged', async () => {
    // The case that looks complete to a human and is useless to the invoice.
    await open(identity({
      billingAddressLine1: '12 Road No. 36', billingCity: 'Hyderabad', billingPostalCode: '500033',
    }));
    expect(submit()).toBeDisabled();
  });

  it('enables once everything the invoice needs is present', async () => {
    await open(identity({
      billingAddressLine1: '12 Road No. 36',
      billingCity: 'Hyderabad',
      billingPostalCode: '500033',
      gstStateCode: '36',
    }));
    await waitFor(() => expect(submit()).toBeEnabled());
  });

  it('**does not require a GSTIN** — an unregistered business can still pay', async () => {
    await open(identity({
      billingAddressLine1: '12 Road No. 36',
      billingCity: 'Hyderabad',
      billingPostalCode: '500033',
      gstStateCode: '36',
      gstin: null,
    }));
    await waitFor(() => expect(submit()).toBeEnabled());
  });
});

describe('saving continues to payment', () => {
  const complete = identity({
    billingAddressLine1: '12 Road No. 36',
    billingCity: 'Hyderabad',
    billingPostalCode: '500033',
    gstStateCode: '36',
  });

  it('**calls back so the plan they chose is resumed**', async () => {
    /*
     * The difference between a step and a detour. Without this the customer saves an address,
     * the dialog closes, and they are looking at the plan grid again wondering whether anything
     * happened — having to find and click the same plan a second time.
     */
    const { onComplete } = await open(complete);
    await waitFor(() => expect(submit()).toBeEnabled());
    await userEvent.click(submit());
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it('sends the address to the server before continuing', async () => {
    const { onComplete } = await open(complete);
    await waitFor(() => expect(submit()).toBeEnabled());
    await userEvent.click(submit());

    await waitFor(() => expect(put).toHaveBeenCalledWith('/billing/tax-details', expect.objectContaining({
      billingAddressLine1: '12 Road No. 36',
      billingCity: 'Hyderabad',
      billingPostalCode: '500033',
      gstStateCode: '36',
    })));
    expect(onComplete).toHaveBeenCalled();
  });

  it('does not continue when the save fails', async () => {
    // Continuing would open Razorpay on details the server never accepted, and the checkout
    // call behind it would refuse — a payment window that closes itself.
    get.mockResolvedValue({ data: { data: complete } });
    put.mockRejectedValue(new Error('Network down'));
    const onComplete = vi.fn();
    renderInApp(<BillingIdentityDialog open onOpenChange={vi.fn()} onComplete={onComplete} canManage />);
    await screen.findByRole('heading', { name: /where should we invoice you/i });

    await waitFor(() => expect(submit()).toBeEnabled());
    await userEvent.click(submit());
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('someone who cannot change it', () => {
  it('**says who to ask instead of showing a form of dead fields**', async () => {
    // An agent can reach Billing but not edit these. A silently disabled form reads as broken.
    await open(identity(), vi.fn(), false);
    expect(screen.getByText(/ask an owner/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save and continue/i })).not.toBeInTheDocument();
  });
});
