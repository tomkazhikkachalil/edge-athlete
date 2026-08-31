'use client';

import { useState } from 'react';
import {
  buildGridRows,
  gridRowKey,
  templateFor,
  type GridSelections,
} from '@/lib/orgs/structure-templates';
import type { DivisionDraftRow } from '@/lib/orgs/wizard-validate';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// ── One sport's grid section (wizard step 3) ────────────────────────────────
// Fully controlled: the wizard hoists SectionState; the division preview is
// DERIVED (buildGridRows + extras), never stored. ✕ on a grid row records
// its rowKey in `excluded`, so re-checking a box never resurrects it.

export interface SectionState {
  sportKey: string;
  vocab: { bands: string[]; streams: string[]; tiers: string[] };
  sel: GridSelections;
  excluded: string[];
  extras: DivisionDraftRow[];
}

export function emptySection(sportKey: string): SectionState {
  const t = templateFor(sportKey);
  return {
    sportKey,
    vocab: t
      ? { bands: t.bands, streams: t.streams, tiers: t.tiers }
      : { bands: [], streams: [], tiers: [] },
    sel: { bands: [], streams: [], tiers: [] },
    excluded: [],
    extras: [],
  };
}

export function applyTemplateDefaults(section: SectionState): SectionState {
  const t = templateFor(section.sportKey);
  if (!t) return section;
  return {
    ...section,
    vocab: { bands: t.bands, streams: t.streams, tiers: t.tiers },
    sel: { ...t.defaults, bands: [...t.defaults.bands], streams: [...t.defaults.streams], tiers: [...t.defaults.tiers] },
    excluded: [],
  };
}

/** The section's final division rows — the POST/draft shape. */
export function sectionRows(section: SectionState): DivisionDraftRow[] {
  return [
    ...buildGridRows(section.sportKey, section.sel, new Set(section.excluded)),
    ...section.extras,
  ];
}

const AXES = [
  { key: 'bands' as const, label: 'Age bands', placeholder: 'e.g., U13' },
  { key: 'streams' as const, label: 'Streams', placeholder: 'e.g., Girls' },
  { key: 'tiers' as const, label: 'Tiers', placeholder: 'e.g., A' },
];

export default function StructureGridBuilder({
  section,
  onChange,
  onRemove,
}: {
  section: SectionState;
  onChange: (next: SectionState) => void;
  /** Present on the club side (multi-sport sections are removable). */
  onRemove?: () => void;
}) {
  const [customValue, setCustomValue] = useState<Record<string, string>>({});
  const [customName, setCustomName] = useState('');

  const rows = sectionRows(section);
  const sportLabel =
    SPORT_REGISTRY[section.sportKey as keyof typeof SPORT_REGISTRY]?.display_name ?? section.sportKey;

  const toggle = (axis: 'bands' | 'streams' | 'tiers', value: string) => {
    const has = section.sel[axis].includes(value);
    onChange({
      ...section,
      sel: {
        ...section.sel,
        [axis]: has ? section.sel[axis].filter(v => v !== value) : [...section.sel[axis], value],
      },
    });
  };

  const addVocab = (axis: 'bands' | 'streams' | 'tiers') => {
    const value = (customValue[axis] ?? '').trim();
    if (!value || section.vocab[axis].includes(value)) return;
    onChange({
      ...section,
      vocab: { ...section.vocab, [axis]: [...section.vocab[axis], value] },
      sel: { ...section.sel, [axis]: [...section.sel[axis], value] },
    });
    setCustomValue(v => ({ ...v, [axis]: '' }));
  };

  const removeRow = (row: DivisionDraftRow, index: number) => {
    const gridCount = rows.length - section.extras.length;
    if (index >= gridCount) {
      onChange({ ...section, extras: section.extras.filter((_, i) => i !== index - gridCount) });
    } else {
      onChange({
        ...section,
        excluded: [
          ...section.excluded,
          gridRowKey(section.sportKey, row.ageBand ?? '', row.genderStream ?? null, row.tier ?? null),
        ],
      });
    }
  };

  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    onChange({ ...section, extras: [...section.extras, { sportKey: section.sportKey, name }] });
    setCustomName('');
  };

  return (
    <div className="border border-border rounded-lg p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-primary text-sm">{sportLabel}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            {rows.length} division{rows.length === 1 ? '' : 's'}
          </span>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${sportLabel} section`}
              className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
            >
              <i className="fas fa-times" aria-hidden="true"></i>
            </button>
          )}
        </div>
      </div>

      {AXES.map(axis => (
        <div key={axis.key}>
          <p className="text-xs font-semibold text-tertiary uppercase tracking-wide mb-1">
            {axis.label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {section.vocab[axis.key].map(value => {
              const on = section.sel[axis.key].includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggle(axis.key, value)}
                  aria-pressed={on}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    on
                      ? 'bg-brand text-white border-brand'
                      : 'border-border-strong text-secondary hover:bg-surface-sunken'
                  }`}
                >
                  {value}
                </button>
              );
            })}
            <span className="inline-flex items-center gap-1">
              <input
                type="text"
                value={customValue[axis.key] ?? ''}
                maxLength={30}
                onChange={e => setCustomValue(v => ({ ...v, [axis.key]: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addVocab(axis.key);
                  }
                }}
                placeholder={axis.placeholder}
                aria-label={`Add ${axis.label.toLowerCase()} value`}
                className="w-24 px-2 py-1 text-xs border border-border-strong rounded-full outline-none"
              />
              <button
                type="button"
                onClick={() => addVocab(axis.key)}
                aria-label={`Add to ${axis.label.toLowerCase()}`}
                className="text-xs text-brand-fg hover:text-brand-fg-strong font-medium"
              >
                Add
              </button>
            </span>
          </div>
        </div>
      ))}

      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((row, i) => (
            <li
              key={`${row.name}-${i}`}
              className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-surface-muted"
            >
              <span className="text-sm text-primary truncate">{row.name}</span>
              <button
                type="button"
                onClick={() => removeRow(row, i)}
                aria-label={`Remove ${row.name}`}
                className="text-muted hover:text-red-600 shrink-0"
              >
                <i className="fas fa-times text-xs" aria-hidden="true"></i>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={customName}
          maxLength={80}
          onChange={e => setCustomName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Custom division name"
          aria-label={`Custom division for ${sportLabel}`}
          className="grow basis-40 min-w-0 px-3 py-1.5 text-sm border border-border-strong rounded-md outline-none"
        />
        <button
          type="button"
          onClick={addCustom}
          className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
        >
          Add division
        </button>
      </div>
    </div>
  );
}
