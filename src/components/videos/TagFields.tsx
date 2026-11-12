'use client';

import { useCallback, useState } from 'react';
import { useTypeahead } from '@/hooks/useTypeahead';
import { rankPeople, type PersonSuggestion } from '@/lib/search/people';
import { periodLabel, sheetEvent, type EventGroup, type GameSheet, type SheetEvent } from '@/lib/videos/game-sheets';
import { sideLabel, type GameView } from '@/lib/videos/game-rules';
import { formatTimestamp, parseTypedTimestamp } from '@/lib/videos/rules';
import { ROLE_IN_CLIP, TAG_NAME_MAX, TAG_PEOPLE_MAX, tagPersonKey, type TagInput } from '@/lib/videos/tag-rules';
import type { HighlightRow } from '@/lib/videos/types';
import FaIcon from '@/components/FaIcon';
import { faXmark } from '@/lib/icons/fa/xmark';

const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';
const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

/**
 * What happened and who was in it (Sprint 3 PR 3): the game sheet's event,
 * whose it is, the period, a value where the event carries one, and the
 * people by role — a linked athlete from search, or a typed name for someone
 * not on Edge Athlete yet. Controlled: the form owns the draft. The stats
 * are derived from exactly these fields; nothing else is typed.
 */
export interface TagPersonDraft { profile_id: string | null; name: string; role: string }
export interface TagDraft { eventKey: string; side: '' | '1' | '2'; period: string; value: string; people: TagPersonDraft[] }
export const EMPTY_TAG_DRAFT: TagDraft = { eventKey: '', side: '', period: '', value: '', people: [] };

export function tagDraftOf(h: HighlightRow, sheet: GameSheet | null): TagDraft {
  const event = sheet ? sheetEvent(sheet, h.event_key) : null;
  return {
    eventKey: h.event_key ?? '',
    side: h.side ? (String(h.side) as '1' | '2') : '',
    period: h.period ? String(h.period) : '',
    value: h.value === null ? '' : event?.takesValue?.kind === 'time_ms' ? formatTimestamp(h.value) : String(h.value),
    // A masked person (a profile this viewer may not see) never reaches a manager's form; a typed name has no profile.
    people: h.people.map(p => ({ profile_id: p.profile_id, name: p.name, role: p.role })),
  };
}

/** The draft as the API takes it, or the sentence to show. */
export function tagInputOf(d: TagDraft, sheet: GameSheet | null): { ok: true; value: TagInput } | { ok: false; error: string } {
  const event = sheet ? sheetEvent(sheet, d.eventKey) : null;
  let value: number | null = null;
  if (event?.takesValue && d.value.trim()) {
    const parsed = event.takesValue.kind === 'time_ms' ? parseTypedTimestamp(d.value) : Number(d.value);
    if (parsed === null || !Number.isInteger(parsed)) return { ok: false, error: event.takesValue.kind === 'time_ms' ? `Type the ${event.takesValue.label.toLowerCase()} as m:ss or h:mm:ss.` : `${event.takesValue.label} must be a whole number.` };
    value = parsed;
  }
  const period = d.period ? Number(d.period) : null;
  return {
    ok: true,
    value: {
      event_key: event ? event.key : null,
      period: period && Number.isInteger(period) ? period : null,
      side: d.side ? (Number(d.side) as 1 | 2) : null,
      value,
      people: d.people
        .filter(p => p.role === ROLE_IN_CLIP || !!event?.roles.some(r => r.key === p.role))
        .map(p => ({ profile_id: p.profile_id, name: p.profile_id ? null : p.name, role: p.role, side: null })),
    },
  };
}

const GROUP_LABEL: Record<EventGroup, string> = { score: 'Scoring', attack: 'Attack', defence: 'Defence', discipline: 'Fouls and errors', result: 'Result', marker: 'Markers' };
const GROUP_ORDER: EventGroup[] = ['score', 'result', 'attack', 'defence', 'discipline', 'marker'];

function suggestionName(p: PersonSuggestion): string {
  return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || (p.handle ? `@${p.handle}` : 'Athlete');
}

function PersonPicker({ roleLabel, taken, onPick, onClose }: { roleLabel: string; taken: Set<string>; onPick: (p: { profile_id: string | null; name: string }) => void; onClose: () => void }) {
  const fetcher = useCallback(async (q: string, signal: AbortSignal) => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=athletes`, { signal });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    const data = await res.json();
    return (data.results?.athletes ?? []) as PersonSuggestion[];
  }, []);
  const { query, setQuery, items, loading } = useTypeahead<PersonSuggestion>({ scope: 'people:public', fetcher, narrow: rankPeople, limit: 6 });
  const typed = query.trim().replace(/\s+/g, ' ');
  const nameTaken = taken.has(`n:${typed.toLowerCase()}`);
  return (
    <div className="rounded-lg border border-border bg-surface p-2 space-y-2" data-tag-picker="">
      <div className="flex gap-2">
        <input className={FIELD} autoComplete="off" maxLength={TAG_NAME_MAX} placeholder={`Search or type a name — ${roleLabel.toLowerCase()}`} value={query} onChange={e => setQuery(e.target.value)} aria-label={`${roleLabel}: search or type a name`} data-tag-picker-input="" />
        <button type="button" onClick={onClose} className="ea-icon-btn text-secondary shrink-0" aria-label="Close"><FaIcon icon={faXmark} /></button>
      </div>
      {loading && <p className="text-xs text-muted" role="status">Searching…</p>}
      <ul className="divide-y divide-border-subtle">
        {items.filter(p => !taken.has(`p:${p.id}`)).map(p => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick({ profile_id: p.id, name: suggestionName(p) })} className="ea-interactive flex w-full items-center gap-2 px-2 min-h-[44px] text-left" data-tag-pick={p.id}>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-primary truncate">{suggestionName(p)}</span>
                {p.handle && <span className="block text-xs text-muted truncate">@{p.handle}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {typed.length > 0 && !nameTaken && (
        <button type="button" onClick={() => onPick({ profile_id: null, name: typed })} className={`${BTN} w-full text-left`} data-tag-pick-name="">
          Use “{typed}” as a name <span className="font-normal text-muted">— not on Edge Athlete yet</span>
        </button>
      )}
    </div>
  );
}

export default function TagFields({ sheet, game, value, onChange }: { sheet: GameSheet; game: GameView; value: TagDraft; onChange: (next: TagDraft) => void }) {
  const [picking, setPicking] = useState<string | null>(null);
  const event: SheetEvent | null = sheetEvent(sheet, value.eventKey);
  const twoSided = sheet.family === 'team' || sheet.family === 'combat';
  const periods = Array.from({ length: sheet.period.regulation + (sheet.period.extra ? 2 : 0) }, (_, i) => i + 1);
  const roles = [...(event?.roles ?? []).map(r => ({ key: r.key, label: r.label, max: r.max ?? 1 })), { key: ROLE_IN_CLIP, label: 'Also in the clip', max: TAG_PEOPLE_MAX }];
  const set = (patch: Partial<TagDraft>) => onChange({ ...value, ...patch });
  const pickEvent = (key: string) => {
    const next = sheetEvent(sheet, key);
    // People in roles the new event does not have move to "also in the clip" — nobody is silently dropped.
    const people = value.people.map(p => (p.role === ROLE_IN_CLIP || next?.roles.some(r => r.key === p.role) ? p : { ...p, role: ROLE_IN_CLIP }));
    const seen = new Set<string>();
    onChange({ ...value, eventKey: key, value: next?.takesValue?.default !== undefined ? String(next.takesValue.default) : '', people: people.filter(p => { const k = `${tagPersonKey({ profile_id: p.profile_id, name: p.name })}|${p.role}`; if (seen.has(k)) return false; seen.add(k); return true; }) });
    setPicking(null);
  };

  return (
    <div className="space-y-3" data-tag-fields={value.eventKey || 'none'}>
      <label className="block text-sm text-secondary">
        What happened
        <select className={`${FIELD} mt-1`} value={value.eventKey} onChange={e => pickEvent(e.target.value)} data-tag-event="">
          <option value="">Just a highlight (no stat)</option>
          {GROUP_ORDER.filter(g => sheet.events.some(e => e.group === g)).map(g => (
            <optgroup key={g} label={GROUP_LABEL[g]}>
              {sheet.events.filter(e => e.group === g).map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      {event && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {twoSided && (
            <fieldset>
              <legend className="text-sm text-secondary">Whose</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {([1, 2] as const).map(s => (
                  <button key={s} type="button" onClick={() => set({ side: String(s) as '1' | '2' })} aria-pressed={value.side === String(s)} className={`ea-interactive min-h-[44px] rounded-lg border px-2 text-sm font-semibold truncate ${value.side === String(s) ? 'border-brand bg-brand-soft text-primary' : 'border-border-strong text-secondary'}`} data-tag-side={s}>
                    {sideLabel(game, s)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <label className="block text-sm text-secondary">
            {sheet.period.noun}
            <select className={`${FIELD} mt-1`} value={value.period} onChange={e => set({ period: e.target.value })} data-tag-period="">
              <option value="">—</option>
              {periods.map(p => <option key={p} value={p}>{periodLabel(sheet, p)}</option>)}
            </select>
          </label>
          {event.takesValue && (
            <label className="block text-sm text-secondary">
              {event.takesValue.label}
              <input className={`${FIELD} mt-1`} inputMode={event.takesValue.kind === 'time_ms' ? 'text' : 'numeric'} placeholder={event.takesValue.kind === 'time_ms' ? '1:02' : String(event.takesValue.default ?? '')} value={value.value} onChange={e => set({ value: e.target.value })} data-tag-value="" />
            </label>
          )}
        </div>
      )}

      <div className="space-y-2" data-tag-people={value.people.length}>
        {roles.map(r => {
          const holders = value.people.filter(p => p.role === r.key);
          const taken = new Set(holders.map(p => tagPersonKey({ profile_id: p.profile_id, name: p.name })));
          const full = holders.length >= r.max || value.people.length >= TAG_PEOPLE_MAX;
          return (
            <div key={r.key} data-tag-role={r.key}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-secondary w-full sm:w-auto sm:min-w-[9rem]">{r.label}</span>
                {holders.map(p => (
                  <span key={tagPersonKey({ profile_id: p.profile_id, name: p.name })} className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface pl-3 pr-1 min-h-[36px] text-sm text-primary" data-tag-person={p.profile_id ?? 'name'}>
                    <span className="max-w-[11rem] truncate">{p.name}</span>
                    {!p.profile_id && <span className="text-xs text-muted">(name)</span>}
                    <button type="button" onClick={() => set({ people: value.people.filter(x => x !== p) })} className="ea-icon-btn text-secondary !min-h-[32px] !min-w-[32px]" aria-label={`Remove ${p.name}`}><FaIcon icon={faXmark} className="text-xs" /></button>
                  </span>
                ))}
                {!full && picking !== r.key && (
                  <button type="button" onClick={() => setPicking(r.key)} className={`${BTN} !min-h-[36px]`} data-tag-add-person={r.key}>+ Add</button>
                )}
              </div>
              {picking === r.key && (
                <div className="mt-2">
                  <PersonPicker
                    roleLabel={r.label}
                    taken={taken}
                    onClose={() => setPicking(null)}
                    onPick={p => { set({ people: [...value.people, { ...p, role: r.key }] }); setPicking(null); }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
