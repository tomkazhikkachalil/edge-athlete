// ── Org setup checklist — the PURE half (phase 1; phase 7 C5 variants) ──────
// Every `done` is DERIVED from rows the console already fetched (no
// checklist table, no fetch of its own — "a checklist, not a blank page").
// C5: a GOLF org's console is a site builder first, so its checklist is
// golf-shaped — the site, a photo and a booking link, the (optional) home
// course, publish, members, the first league, a word to the members. Steps
// carry an anchor into the console section that completes them. Optional
// steps never block "all done". Node-tested.

export interface OrgChecklistInput {
  hasSeasonWithDates: boolean;
  hasDivisions: boolean;
  hasTeams: boolean;
  managerCount: number;
  rosterAthleteCount: number;
  /** Phase 5: optional so pre-registration callers/tests stay valid —
   *  undefined omits the step entirely (flag-off consoles don't nag). */
  hasOpenRegistration?: boolean;
  // Phase 7 C5 — the golf variant's inputs (all optional; absent = not done).
  hasSite?: boolean;
  hasSitePhotoOrCta?: boolean;
  hasHomeCourse?: boolean;
  sitePublished?: boolean;
  /** Every membership row (owner included) — a lone owner has 1. */
  memberCount?: number;
  hasGolfLeague?: boolean;
  hasNotice?: boolean;
}

export type ChecklistVariant = 'default' | 'golf';

export interface ChecklistStep {
  key: string;
  done: boolean;
  label: string;
  hint: string;
  /** An in-page anchor to the console section that completes the step. */
  href?: string;
  /** Never counts against "all done" (a golf club need not name a home course). */
  optional?: boolean;
}

export function buildOrgChecklistSteps(
  input: OrgChecklistInput,
  variant: ChecklistVariant = 'default'
): ChecklistStep[] {
  if (variant === 'golf') {
    return [
      {
        key: 'site',
        done: input.hasSite === true,
        label: 'Create your site',
        hint: 'Your club’s home on the web — standings, leaders and the week’s play, live.',
        href: '#website',
      },
      {
        key: 'brand',
        done: input.hasSitePhotoOrCta === true,
        label: 'Add a photo and a booking link',
        hint: 'A hero photo and a “Book a tee time” button make it yours.',
        href: '#website',
      },
      {
        key: 'course',
        done: input.hasHomeCourse === true,
        label: 'Add your home course (optional)',
        hint: 'Your club can play anywhere — a home course shows its holes and stats on your site.',
        href: '#venues',
        optional: true,
      },
      {
        key: 'publish',
        done: input.sitePublished === true,
        label: 'Publish your site',
        hint: 'Preview it, then go live — approval unlocks this.',
        href: '#website',
      },
      {
        key: 'members',
        done: (input.memberCount ?? 0) > 1,
        label: 'Invite members',
        hint: 'Share your join link or import a roster — leagues fill from your members.',
        href: '#roster',
      },
      {
        key: 'league',
        done: input.hasGolfLeague === true,
        label: 'Create your first league',
        hint: 'A golf leaderboard with weekly rounds — it fills itself from posted scores.',
        href: '#competitions',
      },
      {
        key: 'notice',
        done: input.hasNotice === true,
        label: 'Tell your members',
        hint: 'A notice on your site and a bell to every member.',
        href: '#website',
      },
    ];
  }
  return [
    {
      key: 'season',
      done: input.hasSeasonWithDates,
      label: 'Create a season with dates',
      hint: 'Everything else hangs off a season — “2026-27” with a start and end.',
      href: '#seasons',
    },
    {
      key: 'divisions',
      done: input.hasDivisions,
      label: 'Add your divisions',
      hint: 'Age band × stream × tier — the shape your programs actually run.',
      href: '#seasons',
    },
    {
      key: 'teams',
      done: input.hasTeams,
      label: 'Add teams and enter them',
      hint: 'Teams persist across seasons; enter them into this season’s divisions.',
      href: '#teams',
    },
    {
      key: 'managers',
      done: input.managerCount >= 2,
      label: 'Invite a co-manager',
      hint: 'Promote a member from the members list on your public page.',
    },
    {
      key: 'roster',
      done: input.rosterAthleteCount > 0,
      label: 'Roster your first athlete',
      hint: 'Invite a member to the roster — the record edge stats attach to.',
      href: '#roster',
    },
    ...(input.hasOpenRegistration === undefined
      ? []
      : [
          {
            key: 'registration',
            done: input.hasOpenRegistration,
            label: 'Open registration',
            hint: 'Let families register themselves — placements land on the roster.',
            href: '#registrations',
          },
        ]),
  ];
}

/** The steps that still gate "all done" (optional ones never do). */
export function remainingSteps(steps: ChecklistStep[]): ChecklistStep[] {
  return steps.filter(s => !s.done && !s.optional);
}
