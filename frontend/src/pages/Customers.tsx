import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';

interface Customer {
  id: string; name?: string; waId: string; phone?: string; lifetimeSpend: number | string;
  lastSeenAt?: string; _count?: { orders: number; messages: number };
}
interface CustomerDetail extends Customer {
  orders: { id: string; orderNumber: number; status: string; totalAmount: number; placedAt: string }[];
}

export default function Customers() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

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
      <div>
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-muted-foreground">Localized customer database with order history.</p>
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => { e.stopPropagation(); startConversation.mutate(c.id); }}
                      disabled={startConversation.isPending}
                    >
                      <MessageSquarePlus className="h-4 w-4 mr-1" />Start chat
                    </Button>
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
              <div className="flex justify-end">
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
    </div>
  );
}
