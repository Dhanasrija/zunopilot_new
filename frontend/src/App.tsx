import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from '@/components/layout/ProtectedRoute';
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import Dashboard from '@/pages/Dashboard';
import Inbox from '@/pages/Inbox';
import Orders from '@/pages/Orders';
import Menu from '@/pages/Menu';
import Customers from '@/pages/Customers';
import Automation from '@/pages/Automation';
import Templates from '@/pages/Templates';
import TemplateView from '@/pages/TemplateView';
import TemplateEdit from '@/pages/TemplateEdit';
import Analytics from '@/pages/Analytics';
import Whatsapp from '@/pages/Whatsapp';
import Settings from '@/pages/Settings';
import Landing from '@/pages/Landing';
import Privacy from '@/pages/Privacy';
import Terms from '@/pages/Terms';
import Contact from '@/pages/Contact';
import ScrollToTop from '@/components/layout/ScrollToTop';

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          {/* Public Website Routes */}
          <Route path="/" element={<Landing />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Protected Application Routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="orders" element={<Orders />} />
              <Route path="menu" element={<Menu />} />
              <Route path="customers" element={<Customers />} />
              <Route path="automation" element={<Automation />} />
              <Route path="templates" element={<Templates />} />
              <Route path="templates/:id/view" element={<TemplateView />} />
              <Route path="templates/:id/edit" element={<TemplateEdit />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="whatsapp" element={<Whatsapp />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
