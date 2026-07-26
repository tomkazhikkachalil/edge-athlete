import { getAllSports } from '@/lib/config/sports-config';

export interface Achievement {
  id: string;
  profile_id: string;
  title: string;
  description: string | null;
  sport_key: string | null;
  achieved_on: string; // DATE string 'YYYY-MM-DD'
  organization: string | null;
  placement: string | null;
  created_at: string;
  updated_at: string;
}

/** Validated, DB-shaped fields produced from a request body. */
export interface AchievementFields {
  title?: string;
  description?: string | null;
  sport_key?: string | null;
  achieved_on?: string;
  organization?: string | null;
  placement?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function isNotFuture(dateStr: string): boolean {
  // Compare against tomorrow UTC so a user just past midnight in a timezone
  // ahead of the server isn't rejected for "future-dating" today's award.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return dateStr <= tomorrow;
}

function optionalText(value: unknown, maxLen: number, field: string):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > maxLen) {
    return { ok: false, error: `${field} must be ${maxLen} characters or fewer` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate a create/update request body into DB-shaped fields.
 * With `partial: true` (PATCH) absent fields are simply omitted; otherwise
 * (POST) title and achievedOn are required.
 */
export function validateAchievementInput(
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {}
): { ok: true; fields: AchievementFields } | { ok: false; error: string } {
  const fields: AchievementFields = {};
  const partial = opts.partial === true;

  if (body.title !== undefined || !partial) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return { ok: false, error: 'Title is required' };
    }
    const title = body.title.trim();
    if (title.length > 120) {
      return { ok: false, error: 'Title must be 120 characters or fewer' };
    }
    fields.title = title;
  }

  if (body.achievedOn !== undefined || !partial) {
    const achievedOn = body.achievedOn;
    if (
      typeof achievedOn !== 'string' ||
      !DATE_RE.test(achievedOn) ||
      !isRealDate(achievedOn)
    ) {
      return { ok: false, error: 'A valid date (YYYY-MM-DD) is required' };
    }
    if (!isNotFuture(achievedOn)) {
      return { ok: false, error: 'Date cannot be in the future' };
    }
    fields.achieved_on = achievedOn;
  }

  if (body.sportKey !== undefined) {
    const sportKey = body.sportKey;
    if (sportKey === null || sportKey === '') {
      fields.sport_key = null;
    } else if (typeof sportKey === 'string' && getAllSports().includes(sportKey)) {
      fields.sport_key = sportKey;
    } else {
      return { ok: false, error: 'Unknown sport' };
    }
  }

  const description = optionalText(body.description, 1000, 'Description');
  if (!description.ok) return description;
  if (body.description !== undefined) fields.description = description.value;

  const organization = optionalText(body.organization, 120, 'Organization');
  if (!organization.ok) return organization;
  if (body.organization !== undefined) fields.organization = organization.value;

  const placement = optionalText(body.placement, 60, 'Placement');
  if (!placement.ok) return placement;
  if (body.placement !== undefined) fields.placement = placement.value;

  return { ok: true, fields };
}
