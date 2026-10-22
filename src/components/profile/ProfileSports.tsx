'use client';

/**
 * Sports on the profile (profile quick fixes, PR 3 — Oct 14 2026). ONE
 * section for all three routes (own /athlete, /athlete/[id], /u/[username]):
 * every sport the person has, in the reader's order — PINNED sports first as
 * large cards, the rest as the compact rows the strip used to draw. The owner
 * pins / unpins and moves pinned cards; a viewer sees the same list and order
 * with no controls. No sport at all: the owner gets a prompt to add sports,
 * a viewer gets nothing. Golf gets no special treatment — a card renders for
 * every active sport, with "No stats yet" when there is nothing to show.
 *
 * Keeps `id="sports"`, the "{Sport} stats" button names and the row shape —
 * the e2e specs (skill-cards-mobile, stats-hub-mobile, equipment) rely on
 * them. The pin controls are SIBLINGS of the stats button, never nested.
 */

import { useState } from 'react';
import { getSportDefinition } from '@/lib/sports/SportRegistry';
import type { SkillProvenance, SportSkillCard } from '@/lib/sports/server/types';
import { provenanceIcon } from '../SportSkillCards';
import { useToast } from '../Toast';

interface ProfileSportsProps {
  /** Already in pinned-then-rest order (the reader's). */
  cards: SportSkillCard[];
  isOwner: boolean;
  /** Opens the Stats hub on this sport's layer. */
  onOpenSport: (sportKey: string) => void;
  /** Owner empty state → Edit Profile (the Basic tab's "Your sports"). */
  onAddSports?: () => void;
  /** Owner: the PATCH answered with fresh cards. */
  onCardsChange?: (cards: SportSkillCard[]) => void;
}

const PROVENANCE_TITLE: Record<SkillProvenance, string> = {
  sanctioned: 'Recorded in a sanctioned competition — the strongest verification tier',
  league_verified: 'Entered and verified by the competition owner',
  club_recorded: 'Recorded by team staff — not yet league-verified',
  tracked: 'Calculated from logged activity on Edge Athlete',
  imported: 'Imported historical record — labeled, not verified here',
  entered: 'Entered by the athlete — not verified',
};

type PinChange = { kind: 'pin'; key: string } | { kind: 'unpin'; key: string } | { kind: 'move'; key: string; position: number };

export default function ProfileSports({ cards, isOwner, onOpenSport, onAddSports, onCardsChange }: ProfileSportsProps) {
  const { showError } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const pinned = cards.filter(c => c.pinned);
  const rest = cards.filter(c => !c.pinned);
  const canControl = isOwner && !!onCardsChange;

  const change = async (c: PinChange) => {
    if (busy) return;
    setBusy(c.key);
    try {
      const res = await fetch('/api/sport-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(c.kind === 'move' ? { sport: c.key, pinned: true, position: c.position } : { sport: c.key, pinned: c.kind === 'pin' }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.code === 'pin_cap') {
        showError('Pins are full', `You can pin up to ${data.max} sports. Unpin one first.`);
        return;
      }
      if (!res.ok) throw new Error(data?.error || 'Could not update your sports');
      onCardsChange?.(data.skillCards ?? cards);
    } catch (e) {
      showError('Error', e instanceof Error ? e.message : 'Could not update your sports');
    } finally {
      setBusy(null);
    }
  };

  if (cards.length === 0) {
    if (!isOwner || !onAddSports) return null;
    return (
      <section id="sports" aria-label="Sports">
        <button
          type="button"
          onClick={onAddSports}
          className="ea-interactive w-full text-left bg-surface rounded-xl shadow-sm border border-dashed border-border px-4 py-3"
          data-sports-empty=""
        >
          <span className="text-sm font-semibold text-secondary flex items-center gap-2">
            <i className="fas fa-medal" aria-hidden="true"></i>
            No sports yet — Add sports
            <i className="fas fa-chevron-right text-xs text-decor ml-auto" aria-hidden="true"></i>
          </span>
        </button>
      </section>
    );
  }

  const headlineOf = (card: SportSkillCard, large: boolean) =>
    card.headline ? (
      <span className="flex items-baseline gap-1.5 min-w-0">
        <span className={`${large ? 'text-2xl' : 'text-base'} font-bold text-primary tabular-nums`}>{card.headline.value}</span>
        <span className="text-xs text-muted truncate">{card.headline.label}</span>
        <i
          className={`fas ${provenanceIcon(card.headline.provenance)} ${card.headline.provenance === 'entered' || card.headline.provenance === 'imported' ? 'text-muted' : 'text-brand-fg'} text-[10px]`}
          title={PROVENANCE_TITLE[card.headline.provenance]}
          aria-hidden="true"
        ></i>
      </span>
    ) : card.progress ? (
      <span className="text-xs text-muted">{card.progress.count} of {card.progress.needed} {card.progress.label}</span>
    ) : (
      <span className="text-xs text-muted">{card.state === 'empty' ? 'No stats yet' : 'View stats'}</span>
    );

  const pinButton = (card: SportSkillCard) =>
    canControl ? (
      <button
        type="button"
        onClick={() => change({ kind: card.pinned ? 'unpin' : 'pin', key: card.sportKey })}
        disabled={busy === card.sportKey}
        className="ea-icon-btn text-secondary shrink-0"
        aria-label={`${card.pinned ? 'Unpin' : 'Pin'} ${card.sportLabel}`}
        aria-pressed={card.pinned}
        data-sport-pin={card.sportKey}
      >
        <i className={`fas fa-thumbtack ${card.pinned ? 'text-brand-fg' : 'text-muted'}`} aria-hidden="true"></i>
      </button>
    ) : null;

  return (
    <section id="sports" aria-label="Sports" className="space-y-3">
      {pinned.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-sports-pinned="">
          {pinned.map((card, i) => {
            const def = getSportDefinition(card.sportKey);
            return (
              <div key={card.sportKey} className="bg-surface rounded-xl shadow-sm border border-border p-4 flex flex-col gap-3" data-sport-card={card.sportKey} data-sport-pinned="">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full bg-brand-soft text-brand-fg-strong flex items-center justify-center shrink-0">
                    <i className={`${def.icon_id} text-lg`} aria-hidden="true"></i>
                  </span>
                  <span className="text-base font-bold text-primary min-w-0 truncate">{card.sportLabel}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {canControl && pinned.length > 1 && (
                      <>
                        <button type="button" onClick={() => change({ kind: 'move', key: card.sportKey, position: i })} disabled={i === 0 || busy === card.sportKey} className="ea-icon-btn text-secondary disabled:opacity-40" aria-label={`Move ${card.sportLabel} up`}>
                          <i className="fas fa-chevron-up text-xs" aria-hidden="true"></i>
                        </button>
                        <button type="button" onClick={() => change({ kind: 'move', key: card.sportKey, position: i + 2 })} disabled={i === pinned.length - 1 || busy === card.sportKey} className="ea-icon-btn text-secondary disabled:opacity-40" aria-label={`Move ${card.sportLabel} down`}>
                          <i className="fas fa-chevron-down text-xs" aria-hidden="true"></i>
                        </button>
                      </>
                    )}
                    {pinButton(card)}
                  </span>
                </div>
                {headlineOf(card, true)}
                {card.enabled ? (
                  <button type="button" onClick={() => onOpenSport(card.sportKey)} className="ea-btn-secondary inline-flex items-center justify-center text-sm font-medium" aria-label={`${card.sportLabel} stats`}>
                    {card.sportLabel} stats
                  </button>
                ) : (
                  <span className="text-xs text-muted">Stats coming soon</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rest.length > 0 && (
        <div className="bg-surface rounded-xl shadow-sm border border-border divide-y divide-border-subtle overflow-hidden" data-sports-rest="">
          {rest.map(card => {
            const def = getSportDefinition(card.sportKey);
            return (
              <div key={card.sportKey} className="flex items-center" data-sport-card={card.sportKey}>
                {card.enabled ? (
                  <button
                    type="button"
                    onClick={() => onOpenSport(card.sportKey)}
                    className="ea-interactive flex-1 flex items-center gap-3 px-4 py-3 text-left min-h-[48px] min-w-0"
                    aria-label={`${card.sportLabel} stats`}
                  >
                    <i className={`${def.icon_id} text-brand-fg-strong w-5 text-center shrink-0`} aria-hidden="true"></i>
                    <span className="text-sm font-semibold text-primary shrink-0">{card.sportLabel}</span>
                    <span className="ml-auto flex items-baseline gap-1.5 min-w-0">
                      {headlineOf(card, false)}
                      <i className="fas fa-chevron-right text-xs text-decor shrink-0" aria-hidden="true"></i>
                    </span>
                  </button>
                ) : (
                  <div className="flex-1 flex items-center gap-3 px-4 py-3 min-h-[48px] min-w-0">
                    <i className={`${def.icon_id} text-brand-fg-strong w-5 text-center shrink-0`} aria-hidden="true"></i>
                    <span className="text-sm font-semibold text-primary shrink-0">{card.sportLabel}</span>
                    <span className="ml-auto text-xs text-muted">Stats coming soon</span>
                  </div>
                )}
                {canControl && <span className="pr-2">{pinButton(card)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
