import type { Metadata } from 'next';
import { buildPublicHead, readPublicHead } from '@/lib/profiles/public-head';

// The public profile page is a client component; its <head> is this server
// layout's (Round 4). The handle arrives with or without a leading '@'.
export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const handle = decodeURIComponent(username).replace(/^@/, '');
  if (!/^[a-z0-9][a-z0-9._]{1,30}$/i.test(handle)) return { title: 'Athlete · Edge Athlete', robots: { index: false, follow: false } };
  return buildPublicHead(await readPublicHead(handle));
}

export default function PublicProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
