import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReceiptText } from 'lucide-react';
import { BillingIdentityForm } from './BillingIdentityForm';
import { useBillingIdentity } from './billing-identity';

// The workspace's billing address and GST details, as a settings card.
//
// **This used to say it was "deliberately not part of the checkout flow".** The reasoning was
// that nothing here changes what the customer pays — the rate is the same in every state — so
// putting it in the payment path would make it look like a price-affecting field and give
// someone one more thing to get wrong with their card out.
//
// That holds for the GSTIN, which is genuinely optional and stays optional. It did not hold for
// the address and the state, and the consequence was not cosmetic: a GST tax invoice must name a
// place of supply, and with no state a buyer in the seller's own state was charged IGST instead
// of CGST+SGST. Right total, wrong tax heads — wrong in the seller's GSTR-1 and in the buyer's
// input credit — on a document that is deliberately immutable and cannot be reissued.
//
// So checkout now refuses without them (`assertBillableIdentity` on the server) and asks for
// them inline (`BillingIdentityDialog`). This card remains the place to review and change them
// afterwards, and the only place to set them while still on the free allowance.
//
// The form itself lives in `BillingIdentityForm`, shared with the checkout step, so the two
// cannot drift into disagreeing about which fields are required.

export default function TaxDetails({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useBillingIdentity();
  if (isLoading || !data) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-body">
          <ReceiptText aria-hidden className="h-4 w-4" /> Billing details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-caption leading-snug text-ink-500">
          What appears on your invoices. We ask for this here rather than at signup, because it
          only matters once you are paying for something.
        </p>
        {/* `requireAll` is deliberately off here: a workspace on the free allowance has every
            right to save a partial address, and blocking that would invent a requirement the
            server does not have. Checkout is where completeness is enforced. */}
        <BillingIdentityForm data={data} canManage={canManage} />
      </CardContent>
    </Card>
  );
}
