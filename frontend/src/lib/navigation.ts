/**
 * Leaving the app the way a browser does, behind a seam.
 *
 * **Only here so it can be tested.** jsdom cannot navigate — assigning to `window.location` throws
 * "Not implemented" — so any code that calls it directly is code no test can run. Switching
 * workspace is exactly that code, and it is the one action where a full reload is the design rather
 * than a shortcut.
 */
export const hardNavigate = (path: string): void => {
  window.location.assign(path);
};
