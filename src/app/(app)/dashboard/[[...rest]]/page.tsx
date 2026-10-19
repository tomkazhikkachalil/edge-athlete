import { redirect } from 'next/navigation';

// /dashboard/* → /admin/* (flow changes item 2, B2): the console moved to its
// own door. Every old link — the bell's ticket links, bookmarks, docs —
// still lands on the page it meant. Nothing is served here.
export default async function DashboardRedirect({ params }: { params: Promise<{ rest?: string[] }> }) {
  const { rest } = await params;
  redirect(`/admin${rest && rest.length ? `/${rest.map(encodeURIComponent).join('/')}` : ''}`);
}
