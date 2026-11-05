import AppHeader from '@/components/AppHeader';
import VideoScreen from '@/components/videos/VideoScreen';

// ── /videos/[id] — a linked video as a place (Videos program, 296) ─────────
// Viewer-dependent by design (the owner's privacy, the org's visibility, a
// manager's hidden rows — videos-server.ts), so the server renders only the
// shell and the client fetches with the session; a signed-out visitor of a
// public owner is welcome. The header is always here: never a dead end.

export const metadata = { title: 'Video — Edge Athlete' };

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <VideoScreen videoId={id} />
      </main>
    </div>
  );
}
