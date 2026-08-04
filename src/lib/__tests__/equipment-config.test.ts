import { describe, it, expect } from 'vitest';
import {
  getEquipmentCategories,
  getCategoryConfig,
  getEquipmentSportOptions,
  getSetupLabel,
} from '../equipment-config';

describe('getEquipmentCategories', () => {
  it('returns the curated list for sports that have one', () => {
    const golf = getEquipmentCategories('golf');
    expect(golf.map(c => c.value)).toContain('driver');
    expect(getEquipmentCategories('ice_hockey').map(c => c.value)).toContain('stick');
  });

  it('returns empty for general and unknown sports', () => {
    expect(getEquipmentCategories('general')).toEqual([]);
    expect(getEquipmentCategories('curling')).toEqual([]);
  });
});

describe('getCategoryConfig', () => {
  it('resolves known categories per sport', () => {
    expect(getCategoryConfig('golf', 'driver').label).toBe('Driver');
    expect(getCategoryConfig('volleyball', 'knee_pads').label).toBe('Knee Pads');
  });

  it('never throws on free-text/unknown categories and humanizes the label', () => {
    const config = getCategoryConfig('general', 'Running Shoes');
    expect(config.label).toBe('Running Shoes');
    expect(config.icon).toBeTruthy();
    expect(config.color).toBeTruthy();
    expect(getCategoryConfig('golf', 'mystery_gadget').label).toBe('Mystery Gadget');
  });

  it('falls back to a generic label for empty category text', () => {
    expect(getCategoryConfig('general', '').label).toBe('Equipment');
  });
});

describe('getEquipmentSportOptions', () => {
  it('puts General first, excludes training, and uses registry display names', () => {
    const options = getEquipmentSportOptions();
    expect(options[0]).toEqual({ value: 'general', label: 'General / Other' });
    expect(options.map(o => o.value)).not.toContain('training');
    expect(options.find(o => o.value === 'golf')?.label).toBe('Golf');
    expect(options.find(o => o.value === 'ice_hockey')?.label).toBe('Ice Hockey');
  });

  it('only offers enabled sports', () => {
    const values = getEquipmentSportOptions().map(o => o.value);
    expect(values).not.toContain('tennis'); // disabled in the registry
    expect(values).not.toContain('football'); // disabled in the registry
  });
});

describe('getSetupLabel', () => {
  it('is sport-appropriate for golf and neutral otherwise', () => {
    expect(getSetupLabel('golf')).toBe('In the Bag');
    expect(getSetupLabel('soccer')).toBe('Current Setup');
    expect(getSetupLabel('general')).toBe('Current Setup');
    expect(getSetupLabel('not-a-sport')).toBe('Current Setup');
  });
});
