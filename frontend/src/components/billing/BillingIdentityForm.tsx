import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { BILLING_IDENTITY_KEY, type BillingIdentity } from './billing-identity';

// The billing address and tax fields, as one form used in two places.
//
// Extracted from `TaxDetails` when checkout started requiring these, rather than copied into
// the checkout dialog. Two forms writing the same five columns is two sets of placeholder text,
// two ideas of which field is optional, and eventually two answers — the drift this codebase has
// already been bitten by in three other places.
//
// `TaxDetails` renders it inside a settings card; `BillingIdentityDialog` renders it as the step
// before payment. Only the framing differs.

export function BillingIdentityForm({
  data, canManage, submitLabel = 'Save billing details', onSaved, requireAll = false,
}: {
  data: BillingIdentity;
  canManage: boolean;
  submitLabel?: string;
  /** Called after a successful save. The checkout step uses it to continue to payment. */
  onSaved?: () => void;
  /**
   * Refuse to submit until everything the invoice needs is present.
   *
   * On the settings card this stays false: a workspace on the free allowance has no reason to
   * fill it in, and blocking a partial save there would be inventing a requirement. In the
   * checkout step it is true, because the server is about to refuse anyway and finding that out
   * after a round trip is worse than a disabled button.
   */
  requireAll?: boolean;
}) {
  const qc = useQueryClient();
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');

  useEffect(() => {
    setGstin(data.gstin ?? '');
    setStateCode(data.gstStateCode ?? '');
    setLine1(data.billingAddressLine1 ?? '');
    setLine2(data.billingAddressLine2 ?? '');
    setCity(data.billingCity ?? '');
    setPostalCode(data.billingPostalCode ?? '');
    // Already defaulted server-side from the owner's phone country.
    setCountry(data.billingCountry ?? '');
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.put('/billing/tax-details', {
      gstin: gstin.trim(),
      ...(stateCode ? { gstStateCode: stateCode } : {}),
      billingAddressLine1: line1.trim(),
      billingAddressLine2: line2.trim(),
      billingCity: city.trim(),
      billingPostalCode: postalCode.trim(),
      ...(country.trim() ? { billingCountry: country.trim() } : {}),
    }),
    onSuccess: async () => {
      // Awaited, not fired and forgotten: the checkout step continues straight into a request
      // the server will re-check, so it must not read a cache written a moment ago.
      await qc.invalidateQueries({ queryKey: BILLING_IDENTITY_KEY });
      if (onSaved) onSaved();
      else toast.success('Billing details saved. They apply from your next invoice.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // A GSTIN carries its own state, so offering a separate choice alongside one
  // would only let the two disagree.
  const stateFromGstin = gstin.trim().length >= 2 ? gstin.trim().slice(0, 2) : null;
  const derived = stateFromGstin
    ? data.states.find((s) => s.code === stateFromGstin)?.name ?? null
    : null;

  const dirty = gstin.trim() !== (data.gstin ?? '')
    || stateCode !== (data.gstStateCode ?? '')
    || line1.trim() !== (data.billingAddressLine1 ?? '')
    || line2.trim() !== (data.billingAddressLine2 ?? '')
    || city.trim() !== (data.billingCity ?? '')
    || postalCode.trim() !== (data.billingPostalCode ?? '')
    || country.trim() !== (data.billingCountry ?? '');

  // Mirrors `missingBillingFields`, against what is typed rather than what is saved. The state
  // only counts when tax is charged — with no seller GSTIN the selector below is not rendered,
  // so requiring it would block on a field that does not exist.
  const complete = !!line1.trim() && !!city.trim() && !!postalCode.trim() && !!country.trim()
    && (!data.gst || !!stateCode || !!derived);

  const blocked = requireAll ? !complete : !dirty;

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-ink-300 p-3">
        <p className="text-caption font-medium text-ink-900">Billing address</p>
        <Input
          value={line1}
          onChange={(e) => setLine1(e.target.value)}
          placeholder="Address line 1"
          disabled={!canManage}
          aria-label="Address line 1"
        />
        <Input
          value={line2}
          onChange={(e) => setLine2(e.target.value)}
          placeholder="Address line 2 (optional)"
          disabled={!canManage}
          aria-label="Address line 2"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City"
            disabled={!canManage}
            aria-label="City"
          />
          <Input
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            placeholder="PIN code"
            disabled={!canManage}
            aria-label="PIN code"
          />
          <Input
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
            placeholder="Country"
            disabled={!canManage}
            aria-label="Country"
          />
        </div>
      </div>

      {data.gst && (
        <p className="text-caption leading-snug text-ink-500">
          GST is charged at {data.gst.ratePercent}% wherever you are, so these do not change what
          you pay. They decide whether your invoice shows CGST and SGST or IGST, and they are what
          lets you claim the tax back.
        </p>
      )}

      {data.gst && (
        <div className="space-y-1">
          <Label htmlFor="tax-gstin">GSTIN</Label>
          <Input
            id="tax-gstin"
            className="font-mono text-caption uppercase"
            placeholder="36AABCU9603R1ZM"
            disabled={!canManage}
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
          />
          <p className="text-caption text-ink-500">
            {derived
              ? `Registered in ${derived}, taken from the first two digits.`
              : 'Optional. Leave blank if you are not GST-registered.'}
          </p>
        </div>
      )}

      {data.gst && !derived && (
        <div className="space-y-1">
          <Label htmlFor="tax-state">State</Label>
          <Select value={stateCode} onValueChange={setStateCode} disabled={!canManage}>
            <SelectTrigger id="tax-state" aria-label="State">
              <SelectValue placeholder="Select your state" />
            </SelectTrigger>
            <SelectContent>
              {data.states.map((state) => (
                <SelectItem key={state.code} value={state.code}>{state.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-caption text-ink-500">
            Supplies inside {data.gst?.sellerState} are CGST and SGST; everywhere else is IGST.
            Your invoice has to name one, so this is required before you pay.
          </p>
        </div>
      )}

      {canManage && (
        <Button
          size="sm"
          className="gap-1"
          disabled={blocked || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
          {submitLabel}
        </Button>
      )}
    </div>
  );
}
