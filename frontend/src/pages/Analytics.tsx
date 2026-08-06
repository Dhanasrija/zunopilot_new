import { useMemo } from 'react';
import { CHART_INK, CHART_SERIES, CHART_TICK_SIZE, ORDER_STATUS_COLOR } from '@/lib/chart-tokens';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import {
  MessageSquare, ShoppingCart, CheckCircle2, IndianRupee,
  Send, CheckCheck, Eye, XCircle, TrendingUp, TrendingDown, Download, Calendar,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Overview {
  activeConversations: number;
  totalOrders: number;        totalOrdersTrend: number | null;
  deliveredOrders: number;    deliveredOrdersTrend: number | null;
  grossRevenue: number;       grossRevenueTrend: number | null;
}
interface DayRow    { day: string; orders: number; revenue: number }
interface StatusRow { status: string; count: number }
interface MsgStats  {
  sent: number; sentTrend: number | null;
  deliveryRate: number; readRate: number;
  failed: number; failedTrend: number | null;
}
interface RecentOrder {
  id: string; orderNumber: number; status: string;
  totalAmount: number; placedAt: string;
  customer: { name?: string; phone?: string; waId: string };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLOR = ORDER_STATUS_COLOR;
const STATUS_LABEL: Record<string, string> = {
  NEW: 'New', ACCEPTED: 'Accepted', PREPARING: 'Preparing',
  READY: 'Ready', OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
};
const STATUS_BADGE: Record<string, string> = {
  NEW: 'bg-accent-100 text-accent-700',
  ACCEPTED: 'bg-accent-100 text-accent-700',
  PREPARING: 'bg-warning/15 text-ink-900',
  READY: 'bg-accent-100 text-accent-700',
  OUT_FOR_DELIVERY: 'bg-accent-100 text-accent-700',
  DELIVERED: 'bg-success/10 text-success',
  CANCELLED: 'bg-danger/10 text-danger',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDay(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function fmtTime(d: string) {
  return new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// ── Trend badge ───────────────────────────────────────────────────────────────

function Trend({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-caption text-ink-500">vs last 30d</span>;
  const up = invert ? value < 0 : value >= 0;
  return (
    <span className={`flex items-center gap-px text-caption font-medium ${up ? 'text-success' : 'text-danger'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(value)}% vs last 30d
    </span>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-1 border border-ink-300 shadow-none rounded-lg px-3 py-2 text-caption">
      <p className="font-semibold text-ink-700 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{p.name === 'Revenue' ? formatCurrency(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { data: ov }            = useQuery<Overview>({    queryKey: ['analytics.overview'],   queryFn: async () => (await api.get('/analytics/overview')).data.data });
  const { data: byDay = [] }    = useQuery<DayRow[]>({    queryKey: ['analytics.byDay'],      queryFn: async () => (await api.get('/analytics/orders-by-day')).data.data });
  const { data: byStatus = [] } = useQuery<StatusRow[]>({ queryKey: ['analytics.byStatus'],  queryFn: async () => (await api.get('/analytics/orders-by-status')).data.data });
  const { data: msg }           = useQuery<MsgStats>({    queryKey: ['analytics.msgStats'],   queryFn: async () => (await api.get('/analytics/message-stats')).data.data });
  const { data: recent = [] }   = useQuery<RecentOrder[]>({ queryKey: ['analytics.recent'],  queryFn: async () => (await api.get('/analytics/recent-orders')).data.data });

  const dateLabel = useMemo(() => {
    const to   = new Date();
    const from = new Date(Date.now() - 30 * 86400_000);
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${from.toLocaleDateString('en-IN', opts)} – ${to.toLocaleDateString('en-IN', opts)}`;
  }, []);

  // Recharts data: only keep days with data, format label
  const chartData = byDay.map((d) => ({ ...d, label: fmtDay(d.day) }));

  // Donut data: only statuses with count > 0
  const donutData = byStatus.filter((d) => d.count > 0);
  const donutTotal = donutData.reduce((s, d) => s + d.count, 0);

  const topStats = [
    { label: 'Active Conversations', value: ov?.activeConversations ?? 0,          sub: 'Currently active',      icon: MessageSquare, iconBg: 'bg-accent-100',    iconColor: 'text-accent-600',    trend: null },
    { label: 'Total Orders',         value: ov?.totalOrders ?? 0,                  sub: 'All orders',             icon: ShoppingCart,  iconBg: 'bg-success/10', iconColor: 'text-success', trend: ov?.totalOrdersTrend ?? null },
    { label: 'Delivered Orders',     value: ov?.deliveredOrders ?? 0,              sub: 'Delivered successfully', icon: CheckCircle2,  iconBg: 'bg-success/10',    iconColor: 'text-success',    trend: ov?.deliveredOrdersTrend ?? null },
    { label: 'Revenue',              value: formatCurrency(ov?.grossRevenue ?? 0), sub: 'Total revenue',          icon: IndianRupee,   iconBg: 'bg-warning/15',  iconColor: 'text-warning',  trend: ov?.grossRevenueTrend ?? null },
  ];

  const perfMetrics = [
    { label: 'Messages Sent',   value: (msg?.sent    ?? 0).toLocaleString(), icon: Send,      iconBg: 'bg-accent-100',    iconColor: 'text-accent-600',    trend: msg?.sentTrend   ?? null, invert: false },
    { label: 'Delivery Rate',   value: `${msg?.deliveryRate ?? 0}%`,          icon: CheckCheck, iconBg: 'bg-success/10', iconColor: 'text-success', trend: null,                     invert: false },
    { label: 'Read Rate',       value: `${msg?.readRate     ?? 0}%`,          icon: Eye,       iconBg: 'bg-accent-100',  iconColor: 'text-accent-600',  trend: null,                     invert: false },
    { label: 'Failed Messages', value: (msg?.failed  ?? 0).toLocaleString(), icon: XCircle,   iconBg: 'bg-danger/10',     iconColor: 'text-danger',     trend: msg?.failedTrend ?? null, invert: true  },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-px">
            Operational metrics and performance overview for the last 30 days.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 border rounded-lg px-3 py-1 text-caption text-ink-500 bg-surface-1 shadow-none">
            <Calendar className="h-4 w-4" /> {dateLabel}
          </div>
          <button className="flex items-center gap-1 border rounded-lg px-3 py-1 text-caption text-ink-700 bg-surface-1 shadow-none hover:bg-surface-0 transition-colors">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {topStats.map(({ label, value, sub, icon: Icon, iconBg, iconColor, trend }) => (
          <div key={label} className="rounded-lg border bg-surface-1 shadow-none p-4 flex items-start gap-3">
            <div className={`w-11 h-11 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5 h-5 ${iconColor}`} />
            </div>
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">{label}</p>
              <p className="text-h2 font-semibold mt-px leading-none">{value}</p>
              <p className="text-caption text-ink-500 mt-1">{sub}</p>
              <div className="mt-1"><Trend value={trend} /></div>
            </div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* Left: chart + recent orders */}
        <div className="lg:col-span-3 space-y-4">

          {/* Area chart */}
          <div className="rounded-lg border bg-surface-1 shadow-none p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-sm">Orders &amp; Revenue Over Time</h2>
                <p className="text-caption text-ink-500">Last 30 days</p>
              </div>
            </div>
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm text-ink-500">
                No order data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: CHART_TICK_SIZE, fill: CHART_INK.axis }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="orders"  tick={{ fontSize: CHART_TICK_SIZE, fill: CHART_INK.axis }} axisLine={false} tickLine={false} width={28} />
                  <YAxis yAxisId="revenue" orientation="right" tick={{ fontSize: CHART_TICK_SIZE, fill: CHART_INK.axis }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line yAxisId="orders"  type="monotone" dataKey="orders"  name="Orders"  stroke={CHART_SERIES[1]} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                  <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Revenue" stroke={CHART_SERIES[5]} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Recent orders */}
          <div className="rounded-lg border bg-surface-1 shadow-none overflow-hidden">
            <div className="flex items-center justify-between px-4 py-4 border-b">
              <h2 className="font-semibold text-sm">Recent Orders</h2>
              <a href="/orders" className="text-caption text-accent-600 hover:text-accent-700 font-medium">View all →</a>
            </div>
            {recent.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-500">No orders yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-surface-0/60">
                    {['Order ID', 'Customer', 'Status', 'Amount', 'Date'].map((h) => (
                      <th key={h} className="text-left text-caption font-semibold text-ink-500 px-4 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-300">
                  {recent.map((o) => (
                    <tr key={o.id} className="hover:bg-surface-0/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-ink-700">#ORD-{o.orderNumber}</td>
                      <td className="px-4 py-3 text-ink-700">{o.customer.name || o.customer.phone || o.customer.waId}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-px rounded-full text-caption font-semibold ${STATUS_BADGE[o.status] ?? 'bg-surface-0 text-ink-700'}`}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{formatCurrency(o.totalAmount)}</td>
                      <td className="px-4 py-3 text-ink-500 text-caption">{fmtTime(o.placedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: donut + performance */}
        <div className="lg:col-span-2 space-y-4">

          {/* Donut */}
          <div className="rounded-lg border bg-surface-1 shadow-none p-4">
            <h2 className="font-semibold text-sm mb-4">Orders by Status</h2>
            {donutData.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm text-ink-500">No orders yet</div>
            ) : (
              <>
                <div className="flex justify-center">
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="count"
                        nameKey="status"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={3}
                        strokeWidth={0}
                        startAngle={90}
                        endAngle={-270}
                      >
                        {donutData.map((d) => (
                          <Cell key={d.status} fill={STATUS_COLOR[d.status] ?? CHART_INK.axis} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          `${value} (${donutTotal > 0 ? Math.round(value / donutTotal * 100) : 0}%)`,
                          STATUS_LABEL[name] ?? name,
                        ]}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${CHART_INK.grid}` }}
                      />
                      {/* Center label */}
                      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 22, fontWeight: 600, fill: CHART_INK.ink }}>
                        {donutTotal > 0 ? Math.round((donutData.find((d) => d.status === 'DELIVERED')?.count ?? 0) / donutTotal * 100) : 0}%
                      </text>
                      <text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 10, fill: CHART_INK.axis }}>
                        delivered
                      </text>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 mt-1">
                  {donutData.map((d) => {
                    const pct = donutTotal > 0 ? Math.round(d.count / donutTotal * 100) : 0;
                    return (
                      <div key={d.status} className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-caption text-ink-700">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: STATUS_COLOR[d.status] }} />
                          {STATUS_LABEL[d.status] ?? d.status}
                        </span>
                        <span className="text-caption font-semibold text-ink-700">
                          {d.count} <span className="text-ink-500 font-normal">({pct}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Performance overview */}
          <div className="rounded-lg border bg-surface-1 shadow-none p-4">
            <h2 className="font-semibold text-sm mb-4">Performance Overview</h2>
            <div className="space-y-1">
              {perfMetrics.map(({ label, value, icon: Icon, iconBg, iconColor, trend, invert }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-4 h-4 ${iconColor}`} />
                    </div>
                    <div>
                      <p className="text-caption text-ink-500">{label}</p>
                      <p className="text-h3 font-semibold text-ink-900 leading-tight">{value}</p>
                    </div>
                  </div>
                  <Trend value={trend} invert={invert} />
                </div>
              ))}
            </div>
            <p className="text-caption text-ink-500 mt-3">Compared to previous 30-day period</p>
          </div>

        </div>
      </div>
    </div>
  );
}
