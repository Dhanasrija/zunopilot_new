import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth.store';
import { isSwitchAborted, mayRequest, switchAborted } from '@/lib/request-gate';

/*
 * **No default `Content-Type`, and that is load-bearing.**
 *
 * It used to be `application/json`, which silently broke every file upload. Axios's
 * `transformRequest` reads the header first: seeing `application/json` on a `FormData` body it
 * runs `JSON.stringify(formDataToJSON(data))` instead of sending multipart, so the request
 * left the browser as `{"file":{}}` and the server answered "No file was uploaded" — a
 * message that points at the caller when the fault was here.
 *
 * Nothing is lost by omitting it: axios sets `application/json` itself for any object payload,
 * and lets the browser set `multipart/form-data` with its boundary for a `FormData` one. A
 * boundary is generated per request, so it is not something a default header could ever
 * declare correctly anyway.
 */
/*
 * A caller that deals with its own 401.
 *
 * The default below is right for almost everything: a 401 means the session is finished, so clear it
 * and go to the login screen. It is wrong for the one caller that can *recover* from a 401 — a
 * session whose workspace membership was revoked while its identity is still perfectly good. Clearing
 * first would remove the very token the recovery needs, and dump somebody removed from a side project
 * onto the OTP screen to reach the business they run.
 *
 * Declared on the axios config rather than sniffed from the URL, so opting out is a decision the
 * caller states.
 */
declare module 'axios' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  export interface AxiosRequestConfig {
    /** Skip the global sign-out on 401; this caller handles it. */
    handles401?: boolean;
  }
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

api.interceptors.request.use((config) => {
  /*
   * Nothing goes out during a workspace switch except the switch itself.
   *
   * The token is read from `localStorage` on every request, so a poll that fires after the new token
   * is written would carry it to a page still showing the old workspace — 403s where the new role is
   * narrower, and a 401 below signs the person out of the switch they just completed. See
   * `request-gate.ts`.
   */
  if (!mayRequest(config.url)) return Promise.reject(switchAborted());

  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ message?: string }>) => {
    /*
     * A request the gate refused. Silent by design — it was cancelled by us, on purpose, and the
     * user is already watching the page reload into another workspace.
     *
     * First, before the 401 branch: a blocked request has no response at all, so falling through
     * would only produce a generic toast, but the ordering is what makes that guaranteed rather
     * than incidental.
     */
    if (isSwitchAborted(error)) return Promise.reject(error);

    const status = error.response?.status;
    /*
     * A 413 usually is not ours. nginx caps the request body before Express sees it and
     * answers with its own HTML error page, so there is no `message` to read and the toast
     * said "Request failed with status code 413" — a number, to somebody who wanted to send a
     * video. The server's own refusals do carry a message and still win.
     */
    const tooLarge = status === 413
      ? 'That file is too large to upload. Videos and documents are limited to 16 MB.'
      : null;
    const msg = error.response?.data?.message || tooLarge || error.message || 'Request failed';
    if (status === 401 && error.config?.handles401) {
      // Theirs to handle. Not even a toast: the caller knows what this means and what to say.
      return Promise.reject(error);
    }
    if (status === 401) {
      useAuthStore.getState().clear();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    } else if (status && status >= 400) {
      toast.error(msg);
    }
    return Promise.reject(error);
  }
);
