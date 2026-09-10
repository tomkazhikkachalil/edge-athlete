import {
  PROVENANCE_EXPLAINER,
  PROVENANCE_LABEL,
  PROVENANCE_ORDER,
  UNCONFIRMED_LABEL,
  UNCONFIRMED_TITLE,
} from '@/lib/sports/provenance-copy';

// ── The verified-stats explainer (Recruiting skeleton R5) ─────────────────
// Server-safe (no hooks, no icons): the same content on /help/verified-stats
// and wherever a surface wants to embed it. Strongest rung first.

export default function ProvenanceExplainer() {
  return (
    <div className="space-y-6" data-provenance-explainer="">
      <p className="text-sm text-secondary">
        Every number on an Edge Athlete profile carries the rung it came from. Stronger rungs replace weaker ones for the same
        stat, and a total is only as strong as its weakest source.
      </p>
      <ol className="space-y-3">
        {PROVENANCE_ORDER.map((key, i) => (
          <li key={key} className="rounded-lg border border-border bg-surface p-4" data-provenance-rung={key}>
            <p className="text-sm font-semibold text-primary">
              <span className="text-muted mr-2">{i + 1}.</span>
              {PROVENANCE_LABEL[key]}
            </p>
            <p className="mt-1 text-sm text-secondary">{PROVENANCE_EXPLAINER[key]}</p>
          </li>
        ))}
      </ol>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{UNCONFIRMED_LABEL}</p>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{UNCONFIRMED_TITLE}.</p>
      </div>
    </div>
  );
}
