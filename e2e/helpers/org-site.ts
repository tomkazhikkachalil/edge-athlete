import { expect, type APIRequestContext } from '@playwright/test';
import { readErrorBody } from './qa-user';

/**
 * Site Builder P2-B (Sep 9 2026): a site's content edits (sections, order,
 * hero, theme, template, sponsors, documents, contact, course photos,
 * gallery picks) go to the DRAFT; the public page changes only on publish.
 * A spec that edits and then reads the PUBLIC page (or the module rows —
 * the published projection) calls this after its last edit.
 *
 * Pre-180 tolerance: before Tom runs migration 180 the revisions POST
 * answers 409 "…migration first (180)" and sitePATCH still writes live, so
 * there is nothing to publish — the helper returns quietly and the spec's
 * assertions hold either way. Everything else is a real failure.
 */
export async function publishSite(
  api: APIRequestContext,
  side: 'club' | 'league',
  orgId: string,
  label?: string
): Promise<void> {
  const res = await api.post(`/api/${side}s/${orgId}/site/revisions`, {
    data: { action: 'publish', ...(label ? { label } : {}) },
  });
  if (res.status() === 409 && (await res.text()).includes('180')) return;
  expect(res.status(), await readErrorBody(res)).toBe(200);
}

/** Whether the target database has migration 180 (the revisions GET says). */
export async function revisionsSupported(
  api: APIRequestContext,
  side: 'club' | 'league',
  orgId: string
): Promise<boolean> {
  const res = await api.get(`/api/${side}s/${orgId}/site/revisions`);
  if (res.status() !== 200) return false;
  return ((await res.json()) as { supported?: boolean }).supported === true;
}
