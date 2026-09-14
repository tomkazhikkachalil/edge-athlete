import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth-server';
import { runCardAction } from '../card-action';

/** POST — {reopen?} — an organizer marks a card final, or reopens it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { user, error: authError } = await getServerAuth(request);
  if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  return runCardAction(request, user, params, 'from_body');
}
