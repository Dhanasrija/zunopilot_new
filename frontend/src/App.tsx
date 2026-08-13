import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
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
 * `ComingSoon` is lazy too. It resolves its own copy from its own table by pathname, so
 * nothing about that table needs to be imported here.
 */
const Features = lazy(() => import('@/pages/Features'));
const Solutions = lazy(() => import('@/pages/Solutions'));
const WhatsAppAutomation = lazy(() => import('@/pages/features/WhatsAppAutomation'));
const AiWhatsAppAutomation = lazy(() => import('@/pages/features/AiWhatsAppAutomation'));
const NumberMasking = lazy(() => import('@/pages/features/NumberMasking'));
// Aliased: `Campaigns` above is the authenticated campaign manager. This is the
// public marketing page for the same feature, and they are different components.
const CampaignsFeature = lazy(() => import('@/pages/features/Campaigns'));
const BusinessApi = lazy(() => import('@/pages/features/BusinessApi'));
const TeamInbox = lazy(() => import('@/pages/features/TeamInbox'));
const ComingSoon = lazy(() => import('@/pages/ComingSoon'));

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
      {/*
        **One place where "prefers-reduced-motion" is honoured for the whole site.**

        `reducedMotion="user"` makes framer-motion drop transform and layout animations for
        anyone whose OS asks for reduced motion, while still applying opacity changes — so a
        scroll-reveal still reveals, it simply does not slide. Doing this here rather than in
        each component is the difference between a setting that works and a setting that
        works on the sections somebody remembered.

        It does not cover animations that loop forever, because framer shortening a transition
        does not stop an infinite repeat. Those check `useReducedMotion()` themselves — see the
        header of `components/marketing/motion-kit.tsx`.
      */}
      <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <ScrollToTop />
        <PageViews />
        <Routes>
          {/* Public Website Routes */}
          <Route path="/" element={<Landing />} />

          {/*
            The features tree — a hub and six detail pages.

            Every one of them is a real, indexable page with copy of its own: there are no
            placeholder routes here, because a placeholder at a URL a search term lands on is
            worse than no page at all.

            Paths are written out literally rather than nested, because
            `document-head.test.ts` greps this file for `path="<canonical>"` to prove the
            canonical, the route and the sitemap agree — for every public page. Nested
            relative segments would defeat that check.
          */}
          <Route path="/features" element={page(<Features />)} />
          <Route path="/features/whatsapp-automation" element={page(<WhatsAppAutomation />)} />
          <Route path="/features/ai-whatsapp-automation" element={page(<AiWhatsAppAutomation />)} />
          <Route path="/features/whatsapp-number-masking" element={page(<NumberMasking />)} />
          <Route path="/features/whatsapp-campaigns" element={page(<CampaignsFeature />)} />
          <Route path="/features/whatsapp-business-api" element={page(<BusinessApi />)} />
          <Route path="/features/whatsapp-team-inbox" element={page(<TeamInbox />)} />
          <Route path="/solutions" element={page(<Solutions />)} />

          {/*
            **The solutions tree, and /industries, are placeholders.**

            The hub and the header dropdown both list these six, so the URLs have to
            resolve — a dropdown with six dead links is worse than no dropdown. Each renders
            `ComingSoon`, which sets `noindex, follow` and no canonical, and none of them
            appears in `PAGE_HEADS` or `sitemap.xml`. That is deliberate and enforced:
            `document-head.test.ts` asserts the heads table and the sitemap are the same
            set, so promoting one of these to a real page means writing copy, adding a head
            and adding a `<loc>` — the test names whichever step is missing.

            The written copy these pages *had* is not deleted; it is still in
            `lib/marketing-content.ts` behind `pages/DetailPage.tsx`, ready to be routed
            again when each page is finished.
          */}
          <Route path="/industries" element={page(<ComingSoon />)} />
          <Route path="/solutions/lead-management" element={page(<ComingSoon />)} />
          <Route path="/solutions/sales-automation" element={page(<ComingSoon />)} />
          <Route path="/solutions/customer-support" element={page(<ComingSoon />)} />
          <Route path="/solutions/marketing-automation" element={page(<ComingSoon />)} />
          <Route path="/solutions/customer-engagement" element={page(<ComingSoon />)} />

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
      </MotionConfig>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
