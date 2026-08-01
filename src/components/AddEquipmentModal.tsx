'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { X, Loader2, ChevronDown } from 'lucide-react';
import { useToast } from './Toast';
import type { EquipmentCategory, EquipmentSpecs } from './EquipmentSection';
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
}

// Sport picker: General + every enabled registry sport (single source of
// truth in equipment-config; per-sport category lists come from there too)
const SPORT_OPTIONS = getEquipmentSportOptions();

const isKnownSport = (key: string | undefined): key is string =>
  !!key && SPORT_OPTIONS.some(o => o.value === key);

export default function AddEquipmentModal({
  isOpen,
  onClose,
  onSuccess,
  profileId,
  defaultCategory,
  defaultSport,
  replacingEquipment,
}: AddEquipmentModalProps) {
  const { showSuccess, showError } = useToast();
  const [loading, setLoading] = useState(false);

  // Sport selection — respect the caller's default for ANY known sport
  // (Replace on an ice-hockey item must not silently become golf)
  const initialSport = isKnownSport(defaultSport) ? defaultSport : 'golf';
  const [sportKey, setSportKey] = useState<string>(initialSport);

  // Form state
  const [equipmentType, setEquipmentType] = useState(''); // For general equipment
  const [category, setCategory] = useState<string>(
    defaultCategory || getEquipmentCategories(initialSport)[0]?.value || 'other'
  ); // For sports with a curated category list
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [status, setStatus] = useState<'active' | 'retired'>('active');
  const [notes, setNotes] = useState('');

  // User-editable dates ('in bag since' + optional retirement date)
  const todayStr = () => new Date().toISOString().split('T')[0];
  const [acquiredOn, setAcquiredOn] = useState(todayStr());
  const [retiredOn, setRetiredOn] = useState('');

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
  const [specValues, setSpecValues] = useState<Record<string, string>>({});
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

  // Declared above its first use (closeAndReset, below): react-hooks/
  // immutability requires declaration before access in source order, and
  // hoisting does not satisfy it outside a useEffect callback.
  function resetForm() {
    setSportKey(initialSport);
    setEquipmentType('');
    setCategory(getEquipmentCategories(initialSport)[0]?.value || 'other');
    setBrand('');
    setModel('');
    setImageUrl('');
    setStatus('active');
    setNotes('');
    setAcquiredOn(todayStr());
    setRetiredOn('');
    setSpecValues({});
    setShowBrandDropdown(false);
    setShowModelDropdown(false);
  }

  const closeAndReset = () => {
    resetForm();
    onClose();
  };

  // Any user-entered field (the ones resetForm clears) counts as unsaved.
  const isDirty = () =>
    equipmentType.trim() !== '' ||
    brand.trim() !== '' ||
    model.trim() !== '' ||
    imageUrl.trim() !== '' ||
    notes.trim() !== '' ||
    Object.values(specValues).some(v => v.trim() !== '') ||
    retiredOn.trim() !== '' ||
    status !== 'active';

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, closeAndReset);

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

      const response = await fetch('/api/equipment', {
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
          acquiredOn: acquiredOn || undefined,
          retiredOn: status === 'retired' && retiredOn ? retiredOn : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add equipment');
      }

      showSuccess('Success', 'Equipment added successfully!');
      resetForm();
      onSuccess();
      onClose();
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Failed to add equipment');
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
      <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl max-h-modal overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {replacingEquipment ? 'Add Replacement Equipment' : 'Add Equipment'}
            </h2>
            {replacingEquipment && (
              <p className="text-sm text-gray-500 mt-1">
                Replacing: {replacingEquipment.brand} {replacingEquipment.model}
              </p>
            )}
          </div>
          <button
            onClick={requestClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="px-6 py-6 space-y-6">
            {/* Sport Selector */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Sport *
              </label>
              <select
                value={sportKey}
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
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
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Equipment Type *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
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
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Equipment Type *
                </label>
                <input
                  type="text"
                  value={equipmentType}
                  onChange={(e) => setEquipmentType(e.target.value)}
                  placeholder="e.g., Running Shoes, Yoga Mat, Foam Roller"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  required
                />
              </div>
            )}

            {/* Brand & Model with Autocomplete */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Brand — suggestions for every sport that has a seed list,
                  free text always. General has no list and so no dropdown. */}
              <div className="relative">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
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
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                    required
                    autoComplete="off"
                  />
                  {hasBrandCatalog && (
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                  )}
                </div>
                {showBrandDropdown && brandSuggestions.length > 0 && (
                  <div
                    ref={brandDropdownRef}
                    className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-[min(15rem,40vh)] overflow-y-auto"
                  >
                    {brandSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.value}
                        type="button"
                        onClick={() => handleBrandSelect(suggestion.value)}
                        className="w-full px-4 py-2.5 text-left text-sm text-gray-900 hover:bg-violet-50 hover:text-violet-700 transition-colors border-b border-gray-100 last:border-b-0 flex items-center gap-3"
                      >
                        <BrandLogo domain={suggestion.domain} name={suggestion.value} />
                        <span className="flex-1">{suggestion.value}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-gray-500">
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
                <label className="block text-sm font-semibold text-gray-900 mb-2">
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
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                  required
                />
                {showModelDropdown && modelSuggestions.length > 0 && (
                  <div
                    ref={modelDropdownRef}
                    className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-[min(15rem,40vh)] overflow-y-auto"
                  >
                    {modelSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.value}
                        type="button"
                        onClick={() => handleModelSelect(suggestion.value)}
                        className="w-full px-4 py-2.5 text-left hover:bg-violet-50 transition-colors"
                      >
                        <div className="text-sm font-medium text-gray-900">{suggestion.value}</div>
                        {suggestion.year && (
                          <div className="text-xs text-gray-500">Year: {suggestion.year}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-gray-500">Type any model name</p>
              </div>
            </div>

            {/* Equipment Image Upload */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Equipment Image (Optional)
              </label>
              <EquipmentImageUpload value={imageUrl} onChange={setImageUrl} />
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Status
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="active"
                    checked={status === 'active'}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'retired')}
                    className="w-4 h-4 text-violet-600"
                  />
                  <span className="text-sm font-medium text-gray-900">Active (currently using)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="retired"
                    checked={status === 'retired'}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'retired')}
                    className="w-4 h-4 text-gray-600"
                  />
                  <span className="text-sm font-medium text-gray-900">Retired (no longer using)</span>
                </label>
              </div>
            </div>

            {/* Dates — power the "in bag during year" filter */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="equipment-acquired-on" className="block text-sm font-semibold text-gray-900 mb-2">
                  Active since
                </label>
                <input
                  id="equipment-acquired-on"
                  type="date"
                  value={acquiredOn}
                  onChange={(e) => setAcquiredOn(e.target.value)}
                  max={todayStr()}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-base bg-white"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Backdate gear you owned before joining Edge Athlete.
                </p>
              </div>
              {status === 'retired' && (
                <div>
                  <label htmlFor="equipment-retired-on" className="block text-sm font-semibold text-gray-900 mb-2">
                    Retired on
                  </label>
                  <input
                    id="equipment-retired-on"
                    type="date"
                    value={retiredOn}
                    onChange={(e) => setRetiredOn(e.target.value)}
                    min={acquiredOn || undefined}
                    max={todayStr()}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-base bg-white"
                  />
                  <p className="text-xs text-gray-500 mt-1">Defaults to today if left blank.</p>
                </div>
              )}
            </div>

            {/* Specifications — driven by equipment-specs.ts for the chosen
                sport AND category, so a hockey stick asks for blade curve and
                a bat asks for weight drop. Absent for General. */}
            {specFields.length > 0 && (
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">
                  Specifications (Optional)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {specFields.map((field) => (
                    <div key={field.key}>
                      <label
                        htmlFor={`spec-${field.key}`}
                        className="block text-sm font-medium text-gray-700 mb-1"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
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
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any personal notes about this equipment..."
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              onClick={requestClose}
              className="px-6 py-2.5 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-violet-600 text-white font-semibold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Adding...
                </>
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
