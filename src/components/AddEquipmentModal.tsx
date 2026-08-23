'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { X, Loader2, ChevronDown } from 'lucide-react';
import { useToast } from './Toast';
import type { EquipmentCategory, EquipmentItem, EquipmentSpecs } from '@/types/equipment';
import { getBrandSuggestions, getModelSuggestions } from '@/lib/equipment-catalog';
import { getBrandPlaceholder, getModelPlaceholder } from '@/lib/equipment-brands';
import { getSpecFields } from '@/lib/equipment-specs';
import { getEquipmentCategories, getEquipmentSportOptions } from '@/lib/equipment-config';
import BrandLogo from './BrandLogo';
import LogoDevAttribution from './LogoDevAttribution';
import { LOGO_DEV_ENABLED } from '@/lib/logo-dev';
import EquipmentImageUpload from './EquipmentImageUpload';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import ConfirmModal from './ConfirmModal';
import { COPY } from '@/lib/copy';
import { localDayKey } from '@/lib/calendar/grid';

interface AddEquipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  profileId: string;
  defaultCategory?: EquipmentCategory;
  defaultSport?: string;
  replacingEquipment?: {
    brand: string;
    model: string;
  };
  /** The athlete's existing set labels, for the Set/Collection datalist. */
  existingGroupLabels?: string[];
  /**
   * Presence switches the form to EDIT mode: fields seed from the item and
   * submit PATCHes it instead of creating a new row. Callers must mount a
   * FRESH instance per item (conditional render + key={item.id}) — all state
   * seeds via useState initializers, exactly like the Replace flow's
   * conditional mount. Mutually exclusive with `replacingEquipment`.
   */
  editingItem?: EquipmentItem;
}

// Sport picker: General + every enabled registry sport (single source of
// truth in equipment-config; per-sport category lists come from there too)
const SPORT_OPTIONS = getEquipmentSportOptions();

const isKnownSport = (key: string | undefined): key is string =>
  !!key && SPORT_OPTIONS.some(o => o.value === key);

const todayStr = () => localDayKey(new Date());

/**
 * One snapshot drives the whole form: useState initializers, resetForm and
 * isDirty all read it, so add mode (blanks) and edit mode (the item's values)
 * are the same code path rather than two.
 */
function seedFrom(
  editingItem: EquipmentItem | undefined,
  defaultSport: string | undefined,
  defaultCategory: EquipmentCategory | undefined
) {
  // Unknown/absent sport seeds to 'general' (the picker's catch-all), never
  // to golf — the old golf fallback silently mislabeled gear.
  const sport = editingItem
    ? (isKnownSport(editingItem.sport_key) ? editingItem.sport_key : 'general')
    : (isKnownSport(defaultSport) ? defaultSport : 'general');
  const hasCatalog = getEquipmentCategories(sport).length > 0;
  const specValues: Record<string, string> = {};
  if (editingItem?.specs) {
    for (const [k, v] of Object.entries(editingItem.specs)) {
      if (typeof v === 'string') specValues[k] = v;
    }
  }
  return {
    sportKey: sport,
    // Curated-list sports use `category`; the rest edit `equipmentType`.
    category: editingItem && hasCatalog
      ? editingItem.category
      : defaultCategory || getEquipmentCategories(sport)[0]?.value || 'other',
    equipmentType: editingItem && !hasCatalog ? editingItem.category : '',
    brand: editingItem?.brand ?? '',
    model: editingItem?.model ?? '',
    imageUrl: editingItem?.image_url ?? '',
    status: editingItem?.status ?? ('active' as const),
    notes: editingItem?.notes ?? '',
    groupLabel: editingItem?.group_label ?? '',
    acquiredOn: editingItem?.acquired_on ?? todayStr(),
    retiredOn: editingItem?.retired_on ?? '',
    specValues,
  };
}

export default function AddEquipmentModal({
  isOpen,
  onClose,
  onSuccess,
  profileId,
  defaultCategory,
  defaultSport,
  replacingEquipment,
  editingItem,
  existingGroupLabels = [],
}: AddEquipmentModalProps) {
  const { showSuccess, showError } = useToast();
  const [loading, setLoading] = useState(false);

  // Computed once per mount — edit-mode callers remount per item (key), so
  // this never needs re-seeding and no effect touches form state.
  const [initial] = useState(() => seedFrom(editingItem, defaultSport, defaultCategory));
  const isEditMode = !!editingItem;

  const [sportKey, setSportKey] = useState<string>(initial.sportKey);

  // Form state
  const [equipmentType, setEquipmentType] = useState(initial.equipmentType); // For general equipment
  const [category, setCategory] = useState<string>(initial.category); // For sports with a curated category list
  const [brand, setBrand] = useState(initial.brand);
  const [model, setModel] = useState(initial.model);
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [status, setStatus] = useState<'active' | 'retired'>(initial.status);
  const [notes, setNotes] = useState(initial.notes);
  const [groupLabel, setGroupLabel] = useState(initial.groupLabel);

  // User-editable dates ('in bag since' + optional retirement date)
  const [acquiredOn, setAcquiredOn] = useState(initial.acquiredOn);
  const [retiredOn, setRetiredOn] = useState(initial.retiredOn);

  // Autocomplete state
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Refs for autocomplete
  const brandInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const brandDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Specs: one map keyed by spec field, driven by equipment-specs.ts. Was six
  // named useStates for golf's loft/shaft/flex/length/lie/grip, cleared in
  // four separate places and rendered only when sportKey === 'golf'.
  const [specValues, setSpecValues] = useState<Record<string, string>>(initial.specValues);
  const specFields = useMemo(() => getSpecFields(sportKey, category), [sportKey, category]);

  // Suggestions are DERIVED, not fetched. The seed lists are plain data, so
  // there is nothing to await — the old code awaited a fake setTimeout(100)
  // that imitated an API call, which just delayed the dropdown by 100ms.
  const brandSuggestions = useMemo(
    () => getBrandSuggestions(sportKey, brand),
    [sportKey, brand]
  );
  const hasBrandCatalog = useMemo(() => getBrandSuggestions(sportKey).length > 0, [sportKey]);
  const modelSuggestions = useMemo(
    () => (model.length > 0 ? getModelSuggestions(sportKey, { brand, category, query: model }) : []),
    [sportKey, brand, category, model]
  );

  // Close dropdowns on click/tap outside (touchstart too — waiting for the
  // synthesized mouse event is laggy and scroll-consumed taps never fire it)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        brandDropdownRef.current &&
        !brandDropdownRef.current.contains(event.target as Node) &&
        !brandInputRef.current?.contains(event.target as Node)
      ) {
        setShowBrandDropdown(false);
      }
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(event.target as Node) &&
        !modelInputRef.current?.contains(event.target as Node)
      ) {
        setShowModelDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // On short viewports the panel can open clipped below the form's scroll
  // area — nudge it into view (no-op when already visible).
  useEffect(() => {
    if (!showBrandDropdown && !showModelDropdown) return;
    const el = showBrandDropdown ? brandDropdownRef.current : modelDropdownRef.current;
    // rAF: the panel must be laid out before measuring
    requestAnimationFrame(() => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, [showBrandDropdown, showModelDropdown]);

  // Lock background scroll while open (iOS scroll-chaining behind overlays)
  useBodyScrollLock(isOpen);

  // Escape closes — routed through requestClose so the dirty guard still
  // asks before discarding (FollowersModal pattern). Registered only while
  // open; requestCloseRef avoids re-binding per keystroke.
  const requestCloseRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  // Declared above its first use (closeAndReset, below): react-hooks/
  // immutability requires declaration before access in source order, and
  // hoisting does not satisfy it outside a useEffect callback.
  function resetForm() {
    setSportKey(initial.sportKey);
    setEquipmentType(initial.equipmentType);
    setCategory(initial.category);
    setBrand(initial.brand);
    setModel(initial.model);
    setImageUrl(initial.imageUrl);
    setStatus(initial.status);
    setNotes(initial.notes);
    setGroupLabel(initial.groupLabel);
    setAcquiredOn(initial.acquiredOn);
    setRetiredOn(initial.retiredOn);
    setSpecValues(initial.specValues);
    setShowBrandDropdown(false);
    setShowModelDropdown(false);
  }

  const closeAndReset = () => {
    resetForm();
    onClose();
  };

  // Dirty = differs from the seeded snapshot. In add mode the snapshot is the
  // blanks, so this is the old "anything typed" check; in edit mode it means
  // "actually changed", so closing an untouched editor never asks to discard.
  const isDirty = () =>
    sportKey !== initial.sportKey ||
    category !== initial.category ||
    equipmentType.trim() !== initial.equipmentType.trim() ||
    brand.trim() !== initial.brand.trim() ||
    model.trim() !== initial.model.trim() ||
    imageUrl.trim() !== initial.imageUrl.trim() ||
    notes.trim() !== initial.notes.trim() ||
    groupLabel.trim() !== initial.groupLabel.trim() ||
    acquiredOn !== initial.acquiredOn ||
    retiredOn.trim() !== initial.retiredOn.trim() ||
    status !== initial.status ||
    specFields.some(f => (specValues[f.key]?.trim() ?? '') !== (initial.specValues[f.key]?.trim() ?? ''));

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, closeAndReset);

  // Latest-ref: keeps the Escape listener stable while always calling the
  // current requestClose (ref writes belong in effects, not render).
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation — sports without a curated category list use free text
    const sportCategories = getEquipmentCategories(sportKey);
    if (sportCategories.length === 0 && !equipmentType.trim()) {
      showError('Error', 'Equipment type is required');
      return;
    }

    if (!brand.trim() || !model.trim()) {
      showError('Error', 'Brand and model are required');
      return;
    }

    // Brand is deliberately NOT required to come from the suggestion list.
    // Golf used to enforce that, which blocked every custom builder, every
    // brand we forgot to seed, and any golfer who typed "Ping Golf".

    setLoading(true);

    try {
      // Build specs from the fields VISIBLE for this sport+category, in
      // declared order — equipment cards show the first three, and JSONB
      // preserves insertion order. Iterating specFields (rather than every
      // key ever typed) also drops values left behind by a category switch,
      // so a stick's blade curve never rides along on a pair of skates.
      const specs: EquipmentSpecs = {};
      for (const field of specFields) {
        const value = specValues[field.key]?.trim();
        if (value) specs[field.key] = value;
      }

      // Edit mode PATCHes the item with the full editable payload (always at
      // least one field, so the route's "No fields to update" 400 can't
      // fire); add mode POSTs a new row. Same field building either way.
      const response = editingItem
        ? await fetch(`/api/equipment/${editingItem.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              sportKey,
              category: sportCategories.length > 0 ? category : equipmentType,
              brand: brand.trim(),
              model: model.trim(),
              // '' clears the photo server-side (maps to null); the orphaned
              // upload is collected by the 48h storage sweep.
              imageUrl: imageUrl.trim(),
              specs,
              status,
              notes: notes.trim(),
              // '' clears the set server-side (maps to null)
              groupLabel: groupLabel.trim(),
              acquiredOn: acquiredOn || undefined,
              retiredOn: status === 'retired' && retiredOn ? retiredOn : undefined,
            }),
          })
        : await fetch('/api/equipment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              profileId,
              sportKey,
              category: sportCategories.length > 0 ? category : equipmentType,
              brand: brand.trim(),
              model: model.trim(),
              imageUrl: imageUrl.trim() || undefined,
              specs: Object.keys(specs).length > 0 ? specs : undefined,
              status,
              notes: notes.trim() || undefined,
              groupLabel: groupLabel.trim() || undefined,
              acquiredOn: acquiredOn || undefined,
              retiredOn: status === 'retired' && retiredOn ? retiredOn : undefined,
            }),
          });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || (editingItem ? 'Failed to update equipment' : 'Failed to add equipment'));
      }

      showSuccess('Success', editingItem ? 'Equipment updated' : 'Equipment added successfully!');
      resetForm();
      onSuccess();
      onClose();
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Failed to save equipment');
    } finally {
      setLoading(false);
    }
  };


  const handleBrandSelect = (brandName: string) => {
    setBrand(brandName);
    setShowBrandDropdown(false);
    // Clear model when brand changes
    setModel('');
  };

  const handleModelSelect = (modelName: string) => {
    setModel(modelName);
    setShowModelDropdown(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <div className="relative w-full max-w-2xl bg-surface-raised rounded-xl shadow-2xl max-h-modal overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-primary">
              {isEditMode ? 'Edit Equipment' : replacingEquipment ? 'Add Replacement Equipment' : 'Add Equipment'}
            </h2>
            {replacingEquipment && (
              <p className="text-sm text-muted mt-1 truncate">
                Replacing: {replacingEquipment.brand} {replacingEquipment.model}
              </p>
            )}
            {isEditMode && (
              <p className="text-sm text-muted mt-1 truncate">
                {initial.brand} {initial.model}
              </p>
            )}
          </div>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="ea-icon-btn inline-flex items-center justify-center shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form. The fields scroll; the footer does NOT — it used to live
            inside the scroll container, so "Add Equipment" was only reachable
            after scrolling past ~10 fields. */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
            {/* Sport Selector. Locked in edit mode: switching sport silently
                invalidates the category and wipes the specs — for a genuine
                re-gear the Replace flow exists. */}
            <div>
              <label className="block text-sm font-semibold text-primary mb-2">
                Sport *
              </label>
              <select
                value={sportKey}
                disabled={isEditMode}
                title={isEditMode ? 'Sport can’t change on an existing item — use Replace to re-gear' : undefined}
                onChange={(e) => {
                  const nextSport = e.target.value;
                  setSportKey(nextSport);
                  // Reset category and specs when changing sports
                  setCategory(getEquipmentCategories(nextSport)[0]?.value || 'other');
                  setEquipmentType('');
                  setSpecValues({});
                  setShowBrandDropdown(false);
                  setShowModelDropdown(false);
                }}
                className="w-full px-4 py-3 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-surface disabled:bg-surface-muted disabled:text-muted disabled:cursor-not-allowed"
                required
              >
                {SPORT_OPTIONS.map((sport) => (
                  <option key={sport.value} value={sport.value}>
                    {sport.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Category: curated select for sports with a catalog,
                free text otherwise (General / unknown sports) */}
            {getEquipmentCategories(sportKey).length > 0 ? (
              <div>
                <label className="block text-sm font-semibold text-primary mb-2">
                  Equipment Type *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-3 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-surface"
                  required
                >
                  {getEquipmentCategories(sportKey).map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-primary mb-2">
                  Equipment Type *
                </label>
                <input
                  type="text"
                  value={equipmentType}
                  onChange={(e) => setEquipmentType(e.target.value)}
                  placeholder="e.g., Running Shoes, Yoga Mat, Foam Roller"
                  className="w-full px-4 py-3 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  required
                />
              </div>
            )}

            {/* Brand & Model with Autocomplete */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Brand — suggestions for every sport that has a seed list,
                  free text always. General has no list and so no dropdown. */}
              <div className="relative">
                <label className="block text-sm font-semibold text-primary mb-2">
                  Brand *
                </label>
                <div className="relative">
                  <input
                    ref={brandInputRef}
                    type="text"
                    value={brand}
                    onChange={(e) => {
                      setBrand(e.target.value);
                      setShowBrandDropdown(true);
                    }}
                    onFocus={() => setShowBrandDropdown(true)}
                    placeholder={hasBrandCatalog ? 'Search brands...' : getBrandPlaceholder(sportKey)}
                    className="w-full px-4 py-3 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                    required
                    autoComplete="off"
                  />
                  {hasBrandCatalog && (
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-faint pointer-events-none" />
                  )}
                </div>
                {showBrandDropdown && brandSuggestions.length > 0 && (
                  <div
                    ref={brandDropdownRef}
                    className="absolute z-10 w-full mt-1 bg-surface-raised border border-border-strong rounded-lg shadow-lg max-h-[min(15rem,40vh)] overflow-y-auto"
                  >
                    {brandSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.value}
                        type="button"
                        onClick={() => handleBrandSelect(suggestion.value)}
                        className="w-full px-4 py-2.5 text-left text-sm text-primary hover:bg-brand-soft hover:text-brand-fg-strong transition-colors border-b border-border-subtle last:border-b-0 flex items-center gap-3"
                      >
                        <BrandLogo domain={suggestion.domain} name={suggestion.value} />
                        <span className="flex-1">{suggestion.value}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-muted">
                  {hasBrandCatalog
                    ? 'Pick a suggestion or type your own'
                    : 'Enter any brand name'}
                  {/* Second required placement: "near logo displays". Gated on
                      LOGO_DEV_ENABLED as well as the component's own guard, or
                      the separator would dangle with no token configured. */}
                  {hasBrandCatalog && LOGO_DEV_ENABLED && (
                    <>
                      {' · '}
                      <LogoDevAttribution className="underline underline-offset-2" />
                    </>
                  )}
                </p>
              </div>

              {/* Model Input with Autocomplete */}
              <div className="relative">
                <label className="block text-sm font-semibold text-primary mb-2">
                  Model *
                </label>
                <input
                  ref={modelInputRef}
                  type="text"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setShowModelDropdown(true);
                  }}
                  onFocus={() => setShowModelDropdown(true)}
                  placeholder={getModelPlaceholder(sportKey)}
                  className="w-full px-4 py-3 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  required
                />
                {showModelDropdown && modelSuggestions.length > 0 && (
                  <div
                    ref={modelDropdownRef}
                    className="absolute z-10 w-full mt-1 bg-surface-raised border border-border-strong rounded-lg shadow-lg max-h-[min(15rem,40vh)] overflow-y-auto"
                  >
                    {modelSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.value}
                        type="button"
                        onClick={() => handleModelSelect(suggestion.value)}
                        className="w-full px-4 py-2.5 text-left hover:bg-brand-soft transition-colors"
                      >
                        <div className="text-sm font-medium text-primary">{suggestion.value}</div>
                        {suggestion.year && (
                          <div className="text-xs text-muted">Year: {suggestion.year}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-muted">Type any model name</p>
              </div>
            </div>

            {/* Equipment Image Upload */}
            <div>
              <label className="block text-sm font-semibold text-primary mb-2">
                Equipment Image (Optional)
              </label>
              <EquipmentImageUpload value={imageUrl} onChange={setImageUrl} />
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-semibold text-primary mb-2">
                Status
              </label>
              {/* Stacked below sm: side by side, each label wrapped to ~3
                  lines at 320px and the un-shrinkable radios got squashed. */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                <label className="flex items-center gap-2 cursor-pointer min-h-[44px] sm:min-h-0">
                  <input
                    type="radio"
                    value="active"
                    checked={status === 'active'}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'retired')}
                    className="w-4 h-4 shrink-0 text-brand-fg"
                  />
                  <span className="text-sm font-medium text-primary">Active (currently using)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer min-h-[44px] sm:min-h-0">
                  <input
                    type="radio"
                    value="retired"
                    checked={status === 'retired'}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'retired')}
                    className="w-4 h-4 shrink-0 text-tertiary"
                  />
                  <span className="text-sm font-medium text-primary">Retired (no longer using)</span>
                </label>
              </div>
            </div>

            {/* Dates — power the "in bag during year" filter */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="equipment-acquired-on" className="block text-sm font-semibold text-primary mb-2">
                  Active since
                </label>
                <input
                  id="equipment-acquired-on"
                  type="date"
                  value={acquiredOn}
                  onChange={(e) => setAcquiredOn(e.target.value)}
                  max={todayStr()}
                  className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-base bg-surface"
                />
                <p className="text-xs text-muted mt-1">
                  Backdate gear you owned before joining Edge Athlete.
                </p>
              </div>
              {status === 'retired' && (
                <div>
                  <label htmlFor="equipment-retired-on" className="block text-sm font-semibold text-primary mb-2">
                    Retired on
                  </label>
                  <input
                    id="equipment-retired-on"
                    type="date"
                    value={retiredOn}
                    onChange={(e) => setRetiredOn(e.target.value)}
                    min={acquiredOn || undefined}
                    max={todayStr()}
                    className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-base bg-surface"
                  />
                  <p className="text-xs text-muted mt-1">Defaults to today if left blank.</p>
                </div>
              )}
            </div>

            {/* Specifications — driven by equipment-specs.ts for the chosen
                sport AND category, so a hockey stick asks for blade curve and
                a bat asks for weight drop. Absent for General. */}
            {specFields.length > 0 && (
              <div className="pt-4 border-t border-border">
                <h3 className="text-lg font-bold text-primary mb-4">
                  Specifications (Optional)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {specFields.map((field) => (
                    <div key={field.key}>
                      <label
                        htmlFor={`spec-${field.key}`}
                        className="block text-sm font-medium text-secondary mb-1"
                      >
                        {field.label}
                      </label>
                      <input
                        id={`spec-${field.key}`}
                        type="text"
                        value={specValues[field.key] ?? ''}
                        onChange={(e) =>
                          setSpecValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        placeholder={field.placeholder}
                        list={field.options ? `spec-options-${field.key}` : undefined}
                        className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                      />
                      {/* Suggestions only — the input stays free text */}
                      {field.options && (
                        <datalist id={`spec-options-${field.key}`}>
                          {field.options.map((option) => (
                            <option key={option} value={option} />
                          ))}
                        </datalist>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-primary mb-2">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any personal notes about this equipment..."
                rows={3}
                className="w-full px-4 py-3 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
              />
            </div>

            {/* Set / Collection — optional custom grouping ("Tournament
                bag"). Datalist steers toward existing labels so typos don't
                fragment sets. */}
            <div>
              <label htmlFor="equipment-group-label" className="block text-sm font-semibold text-primary mb-2">
                Set / Collection (Optional)
              </label>
              <input
                id="equipment-group-label"
                type="text"
                value={groupLabel}
                onChange={(e) => setGroupLabel(e.target.value)}
                maxLength={60}
                list="equipment-group-labels"
                placeholder='Group gear into a named set — e.g. "Tournament bag"'
                className="w-full px-4 py-3 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <datalist id="equipment-group-labels">
                {existingGroupLabels.map(label => (
                  <option key={label} value={label} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Footer. Stacked below sm (ConfirmModal pattern): "Cancel" +
              "Add Equipment" at px-6 overflowed a 320px row. col-reverse
              keeps the primary action on top of the stack. */}
          <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 px-4 sm:px-6 py-4 border-t border-border bg-surface-muted">
            <button
              type="button"
              onClick={requestClose}
              className="px-6 py-2.5 text-secondary font-semibold rounded-lg hover:bg-gray-200 dark:hover:bg-stone-800 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-brand text-white font-semibold rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isEditMode ? 'Saving…' : 'Adding...'}
                </>
              ) : isEditMode ? (
                'Save Changes'
              ) : (
                'Add Equipment'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
