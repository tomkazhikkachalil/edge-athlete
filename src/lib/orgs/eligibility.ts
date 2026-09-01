// ── Eligibility — warn, never block (phase 5, Tom's call Sep 1) ─────────────
// Divisions carry free-text age_band/gender_stream from the
// structure-templates vocabulary; athletes carry profiles.birthday and
// profiles.gender — both optional, and import stubs have neither. Hard
// blocks would lie, so eligibility is a PURE warning computation:
// evaluated at submission, snapshotted into registrations.eligibility,
// rendered softly in the wizard and as badges on the registrar list.
// The registrar decides at placement.
//
// Age convention: age as of DECEMBER 31 of the season's starting year
// (the minor-hockey convention) — "U13" means under 13 on that date.
// Free-text bands that don't parse produce NO check, never a warning.

export interface EligibilityWarning {
  kind: 'age_over' | 'age_unknown' | 'gender_mismatch';
  message: string;
}

/** "U13" → 13; case-insensitive; anything else (Senior, free text) → null
 *  = no age rule. */
export function ageBandCap(band: string | null | undefined): number | null {
  if (!band) return null;
  const m = /^u(\d{1,2})$/i.exec(band.trim());
  if (!m) return null;
  const cap = parseInt(m[1], 10);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

/** Girls→female, Boys→male; Mixed/Coed/unknown → null = no gender rule. */
export function streamGender(stream: string | null | undefined): 'female' | 'male' | null {
  const s = (stream ?? '').trim().toLowerCase();
  if (s === 'girls' || s === 'women' || s === 'female') return 'female';
  if (s === 'boys' || s === 'men' || s === 'male') return 'male';
  return null;
}

/** Whole years old on Dec 31 of `seasonStartYear`. */
export function ageOnDec31(birthday: string, seasonStartYear: number): number {
  const birthYear = parseInt(birthday.slice(0, 4), 10);
  return seasonStartYear - birthYear;
}

export interface EligibilityInput {
  division: { age_band: string | null; gender_stream: string | null } | null;
  athlete: { birthday: string | null; gender: string | null };
  /** seasons.starts_on (YYYY-MM-DD) — absent seasons check nothing. */
  seasonStartsOn: string | null;
}

/** The full warning set for one registration. Pure; snapshot the result. */
export function eligibilityWarnings(input: EligibilityInput): EligibilityWarning[] {
  const warnings: EligibilityWarning[] = [];
  if (!input.division) return warnings; // programs carry no rules in v1

  const cap = ageBandCap(input.division.age_band);
  if (cap !== null) {
    if (!input.athlete.birthday) {
      warnings.push({
        kind: 'age_unknown',
        message: `No date of birth on file — ${input.division.age_band} eligibility can’t be checked`,
      });
    } else if (input.seasonStartsOn) {
      const seasonYear = parseInt(input.seasonStartsOn.slice(0, 4), 10);
      if (Number.isFinite(seasonYear)) {
        const age = ageOnDec31(input.athlete.birthday, seasonYear);
        if (age >= cap) {
          warnings.push({
            kind: 'age_over',
            message: `Age ${age} on Dec 31, ${seasonYear} — over the ${input.division.age_band} band`,
          });
        }
      }
    }
  }

  const required = streamGender(input.division.gender_stream);
  if (required && input.athlete.gender && input.athlete.gender !== 'custom') {
    if (input.athlete.gender !== required) {
      warnings.push({
        kind: 'gender_mismatch',
        message: `Profile doesn’t match the ${input.division.gender_stream} stream`,
      });
    }
  }
  return warnings;
}
