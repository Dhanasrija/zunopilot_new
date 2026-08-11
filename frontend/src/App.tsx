import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { Toaster } from 'sonner';
import { Loader2 } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from '@/components/layout/ProtectedRoute';
import Login from '@/pages/Login';
import SupportSession from './pages/SupportSession';
import NotFound from './pages/NotFound';
import Onboarding from '@/pages/Onboarding';
import Dashboard from '@/pages/Dashboard';
import Inbox from '@/pages/Inbox';
import Orders from '@/pages/Orders';
import OrderDetails from '@/pages/OrderDetails';
import Menu from '@/pages/Menu';
import Leads from './pages/Leads';
import Tickets from './pages/Tickets';
import Campaigns from './pages/Campaigns';
import CampaignNew from './pages/CampaignNew';
import CampaignDetail from './pages/CampaignDetail';
import TicketDetail from './pages/TicketDetail';
import LeadDetail from './pages/LeadDetail';
import RequireCapability from './components/layout/RequireCapability';
import Customers from '@/pages/Customers';
import Workflows from '@/pages/Workflows';
import Assistants from '@/pages/Assistants';
import Connectors from '@/pages/Connectors';
import Team from '@/pages/Team';
import Roles from '@/pages/Roles';
import Billing from '@/pages/Billing';
import Pricing from '@/pages/Pricing';
import InvoiceView from '@/pages/InvoiceView';
import AssistantRouting from '@/pages/AssistantRouting';
import EngineWorkflows from '@/pages/EngineWorkflows';
import Automation from '@/pages/Automation';
import Knowledge from '@/pages/Knowledge';
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
import PageViews from '@/components/layout/PageViews';

// Split out: React Flow is a large dependency and only the canvas needs it, so
// everyone who never opens a workflow avoids paying for it.
const WorkflowCanvas = lazy(() => import('@/pages/WorkflowCanvas'));
const WorkflowBuilder = lazy(() => import('@/pages/WorkflowBuilder'));

/*
 * The marketing pages below the home page, split out for the same reason.
 *
 * They are long — several thousand words of copy each — and almost nobody who lands on
 * `/` reads all of them. Bundled into the entry chunk they would be dead weight on the
 * one page whose LCP actually matters. `Landing` itself stays eager, because it *is*
 * the landing page and a suspense flash there is the thing we are trying to avoid.
 *
 * `DetailPage` is lazy too. It resolves its own copy from `lib/marketing-content.ts` by
 * pathname, so nothing about that table needs to be imported here.
 */
const Features = lazy(() => import('@/pages/Features'));
const Solutions = lazy(() => import('@/pages/Solutions'));
const WhatsAppAutomation = lazy(() => import('@/pages/features/WhatsAppAutomation'));
const AiWhatsAppAutomation = lazy(() => import('@/pages/features/AiWhatsAppAutomation'));
const DetailPage = lazy(() => import('@/pages/DetailPage'));

/** Full-height spinner, so a lazy marketing page does not collapse the layout while it loads. */
const PageFallback = (
  <div className="grid min-h-screen place-items-center">
    <Loader2 className="h-6 w-6 animate-spin text-accent-600" />
  </div>
);

const page = (element: React.ReactNode) => <Suspense fallback={PageFallback}>{element}</Suspense>;

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <PageViews />
        <Routes>
          {/* Public Website Routes */}
          <Route path="/" element={<Landing />} />

          {/*
            The features and solutions trees — two hubs and thirteen detail pages.

            The two longest detail pages have components of their own; the other eleven
            share `DetailPage`, which renders from the copy in `lib/marketing-content.ts`.
            Every one of them is a real, indexable page: there are no placeholder routes
            here, because a placeholder at a URL a search term lands on is worse than no
            page at all.

            Paths are written out literally rather than nested, because
            `document-head.test.ts` greps this file for `path="<canonical>"` to prove the
            canonical, the route and the sitemap agree — for all twenty public pages.
            Nested relative segments would defeat that check.
          */}
          <Route path="/features" element={page(<Features />)} />
          <Route path="/features/whatsapp-automation" element={page(<WhatsAppAutomation />)} />
          <Route path="/features/ai-whatsapp-automation" element={page(<AiWhatsAppAutomation />)} />
          <Route path="/solutions" element={page(<Solutions />)} />

          {/*
            **Written out one per line rather than mapped over `DETAIL_PAGES`, on purpose.**

            `document-head.test.ts` proves the canonical, the route and the sitemap agree
            by searching this file for the literal `path="<canonical>"` of every entry in
            `PAGE_HEADS`. A `.map()` produces the same routes at runtime and *no such
            string in the source*, so the check silently passes on nothing — which is
            exactly the class of bug it was written to catch. Eleven repetitive lines are
            the price of keeping the assertion real.

            `DETAIL_PAGES` is still the source of the copy and of `DETAIL_BY_PATH`; a route
            added here without an entry there renders `NotFound`, and an entry there
            without a route here fails the test above. Both directions are covered.
          */}
          <Route path="/features/shared-whatsapp-portal" element={page(<DetailPage />)} />
          <Route path="/features/whatsapp-number-masking" element={page(<DetailPage />)} />
          <Route path="/features/whatsapp-campaigns" element={page(<DetailPage />)} />
          <Route path="/features/whatsapp-team-inbox" element={page(<DetailPage />)} />
          <Route path="/whatsapp-business-api" element={page(<DetailPage />)} />
          <Route path="/industries" element={page(<DetailPage />)} />
          <Route path="/solutions/lead-management" element={page(<DetailPage />)} />
          <Route path="/solutions/sales-automation" element={page(<DetailPage />)} />
          <Route path="/solutions/customer-support" element={page(<DetailPage />)} />
          <Route path="/solutions/marketing-automation" element={page(<DetailPage />)} />
          <Route path="/solutions/customer-engagement" element={page(<DetailPage />)} />

          <Route path="/pricing" element={<Pricing />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/login" element={<Login />} />
          {/* Where an approved, read-only support session lands. Public because
              the token in the fragment is the credential. */}
          <Route path="/support-session" element={<SupportSession />} />
          {/* Signing up and signing in are one flow now: a phone number either has
              an account or gets one, so /signup only ever meant "the login page". */}
          <Route path="/signup" element={<Navigate to="/login" replace />} />
          {/* The profile form, shown when the server says onboarding is unfinished. */}
          <Route path="/onboarding" element={<Onboarding />} />

          {/* Protected Application Routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="inbox" element={<Inbox />} />
              {/* Selling. Behind the module gate as well as the permission, so a workspace
                  that does not sell cannot reach these from a typed URL or a bookmark saved
                  before it was switched off. The API refuses them independently. */}
              <Route element={<RequireCapability module="ECOMMERCE" permission="orders:read" />}>
                <Route path="orders" element={<Orders />} />
                <Route path="orders/:id" element={<OrderDetails />} />
              </Route>
              <Route element={<RequireCapability module="ECOMMERCE" permission="catalogue:read" />}>
                <Route path="catalogue" element={<Menu />} />
              </Route>
              {/* The old path. A staff bookmark or a link in a past support conversation should
                  land on the page, not on a 404, and this costs one line to guarantee. */}
              <Route path="menu" element={<Navigate to="/catalogue" replace />} />
              <Route path="customers" element={<Customers />} />
              {/* Module 20: leads. Behind the module gate as well as the
                  permission, so a workspace that was never given Leads cannot
                  reach the page from a typed URL or a stale bookmark. */}
              <Route element={<RequireCapability module="LEADS" permission="leads:read" />}>
                <Route path="leads" element={<Leads />} />
                <Route path="leads/:leadId" element={<LeadDetail />} />
              </Route>
              {/* Module 21: customer support. */}
              <Route element={<RequireCapability module="SUPPORT" permission="tickets:read" />}>
                <Route path="tickets" element={<Tickets />} />
                <Route path="tickets/:ticketId" element={<TicketDetail />} />
              </Route>
              {/* Module 22: marketing. */}
              <Route element={<RequireCapability module="MARKETING" permission="campaigns:read" />}>
                <Route path="campaigns" element={<Campaigns />} />
                {/* Before `:campaignId`, or "new" is matched as a campaign id. */}
                <Route path="campaigns/new" element={<CampaignNew />} />
                {/* The composer doubles as the draft editor — same decisions, one screen. */}
                <Route path="campaigns/:campaignId/edit" element={<CampaignNew />} />
                <Route path="campaigns/:campaignId" element={<CampaignDetail />} />
              </Route>
              <Route path="workflows" element={<Workflows />} />
              <Route path="assistants" element={<Assistants />} />
              <Route path="connectors" element={<Connectors />} />
              <Route path="team" element={<Team />} />
              <Route path="roles" element={<Roles />} />
              <Route path="billing" element={<Billing />} />
              <Route path="assistants/:assistantId/routing" element={<AssistantRouting />} />
              <Route path="assistants/:assistantId/workflows" element={<EngineWorkflows />} />
              {/* Permission only, no module: `KEYWORD_RULES` gates the keyword half inside the
                  page, and the fallback message belongs to every workspace. */}
              <Route element={<RequireCapability permission="automation:write" />}>
                <Route path="automation" element={<Automation />} />
                <Route path="knowledge" element={<Knowledge />} />
              </Route>
              <Route path="templates" element={<Templates />} />
              <Route path="templates/:id/view" element={<TemplateView />} />
              <Route path="templates/:id/edit" element={<TemplateEdit />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="whatsapp" element={<Whatsapp />} />
              <Route path="settings" element={<Settings />} />
            </Route>

            {/* The canvas owns the full main area — same shell, no page padding. */}
            <Route element={<AppLayout fullBleed />}>
              <Route
                path="workflows/:id"
                element={(
                  <Suspense fallback={(
                    <div className="grid h-full place-items-center">
                      <Loader2 className="h-6 w-6 animate-spin text-accent-600" />
                    </div>
                  )}>
                    <WorkflowBuilder />
                  </Suspense>
                )}
              />
              {/* The Module 11 canvas, kept reachable while the legacy
                  Workflows list still points at graphs in the old format. */}
              <Route
                path="legacy-workflows/:id"
                element={(
                  <Suspense fallback={(
                    <div className="grid h-full place-items-center">
                      <Loader2 className="h-6 w-6 animate-spin text-accent-600" />
                    </div>
                  )}>
                    <WorkflowCanvas />
                  </Suspense>
                )}
              />
            </Route>

            {/* Authenticated but chrome-free, so it prints as a document. */}
            <Route path="/invoices/:invoiceId" element={<InvoiceView />} />
          </Route>

          {/*
            A real page, not `<Navigate to="/" replace />`. That silently turned every unknown
            URL into the home page — no explanation for the visitor, no way back to the address
            they typed, and a soft 404 for Google. See the header of NotFound.tsx.
          */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
