// Registration-wizard draft persistence (phase 5 R3) — the org-wizard
// recipe scaled down: versioned flat envelope, TTL, PURE parse for node
// tests, storage ops that no-op on throw, restore offered as a notice
// never silently applied. Keyed per side+org so two orgs' drafts never
// collide. Medical notes ARE stored here (the family's own device, their
// own draft) — they never leave the browser except in the submit.

export interface RegistrationDraft {
  step: string;
  targetProfileId: string;
  seasonId: string;
  divisionId: string;
  programId: string;
  emergencyName: string;
  emergencyPhone: string;
  medicalNotes: string;
  photoConsent: boolean;
  birthday: string;
}

export const REGISTRATION_DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

export const EMPTY_REGISTRATION_DRAFT: RegistrationDraft = {
  step: 'who',
  targetProfileId: '',
  seasonId: '',
  divisionId: '',
  programId: '',
  emergencyName: '',
  emergencyPhone: '',
  medicalNotes: '',
  photoConsent: false,
  birthday: '',
};

const key = (side: 'league' | 'club', orgId: string) =>
  `ea:registration-draft:${side}:${orgId}:v1`;

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function isEmptyRegistrationDraft(draft: RegistrationDraft): boolean {
  return (
    draft.targetProfileId === '' &&
    draft.divisionId === '' &&
    draft.programId === '' &&
    draft.emergencyName.trim() === '' &&
    draft.medicalNotes.trim() === ''
  );
}

export function parseRegistrationDraft(
  raw: string | null,
  now: number = Date.now()
): RegistrationDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown } & Partial<RegistrationDraft>;
    if (parsed?.v !== 1 || typeof parsed.savedAt !== 'number') return null;
    if (now - parsed.savedAt > REGISTRATION_DRAFT_TTL_MS) return null;
    return {
      step: str(parsed.step, 'who'),
      targetProfileId: str(parsed.targetProfileId),
      seasonId: str(parsed.seasonId),
      divisionId: str(parsed.divisionId),
      programId: str(parsed.programId),
      emergencyName: str(parsed.emergencyName),
      emergencyPhone: str(parsed.emergencyPhone),
      medicalNotes: str(parsed.medicalNotes),
      photoConsent: parsed.photoConsent === true,
      birthday: str(parsed.birthday),
    };
  } catch {
    return null;
  }
}

export function loadRegistrationDraft(side: 'league' | 'club', orgId: string): RegistrationDraft | null {
  try {
    return parseRegistrationDraft(localStorage.getItem(key(side, orgId)));
  } catch {
    return null;
  }
}

export function saveRegistrationDraft(
  side: 'league' | 'club',
  orgId: string,
  draft: RegistrationDraft
): void {
  try {
    localStorage.setItem(key(side, orgId), JSON.stringify({ v: 1, savedAt: Date.now(), ...draft }));
  } catch {
    // storage full/blocked — drafts are a convenience, never load-bearing
  }
}

export function clearRegistrationDraft(side: 'league' | 'club', orgId: string): void {
  try {
    localStorage.removeItem(key(side, orgId));
  } catch {
    // ignore
  }
}
