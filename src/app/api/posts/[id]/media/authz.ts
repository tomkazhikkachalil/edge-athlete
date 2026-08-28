// Shared gate for the post-media edit routes: the post owner, or a profile
// role that resolves 'write_content' (the same rule the posts API's
// pin/approve PATCH uses). Role-driven, not flag-gated (Wave 1 inversion).

export async function mayManagePostMedia(userId: string, ownerId: string): Promise<boolean> {
  if (userId === ownerId) return true;
  const { getProfileRole } = await import('@/lib/auth-server');
  const { resolveProfileAction } = await import('@/lib/profile-roles');
  return resolveProfileAction(await getProfileRole(userId, ownerId), 'write_content');
}
