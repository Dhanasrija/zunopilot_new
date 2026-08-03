import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import SupportAccessBanner from './SupportAccessBanner';
import { useAuthStore, type ModuleKey, type Permission } from '@/stores/auth.store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, MessageSquare, ShoppingCart, BookOpen,
  Users, Bell, Settings, BarChart3, Smartphone, LogOut, UserCircle2, ChevronUp,
  Workflow as WorkflowIcon, Bot, PlugZap, Users2, CreditCard,
  Target, Megaphone, LifeBuoy,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The sidebar.
 *
 * Each entry names the **same permission its API route enforces**, so the menu
 * and the server cannot disagree — a link that 403s when clicked is a support
 * ticket, and it was the state of this file until now (it rendered all fourteen
 * items to everyone regardless of role). `module` additionally hides an entry for
 * a workspace that was never given that module.
 *
 * Hiding is a courtesy, not a control. `requirePermission` and `requireModule`
 * refuse the request whatever the client chose to render.
 */
const nav: Array<{
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  permission?: Permission;
  module?: ModuleKey;
}> = [
  // No permission: every signed-in member of a workspace has a dashboard.
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inbox', label: 'Inbox', icon: MessageSquare, permission: 'inbox:read' },
  { to: '/orders', label: 'Orders', icon: ShoppingCart, permission: 'orders:read' },
  { to: '/menu', label: 'Menu', icon: BookOpen, permission: 'catalogue:read' },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'customers:read' },
  { to: '/leads', label: 'Leads', icon: Target, permission: 'leads:read', module: 'LEADS' },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone, permission: 'campaigns:read', module: 'MARKETING' },
  { to: '/tickets', label: 'Support', icon: LifeBuoy, permission: 'tickets:read', module: 'SUPPORT' },
  { to: '/assistants', label: 'Assistants', icon: Bot, permission: 'workflows:read' },
  { to: '/workflows', label: 'Workflows', icon: WorkflowIcon, permission: 'workflows:read' },
  { to: '/connectors', label: 'Connectors', icon: PlugZap, permission: 'connectors:read' },
  // The templates list is itself behind `templates:write` on the server
  // (`template.routes.ts:25`) — there is no separate read permission.
  { to: '/templates', label: 'Templates', icon: Bell, permission: 'templates:write' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics:read' },
  { to: '/whatsapp', label: 'WhatsApp', icon: Smartphone, permission: 'settings:read' },
  { to: '/team', label: 'Team', icon: Users2, permission: 'team:read' },
  { to: '/billing', label: 'Billing', icon: CreditCard, permission: 'settings:read' },
  { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings:read' },
];

/**
 * `fullBleed` hands the whole main area to the page and lets it own scrolling —
 * used by the workflow canvas, which needs the full height and no max width.
 */
export default function AppLayout({ fullBleed = false }: { fullBleed?: boolean }) {
  const { tenant, user, clear } = useAuthStore();
  const permissions = useAuthStore((s) => s.permissions);
  const modules = useAuthStore((s) => s.modules);
  const nav2 = useNavigate();

  const visibleNav = nav.filter(({ permission, module }) =>
    (permission === undefined || permissions.includes(permission))
    && (module === undefined || modules.includes(module)));

  const logout = () => { clear(); nav2('/login'); };

  const initials = user?.fullName
    ? user.fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  return (
    <div className="h-screen flex bg-surface-0 overflow-hidden">
      <aside className="w-sidebar border-r border-ink-300 bg-surface-1 flex flex-col h-screen shrink-0">
        <div className="h-16 px-4 flex items-center border-b border-ink-300">
          <Link to="/" className="flex items-center gap-2">
            <img src="/app-logo.png" alt="ZunoPilot" className="h-8 w-auto" />
            <span className="text-h3 font-semibold tracking-display text-ink-900">ZunoPilot</span>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors border',
                  isActive
                    ? 'border-accent-600 text-accent-600 bg-transparent font-medium'
                    : 'border-transparent text-ink-500 hover:bg-accent-100/40 hover:text-ink-900'
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar profile footer */}
        <div className="border-t border-ink-300 p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent-100/40 transition-colors duration-micro group">
                <div className="h-9 w-9 rounded-full bg-accent-100 flex items-center justify-center text-accent-700 text-caption font-semibold shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-sm font-medium truncate">{user?.fullName}</div>
                  <div className="text-caption text-ink-500 truncate">{tenant?.businessName}</div>
                </div>
                <ChevronUp className="h-4 w-4 text-ink-500 shrink-0 group-hover:text-ink-900 transition-colors duration-micro" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-52">
              <DropdownMenuItem onClick={() => nav2('/settings?tab=profile')}>
                <UserCircle2 className="h-4 w-4 mr-2" />Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-danger focus:text-danger">
                <LogOut className="h-4 w-4 mr-2" />Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/*
        Block layout, deliberately not `flex flex-col`.

        With a column flex parent, `mx-auto` on the wrapper below sets
        `margin-inline: auto`, which **overrides the default `align-items:
        stretch`** — so the wrapper sizes to its content instead of filling the
        main area. Every page then got wider or narrower according to how much was
        in it, and an empty state collapsed to a thin column. The banner is a plain
        block element and stacks above the content without any of that.

        `w-full` on the wrapper is belt-and-braces: it keeps the width correct even
        if this ever becomes a flex container again.
      */}
      <main className={cn('flex-1 min-w-0 h-screen', fullBleed ? 'overflow-hidden' : 'overflow-y-auto')}>
        <SupportAccessBanner />
        {fullBleed ? <Outlet /> : <div className="w-full p-6 max-w-dashboard mx-auto"><Outlet /></div>}
      </main>
    </div>
  );
}
