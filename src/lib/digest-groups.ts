// Grouping a guardian's digest by athlete (Wave 5) — pure and node-testable.
// notifyGuardians stamps metadata.profile_id on every fan-out row, so a
// guardian's inbox already knows WHICH child each notification is about; the
// digest just never used it (safety alerts arrived flat-mixed with the
// guardian's own likes). Rows without the key (notifyUser, RPC-created
// social rows) form the "For you" general bucket.

export interface DigestItem {
  title: string;
  created_at: string;
  type?: string | null;
  message?: string | null;
  action_url?: string | null;
  metadata?: unknown;
}

export interface DigestGroup {
  /** The athlete this bucket is about — null = the recipient's own activity. */
  profileId: string | null;
  items: DigestItem[];
}

/** metadata.profile_id, string-guarded — metadata is jsonb off the wire and
 *  can be null, a string, or arbitrary shapes from older rows. */
export function itemProfileId(item: DigestItem): string | null {
  const meta = item.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>).profile_id;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Groups in first-seen order (the input is newest-first, so the child with
 * the freshest activity leads), general bucket always LAST — "your own
 * likes" must never displace a child's safety alert from the top.
 */
export function buildDigestGroups(items: DigestItem[]): DigestGroup[] {
  const byProfile = new Map<string, DigestGroup>();
  const general: DigestGroup = { profileId: null, items: [] };
  for (const item of items) {
    const profileId = itemProfileId(item);
    if (!profileId) {
      general.items.push(item);
      continue;
    }
    const existing = byProfile.get(profileId);
    if (existing) existing.items.push(item);
    else byProfile.set(profileId, { profileId, items: [item] });
  }
  const groups = [...byProfile.values()];
  if (general.items.length > 0) groups.push(general);
  return groups;
}
