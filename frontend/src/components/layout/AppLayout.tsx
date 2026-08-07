import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import SupportAccessBanner from './SupportAccessBanner';
import { NotificationBell } from './NotificationBell';
import { useNotifications } from '@/hooks/useNotifications';
import {
  useAuthStore, useCatalogueNouns, type ModuleKey, type Permission,
} from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, MessageSquare, ShoppingCart, BookOpen,
  Users, Bell, Settings, BarChart3, Smartphone, LogOut, UserCircle2, ChevronUp,
  Workflow as WorkflowIcon, Bot, PlugZap, Users2, CreditCard,
  Target, Megaphone, LifeBuoy, Menu, PanelLeftClose, PanelLeftOpen,
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
  { to: '/orders', label: 'Orders', icon: ShoppingCart, permission: 'orders:read', module: 'ECOMMERCE' },
  // `label` is a placeholder: this entry is renamed per workspace below, because "Menu" is a
  // restaurant word and a grocery or a consultancy is not a restaurant.
  { to: '/catalogue', label: 'Catalogue', icon: BookOpen, permission: 'catalogue:read', module: 'ECOMMERCE' },
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
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const nav2 = useNavigate();
  const location = useLocation();

  /**
   * The mobile drawer, deliberately local and unpersisted — reloading into an overlay
   * covering the page is a bug, not a restored preference.
   */
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Closes on navigation. Leaving the drawer open over the page it just opened is the
  // classic version of this bug, and on a phone it hides the thing you asked for.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Escape closes it. Bound only while open, so nothing listens for keys the rest of the
  // time.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const { noun: catalogueNoun } = useCatalogueNouns();

  const visibleNav = nav
    .filter(({ permission, module }) =>
      (permission === undefined || permissions.includes(permission))
      && (module === undefined || modules.includes(module)))
    /*
     * The catalogue is called whatever this business calls it.
     *
     * Renamed here rather than in the `nav` constant because the word depends on the signed-in
     * workspace. Both this and the page itself read `useCatalogueNouns`, so the sidebar and the
     * page cannot say different things — which they did until now, the page adapting for grocery
     * while the nav said "Menu" to everyone.
     */
    .map((entry) => (entry.to === '/catalogue' ? { ...entry, label: catalogueNoun } : entry));

  const logout = () => { clear(); nav2('/login'); };

  /*
   * Mounted here and nowhere else.
   *
   * This owns the polling, the tab title and the firing of desktop notifications, so a
   * second call site would double the requests and show every popup twice. Both bells
   * below are handed the result rather than calling the hook themselves.
   */
  const {
    notifications, unread, markAllRead, open: openNotification,
  } = useNotifications();

  const unreadMessages = notifications
    .filter((n) => !n.readAt && n.kind === 'MESSAGE_RECEIVED').length;

  const initials = user?.fullName
    ? user.fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  /*
   * Note on how the off-canvas sidebar is taken out of play — `visibility`, not `inert`.
   *
   * An element slid off-screen is still in the document: without something, tabbing on a
   * phone walks through seventeen invisible links before reaching the page.
   *
   * The first attempt used the `inert` attribute, and that shipped a bad bug. Attributes
   * cannot be media-queried, so the condition was written in JavaScript as "the drawer is
   * shut" — which on a desktop is *always* true. The sidebar rendered at its full 240px
   * and was completely unclickable, because `inert` removes an element from hit-testing.
   * The second attempt tracked the breakpoint with `matchMedia` and was correct but
   * fragile: two sources of truth for one boundary, and the React state could sit stale
   * behind the CSS.
   *
   * `visibility: hidden` does the same job — no hit-testing, out of the tab order, hidden
   * from screen readers — and it *is* a media-queryable property. So the whole guard is
   * `invisible lg:visible` below, one mechanism, no JS breakpoint, and the desktop case
   * cannot regress because the same `lg:` prefix governs it as everything else here.
   */

  return (
    <div className="h-screen flex bg-surface-0 overflow-hidden">
      {/* Backdrop. Below `lg` only, and only while open. */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close the menu"
          className="fixed inset-0 z-30 bg-ink-900/40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/*
        One aside, two behaviours.

        Below `lg` it is `fixed` and slid out of view, so it contributes **no layout width**
        and `main` gets the whole viewport — the sidebar used to take 239px of a 375px screen
        and leave 135px for content. At `lg` and up it returns to the flow and its width
        toggles between the two §4.2 sizes.
      */}
      <aside
        id="app-sidebar"
        className={cn(
          'border-r border-ink-300 bg-surface-1 flex flex-col h-screen',
          'fixed inset-y-0 left-0 z-40 w-sidebar transition-[transform,visibility] duration-panel',
          // Closed below `lg`: slid away *and* invisible, so nothing inside is focusable
          // or clickable. `lg:visible` is what keeps the desktop sidebar interactive.
          drawerOpen ? 'visible translate-x-0' : 'invisible -translate-x-full',
          'lg:visible lg:translate-x-0',
          // At `lg` it is back in the flow and its width is the toggle.
          'lg:static lg:shrink-0 lg:transition-[width] lg:duration-panel',
          collapsed ? 'lg:w-rail' : 'lg:w-sidebar',
        )}
      >
        <div className={cn(
          'h-16 flex items-center border-b border-ink-300',
          collapsed ? 'lg:justify-center lg:px-2' : 'px-4',
        )}>
          <Link to="/" className="flex items-center gap-2 overflow-hidden">
            <img src="/app-logo.png" alt="ZunoPilot" className="h-8 w-auto shrink-0" />
            {/* The wordmark is what goes when the rail narrows; the mark stays. */}
            <span className={cn(
              'text-h3 font-semibold tracking-display text-ink-900 whitespace-nowrap',
              collapsed && 'lg:hidden',
            )}>
              ZunoPilot
            </span>
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              // `title` for the pointer, `aria-label` for everything else. Seventeen
              // unlabelled icons are otherwise unnavigable, and this needs no dependency.
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors border',
                  collapsed && 'lg:justify-center lg:px-2',
                  isActive
                    ? 'border-accent-600 text-accent-600 bg-transparent font-medium'
                    : 'border-transparent text-ink-500 hover:bg-accent-100/40 hover:text-ink-900'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className={cn('whitespace-nowrap', collapsed && 'lg:hidden')}>{label}</span>
              {/*
                Unread messages, on the Inbox item.
                Counted from the loaded notifications rather than a second endpoint, and
                filtered to the message kind: an unanswered handoff is urgent but it is
                not "unread mail", and lumping them together makes the number mean
                nothing. The list is the 30 most recent, so this saturates at "9+" well
                before that cap could mislead anyone.
              */}
              {to === '/inbox' && unreadMessages > 0 && (
                <span
                  aria-label={`${unreadMessages} unread`}
                  className={cn(
                    'ml-auto rounded-full bg-danger px-2 text-caption font-medium text-surface-1',
                    collapsed && 'lg:hidden',
                  )}
                >
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar profile footer */}
        <div className="border-t border-ink-300 p-2">
          {/* Above the profile row, so it sits with the other account-level controls
              rather than among the places you can navigate to. */}
          <NotificationBell
            notifications={notifications}
            unread={unread}
            onOpen={openNotification}
            onMarkAllRead={markAllRead}
            collapsed={collapsed}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title={collapsed ? user?.fullName ?? 'Account' : undefined}
                className={cn(
                  'w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent-100/40 transition-colors duration-micro group',
                  collapsed && 'lg:justify-center lg:px-0',
                )}
              >
                <div className="h-9 w-9 rounded-full bg-accent-100 flex items-center justify-center text-accent-700 text-caption font-semibold shrink-0">
                  {initials}
                </div>
                <div className={cn('min-w-0 flex-1 text-left', collapsed && 'lg:hidden')}>
                  <div className="text-sm font-medium truncate">{user?.fullName}</div>
                  <div className="text-caption text-ink-500 truncate">{tenant?.businessName}</div>
                </div>
                <ChevronUp className={cn(
                  'h-4 w-4 text-ink-500 shrink-0 group-hover:text-ink-900 transition-colors duration-micro',
                  collapsed && 'lg:hidden',
                )} />
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

        {/* The collapse toggle. `lg` and up only — below that the drawer is the mechanism. */}
        <div className="hidden border-t border-ink-300 p-2 lg:block">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-ink-500 transition-colors duration-micro hover:bg-accent-100/40 hover:text-ink-900',
              collapsed && 'justify-center px-2',
            )}
          >
            {collapsed
              ? <PanelLeftOpen className="h-4 w-4 shrink-0" />
              : <PanelLeftClose className="h-4 w-4 shrink-0" />}
            <span className={cn('whitespace-nowrap', collapsed && 'hidden')}>Collapse</span>
          </button>
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
        {/*
          The mobile header. Below `lg` only, because at `lg` the sidebar is always visible
          and a hamburger would open something already on screen.

          Its height is what `--shell-offset` accounts for in `index.css` — the two
          full-height pages subtract that variable rather than a hard-coded number, so this
          bar cannot silently push them past the bottom of the viewport.
        */}
        <div className="flex h-14 items-center gap-3 border-b border-ink-300 bg-surface-1 px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            aria-label="Open the menu"
            className="rounded-md p-2 text-ink-500 transition-colors duration-micro hover:bg-accent-100/40 hover:text-ink-900"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="truncate text-sm font-medium text-ink-900">
            {tenant?.businessName ?? 'ZunoPilot'}
          </span>
          {/* Pushed right. On a phone the sidebar is behind a hamburger, so without
              this the bell would be two taps away from the screen someone is on. */}
          <div className="ml-auto shrink-0">
            <NotificationBell
              notifications={notifications}
              unread={unread}
              onOpen={openNotification}
              onMarkAllRead={markAllRead}
              iconOnly
            />
          </div>
        </div>

        <SupportAccessBanner />
        {fullBleed ? <Outlet /> : <div className="w-full p-6 max-w-dashboard mx-auto"><Outlet /></div>}
      </main>
    </div>
  );
}
