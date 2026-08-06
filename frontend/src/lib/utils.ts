import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
