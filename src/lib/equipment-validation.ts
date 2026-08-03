// Equipment PATCH field validation — pure so it is node-testable; the route
// turns { error } into a 400.

import { getEquipmentSportOptions } from '@/lib/equipment-config';

/** Length caps: TEXT columns have no DB limit, so the API is the guard. */
export const EQUIPMENT_FIELD_CAPS = {
  brand: 120,
  model: 120,
  category: 120,
  notes: 2000,
} as const;

export interface EquipmentPatchBody {
  brand?: unknown;
  model?: unknown;
  category?: unknown;
  sportKey?: unknown;
  specs?: unknown;
  imageUrl?: unknown;
  notes?: unknown;
}

export interface EquipmentPatchCurrent {
  sport_key: string;
}

export type EquipmentPatchResult =
  | { ok: true; updates: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Validates the EDITABLE-FIELD portion of a PATCH body (brand/model/category/
 * sport/specs/image/notes). Status and dates are handled by the route's
 * existing logic. Every field is optional; `undefined` means "unchanged" —
 * that contract is what keeps the three sparse-body callers (status toggle,
 * retire-on-replace, dates-only) working untouched.
 */
export function validateEquipmentPatch(
  body: EquipmentPatchBody,
  current: EquipmentPatchCurrent
): EquipmentPatchResult {
  const updates: Record<string, unknown> = {};

  for (const key of ['brand', 'model'] as const) {
    if (body[key] === undefined) continue;
    const value = String(body[key]).trim();
    if (!value) return { ok: false, error: 'Brand and model cannot be empty' };
    if (value.length > EQUIPMENT_FIELD_CAPS[key]) {
      return { ok: false, error: `${key === 'brand' ? 'Brand' : 'Model'} is too long (max ${EQUIPMENT_FIELD_CAPS[key]} characters)` };
    }
    updates[key] = value;
  }

  if (body.sportKey !== undefined) {
    const sportKey = String(body.sportKey);
    const allowed = getEquipmentSportOptions().some(o => o.value === sportKey);
    if (!allowed) return { ok: false, error: 'Unknown sport' };
    // A sport change invalidates the category list and the specs schema —
    // the caller must say what the item now is.
    if (sportKey !== current.sport_key && body.category === undefined) {
      return { ok: false, error: 'Category is required when changing sport' };
    }
    updates.sport_key = sportKey;
  }

  if (body.category !== undefined) {
    const category = String(body.category).trim();
    if (!category) return { ok: false, error: 'Category cannot be empty' };
    if (category.length > EQUIPMENT_FIELD_CAPS.category) {
      return { ok: false, error: `Category is too long (max ${EQUIPMENT_FIELD_CAPS.category} characters)` };
    }
    updates.category = category;
  }

  if (body.specs !== undefined) {
    if (body.specs === null) {
      updates.specs = null;
    } else if (typeof body.specs === 'object' && !Array.isArray(body.specs)) {
      const entries = Object.entries(body.specs as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'string' && v.trim() !== ''
      );
      updates.specs = entries.length > 0 ? Object.fromEntries(entries) : null;
    } else {
      return { ok: false, error: 'Specs must be an object of text values' };
    }
  }

  if (body.imageUrl !== undefined) {
    const url = body.imageUrl === null ? '' : String(body.imageUrl).trim();
    updates.image_url = url || null;
  }

  if (body.notes !== undefined) {
    const notes = body.notes === null ? '' : String(body.notes).trim();
    if (notes.length > EQUIPMENT_FIELD_CAPS.notes) {
      return { ok: false, error: `Notes are too long (max ${EQUIPMENT_FIELD_CAPS.notes} characters)` };
    }
    updates.notes = notes || null;
  }

  return { ok: true, updates };
}
