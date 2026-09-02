import { describe, expect, it } from 'vitest';
import { FULL_WIDTH_MODULES, TEMPLATE_IDS, isTemplateId, templateSpec } from '../templates';

describe('templates', () => {
  it('resolves ids and falls back to classic for anything unknown', () => {
    expect(TEMPLATE_IDS).toEqual(['classic', 'bold']);
    expect(isTemplateId('bold')).toBe(true);
    expect(isTemplateId('BOLD')).toBe(false);
    expect(templateSpec(undefined).id).toBe('classic');
    expect(templateSpec('brutalist').id).toBe('classic');
    expect(templateSpec(42).id).toBe('classic');
  });

  it('classic is the shipped markup; bold differs on every axis', () => {
    const classic = templateSpec('classic');
    const bold = templateSpec('bold');
    expect(classic).toMatchObject({ header: 'bar', hero: 'card', sections: 'stack', teams: 'chips', density: 'comfortable' });
    expect(bold).toMatchObject({ header: 'band', hero: 'bleed', sections: 'grid', teams: 'tiles', density: 'compact' });
    for (const key of ['header', 'hero', 'sections', 'teams', 'density'] as const) {
      expect(classic[key]).not.toBe(bold[key]);
    }
  });

  it('teams/news/gallery/courses span the grid', () => {
    expect(FULL_WIDTH_MODULES.has('teams')).toBe(true);
    expect(FULL_WIDTH_MODULES.has('standings')).toBe(false);
  });
});
