import { useEffect, useState } from 'react';

/*
 * Load an attachment that needs a bearer token.
 *
 * **Why this exists.** `/api/media/:id/file` is authenticated on purpose — a photograph a
 * customer sent is not something to serve to whoever holds the URL. But a browser sends no
 * `Authorization` header for `<img src>`, `<video src>` or a plain link, so putting the path
 * straight into those elements gets a 401 and renders as a broken file every time. The bytes
 * have to be fetched with the token and turned into an object URL.
 *
 * Deliberately `fetch`, not the shared axios client. That client toasts every 4xx and signs
 * you out on a 401 — behaviour that is right for a form submission and wrong for an image: a
 * thread with three unfetchable files would raise three toasts, and one expired request would
 * throw the agent back to the login screen mid-conversation.
 */

const base = (): string => import.meta.env.VITE_API_BASE_URL || '/api';

/** Strip the `/api` the server stored, so the base URL is not applied twice. */
const pathOf = (mediaUrl: string): string => `${base()}${mediaUrl.replace(/^\/api/, '')}`;

export interface AuthedMedia {
  /** An object URL, once the bytes have arrived. */
  url: string | null;
  loading: boolean;
  failed: boolean;
}

export const useAuthedMedia = (mediaUrl: string | null | undefined): AuthedMedia => {
  const [state, setState] = useState<AuthedMedia>({ url: null, loading: !!mediaUrl, failed: false });

  useEffect(() => {
    if (!mediaUrl) {
      setState({ url: null, loading: false, failed: false });
      return;
    }

    let live = true;
    let objectUrl: string | null = null;
    setState({ url: null, loading: true, failed: false });

    const token = localStorage.getItem('token');
    fetch(pathOf(mediaUrl), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, failed: false });
      })
      .catch(() => {
        if (live) setState({ url: null, loading: false, failed: true });
      });

    return () => {
      live = false;
      // Revoked on unmount: an inbox left open all day scrolls through hundreds of these, and
      // an object URL holds its blob in memory until it is released.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaUrl]);

  return state;
};
