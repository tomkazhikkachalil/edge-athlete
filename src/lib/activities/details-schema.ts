// ── The server's reading of a Finish's answers (Oct 16 2026) — zod ─────────
// details.ts is the table (zod-free — the feed reads it); this file turns a
// request body into what the writer stores, refusing anything the type's
// table does not allow, by name. Server routes only.

import { z } from 'zod';
import type { ActivityType } from './catalog';
import { detailFieldsFor, EFFORT_MAX, EFFORT_MIN, NOTES_MAX, withoutHiddenAnswers, type DetailField, type Details } from './details';

function fieldSchema(f: DetailField): z.ZodTypeAny {
  switch (f.kind) {
    case 'choice':
      return z.enum(f.options.map(o => o.value) as [string, ...string[]]);
    case 'multi': {
      const values = f.options.map(o => o.value) as [string, ...string[]];
      return z.array(z.enum(values)).min(1).max(values.length).refine(a => new Set(a).size === a.length, 'no repeats');
    }
    case 'bool':
      return z.boolean();
    case 'number': {
      const n = z.number().finite().min(f.min).max(f.max);
      return f.integer ? n.int() : n;
    }
    case 'text':
      return z.string().trim().min(1).max(f.max);
  }
}

/** The STORED details for a type: its non-column fields, each optional, nothing else. */
export function detailsSchema(type: ActivityType) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of detailFieldsFor(type)) if (!(f.kind === 'number' && f.column)) shape[f.key] = fieldSchema(f).optional();
  return z.object(shape).strict();
}

/** What a Finish (or an edit) sends beside the recording. */
export interface FinishAnswers {
  effort?: number | null;
  notes?: string | null;
  details?: Details | null;
  avgPower?: number | null;
  avgCadence?: number | null;
}


/**
 * The server's reading of a Finish's answers for a type. Details are split:
 * a field with a `column` comes back as avgPower / avgCadence, the rest as
 * the stored object (null when nothing was answered). Unknown keys, a value
 * outside its options or bounds, an effort outside 1–10 are refused by name.
 */
export function parseFinishAnswers(
  type: ActivityType,
  raw: unknown
): { ok: true; value: { effort: number | null; notes: string | null; details: Details | null; avgPower: number | null; avgCadence: number | null } } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: { effort: null, notes: null, details: null, avgPower: null, avgCadence: null } };
  const outer = z
    .object({
      effort: z.number().int().min(EFFORT_MIN).max(EFFORT_MAX).nullable().optional(),
      notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
      details: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .strict()
    .safeParse(raw);
  if (!outer.success) {
    const i = outer.error.issues[0];
    return { ok: false, error: i ? `finish.${i.path.join('.') || '?'}: ${i.message}` : 'Invalid answers.' };
  }
  const given = outer.data.details ?? {};
  const columns: { avgPower: number | null; avgCadence: number | null } = { avgPower: null, avgCadence: null };
  const stored: Record<string, unknown> = {};
  const fields = detailFieldsFor(type);
  for (const [k, v] of Object.entries(given)) {
    const f = fields.find(x => x.key === k);
    if (f && f.kind === 'number' && f.column) {
      const r = fieldSchema(f).safeParse(v);
      if (!r.success) return { ok: false, error: `finish.details.${k}: ${r.error.issues[0]?.message ?? 'invalid'}` };
      if (f.column === 'avg_power') columns.avgPower = r.data as number;
      else columns.avgCadence = r.data as number;
    } else stored[k] = v;
  }
  const r = detailsSchema(type).safeParse(stored);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, error: i ? `finish.details.${i.path.join('.') || '?'}: ${i.message}` : 'Invalid details.' };
  }
  const kept = withoutHiddenAnswers(type, r.data as Details);
  const details = Object.keys(kept).length > 0 ? kept : null;
  const notes = outer.data.notes && outer.data.notes.length > 0 ? outer.data.notes : null;
  return { ok: true, value: { effort: outer.data.effort ?? null, notes, details, ...columns } };
}

