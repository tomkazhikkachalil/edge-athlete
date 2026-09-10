import Link from 'next/link';
import BrandBar from '@/components/BrandBar';
import ProvenanceExplainer from '@/components/stats/ProvenanceExplainer';

// ── /help/verified-stats — how verification works (Recruiting skeleton R5) ─
// A public, shareable page (the privacy/terms shape): the ladder a scout or
// a college coach will interrogate, in the athlete's own words too. BrandBar
// carries the way back.

export const metadata = { title: 'Verified stats — Edge Athlete' };

export default function VerifiedStatsHelpPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <BrandBar />
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <header>
          <p className="text-xs text-muted">Help</p>
          <h1 className="text-2xl font-bold text-primary">How verified stats work</h1>
          <p className="mt-2 text-sm text-tertiary">
            What the chips beside an athlete’s numbers mean, strongest first.
          </p>
        </header>
        <ProvenanceExplainer />
        <p className="text-sm text-tertiary">
          Recruiting? Athletes decide whether they are open to it on their profile;{' '}
          <Link href="/explore" className="text-brand-fg hover:text-brand-fg-strong font-medium">Explore</Link> lists public
          profiles, and scout accounts can find recruitable athletes from their scouting area.
        </p>
      </main>
    </div>
  );
}
