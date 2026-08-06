import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Shared setup for every frontend test.
//
// The jsdom shims below are not incidental — each one exists because a component the suite
// renders reaches for a browser API jsdom does not implement, and the failure is an opaque
// "is not a function" a long way from the cause.

// Radix (dropdown, dialog, select) measures and observes elements it portals.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

globalThis.IntersectionObserver ??= class {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
} as unknown as typeof IntersectionObserver;

// jsdom implements neither, and Radix's popper calls both on open.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= function hasPointerCapture() { return false; };
Element.prototype.setPointerCapture ??= function setPointerCapture() {};
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};

// `matchMedia` is read by the layout's responsive logic.
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof matchMedia;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
