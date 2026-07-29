import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, MessageSquare, ShoppingCart, BookOpen,
  Users, Bell, Settings, BarChart3, Smartphone, LogOut, UserCircle2, ChevronUp,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inbox', label: 'Inbox', icon: MessageSquare },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/menu', label: 'Menu', icon: BookOpen },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/templates', label: 'Templates', icon: Bell },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/whatsapp', label: 'WhatsApp', icon: Smartphone },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function AppLayout() {
  const { tenant, user, clear } = useAuthStore();
  const nav2 = useNavigate();

  const logout = () => { clear(); nav2('/login'); };

  const initials = user?.fullName
    ? user.fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <aside className="w-60 border-r bg-background flex flex-col h-screen shrink-0">
        <div className="h-16 px-5 flex items-center border-b">
          <Link to="/" className="flex items-center gap-2">
            <img src="/app-logo.png" alt="ZunoPilot" className="h-8 w-auto" />
            <span className="text-lg font-bold tracking-tight text-slate-900">ZunoPilot</span>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors border',
                  isActive
                    ? 'border-primary text-primary bg-transparent font-medium'
                    : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar profile footer */}
        <div className="border-t p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent transition-colors group">
                <div className="h-9 w-9 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 text-xs font-semibold shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-sm font-medium truncate">{user?.fullName}</div>
                  <div className="text-xs text-muted-foreground truncate">{tenant?.businessName}</div>
                </div>
                <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-52">
              <DropdownMenuItem onClick={() => nav2('/settings?tab=profile')}>
                <UserCircle2 className="h-4 w-4 mr-2" />Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600">
                <LogOut className="h-4 w-4 mr-2" />Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto h-screen">
        <div className="p-6 max-w-7xl mx-auto"><Outlet /></div>
      </main>
    </div>
  );
}
