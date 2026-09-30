import AppHeader from '@/components/AppHeader';
import ActivityScreen from '@/components/activities/ActivityScreen';

// ── /activities/[id] — an imported activity as a place (Activities, 245) ───
// Viewer-dependent by design (the route is trimmed or withheld per viewer —
// visibility.ts), so the server renders only the shell and the client
// fetches with the session; a signed-out visitor of a public athlete is
// welcome. The header is always here, so the page is never a dead end.

export const metadata = { title: 'Activity — Edge Athlete' };

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <ActivityScreen activityId={id} />
      </main>
    </div>
  );
}
