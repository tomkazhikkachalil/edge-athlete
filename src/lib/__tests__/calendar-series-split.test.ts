import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Change a repeating event's schedule from this event on (Nov 6 2026,
// migration 302): a SPLIT, never an in-place rewrite — the cron re-anchors on
// the earliest row and the series row holds no anchor of its own. The route
// takes the change on scope 'following' only, the math stays in TS, the
// persistence is ONE transaction, and nothing is deleted.
const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('migration 302: calendar_series_split', () => {
  const sql = read('database/migrations/302_calendar_series_split.sql');
  it('ends the old series at the anchor, cancels (never deletes) its remaining active rows, creates the new series + rows + guests', () => {
    expect(sql).toMatch(/SET ends = 'until', until_at = p_from, updated_at = now\(\)\s+WHERE id = p_old_series/);
    expect(sql).toMatch(/SET status = 'cancelled', cancelled_at = now\(\), updated_at = now\(\)\s+WHERE series_id = p_old_series\s+AND starts_at >= p_from\s+AND status = 'active'/);
    expect(sql).not.toMatch(/DELETE FROM/);
    expect(sql).toMatch(/INSERT INTO public\.event_series \(organizer_id, freq, interval_n, byweekday, ends, until_at, count_n, generated_until\)/);
    expect(sql).toMatch(/FROM jsonb_array_elements\(p_occurrences\) o/);
    expect(sql).toMatch(/CROSS JOIN jsonb_array_elements\(p_guests\) g/);
    expect(sql).toMatch(/IF v_owner <> p_organizer THEN RAISE EXCEPTION/);
  });
  it('304: the series row is taken FOR UPDATE and a split that cancels nothing raises P0004; the route answers 409; a time change rides no split', () => {
    const h = read('database/migrations/304_harden_round.sql');
    expect(h).toMatch(/SELECT organizer_id INTO v_owner FROM public\.event_series WHERE id = p_old_series FOR UPDATE;/);
    expect(h).toMatch(/IF v_cancelled = 0 THEN\s+RAISE EXCEPTION 'calendar_series_split: nothing to split' USING ERRCODE = 'P0004';/);
    const server = read('src/lib/calendar/series-server.ts');
    expect(server).toContain("if (error.code === 'P0004' || /nothing to split/.test(error.message)) throw new SeriesSplitConflict();");
    const route = read('src/app/api/calendar/events/[id]/route.ts');
    expect(route).toContain('if (err instanceof SeriesSplitConflict) {');
    expect(route).toContain("{ status: 409, headers: { 'Cache-Control': 'no-store' } }");
    expect(route).toContain("return NextResponse.json({ error: 'Change the time and the schedule in two separate saves.' }, { status: 400 });");
    expect(route).toMatch(/wallKey\(validated\.event\.starts_at, validated\.event\.timezone\) !== wallKey\(event\.starts_at, event\.timezone\)/);
  });
  it('definer, service_role only, the ledger row and the result row', () => {
    expect(sql).toMatch(/LANGUAGE plpgsql VOLATILE SECURITY DEFINER\s+SET search_path = public/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.calendar_series_split\(uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.calendar_series_split\(uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb\) TO service_role;/);
    expect(sql).toMatch(/VALUES \(302, '302_calendar_series_split\.sql'\)/);
    expect(sql).toMatch(/ledger_head_expect_302/);
  });
});

describe('the route and the form', () => {
  const route = read('src/app/api/calendar/events/[id]/route.ts');
  it("a rule or a zone change on a series event is a split on scope 'following' only; guests change in their own save", () => {
    expect(route).toContain("const scheduleChange = !!event.series_id && (wantsRule || zoneChanged);");
    expect(route).toContain("if (scheduleChange && scope !== 'following') {");
    expect(route).toContain("Change the guests and the schedule in two separate saves.");
    expect(route).toContain("split = await splitSeries(admin, {");
    expect(route).toContain("status: 503, headers: { 'Cache-Control': 'no-store' }");
    expect(route).not.toContain("cancel the series and create a new one instead");
  });
  it('the planner keeps the wall clock and carries the old rule; the server call is the one RPC', () => {
    const rules = read('src/lib/calendar/recurrence.ts');
    expect(rules).toContain('export function planSeriesSplit(input: SeriesSplitInput): SeriesSplitPlan');
    expect(rules).toContain("const raw = input.rawRecurrence ?? carriedRecurrence(input.oldRule, input.occurrencesBefore, input.newTimezone);");
    const server = read('src/lib/calendar/series-server.ts');
    expect(server).toContain("admin.rpc('calendar_series_split', {");
    expect(server).toContain("if (error.code === 'PGRST202') return null;");
  });
  it('the form: "Change schedule…" opens the rule and the zone on a series event; the only scope offered is this-and-following', () => {
    const form = read('src/components/calendar/EventFormModal.tsx');
    expect(form).toContain('Change schedule…');
    expect(form).toContain("setRepeat(editing?.series ? repeatFromSeries(editing.series, editing.timezone) : emptyRepeat());");
    expect(form).toContain("? [{ value: 'following', label: 'This and following events' }]");
    expect(form).toContain("{!editing && <option value=\"none\">Does not repeat</option>}");
    expect(form).not.toContain("can't be changed");
  });
});
