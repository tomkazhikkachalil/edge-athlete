import { describe, expect, it } from 'vitest';
import {
  ALL_QUOTAS,
  groupFacetRows,
  FACET_WIDEN_LIMIT,
  TYPED_QUOTAS,
  groupByType,
  orderByIds,
  typesForRequest,
  type SearchAllRow,
} from '../all';

function row(entity_type: SearchAllRow['entity_type'], entity_id: string): SearchAllRow {
  return {
    entity_type,
    entity_id,
    title: entity_id,
    subtitle: null,
    sport_key: null,
    city: null,
    region: null,
    region_code: null,
    country: null,
    country_code: null,
    place_id: null,
    lat: null,
    lng: null,
    distance_km: null,
    match_rank: 3,
  };
}

describe('typesForRequest', () => {
  it('suggests athletes from the first keystroke on the all tab', () => {
    expect(typesForRequest('all', 1, false)).toEqual(['athlete']);
  });

  it('adds content types at two characters on the all tab', () => {
    expect(typesForRequest('all', 2, false)).toEqual(['athlete', 'course', 'post', 'club', 'league']);
  });

  it('returns nothing for an empty un-filtered query', () => {
    expect(typesForRequest('all', 0, false)).toEqual([]);
    expect(typesForRequest('athletes', 0, false)).toEqual([]);
  });

  it('maps typed tabs to their entity type', () => {
    expect(typesForRequest('athletes', 1, false)).toEqual(['athlete']);
    expect(typesForRequest('courses', 2, false)).toEqual(['course']);
    expect(typesForRequest('posts', 2, false)).toEqual(['post']);
    expect(typesForRequest('clubs', 2, false)).toEqual(['club']);
    expect(typesForRequest('leagues', 2, false)).toEqual(['league']);
  });

  it('holds content tabs to the two-character floor', () => {
    expect(typesForRequest('courses', 1, false)).toEqual([]);
    expect(typesForRequest('posts', 1, false)).toEqual([]);
    expect(typesForRequest('clubs', 1, false)).toEqual([]);
    expect(typesForRequest('leagues', 1, false)).toEqual([]);
  });

  it('allows an empty-query location browse for locatable tabs only', () => {
    expect(typesForRequest('athletes', 0, true)).toEqual(['athlete']);
    expect(typesForRequest('clubs', 0, true)).toEqual(['club']);
    expect(typesForRequest('courses', 0, true)).toEqual(['course']);
    expect(typesForRequest('leagues', 0, true)).toEqual(['league']);
    // Posts have no location columns; a location browse cannot reach them.
    expect(typesForRequest('posts', 0, true)).toEqual([]);
  });

  it('rejects unknown type params', () => {
    expect(typesForRequest('teams', 5, false)).toEqual([]);
  });
});

describe('groupByType', () => {
  it('groups rows preserving rank order within each type', () => {
    const rows = [row('athlete', 'a1'), row('course', 'c1'), row('athlete', 'a2')];
    const grouped = groupByType(rows);
    expect(grouped.athlete?.map(r => r.entity_id)).toEqual(['a1', 'a2']);
    expect(grouped.course?.map(r => r.entity_id)).toEqual(['c1']);
    expect(grouped.post).toBeUndefined();
  });
});

describe('orderByIds', () => {
  it('re-orders hydrated rows to document-rank order', () => {
    const items = [{ id: 'b' }, { id: 'a' }, { id: 'c' }];
    expect(orderByIds(['c', 'a', 'b'], items).map(i => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('drops ids the hydration did not return', () => {
    const items = [{ id: 'a' }];
    expect(orderByIds(['deleted', 'a'], items).map(i => i.id)).toEqual(['a']);
  });
});

describe('quotas', () => {
  it('keeps the pre-unification per-section numbers', () => {
    expect(ALL_QUOTAS).toEqual({ athlete: 20, course: 5, post: 15, club: 10, league: 5 });
    expect(TYPED_QUOTAS).toEqual({ athlete: 20, course: 15, post: 15, club: 10, league: 15 });
    expect(FACET_WIDEN_LIMIT).toBe(100);
  });
});

describe('groupFacetRows', () => {
  it('groups rows by facet kind, preserving order', () => {
    const grouped = groupFacetRows([
      { facet: 'type', code: 'course', label: 'course', n: 90 },
      { facet: 'type', code: 'post', label: 'post', n: 7 },
      { facet: 'country', code: 'CA', label: 'Canada', n: 80 },
      { facet: 'region', code: 'ON', label: 'Ontario', n: 71 },
      { facet: 'sport', code: 'golf', label: 'golf', n: 97 },
    ]);
    expect(grouped.types.map(t => t.code)).toEqual(['course', 'post']);
    expect(grouped.countries).toEqual([{ code: 'CA', label: 'Canada', n: 80 }]);
    expect(grouped.regions[0].label).toBe('Ontario');
    expect(grouped.sports[0].n).toBe(97);
  });

  it('falls back to the code when the label is null and drops unknown facets', () => {
    const grouped = groupFacetRows([
      { facet: 'country', code: 'US', label: null, n: 3 },
      { facet: 'someday', code: 'x', label: 'x', n: 1 },
    ]);
    expect(grouped.countries).toEqual([{ code: 'US', label: 'US', n: 3 }]);
    expect(grouped.types).toEqual([]);
  });
});
