import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initAnalytics, trackPageView } from '@/lib/analytics';

/**
 * Send one Google Analytics page view per navigation.
 *
 * A component rather than a call in `main.tsx` because it needs `useLocation`, which only
 * works inside the router. It renders nothing, and it sits next to `ScrollToTop` because both
 * are the same kind of thing: a side effect owed to a route change.
 *
 * The path is redacted inside `trackPageView` — see the header of `lib/analytics.ts` for why
 * that is not optional in this product.
 */
export default function PageViews() {
  const { pathname } = useLocation();

  useEffect(() => { initAnalytics(); }, []);

  useEffect(() => {
    // `initAnalytics` is a no-op off production, and `trackPageView` returns early when gtag
    // was never loaded. So this is safe on localhost without a second condition here that
    // could disagree with the one in the module.
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
