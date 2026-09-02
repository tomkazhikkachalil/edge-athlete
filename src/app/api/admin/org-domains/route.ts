import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { adminDomainActionPOST, adminDomainsGET } from '@/lib/org-sites/domain-server';
import { AdminDomainActionSchema } from '@/lib/org-sites/validate';

// ── /api/admin/org-domains (phase 6b C1) ────────────────────────────────────
// Every claimed custom domain with its lifecycle state (the flagged-slugs
// pattern); POST retries the Vercel attach (after the ops env lands) or
// re-runs the reachability probe.

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return await adminDomainsGET(getSupabaseAdmin());
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN ORG DOMAINS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = await parseBody(request, AdminDomainActionSchema);
    if (!parsed.success) return parsed.response;
    return await adminDomainActionPOST(getSupabaseAdmin(), parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN ORG DOMAINS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
