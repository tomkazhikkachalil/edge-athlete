// ── Roster import (phase 1 R3) — the pure half ──────────────────────────────
// CHARTER: sub-org membership WRITERS live in this module, not members.ts
// (its charter pins scope_type='org'). PR-A ships the parser; PR-B adds
// importRoster/remintAthleteClaim orchestration here.
//
// Line format: `First Last[, email]` — split on the FIRST comma (names may
// not contain commas; emails may not either, per RFC practice we accept).
// The name splits on whitespace: first token = first name, the remainder
// joined = last name (nullable — display falls back fine, handle stays
// NULL). Bad lines land in `errors`, never abort the batch.

export interface RosterImportRow {
  firstName: string;
  lastName: string | null;
  email: string | null;
}

export interface RosterImportParse {
  rows: RosterImportRow[];
  errors: Array<{ line: number; text: string; reason: string }>;
}

const LOOSE_EMAIL = /^\S+@\S+\.\S+$/;

export function parseRosterImport(text: string): RosterImportParse {
  const rows: RosterImportRow[] = [];
  const errors: RosterImportParse['errors'] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const commaAt = line.indexOf(',');
    const namePart = (commaAt === -1 ? line : line.slice(0, commaAt)).trim();
    const emailPart = commaAt === -1 ? '' : line.slice(commaAt + 1).trim();
    if (!namePart) {
      errors.push({ line: i + 1, text: raw, reason: 'Missing name' });
      return;
    }
    if (namePart.length > 120) {
      errors.push({ line: i + 1, text: raw, reason: 'Name too long' });
      return;
    }
    let email: string | null = null;
    if (emailPart) {
      if (!LOOSE_EMAIL.test(emailPart) || emailPart.length > 255) {
        errors.push({ line: i + 1, text: raw, reason: 'Invalid email' });
        return;
      }
      email = emailPart.toLowerCase();
    }
    const nameTokens = namePart.split(/\s+/);
    rows.push({
      firstName: nameTokens[0],
      lastName: nameTokens.length > 1 ? nameTokens.slice(1).join(' ') : null,
      email,
    });
  });
  return { rows, errors };
}
