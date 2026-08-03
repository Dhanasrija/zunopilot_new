import { useQuery } from '@tanstack/react-query';
import {
  Link, Navigate, Route, Routes, useLocation,
} from 'react-router-dom';
import {
  Building2, ClipboardList, Inbox, LayoutDashboard, LogOut, ReceiptIndianRupee, ShieldCheck, Tags,
} from 'lucide-react';
import { sa, tokenStore } from './lib/api';
import { cn } from './components/ui';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Tenants from './pages/Tenants';
import TenantDetail from './pages/TenantDetail';
import Plans from './pages/Plans';
import Categories from './pages/Categories';
import Enquiries from './pages/Enquiries';
import Audit from './pages/Audit';

// The console shell.
//
// Every screen behind `RequireAuth`, which asks the server who it is talking to
// rather than trusting a decoded token. The client can read a JWT's claims, but
// only the server knows whether that operator has since been deactivated — and
// on a surface that reads every workspace, that difference is the whole point.

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/tenants', label: 'Workspaces', icon: Building2 },
  { to: '/plans', label: 'Plans', icon: ReceiptIndianRupee },
  { to: '/enquiries', label: 'Enquiries', icon: Inbox, badge: 'newEnquiries' as const },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/audit', label: 'Audit log', icon: ClipboardList },
];

function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { data: admin } = useQuery({ queryKey: ['me'], queryFn: () => sa.me() });

  // The unhandled-enquiry count, for the nav badge. Shares the `overview` query key
  // with the Overview page, so this costs no extra request — and an inbox nobody is
  // told about is one nobody checks.
  const { data: overview } = useQuery({
    queryKey: ['overview'],
    queryFn: () => sa.overview(),
    refetchInterval: 60_000,
  });

  const signOut = () => {
    tokenStore.clear();
    window.location.href = '/login';
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-white">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">ZunoPilot</p>
            <p className="text-[11px] text-slate-500">Operations</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((item) => {
            const active = item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                {item.badge === 'newEnquiries' && !!overview?.newEnquiries && (
                  <span className="ml-auto rounded-full bg-violet-600 px-1.5 text-[11px] font-semibold text-white">
                    {overview.newEnquiries}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <p className="truncate text-xs font-medium text-slate-700">{admin?.fullName ?? '…'}</p>
          <p className="truncate text-[11px] text-slate-500">{admin?.email}</p>
          <button
            onClick={signOut}
            className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-800"
          >
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = tokenStore.get();
  const { isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: () => sa.me(),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token) return <Navigate to="/login" replace />;
  if (isLoading) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Checking access…</div>;
  }
  if (isError) return <Navigate to="/login" replace />;

  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Overview /></RequireAuth>} />
      <Route path="/tenants" element={<RequireAuth><Tenants /></RequireAuth>} />
      <Route path="/tenants/:tenantId" element={<RequireAuth><TenantDetail /></RequireAuth>} />
      <Route path="/plans" element={<RequireAuth><Plans /></RequireAuth>} />
      <Route path="/enquiries" element={<RequireAuth><Enquiries /></RequireAuth>} />
      <Route path="/categories" element={<RequireAuth><Categories /></RequireAuth>} />
      <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
