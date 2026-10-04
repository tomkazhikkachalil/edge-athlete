import RecordActivityScreen from '@/components/activities/record/RecordActivityScreen';

// ── /activities/record — record a walk, run, ride … live (Live Activities) ─
// No AppHeader and no tab bar (src/lib/tab-bar.ts): the screen owns its
// edges — a Back at the top, Start / Pause / Mark / Finish at the bottom.
// Signed-in only (the screen sends a signed-out visitor to `/`). The
// recording lives on the device until Finish (record/storage.ts), then goes
// through the import door as `format: 'live'`.

export const metadata = { title: 'Record an activity — Edge Athlete' };

export default function RecordActivityPage() {
  return <RecordActivityScreen />;
}
