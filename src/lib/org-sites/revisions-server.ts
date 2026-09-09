import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/leagues/validate';
import {
  applySiteAction,
  diffModuleRows,
  parseSnapshot,
  rowsFromSnapshot,
  selectRevisionsToPrune,
  snapshotFromRows,
  snapshotsEqual,
  type ApplyContext,
  type SiteSnapshot,
  type SnapshotAction,
  type SnapshotModuleRow,
  type SnapshotSiteRow,
} from '@/lib/site-builder/snapshot';
import type { RevisionActionInput } from './validate';

/**
 * Draft / publish / revisions — Site Builder phase 2 (Sep 9 2026, mig 180).
 *
 * A site's edits go to a DRAFT revision (`org_site_revisions`, one row per
 * site with `published_at IS NULL`, pointed at by `org_sites.
 * draft_revision_id`); Publish promotes it: the snapshot is MIRRORED into
 * `org_sites` + `org_site_modules` (which stay the published projection
 * every reader consumes), the row is stamped, `published_revision_id`
 * moves, the slug's cache tag is purged. Restore copies an old snapshot
 * INTO the draft — never onto the live rows. Discard drops the draft.
 *
 * Pre-180 (no table / no pointer columns): every read answers
 * `supported: false`, every write answers a friendly 409, and sitePATCH
 * keeps today's live writes through `applyDraftAction`'s legacy path — the
 * P2-A PR merges before the SQL runs and nothing changes until it does.
 *
 * Concurrency: the draft carries `rev`; every write is
 * `UPDATE … WHERE id AND rev = $seen` → zero rows = someone else wrote →
 * reload and re-apply once → then 409. Publish flips the pointer with
 * `WHERE draft_revision_id = $draft`, so a racing publish/discard is
 * detected rather than doubled.
 */

type Admin = SupabaseClient;
type OrgSide = 'league' | 'club';
const TAG = '[ORG SITE REVISIONS]';

export type RevisionSupport = 'supported' | 'pre180';

export interface RevisionRow {
  id: string;
  site_id: string;
  snapshot: unknown;
  rev: number;
  label: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  published_by: string | null;
}

export interface SitePointers {
  id: string;
  subdomain: string;
  published_at: string | null;
  draft_revision_id: string | null;
  published_revision_id: string | null;
}

export interface RevisionSummary {
  id: string;
  label: string | null;
  createdAt: string;
  publishedAt: string | null;
  createdBy: { id: string; name: string } | null;
  isPublished: boolean;
  isDraft: boolean;
}

export interface DraftSummary {
  id: string;
  rev: number;
  updatedAt: string;
  hasUnpublishedChanges: boolean;
}

const orgColumn = (side: OrgSide) => (side === 'league' ? 'league_id' : 'club_id');
const isPre180 = (error: { code?: string } | null | undefined): boolean =>
  error?.code === '42703' || error?.code === 'PGRST204' || isMissingTableError(error?.code);
const PRE_180 = () =>
  NextResponse.json({ error: 'Drafts and revisions need a database migration first (180)' }, { status: 409 });
const REVISION_FIELDS = 'id, site_id, snapshot, rev, label, created_by, created_at, updated_at, published_at, published_by';

// ── Reads ───────────────────────────────────────────────────────────────────

/** The site with its two pointers — or, pre-180, the site without them. */
export async function loadSitePointers(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<{ site: SitePointers | null; support: RevisionSupport }> {
  const { data, error } = await admin
    .from('org_sites')
    .select('id, subdomain, published_at, draft_revision_id, published_revision_id')
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  if (!error) return { site: (data as SitePointers | null) ?? null, support: 'supported' };
  if (isPre180(error)) {
    const { data: base } = await admin
      .from('org_sites')
      .select('id, subdomain, published_at')
      .eq(orgColumn(side), orgId)
      .maybeSingle();
    const row = base as { id: string; subdomain: string; published_at: string | null } | null;
    return {
      site: row ? { ...row, draft_revision_id: null, published_revision_id: null } : null,
      support: 'pre180',
    };
  }
  console.error(`${TAG} pointer read error:`, error);
  return { site: null, support: 'supported' };
}

/** The current projection: the site's content columns + module rows. */
export async function loadRows(
  admin: Admin,
  siteId: string
): Promise<{ site: SnapshotSiteRow; modules: SnapshotModuleRow[] } | null> {
  const [{ data: site, error }, { data: modules }] = await Promise.all([
    admin
      .from('org_sites')
      .select('template_id, theme_token_set, nav_config, hero_config, contact_config')
      .eq('id', siteId)
      .maybeSingle(),
    admin
      .from('org_site_modules')
      .select('module_key, enabled, sort_order, config')
      .eq('site_id', siteId)
      .order('sort_order', { ascending: true })
      .limit(40),
  ]);
  if (error || !site) return null;
  return { site: site as SnapshotSiteRow, modules: (modules ?? []) as SnapshotModuleRow[] };
}

async function loadRevision(admin: Admin, id: string): Promise<RevisionRow | null> {
  const { data } = await admin.from('org_site_revisions').select(REVISION_FIELDS).eq('id', id).maybeSingle();
  return (data as RevisionRow | null) ?? null;
}

/** The draft's snapshot + its console line (does it differ from the rows,
 *  the published projection?). Null when there is no usable draft. */
export async function loadDraftSnapshot(
  admin: Admin,
  site: SitePointers
): Promise<{ summary: DraftSummary; snapshot: SiteSnapshot } | null> {
  if (!site.draft_revision_id) return null;
  const [draft, rows] = await Promise.all([loadRevision(admin, site.draft_revision_id), loadRows(admin, site.id)]);
  if (!draft || !rows) return null;
  const snapshot = parseSnapshot(draft.snapshot);
  if (!snapshot) return null;
  return {
    snapshot,
    summary: {
      id: draft.id,
      rev: draft.rev,
      updatedAt: draft.updated_at,
      hasUnpublishedChanges: !snapshotsEqual(snapshot, snapshotFromRows(rows.site, rows.modules)),
    },
  };
}

/** The console's draft line alone. */
export async function draftSummary(admin: Admin, site: SitePointers): Promise<DraftSummary | null> {
  return (await loadDraftSnapshot(admin, site))?.summary ?? null;
}

/** The draft snapshot of a site by id — for readers that hold only the
 *  site id (the in-app brand of an OFFLINE site, the preview). Tolerates a
 *  pre-180 database (no pointer column → null). */
export async function loadDraftSnapshotBySiteId(admin: Admin, siteId: string): Promise<SiteSnapshot | null> {
  const { data, error } = await admin.from('org_sites').select('draft_revision_id').eq('id', siteId).maybeSingle();
  if (error || !data?.draft_revision_id) return null;
  const draft = await loadRevision(admin, data.draft_revision_id as string);
  return draft ? parseSnapshot(draft.snapshot) : null;
}

// ── The draft ───────────────────────────────────────────────────────────────

/** The site's draft, materialised from the rows on first use. Null when
 *  the table is missing (pre-180) or the site vanished. */
export async function getOrCreateDraft(
  admin: Admin,
  site: SitePointers,
  userId: string | null,
  depth = 0
): Promise<RevisionRow | null> {
  if (site.draft_revision_id) {
    const existing = await loadRevision(admin, site.draft_revision_id);
    if (existing && parseSnapshot(existing.snapshot)) return existing;
    // The pointer dangled — fall through and materialise a fresh draft.
  }
  const rows = await loadRows(admin, site.id);
  if (!rows) return null;
  const snapshot = snapshotFromRows(rows.site, rows.modules);
  const { data: inserted, error } = await admin
    .from('org_site_revisions')
    .insert({ site_id: site.id, snapshot, rev: 1, created_by: userId })
    .select(REVISION_FIELDS)
    .single();
  if (error || !inserted) {
    if (!isPre180(error)) console.error(`${TAG} draft insert error:`, error);
    return null;
  }
  const draft = inserted as RevisionRow;
  // Claim the pointer only if nobody else did meanwhile.
  const claim = site.draft_revision_id
    ? admin.from('org_sites').update({ draft_revision_id: draft.id }).eq('id', site.id).eq('draft_revision_id', site.draft_revision_id)
    : admin.from('org_sites').update({ draft_revision_id: draft.id }).eq('id', site.id).is('draft_revision_id', null);
  const { data: claimed } = await claim.select('id');
  if (!claimed || claimed.length === 0) {
    await admin.from('org_site_revisions').delete().eq('id', draft.id);
    if (depth > 0) return null;
    // A concurrent request won the claim — use its draft.
    const { data: refreshed } = await admin
      .from('org_sites')
      .select('id, subdomain, published_at, draft_revision_id, published_revision_id')
      .eq('id', site.id)
      .maybeSingle();
    return refreshed ? getOrCreateDraft(admin, refreshed as SitePointers, userId, depth + 1) : null;
  }
  return draft;
}

export async function writeDraft(
  admin: Admin,
  draft: RevisionRow,
  next: SiteSnapshot
): Promise<'ok' | 'conflict' | 'error'> {
  const { data, error } = await admin
    .from('org_site_revisions')
    .update({ snapshot: next, rev: draft.rev + 1 })
    .eq('id', draft.id)
    .eq('rev', draft.rev)
    .select('id');
  if (error) {
    console.error(`${TAG} draft write error:`, error);
    return 'error';
  }
  return data && data.length > 0 ? 'ok' : 'conflict';
}

/** Mirror a snapshot into the rows: per-row UPDATE of the diff (insert
 *  when missing — never upsert), then the site's content columns. */
export async function writeSnapshotToRows(
  admin: Admin,
  siteId: string,
  prev: SiteSnapshot | null,
  next: SiteSnapshot
): Promise<{ ok: true } | { ok: false; code?: string }> {
  for (const row of diffModuleRows(prev, next)) {
    const { data: updated, error } = await admin
      .from('org_site_modules')
      .update({ enabled: row.enabled, sort_order: row.sort_order, config: row.config })
      .eq('site_id', siteId)
      .eq('module_key', row.module_key)
      .select('module_key');
    if (error) {
      console.error(`${TAG} module mirror error:`, error);
      return { ok: false, code: error.code };
    }
    if (!updated || updated.length === 0) {
      const { error: insertError } = await admin
        .from('org_site_modules')
        .insert({ site_id: siteId, module_key: row.module_key, enabled: row.enabled, sort_order: row.sort_order, config: row.config });
      if (insertError && insertError.code !== '23514') {
        console.error(`${TAG} module mirror insert error:`, insertError);
        return { ok: false, code: insertError.code };
      }
    }
  }
  const { site } = rowsFromSnapshot(next);
  const { error } = await admin.from('org_sites').update(site).eq('id', siteId);
  if (error) {
    console.error(`${TAG} site mirror error:`, error);
    return { ok: false, code: error.code };
  }
  return { ok: true };
}

export interface ApplyDraftResult {
  status: 'draft' | 'live' | 'conflict' | 'error' | 'not_found';
  /** The site's slug (for the legacy path's revalidation). */
  subdomain?: string;
  draft?: DraftSummary;
  /** The snapshot after the action (response shapes read counts off it). */
  snapshot?: SiteSnapshot;
}

/** Apply a content action to the site: to its DRAFT when 180 has run, to
 *  the live rows (today's behaviour, one code path) before. */
export async function applyDraftAction(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  userId: string | null,
  action: SnapshotAction,
  ctx: ApplyContext
): Promise<ApplyDraftResult> {
  const { site, support } = await loadSitePointers(admin, side, orgId);
  if (!site) return { status: 'not_found' };
  if (support === 'pre180') {
    const rows = await loadRows(admin, site.id);
    if (!rows) return { status: 'not_found' };
    const prev = snapshotFromRows(rows.site, rows.modules);
    const next = applySiteAction(prev, action, ctx);
    const written = await writeSnapshotToRows(admin, site.id, prev, next);
    if (!written.ok) return { status: 'error' };
    revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
    return { status: 'live', subdomain: site.subdomain, snapshot: next };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const draft = await getOrCreateDraft(admin, site, userId);
    if (!draft) {
      // The table is missing although the pointer columns exist: treat as
      // pre-180 rather than fail the edit.
      const rows = await loadRows(admin, site.id);
      if (!rows) return { status: 'not_found' };
      const prev = snapshotFromRows(rows.site, rows.modules);
      const next = applySiteAction(prev, action, ctx);
      const written = await writeSnapshotToRows(admin, site.id, prev, next);
      if (!written.ok) return { status: 'error' };
      revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
      return { status: 'live', subdomain: site.subdomain, snapshot: next };
    }
    const current = parseSnapshot(draft.snapshot);
    if (!current) return { status: 'error' };
    const next = applySiteAction(current, action, ctx);
    const result = await writeDraft(admin, draft, next);
    if (result === 'ok') {
      const summary = await draftSummary(admin, { ...site, draft_revision_id: draft.id });
      return { status: 'draft', subdomain: site.subdomain, snapshot: next, ...(summary ? { draft: summary } : {}) };
    }
    if (result === 'error') return { status: 'error' };
    site.draft_revision_id = draft.id; // reload the draft and re-apply once
  }
  return { status: 'conflict' };
}

// ── The layout (P3-B) ──────────────────────────────────────────────────────

export type WriteLayoutResult =
  | { status: 'ok'; rev: number }
  | { status: 'conflict' | 'not_found' | 'pre180' | 'error' };

/** The editor's save: the grid layout into the draft snapshot's `layout`
 *  slot, rev-guarded. `baseRev` is the rev the editor last saw — a stale one
 *  answers `conflict` (the editor reloads and re-applies); absent = take the
 *  current draft. Nothing public is revalidated: the layout goes live with
 *  the draft, on publish. */
export async function writeDraftLayout(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  userId: string | null,
  layout: unknown,
  baseRev?: number
): Promise<WriteLayoutResult> {
  const { site, support } = await loadSitePointers(admin, side, orgId);
  if (!site) return { status: 'not_found' };
  if (support === 'pre180') return { status: 'pre180' };
  const draft = await getOrCreateDraft(admin, site, userId);
  if (!draft) return { status: 'pre180' };
  if (baseRev !== undefined && baseRev !== draft.rev) return { status: 'conflict' };
  const current = parseSnapshot(draft.snapshot);
  if (!current) return { status: 'error' };
  const result = await writeDraft(admin, draft, { ...current, layout });
  if (result === 'ok') return { status: 'ok', rev: draft.rev + 1 };
  return { status: result === 'conflict' ? 'conflict' : 'error' };
}

// ── Publish / discard / restore / label ─────────────────────────────────────

export interface PublishResult {
  status: 'published' | 'noop' | 'materialised' | 'raced' | 'error' | 'template_check' | 'not_found';
  revisionId?: string;
}

/** Promote the draft: rows ← snapshot, stamp, pointer flip, prune, purge. */
export async function publishDraft(
  admin: Admin,
  site: SitePointers,
  userId: string | null,
  label?: string
): Promise<PublishResult> {
  const rows = await loadRows(admin, site.id);
  if (!rows) return { status: 'not_found' };
  const now = new Date().toISOString();

  if (!site.draft_revision_id) {
    if (site.published_revision_id) return { status: 'noop', revisionId: site.published_revision_id };
    // History point #1: the rows as they stand become the first published revision.
    const { data, error } = await admin
      .from('org_site_revisions')
      .insert({ site_id: site.id, snapshot: snapshotFromRows(rows.site, rows.modules), rev: 1, created_by: userId, published_at: now, published_by: userId, label: label ?? null })
      .select('id')
      .single();
    if (error || !data) {
      if (!isPre180(error)) console.error(`${TAG} materialise error:`, error);
      return { status: 'error' };
    }
    await admin.from('org_sites').update({ published_revision_id: data.id }).eq('id', site.id);
    return { status: 'materialised', revisionId: data.id as string };
  }

  const draft = await loadRevision(admin, site.draft_revision_id);
  const snapshot = draft ? parseSnapshot(draft.snapshot) : null;
  if (!draft || !snapshot) return { status: 'not_found' };

  const prev = snapshotFromRows(rows.site, rows.modules);
  const written = await writeSnapshotToRows(admin, site.id, prev, snapshot);
  if (!written.ok) return { status: written.code === '23514' ? 'template_check' : 'error' };

  const { error: stampError } = await admin
    .from('org_site_revisions')
    .update({ published_at: now, published_by: userId, ...(label ? { label } : {}) })
    .eq('id', draft.id);
  if (stampError) {
    console.error(`${TAG} stamp error:`, stampError);
    return { status: 'error' };
  }
  const { data: flipped } = await admin
    .from('org_sites')
    .update({ published_revision_id: draft.id, draft_revision_id: null })
    .eq('id', site.id)
    .eq('draft_revision_id', draft.id)
    .select('id');
  if (!flipped || flipped.length === 0) return { status: 'raced' };

  // Retention: newest 50 published + labelled + the one just published.
  const { data: history } = await admin
    .from('org_site_revisions')
    .select('id, label, published_at, created_at')
    .eq('site_id', site.id)
    .not('published_at', 'is', null);
  const prune = selectRevisionsToPrune((history ?? []) as { id: string; label: string | null; published_at: string | null; created_at: string }[], [draft.id]);
  if (prune.length > 0) await admin.from('org_site_revisions').delete().in('id', prune);

  revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
  return { status: 'published', revisionId: draft.id };
}

export async function discardDraft(admin: Admin, site: SitePointers): Promise<'ok' | 'noop'> {
  if (!site.draft_revision_id) return 'noop';
  await admin.from('org_sites').update({ draft_revision_id: null }).eq('id', site.id).eq('draft_revision_id', site.draft_revision_id);
  await admin.from('org_site_revisions').delete().eq('id', site.draft_revision_id).is('published_at', null);
  return 'ok';
}

/** Copy an old revision INTO the draft (never onto the live rows). */
export async function restoreRevision(
  admin: Admin,
  site: SitePointers,
  userId: string | null,
  revisionId: string
): Promise<'ok' | 'not_found' | 'conflict' | 'error'> {
  const target = await loadRevision(admin, revisionId);
  const snapshot = target && target.site_id === site.id ? parseSnapshot(target.snapshot) : null;
  if (!snapshot) return 'not_found';
  for (let attempt = 0; attempt < 2; attempt++) {
    const draft = await getOrCreateDraft(admin, site, userId);
    if (!draft) return 'error';
    const result = await writeDraft(admin, draft, snapshot);
    if (result === 'ok') return 'ok';
    if (result === 'error') return 'error';
    site.draft_revision_id = draft.id;
  }
  return 'conflict';
}

export async function labelRevision(admin: Admin, site: SitePointers, revisionId: string, label: string | null): Promise<'ok' | 'not_found'> {
  const { data } = await admin
    .from('org_site_revisions')
    .update({ label })
    .eq('id', revisionId)
    .eq('site_id', site.id)
    .select('id');
  return data && data.length > 0 ? 'ok' : 'not_found';
}

// ── The route handlers ──────────────────────────────────────────────────────

const REVISION_LIST_MAX = 50;

export async function revisionsGET(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  const { site, support } = await loadSitePointers(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  if (support === 'pre180') {
    return NextResponse.json({ supported: false, draft: null, publishedRevisionId: null, revisions: [] });
  }
  const { data, error } = await admin
    .from('org_site_revisions')
    .select('id, label, created_at, created_by, published_at')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })
    .limit(REVISION_LIST_MAX + 1);
  if (error) {
    if (isPre180(error)) return NextResponse.json({ supported: false, draft: null, publishedRevisionId: null, revisions: [] });
    console.error(`${TAG} list error:`, error);
    return NextResponse.json({ error: 'Failed to load revisions' }, { status: 500 });
  }
  const rows = (data ?? []) as { id: string; label: string | null; created_at: string; created_by: string | null; published_at: string | null }[];
  const ids = [...new Set(rows.map(r => r.created_by).filter((v): v is string => !!v))];
  const { data: profiles } = ids.length
    ? await admin.from('profiles').select('id, first_name, last_name, full_name, display_name').in('id', ids)
    : { data: [] as Record<string, unknown>[] };
  const byId = new Map((profiles ?? []).map(p => [p.id as string, p as Record<string, unknown>]));
  const name = (id: string | null) => {
    if (!id) return null;
    const p = byId.get(id);
    if (!p) return null;
    const n =
      [p.first_name, p.last_name].filter(Boolean).join(' ') ||
      (p.full_name as string | null) ||
      (p.display_name as string | null) ||
      'Member';
    return { id, name: n };
  };
  const revisions: RevisionSummary[] = rows.map(r => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    createdBy: name(r.created_by),
    isPublished: r.id === site.published_revision_id,
    isDraft: r.id === site.draft_revision_id,
  }));
  const draft = await draftSummary(admin, site);
  return NextResponse.json({ supported: true, draft, publishedRevisionId: site.published_revision_id, revisions });
}

export async function revisionsPOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  userId: string,
  input: RevisionActionInput
): Promise<NextResponse> {
  const { site, support } = await loadSitePointers(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  if (support === 'pre180') return PRE_180();

  switch (input.action) {
    case 'publish': {
      const result = await publishDraft(admin, site, userId, input.label);
      switch (result.status) {
        case 'published':
        case 'materialised':
        case 'noop':
          return NextResponse.json({ ok: true, status: result.status, revisionId: result.revisionId ?? null });
        case 'raced':
          return NextResponse.json({ error: 'The draft changed while publishing — reload and try again' }, { status: 409 });
        case 'template_check':
          return NextResponse.json({ error: 'This template needs a database migration first (170)' }, { status: 409 });
        case 'not_found':
          return NextResponse.json({ error: 'Site not found' }, { status: 404 });
        default:
          return NextResponse.json({ error: 'Failed to publish' }, { status: 500 });
      }
    }
    case 'discard': {
      const result = await discardDraft(admin, site);
      return NextResponse.json({ ok: true, status: result });
    }
    case 'restore': {
      const result = await restoreRevision(admin, site, userId, input.revisionId);
      if (result === 'ok') {
        const { site: fresh } = await loadSitePointers(admin, side, orgId);
        const draft = fresh ? await draftSummary(admin, fresh) : null;
        return NextResponse.json({ ok: true, draft });
      }
      if (result === 'not_found') return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
      if (result === 'conflict') return NextResponse.json({ error: 'The draft changed while restoring — reload and try again' }, { status: 409 });
      return NextResponse.json({ error: 'Failed to restore' }, { status: 500 });
    }
    case 'label': {
      const result = await labelRevision(admin, site, input.revisionId, input.label);
      if (result === 'not_found') return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
