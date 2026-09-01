'use client';

/**
 * The profile's "Sports" section: one card per sport the athlete plays, each
 * leading with that sport's native skill metric (golf → the computed
 * handicap estimate, team sports → level played) plus stat tiles and
 * declared details.
 *
 * Purely presentational over `SportSkillCard[]` — all sport-specific logic
 * lives in the server modules (`src/lib/sports/server/`). Every metric
 * carries provenance, rendered deliberately loudly (Tom's call): Tracked =
 * calculated from real activity in the app; Self-reported = the athlete
 * typed it. The two must never read as the same kind of number — the same
 * anti-conflation rule as "Handicap est." vs "Official index
 * (self-reported)".
 *
 * `/u/[username]` passes `initialCards` from its aggregate payload and
 * ALWAYS `isOwner={false}` (that page renders even the owner as a visitor,
 * and its payload is CDN-cached viewer-independent). The /athlete routes
 * omit `initialCards` and this component fetches
 * `/api/profile/[id]/skill-cards` itself.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSportDefinition } from '@/lib/sports/SportRegistry';
import type {
  SkillProvenance,
  SkillTile,
  SportSkillCard,
} from '@/lib/sports/server/types';
import SportSettingsRow from './SportSettingsRow';

interface SportSkillCardsProps {
  profileId: string;
  isOwner: boolean;
  /** When provided (the /u/ aggregate), no client fetch happens. */
  initialCards?: SportSkillCard[];
  /** Owner-only: opens the competitive-details editor. With no cards to
   *  show, the owner gets an add-affordance card instead of nothing (the
   *  vitals-hero empty-slot pattern) — visitors still get nothing. */
  onAddDetails?: () => void;
  /** Section anchor id. Override when embedding a second instance on a page
   *  that already carries the profile-body `#sports` section. */
  sectionId?: string;
}

const PROVENANCE_TITLE: Record<SkillProvenance, string> = {
  sanctioned: 'Recorded in a sanctioned competition — the strongest verification tier',
  league_verified: 'Entered and verified by the competition owner',
  club_recorded: 'Recorded by team staff — not yet league-verified',
  tracked: 'Calculated from logged activity on Edge Athlete',
  imported: 'Imported historical record — labeled, not verified here',
  entered: 'Entered by the athlete — not verified',
};

// Display the ACTUAL rung, never a generic "verified" — the ladder is the
// integrity story a scout interrogates (masterplan §7). Official rungs
// read strong (brand + shield); tracked keeps its check; claimed stays
// visually distinct, as always.
const PROVENANCE_LABEL: Record<SkillProvenance, string> = {
  sanctioned: 'Sanctioned',
  league_verified: 'League verified',
  club_recorded: 'Club recorded',
  tracked: 'Tracked',
  imported: 'Imported',
  entered: 'Self-reported',
};

const OFFICIAL: Set<SkillProvenance> = new Set(['sanctioned', 'league_verified', 'club_recorded']);

export function provenanceIcon(provenance: SkillProvenance): string {
  if (OFFICIAL.has(provenance)) return 'fa-shield-halved';
  if (provenance === 'tracked') return 'fa-circle-check';
  if (provenance === 'imported') return 'fa-box-archive';
  return 'fa-user-pen';
}

export function ProvenanceChip({ provenance }: { provenance: SkillProvenance }) {
  const strong = OFFICIAL.has(provenance) || provenance === 'tracked';
  return (
    <span
      title={PROVENANCE_TITLE[provenance]}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        strong ? 'bg-brand-soft text-brand-fg-strong' : 'bg-surface-muted text-muted'
      }`}
    >
      <i className={`fas ${provenanceIcon(provenance)}`} aria-hidden="true"></i>
      {PROVENANCE_LABEL[provenance]}
    </span>
  );
}

export function TileGrid({ tiles }: { tiles: SkillTile[] }) {
  if (tiles.length === 0) return null;
  return (
    // 2-up below sm: three narrow columns wrap labels into the values.
    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
      {tiles.map(tile => (
        <div key={tile.label} className="text-center">
          <span className="block text-2xl font-bold text-primary">{tile.value}</span>
          <span
            className="text-xs text-muted inline-flex items-center gap-1"
            title={PROVENANCE_TITLE[tile.provenance]}
          >
            {tile.label}
            <i
              className={`fas ${provenanceIcon(tile.provenance)} ${
                tile.provenance === 'entered' || tile.provenance === 'imported'
                  ? ''
                  : 'text-brand-fg'
              } text-[10px]`}
              aria-hidden="true"
            ></i>
          </span>
        </div>
      ))}
    </div>
  );
}

function CardBody({ card }: { card: SportSkillCard }) {
  const sportDef = getSportDefinition(card.sportKey);
  return (
    <>
      <h2 className="text-sm font-semibold text-secondary flex items-center gap-2">
        <i className={sportDef.icon_id} aria-hidden="true"></i>
        {card.sportLabel}
      </h2>

      {card.headline && (
        <div className="mt-3 flex items-baseline gap-2 flex-wrap">
          <span className="text-3xl font-bold text-primary">{card.headline.value}</span>
          <span className="text-sm text-muted">
            {card.headline.label}
            {card.headline.detail ? ` ${card.headline.detail}` : ''}
          </span>
          <ProvenanceChip provenance={card.headline.provenance} />
        </div>
      )}

      {card.progress && (
        <div className="mt-3">
          <p className="text-sm font-medium text-secondary">
            {card.progress.count} of {card.progress.needed} {card.progress.label}
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-surface-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-brand"
              style={{
                width: `${Math.min(100, Math.round((card.progress.count / card.progress.needed) * 100))}%`,
              }}
            />
          </div>
          {card.progress.hint && <p className="mt-2 text-xs text-muted">{card.progress.hint}</p>}
        </div>
      )}

      <TileGrid tiles={card.tiles} />

      <SportSettingsRow items={card.entered} className="mt-3 px-0 pb-0" />
    </>
  );
}

export default function SportSkillCards({
  profileId,
  isOwner,
  initialCards,
  onAddDetails,
  sectionId = 'sports',
}: SportSkillCardsProps) {
  const [cards, setCards] = useState<SportSkillCard[]>(initialCards ?? []);
  // The add-affordance must wait for the fetch to settle, or it would flash
  // at every owner while their real cards load.
  const [loaded, setLoaded] = useState(initialCards !== undefined);

  useEffect(() => {
    if (initialCards) return;
    let cancelled = false;
    fetch(`/api/profile/${profileId}/skill-cards`)
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (cancelled) return;
        if (body?.skillCards) setCards(body.skillCards);
        setLoaded(true);
      })
      .catch(() => {
        // A profile section that can't load renders nothing rather than an
        // error card (the OrgMembershipsStrip convention). `loaded` stays
        // false on purpose: no data is not the same as no sports.
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, initialCards]);

  if (cards.length === 0) {
    if (!isOwner || !loaded || !onAddDetails) return null;
    return (
      <section id={sectionId} aria-label="Sports">
        <button
          type="button"
          onClick={onAddDetails}
          className="ea-interactive mt-4 w-full text-left bg-surface rounded-xl shadow-sm border border-dashed border-border p-4"
        >
          <h2 className="text-sm font-semibold text-secondary flex items-center gap-2">
            <i className="fas fa-medal" aria-hidden="true"></i>
            Sports
          </h2>
          <p className="mt-2 text-sm text-muted">
            Add your competitive details — level, team, league — and they show here
            alongside stats tracked from your activity.
          </p>
        </button>
      </section>
    );
  }

  return (
    <section id={sectionId} aria-label="Sports">
      {cards.map(card => {
        const shell = 'mt-4 bg-surface rounded-xl shadow-sm border border-border p-4';
        const body = <CardBody card={card} />;
        return isOwner && card.detailHref ? (
          <Link key={card.sportKey} href={card.detailHref} className={`block ea-interactive ${shell}`}>
            {body}
          </Link>
        ) : (
          <div key={card.sportKey} className={shell}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
