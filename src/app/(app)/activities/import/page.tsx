import AppHeader from '@/components/AppHeader';
import ImportActivities from '@/components/activities/ImportActivities';

// ── /activities/import — file import (Activities, 245) ─────────────────────
// A page, not a sheet: a batch of files needs room for its results at phone
// width, and the path is linkable from the Activities tab and the header's
// Create sheet.

export const metadata = { title: 'Import activities — Edge Athlete' };

export default function ImportActivitiesPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-6">
        <ImportActivities />
      </main>
    </div>
  );
}
