'use client';

import { useEffect, useRef, useState } from 'react';
import PlacePicker, { type PlaceValue } from '@/components/PlacePicker';
import StructureGridBuilder, {
  applyTemplateDefaults,
  emptySection,
  sectionRows,
  type SectionState,
} from '@/components/orgs/StructureGridBuilder';
import ConnectionsPicker from '@/components/orgs/ConnectionsPicker';
import { useToast } from '@/components/Toast';
import { FEATURE_FLAGS } from '@/lib/features';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { STRUCTURE_TEMPLATES, defaultSeasonLabel } from '@/lib/orgs/structure-templates';
import {
  clearOrgWizardDraft,
  loadOrgWizardDraft,
  saveOrgWizardDraft,
  type OrgWizardDraft,
} from '@/lib/orgs/wizard-draft';
import type { ConnectionsDraftInput, DivisionDraftRow } from '@/lib/orgs/wizard-validate';

// ── The org onboarding wizard (phase 1 round 2) ─────────────────────────────
// RegistrationSteps' named-union machine: all state hoisted here, sibling
// step blocks, transitions in per-step handlers, drafts autosaved (the
// composer-draft recipe) and offered back as a notice. The parent start
// pages keep their three server-truth states — this component is ONLY the
// form's replacement; submit success bumps the parent's reloadKey and the
// pending banner arrives from the refetch (no optimistic state).

type Step = 'identity' | 'sport' | 'structure' | 'connections' | 'review';

const STEPS_LEAGUE: Step[] = ['identity', 'sport', 'structure', 'connections', 'review'];
const STEPS_CLUB: Step[] = ['identity', 'structure', 'connections', 'review'];

export default function OrgStartWizard({
  side,
  onSubmitted,
}: {
  side: 'league' | 'club';
  onSubmitted: () => void;
}) {
  const { showSuccess, showError } = useToast();
  const steps = side === 'league' ? STEPS_LEAGUE : STEPS_CLUB;

  const [step, setStep] = useState<Step>('identity');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [placeText, setPlaceText] = useState('');
  const [operatesCompetitions, setOperatesCompetitions] = useState(side === 'league');
  const [operatesTeams, setOperatesTeams] = useState(side === 'club');
  const [sportKey, setSportKey] = useState<string>('golf');
  const [seasonLabel, setSeasonLabel] = useState('');
  const [sections, setSections] = useState<SectionState[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [teamInput, setTeamInput] = useState('');
  const [connections, setConnections] = useState<{
    existing: ConnectionsDraftInput['existing'];
    stubs: ConnectionsDraftInput['stubs'];
  }>({ existing: [], stubs: [] });
  const [confirmSportClear, setConfirmSportClear] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [availableDraft, setAvailableDraft] = useState<OrgWizardDraft | null>(null);

  const allDivisions = (): DivisionDraftRow[] => sections.flatMap(sectionRows);

  // Draft rehydrate — async via setTimeout(0) (the RegistrationSteps
  // recipe: lazy initializers hydration-mismatch, sync effect setState
  // trips the cascading-render lint).
  useEffect(() => {
    const t = setTimeout(() => setAvailableDraft(loadOrgWizardDraft(side)), 0);
    return () => clearTimeout(t);
  }, [side]);

  // Debounced autosave of the FLATTENED draft.
  useEffect(() => {
    const t = setTimeout(() => {
      saveOrgWizardDraft(side, {
        step,
        name,
        description,
        placeLabel: placeText,
        place,
        capabilities: { operatesCompetitions, operatesTeams },
        sportKey,
        seasonLabel,
        divisions: sections.flatMap(sectionRows),
        teams,
        connectionsExisting: connections.existing,
        connectionsStubs: connections.stubs,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [side, step, name, description, place, placeText, operatesCompetitions, operatesTeams, sportKey, seasonLabel, sections, teams, connections]);

  const untouched =
    name.trim() === '' && description.trim() === '' && sections.length === 0 && teams.length === 0;

  const restoreDraft = (draft: OrgWizardDraft) => {
    setName(draft.name);
    setDescription(draft.description);
    setPlace((draft.place as PlaceValue | null) ?? null);
    setPlaceText(draft.placeLabel);
    setOperatesCompetitions(draft.capabilities.operatesCompetitions);
    setOperatesTeams(draft.capabilities.operatesTeams);
    if (draft.sportKey) setSportKey(draft.sportKey);
    setSeasonLabel(draft.seasonLabel);
    // Restored grids come back as custom-row sections grouped by sport —
    // selection Sets are deliberately not persisted.
    const bySport = new Map<string, DivisionDraftRow[]>();
    for (const row of draft.divisions) {
      if (!bySport.has(row.sportKey)) bySport.set(row.sportKey, []);
      bySport.get(row.sportKey)!.push(row);
    }
    setSections(
      [...bySport.entries()].map(([sport, rows]) => ({ ...emptySection(sport), extras: rows }))
    );
    setTeams(draft.teams);
    setConnections({ existing: draft.connectionsExisting, stubs: draft.connectionsStubs });
    if (steps.includes(draft.step as Step)) setStep(draft.step as Step);
    setAvailableDraft(null);
  };

  const changeSport = (next: string) => {
    if (side === 'league' && sections.length > 0 && next !== sportKey) {
      setConfirmSportClear(next);
      return;
    }
    setSportKey(next);
  };

  const leagueSection = (): SectionState =>
    sections[0] ?? emptySection(sportKey);

  const addClubSection = (sport: string) => {
    if (sections.some(s => s.sportKey === sport)) return;
    const fresh = emptySection(sport);
    setSections(s => [...s, templateForApply(fresh)]);
  };
  const templateForApply = (s: SectionState) =>
    STRUCTURE_TEMPLATES.some(t => t.sportKey === s.sportKey) ? applyTemplateDefaults(s) : s;

  const addTeam = () => {
    const t = teamInput.trim();
    if (!t || teams.length >= 50 || teams.includes(t)) return;
    setTeams(list => [...list, t]);
    setTeamInput('');
  };

  const stepIndex = steps.indexOf(step);
  const back = () => setStep(steps[Math.max(0, stepIndex - 1)]);
  const next = () => setStep(steps[Math.min(steps.length - 1, stepIndex + 1)]);

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const divisions = allDivisions();
      const hasStructure = divisions.length > 0 || teams.length > 0 || seasonLabel.trim() !== '';
      const hasConnections = connections.existing.length > 0 || connections.stubs.length > 0;
      const response = await fetch(`/api/${side === 'league' ? 'leagues' : 'clubs'}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...(side === 'league' ? { sportKey } : {}),
          description: description.trim() || undefined,
          place,
          capabilities: { operatesCompetitions, operatesTeams },
          ...(hasStructure
            ? {
                structure: {
                  ...(seasonLabel.trim() ? { seasonLabel: seasonLabel.trim() } : {}),
                  divisions,
                  teams,
                },
              }
            : {}),
          ...(hasConnections ? { connections } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError(`${side === 'league' ? 'League' : 'Club'} request`, data.error || 'Could not submit the request');
        if (response.status === 409) onSubmitted();
        return;
      }
      clearOrgWizardDraft(side);
      showSuccess(
        `${side === 'league' ? 'League' : 'Club'} request`,
        "Submitted — we'll notify you when it's reviewed"
      );
      onSubmitted();
    } catch {
      showError('Request', 'Could not submit the request');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border border-border-strong rounded-md outline-none';
  const primaryBtn =
    'w-full sm:w-auto px-4 py-2 text-sm min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50';
  const backLink = (
    <button type="button" onClick={back} className="text-sm text-brand-fg hover:text-brand-fg-strong">
      ← Back
    </button>
  );

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-5 space-y-4">
      <p className="text-xs font-semibold text-tertiary uppercase tracking-wide">
        Step {stepIndex + 1} of {steps.length}
      </p>

      {availableDraft && untouched && (
        <div className="rounded-lg border border-brand bg-brand-soft p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-primary">Pick up where you left off?</p>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => restoreDraft(availableDraft)}
              className="px-3 py-1.5 text-xs rounded-md bg-brand text-white font-medium hover:bg-brand-hover"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => {
                clearOrgWizardDraft(side);
                setAvailableDraft(null);
              }}
              className="px-3 py-1.5 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken"
            >
              Dismiss
            </button>
          </span>
        </div>
      )}

      {step === 'identity' && (
        <div className="space-y-4">
          <div>
            <label htmlFor="wiz-name" className="block text-sm font-medium text-secondary mb-1">
              Name
            </label>
            <input
              id="wiz-name"
              type="text"
              value={name}
              maxLength={120}
              onChange={e => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="wiz-desc" className="block text-sm font-medium text-secondary mb-1">
              Description
            </label>
            <textarea
              id="wiz-desc"
              value={description}
              maxLength={2000}
              rows={3}
              onChange={e => setDescription(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="wiz-place" className="block text-sm font-medium text-secondary mb-1">
              Home town
            </label>
            <PlacePicker
              id="wiz-place"
              value={place}
              text={placeText}
              allowFreeText={false}
              placeholder="City or town"
              onChange={(nextPlace, text) => {
                setPlace(nextPlace);
                setPlaceText(text);
              }}
              className={inputClass}
            />
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-secondary mb-1">
              What does your organization run?
            </legend>
            <label className="flex items-start gap-2 py-1">
              <input
                type="checkbox"
                checked={operatesCompetitions}
                onChange={e => setOperatesCompetitions(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm text-primary">
                We run competitions
                <span className="block text-xs text-muted">Schedules, standings, a house league</span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1">
              <input
                type="checkbox"
                checked={operatesTeams}
                onChange={e => setOperatesTeams(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm text-primary">
                We run teams
                <span className="block text-xs text-muted">Rosters that play in leagues</span>
              </span>
            </label>
          </fieldset>
          <button
            type="button"
            disabled={!name.trim() || (!operatesCompetitions && !operatesTeams)}
            onClick={next}
            className={primaryBtn}
          >
            Continue
          </button>
        </div>
      )}

      {step === 'sport' && side === 'league' && (
        <div className="space-y-4">
          {backLink}
          <div>
            <label htmlFor="wiz-sport" className="block text-sm font-medium text-secondary mb-1">
              Sport
            </label>
            <select
              id="wiz-sport"
              value={sportKey}
              onChange={e => changeSport(e.target.value)}
              className={inputClass}
            >
              {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
                <option key={key} value={key}>
                  {SPORT_REGISTRY[key]?.display_name ?? key}
                </option>
              ))}
            </select>
          </div>
          {confirmSportClear && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
              <p className="text-primary mb-2">
                Changing sport clears the divisions you built. Continue?
              </p>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSportKey(confirmSportClear);
                    setSections([]);
                    setConfirmSportClear(null);
                  }}
                  className="px-3 py-1.5 text-xs rounded-md bg-amber-600 text-white font-medium"
                >
                  Change sport
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmSportClear(null)}
                  className="px-3 py-1.5 text-xs rounded-md border border-border-strong text-secondary"
                >
                  Keep {SPORT_REGISTRY[sportKey as keyof typeof SPORT_REGISTRY]?.display_name ?? sportKey}
                </button>
              </span>
            </div>
          )}
          <button type="button" onClick={next} className={primaryBtn}>
            Continue
          </button>
        </div>
      )}

      {step === 'structure' && (
        <div className="space-y-4">
          {backLink}
          <div>
            <p className="font-medium text-primary">Your program structure</p>
            <p className="text-xs text-muted">
              Optional — you can build all of this later from your console.
            </p>
          </div>
          <div>
            <label htmlFor="wiz-season" className="block text-sm font-medium text-secondary mb-1">
              First season
            </label>
            <input
              id="wiz-season"
              type="text"
              value={seasonLabel}
              maxLength={60}
              onChange={e => setSeasonLabel(e.target.value)}
              placeholder={defaultSeasonLabel(side === 'league' ? sportKey : sections[0]?.sportKey ?? 'soccer')}
              className={inputClass}
            />
          </div>

          {side === 'league' ? (
            <div className="space-y-2">
              {STRUCTURE_TEMPLATES.some(t => t.sportKey === sportKey) && sections.length === 0 && (
                <button
                  type="button"
                  onClick={() => setSections([applyTemplateDefaults(emptySection(sportKey))])}
                  className="px-3 py-2 text-sm rounded-lg border border-brand text-brand-fg hover:bg-brand-soft transition-colors"
                >
                  Start from the{' '}
                  {SPORT_REGISTRY[sportKey as keyof typeof SPORT_REGISTRY]?.display_name ?? sportKey}{' '}
                  template
                </button>
              )}
              {sections.length === 0 && (
                <button
                  type="button"
                  onClick={() => setSections([emptySection(sportKey)])}
                  className="px-3 py-2 text-sm rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                >
                  Build divisions
                </button>
              )}
              {sections[0] && (
                <StructureGridBuilder
                  section={leagueSection()}
                  onChange={s => setSections([s])}
                />
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {STRUCTURE_TEMPLATES.filter(t => !sections.some(s => s.sportKey === t.sportKey)).map(
                  t => (
                    <button
                      key={t.sportKey}
                      type="button"
                      onClick={() => addClubSection(t.sportKey)}
                      className="px-3 py-2 text-sm rounded-lg border border-brand text-brand-fg hover:bg-brand-soft transition-colors"
                    >
                      + {t.label}
                    </button>
                  )
                )}
                <select
                  value=""
                  onChange={e => {
                    if (e.target.value) addClubSection(e.target.value);
                  }}
                  aria-label="Add another sport"
                  className="px-3 py-2 text-sm border border-border-strong rounded-lg outline-none"
                >
                  <option value="">+ Another sport…</option>
                  {FEATURE_FLAGS.FEATURE_SPORTS.filter(
                    key => !sections.some(s => s.sportKey === key)
                  ).map(key => (
                    <option key={key} value={key}>
                      {SPORT_REGISTRY[key]?.display_name ?? key}
                    </option>
                  ))}
                </select>
              </div>
              {sections.map((section, i) => (
                <StructureGridBuilder
                  key={section.sportKey}
                  section={section}
                  onChange={s => setSections(list => list.map((x, j) => (j === i ? s : x)))}
                  onRemove={() => setSections(list => list.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )}

          {allDivisions().length > 60 && (
            <p className="text-xs text-red-600" role="alert">
              Up to 60 divisions per request — remove {allDivisions().length - 60} to continue.
            </p>
          )}

          <div>
            <p className="text-sm font-medium text-secondary mb-1">Teams (optional)</p>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={teamInput}
                maxLength={80}
                onChange={e => setTeamInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTeam();
                  }
                }}
                placeholder="Team name"
                aria-label="Team name"
                className="grow basis-40 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              />
              <button
                type="button"
                onClick={addTeam}
                className="px-3 py-2 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
              >
                Add
              </button>
            </div>
            {teams.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {teams.map(t => (
                  <li
                    key={t}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-surface-sunken text-sm text-secondary"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => setTeams(list => list.filter(x => x !== t))}
                      aria-label={`Remove ${t}`}
                      className="text-muted hover:text-red-600"
                    >
                      <i className="fas fa-times text-xs" aria-hidden="true"></i>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            disabled={allDivisions().length > 60}
            onClick={next}
            className={primaryBtn}
          >
            Continue
          </button>
        </div>
      )}

      {step === 'connections' && (
        <div className="space-y-4">
          {backLink}
          <div>
            <p className="font-medium text-primary">
              {side === 'league' ? 'Which clubs play in your league?' : 'Which leagues do your teams play in?'}
            </p>
            <p className="text-xs text-muted">
              Optional — leagues connect to clubs. Invitations go out when your{' '}
              {side} is approved.
            </p>
          </div>
          <ConnectionsPicker
            searchType={side === 'league' ? 'clubs' : 'leagues'}
            stubNeedsSport={side === 'club'}
            existing={connections.existing}
            stubs={connections.stubs}
            onChange={setConnections}
          />
          <button type="button" onClick={next} className={primaryBtn}>
            Continue
          </button>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          {backLink}
          <p className="font-medium text-primary">Review your request</p>
          <ul className="space-y-2 text-sm">
            <li className="rounded-lg border border-border p-3">
              <span className="block font-medium text-primary">{name || 'Unnamed'}</span>
              <span className="block text-xs text-muted">
                {[
                  side === 'league'
                    ? SPORT_REGISTRY[sportKey as keyof typeof SPORT_REGISTRY]?.display_name ?? sportKey
                    : null,
                  placeText || null,
                  [operatesCompetitions ? 'runs competitions' : null, operatesTeams ? 'runs teams' : null]
                    .filter(Boolean)
                    .join(' + '),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <button type="button" onClick={() => setStep('identity')} className="text-xs text-brand-fg mt-1">
                Edit
              </button>
            </li>
            <li className="rounded-lg border border-border p-3">
              <span className="block text-primary">
                {allDivisions().length} division{allDivisions().length === 1 ? '' : 's'} ·{' '}
                {teams.length} team{teams.length === 1 ? '' : 's'}
                {seasonLabel.trim() ? ` · ${seasonLabel.trim()}` : ''}
              </span>
              <button type="button" onClick={() => setStep('structure')} className="text-xs text-brand-fg mt-1">
                Edit
              </button>
            </li>
            <li className="rounded-lg border border-border p-3">
              <span className="block text-primary">
                {connections.existing.length} connection{connections.existing.length === 1 ? '' : 's'}
                {connections.stubs.length > 0 ? ` · ${connections.stubs.length} to be invited` : ''}
              </span>
              <button type="button" onClick={() => setStep('connections')} className="text-xs text-brand-fg mt-1">
                Edit
              </button>
            </li>
          </ul>
          <button type="button" disabled={submitting || !name.trim()} onClick={() => void submit()} className={primaryBtn}>
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      )}
    </div>
  );
}
