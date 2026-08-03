import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Plus, Trash2, ShoppingBag, ChefHat, CheckCircle, IndianRupee,
  RefreshCw, Search, Download, MoreVertical, TrendingUp, TrendingDown,
  Eye,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderStatus = 'NEW' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

const STATUS_STYLE: Record<OrderStatus, string> = {
  NEW: 'bg-accent-100 text-accent-700 border-accent-100',
  ACCEPTED: 'bg-accent-100 text-accent-700 border-accent-100',
  PREPARING: 'bg-warning/15 text-ink-900 border-warning/40',
  READY: 'bg-accent-100 text-accent-700 border-accent-100',
  OUT_FOR_DELIVERY: 'bg-accent-100 text-accent-700 border-accent-100',
  DELIVERED: 'bg-success/10 text-success border-success/30',
  CANCELLED: 'bg-danger/10 text-danger border-danger/30',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: 'New',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

interface OrderItem {
  id: string;
  itemName: string;
  quantity: number;
  lineTotal: number;
  addons: { name: string; priceDelta: number }[];
}

interface Order {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  customerName: string;
  deliveryAddress: string;
  contactPhone?: string;
  totalAmount: number;
  placedAt: string;
  items: OrderItem[];
}

interface Customer {
  id: string;
  name?: string;
  phone?: string;
  waId: string;
}

interface MenuItem {
  id: string;
  name: string;
  basePrice: number;
  categoryId: string;
  category?: { name: string };
}

interface CartLine {
  itemId: string;
  itemName: string;
  basePrice: number;
  quantity: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(d: string) {
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// `isToday` / `isYesterday` / `isLast7` used to live here, filtering the fetched array
// in the browser. The equivalent boundaries are now computed once in `dateRange` and
// sent to the server, so there is nothing left to test a single row against.

// ── Create Order Dialog ───────────────────────────────────────────────────────

function CreateOrderDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedQty, setSelectedQty] = useState(1);

  const { data: customers } = useQuery<Customer[]>({
    queryKey: ['customers-list'],
    queryFn: async () => (await api.get<{ data: Customer[] }>('/customers')).data.data,
    enabled: open,
  });

  const { data: menuItems } = useQuery<MenuItem[]>({
    queryKey: ['menu-items-list'],
    queryFn: async () => (await api.get<{ data: MenuItem[] }>('/menu/items')).data.data,
    enabled: open,
  });

  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    const q = customerSearch.toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.waId.includes(q),
    );
  }, [customers, customerSearch]);

  const total = cart.reduce((s, l) => s + l.basePrice * l.quantity, 0);

  const addToCart = () => {
    if (!selectedItemId) return;
    const mi = menuItems?.find((m) => m.id === selectedItemId);
    if (!mi) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === selectedItemId);
      if (existing) return prev.map((l) => l.itemId === selectedItemId ? { ...l, quantity: l.quantity + selectedQty } : l);
      return [...prev, { itemId: mi.id, itemName: mi.name, basePrice: Number(mi.basePrice), quantity: selectedQty }];
    });
    setSelectedItemId('');
    setSelectedQty(1);
  };

  const removeLine = (itemId: string) => setCart((prev) => prev.filter((l) => l.itemId !== itemId));

  const qc = useQueryClient();
  const createOrder = useMutation({
    mutationFn: async () => api.post('/orders', {
      customerId,
      items: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
      deliveryAddress,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      toast.success('Order created — WhatsApp notification sent to customer');
      qc.invalidateQueries({ queryKey: ['orders'] });
      setOpen(false);
      resetForm();
      onCreated();
    },
  });

  const resetForm = () => {
    setCustomerId(''); setCustomerSearch(''); setDeliveryAddress('');
    setNotes(''); setCart([]); setSelectedItemId(''); setSelectedQty(1);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1 bg-accent-600 hover:bg-accent-700">
        <Plus className="w-4 h-4" /> Create Order
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Customer</Label>
              <Input placeholder="Search by name or phone…" value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)} />
              {filteredCustomers.length > 0 && !customerId && (
                <div className="border rounded-md max-h-36 overflow-y-auto text-sm">
                  {filteredCustomers.slice(0, 20).map((c) => (
                    <button key={c.id} type="button"
                      className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
                      onClick={() => { setCustomerId(c.id); setCustomerSearch(c.name || c.phone || c.waId); }}>
                      {c.name || '(no name)'}{' '}
                      <span className="text-muted-foreground">{c.phone || c.waId}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Add Items</Label>
              <div className="flex gap-2">
                <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select item…" />
                  </SelectTrigger>
                  <SelectContent>
                    {menuItems?.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name} — {formatCurrency(m.basePrice)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" min={1} max={99} value={selectedQty}
                  onChange={(e) => setSelectedQty(Math.max(1, parseInt(e.target.value) || 1))} className="w-16" />
                <Button type="button" variant="secondary" onClick={addToCart} disabled={!selectedItemId}>Add</Button>
              </div>
            </div>
            {cart.length > 0 && (
              <div className="border rounded-md divide-y text-sm">
                {cart.map((l) => (
                  <div key={l.itemId} className="flex items-center justify-between px-3 py-2">
                    <span>{l.quantity}× {l.itemName}</span>
                    <div className="flex items-center gap-3">
                      <span>{formatCurrency(l.basePrice * l.quantity)}</span>
                      <button type="button" className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeLine(l.itemId)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2 font-semibold">
                  <span>Total</span><span>{formatCurrency(total)}</span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Delivery Address</Label>
              <Input placeholder="Enter delivery address…" value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea placeholder="Any special instructions…" value={notes}
                onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button disabled={!customerId || cart.length === 0 || createOrder.isPending}
              onClick={() => createOrder.mutate()}>
              {createOrder.isPending ? 'Creating…' : 'Create Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-px rounded-full text-caption font-semibold border ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const DATE_OPTIONS = ['Today', 'Yesterday', 'Last 7 days', 'All'];
const PAGE_SIZE = 10;

/**
 * Turn the date chip into an explicit range for the API.
 *
 * A range and not just a lower bound, because "Yesterday" needs a ceiling as well as a
 * floor. Computed here rather than server-side so the boundary is the *viewer's*
 * midnight — a cutoff calculated in the server's timezone would put this morning's
 * orders under "Yesterday" for anyone not sharing it.
 */
const dateRange = (filter: string): { since?: string; until?: string } => {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const DAY = 86_400_000;

  switch (filter) {
    case 'Today':
      return { since: midnight.toISOString() };
    case 'Yesterday':
      return {
        since: new Date(midnight.getTime() - DAY).toISOString(),
        until: midnight.toISOString(),
      };
    case 'Last 7 days':
      return { since: new Date(midnight.getTime() - 6 * DAY).toISOString() };
    default:
      return {};
  }
};

interface OrderSummary {
  newOrders: number;
  preparing: number;
  delivered: number;
  /** A string: `Decimal` cannot cross JSON as a number without losing precision. */
  revenue: string;
  total: number;
}

export default function Orders() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dateFilter, setDateFilter] = useState('Today');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);

  const range = dateRange(dateFilter);
  const listParams = {
    ...range,
    ...(statusFilter === 'ALL' ? {} : { status: statusFilter }),
    ...(search.trim() ? { search: search.trim() } : {}),
  };

  /**
   * One page of orders, filtered by the server.
   *
   * This used to fetch every order — capped at 200 — and then filter, sort, page and
   * total it in the browser. That is correct only while a workspace has fewer than 200
   * orders: above it the oldest silently vanished, the row count was the size of the
   * truncated array, and revenue was the sum of whatever had made it through. Every
   * filter is in the query key, so changing one refetches rather than re-slicing a
   * stale array.
   */
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['orders', listParams, page],
    queryFn: async () => {
      const response = await api.get<{ data: Order[]; meta: { total: number } }>('/orders', {
        params: { ...listParams, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE },
      });
      return { rows: response.data.data, total: response.data.meta.total };
    },
  });

  /**
   * The stats cards, from the server, over every order in the date range.
   *
   * Deliberately **not** derived from the page above. The cards count each status side
   * by side, so a status-filtered list cannot produce them — and the previous version's
   * revenue figure was simply the sum of one capped fetch.
   */
  const summary = useQuery({
    queryKey: ['orders-summary', range],
    queryFn: async () =>
      (await api.get<{ data: OrderSummary }>('/orders/summary', { params: range })).data.data,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status updated');
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  // Filtering, paging and totalling all happen on the server now. What arrives is
  // already the page to render.
  const paginated = data?.rows ?? [];
  const total = data?.total ?? 0;

  const stats = {
    newOrders: summary.data?.newOrders ?? 0,
    preparing: summary.data?.preparing ?? 0,
    delivered: summary.data?.delivered ?? 0,
    revenue: Number(summary.data?.revenue ?? 0),
  };

  // What period the numbers above actually cover. Stating it beats the invented
  // "vs yesterday" that used to sit there — and it is true, because it is the
  // filter the stats were computed from.
  const rangeLabel = dateFilter === 'All' ? 'All time' : dateFilter;

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleDateFilter = (v: string) => { setDateFilter(v); setPage(1); };
  const handleStatusFilter = (v: OrderStatus | 'ALL') => { setStatusFilter(v); setPage(1); };

  /**
   * Export every matching order, not the page on screen.
   *
   * Now that the list is one page, `paginated` holds ten rows — exporting that would
   * turn "Export" into "export what I can see", which is not what anyone clicking it
   * wants. So this refetches the same filters without paging. `take` is capped at 200
   * server-side, so it walks pages until it has them all.
   */
  const exportCSV = async () => {
    const collected: Order[] = [];
    const BATCH = 200;
    for (let skip = 0; ; skip += BATCH) {
      // eslint-disable-next-line no-await-in-loop
      const response = await api.get<{ data: Order[]; meta: { total: number } }>('/orders', {
        params: { ...listParams, take: BATCH, skip },
      });
      collected.push(...response.data.data);
      if (collected.length >= response.data.meta.total || response.data.data.length === 0) break;
    }

    const rows = [
      ['Order ID', 'Customer', 'Phone', 'Items', 'Amount', 'Status', 'Placed At'],
      ...collected.map((o) => [
        `#ORD-${o.orderNumber}`, o.customerName, o.contactPhone ?? '',
        o.items.map((i) => `${i.itemName} x${i.quantity}`).join('; '),
        o.totalAmount, o.status, o.placedAt,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = `orders-${collected.length}-rows.csv`;
    a.click();
    toast.success(`Exported ${collected.length} orders`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-h2 font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">Manage incoming orders and track their status.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1 h-9" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <CreateOrderDialog onCreated={() => {}} />
        </div>
      </div>

{/*
        Stats cards.

        These carried hardcoded trend percentages — "+20% vs yesterday" and so on —
        which were shown regardless of the numbers above them. On a workspace with
        no orders it read "New Orders 0, +20% vs yesterday", which is a fabricated
        metric presented as a real one. Removed rather than faked differently: the
        API has no yesterday comparison to serve, and the Analytics page is where
        real trends live.
      */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'New Orders', value: stats.newOrders, icon: ShoppingBag,
            iconBg: 'bg-accent-100', iconColor: 'text-accent-600',
          },
          {
            label: 'Preparing', value: stats.preparing, icon: ChefHat,
            iconBg: 'bg-warning/15', iconColor: 'text-warning',
          },
          {
            label: 'Delivered', value: stats.delivered, icon: CheckCircle,
            iconBg: 'bg-success/10', iconColor: 'text-success',
          },
          {
            label: 'Revenue', value: formatCurrency(stats.revenue), icon: IndianRupee,
            iconBg: 'bg-warning/15', iconColor: 'text-ink-900',
          },
        ].map(({ label, value, icon: Icon, iconBg, iconColor }) => (
          <div key={label} className="rounded-lg border bg-surface-1 shadow-none p-4 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-6 h-6 ${iconColor}`} />
            </div>
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">{label}</p>
              <p className="text-h2 font-semibold mt-px">{value}</p>
              <p className="text-caption text-muted-foreground mt-px">{rangeLabel}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-surface-1 shadow-none overflow-hidden">
        {/* Filters toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-4 border-b">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search order ID, customer or phone..."
              className="pl-8 h-9 text-sm"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <Select value={dateFilter} onValueChange={handleDateFilter}>
            <SelectTrigger className="h-9 w-36 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => handleStatusFilter(v as OrderStatus | 'ALL')}>
            <SelectTrigger className="h-9 w-40 text-sm"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1 h-9" onClick={exportCSV}>
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading orders…
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
            <ShoppingBag className="w-8 h-8 text-ink-300" />
            <p>No orders found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-surface-0/60">
                    {['Order ID', 'Customer', 'Phone', 'Items', 'Amount', 'Status', 'Order Time', 'Actions'].map((h) => (
                      <th key={h} className="text-left text-caption font-semibold text-ink-500 px-4 py-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-300">
                  {paginated.map((o) => (
                    <tr key={o.id} className="hover:bg-surface-0/50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => navigate(`/orders/${o.id}`)}
                          className="font-medium text-accent-600 hover:text-accent-700 hover:underline"
                        >
                          #ORD-{o.orderNumber}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium text-ink-700 whitespace-nowrap">
                        {o.customerName}
                      </td>
                      <td className="px-4 py-3 text-ink-500 whitespace-nowrap">
                        {o.contactPhone ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-ink-700 max-w-[220px] truncate">
                        {o.items.map((i) => `${i.itemName} x ${i.quantity}`).join(', ')}
                      </td>
                      <td className="px-4 py-3 font-medium text-ink-700 whitespace-nowrap">
                        {formatCurrency(o.totalAmount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="px-4 py-3 text-ink-500 whitespace-nowrap">
                        {timeAgo(o.placedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="w-8 h-8">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem className="gap-2" onClick={() => navigate(`/orders/${o.id}`)}>
                              <Eye className="w-3.5 h-3.5" /> View details
                            </DropdownMenuItem>
                            {NEXT[o.status].length === 0 ? (
                              <DropdownMenuItem disabled>No actions</DropdownMenuItem>
                            ) : (
                              NEXT[o.status].map((next) => (
                                <DropdownMenuItem
                                  key={next}
                                  className={next === 'CANCELLED' ? 'text-danger focus:text-danger' : ''}
                                  onClick={() => updateStatus.mutate({ id: o.id, status: next })}
                                >
                                  Mark {STATUS_LABEL[next]}
                                </DropdownMenuItem>
                              ))
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* `total` is the server's count, so this is honest above 200 orders. */}
            <Pagination
              page={page}
              onPageChange={setPage}
              pageSize={PAGE_SIZE}
              total={total}
              noun="orders"
            />
          </>
        )}
      </div>
    </div>
  );
}
