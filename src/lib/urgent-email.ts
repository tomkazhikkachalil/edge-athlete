// The urgent safety-email sweep's pure core (Wave 5, mig 135). The route
// selects unmailed safety_alert/consent_result rows from the last 24h; this
// decides who actually gets an email — one email per recipient per sweep,
// never one per notification (a burst of alerts must not carpet-bomb an
// inbox).
//
// Skips are STRUCTURAL and unstamped: disabled preference, synthetic
// (@minors.invalid) or missing email. Unstamped rows age out of the 24h
// lookback and still ride the nightly digest — toggling urgent ON later
// never replays old alerts.

export interface UrgentRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message?: string | null;
  action_url?: string | null;
  created_at: string;
}

export interface UrgentRecipientInfo {
  email: string | null;
  displayName: string;
  /** notification_preferences.urgent_email_enabled (default true — a missing
   *  prefs row means the user never opted out). */
  urgentEnabled: boolean;
  /** Synthetic child addresses can never receive mail. */
  synthetic: boolean;
}

export interface UrgentBatch {
  userId: string;
  email: string;
  displayName: string;
  /** Chronological (the route selects ascending). */
  items: UrgentRow[];
}

export function buildUrgentBatches(
  rows: UrgentRow[],
  recipients: Map<string, UrgentRecipientInfo>
): { batches: UrgentBatch[]; skipped: number } {
  const byUser = new Map<string, UrgentBatch>();
  let skipped = 0;
  for (const row of rows) {
    const info = recipients.get(row.user_id);
    if (!info || !info.urgentEnabled || !info.email || info.synthetic) {
      skipped += 1;
      continue;
    }
    const existing = byUser.get(row.user_id);
    if (existing) existing.items.push(row);
    else {
      byUser.set(row.user_id, {
        userId: row.user_id,
        email: info.email,
        displayName: info.displayName,
        items: [row],
      });
    }
  }
  return { batches: [...byUser.values()], skipped };
}

/** Only app-internal paths make it into an email link — an action_url is
 *  data, and '//evil.example' or 'https://…' must never ride a safety email. */
export function safeInternalPath(actionUrl: string | null | undefined): string | null {
  if (typeof actionUrl !== 'string') return null;
  if (!actionUrl.startsWith('/') || actionUrl.startsWith('//')) return null;
  return actionUrl;
}
