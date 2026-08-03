import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, ReceiptText } from 'lucide-react';

// The workspace's own GST details.
//
// Deliberately not part of the checkout flow. Nothing here changes what the
// customer pays — the rate is the same in every state — so putting it in the
// payment path would make it look like a price-affecting field and give someone
// one more thing to get wrong while their card is out. What it changes is
// whether their invoice splits as CGST+SGST or IGST, and whether they can claim
// the tax back, which is a settings decision they make once.

interface TaxDetails {
  gstin: string | null;
  gstStateCode: string | null;
  stateName: string | null;
  states: Array<{ code: string; name: string }>;
  gst: { ratePercent: number; sellerState: string } | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
}

export default function TaxDetails({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'tax-details'],
    queryFn: () => api.get<{ data: TaxDetails }>('/billing/tax-details').then((r) => r.data.data),
  });

  useEffect(() => {
    if (!data) return;
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
    onSuccess: () => {
      toast.success('Billing details saved. They apply from your next invoice.');
      qc.invalidateQueries({ queryKey: ['billing', 'tax-details'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // The address is always worth collecting; the GST fields only matter once we
  // are actually charging tax.
  if (isLoading || !data) return null;

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-body">
          <ReceiptText className="h-4 w-4" /> Billing details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-caption leading-snug text-muted-foreground">
          What appears on your invoices. We ask for this here rather than at signup, because it only
          matters once you are paying for something.
        </p>

        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-caption font-medium">Billing address</p>
          <Input
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            placeholder="Address line 1"
            disabled={!canManage}
          />
          <Input
            value={line2}
            onChange={(e) => setLine2(e.target.value)}
            placeholder="Address line 2 (optional)"
            disabled={!canManage}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              disabled={!canManage}
            />
            <Input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="PIN code"
              disabled={!canManage}
            />
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="Country"
              disabled={!canManage}
            />
          </div>
        </div>

        {data.gst && (
          <p className="text-caption leading-snug text-muted-foreground">
            GST is charged at {data.gst.ratePercent}% wherever you are, so the fields below do not
            change what you pay. They decide whether your invoice shows CGST and SGST or IGST, and
            they are what lets you claim the tax back.
          </p>
        )}

        {data.gst && <div className="space-y-1">
          <Label htmlFor="tax-gstin">GSTIN</Label>
          <Input
            id="tax-gstin"
            className="font-mono text-caption uppercase"
            placeholder="36AABCU9603R1ZM"
            disabled={!canManage}
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
          />
          <p className="text-caption text-muted-foreground">
            {derived
              ? `Registered in ${derived}, taken from the first two digits.`
              : 'Optional. Leave blank if you are not GST-registered.'}
          </p>
        </div>}

        {data.gst && !derived && (
          <div className="space-y-1">
            <Label>State</Label>
            <Select value={stateCode} onValueChange={setStateCode} disabled={!canManage}>
              <SelectTrigger><SelectValue placeholder="Select your state" /></SelectTrigger>
              <SelectContent>
                {data.states.map((state) => (
                  <SelectItem key={state.code} value={state.code}>{state.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-caption text-muted-foreground">
              Without this we charge IGST, which is the safe assumption when we do not know where you
              are. Supplies inside {data.gst?.sellerState} are CGST and SGST instead.
            </p>
          </div>
        )}

        {canManage && (
          <Button
            size="sm"
            className="gap-1"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save billing details
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
