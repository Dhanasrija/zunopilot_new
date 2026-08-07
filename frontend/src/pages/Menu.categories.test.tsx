import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoriesTab } from './Menu';

/*
 * "The Add Category button got disabled" — reported as a fault.
 *
 * It was not one. The button is disabled while the field is empty, which is correct, and the
 * API works: a POST to /catalogue/categories returns 201 in production. But nothing in the
 * suite covered the one thing that would distinguish "waiting for input" from "broken", which
 * is whether typing a name actually enables the control and whether clicking it sends the
 * request. That gap is why the question could not be answered by reading the code.
 */

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { api } = await import('@/lib/api');

const renderTab = (categories: Parameters<typeof CategoriesTab>[0]['categories'] = []) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CategoriesTab label="Product category" categories={categories} isLoading={false} qc={qc} />
    </QueryClientProvider>,
  );
};

describe('adding a category', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables Add while the field is empty — the state that was mistaken for a fault', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
  });

  it('**enables Add as soon as a name is typed**', async () => {
    const user = userEvent.setup();
    renderTab();
    const add = screen.getByRole('button', { name: /add/i });

    await user.type(screen.getByPlaceholderText('New product category name'), 'Beverages');

    expect(add).toBeEnabled();
  });

  it('**posts the new category when Add is clicked**', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.type(screen.getByPlaceholderText('New product category name'), 'Beverages');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/catalogue/categories', { name: 'Beverages' });
    });
  });

  it('submits on Enter too, so the button is not the only way through', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.type(screen.getByPlaceholderText('New product category name'), 'Snacks{Enter}');

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/catalogue/categories', { name: 'Snacks' });
    });
  });

  it('clears the field after a successful add, ready for the next one', async () => {
    const user = userEvent.setup();
    renderTab();
    const field = screen.getByPlaceholderText('New product category name');

    await user.type(field, 'Bakery');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => expect(field).toHaveValue(''));
  });

  it('sends nothing when the field is empty', async () => {
    const user = userEvent.setup();
    renderTab();

    // Clicking a disabled button is a no-op, but assert the request specifically: the bug
    // being ruled out is "the click does nothing", and only the absence of a POST says that.
    await user.click(screen.getByRole('button', { name: /add/i }));

    expect(api.post).not.toHaveBeenCalled();
  });
});
