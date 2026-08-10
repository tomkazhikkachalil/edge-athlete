/**
 * Composer tag chips and hashtag suggestions, resolved per sport.
 *
 * The per-sport content lives on SportDefinition (tag_options /
 * hashtag_suggestions) — adding a sport's composer flavor is a registry
 * edit, not a component edit. Any sport without its own lists (and the
 * 'general' post type) gets the general defaults below. This replaced the
 * two-key {general, golf} maps that lived inside CreatePostModal and
 * EditPostModal.
 */

import { SPORT_REGISTRY, type SportKey, type SportPostTagOption } from './SportRegistry';

export const GENERAL_TAG_OPTIONS: SportPostTagOption[] = [
  { value: 'training', label: 'Training', color: 'blue' },
  { value: 'competition', label: 'Competition', color: 'red' },
  { value: 'achievement', label: 'Achievement', color: 'green' },
  { value: 'team', label: 'Team', color: 'purple' },
  { value: 'lifestyle', label: 'Lifestyle', color: 'yellow' },
];

export const GENERAL_HASHTAG_SUGGESTIONS: string[] = [
  '#Athletics', '#SportLife', '#Training', '#Fitness',
  '#Athlete', '#PersonalBest', '#GameDay', '#Champions',
];

export function getTagOptions(postType: SportKey | 'general' | string): SportPostTagOption[] {
  if (postType !== 'general' && postType in SPORT_REGISTRY) {
    const sport = SPORT_REGISTRY[postType as SportKey];
    if (sport.tag_options && sport.tag_options.length > 0) return sport.tag_options;
  }
  return GENERAL_TAG_OPTIONS;
}

export function getHashtagSuggestions(postType: SportKey | 'general' | string): string[] {
  if (postType !== 'general' && postType in SPORT_REGISTRY) {
    const sport = SPORT_REGISTRY[postType as SportKey];
    if (sport.hashtag_suggestions && sport.hashtag_suggestions.length > 0) {
      return sport.hashtag_suggestions;
    }
  }
  return GENERAL_HASHTAG_SUGGESTIONS;
}
