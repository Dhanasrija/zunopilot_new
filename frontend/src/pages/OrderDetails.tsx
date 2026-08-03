import { useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';
import {
  ArrowLeft, RefreshCw, ShoppingBag, MapPin, Phone, User, StickyNote,
  BellRing, BellOff, AlertTriangle, Clock,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderStatus = 'NEW' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';

// Mirrors ALLOWED_TRANSITIONS in backend/src/controllers/order.controller.js.
// The backend is the authority — this only decides which buttons to render.
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

// The trigger each status change fires, mirroring STATUS_TO_TRIGGER in
// backend/src/services/template.service.js. Used to tell the user, before they
// click, whether the customer will actually be notified.
const STATUS_TRIGGER: Record<OrderStatus, string> = {
  NEW: 'ORDER_CREATED',
  ACCEPTED: 'ORDER_ACCEPTED',
  PREPARING: 'ORDER_PREPARING',
  READY: 'ORDER_READY',
  OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
  DELIVERED: 'ORDER_DELIVERED',
  CANCELLED: 'ORDER_CANCELLED',
};

// The happy path, for the progress rail. CANCELLED is deliberately excluded — it
// is an exit, not a step.
const PIPELINE: OrderStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'];

interface OrderItem {
  id: string;
  itemName: string;
  quantity: number;
  unitPrice: number | string;
  lineTotal: number | string;
  addons: { id: string; name: string; priceDelta: number | string }[];
}

interface Order {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  customerName: string;
  deliveryAddress: string;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  contactPhone?: string | null;
  subtotal: number | string;
  totalAmount: number | string;
  notes?: string | null;
  placedAt: string;
  updatedAt: string;
  customer?: { id: string; name?: string | null; waId: string; phone?: string | null; lifetimeSpend?: number | string };
  items: OrderItem[];
}

interface Template {
  id: string;
  trigger: string;
  metaTemplate: string;
  isActive: boolean;
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-px rounded-full text-caption font-semibold border ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-px text-ink-500 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-caption font-medium text-ink-500">{label}</div>
        <div className="text-sm text-ink-700 break-words">{children}</div>
      </div>
    </div>
  );
}

/** Horizontal progress rail through the happy path. */
function Pipeline({ status }: { status: OrderStatus }) {
  if (status === 'CANCELLED') {
    return (
      <div className="flex items-center gap-2 text-sm text-danger">
        <AlertTriangle className="w-4 h-4" />
        This order was cancelled and can no longer be progressed.
      </div>
    );
  }
  const current = PIPELINE.indexOf(status);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto">
      {PIPELINE.map((s, i) => {
        const done = i <= current;
        return (
          <li key={s} className="flex items-center gap-1 shrink-0">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-2.5 h-2.5 rounded-full ${done ? 'bg-accent-600' : 'bg-ink-300'}`}
                aria-current={i === current ? 'step' : undefined}
              />
              <span className={`text-caption whitespace-nowrap ${done ? 'text-ink-700 font-medium' : 'text-ink-500'}`}>
                {STATUS_LABEL[s]}
              </span>
            </div>
            {i < PIPELINE.length - 1 && (
              <div className={`h-px w-8 sm:w-12 ${i < current ? 'bg-accent-600' : 'bg-ink-300'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrderDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pendingCancel, setPendingCancel] = useState(false);

  const { data: order, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => (await api.get<{ data: Order }>(`/orders/${id}`)).data.data,
    enabled: Boolean(id),
  });

  // Used only to tell the user whether a status change will actually reach the
  // customer. Template dispatch is fire-and-forget on the backend, so without
  // this the UI would imply a notification that never gets sent.
  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => (await api.get<{ data: Template[] }>('/templates')).data.data,
  });

  const notifiesCustomer = (status: OrderStatus) =>
    Boolean(templates?.some((t) => t.trigger === STATUS_TRIGGER[status] && t.isActive));

  const updateStatus = useMutation({
    mutationFn: (status: OrderStatus) => api.patch(`/orders/${id}/status`, { status }),
    onSuccess: (_res, status) => {
      toast.success(
        notifiesCustomer(status)
          ? `Marked ${STATUS_LABEL[status]} — customer notified`
          : `Marked ${STATUS_LABEL[status]} — no template for this status, customer not notified`,
      );
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      setPendingCancel(false);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 animate-spin text-accent-600" />
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-sm text-muted-foreground">
        <ShoppingBag className="w-8 h-8 text-ink-300" />
        <p>Order not found.</p>
        <Button variant="outline" onClick={() => navigate('/orders')}>Back to Orders</Button>
      </div>
    );
  }

  const nextStatuses = NEXT[order.status];
  const addonTotal = (it: OrderItem) =>
    it.addons.reduce((s, a) => s + Number(a.priceDelta), 0) * it.quantity;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/orders')}
            className="mt-1 text-ink-500 hover:text-ink-700 transition-colors"
            aria-label="Back to orders"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-h2 font-semibold">#ORD-{order.orderNumber}</h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-sm text-muted-foreground mt-px">
              Placed {formatDateTime(order.placedAt)}
              {order.updatedAt !== order.placedAt && <> · updated {formatDateTime(order.updatedAt)}</>}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1 h-9" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* Progress + actions */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <Pipeline status={order.status} />

          {nextStatuses.length > 0 && (
            <div className="border-t pt-4 space-y-2">
              <div className="text-caption font-medium text-ink-500">Update status</div>
              <div className="flex flex-wrap gap-2">
                {nextStatuses.map((next) => {
                  const notifies = notifiesCustomer(next);
                  const isCancel = next === 'CANCELLED';
                  return (
                    <Button
                      key={next}
                      size="sm"
                      variant={isCancel ? 'outline' : 'default'}
                      disabled={updateStatus.isPending}
                      className={isCancel
                        ? 'gap-1 text-danger border-danger/30 hover:bg-danger/10 hover:text-danger'
                        : 'gap-1 bg-accent-600 hover:bg-accent-700'}
                      onClick={() => (isCancel ? setPendingCancel(true) : updateStatus.mutate(next))}
                    >
                      {notifies ? <BellRing className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                      Mark {STATUS_LABEL[next]}
                    </Button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-px text-caption text-ink-500">
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <BellRing className="w-3 h-3 shrink-0" /> notifies the customer
                </span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <BellOff className="w-3 h-3 shrink-0" /> no template — nothing sent
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Items */}
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-body">Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-surface-0/60">
                    {['Item', 'Qty', 'Unit', 'Line total'].map((h) => (
                      <th key={h} className="text-left text-caption font-semibold text-ink-500 px-4 py-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-300">
                  {order.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink-700">{it.itemName}</div>
                        {it.addons.length > 0 && (
                          <ul className="mt-1 space-y-px">
                            {it.addons.map((a) => (
                              <li key={a.id} className="text-caption text-ink-500">
                                + {a.name}
                                {Number(a.priceDelta) !== 0 && <> ({formatCurrency(a.priceDelta)})</>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-700 whitespace-nowrap">{it.quantity}</td>
                      <td className="px-4 py-3 text-ink-700 whitespace-nowrap">{formatCurrency(it.unitPrice)}</td>
                      <td className="px-4 py-3 font-medium text-ink-700 whitespace-nowrap">
                        {formatCurrency(it.lineTotal)}
                        {addonTotal(it) > 0 && (
                          <span className="block text-caption font-normal text-ink-500">
                            incl. {formatCurrency(addonTotal(it))} add-ons
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t px-4 py-3 space-y-1 bg-surface-0/40">
              <div className="flex justify-between text-sm">
                <span className="text-ink-500">Subtotal</span>
                <span className="text-ink-700">{formatCurrency(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-body font-semibold">
                <span>Total</span>
                <span>{formatCurrency(order.totalAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Customer + delivery */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-body">Customer &amp; delivery</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <Field icon={<User className="w-4 h-4" />} label="Name">
              {order.customerName || '—'}
            </Field>
            <Field icon={<Phone className="w-4 h-4" />} label="Contact">
              {order.contactPhone || order.customer?.waId || '—'}
            </Field>
            <Field icon={<MapPin className="w-4 h-4" />} label="Delivery address">
              {order.deliveryAddress?.trim() ? order.deliveryAddress : <span className="text-ink-500">Not provided</span>}
              {order.deliveryLat != null && order.deliveryLng != null && (
                <div className="mt-1">
                  {/* The customer shared a pin, which is what a driver can actually
                      navigate to — surface it as a map link. */}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${order.deliveryLat},${order.deliveryLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-caption font-medium text-accent-600 hover:underline"
                  >
                    <MapPin className="w-3 h-3" /> Open shared location
                  </a>
                  <span className="ml-2 text-caption text-ink-500">
                    {Number(order.deliveryLat).toFixed(5)}, {Number(order.deliveryLng).toFixed(5)}
                  </span>
                </div>
              )}
            </Field>
            {order.customer?.lifetimeSpend !== undefined && (
              <Field icon={<ShoppingBag className="w-4 h-4" />} label="Lifetime spend">
                {formatCurrency(order.customer.lifetimeSpend)}
              </Field>
            )}
            <Field icon={<StickyNote className="w-4 h-4" />} label="Notes">
              {order.notes?.trim() ? order.notes : <span className="text-ink-500">None</span>}
            </Field>
            <Field icon={<Clock className="w-4 h-4" />} label="Placed at">
              {formatDateTime(order.placedAt)}
            </Field>
          </CardContent>
        </Card>
      </div>

      {/* Cancel confirmation — cancelling is terminal, so make it deliberate. */}
      <Dialog open={pendingCancel} onOpenChange={setPendingCancel}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel order #ORD-{order.orderNumber}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-ink-700">
            <p>This is final — a cancelled order cannot be moved to any other status.</p>
            <p className="flex items-start gap-1">
              {notifiesCustomer('CANCELLED')
                ? <><BellRing className="w-4 h-4 mt-px shrink-0" /> The customer will be notified on WhatsApp.</>
                : <><BellOff className="w-4 h-4 mt-px shrink-0" /> There is no active <code className="text-caption">ORDER_CANCELLED</code> template, so the customer will <strong>not</strong> be told. Tell them another way, or add the template first.</>}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Keep order</Button>
            </DialogClose>
            <Button
              className="bg-danger hover:bg-danger"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate('CANCELLED')}
            >
              {updateStatus.isPending ? 'Cancelling…' : 'Cancel order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
