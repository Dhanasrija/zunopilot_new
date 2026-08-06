import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { BillingIdentityForm } from './BillingIdentityForm';
import { missingBillingFields, useBillingIdentity } from './billing-identity';

// The address step, between choosing a plan and paying.
//
// `TaxDetails` used to carry a comment saying this was "deliberately not part of the checkout
// flow", on the reasoning that nothing here changes the amount and so it would look like a
// price-affecting field with someone's card out. That reasoning holds for the GSTIN, which is
// genuinely optional. It does not hold for the address and the state: a GST tax invoice must
// name a place of supply, and without the state a buyer in the seller's own state is charged
// IGST instead of CGST+SGST — right total, wrong tax heads, in a document that is deliberately
// immutable and cannot be reissued.
//
// So it is in the payment path now, and the comment over there has been corrected rather than
// left contradicting the code.
//
// Shown only when something is actually missing. A returning customer who already has an
// address on file never sees it.

export function BillingIdentityDialog({
  open, onOpenChange, onComplete, canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Continue to payment. Called after the details save cleanly. */
  onComplete: () => void;
  canManage: boolean;
}) {
  const { data } = useBillingIdentity();
  if (!data) return null;

  const missing = missingBillingFields(data);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Where should we invoice you?</DialogTitle>
          <DialogDescription>
            {/*
              Says why, not just what. "Required field" invites the question; naming the invoice
              answers it, and this is the one moment the customer has a reason to care.
            */}
            This goes on your GST invoice, so we need it before taking payment. We only ask once.
          </DialogDescription>
        </DialogHeader>

        <BillingIdentityForm
          data={data}
          canManage={canManage}
          requireAll
          submitLabel="Save and continue to payment"
          onSaved={onComplete}
        />

        {!canManage && (
          // An agent can reach the Billing page but cannot change these. Saying so beats a form
          // whose every field is inexplicably disabled.
          <p className="text-caption text-ink-500">
            Ask an owner to add the billing {missing.join(', ')} — changing this needs the
            settings permission.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
