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
import { FILL_RETRY_MS, LINK_REFRESH_MS, cardFillVerdict, linkDataset, parseDatasetLine, type CardFillVerdict, type LinkOurs, type LinkTheirs } from '@/lib/golf/card-fill';
import { readMeta, writeMeta } from '@/lib/golf/map-sweep-server';
import { creditSources, mergeSheets, type Sheet } from '@/lib/golf/sheet-merge';

/** OpenGolfAPI's published file (ODbL 1.0; "Contains data from OpenGolfAPI
 *  (opengolfapi.org)" — the catalog's attribution line already names it). */
export const DATASET_URL = 'https://raw.githubusercontent.com/opengolfapi/data/main/opengolfapi-us.ndjson.gz';

const PAGE = 1000;
const LINK_CHUNK = 500;
const CALL_GAP_MS = 300;
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
  const used = new Set(taken.rows.flatMap(r => [r.opengolf_id, r.external_id]).filter((v): v is string => !!v));
  const link = linkDataset(ours.rows, theirs.filter(t => !used.has(t.id)));

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
    await writeMeta(admin, 'card_link', { at: iso(Date.now()), dataset: summary.dataset, linked: summary.linked, unmatched: summary.unmatched, ambiguous: summary.ambiguous });
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
  const at = (await readMeta<{ at?: string }>(admin, 'card_link'))?.at;
  return !at || now - Date.parse(at) > LINK_REFRESH_MS;
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
  for (const row of rows) {
    if (Date.now() > deadline - 7000) break;
    // The fill's own cap first: it always leaves the shared key room for a pick.
    if (!(await consumeProviderBudget(admin, 'card-fill')) || !(await consumeProviderBudget(admin, 'opengolfapi'))) { summary.budgetExhausted = true; break; }
    const detail = await provider.detail(row.opengolf_id);
    const outcome: CardFillVerdict | 'provider_error' | 'taken' = detail ? await saveCard(admin, row, detail.row) : 'provider_error';
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
async function saveCard(admin: SupabaseClient, row: FillRow, card: (Sheet & { lat?: number | null; lng?: number | null }) | null): Promise<CardFillVerdict | 'taken'> {
  const stamp = { sheet_fill_at: iso(Date.now()) };
  const verdict = cardFillVerdict(row, card, card?.hole_data?.length ? await readMapSheet(admin, row.id) : null);
  if (verdict !== 'ok' || !card) {
    await admin.from('golf_courses').update({ ...stamp, sheet_fill_outcome: verdict }).eq('id', row.id);
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
    })
    .eq('id', row.id)
    .is('hole_data', null)
    .select('id');
  if (error) throw new Error(`card fill write failed for ${row.id}: ${error.message}`);
  return (data ?? []).length ? 'ok' : 'taken';
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
