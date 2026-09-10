'use client';

/**
 * Open the draft preview in a new tab — Site Builder hardening H7.
 * `window.open` after an `await` runs outside the user-gesture stack, and
 * Safari and Firefox block it silently (the button looked dead). Open the
 * tab SYNCHRONOUSLY on the click, then point it at the minted URL — or
 * close it and toast when the mint fails. One helper for the editor and
 * the console.
 */
export async function openPreview(plural: string, orgId: string, showError: (title: string, message?: string) => void): Promise<void> {
  // No 'noopener' here: with it `window.open` returns null and there is no
  // handle to point at the URL. The opener link is cut by hand instead.
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const res = await fetch(`/api/${plural}/${orgId}/site/preview`, { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) {
      tab?.close();
      showError('Website', body.error || 'Failed to create a preview link');
      return;
    }
    if (tab) tab.location.href = body.url;
    else window.open(body.url, '_blank', 'noopener'); // a blocker refused the blank tab too
  } catch {
    tab?.close();
    showError('Website', 'Failed to create a preview link');
  }
}
