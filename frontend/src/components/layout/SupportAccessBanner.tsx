import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye, ShieldAlert } from 'lucide-react';

// A live support session, on every screen.
//
// Deliberately not confined to the billing page. If someone outside the business
// is reading this workspace's conversations right now, that is not a fact to leave
// on a settings tab the owner might not open for a week — it belongs above
// whatever they are looking at, for as long as it is true.
//
// A pending request gets the same treatment, because an unanswered request that
// nobody notices is how consent quietly becomes a formality.

interface Grant {
  id: string;
  status: string;
  active: boolean;
  approvedUntil: string | null;
  requestedBy: { name: string } | null;
}

export default function SupportAccessBanner() {
  const { data } = useQuery({
    queryKey: ['support-access'],
    queryFn: () => import('@/lib/api').then(({ api }) => api
      .get<{ data: { grants: Grant[] } }>('/support-access')
      .then((r) => r.data.data)),
    refetchInterval: 60_000,
    // Never let this break a page. Failing to render the banner is bad; failing
    // to render the app because the banner errored is worse.
    retry: false,
  });

  const grants = data?.grants ?? [];
  const active = grants.find((g) => g.active);
  const pending = grants.find((g) => g.status === 'PENDING');

  if (active) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-accent-100 bg-accent-100 px-4 py-2">
        <Eye className="h-3.5 w-3.5 shrink-0 text-accent-700" />
        <p className="text-caption text-accent-700">
          <strong>{active.requestedBy?.name ?? 'ZunoPilot support'}</strong> is viewing your workspace
          read-only
          {active.approvedUntil && ` until ${new Date(active.approvedUntil).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
          . They cannot change anything.
        </p>
        <Link to="/billing" className="ml-auto text-caption font-medium text-accent-700 underline">
          End it or see what they opened
        </Link>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-ink-900" />
        <p className="text-caption text-ink-900">
          <strong>{pending.requestedBy?.name ?? 'ZunoPilot support'}</strong> has asked to view your
          workspace.
        </p>
        <Link to="/billing" className="ml-auto text-caption font-medium text-ink-900 underline">
          Review the request
        </Link>
      </div>
    );
  }

  return null;
}
