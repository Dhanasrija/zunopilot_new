import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MediaAttachment, hasAttachment } from './MediaAttachment';
import type { Message } from './types';

/*
 * Showing a file in the thread.
 *
 * **The bug these exist for.** `/api/media/:id/file` is authenticated, and a browser sends no
 * `Authorization` header for `<img src>`. Putting the path straight into the element — which
 * is what shipped first — got a 401 for every attachment, so an agent saw a broken image on
 * every photograph a customer had sent. The bytes have to be fetched with the token first.
 */

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  direction: 'INBOUND',
  type: 'IMAGE',
  body: '[photo]',
  mediaUrl: '/api/media/abc/file',
  createdAt: new Date().toISOString(),
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem('token', 'tok-123');
  URL.createObjectURL = vi.fn(() => 'blob:object-url');
  URL.revokeObjectURL = vi.fn();
  fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('fetching the bytes', () => {
  it('**sends the bearer token**, which an `img src` never would', async () => {
    render(<MediaAttachment message={message()} outbound={false} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('does not apply the api base twice', async () => {
    // The server stores `/api/media/:id/file`, and the client's base is already `/api`.
    render(<MediaAttachment message={message()} outbound={false} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain('/api/api/');
    expect(url).toContain('/media/abc/file');
  });

  it('renders the image from the fetched blob, not from the private path', async () => {
    render(<MediaAttachment message={message()} outbound={false} />);

    const img = await screen.findByRole('img', { name: /photo/i });
    expect(img).toHaveAttribute('src', 'blob:object-url');
  });
});

describe('when the file cannot be fetched', () => {
  it('**says so rather than showing nothing**', async () => {
    // The customer believes they sent it. An empty bubble tells the agent nothing went wrong.
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    render(<MediaAttachment message={message({ type: 'DOCUMENT', body: null })} outbound={false} />);

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });

  it('does not sign the agent out on a 401', async () => {
    // Deliberately `fetch` rather than the shared axios client: that one clears the session
    // and redirects on any 401, so one stale image would eject someone mid-conversation.
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    render(<MediaAttachment message={message()} outbound={false} />);

    await screen.findByText(/could not be loaded/i);
    expect(localStorage.getItem('token')).toBe('tok-123');
  });
});

describe('what counts as an attachment', () => {
  it('needs both a url and a type that can hold a file', () => {
    expect(hasAttachment(message())).toBe(true);
    expect(hasAttachment(message({ mediaUrl: null }))).toBe(false);
    // A text message with a stray url is not an attachment.
    expect(hasAttachment(message({ type: 'TEXT' }))).toBe(false);
  });

  it('covers all four kinds, in both directions', () => {
    for (const type of ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']) {
      expect(hasAttachment(message({ type })), type).toBe(true);
      expect(hasAttachment(message({ type, direction: 'OUTBOUND' })), type).toBe(true);
    }
  });
});

describe('releasing the blob', () => {
  it('revokes the object url on unmount, so a long session does not leak', async () => {
    const { unmount } = render(<MediaAttachment message={message()} outbound={false} />);
    await screen.findByRole('img', { name: /photo/i });

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:object-url');
  });
});
