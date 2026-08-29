import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk } from './chunk';
import { notifyGuardians, profileFirstName } from './guardian-notify';
import { detectNewContactBurst, detectVolumeSpike, signalCopy, type DetectedSignal } from './risk-signals';

// Risk-signal sweep (Wave 7) — /api/cron/daily phase 7. Evaluates the pure
// detectors over supervised, un-parked children and files risk_signals rows.
//
// METADATA ONLY (the standing line, restated from risk-signals.ts): the two
// selects below read messages.created_at and conversation_participants
// .joined_at — timestamps, never content. Adding a select column to either
// query is a review flag.
//
// Dedup is structural: rows upsert with ignoreDuplicates on the UNIQUE
// (profile_id, kind, window_start) key, and only rows that actually
// INSERTED ring the guardian bell — a re-run is silent. The safety_alert
// rides the ~10-minute urgent email tier automatically (migration 135's
// partial index matches on type) through the Wave-7A dispatcher.

const SWEEP_BATCH_SIZE = 10;
const CHILD_LIMIT = 500;
const MESSAGE_SCAN_LIMIT = 2000;
const JOIN_SCAN_LIMIT = 200;

export async function runRiskSweep(admin: SupabaseClient) {
  const now = new Date();
  const since8d = new Date(now.getTime() - 8 * 24 * 3_600_000).toISOString();
  const since48h = new Date(now.getTime() - 48 * 3_600_000).toISOString();

  const { data: children, error } = await admin
    .from('profiles')
    .select('id')
    .eq('supervision_state', 'supervised')
    .is('deletion_requested_at', null)
    .limit(CHILD_LIMIT);
  if (error) {
    console.error('[RISK] children query failed:', error);
    return { ok: false, considered: 0, signals: 0, notified: 0 };
  }
  if (!children || children.length === 0) {
    return { ok: true, considered: 0, signals: 0, notified: 0 };
  }

  let signals = 0;
  let notified = 0;

  const processOne = async (childId: string): Promise<void> => {
    try {
      const [{ data: msgs }, { data: joins }] = await Promise.all([
        admin
          .from('messages')
          .select('created_at') // timestamps ONLY — never content
          .eq('sender_id', childId)
          .gt('created_at', since8d)
          .order('created_at', { ascending: false })
          .limit(MESSAGE_SCAN_LIMIT),
        admin
          .from('conversation_participants')
          .select('joined_at') // timestamps ONLY
          .eq('profile_id', childId)
          .gt('joined_at', since48h)
          .limit(JOIN_SCAN_LIMIT),
      ]);

      const detected = [
        detectVolumeSpike((msgs ?? []).map(m => m.created_at as string), now),
        detectNewContactBurst((joins ?? []).map(j => j.joined_at as string), now),
      ].filter((s): s is DetectedSignal => s !== null);
      if (detected.length === 0) return;

      const { data: inserted, error: upsertError } = await admin
        .from('risk_signals')
        .upsert(
          detected.map(s => ({
            profile_id: childId,
            kind: s.kind,
            window_start: s.windowStart,
            window_end: s.windowEnd,
            magnitude: s.magnitude,
          })),
          { onConflict: 'profile_id,kind,window_start', ignoreDuplicates: true }
        )
        .select('id, kind');
      if (upsertError) {
        console.error('[RISK] upsert failed for', childId, upsertError);
        return;
      }
      if (!inserted || inserted.length === 0) return; // all duplicates — already told
      signals += inserted.length;

      const childName = await profileFirstName(admin, childId);
      for (const row of inserted) {
        const copy = signalCopy(row.kind, childName);
        await notifyGuardians(admin, childId, {
          type: 'safety_alert',
          title: copy.title,
          message: copy.message,
          actionUrl: '/app/guardian',
          metadata: { kind: 'risk_signal', signal_kind: row.kind, signal_id: row.id },
        });
        notified += 1;
      }
    } catch (childError) {
      // One child's failure never stops the sweep.
      console.error('[RISK] failed for child', childId, childError);
    }
  };

  for (const batch of chunk(children.map(c => c.id as string), SWEEP_BATCH_SIZE)) {
    await Promise.all(batch.map(processOne));
  }

  return { ok: true, considered: children.length, signals, notified };
}
