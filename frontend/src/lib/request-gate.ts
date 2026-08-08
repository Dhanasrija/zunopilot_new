/*
 * A gate that closes for the moment between "switching workspace" and the page going away.
 *
 * ── Why this is needed at all ────────────────────────────────────────────────
 *
 * **`window.location.assign` does not stop anything.** Navigation is queued; scripts keep running
 * and timers keep firing until unload. The Inbox polls every second, notifications every fifteen
 * with `refetchIntervalInBackground`, and `api.ts` reads the bearer token from `localStorage` on
 * *every* request. So between writing the new token and the page actually unloading, a poll aimed at
 * the workspace being left is sent with a credential for the workspace being entered.
 *
 * The consequences are not cosmetic. A role that has `inbox:read` in one workspace and not the other
 * makes those polls 403, which toasts; a request that resolves to no membership 401s, and the
 * response interceptor's 401 handler clears the session and redirects to the login screen — so the
 * last thing that happens before a successful switch is being signed out.
 *
 * ── Why a module and not a store field ──────────────────────────────────────
 *
 * `api.ts` already imports the auth store, so the store cannot import `api`. A plain module with no
 * imports of its own can be read by both without a cycle, and needs no React to read it.
 */

let switching = false;

/** Requests still allowed while the gate is closed: the ones that do the switching. */
const ALLOWED = ['/auth/workspaces'];

export const beginSwitch = (): void => { switching = true; };

/**
 * Reopen the gate.
 *
 * Only for a switch that **failed**. A successful one deliberately leaves it closed until the page
 * unloads — there is nothing this document should be asking for any more.
 */
export const endSwitch = (): void => { switching = false; };

export const isSwitching = (): boolean => switching;

/** Whether a request may go out right now. */
export const mayRequest = (url: string | undefined): boolean =>
  !switching || ALLOWED.some((allowed) => (url ?? '').startsWith(allowed));

/**
 * The rejection a blocked request gets.
 *
 * Marked, so the response interceptor can tell it apart from a real failure and stay silent: a
 * fourteen-toast pile-up of cancelled polls is not news about anything.
 */
export interface SwitchAborted { switchAborted: true; message: string }

export const switchAborted = (): SwitchAborted => ({
  switchAborted: true,
  message: 'Cancelled: changing workspace',
});

export const isSwitchAborted = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { switchAborted?: unknown }).switchAborted === true;
