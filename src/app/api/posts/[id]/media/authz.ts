// Shared gate for the post-media edit routes: the post owner, or — behind
// the guardian flag — a profile role that resolves 'write_content' (the
// same rule the posts API's pin/approve PATCH uses).

import { FEATURE_FLAGS } from '@/lib/features';

export async function mayManagePostMedia(userId: string, ownerId: string): Promise<boolean> {
  if (userId === ownerId) return true;
  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) return false;
  const { getProfileRole } = await import('@/lib/auth-server');
  const { resolveProfileAction } = await import('@/lib/profile-roles');
  return resolveProfileAction(await getProfileRole(userId, ownerId), 'write_content');
}
