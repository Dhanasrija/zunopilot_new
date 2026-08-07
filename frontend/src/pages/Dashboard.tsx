import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import {
  MessageSquare, ShoppingCart, CheckCircle2, IndianRupee,
  TrendingUp, TrendingDown, Users, Zap, BookOpen, Shield,
  HeadphonesIcon, Globe, Bell, CalendarDays, Search, HelpCircle,
} from 'lucide-react';

interface Overview {
  activeConversations: number;
  totalOrders: number;        totalOrdersTrend: number | null;
  deliveredOrders: number;    deliveredOrdersTrend: number | null;
  grossRevenue: number;       grossRevenueTrend: number | null;
}
interface RecentOrder {
  id: string; orderNumber: number; status: string;
  totalAmount: number; placedAt: string;
  customer: { name?: string; phone?: string; waId: string };
}

const STATUS_BADGE: Record<string, string> = {
  NEW: 'bg-accent-100 text-accent-700',
  ACCEPTED: 'bg-accent-100 text-accent-700',
  PREPARING: 'bg-warning/15 text-ink-900',
  READY: 'bg-accent-100 text-accent-700',
  OUT_FOR_DELIVERY: 'bg-accent-100 text-accent-700',
  DELIVERED: 'bg-success/10 text-success',
  CANCELLED: 'bg-danger/10 text-danger',
};
const STATUS_LABEL: Record<string, string> = {
  NEW: 'New', ACCEPTED: 'Accepted', PREPARING: 'Preparing',
  READY: 'Ready', OUT_FOR_DELIVERY: 'On the way',
  DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
};

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} mins ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hrs ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

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

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getCurrentWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}, ${sunday.getFullYear()}`;
}

export default function Dashboard() {
  const tenant = useAuthStore((s) => s.tenant);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const firstName = user?.fullName?.split(' ')[0] ?? 'there';
  const initials = user?.fullName
    ? user.fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  const { data: ov, isLoading } = useQuery<Overview>({
    queryKey: ['analytics.overview'],
    queryFn: async () => (await api.get('/analytics/overview')).data.data,
    refetchInterval: 60_000,
  });

  const { data: recent = [] } = useQuery<RecentOrder[]>({
    queryKey: ['analytics.recent'],
    queryFn: async () => (await api.get('/analytics/recent-orders')).data.data,
    refetchInterval: 30_000,
  });

  const stats = [
    {
      label: 'Active Conversations', value: isLoading ? '—' : String(ov?.activeConversations ?? 0),
      icon: MessageSquare, iconBg: 'bg-accent-100', iconColor: 'text-accent-600', trend: null,
    },
    {
      label: 'Total Orders', value: isLoading ? '—' : String(ov?.totalOrders ?? 0),
      icon: ShoppingCart, iconBg: 'bg-success/10', iconColor: 'text-success', trend: ov?.totalOrdersTrend ?? null,
    },
    {
      label: 'Delivered Orders', value: isLoading ? '—' : String(ov?.deliveredOrders ?? 0),
      icon: CheckCircle2, iconBg: 'bg-success/10', iconColor: 'text-success', trend: ov?.deliveredOrdersTrend ?? null,
    },
    {
      label: 'Revenue (30d)', value: isLoading ? '—' : formatCurrency(ov?.grossRevenue ?? 0),
      icon: IndianRupee, iconBg: 'bg-warning/15', iconColor: 'text-warning', trend: ov?.grossRevenueTrend ?? null,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Top bar — dashboard only */}
      <div className="-mx-6 -mt-6 mb-2 px-6 py-3 border-b bg-surface-1 flex items-center gap-4">
        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full h-9 pl-8 pr-3 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-accent-600/20 focus:border-accent-600 placeholder:text-muted-foreground"
            placeholder="Search anything..."
          />
        </div>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate('/settings?tab=notifications')}
            className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4 text-ink-500" />
          </button>
          <button className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors" aria-label="Help">
            <HelpCircle className="h-4 w-4 text-ink-500" />
          </button>
          {/* Profile chip */}
          <button
            onClick={() => navigate('/settings?tab=profile')}
            className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-lg hover:bg-accent transition-colors"
          >
            <div className="h-8 w-8 rounded-full bg-accent-100 flex items-center justify-center text-accent-700 text-caption font-semibold shrink-0">
              {initials}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium leading-tight">{user?.fullName}</p>
              <p className="text-caption text-muted-foreground leading-tight capitalize">{user?.role?.toLowerCase()}</p>
            </div>
          </button>
        </div>
      </div>

      {/* Greeting header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-semibold">
            {getGreeting()}, <span className="text-accent-600">{firstName}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-px">Here&apos;s what&apos;s happening with your business today.</p>
        </div>
        <button className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-accent transition-colors shrink-0">
          <CalendarDays className="h-4 w-4 text-ink-500" />
          {getCurrentWeekRange()}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, iconBg, iconColor, trend }) => (
          <div key={label} className="rounded-lg border bg-surface-1 shadow-none p-4 flex items-start gap-3">
            <div className={`w-11 h-11 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5 h-5 ${iconColor}`} />
            </div>
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">{label}</p>
              <p className="text-h2 font-semibold mt-px leading-none">{value}</p>
              <div className="mt-1"><Trend value={trend} /></div>
            </div>
          </div>
        ))}
      </div>

      {/* Main two-column layout */}
      <div className="grid lg:grid-cols-5 gap-4">

        {/* Left: Recent Orders */}
        <div className="lg:col-span-3 rounded-lg border bg-surface-1 shadow-none overflow-hidden">
          <div className="flex items-center justify-between px-4 py-4 border-b">
            <div>
              <h2 className="font-semibold">Recent Orders</h2>
              <p className="text-caption text-ink-500">Real-time WhatsApp chat dashboard</p>
            </div>
            <span className="flex items-center gap-1 text-caption font-medium text-success bg-success/10 border border-success/30 rounded-full px-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              Live Sync
            </span>
          </div>

          <table className="table-stack w-full text-sm">
            <thead>
              <tr className="border-b bg-surface-0/60">
                <th className="text-left text-caption font-semibold text-ink-500 px-4 py-2">CUSTOMER</th>
                <th className="text-left text-caption font-semibold text-ink-500 px-4 py-2 hidden md:table-cell">ITEMS</th>
                <th className="text-left text-caption font-semibold text-ink-500 px-4 py-2">AMOUNT</th>
                <th className="text-left text-caption font-semibold text-ink-500 px-4 py-2">TIME</th>
                <th className="text-left text-caption font-semibold text-ink-500 px-4 py-2">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-300">
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-500">
                    No orders yet
                  </td>
                </tr>
              ) : (
                recent.map((o) => {
                  const initials = (o.customer.name || o.customer.phone || o.customer.waId)
                    .slice(0, 2).toUpperCase();
                  const displayName = o.customer.name || o.customer.phone || o.customer.waId;
                  return (
                    <tr key={o.id} className="hover:bg-surface-0/50 transition-colors">
                      <td data-label="Customer" className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-ink-300 flex items-center justify-center shrink-0 text-caption font-semibold text-ink-700">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-ink-700 truncate">{displayName}</p>
                            <p className="text-caption text-ink-500">#ORD-{o.orderNumber}</p>
                          </div>
                        </div>
                      </td>
                      <td data-label="Items" className="px-4 py-3 hidden md:table-cell">
                        <p className="text-caption text-ink-500">{formatCurrency(o.totalAmount)}</p>
                      </td>
                      <td data-label="Amount" className="px-4 py-3 font-semibold text-ink-700">
                        {formatCurrency(o.totalAmount)}
                      </td>
                      <td data-label="Time" className="px-4 py-3 text-ink-500 text-caption whitespace-nowrap">
                        {timeAgo(o.placedAt)}
                      </td>
                      <td data-label="Status" className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-px rounded-full text-caption font-semibold ${STATUS_BADGE[o.status] ?? 'bg-surface-0 text-ink-700'}`}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <div className="px-4 py-3 border-t bg-surface-0/40 flex justify-end">
            <a href="/orders" className="text-caption text-accent-600 hover:text-accent-700 font-medium">
              View all orders →
            </a>
          </div>
        </div>

        {/* Right: Feature highlights */}
        <div className="lg:col-span-2 rounded-lg border bg-surface-1 shadow-none p-4 flex flex-col">
          <h2 className="font-semibold text-sm mb-4">
            Powerful tools to manage your {tenant?.businessName ?? 'business'} chat
          </h2>

          <div className="space-y-4 flex-1">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-surface-0 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4 text-ink-700" />
              </div>
              <div>
                <p className="font-semibold text-sm">Shared Live Inbox</p>
                <p className="text-caption text-ink-500 mt-px leading-relaxed">
                  Connect multiple agents to a single WhatsApp Number. Handle conversations dynamically, review logs, and tag customers.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-surface-0 flex items-center justify-center shrink-0">
                <BookOpen className="w-4 h-4 text-ink-700" />
              </div>
              <div>
                <p className="font-semibold text-sm">Keyword Automation</p>
                <p className="text-caption text-ink-500 mt-px leading-relaxed">
                  Define priority keyword matching rules (e.g. &quot;hours&quot;, &quot;address&quot;) to instantly reply to common queries without manual intervention.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-surface-0 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-ink-700" />
              </div>
              <div>
                <p className="font-semibold text-sm">Trigger Notifications</p>
                <p className="text-caption text-ink-500 mt-px leading-relaxed">
                  Automate customer notifications. Instantly fire WhatsApp utility templates on order creations, acceptances, and deliveries.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4">
            {[
              { icon: Shield,         label: 'UPTIME SLA',           value: '99.9%',  color: 'text-accent-600', bg: 'bg-accent-100' },
              { icon: HeadphonesIcon, label: '24/7 PREMIUM SUPPORT', value: '24/7',   color: 'text-accent-600',   bg: 'bg-accent-100' },
              { icon: Globe,          label: 'BUSINESSES CONNECTED', value: '5,000+', color: 'text-success',bg: 'bg-success/10' },
              { icon: MessageSquare,  label: 'MESSAGES SENT',        value: '10M+',   color: 'text-danger',   bg: 'bg-danger/10' },
            ].map(({ icon: Icon, label, value, color, bg }) => (
              <div key={label} className="flex flex-col items-center gap-1 py-2">
                <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <p className={`text-h3 font-semibold ${color}`}>{value}</p>
                <p className="text-caption text-ink-500 text-center leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
