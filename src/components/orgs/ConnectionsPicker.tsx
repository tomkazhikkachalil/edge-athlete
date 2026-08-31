'use client';

import { useEffect, useRef, useState } from 'react';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/search/typeahead';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatPlace } from '@/lib/geo/regions';
import type { ConnectionsDraftInput } from '@/lib/orgs/wizard-validate';

// ── Wizard step 4: connections (AffiliationSection's typeahead recipe) ──────
// A league connects to CLUBS and vice versa (league_clubs is the only
// org↔org edge). Results are cleared in onChange, never in the effect
// (the set-state-in-effect rule); short queries may omit the results key
// entirely (`body.results?.X ?? []`). Unmatched orgs become STUB rows —
// approval creates them ownerless with a claim invite; club-side stubs
// are LEAGUES and carry an explicit sport (NOT NULL sport_key).

interface OrgSuggestion {
  id: string;
  name: string;
  sport_key?: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

export default function ConnectionsPicker({
  searchType,
  stubNeedsSport,
  existing,
  stubs,
  onChange,
}: {
  /** 'clubs' for the league wizard, 'leagues' for the club wizard. */
  searchType: 'clubs' | 'leagues';
  stubNeedsSport: boolean;
  existing: ConnectionsDraftInput['existing'];
  stubs: ConnectionsDraftInput['stubs'];
  onChange: (next: {
    existing: ConnectionsDraftInput['existing'];
    stubs: ConnectionsDraftInput['stubs'];
  }) => void;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<OrgSuggestion[]>([]);
  const [stubName, setStubName] = useState('');
  const [stubEmail, setStubEmail] = useState('');
  const [stubSport, setStubSport] = useState<string>(FEATURE_FLAGS.FEATURE_SPORTS[0]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) return; // org doc types need 2 chars server-side
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=${searchType}`);
        if (!res.ok) return;
        const body = await res.json();
        const rows = (body.results?.[searchType] ?? []) as OrgSuggestion[];
        setSuggestions(rows.slice(0, 6));
      } catch {
        /* typeahead is additive */
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchType]);

  const orgLine = (org: OrgSuggestion): string => {
    const sport = org.sport_key
      ? SPORT_REGISTRY[org.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? org.sport_key
      : null;
    return [sport, formatPlace({ city: org.city, region: org.region, country: org.country })]
      .filter(Boolean)
      .join(' · ');
  };

  const pick = (org: OrgSuggestion) => {
    setQuery('');
    setSuggestions([]);
    if (existing.length >= 10 || existing.some(e => e.id === org.id)) return;
    onChange({ existing: [...existing, { id: org.id, name: org.name }], stubs });
  };

  const addStub = () => {
    const name = stubName.trim();
    if (!name || stubs.length >= 10) return;
    onChange({
      existing,
      stubs: [
        ...stubs,
        {
          name,
          ...(stubEmail.trim() ? { email: stubEmail.trim() } : {}),
          ...(stubNeedsSport ? { sportKey: stubSport } : {}),
        },
      ],
    });
    setStubName('');
    setStubEmail('');
  };

  const noun = searchType === 'clubs' ? 'club' : 'league';

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="conn-search" className="block text-sm font-medium text-secondary mb-1">
          Find {noun}s already on Edge Athlete
        </label>
        <input
          id="conn-search"
          type="text"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            if (e.target.value.trim().length < 2) setSuggestions([]);
          }}
          placeholder={`Search ${noun}s…`}
          className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
        />
        {suggestions.length > 0 && (
          <ul className="mt-1 border border-border rounded-md divide-y divide-border-subtle bg-surface-raised">
            {suggestions.map(org => (
              <li key={org.id}>
                <button
                  type="button"
                  onClick={() => pick(org)}
                  className="w-full text-left px-3 py-2 hover:bg-surface-muted transition-colors"
                >
                  <span className="block text-sm font-medium text-primary truncate">{org.name}</span>
                  {orgLine(org) && (
                    <span className="block text-xs text-muted truncate">{orgLine(org)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {existing.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {existing.map(org => (
            <li
              key={org.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-surface-sunken text-sm text-secondary"
            >
              <span className="max-w-[12rem] truncate">{org.name}</span>
              <button
                type="button"
                onClick={() =>
                  onChange({ existing: existing.filter(e => e.id !== org.id), stubs })
                }
                aria-label={`Remove ${org.name}`}
                className="text-muted hover:text-red-600"
              >
                <i className="fas fa-times text-xs" aria-hidden="true"></i>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border-subtle pt-3">
        <p className="text-sm font-medium text-secondary mb-1">
          Can&apos;t find them? Add them anyway
        </p>
        <p className="text-xs text-muted mb-2">
          We&apos;ll create their page and — if you add an email — invite them to claim it.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={stubName}
            maxLength={120}
            onChange={e => setStubName(e.target.value)}
            placeholder={`${noun === 'club' ? 'Club' : 'League'} name`}
            aria-label={`New ${noun} name`}
            className="grow basis-40 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
          />
          <input
            type="email"
            value={stubEmail}
            maxLength={255}
            onChange={e => setStubEmail(e.target.value)}
            placeholder="Contact email (optional)"
            aria-label={`New ${noun} contact email`}
            className="grow basis-48 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
          />
          {stubNeedsSport && (
            <select
              value={stubSport}
              onChange={e => setStubSport(e.target.value)}
              aria-label={`New ${noun} sport`}
              className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            >
              {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
                <option key={key} value={key}>
                  {SPORT_REGISTRY[key]?.display_name ?? key}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={addStub}
            className="px-3 py-2 text-sm min-h-[40px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
          >
            Add
          </button>
        </div>
        {stubs.length > 0 && (
          <ul className="mt-2 space-y-1">
            {stubs.map((stub, i) => (
              <li
                key={`${stub.name}-${i}`}
                className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-surface-muted"
              >
                <span className="text-sm text-primary truncate">
                  {stub.name}
                  {stub.email ? <span className="text-xs text-muted"> · {stub.email}</span> : null}
                  {stub.sportKey ? (
                    <span className="text-xs text-muted">
                      {' '}
                      · {SPORT_REGISTRY[stub.sportKey as keyof typeof SPORT_REGISTRY]?.display_name ?? stub.sportKey}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ existing, stubs: stubs.filter((_, j) => j !== i) })}
                  aria-label={`Remove ${stub.name}`}
                  className="text-muted hover:text-red-600 shrink-0"
                >
                  <i className="fas fa-times text-xs" aria-hidden="true"></i>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
