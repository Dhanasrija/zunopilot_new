import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import Inbox from './Inbox';

/*
 * Telling the server a thread has been read.
 *
 * **The endpoint existed and nothing called it.** `POST /inbox/conversations/:id/read` has been
 * in the API the whole time, so `Conversation.unreadCount` only ever incremented — which turned
 * the badge on every row into a lifetime count of inbound messages, and left the bell holding
 * notifications for threads that had been read hours earlier.
 *
 * Three properties, and only the first is the feature:
 *
 *   1. Opening a thread reports it read, and a new message in the open thread reports it again.
 *   2. **It does not fire on every poll.** The conversation list and the thread both refetch every
 *      second. Without the key on (thread, newest message) this would be one POST per second per
 *      open tab, for as long as an agent left the Inbox open — which is most of the day.
 *   3. **It does not fire while the tab is hidden.** The Inbox polls in the background, so a tab
 *      left open on a thread would swallow every message that arrived overnight: marked read,
 *      notification cleared, nobody told. Being open is not being looked at.
 */

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { api } = await import('@/lib/api');

const CONVERSATION = {
  id: 'c1',
  status: 'OPEN',
  automationPaused: false,
  unreadCount: 3,
  assignedAgent: null,
  customer: { id: 'cust1', name: 'Asha', waId: '15558001234' },
  messages: [],
  activeWorkflowInstance: null,
  lastMessageAt: '2026-08-08T10:00:00.000Z',
};

const message = (id: string) => ({
  id,
  direction: 'INBOUND' as const,
  type: 'TEXT',
  body: 'Do you deliver to Banjara Hills?',
  status: 'RECEIVED',
  createdAt: '2026-08-08T10:00:00.000Z',
  sentByUser: null,
  replyTo: null,
});

/** The thread the fake API will return. Mutated by a test to simulate a new message arriving. */
let thread: ReturnType<typeof message>[] = [];

/** What `document.visibilityState` reports. Not writable, so it is defined over. */
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
};

const renderInbox = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      {/* `useSearchParams` keeps the selected thread in the URL, so a router is required. */}
      <MemoryRouter initialEntries={['/inbox?conversationId=c1']}>
        <Inbox />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** Every POST to the mark-read route. */
const readCalls = () => vi.mocked(api.post).mock.calls
  .filter(([url]) => String(url).endsWith('/read'));

beforeEach(() => {
  vi.clearAllMocks();
  setVisibility('visible');
  thread = [message('m1')];

  useAuthStore.setState({
    token: 't',
    permissions: ['inbox:read', 'inbox:reply', 'inbox:delete'],
    modules: [],
    user: { id: 'u1', fullName: 'Owner', phone: '15559990001', role: 'OWNER' },
  } as never);

  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url.startsWith('/inbox/conversations/c1/messages')) {
      return Promise.resolve({ data: { data: thread } });
    }
    if (url.startsWith('/inbox/conversations')) {
      return Promise.resolve({ data: { data: [CONVERSATION] } });
    }
    if (url === '/media/rules') {
      return Promise.resolve({ data: { data: { maxBytes: 16_000_000, kinds: {}, accept: '' } } });
    }
    if (url === '/team') return Promise.resolve({ data: { data: [] } });
    return Promise.resolve({ data: { data: [] } });
  }) as never);
  vi.mocked(api.post).mockResolvedValue({ data: { data: {} } } as never);
});

afterEach(() => {
  setVisibility('visible');
});

describe('marking a thread read', () => {
  it('**reports the open thread read**', async () => {
    renderInbox();

    // The deep link selects c1, so this needs no click — and that is the case that matters,
    // because an agent arriving from a notification lands here.
    await waitFor(() => expect(readCalls()).toHaveLength(1));
    expect(readCalls()[0][0]).toBe('/inbox/conversations/c1/read');
  });

  it('**does not report it again on every poll**', async () => {
    renderInbox();
    await waitFor(() => expect(readCalls()).toHaveLength(1));

    /*
     * Both queries refetch on a one-second interval. Waiting past two ticks with the thread
     * unchanged is what separates "once per thread" from "once per second forever" — the naive
     * version of this effect passes the test above and fails this one.
     */
    await new Promise((resolve) => { setTimeout(resolve, 2_400); });
    expect(readCalls()).toHaveLength(1);
  });

  it('reports again when a new message lands in the open thread', async () => {
    renderInbox();
    await waitFor(() => expect(readCalls()).toHaveLength(1));

    // The customer writes again while the agent is looking at the thread.
    thread = [message('m1'), message('m2')];

    await waitFor(() => expect(readCalls()).toHaveLength(2), { timeout: 4_000 });
  });

  it('**does not report a read while the tab is hidden**', async () => {
    setVisibility('hidden');
    renderInbox();

    // Long enough for the thread to load and two poll ticks to pass.
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(0));
    await new Promise((resolve) => { setTimeout(resolve, 2_400); });

    expect(readCalls()).toHaveLength(0);
  });

  it('**reports it once the agent comes back to the tab**', async () => {
    /*
     * The other half of the visibility rule, and the one a single check of `visibilityState`
     * would miss: no new message arrives when the agent switches back, so nothing else would
     * re-run the effect and the badge would sit on the thread they are looking at.
     */
    setVisibility('hidden');
    renderInbox();
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(0));
    expect(readCalls()).toHaveLength(0);

    setVisibility('visible');
    // In `act`, because the listener sets state — outside it React warns and the assertion below
    // would be racing the re-render rather than reading it.
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() => expect(readCalls()).toHaveLength(1));
  });
});
