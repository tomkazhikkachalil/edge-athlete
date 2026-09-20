/**
 * Help Center vocabulary (Support & Reporting, Spec 3; migration 224).
 * ONE source for the topic list the CHECK pins; pure data, client-safe.
 */
export const HELP_TOPICS = [
  'getting_started',
  'posting_media',
  'events',
  'organizations',
  'family',
  'privacy_safety',
  'account',
  'other',
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

export const HELP_TOPIC_LABELS: Record<HelpTopic, string> = {
  getting_started: 'Getting started',
  posting_media: 'Posting and media',
  events: 'Events and tournaments',
  organizations: 'Clubs and leagues',
  family: 'Parents and minor accounts',
  privacy_safety: 'Privacy and reporting',
  account: 'Your account',
  other: 'Everything else',
};

export interface HelpArticle {
  id: string;
  slug: string;
  title: string;
  body: string;
  topic: HelpTopic;
  video_url: string | null;
  sort_order: number;
  published: boolean;
  created_at: string;
  updated_at: string;
}

/** The public shape: the video resolved to an embeddable id, the body as blocks. */
export interface PublicHelpArticle {
  slug: string;
  title: string;
  topic: HelpTopic;
  /** The YouTube video id when the article carries a valid link. */
  videoId: string | null;
  excerpt: string;
  updated_at: string;
}

export const HELP_LIMITS = { title: 140, body: 20000, slug: 80 } as const;

/** `Posting a round` → `posting-a-round`; deterministic and matches the CHECK. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, HELP_LIMITS.slug)
    .replace(/-+$/g, '');
}
