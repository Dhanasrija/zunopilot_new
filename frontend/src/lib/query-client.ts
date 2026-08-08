import { QueryClient } from '@tanstack/react-query';

/**
 * The one query client.
 *
 * It used to be a `const` inside `App.tsx`, which was fine while nothing outside React needed it.
 * Switching workspace does: the cache holds another workspace's customers, orders and conversations
 * under keys that carry no tenant, and it has to be emptied before anything renders.
 *
 * Module scope rather than a provider read, because the switch happens in a plain async function
 * called from a menu item — not in a component, and not somewhere a hook can be called.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});
