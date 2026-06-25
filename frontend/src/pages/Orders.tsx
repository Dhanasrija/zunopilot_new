import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
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
  ChevronLeft, ChevronRight,
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
  NEW: 'bg-violet-100 text-violet-700 border-violet-200',
  ACCEPTED: 'bg-blue-100 text-blue-700 border-blue-200',
  PREPARING: 'bg-amber-100 text-amber-700 border-amber-200',
  READY: 'bg-sky-100 text-sky-700 border-sky-200',
  OUT_FOR_DELIVERY: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  DELIVERED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-red-100 text-red-700 border-red-200',
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

function isToday(d: string) {
  const dt = new Date(d);
  const now = new Date();
  return dt.getDate() === now.getDate() && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
}

function isYesterday(d: string) {
  const dt = new Date(d);
  const y = new Date(); y.setDate(y.getDate() - 1);
  return dt.getDate() === y.getDate() && dt.getMonth() === y.getMonth() && dt.getFullYear() === y.getFullYear();
}

function isLast7(d: string) {
  return Date.now() - new Date(d).getTime() < 7 * 24 * 60 * 60 * 1000;
}

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
      <Button onClick={() => setOpen(true)} className="gap-1.5 bg-violet-600 hover:bg-violet-700">
        <Plus className="w-4 h-4" /> Create Order
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
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
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const DATE_OPTIONS = ['Today', 'Yesterday', 'Last 7 days', 'All'];
const PAGE_SIZE = 10;

export default function Orders() {
  const qc = useQueryClient();
  const [dateFilter, setDateFilter] = useState('Today');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => (await api.get<{ data: Order[] }>('/orders')).data.data,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status updated');
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = data ?? [];
    return {
      newOrders: all.filter((o) => o.status === 'NEW').length,
      preparing: all.filter((o) => o.status === 'PREPARING' || o.status === 'ACCEPTED').length,
      delivered: all.filter((o) => o.status === 'DELIVERED').length,
      revenue: all.reduce((s, o) => s + Number(o.totalAmount), 0),
    };
  }, [data]);

  // ── Filtered + paged ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = data ?? [];

    // Date filter
    if (dateFilter === 'Today') rows = rows.filter((o) => isToday(o.placedAt));
    else if (dateFilter === 'Yesterday') rows = rows.filter((o) => isYesterday(o.placedAt));
    else if (dateFilter === 'Last 7 days') rows = rows.filter((o) => isLast7(o.placedAt));

    // Status filter
    if (statusFilter !== 'ALL') rows = rows.filter((o) => o.status === statusFilter);

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((o) =>
        String(o.orderNumber).includes(q) ||
        o.customerName?.toLowerCase().includes(q) ||
        o.contactPhone?.includes(q),
      );
    }

    return rows;
  }, [data, dateFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleDateFilter = (v: string) => { setDateFilter(v); setPage(1); };
  const handleStatusFilter = (v: OrderStatus | 'ALL') => { setStatusFilter(v); setPage(1); };

  const exportCSV = () => {
    const rows = [
      ['Order ID', 'Customer', 'Phone', 'Items', 'Amount', 'Status', 'Placed At'],
      ...filtered.map((o) => [
        `#ORD-${o.orderNumber}`, o.customerName, o.contactPhone ?? '',
        o.items.map((i) => `${i.itemName} x${i.quantity}`).join('; '),
        o.totalAmount, o.status, o.placedAt,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = `orders-${Date.now()}.csv`; a.click();
  };

  // ── Pagination numbers ─────────────────────────────────────────────────────
  const pageNumbers: (number | '...')[] = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 3) return [1, 2, 3, '...', totalPages];
    if (page >= totalPages - 2) return [1, '...', totalPages - 2, totalPages - 1, totalPages];
    return [1, '...', page, '...', totalPages];
  }, [page, totalPages]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-sm text-muted-foreground">Manage incoming orders and track their status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Date dropdown */}
          <Select value={dateFilter} onValueChange={handleDateFilter}>
            <SelectTrigger className="h-9 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search order ID, customer or phone..."
              className="pl-9 h-9 w-64 text-sm"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={(v) => handleStatusFilter(v as OrderStatus | 'ALL')}>
            <SelectTrigger className="h-9 w-40 text-sm">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Refresh */}
          <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          {/* Export */}
          <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={exportCSV}>
            <Download className="w-3.5 h-3.5" /> Export
          </Button>

          <CreateOrderDialog onCreated={() => {}} />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'New Orders', value: stats.newOrders, icon: ShoppingBag,
            iconBg: 'bg-violet-100', iconColor: 'text-violet-600',
            trend: '+20%', up: true,
          },
          {
            label: 'Preparing', value: stats.preparing, icon: ChefHat,
            iconBg: 'bg-orange-100', iconColor: 'text-orange-500',
            trend: '-8%', up: false,
          },
          {
            label: 'Delivered', value: stats.delivered, icon: CheckCircle,
            iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600',
            trend: '+15%', up: true,
          },
          {
            label: 'Revenue', value: formatCurrency(stats.revenue), icon: IndianRupee,
            iconBg: 'bg-yellow-100', iconColor: 'text-yellow-600',
            trend: '+18%', up: true, large: true,
          },
        ].map(({ label, value, icon: Icon, iconBg, iconColor, trend, up }) => (
          <div key={label} className="rounded-xl border bg-white shadow-sm p-5 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-6 h-6 ${iconColor}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold mt-0.5">{value}</p>
              <div className={`flex items-center gap-0.5 text-xs mt-0.5 ${up ? 'text-emerald-600' : 'text-red-500'}`}>
                {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {trend} vs yesterday
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-base">All Orders</h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading orders…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
            <ShoppingBag className="w-8 h-8 text-slate-300" />
            <p>No orders found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/60">
                    {['Order ID', 'Customer', 'Phone', 'Items', 'Amount', 'Status', 'Order Time', 'Actions'].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-slate-500 px-4 py-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginated.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                        #ORD-{o.orderNumber}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                        {o.customerName}
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {o.contactPhone ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-[220px] truncate">
                        {o.items.map((i) => `${i.itemName} x ${i.quantity}`).join(', ')}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                        {formatCurrency(o.totalAmount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
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
                            {NEXT[o.status].length === 0 ? (
                              <DropdownMenuItem disabled>No actions</DropdownMenuItem>
                            ) : (
                              NEXT[o.status].map((next) => (
                                <DropdownMenuItem
                                  key={next}
                                  className={next === 'CANCELLED' ? 'text-red-500 focus:text-red-500' : ''}
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

            {/* Pagination */}
            <div className="flex items-center justify-between px-5 py-3 border-t bg-slate-50/40">
              <p className="text-xs text-slate-500">
                Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)} to{' '}
                {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} orders
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="w-7 h-7"
                  disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                {pageNumbers.map((n, i) =>
                  n === '...' ? (
                    <span key={`dots-${i}`} className="w-7 text-center text-xs text-slate-400">…</span>
                  ) : (
                    <Button key={n} variant={page === n ? 'default' : 'outline'} size="icon"
                      className={`w-7 h-7 text-xs ${page === n ? 'bg-violet-600 hover:bg-violet-700 border-violet-600' : ''}`}
                      onClick={() => setPage(n as number)}>
                      {n}
                    </Button>
                  )
                )}
                <Button variant="outline" size="icon" className="w-7 h-7"
                  disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
