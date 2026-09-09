'use client';

import SiteBuilder from '@/components/site-builder/SiteBuilder';

// Thin wrapper — the editor lives in components/site-builder (Site Builder
// P3-B). Flag-gated inside: FEATURE_SITE_BUILDER off → "not available".
export default function OrgSiteEditorPage() {
  return <SiteBuilder />;
}
