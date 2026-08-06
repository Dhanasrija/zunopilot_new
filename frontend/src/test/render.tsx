import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, type RenderOptions } from '@testing-library/react';

// Rendering a component that lives inside the app shell.
//
// Anything reaching for a router hook or a query throws without these providers, and the error
// ("useLocation() may be used only in the context of a Router") points at the component rather
// than at the missing wrapper.

/**
 * A client that never retries and never caches between tests.
 *
 * Retries are the important one: react-query's default is three attempts with backoff, so a
 * component that fetches during a test would keep the suite alive for seconds after the
 * assertion, and a deliberate failure case would take ~5s to arrive rather than none.
 */
export const testQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0, staleTime: Infinity },
    mutations: { retry: false },
  },
});

export const renderInApp = (
  ui: ReactElement,
  { route = '/', ...options }: RenderOptions & { route?: string } = {},
) => {
  const client = testQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      {/* The future flags only silence v7 deprecation warnings, which would otherwise print
          twice per render and bury anything a test actually reports. They do not change
          behaviour the assertions depend on. */}
      <MemoryRouter
        initialEntries={[route]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper, ...options }) };
};
