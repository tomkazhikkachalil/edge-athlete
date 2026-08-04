// Equipment domain types — extracted from EquipmentSection.tsx so that server
// code (the PATCH route's validation) and the three equipment modals can
// import them without pulling in a 'use client' component module.

// Categories are per-sport (see lib/equipment-config) and free text for
// General items — plain string, with display config resolved at render time.
export type EquipmentCategory = string;

export interface EquipmentSpecs {
  loft?: string;
  shaft?: string;
  flex?: string;
  length?: string;
  lie?: string;
  grip?: string;
  [key: string]: string | undefined; // Allow custom specs
}

export interface EquipmentItem {
  id: string;
  sport_key: string;
  category: EquipmentCategory;
  brand: string;
  model: string;
  image_url?: string;
  specs?: EquipmentSpecs;
  status: 'active' | 'retired';
  added_at: string;
  retired_at?: string;
  acquired_on?: string | null;
  retired_on?: string | null;
  notes?: string;
  /** Optional custom set ("Tournament bag"); null = automatic grouping. */
  group_label?: string | null;
  created_at: string;
  updated_at: string;
}
