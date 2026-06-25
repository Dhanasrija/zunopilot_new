import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, MessageSquare, ShoppingCart, BookOpen,
  Users, Bell, Settings, BarChart3, Bot, Smartphone, LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inbox', label: 'Inbox', icon: MessageSquare },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/menu', label: 'Menu', icon: BookOpen },
  { to: '/customers', label: 'Customers', icon: Users },
  // { to: '/automation', label: 'Automation', icon: Bot },
  { to: '/templates', label: 'Templates', icon: Bell },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/whatsapp', label: 'WhatsApp', icon: Smartphone },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function AppLayout() {
  const { tenant, user, clear } = useAuthStore();
  const nav2 = useNavigate();

  const logout = () => { clear(); nav2('/login'); };

  return (
    <div className="min-h-screen flex bg-muted/30">
      <aside className="w-60 border-r bg-background flex flex-col sticky top-0 h-screen">
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
                cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 space-y-2">
          <div className="px-2">
            <div className="text-sm font-medium truncate">{user?.fullName}</div>
            <div className="text-xs text-muted-foreground truncate">{tenant?.businessName}</div>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2" />Logout
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="p-6 max-w-7xl mx-auto"><Outlet /></div>
      </main>
    </div>
  );
}
