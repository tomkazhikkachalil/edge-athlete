'use client';

import SiteBlockEditor from '@/components/org/SiteBlockEditor';

// Thin wrapper — the editor itself is shared with the news subpage
// (components/org/SiteBlockEditor.tsx).
export default function OrgSitePageEditorPage() {
  return <SiteBlockEditor mode="page" />;
}
