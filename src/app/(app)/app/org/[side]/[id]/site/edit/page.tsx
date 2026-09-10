'use client';

import SiteBuilder from '@/components/site-builder/SiteBuilder';

// Thin wrapper — the editor lives in components/site-builder (Site Builder
// P3-B); the Website section's door since P10-C (the surface flag retired).
export default function OrgSiteEditorPage() {
  return <SiteBuilder />;
}
