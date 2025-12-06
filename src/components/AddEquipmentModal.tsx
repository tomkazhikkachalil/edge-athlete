'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Upload, Loader2, ChevronDown } from 'lucide-react';
import { useToast } from './Toast';
import type { EquipmentCategory, EquipmentSpecs } from './EquipmentSection';
import { getCatalogService, getPresetImages, type EquipmentBrand, type EquipmentModel } from '@/lib/equipment-catalog';
import EquipmentImageUpload from './EquipmentImageUpload';

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

// Sport options
type SportKey = 'general' | 'golf';

const SPORT_OPTIONS = [
  { value: 'general' as SportKey, label: 'General / Other' },
  { value: 'golf' as SportKey, label: 'Golf' },
];

// Golf-specific categories
const GOLF_CATEGORIES: { value: EquipmentCategory; label: string }[] = [
  { value: 'driver', label: 'Driver' },
  { value: 'fairway_wood', label: 'Fairway Wood' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'iron_set', label: 'Iron Set' },
  { value: 'wedge', label: 'Wedge' },
  { value: 'putter', label: 'Putter' },
  { value: 'ball', label: 'Golf Ball' },
  { value: 'shoes', label: 'Golf Shoes' },
  { value: 'glove', label: 'Golf Glove' },
  { value: 'bag', label: 'Golf Bag' },
  { value: 'rangefinder', label: 'Rangefinder' },
  { value: 'other', label: 'Other' },
];

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

  // Sport selection (use default if provided)
  const [sportKey, setSportKey] = useState<SportKey>(
    defaultSport === 'golf' ? 'golf' : 'golf'
  );

  // Form state
  const [equipmentType, setEquipmentType] = useState(''); // For general equipment
  const [category, setCategory] = useState<EquipmentCategory>(
    defaultCategory || 'driver'
  ); // For golf
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [status, setStatus] = useState<'active' | 'retired'>('active');
  const [notes, setNotes] = useState('');

  // Autocomplete state
  const [brandSuggestions, setBrandSuggestions] = useState<EquipmentBrand[]>([]);
  const [modelSuggestions, setModelSuggestions] = useState<EquipmentModel[]>([]);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [brandLoading, setBrandLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);

  // Refs for autocomplete
  const brandInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const brandDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Specs state (golf-specific)
  const [loft, setLoft] = useState('');
  const [shaft, setShaft] = useState('');
  const [flex, setFlex] = useState('');
  const [length, setLength] = useState('');
  const [lie, setLie] = useState('');
  const [grip, setGrip] = useState('');

  // Load all brands on mount or when sport changes (for golf)
  useEffect(() => {
    if (sportKey !== 'golf') {
      setBrandSuggestions([]);
      return;
    }

    // Load all brands immediately for dropdown
    const loadBrands = async () => {
      setBrandLoading(true);
      try {
        const catalogService = getCatalogService(sportKey);
        const results = await catalogService.searchBrands('');
        setBrandSuggestions(results);
      } catch (error) {
        console.error('Error fetching brand suggestions:', error);
      } finally {
        setBrandLoading(false);
      }
    };

    loadBrands();
  }, [sportKey]);

  // Filter brands based on search input
  const filteredBrands = brandSuggestions.filter(b =>
    b.name.toLowerCase().includes(brand.toLowerCase())
  );

  // Debounced model search
  useEffect(() => {
    if (sportKey !== 'golf' || model.length < 1) {
      setModelSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setModelLoading(true);
      try {
        const catalogService = getCatalogService(sportKey);
        const results = await catalogService.searchModels({
          brand: brand || undefined,
          category: category || undefined,
          query: model,
        });
        setModelSuggestions(results);
      } catch (error) {
        console.error('Error fetching model suggestions:', error);
      } finally {
        setModelLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [model, brand, category, sportKey]);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (sportKey === 'general' && !equipmentType.trim()) {
      showError('Error', 'Equipment type is required');
      return;
    }

    if (!brand.trim() || !model.trim()) {
      showError('Error', 'Brand and model are required');
      return;
    }

    // For golf, validate that brand is from the catalog
    if (sportKey === 'golf') {
      const validBrand = brandSuggestions.find(
        b => b.name.toLowerCase() === brand.toLowerCase()
      );
      if (!validBrand) {
        showError('Error', 'Please select a brand from the list');
        return;
      }
    }

    setLoading(true);

    try {
      // Build specs object (only include non-empty values for golf)
      const specs: EquipmentSpecs = {};
      if (sportKey === 'golf') {
        if (loft.trim()) specs.loft = loft.trim();
        if (shaft.trim()) specs.shaft = shaft.trim();
        if (flex.trim()) specs.flex = flex.trim();
        if (length.trim()) specs.length = length.trim();
        if (lie.trim()) specs.lie = lie.trim();
        if (grip.trim()) specs.grip = grip.trim();
      }

      const response = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          profileId,
          category: sportKey === 'golf' ? category : equipmentType,
          brand: brand.trim(),
          model: model.trim(),
          imageUrl: imageUrl.trim() || undefined,
          specs: Object.keys(specs).length > 0 ? specs : undefined,
          status,
          notes: notes.trim() || undefined,
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

  const resetForm = () => {
    setSportKey('golf');
    setEquipmentType('');
    setCategory('driver');
    setBrand('');
    setModel('');
    setImageUrl('');
    setStatus('active');
    setNotes('');
    setLoft('');
    setShaft('');
    setFlex('');
    setLength('');
    setLie('');
    setGrip('');
    setBrandSuggestions([]);
    setModelSuggestions([]);
    setShowBrandDropdown(false);
    setShowModelDropdown(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
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
            onClick={handleClose}
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
                  setSportKey(e.target.value as SportKey);
                  // Reset category and specs when changing sports
                  setCategory('driver');
                  setEquipmentType('');
                  setLoft('');
                  setShaft('');
                  setFlex('');
                  setLength('');
                  setLie('');
                  setGrip('');
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                required
              >
                {SPORT_OPTIONS.map((sport) => (
                  <option key={sport.value} value={sport.value}>
                    {sport.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Conditional: Golf Category Selector */}
            {sportKey === 'golf' && (
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Equipment Type *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as EquipmentCategory)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  required
                >
                  {GOLF_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Conditional: General Equipment Type */}
            {sportKey === 'general' && (
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Equipment Type *
                </label>
                <input
                  type="text"
                  value={equipmentType}
                  onChange={(e) => setEquipmentType(e.target.value)}
                  placeholder="e.g., Running Shoes, Yoga Mat, Basketball"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            )}

            {/* Brand & Model with Autocomplete */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Brand Selector (Golf: Dropdown only, General: Free text) */}
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
                      if (sportKey === 'golf') {
                        setShowBrandDropdown(true);
                      }
                    }}
                    onFocus={() => {
                      if (sportKey === 'golf') {
                        setShowBrandDropdown(true);
                      }
                    }}
                    placeholder={sportKey === 'golf' ? 'Search brands...' : 'e.g., Nike, Adidas, Under Armour'}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                    autoComplete="off"
                  />
                  {sportKey === 'golf' && (
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                  )}
                </div>
                {sportKey === 'golf' && showBrandDropdown && (
                  <div
                    ref={brandDropdownRef}
                    className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                  >
                    {brandLoading ? (
                      <div className="px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading brands...
                      </div>
                    ) : filteredBrands.length > 0 ? (
                      filteredBrands.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          onClick={() => handleBrandSelect(suggestion.name)}
                          className="w-full px-4 py-2.5 text-left text-sm text-gray-900 hover:bg-blue-50 hover:text-blue-700 transition-colors border-b border-gray-100 last:border-b-0 flex items-center gap-3"
                        >
                          {suggestion.logo ? (
                            <img
                              src={suggestion.logo}
                              alt={suggestion.name}
                              className="w-6 h-6 object-contain flex-shrink-0"
                              onError={(e) => {
                                // Hide image if it fails to load
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="w-6 h-6 flex-shrink-0 bg-gray-200 rounded flex items-center justify-center text-xs font-bold text-gray-600">
                              {suggestion.name.charAt(0)}
                            </div>
                          )}
                          <span className="flex-1">{suggestion.name}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-gray-500">
                        No brands found. Try searching differently.
                      </div>
                    )}
                  </div>
                )}
                {sportKey === 'golf' ? (
                  <p className="mt-1 text-xs text-gray-500">
                    Select from {brandSuggestions.length}+ golf brands
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-gray-500">
                    Enter any brand name
                  </p>
                )}
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
                  placeholder={sportKey === 'golf' ? 'e.g., Stealth 2, Pro V1' : 'e.g., Air Max, UltraBoost'}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                {sportKey === 'golf' && showModelDropdown && (modelSuggestions.length > 0 || modelLoading) && (
                  <div
                    ref={modelDropdownRef}
                    className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                  >
                    {modelLoading ? (
                      <div className="px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading models...
                      </div>
                    ) : (
                      modelSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          onClick={() => handleModelSelect(suggestion.name)}
                          className="w-full px-4 py-2.5 text-left hover:bg-blue-50 transition-colors"
                        >
                          <div className="text-sm font-medium text-gray-900">{suggestion.name}</div>
                          {suggestion.year && (
                            <div className="text-xs text-gray-500">Year: {suggestion.year}</div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {sportKey === 'golf' && (
                  <p className="mt-1 text-xs text-gray-500">
                    {brand ? 'Filtered by selected brand' : 'Select a brand for better suggestions'}
                  </p>
                )}
              </div>
            </div>

            {/* Equipment Image Upload */}
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Equipment Image (Optional)
              </label>
              <EquipmentImageUpload
                value={imageUrl}
                onChange={setImageUrl}
                presetImages={sportKey === 'golf' ? getPresetImages(brand, model, category) : []}
              />
              {sportKey === 'golf' && brand && model && (
                <p className="mt-1 text-xs text-gray-500">
                  Presets update automatically based on selected brand and model
                </p>
              )}
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
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm font-medium text-gray-900">Active (in my bag)</span>
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

            {/* Golf-Specific Specs Section */}
            {sportKey === 'golf' && (
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">
                  Specifications (Optional)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Loft</label>
                    <input
                      type="text"
                      value={loft}
                      onChange={(e) => setLoft(e.target.value)}
                      placeholder="e.g., 10.5°"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Shaft</label>
                    <input
                      type="text"
                      value={shaft}
                      onChange={(e) => setShaft(e.target.value)}
                      placeholder="e.g., Project X 6.0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Flex</label>
                    <input
                      type="text"
                      value={flex}
                      onChange={(e) => setFlex(e.target.value)}
                      placeholder="e.g., Stiff, Regular"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Length</label>
                    <input
                      type="text"
                      value={length}
                      onChange={(e) => setLength(e.target.value)}
                      placeholder='e.g., 45.5"'
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lie</label>
                    <input
                      type="text"
                      value={lie}
                      onChange={(e) => setLie(e.target.value)}
                      placeholder="e.g., 59°"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Grip</label>
                    <input
                      type="text"
                      value={grip}
                      onChange={(e) => setGrip(e.target.value)}
                      placeholder="e.g., Golf Pride Tour Velvet"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-2.5 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
