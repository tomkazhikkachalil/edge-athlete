import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

// Seeds for the member round-photo specs (M2, program 10): a completed
// public golf round with a post and one image in post_media, the object
// really stored under posts/{userId}/ in the private uploads bucket (the
// public-URL form the media proxy parses). Returns the ids + the storage
// key for cleanup.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the e2e admin client is untyped
type Admin = SupabaseClient<any, 'public', any>;

export async function seedRoundPost(
  admin: Admin,
  userId: string,
  opts: { stamp: string; visibility: 'public' | 'private'; course?: string; date?: string }
): Promise<{ roundId: string; postId: string; mediaId: string; storageKey: string }> {
  const png = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'photo.png'));
  const storageKey = `posts/${userId}/qa-${opts.stamp}-${opts.visibility}-${Math.random().toString(36).slice(2, 7)}.png`;
  const up = await admin.storage.from('uploads').upload(storageKey, png, { contentType: 'image/png', upsert: true });
  if (up.error) throw new Error(`seed upload failed: ${up.error.message}`);
  const { data: round, error: roundError } = await admin
    .from('golf_rounds')
    .insert({
      profile_id: userId,
      date: opts.date ?? new Date().toISOString().slice(0, 10),
      course: opts.course ?? `QA Links ${opts.stamp}`,
      holes: 18,
      par: 72,
      round_type: 'outdoor',
      gross_score: 85,
      is_complete: true,
    })
    .select('id')
    .single();
  if (roundError || !round) throw new Error(`seed round failed: ${roundError?.message}`);
  const { data: post, error: postError } = await admin
    .from('posts')
    .insert({
      profile_id: userId,
      sport_key: 'golf',
      caption: `QA round ${opts.stamp} (${opts.visibility})`,
      visibility: opts.visibility,
      round_id: round.id,
      tags: [],
      hashtags: [],
      likes_count: 0,
      comments_count: 0,
    })
    .select('id')
    .single();
  if (postError || !post) throw new Error(`seed post failed: ${postError?.message}`);
  const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/uploads/${storageKey}`;
  const { data: media, error: mediaError } = await admin
    .from('post_media')
    .insert({ post_id: post.id, media_url: publicUrl, media_type: 'image', display_order: 1, width: 320, height: 240 })
    .select('id')
    .single();
  if (mediaError || !media) throw new Error(`seed media failed: ${mediaError?.message}`);
  return { roundId: round.id as string, postId: post.id as string, mediaId: media.id as string, storageKey };
}

export async function cleanRoundPost(admin: Admin, seed: { roundId: string; postId: string; storageKey: string } | null) {
  if (!seed) return;
  await admin.from('posts').delete().eq('id', seed.postId);
  await admin.from('golf_rounds').delete().eq('id', seed.roundId);
  await admin.storage.from('uploads').remove([seed.storageKey]);
}
