import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from 'libphonenumber-js/min';

/**
 * Every dialling country, derived rather than typed out.
 *
 * The contact form used to carry a hand-written list of five: India, the US, the
 * UK, Australia and the UAE. Anyone else had no way to enter their number, and
 * because the dial code is stored joined to the number, an enquiry from a sixth
 * country would have been recorded under the wrong one.
 *
 * Two deliberate choices about where the data comes from:
 *
 *   • **Dial codes from `libphonenumber-js`** (Google's libphonenumber), not a
 *     literal table. A literal table is wrong the moment a country changes its
 *     code, and nobody would notice. The `/min` metadata is imported rather than
 *     `/max` because all we need is calling codes and possible lengths — `/max`
 *     carries pattern data for full validation we deliberately do not do (see
 *     `nationalNumberProblem`).
 *   • **Names from `Intl.DisplayNames`**, which is built into the browser. That
 *     means no second dependency, and the names arrive in the reader's own
 *     language for free rather than being pinned to English.
 *
 * There is no flag emoji here on purpose — brand-guidelines.md §8 keeps emoji out
 * of UI chrome, and a flag is also a poor label for the several territories that
 * share one.
 */
export interface Country {
  /** ISO 3166-1 alpha-2, e.g. `IN`. The stable identity — see the note below. */
  iso: CountryCode;
  /** Dial code including the leading plus, e.g. `+91`. */
  dialCode: string;
  /** Localised country name, e.g. `India`. */
  name: string;
}

/**
 * `Intl.DisplayNames` is in every browser we support, but it throws on an
 * unrecognised region rather than returning nothing, and libphonenumber lists a
 * few territories (`AC`, `TA`) that the CLDR data does not name. Falling back to
 * the ISO code keeps those selectable instead of dropping them.
 */
const nameOf = (() => {
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames(undefined, { type: 'region' });
  } catch {
    display = null;
  }
  return (iso: string): string => {
    try {
      return display?.of(iso) ?? iso;
    } catch {
      return iso;
    }
  };
})();

/** All 245 dialling countries, sorted by localised name. */
export const COUNTRIES: Country[] = getCountries()
  .map((iso) => ({ iso, dialCode: `+${getCountryCallingCode(iso)}`, name: nameOf(iso) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

export const countryByIso = (iso: string): Country | undefined => BY_ISO.get(iso as CountryCode);

/**
 * India, because that is who ZunoPilot sells to.
 *
 * Resolved through the map rather than asserted, so a metadata change that ever
 * dropped `IN` degrades to the first country instead of crashing the page on a
 * non-null assertion.
 */
export const DEFAULT_COUNTRY: Country = BY_ISO.get('IN' as CountryCode) ?? COUNTRIES[0];

/**
 * Which country to preselect, from the browser's own locale.
 *
 * **Only an explicit region moves off India.** This uses `new Intl.Locale(tag).region`
 * and deliberately *not* `.maximize()`, which would infer a region from the language
 * alone and turn a bare `en` browser — very common — into a US default. That is
 * exactly backwards for an India-first product, so an absent region keeps the India
 * default rather than guessing:
 *
 *   | locale  | `.region`      | `.maximize().region` |
 *   |---------|----------------|----------------------|
 *   | `en-US` | `US`           | `US`                 |
 *   | `en-IN` | `IN`           | `IN`                 |
 *   | `en`    | none → India   | `US`  ← wrong        |
 *   | `hi`    | none → India   | `IN`                 |
 *
 * **This is a heuristic on UI language, not on location.** An Indian user with an
 * `en-US` browser gets `+1` preselected and has to change it. That is acceptable
 * precisely because the country is now a visible control one click away — the whole
 * point of replacing the typed `+91 ` prefix. It would *not* be acceptable as the
 * sole source of truth, which is why nothing downstream trusts it: the stored
 * country is still derived from the number the user actually confirms.
 */
export const detectCountry = (): Country => {
  try {
    // `navigator.languages` is ordered by preference. `navigator.language` is the
    // fallback for the rare environment that lacks the list.
    const tags = navigator.languages?.length
      ? navigator.languages
      : [navigator.language].filter(Boolean);

    for (const tag of tags) {
      let region: string | undefined;
      try {
        region = new Intl.Locale(tag).region;
      } catch {
        // A malformed tag in the list must not stop the ones after it.
        continue;
      }
      // Validated, not trusted: `zz-ZZ` yields a region of `ZZ`, which is a
      // well-formed subtag and not a country.
      const found = region ? countryByIso(region) : undefined;
      if (found) return found;
    }
  } catch {
    // No `navigator` (SSR, tests) or no `Intl.Locale`.
  }
  return DEFAULT_COUNTRY;
};

/**
 * How many digits of national number still fit inside E.164's 15-digit total.
 *
 * The form used to cap every number at 15 regardless of country, which let a
 * `+971` number reach 18 digits once joined.
 */
export const nationalDigitLimit = (country: Country): number =>
  15 - (country.dialCode.length - 1);

/**
 * Is this number's length possible for the selected country?
 *
 * **Length only — not pattern validity.** `isValidPhoneNumber` would also check
 * the number against the country's allocation patterns, and would reject numbers
 * that are merely unusual. That is the wrong trade here: this is a sales enquiry
 * form, and the backend deliberately stores a phone it cannot even parse rather
 * than lose a prospect over formatting. Length catches the real mistake — a
 * half-typed number — without turning a lead away.
 *
 * Returns a message to show, or `null` when there is nothing wrong.
 */
export const nationalNumberProblem = (national: string, country: Country): string | null => {
  const digits = national.replace(/\D/g, '');
  if (!digits) return 'Phone number is required';

  switch (validatePhoneNumberLength(digits, { defaultCountry: country.iso })) {
    case 'TOO_SHORT':
      return `That looks too short for ${country.name}`;
    case 'TOO_LONG':
      return `That looks too long for ${country.name}`;
    case 'INVALID_LENGTH':
      return `That is not a valid length for ${country.name}`;
    default:
      // Includes `NOT_A_NUMBER` and `INVALID_COUNTRY`: both mean libphonenumber
      // has no opinion, and no opinion must not become a rejection.
      return null;
  }
};

/**
 * The number to send to the API: dial code and national part, joined.
 *
 * Kept here so every caller joins them the same way. The backend's `normalisePhone`
 * strips everything that is not a digit, so the space and the `+` are for the
 * server log's benefit rather than the parser's — but a single helper means no
 * caller can forget the dial code, which is the mistake that made a US number
 * arrive as `912025550123`.
 */
export const fullNumber = (country: Country, national: string): string =>
  `${country.dialCode} ${national.replace(/\D/g, '')}`.trim();

/**
 * The inverse of `fullNumber`: split a stored number back into country and national
 * part, so a form can be **prefilled** from what is already in the database.
 *
 * Needed because the API stores one flat digit string (`917702000351`) while the
 * picker holds the two halves separately. Without this, prefilling the national field
 * with the whole stored value would send `+91 917702000351` — the dial code twice.
 *
 * Returns `null` when the number cannot be attributed to a country, which the caller
 * must handle rather than guess at: a `+1` number resolves no single country (the
 * NANP is shared by 20-odd territories), so `parsePhoneNumberFromString` reports the
 * national part but no `country`. Falling back to a default there would silently
 * relabel a Canadian number American.
 */
export const splitNumber = (
  stored: string,
): { country: Country; national: string } | null => {
  const digits = stored.replace(/\D/g, '');
  if (!digits) return null;
  try {
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    if (!parsed?.country) return null;
    // **Valid, not merely parseable.** A number stored without its country code still
    // parses: `7702000350` — an Indian mobile saved as ten bare digits — comes back as
    // Kazakhstan, because `+7` is Russia and Kazakhstan. Labelling an Indian customer as
    // Kazakh is worse than showing no country at all, and `isValid()` is what tells the
    // two apart: a real `+91…` number passes, that misread one does not.
    if (!parsed.isValid()) return null;
    const country = countryByIso(parsed.country);
    return country ? { country, national: parsed.nationalNumber } : null;
  } catch {
    return null;
  }
};

/** Match a country on its name, dial code or ISO code, for the picker's search box. */
export const countryMatches = (country: Country, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const bare = q.replace(/^\+/, '');
  return (
    country.name.toLowerCase().includes(q)
    || country.iso.toLowerCase() === q
    || country.dialCode.slice(1).startsWith(bare)
  );
};
