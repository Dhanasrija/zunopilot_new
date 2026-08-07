import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ModuleKey } from '@/stores/auth.store';
import { useAuthStore } from '@/stores/auth.store';
import Automation from './Automation';

/*
 * Auto-replies.
 *
 * Two things are being pinned here.
 *
 * **The asymmetry.** `KEYWORD_RULES` gates the keyword rules and deliberately not the fallback
 * message. A workspace with the module revoked must still be able to edit what a customer gets
 * when nothing matched — the complaint this whole change came from was a seeded restaurant line
 * ("Type 'Menu' to order") sitting on a business that does not take orders, with nowhere in the
 * product to change it.
 *
 * **The page was never reachable.** It existed and was routed, but was absent from the sidebar,
 * so nobody found it and nothing tested it. It had no edit affordance, no visible priority, and
 * a fallback box that synced during render and so never re-synced after a refetch.
 */

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { api } = await import('@/lib/api');

const RULES = [
  { id: 'r1', keywords: ['hours', 'open'], response: 'We are open 11am to 11pm.', isActive: true, priority: 100 },
  { id: 'r2', keywords: ['parking'], response: 'Free parking behind the building.', isActive: false, priority: 50 },
];

const signIn = (modules: ModuleKey[]) => useAuthStore.setState({
  token: 't', permissions: ['automation:write'], modules,
});

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Automation /></QueryClientProvider>);
};

/** The row for a rule, found by the keywords cell. */
const rowFor = (keywords: string) =>
  screen.getByText(keywords).closest('tr') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  signIn(['KEYWORD_RULES']);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === '/automation/keywords') return Promise.resolve({ data: { data: RULES } });
    return Promise.resolve({ data: { data: { response: 'Sorry, I did not catch that.' } } });
  }) as never);
  vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
  vi.mocked(api.patch).mockResolvedValue({ data: {} } as never);
  vi.mocked(api.delete).mockResolvedValue({ data: {} } as never);
  vi.mocked(api.put).mockResolvedValue({ data: {} } as never);
});

describe('keyword rules', () => {
  it('lists them with the order that decides which one wins', async () => {
    renderPage();
    expect(await screen.findByText('hours, open')).toBeInTheDocument();
    // Priority is what breaks a tie between two matching rules, and it used to be invisible —
    // the field was in the type and rendered nowhere.
    expect(within(rowFor('hours, open')).getByText('100')).toBeInTheDocument();
  });

  it('adds one', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('hours, open');

    await user.type(screen.getByLabelText('Keywords'), 'delivery, deliver');
    await user.type(screen.getByLabelText('Reply'), 'We deliver within 6km.');
    await user.click(screen.getByRole('button', { name: /add rule/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/automation/keywords', {
        keywords: ['delivery', 'deliver'],
        response: 'We deliver within 6km.',
      });
    });
  });

  it('**toggles one without resending the whole rule**', async () => {
    // The API used to demand `keywords` and `response` on a PATCH, so the page read the row out
    // of its own cache and wrote it all back to flip a switch. Two people editing one rule and
    // the toggle silently reverts the other's wording.
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('hours, open');

    await user.click(within(rowFor('hours, open')).getByRole('switch'));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/automation/keywords/r1', { isActive: false });
    });
  });

  it('**edits a reply in place**, which previously meant delete and retype', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('parking');

    await user.click(screen.getByRole('button', { name: /edit parking/i }));
    const reply = screen.getByLabelText('Reply for parking');
    await user.clear(reply);
    await user.type(reply, 'Parking is free after 6pm.');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/automation/keywords/r2', {
        keywords: ['parking'],
        response: 'Parking is free after 6pm.',
        priority: 50,
      });
    });
  });

  it('abandons an edit on Escape', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('parking');

    await user.click(screen.getByRole('button', { name: /edit parking/i }));
    await user.type(screen.getByLabelText('Order for parking'), '{Escape}');

    expect(screen.queryByLabelText('Reply for parking')).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('deletes one', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('parking');

    await user.click(screen.getByRole('button', { name: /delete parking/i }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/automation/keywords/r2'));
  });

  it('says so when there are none, rather than showing an empty table', async () => {
    vi.mocked(api.get).mockImplementation(((url: string) => (url === '/automation/keywords'
      ? Promise.resolve({ data: { data: [] } })
      : Promise.resolve({ data: { data: null } }))) as never);
    renderPage();

    expect(await screen.findByText(/No rules yet/i)).toBeInTheDocument();
  });
});

describe('with the module switched off', () => {
  beforeEach(() => signIn([]));

  it('**hides the keyword rules and does not ask the server for them**', async () => {
    // The route 404s by design without the module. Fetching anyway would fire the axios
    // interceptor's error toast on every page load.
    renderPage();
    await screen.findByLabelText('Fallback message');

    expect(screen.queryByLabelText('Keywords')).not.toBeInTheDocument();
    expect(screen.getByText(/Keyword replies are switched off/i)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/automation/keywords');
  });

  it('**still lets the workspace edit the fallback** — the whole point of the asymmetry', async () => {
    const user = userEvent.setup();
    renderPage();

    const box = await screen.findByLabelText('Fallback message');
    // Wait for the server value to land before typing: the box is rendered empty and filled by
    // an effect, so editing first would be overwritten the moment the query resolves.
    await waitFor(() => expect(box).toHaveValue('Sorry, I did not catch that.'));
    await user.clear(box);
    await user.type(box, 'A colleague will reply shortly.');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/automation/fallback', {
        response: 'A colleague will reply shortly.',
      });
    });
  });
});

describe('the fallback box', () => {
  it('shows what the server has', async () => {
    renderPage();
    const box = await screen.findByLabelText('Fallback message');
    await waitFor(() => expect(box).toHaveValue('Sorry, I did not catch that.'));
  });

  it('**re-syncs when the server value changes**', async () => {
    // It used to sync during render, guarded on the draft being empty — so it latched onto the
    // first value it saw and never updated, and clearing the field to empty re-populated it
    // because empty doubled as "not loaded yet".
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><Automation /></QueryClientProvider>);
    await screen.findByLabelText('Fallback message');

    vi.mocked(api.get).mockImplementation(((url: string) => (url === '/automation/keywords'
      ? Promise.resolve({ data: { data: RULES } })
      : Promise.resolve({ data: { data: { response: 'Changed elsewhere.' } } }))) as never);
    await qc.invalidateQueries({ queryKey: ['fallback'] });

    await waitFor(() => {
      expect(screen.getByLabelText('Fallback message')).toHaveValue('Changed elsewhere.');
    });
  });

  it('will not save an empty message', async () => {
    const user = userEvent.setup();
    renderPage();

    const box = await screen.findByLabelText('Fallback message');
    await waitFor(() => expect(box).toHaveValue('Sorry, I did not catch that.'));
    await user.clear(box);

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });
});
