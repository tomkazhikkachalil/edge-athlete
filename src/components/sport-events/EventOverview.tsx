'use client';

import { useState } from 'react';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import { formatDateOnly, formatLabel, holesLabel, joinLine, VISIBILITY_LABEL } from '@/lib/sport-events/format';

interface Props {
  view: SportEventViewPayload;
  onRotateLink: () => Promise<void>;
  busy: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border-subtle last:border-b-0">
      <dt className="text-sm text-muted shrink-0">{label}</dt>
      <dd className="text-sm text-primary text-right min-w-0">{children}</dd>
    </div>
  );
}

export default function EventOverview({ view, onRotateLink, busy }: Props) {
  const { event, rounds, viewer } = view;
  const round = rounds[0] ?? null;
  const [copied, setCopied] = useState(false);
  const link = event.link_token && typeof window !== 'undefined' ? `${window.location.origin}/events/${event.id}?token=${event.link_token}` : null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy the link', link);
    }
  };

  return (
    <div className="space-y-4">
      {event.description && <p className="text-sm text-primary whitespace-pre-wrap">{event.description}</p>}
      <dl className="bg-surface-muted rounded-lg px-4 py-1">
        {round && <Row label="Date">{formatDateOnly(round.scheduled_on, { weekday: true })}</Row>}
        {round && <Row label="Course">{round.course_name}{round.tee ? ` · ${round.tee} tees` : ''}</Row>}
        {round && <Row label="Holes">{holesLabel(round.holes, round.starting_hole)}</Row>}
        <Row label="Format">{formatLabel(event.format)}</Row>
        <Row label="Who can see it">{VISIBILITY_LABEL[event.visibility]}</Row>
        <Row label="Joining">{joinLine(event.join_mode)}</Row>
        {event.capacity !== null && <Row label="Field size">{event.capacity} players</Row>}
      </dl>
      {viewer.can_manage && event.visibility === 'link' && link && (
        <div className="bg-surface rounded-lg border border-border p-4 space-y-2" data-event-link-share="">
          <p className="text-sm font-semibold text-primary">Share link</p>
          <p className="text-xs text-muted break-all">{link}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold">{copied ? 'Copied' : 'Copy link'}</button>
            <button type="button" onClick={onRotateLink} disabled={busy} className="ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60">New link</button>
          </div>
          <p className="text-xs text-muted">A new link stops the old one from working.</p>
        </div>
      )}
      {event.status === 'draft' && viewer.can_manage && (
        <p className="text-sm text-tertiary">This event is a draft — only you can see it. Publish it from the top of the page when it is ready.</p>
      )}
    </div>
  );
}
