// ── The scorecard fill — the ONE writer (Nov 17 2026, migration 314) ────────
// The rules are in card-fill.ts; this file talks to the database and to
// OpenGolfAPI. Two phases, each dry-run-able, called by the cron tick
// (`/api/cron/golf-map-sweep`) and by the owner's door (`/api/admin/golf-card-fill`):
//   link   read OpenGolfAPI's published ODbL file once a month and record
//          which of its courses is which of ours (golf_courses.opengolf_id).
//   cards  for linked rows with no card: ONE detail call each, the card
//          checked (cardFillVerdict) and saved through the same merge every
//          other writer uses. A refusal is stamped with its reason.
// Only OpenGolfAPI: GolfCourseAPI's terms allow an ask for a person who picked
// the course and nothing else, so it has no caller here.

import { gunzipSync } from 'zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CATALOG_ROW_COLUMNS, SHEET_PROVIDERS, consumeProviderBudget, readMapSheet, readSheetSources, type CatalogRow } from '@/lib/golf/course-catalog';
import { FILL_RETRY_MS, LINK_RULE_VERSION, cardFillVerdict, linkDataset, linkDue, linkEntryKey, parseDatasetLine, type CardFillVerdict, type LinkOurs, type LinkTheirs } from '@/lib/golf/card-fill';
import { readMeta, writeMeta } from '@/lib/golf/map-sweep-server';
import { cardParsVerdict, creditSources, mergeSheets, type CardParsVerdict, type Sheet } from '@/lib/golf/sheet-merge';

/** OpenGolfAPI's published file (ODbL 1.0; "Contains data from OpenGolfAPI
 *  (opengolfapi.org)" — the catalog's attribution line already names it). */
export const DATASET_URL = 'https://raw.githubusercontent.com/opengolfapi/data/main/opengolfapi-us.ndjson.gz';

const PAGE = 1000;
const LINK_CHUNK = 500;
const CALL_GAP_MS = 300;
/** A row is asked only with this long left before the deadline: one slow
 *  provider answer still fits inside it. */
export const ROW_START_RESERVE_MS = 7000;
/** What the cron tick gives the cards phase: the reserve PLUS five seconds in
 *  which its rows may start. (Nov 17 2026: the tick first passed 6 s, less
 *  than the reserve, so every batch ended before its first row: `due 2,
 *  outcomes {}` in 98 ms on production.) */
export const CRON_CARD_PHASE_MS = ROW_START_RESERVE_MS + 5000;
const PROVIDER_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const iso = (t: number) => new Date(t).toISOString();
/** A database without migration 314 answers one of these. */
const missing314 = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === '42883' || e.code === 'PGRST202' || e.code === 'PGRST204' || /opengolf_id|sheet_fill|golf_card_fill_link/.test(e.message ?? ''));
// (A HEAD count's error carries no body: an empty message is the missing column too.)
const fail = (e: { code?: string; message?: string }) => ({ ok: false as const, error: missing314(e) || !e.message ? 'migration 314 has not run' : e.message });

async function pages<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<{ rows: T[] } | { ok: false; error: string }> {
  const rows: T[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) return fail(error);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { rows };
}

/** golf_map_sweep_meta key: our course id → the OTHER OpenGolfAPI ids of the
 *  same entry (the file lists some courses several times; card-fill.ts
 *  linkDataset). A few hundred rows; read once per fill batch. */
const ALTS_KEY = 'card_link_alts';
type CardLinkAlts = Record<string, string[]>;
/** At most this many ids are asked for one course in one batch. */
const MAX_IDS_PER_ROW = 4;

// ── Phase: link ───────────────────────────────────────────────────────────────

export interface CardLinkSummary {
  phase: 'link';
  dryRun: boolean;
  dataset: number;
  ours: number;
  matched: number;
  linked: number;
  unmatched: number;
  ambiguous: number;
  elapsedMs: number;
}

export async function runCardLink(
  admin: SupabaseClient,
  opts: { dryRun: boolean; fetchDataset?: () => Promise<LinkTheirs[] | null> }
): Promise<CardLinkSummary | { ok: false; error: string }> {
  const t0 = Date.now();
  // The attempt is stamped before the work: a link that fails or is cut short
  // is not due again on the next tick (card-fill.ts linkDue).
  if (!opts.dryRun) await writeMeta(admin, 'card_link_try', { at: iso(t0) });
  const theirs = await (opts.fetchDataset ?? fetchDataset)();
  if (!theirs) return { ok: false, error: 'the OpenGolfAPI file could not be read' };

  const ours = await pages<LinkOurs>((from, to) =>
    admin
      .from('golf_courses')
      .select('id, name, lat, lng')
      .eq('country_code', 'US')
      .in('external_source', ['osm', 'seed', 'golfcourseapi'])
      .is('opengolf_id', null)
      .order('id')
      .range(from, to)
  );
  if ('ok' in ours) return ours;
  // An entry that is already one of our rows (linked earlier, or the row's own
  // provider id) is nobody else's.
  const taken = await pages<{ opengolf_id: string | null; external_id: string | null }>((from, to) =>
    admin
      .from('golf_courses')
      .select('opengolf_id, external_id')
      .or('opengolf_id.not.is.null,external_source.eq.opengolfapi')
      .order('id')
      .range(from, to)
  );
  if ('ok' in taken) return taken;
  const alts = (await readMeta<CardLinkAlts>(admin, ALTS_KEY)) ?? {};
  const used = new Set([...taken.rows.flatMap(r => [r.opengolf_id, r.external_id]), ...Object.values(alts).flat()].filter((v): v is string => !!v));
  // A course the file lists several times is taken as a whole: once one of
  // its ids is a row's, its other ids are not offered to another row.
  const takenEntries = new Set(theirs.filter(t => used.has(t.id)).map(linkEntryKey));
  const link = linkDataset(ours.rows, theirs.filter(t => !takenEntries.has(linkEntryKey(t))));

  const summary: CardLinkSummary = {
    phase: 'link', dryRun: opts.dryRun, dataset: theirs.length, ours: ours.rows.length, matched: link.pairs.length, linked: 0,
    unmatched: link.unmatched + link.noCoords, ambiguous: link.ambiguous, elapsedMs: 0,
  };
  if (!opts.dryRun) {
    for (let i = 0; i < link.pairs.length; i += LINK_CHUNK) {
      const { data, error } = await admin.rpc('golf_card_fill_link', { p_pairs: link.pairs.slice(i, i + LINK_CHUNK) });
      if (error) return fail(error);
      summary.linked += typeof data === 'number' ? data : 0;
    }
    // The other ids of a course listed several times, for the fill to ask in turn.
    const fresh = Object.fromEntries(link.pairs.filter(p => p.alts?.length).map(p => [p.id, p.alts!]));
    if (Object.keys(fresh).length) await writeMeta(admin, ALTS_KEY, { ...alts, ...fresh });
    await writeMeta(admin, 'card_link', { at: iso(Date.now()), rule: LINK_RULE_VERSION, dataset: summary.dataset, linked: summary.linked, unmatched: summary.unmatched, ambiguous: summary.ambiguous });
  }
  summary.elapsedMs = Date.now() - t0;
  return summary;
}

async function fetchDataset(): Promise<LinkTheirs[] | null> {
  try {
    const res = await fetch(DATASET_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    const rows = text.split('\n').map(parseDatasetLine).filter((r): r is LinkTheirs => !!r);
    // A stub or an emptied file is a bad day, never "no courses".
    return rows.length >= 1000 ? rows : null;
  } catch {
    return null;
  }
}

/** Is the monthly link due? (The cron asks; the owner's door runs it at will.) */
export async function cardLinkDue(admin: SupabaseClient, now = Date.now()): Promise<boolean> {
  const [done, tried] = await Promise.all([
    readMeta<{ at?: string; rule?: number }>(admin, 'card_link'),
    readMeta<{ at?: string }>(admin, 'card_link_try'),
  ]);
  // A record written before the rule had a number was rule 1.
  return linkDue(done?.at, tried?.at, now, done?.at ? done.rule ?? 1 : LINK_RULE_VERSION);
}

// ── Phase: cards ──────────────────────────────────────────────────────────────

export interface CardFillSummary {
  phase: 'cards';
  dryRun: boolean;
  due: number;
  outcomes: Record<string, number>;
  budgetExhausted: boolean;
  elapsedMs: number;
}

type FillRow = CatalogRow & { opengolf_id: string };

export async function runCardFillBatch(
  admin: SupabaseClient,
  opts: { rows: number; dryRun: boolean; now?: number; deadlineMs?: number }
): Promise<CardFillSummary | { ok: false; error: string }> {
  const t0 = opts.now ?? Date.now();
  const deadline = Date.now() + (opts.deadlineMs ?? 40_000);
  const retry = iso(t0 - FILL_RETRY_MS);
  const retryProvider = iso(t0 - PROVIDER_RETRY_MS);
  const { data, error } = await admin
    .from('golf_courses')
    .select(`${CATALOG_ROW_COLUMNS}, opengolf_id`)
    .not('opengolf_id', 'is', null)
    .is('hole_data', null)
    .neq('external_source', 'qa-e2e')
    .or(`sheet_fill_at.is.null,sheet_fill_at.lt.${retry},and(sheet_fill_outcome.eq.provider_error,sheet_fill_at.lt.${retryProvider})`) // hardening-ok: server-built timestamps, no user input
    .order('sheet_fill_at', { ascending: true, nullsFirst: true })
    .order('id')
    .limit(Math.max(1, Math.min(opts.rows, 40)));
  if (error) return fail(error);
  const rows = (data ?? []) as unknown as FillRow[];
  const summary: CardFillSummary = { phase: 'cards', dryRun: opts.dryRun, due: rows.length, outcomes: {}, budgetExhausted: false, elapsedMs: 0 };
  if (opts.dryRun) { summary.elapsedMs = Date.now() - t0; return summary; }

  const provider = SHEET_PROVIDERS.find(p => p.source === 'opengolfapi');
  if (!provider?.configured()) return { ok: false, error: 'OpenGolfAPI is turned off' };
  const count = (k: string) => { summary.outcomes[k] = (summary.outcomes[k] ?? 0) + 1; };
  let troubles = 0;
  const alts = rows.length ? (await readMeta<CardLinkAlts>(admin, ALTS_KEY)) ?? {} : {};
  batch: for (const row of rows) {
    // A course the file lists several times: its ids are asked in turn until
    // one card passes. The last refusal is what is stamped.
    const ids = [row.opengolf_id, ...(alts[row.id] ?? []).filter(id => id !== row.opengolf_id)].slice(0, MAX_IDS_PER_ROW);
    let outcome: CardFillVerdict | 'provider_error' | 'taken' = 'provider_error';
    for (let i = 0; i < ids.length; i++) {
      if (Date.now() > deadline - ROW_START_RESERVE_MS) break batch;
      // The fill's own cap first: it always leaves the shared key room for a pick.
      if (!(await consumeProviderBudget(admin, 'card-fill')) || !(await consumeProviderBudget(admin, 'opengolfapi'))) { summary.budgetExhausted = true; break batch; }
      const detail = await provider.detail(ids[i]);
      if (!detail) { outcome = 'provider_error'; break; }
      const last = i === ids.length - 1;
      outcome = await saveCard(admin, row, detail.row, { opengolfId: ids[i], stampRefusal: last });
      if (outcome === 'ok' || outcome === 'taken') break;
      if (!last) await sleep(CALL_GAP_MS);
    }
    count(outcome);
    // Two in a row is the provider's bad day: stop, the rows are asked again in a week.
    troubles = outcome === 'provider_error' ? troubles + 1 : 0;
    if (troubles >= 2) break;
    await sleep(CALL_GAP_MS);
  }
  summary.elapsedMs = Date.now() - t0;
  return summary;
}

/** The verdict, written: the card when it is good, the stamp either way. */
async function saveCard(
  admin: SupabaseClient,
  row: FillRow,
  card: (Sheet & { lat?: number | null; lng?: number | null }) | null,
  /** `opengolfId`: the id this card was asked by (it becomes the row's when the card is saved).
   *  `stampRefusal: false`: another id of the same course is still to be asked. */
  opts: { opengolfId: string; stampRefusal: boolean }
): Promise<CardFillVerdict | 'taken'> {
  const stamp = { sheet_fill_at: iso(Date.now()) };
  const verdict = cardFillVerdict(row, card, card?.hole_data?.length ? await readMapSheet(admin, row.id) : null);
  if (verdict !== 'ok' || !card) {
    if (opts.stampRefusal) await admin.from('golf_courses').update({ ...stamp, sheet_fill_outcome: verdict }).eq('id', row.id);
    return verdict;
  }
  const before: Sheet = { total_par: row.total_par, holes_count: row.holes_count, hole_data: row.hole_data, course_rating: row.course_rating, slope_rating: row.slope_rating };
  const merged = mergeSheets(before, card);
  const credits = await readSheetSources(admin, row.id);
  // `hole_data IS NULL` again in the write: a pick may have saved a card meanwhile.
  const { data, error } = await admin
    .from('golf_courses')
    .update({
      ...merged.sheet,
      ...(credits === undefined ? {} : { sheet_sources: creditSources(credits, before, merged.sheet, 'opengolfapi') }),
      ...stamp,
      sheet_fill_outcome: 'ok',
      ...(opts.opengolfId !== row.opengolf_id ? { opengolf_id: opts.opengolfId } : {}),
    })
    .eq('id', row.id)
    .is('hole_data', null)
    .select('id');
  if (error) throw new Error(`card fill write failed for ${row.id}: ${error.message}`);
  return (data ?? []).length ? 'ok' : 'taken';
}

// ── Phase: audit ──────────────────────────────────────────────────────────────

export interface CardAuditSummary {
  phase: 'audit';
  dryRun: boolean;
  /** Saved cards read. */
  cards: number;
  /** Cards that fail their own arithmetic, with what they say. */
  failing: Array<{ id: string; name: string; verdict: CardParsVerdict; holes: number; sum: number; total: number | null }>;
  withdrawn: number;
  elapsedMs: number;
}

/** More failing cards than this is not a few bad cards: nothing is withdrawn. */
export const AUDIT_WITHDRAW_MAX = 25;

/** Saved cards that fail their own arithmetic (sheet-merge.ts cardParsVerdict),
 *  listed, and on a live run withdrawn: the holes, the total and the credits go,
 *  the reason is stamped where the fill stamps a refusal, the ratings stay.
 *  Nov 24 2026: seven cards saved before any path but the fill checked them.
 *  Never a `seed` row (a typed-in card is replaced on a pick, by
 *  isUnsourcedSeedCard) and never a test row. Rounds already played hold their
 *  own copy of the pars. The owner's door only; no schedule runs it. */
export async function runCardAudit(admin: SupabaseClient, opts: { dryRun: boolean }): Promise<CardAuditSummary | { ok: false; error: string }> {
  const t0 = Date.now();
  type Carded = { id: string; name: string; total_par: number | null; holes_count: number | null; hole_data: Array<{ number: number; par: number }> | null };
  const read = await pages<Carded>((from, to) =>
    admin.from('golf_courses').select('id, name, total_par, holes_count, hole_data').not('hole_data', 'is', null).not('external_source', 'in', '(seed,qa-e2e)').order('id').range(from, to)
  );
  if ('ok' in read) return read;
  const failing = read.rows
    .map(r => ({ id: r.id, name: r.name, verdict: cardParsVerdict(r), holes: r.hole_data?.length ?? 0, sum: (r.hole_data ?? []).reduce((s, h) => s + (h.par ?? 0), 0), total: r.total_par }))
    .filter(f => f.verdict !== 'ok');
  const summary: CardAuditSummary = { phase: 'audit', dryRun: opts.dryRun, cards: read.rows.length, failing, withdrawn: 0, elapsedMs: 0 };
  if (!opts.dryRun && failing.length > 0) {
    if (failing.length > AUDIT_WITHDRAW_MAX) return { ok: false, error: `${failing.length} cards fail the check: more than ${AUDIT_WITHDRAW_MAX}, nothing withdrawn` };
    for (const f of failing) {
      const { data, error } = await admin
        .from('golf_courses')
        .update({ hole_data: null, total_par: null, holes_count: null, sheet_sources: null, sheet_fill_at: iso(Date.now()), sheet_fill_outcome: f.verdict })
        .eq('id', f.id)
        .not('hole_data', 'is', null)
        .select('id');
      if (error) return fail(error);
      if ((data ?? []).length) summary.withdrawn++;
    }
    console.warn(`[card-fill] audit: ${summary.withdrawn} cards withdrawn: ${failing.map(f => `"${f.name}" (${f.verdict}: ${f.sum} over ${f.holes}, stated ${f.total ?? 'none'})`).join('; ')}`);
  }
  summary.elapsedMs = Date.now() - t0;
  return summary;
}

// ── Progress ──────────────────────────────────────────────────────────────────

export interface CardFillProgress {
  ok: true;
  courses: number;
  withCard: number;
  linked: number;
  filled: number;
  waiting: number;
  refused: number;
  budget: { count: number; window_start: string } | null;
  link: unknown;
}

export async function readCardFillProgress(admin: SupabaseClient): Promise<CardFillProgress | { ok: false; error: string }> {
  const head = () => admin.from('golf_courses').select('id', { count: 'exact', head: true });
  const [courses, withCard, linked, filled, waiting, refused, budget, link] = await Promise.all([
    head(),
    head().not('hole_data', 'is', null),
    head().not('opengolf_id', 'is', null),
    head().eq('sheet_fill_outcome', 'ok'),
    head().not('opengolf_id', 'is', null).is('hole_data', null).is('sheet_fill_at', null),
    head().not('sheet_fill_at', 'is', null).neq('sheet_fill_outcome', 'ok'),
    admin.from('rate_limits').select('count, window_start').eq('key', 'golf-provider:card-fill').maybeSingle(),
    readMeta(admin, 'card_link'),
  ]);
  const error = [courses, withCard, linked, filled, waiting, refused].find(r => r.error)?.error;
  if (error) return fail(error);
  return {
    ok: true,
    courses: courses.count ?? 0,
    withCard: withCard.count ?? 0,
    linked: linked.count ?? 0,
    filled: filled.count ?? 0,
    waiting: waiting.count ?? 0,
    refused: refused.count ?? 0,
    budget: (budget.data as { count: number; window_start: string } | null) ?? null,
    link,
  };
}
