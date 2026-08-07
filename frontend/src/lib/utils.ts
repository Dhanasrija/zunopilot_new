import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge, taught the type scale from §3.2.
 *
 * Without this it silently eats text colours. `text-caption` is ours, not Tailwind's, so
 * tailwind-merge cannot tell it is a font size — it sees a `text-` class, assumes a colour,
 * decides it conflicts with the colour already there, and keeps the last one:
 *
 *   cn('text-on-accent', 'text-caption')  ->  'text-caption'      // colour gone
 *
 * The visible symptom was the current page number in the pagination control: `Button`'s
 * default variant supplies `bg-accent-600 text-on-accent`, the call site adds
 * `h-7 w-7 text-caption`, and the white was dropped — leaving dark text on a solid accent
 * fill. Nothing warned, and the class list looked correct in the source.
 *
 * This is not a one-component problem: `text-caption` alone appears in 70 files, and every
 * one of them is a place a variant's colour could vanish. Naming the scale here fixes all of
 * them at once, and keeps `text-sm` working as the Tailwind built-in it also is.
 *
 * Add any new size token from `tailwind.config.js` to this list too, or it will start
 * deleting colours the day someone uses it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'caption'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatCurrency = (n: number | string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n));

export const formatDateTime = (d: string | Date) => {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * "2h ago". For columns where recency matters more than the exact moment.
 *
 * Lifted out of `pages/Orders.tsx`, where it was private, when the customers table needed
 * the same thing — two implementations of "how long ago" drift, and one of them ends up
 * saying "1 mins ago".
 */
export const timeAgo = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/**
 * Two letters for an avatar. Falls back to the start of the identifier, because an
 * inbound WhatsApp contact may have no profile name at all.
 */
export const initialsOf = (name: string | null | undefined, fallback: string): string => {
  const fromName = (name ?? '').trim();
  if (fromName) {
    return fromName.split(/\s+/).map((part) => part[0]).join('').toUpperCase().slice(0, 2);
  }
  return fallback.replace(/\D/g, '').slice(0, 2) || '??';
};
