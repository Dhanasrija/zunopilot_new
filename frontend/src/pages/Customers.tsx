import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MessageSquarePlus, UserPlus, Pencil, Info } from 'lucide-react';
import { toast } from 'sonner';

interface Customer {
  id: string; name?: string; waId: string; phone?: string; lifetimeSpend: number | string;
  lastSeenAt?: string; _count?: { orders: number; messages: number };
}
interface CustomerDetail extends Customer {
  orders: { id: string; orderNumber: number; status: string; totalAmount: number; placedAt: string }[];
}

// ── Add / edit dialog ─────────────────────────────────────────────────────────
// One component for both modes. In edit mode the WhatsApp number is shown but not
// editable: it is the identity the inbound webhook matches on, so changing it
// would orphan this record from its conversation history.

function CustomerFormDialog({
  mode, customer, open, onOpenChange, onSaved,
}: {
  mode: 'create' | 'edit';
  customer?: Customer | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [waId, setWaId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // Re-seed the fields whenever the dialog opens for a different record.
  useEffect(() => {
    if (!open) return;
    setWaId(customer?.waId ?? '');
    setName(customer?.name ?? '');
    setPhone(customer?.phone ?? '');
  }, [open, customer]);

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'create') {
        return (await api.post('/customers', { waId, name: name || null, phone: phone || null })).data;
      }
      return (await api.patch(`/customers/${customer!.id}`, { name: name || null, phone: phone || null })).data;
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? 'Customer added' : 'Customer updated');
      onOpenChange(false);
      onSaved();
    },
    // The api client already surfaces the server message (duplicate number,
    // missing country code) as a toast, so nothing extra to do here.
  });

  const digits = waId.replace(/\D/g, '').replace(/^0+/, '');
  const canSave = mode === 'edit' || digits.length >= 8;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add customer' : 'Edit customer'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="cust-waid">WhatsApp number</Label>
            <Input
              id="cust-waid"
              value={waId}
              disabled={mode === 'edit'}
              autoComplete="off"
              placeholder="917702000350"
              onChange={(e) => setWaId(e.target.value)}
            />
            <p className="text-caption text-muted-foreground">
              {mode === 'edit'
                ? 'Cannot be changed — it links this record to their WhatsApp conversation.'
                : 'Include the country code, no + or spaces. Normalised on save.'}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="cust-name">Name</Label>
            <Input id="cust-name" value={name} autoComplete="off" placeholder="Optional"
              onChange={(e) => setName(e.target.value)} />
            {mode === 'edit' && (
              <p className="text-caption text-muted-foreground">
                Note: this is overwritten by their WhatsApp profile name on their next message.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cust-phone">Contact phone</Label>
            <Input id="cust-phone" value={phone} autoComplete="off" placeholder="Optional — defaults to the WhatsApp number"
              onChange={(e) => setPhone(e.target.value)} />
          </div>

          {mode === 'create' && (
            <div className="flex gap-2 rounded-md bg-warning/15 border border-warning/40 p-3 text-caption text-ink-900">
              <Info className="w-4 h-4 shrink-0 mt-px" />
              <span>
                Adding a customer here records them for CRM only. WhatsApp will not let you send
                them a free-form message until <strong>they message you first</strong> (which opens a
                24-hour window) or you send an approved template.
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {save.isPending ? 'Saving…' : mode === 'create' ? 'Add customer' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Customers() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);

  const openAdd = () => { setEditing(null); setFormMode('create'); };
  const openEdit = (c: Customer) => { setEditing(c); setFormMode('edit'); };
  const afterSave = () => {
    qc.invalidateQueries({ queryKey: ['customers'] });
    if (selected) qc.invalidateQueries({ queryKey: ['customer', selected] });
  };

  const { data = [] } = useQuery({
    queryKey: ['customers', search],
    queryFn: async () =>
      (await api.get<{ data: Customer[] }>('/customers', { params: { search: search || undefined } })).data.data,
  });

  const detail = useQuery({
    queryKey: ['customer', selected],
    enabled: !!selected,
    queryFn: async () => (await api.get<{ data: CustomerDetail }>(`/customers/${selected}`)).data.data,
  });

  // Get-or-create an open conversation, then jump into the Inbox preselected on it.
  const startConversation = useMutation({
    mutationFn: async (customerId: string) =>
      (await api.post<{ data: { id: string } }>('/inbox/conversations', { customerId })).data.data,
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Conversation ready');
      nav(`/inbox?conversationId=${conv.id}`);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">Localized customer database with order history.</p>
        </div>
        <Button onClick={openAdd} className="gap-1">
          <UserPlus className="h-4 w-4" /> Add customer
        </Button>
      </div>
      <Card>
        <CardHeader><CardTitle>Customer list</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input placeholder="Search by name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Orders</TableHead>
                <TableHead>Lifetime spend</TableHead><TableHead>Last seen</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c.id)}>
                  <TableCell>{c.name || '—'}</TableCell>
                  <TableCell>{c.phone || c.waId}</TableCell>
                  <TableCell>{c._count?.orders ?? 0}</TableCell>
                  <TableCell>{formatCurrency(c.lifetimeSpend as number)}</TableCell>
                  <TableCell>{c.lastSeenAt ? formatDateTime(c.lastSeenAt) : '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); startConversation.mutate(c.id); }}
                        disabled={startConversation.isPending}
                      >
                        <MessageSquarePlus className="h-4 w-4 mr-1" />Start chat
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{detail.data?.name || detail.data?.waId || 'Customer'}</DialogTitle></DialogHeader>
          {detail.data && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 text-sm gap-2">
                <div><div className="text-muted-foreground">Phone</div><div>{detail.data.phone || detail.data.waId}</div></div>
                <div><div className="text-muted-foreground">Orders</div><div>{detail.data.orders.length}</div></div>
                <div><div className="text-muted-foreground">Lifetime</div><div>{formatCurrency(detail.data.lifetimeSpend as number)}</div></div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => detail.data && openEdit(detail.data)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />Edit details
                </Button>
                <Button
                  onClick={() => detail.data && startConversation.mutate(detail.data.id)}
                  disabled={startConversation.isPending}
                >
                  <MessageSquarePlus className="h-4 w-4 mr-1" />Start conversation
                </Button>
              </div>
              <div className="border-t pt-3">
                <div className="text-sm font-medium mb-2">Recent orders</div>
                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detail.data.orders.map((o) => (
                      <TableRow key={o.id}><TableCell>{o.orderNumber}</TableCell><TableCell>{o.status}</TableCell><TableCell>{formatCurrency(o.totalAmount)}</TableCell><TableCell>{formatDateTime(o.placedAt)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CustomerFormDialog
        mode={formMode ?? 'create'}
        customer={editing}
        open={formMode !== null}
        onOpenChange={(v) => { if (!v) setFormMode(null); }}
        onSaved={afterSave}
      />
    </div>
  );
}
