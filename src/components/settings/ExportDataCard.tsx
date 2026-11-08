'use client';

import { useState } from 'react';
import SectionInfo from '@/components/SectionInfo';
import { COPY } from '@/lib/copy';
import FaIcon from '@/components/FaIcon';
import { faFileArrowDown } from '@/lib/icons/fa/file-arrow-down';

type State = { kind: 'idle' } | { kind: 'working' } | { kind: 'done' } | { kind: 'failed'; message: string };

/**
 * Settings → Account → "Your data" (Nov 2 2026): one button, one file. The
 * route answers the JSON as an attachment; the browser's own download is
 * the only thing that happens (an object URL, clicked, revoked). A 429
 * shows the limiter's sentence as it is.
 */
export default function ExportDataCard() {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const download = async () => {
    setState({ kind: 'working' });
    try {
      const res = await fetch('/api/account/export', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ kind: 'failed', message: body?.error || COPY.ACCOUNT.EXPORT_FAILED });
        return;
      }
      const disposition = res.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'edge-athlete-export.json';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ kind: 'done' });
    } catch {
      setState({ kind: 'failed', message: COPY.ACCOUNT.EXPORT_FAILED });
    }
  };

  return (
    <div data-export-card>
      <SectionInfo as="h3" heading={COPY.ACCOUNT.EXPORT_TITLE} headingClassName="text-2xl font-bold text-primary tracking-tight" className="mb-6">
        <p>{COPY.ACCOUNT.EXPORT_BODY}</p>
      </SectionInfo>
      <div className="bg-surface rounded-xl p-6 sm:p-8 border border-border shadow-sm">
        <p className="text-sm text-muted mb-4">{COPY.ACCOUNT.EXPORT_LINE}</p>
        <button
          type="button"
          onClick={() => void download()}
          disabled={state.kind === 'working'}
          className="ea-btn-secondary inline-flex items-center gap-2 text-sm font-medium disabled:opacity-60"
          data-export-download
        >
          <FaIcon icon={faFileArrowDown} />
          <span>{state.kind === 'working' ? COPY.ACCOUNT.EXPORT_WORKING : COPY.ACCOUNT.EXPORT_BUTTON}</span>
        </button>
        {state.kind === 'done' && (
          <p className="text-sm text-muted mt-3" role="status" data-export-status="done">{COPY.ACCOUNT.EXPORT_DONE}</p>
        )}
        {state.kind === 'failed' && (
          <p className="text-sm text-danger-fg mt-3" role="alert" data-export-status="failed">{state.message}</p>
        )}
      </div>
    </div>
  );
}
