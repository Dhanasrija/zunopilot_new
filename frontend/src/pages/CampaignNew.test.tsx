import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CampaignNew from './CampaignNew';

/*
 * **The composer, not the field component.**
 *
 * `VariableFields.test.tsx` proves the control works. It would have gone on passing through
 * the entire production incident, because the bug was not in a control — it was that no
 * control was ever rendered. `CampaignNew` read `template.variables` into its type and never
 * asked for a value, so `variableValues` went to the API as `{}` and Meta rejected every
 * recipient of every template with a placeholder.
 *
 * So these tests drive the page: pick a template, and assert that the placeholder is asked
 * for, that the draft cannot be created until it is answered, and that the answer reaches
 * the request body.
 */

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/customer-lists', () => ({ useCustomerLists: () => ({ data: [] }) }));

const { api } = await import('@/lib/api');

const TEMPLATE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Welcome',
  metaTemplate: 'zunopilot_welcome_v1',
  language: 'en',
  category: 'MARKETING',
  bodyPreview: 'Hi {{1}}, welcome to ZunoPilot!',
  status: 'APPROVED',
  headerFormat: 'NONE',
  headerText: null,
  footerText: null,
  buttons: [],
  variables: ['1'],
  syncedAt: '2026-08-07T11:06:03.401Z',
};

/** The same template with nothing to fill — the case the guard must not block. */
const PLAIN = { ...TEMPLATE, id: '22222222-2222-4222-8222-222222222222', name: 'Plain', variables: [] };

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CampaignNew /></MemoryRouter>
    </QueryClientProvider>,
  );
};

/** Name the campaign and choose a template — the state every test below starts from. */
const compose = async (user: ReturnType<typeof userEvent.setup>, templateId = TEMPLATE.id) => {
  await user.type(screen.getByLabelText('Name'), 'New');
  await waitFor(() => expect(screen.getByLabelText('Template')).toBeInTheDocument());
  await user.selectOptions(screen.getByLabelText('Template'), templateId);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: { data: [TEMPLATE, PLAIN] } } as never);
  vi.mocked(api.post).mockImplementation(((url: string) => {
    if (url === '/campaigns/audience-preview') {
      return Promise.resolve({ data: { data: { reachable: 2, excludedNoConsent: 0 } } });
    }
    return Promise.resolve({ data: { data: { id: 'c1' } } });
  }) as never);
});

describe('composing a campaign with a placeholder', () => {
  it('**asks for the placeholder the template declares**', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user);

    expect(await screen.findByLabelText('Value for {{1}}')).toBeInTheDocument();
  });

  it('**will not create the draft while a placeholder is empty**', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user);
    await screen.findByLabelText('Value for {{1}}');

    expect(screen.getByRole('button', { name: /create draft/i })).toBeDisabled();
    expect(screen.getByText(/Fill \{\{1\}\} before creating the draft/)).toBeInTheDocument();
  });

  it('**sends the value to the API — the field that used to go up empty**', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user);
    await user.type(await screen.findByLabelText('Value for {{1}}'), 'friend');
    await user.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/campaigns', expect.objectContaining({
        templateId: TEMPLATE.id,
        variableValues: { 1: { kind: 'TEXT', value: 'friend' } },
      }));
    });
  });

  it('carries a per-customer choice through to the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user);
    await user.selectOptions(await screen.findByLabelText('What fills {{1}}'), 'customer.name');
    await user.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/campaigns', expect.objectContaining({
        variableValues: { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } },
      }));
    });
  });

  it('**previews the body as the customer will read it**', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user);
    await user.type(await screen.findByLabelText('Value for {{1}}'), 'friend');

    expect(await screen.findByText(/Hi friend, welcome to ZunoPilot!/)).toBeInTheDocument();
  });

  it('forgets the values when the template changes', async () => {
    // "Diwali" carried into a template whose {{1}} is a name would quietly send the wrong
    // word to everybody.
    const user = userEvent.setup();
    renderPage();
    await compose(user);
    await user.type(await screen.findByLabelText('Value for {{1}}'), 'Diwali');

    await user.selectOptions(screen.getByLabelText('Template'), PLAIN.id);
    await user.selectOptions(screen.getByLabelText('Template'), TEMPLATE.id);

    expect(await screen.findByLabelText('Value for {{1}}')).toHaveValue('');
  });

  it('leaves a template with no placeholders immediately creatable', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user, PLAIN.id);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create draft/i })).toBeEnabled();
    });
    expect(screen.queryByLabelText('Value for {{1}}')).not.toBeInTheDocument();
  });
});

describe('the test send', () => {
  it('**is offered once a template is chosen**', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user);

    expect(await screen.findByRole('button', { name: /send a test/i })).toBeInTheDocument();
  });

  it('stays disabled while a placeholder is empty — there would be nothing to learn', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user);

    expect(await screen.findByRole('button', { name: /send a test/i })).toBeDisabled();
  });

  it('**sends the template and values to /campaigns/test**', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user);
    await user.type(await screen.findByLabelText('Value for {{1}}'), 'friend');
    await user.type(screen.getByPlaceholderText('Your own number'), '7702000350');

    await user.click(screen.getByRole('button', { name: /send a test/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/campaigns/test', expect.objectContaining({
        templateId: TEMPLATE.id,
        variableValues: { 1: { kind: 'TEXT', value: 'friend' } },
      }));
    });
  });

  it('does not create a campaign on the way', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user);
    await user.type(await screen.findByLabelText('Value for {{1}}'), 'friend');
    await user.type(screen.getByPlaceholderText('Your own number'), '7702000350');
    await user.click(screen.getByRole('button', { name: /send a test/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/campaigns/test', expect.anything()));
    expect(api.post).not.toHaveBeenCalledWith('/campaigns', expect.anything());
  });
});

describe('editing a draft', () => {
  /*
   * A draft created before the start guard — or by a browser still running an older bundle —
   * arrives with `variableValues: {}` and cannot be started. Without an editor it could never
   * be given values and could never be deleted either, so it sat there refusing to start
   * forever. This is the way out.
   */
  const DRAFT = {
    id: 'c-draft-1',
    name: 'Diwali week',
    status: 'DRAFT',
    templateId: TEMPLATE.id,
    audienceFilter: {},
    variableValues: {},
  };

  const renderEditor = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/campaigns/${DRAFT.id}/edit`]}>
          <Routes>
            <Route path="/campaigns/:campaignId/edit" element={<CampaignNew />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(((url: string) => {
      if (url === `/campaigns/${DRAFT.id}`) {
        return Promise.resolve({ data: { data: { campaign: DRAFT } } });
      }
      return Promise.resolve({ data: { data: [TEMPLATE, PLAIN] } });
    }) as never);
    vi.mocked(api.patch).mockResolvedValue({ data: { data: { id: DRAFT.id } } } as never);
    vi.mocked(api.delete).mockResolvedValue({ data: { data: { id: DRAFT.id } } } as never);
  });

  it('**prefills the draft and asks for the placeholder it is missing**', async () => {
    renderEditor();

    expect(await screen.findByDisplayValue('Diwali week')).toBeInTheDocument();
    expect(await screen.findByLabelText('Value for {{1}}')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /edit draft/i })).toBeInTheDocument();
  });

  it('**PATCHes rather than creating a second campaign**', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(await screen.findByLabelText('Value for {{1}}'), 'friend');
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(`/campaigns/${DRAFT.id}`, expect.objectContaining({
        variableValues: { 1: { kind: 'TEXT', value: 'friend' } },
      }));
    });
    expect(api.post).not.toHaveBeenCalledWith('/campaigns', expect.anything());
  });

  it('will not save while the placeholder is still empty', async () => {
    renderEditor();
    await screen.findByLabelText('Value for {{1}}');
    expect(screen.getByRole('button', { name: /save draft/i })).toBeDisabled();
  });

  it('**deletes the draft, behind a confirmation**', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByDisplayValue('Diwali week');

    await user.click(screen.getByRole('button', { name: /delete draft/i }));
    // One click must not destroy it — the first only asks.
    expect(api.delete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`/campaigns/${DRAFT.id}`));
  });

  it('offers neither editing nor deleting on the create page', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: { data: [TEMPLATE, PLAIN] } } as never);
    renderPage();
    await compose(user);

    expect(screen.queryByRole('button', { name: /delete draft/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create draft/i })).toBeInTheDocument();
  });
});
