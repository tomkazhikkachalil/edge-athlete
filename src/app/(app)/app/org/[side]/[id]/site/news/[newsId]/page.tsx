'use client';

import SiteBlockEditor from '@/components/org/SiteBlockEditor';

// Thin wrapper — the editor itself is shared with the pages subpage
// (components/org/SiteBlockEditor.tsx).
export default function OrgSiteNewsEditorPage() {
  return <SiteBlockEditor mode="news" />;
}
