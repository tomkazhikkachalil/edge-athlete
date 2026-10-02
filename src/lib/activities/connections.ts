// ── Connected apps (mig 247) — the vocabulary and the projection, pure ──────
// A CONNECTION is a watch or an app the athlete linked ONCE in Settings, after
// which every workout it records arrives by itself. This file is client-safe
// (zero imports beyond the catalog): the Settings screen, the route and the
// writer all read the same list.
//
// The list is mirrored by 247's activity_connections_provider_check and is
// ACTIVITY_SOURCES without `file` (both pinned by test). Being named here
// connects nothing: `stage` says, honestly, where each one stands —
//
//   live      connectable today
//   building  its programme is open to us and the connection is being built
//   applying  open after the provider's own review; Edge Athlete has applied
//   closed    the provider is not admitting new apps for now
//
// and a card is never offered a Connect button unless its stage is `live`.
// What the providers allow was read from their own pages on Oct 1 2026
// (docs/ACTIVITIES.md "Connected apps" carries the record) — Strava is left
// out by decision: its terms forbid showing an activity to anyone but the
// athlete.

import { ACTIVITY_SOURCES, type ActivitySource } from './catalog';

export const CONNECTION_PROVIDERS = [
  'upload_link',
  'polar',
  'wahoo',
  'coros',
  'suunto',
  'garmin',
  'google_health',
] as const satisfies readonly Exclude<ActivitySource, 'file'>[];

export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

export function isConnectionProvider(v: unknown): v is ConnectionProvider {
  return typeof v === 'string' && (CONNECTION_PROVIDERS as readonly string[]).includes(v);
}

/** Every source that is not a file import is a connection. */
export const CONNECTION_SOURCES: readonly ActivitySource[] = ACTIVITY_SOURCES.filter(s => s !== 'file');

export type ProviderStage = 'live' | 'building' | 'applying' | 'closed';
/** `link`: the athlete's personal upload link; `oauth`: sign in at the provider. */
export type ProviderKind = 'link' | 'oauth';

export interface ProviderDef {
  /** What the athlete calls it. */
  label: string;
  /** What it covers, in a line. */
  devices: string;
  kind: ProviderKind;
  stage: ProviderStage;
  /** Font Awesome 7 solid icon name (without the `fa-` prefix). */
  icon: string;
}

export const PROVIDER_DEFS: Readonly<Record<ConnectionProvider, ProviderDef>> = {
  upload_link: {
    label: 'Apple Watch',
    devices: 'Workouts from your Apple Watch and the Health app on your iPhone.',
    kind: 'link',
    stage: 'live',
    icon: 'heart-pulse',
  },
  polar: { label: 'Polar', devices: 'Polar watches and the Polar Flow app.', kind: 'oauth', stage: 'live', icon: 'stopwatch' },
  wahoo: { label: 'Wahoo', devices: 'Wahoo bike computers, trainers and watches.', kind: 'oauth', stage: 'applying', icon: 'person-biking' },
  coros: { label: 'COROS', devices: 'COROS watches.', kind: 'oauth', stage: 'applying', icon: 'stopwatch' },
  suunto: { label: 'Suunto', devices: 'Suunto watches and the Suunto app.', kind: 'oauth', stage: 'applying', icon: 'mountain' },
  garmin: { label: 'Garmin', devices: 'Garmin watches and bike computers.', kind: 'oauth', stage: 'closed', icon: 'stopwatch' },
  google_health: { label: 'Fitbit and Pixel Watch', devices: 'Fitbit trackers and the Pixel Watch.', kind: 'oauth', stage: 'closed', icon: 'heart-pulse' },
};

/** The line under a card that cannot be connected yet. */
export function stageNote(provider: ConnectionProvider): string | null {
  const def = PROVIDER_DEFS[provider];
  switch (def.stage) {
    case 'live':
      return null;
    case 'building':
      return 'Coming soon.';
    case 'applying':
      return `Coming once ${def.label} approves Edge Athlete.`;
    case 'closed':
      return def.label.includes(' and ')
        ? 'Their programme is not taking new apps right now.'
        : `${def.label} is not taking new apps right now.`;
  }
}

/** The stored row, as the reader selects it — never the secret, never the hash. */
export interface ConnectionRow {
  provider: string;
  status: string;
  connected_at: string;
  last_sync_at: string | null;
  last_error: string | null;
}

export type ConnectionState = 'connected' | 'needs_attention' | 'available' | 'coming';

/** What the Settings screen is given: one entry per provider, in list order. */
export interface ConnectionView {
  provider: ConnectionProvider;
  label: string;
  devices: string;
  kind: ProviderKind;
  icon: string;
  state: ConnectionState;
  /** Why it cannot be connected yet (state `coming`). */
  note: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  /** What went wrong, in our words (state `needs_attention`). */
  problem: string | null;
}

/**
 * The projection. Built key by key from the row's five display columns, so a
 * row selected too widely still cannot leak a secret or a token hash (pinned
 * by test). A row for a provider this build does not know is dropped.
 */
export function projectConnections(
  rows: readonly ConnectionRow[],
  opts: {
    /** Live providers THIS deployment cannot connect yet (its credentials
     *  are not set): they read "Coming soon", never an empty Connect. */
    unconfigured?: readonly ConnectionProvider[];
  } = {}
): ConnectionView[] {
  const unconfigured = new Set<ConnectionProvider>(opts.unconfigured ?? []);
  const byProvider = new Map<string, ConnectionRow>();
  for (const row of rows) if (isConnectionProvider(row.provider)) byProvider.set(row.provider, row);

  return CONNECTION_PROVIDERS.map(provider => {
    const def = PROVIDER_DEFS[provider];
    const row = byProvider.get(provider);
    const base = { provider, label: def.label, devices: def.devices, kind: def.kind, icon: def.icon };
    if (!row) {
      const live = def.stage === 'live' && !unconfigured.has(provider);
      return {
        ...base,
        state: live ? 'available' : 'coming',
        note: live ? null : (stageNote(provider) ?? 'Coming soon.'),
        connectedAt: null,
        lastSyncAt: null,
        problem: null,
      };
    }
    const healthy = row.status === 'active';
    return {
      ...base,
      state: healthy ? 'connected' : 'needs_attention',
      note: null,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
      problem: healthy
        ? null
        : row.status === 'revoked'
          ? `${def.label} stopped sharing with Edge Athlete. Connect again to pick up where it left off.`
          : row.last_error || 'The last sync did not go through. It is retried every day.',
    };
  });
}

/** A supervised account's refusal — one sentence, used by every connect route and the screen. */
export const SUPERVISED_CONNECTIONS_MESSAGE =
  "Connected apps aren't available on a supervised account. A guardian can still import the files a watch exports.";

/** What the athlete agrees to, said on the card BEFORE they are sent to the
 *  provider — the provider's terms ask for the member's explicit permission
 *  before their data is shown to anyone else (Polar's 3.1.1). */
export const PROVIDER_CONSENT =
  'Workouts it records will appear in your Vitals, where the people who can see your profile can see them. You choose what goes on your feed.';

/** Why a connect attempt came back without a connection (`?connect_error=`). */
export const CONNECT_ERRORS: Readonly<Record<string, string>> = {
  denied: 'Nothing was connected — you did not give permission.',
  expired: 'That took too long, or was started in another browser. Start again from here.',
  taken: 'That account is already connected to another Edge Athlete account.',
  supervised: SUPERVISED_CONNECTIONS_MESSAGE,
  limited: 'Your account cannot connect an app right now.',
  busy: 'Too many tries. Wait a little and try again.',
  unavailable: 'This connection is not available yet.',
  failed: 'The connection did not go through. Try again.',
};

/** The credit a provider's terms require wherever its data is displayed
 *  (Polar's 3.1.5). Plain words, no logo — a logo needs written consent (7.4). */
export function sourceCredit(source: string | null | undefined): string | null {
  const name = sourceName(source);
  return name ? `Recorded with ${name}` : null;
}

/** The provider's name alone — the credit on a row too tight for a sentence. */
export function sourceName(source: string | null | undefined): string | null {
  switch (source) {
    case 'polar':
      return 'Polar';
    default:
      return null;
  }
}
