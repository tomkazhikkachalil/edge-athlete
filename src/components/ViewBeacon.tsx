'use client';

import { useEffect } from 'react';
import { recordView } from '@/lib/views/client';

// The share page (/r/[postId]) is server-rendered and viewer-independent;
// this island records the visit as one view (252) — the server decides whose
// view it was and whether it counts.
export default function ViewBeacon({ postId }: { postId: string }) {
  useEffect(() => {
    recordView(postId, 'view');
  }, [postId]);
  return null;
}
