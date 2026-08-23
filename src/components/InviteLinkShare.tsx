'use client';

import { useRef, useState } from 'react';

/**
 * A guardian-invite link the user shares THEMSELVES — the email is a
 * convenience, the URL is the reliable channel (owner decision; the admin
 * re-mint and co-guardian invites already follow this rule). Renders the
 * house `select-all break-all` code block plus the app's first
 * copy-to-clipboard button: clipboard access can be denied (http, iframes,
 * permissions), so the select-all block IS the fallback, not an error state.
 */
export default function InviteLinkShare({ url, hint }: { url: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the select-all block below still works;
      // no error surface needed for a convenience affordance.
    }
  };

  return (
    <div className="text-left max-w-md mx-auto">
      <code className="block select-all break-all rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-secondary">
        {url}
      </code>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-faint">
          {hint ?? 'Valid for 7 days and works once.'}
        </p>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-brand-fg ea-interactive"
        >
          <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`} aria-hidden="true"></i>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}
