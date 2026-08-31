// Org-wizard draft persistence (phase 1 round 2) — the composer-draft
// recipe: versioned flat envelope, TTL, PURE parse for node tests, storage
// ops that no-op on throw, restore offered as a notice never silently
// applied. Per-SIDE keys so a league draft and a club draft never collide.
// The draft stores FLATTENED division rows (never the grid's selection
// Sets) — exactly the shape the POST sends.

import type {
  CapabilitiesInput,
  ConnectionsDraftInput,
  DivisionDraftRow,
} from './wizard-validate';

export interface OrgWizardDraft {
  step: string;
  name: string;
  description: string;
  placeLabel: string;
  /** The structured PlaceValue, serialized as-is (PlacePicker's shape). */
  place: unknown | null;
  capabilities: CapabilitiesInput;
  sportKey: string;
  seasonLabel: string;
  divisions: DivisionDraftRow[];
  teams: string[];
  connectionsExisting: ConnectionsDraftInput['existing'];
  connectionsStubs: ConnectionsDraftInput['stubs'];
}

export const WIZARD_DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

const key = (side: 'league' | 'club') => `ea:org-wizard-draft:${side}:v1`;

export function isEmptyOrgWizardDraft(draft: OrgWizardDraft): boolean {
  return (
    draft.name.trim() === '' &&
    draft.description.trim() === '' &&
    draft.divisions.length === 0 &&
    draft.teams.length === 0 &&
    draft.connectionsExisting.length === 0 &&
    draft.connectionsStubs.length === 0
  );
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function parseOrgWizardDraft(raw: string | null, now: number = Date.now()): OrgWizardDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown } & Partial<OrgWizardDraft>;
    if (parsed?.v !== 1 || typeof parsed.savedAt !== 'number') return null;
    if (now - parsed.savedAt > WIZARD_DRAFT_TTL_MS) return null;
    const caps = parsed.capabilities as Partial<CapabilitiesInput> | undefined;
    const draft: OrgWizardDraft = {
      step: str(parsed.step, 'identity'),
      name: str(parsed.name),
      description: str(parsed.description),
      placeLabel: str(parsed.placeLabel),
      place: parsed.place ?? null,
      capabilities: {
        operatesCompetitions: caps?.operatesCompetitions === true,
        operatesTeams: caps?.operatesTeams === true,
      },
      sportKey: str(parsed.sportKey),
      seasonLabel: str(parsed.seasonLabel),
      divisions: Array.isArray(parsed.divisions)
        ? parsed.divisions
            .filter(
              (d): d is DivisionDraftRow =>
                !!d && typeof d === 'object' && typeof (d as DivisionDraftRow).name === 'string' &&
                typeof (d as DivisionDraftRow).sportKey === 'string'
            )
            .slice(0, 60)
        : [],
      teams: Array.isArray(parsed.teams)
        ? parsed.teams.filter((t): t is string => typeof t === 'string').slice(0, 50)
        : [],
      connectionsExisting: Array.isArray(parsed.connectionsExisting)
        ? parsed.connectionsExisting
            .filter(
              (c): c is { id: string; name: string } =>
                !!c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string' &&
                typeof (c as { name?: unknown }).name === 'string'
            )
            .slice(0, 10)
        : [],
      connectionsStubs: Array.isArray(parsed.connectionsStubs)
        ? parsed.connectionsStubs
            .filter(
              (s): s is { name: string } =>
                !!s && typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string'
            )
            .slice(0, 10)
        : [],
    };
    return isEmptyOrgWizardDraft(draft) ? null : draft;
  } catch {
    return null;
  }
}

export function loadOrgWizardDraft(side: 'league' | 'club'): OrgWizardDraft | null {
  try {
    return parseOrgWizardDraft(window.localStorage.getItem(key(side)));
  } catch {
    return null;
  }
}

export function saveOrgWizardDraft(side: 'league' | 'club', draft: OrgWizardDraft): void {
  try {
    if (isEmptyOrgWizardDraft(draft)) {
      window.localStorage.removeItem(key(side));
      return;
    }
    window.localStorage.setItem(key(side), JSON.stringify({ v: 1, savedAt: Date.now(), ...draft }));
  } catch {
    /* ignore */
  }
}

export function clearOrgWizardDraft(side: 'league' | 'club'): void {
  try {
    window.localStorage.removeItem(key(side));
  } catch {
    /* ignore */
  }
}
