// ── Country / region normalization ─────────────────────────────────────────
// Providers and imports hand us location in every shape at once: OpenGolfAPI
// sends `country_iso: 'US'` and `state: 'CA'`; GolfCourseAPI sends names or
// "Unknown"; OSM addr:* tags are whatever the mapper typed; Nominatim gives
// an ISO code. Prod (Aug 24) held 'US', 'USA', 'CA', 'Canada' side by side
// and regions as 'FL'. Search matches what users TYPE — "Florida", "Canada"
// — so every writer normalizes to { name, code } through here and stores
// both. Tables are generated from GeoNames (iso-data.ts); this file is the
// pure logic and the aliases the tables can't express.

import { CA_REGIONS, COUNTRY_NAMES, US_REGIONS } from './iso-data';

export interface NormalizedCountry {
  name: string;
  code: string; // ISO-3166-1 alpha-2, upper case
}

export interface NormalizedRegion {
  name: string;
  code: string | null; // ISO-3166-2 letters where we know them (US, CA)
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Names people and providers actually use that aren't the ISO short name. */
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  'u s a': 'US',
  'united states': 'US',
  'united states of america': 'US',
  america: 'US',
  uk: 'GB',
  'u k': 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  'south korea': 'KR',
  'republic of korea': 'KR',
  'north korea': 'KP',
  russia: 'RU',
  'russian federation': 'RU',
  vietnam: 'VN',
  'viet nam': 'VN',
  iran: 'IR',
  syria: 'SY',
  laos: 'LA',
  'czech republic': 'CZ',
  czechia: 'CZ',
  holland: 'NL',
  'the netherlands': 'NL',
  netherlands: 'NL',
  'uae': 'AE',
  'united arab emirates': 'AE',
  taiwan: 'TW',
  'hong kong': 'HK',
  macau: 'MO',
  macao: 'MO',
  'ivory coast': 'CI',
  "cote d ivoire": 'CI',
  'cape verde': 'CV',
  'east timor': 'TL',
  swaziland: 'SZ',
  eswatini: 'SZ',
  burma: 'MM',
  myanmar: 'MM',
  'vatican city': 'VA',
  'the bahamas': 'BS',
  bahamas: 'BS',
  'the gambia': 'GM',
  gambia: 'GM',
  turkiye: 'TR',
  turkey: 'TR',
  'bosnia and herzegovina': 'BA',
  'bosnia': 'BA',
  'trinidad and tobago': 'TT',
  'trinidad': 'TT',
  'saint kitts and nevis': 'KN',
  'st kitts and nevis': 'KN',
  'saint lucia': 'LC',
  'st lucia': 'LC',
  'saint vincent and the grenadines': 'VC',
  'antigua and barbuda': 'AG',
  'sao tome and principe': 'ST',
  'dr congo': 'CD',
  'democratic republic of the congo': 'CD',
  'republic of the congo': 'CG',
  'congo': 'CG',
  'tanzania': 'TZ',
  'bolivia': 'BO',
  'venezuela': 'VE',
  'moldova': 'MD',
  'brunei': 'BN',
  'micronesia': 'FM',
  'palestine': 'PS',
  'falkland islands': 'FK',
  'south georgia': 'GS',
  'reunion': 'RE',
  'curacao': 'CW',
  'aland islands': 'AX',
  'saint barthelemy': 'BL',
  'saint martin': 'MF',
  'saint pierre and miquelon': 'PM',
  'saint helena': 'SH',
  'us virgin islands': 'VI',
  'u s virgin islands': 'VI',
  'british virgin islands': 'VG',
  'north macedonia': 'MK',
  macedonia: 'MK',
};

let countryByFoldedName: Map<string, string> | null = null;
function countryIndex(): Map<string, string> {
  if (!countryByFoldedName) {
    countryByFoldedName = new Map();
    for (const [code, name] of Object.entries(COUNTRY_NAMES)) countryByFoldedName.set(fold(name), code);
    for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) countryByFoldedName.set(alias, code);
  }
  return countryByFoldedName;
}

/** 'US' | 'usa' | 'United States' | 'Canada' | 'ca' → { name, code }; null
 *  for blanks, "Unknown", and anything unrecognised. Never guesses. */
export function normalizeCountry(value: string | null | undefined): NormalizedCountry | null {
  const raw = (value ?? '').trim();
  if (!raw || /^unknown$/i.test(raw)) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && COUNTRY_NAMES[upper]) return { name: COUNTRY_NAMES[upper], code: upper };
  const code = countryIndex().get(fold(raw));
  return code ? { name: COUNTRY_NAMES[code], code } : null;
}

const REGION_TABLES: Record<string, Record<string, string>> = { US: US_REGIONS, CA: CA_REGIONS };

/** 'FL' → Florida/FL, 'Ontario' → Ontario/ON (given the country), anything
 *  else → its own name with no code. A 2-letter value for a country whose
 *  subdivisions we don't table is left as-is (it may be a code we can't
 *  expand — 'ENG' style GeoNames admin1 codes are handled by the seed). */
export function normalizeRegion(
  value: string | null | undefined,
  countryCode: string | null | undefined
): NormalizedRegion | null {
  const raw = (value ?? '').trim();
  if (!raw || /^unknown$/i.test(raw)) return null;
  const table = countryCode ? REGION_TABLES[countryCode.toUpperCase()] : undefined;
  if (table) {
    const upper = raw.toUpperCase();
    if (table[upper]) return { name: table[upper], code: upper };
    const folded = fold(raw);
    for (const [code, name] of Object.entries(table)) {
      if (fold(name) === folded) return { name, code };
    }
  }
  return { name: raw, code: null };
}

/** The line users see under a name: "Ottawa, Ontario · Canada" with any
 *  missing part dropped. Shared by pickers and result rows. */
export function formatPlace(parts: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): string {
  const local = [parts.city, parts.region].filter(Boolean).join(', ');
  return [local, parts.country].filter(Boolean).join(' · ');
}
