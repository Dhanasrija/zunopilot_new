import * as React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  COUNTRIES, countryMatches, nationalDigitLimit,
  type Country,
} from '@/lib/countries';

// Phone entry: a country picker and a national-number field, side by side.
//
// **The dial code is structural here, and that is the entire point.** What this
// replaces was a single free-text input prefilled with the string `'+91 '`. The
// prefix was really in the field, so a visitor in the US could tap in and type
// `2025550123` over part of it and submit `+91 2025550123` — which `normalisePhone`
// accepts, because 12 digits is inside its 8–15 window. On the sign-in form that did
// not fail: sign-in doubles as sign-up, so it silently created a second user and a
// second workspace tagged `country: IN`. Splitting the two fields makes that class
// of mistake unrepresentable rather than merely unlikely.
//
// The 245-country list, the search predicate and the per-country length rule all
// live in `lib/countries.ts`; this file is only the control.
//
// ── On the near-duplicate in `pages/Contact.tsx` ─────────────────────────────────
// That page has its own copy of this picker and **should keep it.** Contact is on the
// old marketing palette (`slate-*` / `violet-*`) and is listed in `ALLOW.legacy` in
// `scripts/check-brand.mjs`; this file is not, so it is fully gated and must use
// brand tokens. Pointing Contact at this component would either fail the gate or
// change how that page looks. The two converge when the marketing pages get their
// brand phase — the allowlist exists to track exactly that. Please do not "clean this
// up" by merging them before then.

export interface PhoneFieldProps {
  country: Country;
  onCountryChange: (country: Country) => void;
  /** The national part only — no dial code, digits only. */
  value: string;
  onChange: (national: string) => void;
  /** Shown below the field. Sets `aria-invalid`, matching `Input`'s contract. */
  error?: string | null;
  id?: string;
  autoFocus?: boolean;
  placeholder?: string;
}

/**
 * The country list, as a combobox.
 *
 * A native `<select>` was adequate for five hard-coded countries and is the wrong
 * control for 245 — it cannot be searched, and scrolling to Zimbabwe by eye is
 * miserable. Built here rather than taken from a phone-input package because those
 * ship their own stylesheet and flag sprites, which would put a second visual system
 * inside forms that already have one. The *data* is the part worth taking from a
 * library, and it comes from `libphonenumber-js` via `lib/countries.ts`.
 *
 * No flag emoji: brand-guidelines §8 keeps emoji out of UI chrome, and a flag is a
 * poor label for the territories that share one.
 *
 * A custom control has to earn back what `<select>` gave away, so: ↑/↓ move, Enter
 * selects, Escape closes and returns focus to the trigger, typing filters.
 */
function CountrySelect({
  value, onChange, invalid,
}: {
  value: Country;
  onChange: (country: Country) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const matches = React.useMemo(
    () => COUNTRIES.filter((c) => countryMatches(c, query)),
    [query],
  );

  const openList = () => {
    setQuery('');
    // Start on the current selection, so opening and pressing Enter is a no-op
    // rather than a silent change to whichever country sorts first.
    setActive(Math.max(0, COUNTRIES.findIndex((c) => c.iso === value.iso)));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const commit = (country: Country) => {
    onChange(country);
    close();
  };

  React.useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Clicking elsewhere closes. `mousedown` rather than `click`, so the list is gone
  // before a click on whatever is behind it lands.
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row visible as it moves. `nearest` scrolls only when it
  // must, so arrowing through the middle of the list does not jump.
  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Load-bearing: this control lives inside a `<form>`, so without the
      // preventDefault choosing a country submits the form instead.
      e.preventDefault();
      const picked = matches[active];
      if (picked) commit(picked);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country code: ${value.name}, ${value.dialCode}`}
        className={cn(
          'flex h-10 w-28 items-center rounded-md border bg-surface-1 pl-3 pr-8 text-sm text-ink-900',
          'transition-colors duration-micro',
          invalid ? 'border-danger' : 'border-ink-400 focus:border-accent-600',
        )}
      >
        {value.dialCode}
        <span className="ml-1 text-ink-500">{value.iso}</span>
      </button>
      <ChevronDown className="pointer-events-none absolute right-2 top-3 h-4 w-4 text-ink-500" />

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-ink-300 bg-surface-1 shadow-overlay">
          <div className="relative border-b border-ink-300">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder="Search country or code"
              role="combobox"
              aria-expanded
              aria-controls="phone-country-list"
              aria-autocomplete="list"
              aria-activedescendant={matches[active] ? `country-${matches[active].iso}` : undefined}
              className="h-10 w-full bg-transparent pl-8 pr-3 text-sm text-ink-900 outline-none placeholder:text-ink-500"
            />
          </div>

          {matches.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-500">
              No country matches “{query.trim()}”.
            </p>
          ) : (
            <ul
              id="phone-country-list"
              ref={listRef}
              role="listbox"
              aria-label="Country"
              className="max-h-64 overflow-y-auto py-1"
            >
              {matches.map((country, i) => {
                const selected = country.iso === value.iso;
                return (
                  <li key={country.iso}>
                    <button
                      type="button"
                      id={`country-${country.iso}`}
                      role="option"
                      aria-selected={selected}
                      data-active={i === active}
                      // The pointer moves the highlight so mouse and keyboard stay on
                      // the same row — otherwise Enter selects something the user is
                      // not looking at.
                      onMouseEnter={() => setActive(i)}
                      onClick={() => commit(country)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                        i === active && 'bg-accent-100',
                      )}
                    >
                      <span className="w-12 shrink-0 text-ink-500">{country.dialCode}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-900">{country.name}</span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-accent-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function PhoneField({
  country, onCountryChange, value, onChange, error, id, autoFocus, placeholder = 'Mobile number',
}: PhoneFieldProps) {
  const describedBy = error && id ? `${id}-error` : undefined;

  return (
    <>
      <div className="flex gap-2">
        <CountrySelect value={country} onChange={onCountryChange} invalid={!!error} />
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          // Digits only, and capped at what still fits inside E.164 once the dial
          // code is prepended — `nationalDigitLimit` is why a `+971` number can no
          // longer reach 18 digits.
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, nationalDigitLimit(country)))}
          maxLength={nationalDigitLimit(country)}
          className={cn(
            'flex h-10 min-w-0 flex-1 rounded-md border bg-surface-1 px-3 py-2 text-sm text-ink-900',
            'placeholder:text-ink-500 transition-colors duration-micro',
            error ? 'border-danger' : 'border-ink-400 focus:border-accent-600',
          )}
        />
      </div>
      {error && (
        <p id={describedBy} className="text-caption text-danger">
          {error}
        </p>
      )}
    </>
  );
}
