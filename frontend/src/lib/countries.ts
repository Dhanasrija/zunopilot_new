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
 * Where the person is, for the zones where the UI language reliably lies about it.
 *
 * **Deliberately short, and it is not trying to be a timezone database.** Its only
 * job is to beat `navigator.language` in the places where the two disagree for a
 * predictable reason: an English-language device used somewhere that is not an
 * English-speaking country. Every entry below is a single-country zone in a market
 * where `en-US` or `en-GB` is a normal thing to find on a phone. An unlisted zone
 * falls through to the language, exactly as before.
 *
 * `Intl.Locale.prototype.getTimeZones` would make this derivable rather than typed
 * out — it is the reverse lookup this needs — but it is not in the browsers we
 * support yet, so the list is written down and kept small on purpose. Prefer adding
 * a zone here over broadening the mechanism.
 */
const ZONE_COUNTRY: Record<string, string> = {
  // `Asia/Calcutta` is the older alias and is still what many systems report —
  // this Mac reports it. Both must be present or the entry does nothing.
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'Asia/Colombo': 'LK',
  'Asia/Kathmandu': 'NP',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Qatar': 'QA',
  'Asia/Kuwait': 'KW',
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Manila': 'PH',
  'Asia/Jakarta': 'ID',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'Africa/Johannesburg': 'ZA',
};

/**
 * Which country to preselect.
 *
 * **The timezone is asked first, because it is the only signal here about where the
 * person actually is.** `navigator.language` describes what language they want to
 * read, and treating it as a location is how the owner of an India-first product
 * running an `en-US` Mac got `+1` preselected, entered a ten-digit Indian number,
 * and — because signing in doubles as signing up — created an empty second
 * workspace instead of reaching his own. The locale said `US`; the clock said
 * `Asia/Calcutta`. The clock was right.
 *
 * So the order is: timezone (if it is one we claim), then an explicit locale region,
 * then India.
 *
 * The locale step uses `new Intl.Locale(tag).region` and deliberately *not*
 * `.maximize()`, which would infer a region from the language alone and turn a bare
 * `en` browser — very common — into a US default:
 *
 *   | locale  | `.region`      | `.maximize().region` |
 *   |---------|----------------|----------------------|
 *   | `en-US` | `US`           | `US`                 |
 *   | `en-IN` | `IN`           | `IN`                 |
 *   | `en`    | none → India   | `US`  ← wrong        |
 *   | `hi`    | none → India   | `IN`                 |
 *
 * **Still a guess, and still not trusted downstream.** A traveller gets the country
 * they are standing in rather than the one they dial from, which is why the picker
 * stays a visible control and why the stored country is derived from the number the
 * person actually confirms — never from this.
 */
export const detectCountry = (): Country => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fromZone = zone ? ZONE_COUNTRY[zone] : undefined;
    const found = fromZone ? countryByIso(fromZone) : undefined;
    if (found) return found;
  } catch {
    // No `Intl.DateTimeFormat`, or an environment with no resolvable zone.
  }

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
