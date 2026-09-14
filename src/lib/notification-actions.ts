/**
 * The bell's action row (Events program, PR 11) — pure. Which notifications
 * carry Accept / Decline, and what a decided one reads. One rule for the
 * notifications page and the bell dropdown.
 */
import { ACTIONABLE_TYPES } from './notification-registry';

export interface ActionableNotification {
  type: string;
  title: string;
  action_status?: 'pending' | 'accepted' | 'declined' | null;
  metadata?: Record<string, unknown> | null;
}

export type ActionRow = { show: true; accept: string; decline: string } | { show: false };

/** The row shows while the decision is still pending. */
export function actionRowFor(n: ActionableNotification): ActionRow {
  if (!ACTIONABLE_TYPES.has(n.type) || n.action_status !== 'pending') return { show: false };
  if (n.type === 'sport_event_request') return { show: true, accept: 'Accept', decline: 'Decline' };
  return { show: true, accept: 'Accept', decline: 'Decline' };
}

function eventName(n: ActionableNotification): string {
  const name = n.metadata?.sport_event_name;
  return typeof name === 'string' && name ? name : 'the event';
}

/** The line a sport-event bell reads once decided; null keeps the stored title. */
export function decidedText(n: ActionableNotification, actorName: string): string | null {
  if (n.action_status !== 'accepted' && n.action_status !== 'declined') return null;
  const did = n.action_status === 'accepted' ? 'accepted' : 'declined';
  if (n.type === 'sport_event_invite') return `You ${did} the invitation to ${eventName(n)}`;
  if (n.type === 'sport_event_request') return `You ${did} ${actorName}'s request to join ${eventName(n)}`;
  return null;
}
