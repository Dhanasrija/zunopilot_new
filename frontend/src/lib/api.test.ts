import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import { toast } from 'sonner';
import { api } from './api';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/*
 * How a request body leaves the browser.
 *
 * **The bug this exists for.** The client was created with a default
 * `Content-Type: application/json`. Axios's `transformRequest` reads that header before it
 * looks at the body, and on seeing JSON with a `FormData` payload it calls
 * `JSON.stringify(formDataToJSON(data))` — so an upload went out as `{"file":{}}` with no
 * multipart part at all, and the server replied "No file was uploaded". The message pointed at
 * the caller; the fault was in the client.
 *
 * Driven through a real `api.post` with a capturing adapter, not by inspecting
 * `api.defaults`. A first attempt did the latter and **passed with the bug reinstated** —
 * axios stores a create-time header at the top level of `defaults.headers`, while the helper
 * only read `.common`, so it was asserting on a key that was never going to be there. The
 * adapter sees exactly what would have gone on the wire, and needs no knowledge of where
 * axios keeps things.
 */

/** Send a request that never leaves, and hand back what the adapter was given. */
const captureRequest = async (data: unknown): Promise<InternalAxiosRequestConfig> => {
  let seen: InternalAxiosRequestConfig | null = null;
  await api.post('/anything', data, {
    adapter: async (config) => {
      seen = config;
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    },
  });
  return seen!;
};

const contentTypeOf = (config: InternalAxiosRequestConfig): string =>
  String(config.headers?.['Content-Type'] ?? config.headers?.get?.('Content-Type') ?? '');

describe('uploading a file', () => {
  it('**sends the FormData itself**, so the browser can make it multipart', async () => {
    const form = new FormData();
    form.append('file', new File(['x'], 'invoice.pdf', { type: 'application/pdf' }));

    const sent = await captureRequest(form);

    // With the bug, this was the string '{"file":{}}'.
    expect(sent.data).toBeInstanceOf(FormData);
    expect((sent.data as FormData).get('file')).toBeInstanceOf(File);
  });

  it('does not declare a content type for it', async () => {
    // Nothing declared up front can be right: the multipart boundary is generated per
    // request, so only the browser can write this header correctly.
    const form = new FormData();
    form.append('file', new File(['x'], 'a.png', { type: 'image/png' }));

    expect(contentTypeOf(await captureRequest(form))).not.toContain('application/json');
  });
});

describe('the ordinary case still works', () => {
  it('serialises an object body to JSON and says so', async () => {
    const sent = await captureRequest({ body: 'hello' });
    expect(sent.data).toBe('{"body":"hello"}');
    expect(contentTypeOf(sent)).toContain('application/json');
  });
});

describe('an error that is not ours', () => {
  beforeEach(() => { vi.mocked(toast.error).mockClear(); });

  /** Fail a request the way a server would, with a body and no `message` field. */
  const failWith = async (status: number, data: unknown) => {
    await api.post('/anything', { a: 1 }, {
      adapter: async (config) => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw Object.assign(new Error(`Request failed with status code ${status}`), {
          isAxiosError: true,
          config,
          response: { status, data, statusText: '', headers: {}, config },
        });
      },
    }).catch(() => {});
  };

  it('**turns a bare 413 into something an agent can act on**', async () => {
    /*
     * nginx caps the request body before Express sees it and answers with its own HTML error
     * page — there is no JSON, so there is no `message`. The toast read "Request failed with
     * status code 413" to somebody who had just tried to send a video.
     */
    await failWith(413, '<html><head><title>413 Request Entity Too Large</title></head></html>');

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/too large/i));
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/status code/i));
  });

  it("still prefers the server's own words when it has any", async () => {
    // Our routes do answer with a message, and theirs is more specific than a generic one.
    await failWith(413, { message: 'That file is 42 MB. The limit is 16 MB.' });
    expect(toast.error).toHaveBeenCalledWith('That file is 42 MB. The limit is 16 MB.');
  });
});
