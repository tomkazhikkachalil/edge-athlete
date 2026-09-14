import { redirect } from 'next/navigation';

/**
 * /explore → /sports/explore (Events program: Sports replaces Explore in
 * the header; Explore is the section's first place). Query-preserving so
 * the header search's `?course=` deep links and old shares keep working.
 */
export default async function ExploreAlias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') qs.set(k, v);
    else if (Array.isArray(v)) for (const item of v) qs.append(k, item);
  }
  const suffix = qs.toString();
  redirect(suffix ? `/sports/explore?${suffix}` : '/sports/explore');
}
