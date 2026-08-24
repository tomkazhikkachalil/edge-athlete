// ── Profile ⇄ PlaceValue (pure) ─────────────────────────────────────────────
// The structured location columns on profiles (migration 108) and the
// picker's value are the same fact in two shapes. Both directions live here
// so the editor, the save payload and any future club/league form agree.

import type { PlaceValue } from '@/components/PlacePicker';
import { formatPlace } from './regions';

interface ProfileLocationColumns {
  place_id?: string | null;
  city?: string | null;
  region?: string | null;
  region_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** A profile with a picked place → the picker's value; otherwise null (free text). */
export function profileToPlace(profile: ProfileLocationColumns | null | undefined): PlaceValue | null {
  if (!profile?.place_id || !profile.city || !profile.country || !profile.country_code) return null;
  if (typeof profile.lat !== 'number' || typeof profile.lng !== 'number') return null;
  return {
    placeId: profile.place_id,
    city: profile.city,
    region: profile.region ?? null,
    regionCode: profile.region_code ?? null,
    country: profile.country,
    countryCode: profile.country_code,
    lat: profile.lat,
    lng: profile.lng,
    label: formatPlace({ city: profile.city, region: profile.region, country: profile.country }),
  };
}

/** The save payload for the structured columns. Empty strings, not nulls:
 *  the profile PUT route turns '' into NULL for its optional fields, and
 *  that convention is what clears a stale place when the text was edited. */
export function placeToProfileFields(place: PlaceValue | null): Record<string, string | number> {
  if (!place) {
    return {
      place_id: '', city: '', region: '', region_code: '', country: '', country_code: '',
      lat: '', lng: '', location_source: '',
    };
  }
  return {
    place_id: place.placeId,
    city: place.city,
    region: place.region ?? '',
    region_code: place.regionCode ?? '',
    country: place.country,
    country_code: place.countryCode,
    lat: place.lat,
    lng: place.lng,
    location_source: 'user',
  };
}
