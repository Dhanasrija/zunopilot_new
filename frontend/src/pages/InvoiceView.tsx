import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatRupees } from '@/lib/pricing';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';

// A printable invoice.
//
// Rendered entirely from the invoice row. Nothing reads through to the live
// plan or price — an invoice has to keep saying what it said on the day it was
// issued, even after a price change.

interface Invoice {
  number: string;
  planName: string;
  intervalLabel: string;
  periodStart: string;
  periodEnd: string;
  subtotalPaise: number;
  overagePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxRatePercent: number;
  placeOfSupply: string | null;
  sellerGstin: string | null;
  totalPaise: number;
  currency: string;
  taxTreatment: string;
  billedToName: string;
  billedToEmail: string | null;
  billedToAddress: string | null;
  billedToGstin: string | null;
  billedToState: string | null;
  notes: string[];
  issuedAt: string;
}

const asDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function InvoiceView() {
  const { invoiceId = '' } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => api.get<{ data: { invoice: Invoice; seller: { name: string } } }>(
      `/billing/invoices/${invoiceId}`,
    ).then((r) => r.data.data),
    enabled: !!invoiceId,
  });

  if (isLoading) return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="p-8 text-sm text-muted-foreground">Invoice not found.</p>;

  const { invoice } = data;

  return (
    <div className="mx-auto max-w-3xl p-8 print:p-0">
      <div className="mb-6 flex items-start justify-between print:hidden">
        <h1 className="text-h3 font-semibold">Invoice {invoice.number}</h1>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> Print
        </Button>
      </div>

      <div className="rounded-lg border p-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-h3 font-semibold">ZunoPilot</div>
            <p className="text-caption text-muted-foreground">WhatsApp automation for growing businesses</p>
            {/* A tax invoice has to carry the supplier's own registration. */}
            {invoice.sellerGstin && (
              <p className="mt-px text-caption text-muted-foreground">GSTIN: {invoice.sellerGstin}</p>
            )}
          </div>
          <div className="text-right">
            <div className="font-mono text-sm">{invoice.number}</div>
            <p className="text-caption text-muted-foreground">Issued {asDate(invoice.issuedAt)}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
              Billed to
            </div>
            <div className="mt-1 text-sm font-medium">{invoice.billedToName}</div>
            {invoice.billedToEmail && (
              <div className="text-caption text-muted-foreground">{invoice.billedToEmail}</div>
            )}
            {invoice.billedToAddress && (
              <div className="text-caption text-muted-foreground">{invoice.billedToAddress}</div>
            )}
            {invoice.billedToState && (
              <div className="text-caption text-muted-foreground">{invoice.billedToState}</div>
            )}
            {invoice.billedToGstin && (
              <div className="text-caption text-muted-foreground">GSTIN: {invoice.billedToGstin}</div>
            )}
          </div>
          <div className="sm:text-right">
            <div className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
              Billing period
            </div>
            <div className="mt-1 text-sm">
              {asDate(invoice.periodStart)} – {asDate(invoice.periodEnd)}
            </div>
            {invoice.placeOfSupply && (
              <div className="mt-2 text-caption text-muted-foreground">
                Place of supply: {invoice.placeOfSupply}
              </div>
            )}
          </div>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead className="border-y text-left text-caption uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="py-3">
                {invoice.planName} plan
                <span className="text-muted-foreground"> · {invoice.intervalLabel}</span>
                <div className="text-caption text-muted-foreground">
                  {asDate(invoice.periodStart)} – {asDate(invoice.periodEnd)}
                </div>
              </td>
              <td className="py-3 text-right tabular-nums">
                {formatRupees(invoice.subtotalPaise, { decimals: true })}
              </td>
            </tr>
            {invoice.overagePaise > 0 && (
              <tr className="border-b">
                <td className="py-3">
                  AI usage above the included quota
                </td>
                <td className="py-3 text-right tabular-nums">
                  {formatRupees(invoice.overagePaise, { decimals: true })}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="w-56 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Taxable value</span>
              <span className="tabular-nums">
                {formatRupees(invoice.subtotalPaise + invoice.overagePaise, { decimals: true })}
              </span>
            </div>

            {/*
              CGST + SGST for a supply inside the seller's own state, IGST
              otherwise. Rendered from the stored split rather than recomputed,
              so a reprint of an old invoice shows what was actually charged.
            */}
            {invoice.taxPaise > 0 ? (
              <>
                {invoice.cgstPaise > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>CGST @ {invoice.taxRatePercent / 2}%</span>
                    <span className="tabular-nums">
                      {formatRupees(invoice.cgstPaise, { decimals: true })}
                    </span>
                  </div>
                )}
                {invoice.sgstPaise > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>SGST @ {invoice.taxRatePercent / 2}%</span>
                    <span className="tabular-nums">
                      {formatRupees(invoice.sgstPaise, { decimals: true })}
                    </span>
                  </div>
                )}
                {invoice.igstPaise > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>IGST @ {invoice.taxRatePercent}%</span>
                    <span className="tabular-nums">
                      {formatRupees(invoice.igstPaise, { decimals: true })}
                    </span>
                  </div>
                )}
              </>
            ) : (
              invoice.taxTreatment === 'EXCLUSIVE' && (
                <div className="flex justify-between text-muted-foreground">
                  <span>GST</span>
                  <span className="text-caption">Billed separately</span>
                </div>
              )
            )}
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {formatRupees(invoice.totalPaise, { decimals: true })} {invoice.currency}
              </span>
            </div>
          </div>
        </div>

        {invoice.notes.length > 0 && (
          <div className="mt-8 space-y-1 border-t pt-4 text-caption leading-snug text-muted-foreground">
            {invoice.notes.map((note) => <p key={note}>{note}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}
