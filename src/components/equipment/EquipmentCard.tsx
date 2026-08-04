'use client';

import { Edit2, Trash2, CheckCircle2, Archive, RefreshCw } from 'lucide-react';
import OptimizedImage from '../OptimizedImage';
import BrandLogo from '../BrandLogo';
import { getCategoryConfig } from '@/lib/equipment-config';
import { resolveBrandDomain } from '@/lib/equipment-catalog';
import { formatMonthYear, yearOf } from '@/lib/profile-filters';
import type { EquipmentItem } from '@/types/equipment';

// Extracted verbatim from EquipmentSection (store-browse redesign) — the card
// itself is layout-agnostic; shelf vs grid sizing is the CONTAINER's concern.

export interface EquipmentCardProps {
  item: EquipmentItem;
  isOwnProfile: boolean;
  onEdit: () => void;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onReplace: () => void;
}

// "Active since Mar 2024" (active) / "2019 – 2023" or "Mar 2023 – Jun 2023"
// (retired; month detail only within a single year). User dates first,
// server audit timestamps as fallback for legacy rows.
export function formatOwnershipSpan(item: EquipmentItem): string | null {
  const acquired = item.acquired_on ?? item.added_at;
  if (!acquired) return null;
  if (item.status === 'active') {
    return `Active since ${formatMonthYear(acquired)}`;
  }
  const retired = item.retired_on ?? item.retired_at;
  if (!retired) return `Active since ${formatMonthYear(acquired)}`;
  const sameYear = yearOf(acquired) === yearOf(retired);
  return sameYear
    ? `${formatMonthYear(acquired)} – ${formatMonthYear(retired)}`
    : `${formatMonthYear(acquired, { yearOnly: true })} – ${formatMonthYear(retired, { yearOnly: true })}`;
}

export default function EquipmentCard({ item, isOwnProfile, onEdit, onDelete, onToggleStatus, onReplace }: EquipmentCardProps) {
  const config = getCategoryConfig(item.sport_key || 'general', item.category);
  const isActive = item.status === 'active';
  const ownershipSpan = formatOwnershipSpan(item);
  // Auto imagery: free-text brand → seed domain (exact canonical/alias match
  // only — a wrong logo is worse than none).
  const brandDomain = resolveBrandDomain(item.sport_key || 'general', item.brand);
  const categoryEmoji = (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="text-6xl">{config.icon}</span>
    </div>
  );

  return (
    <div
      className={`relative rounded-lg overflow-hidden transition-all duration-200 ${
        isActive
          ? 'bg-white border-2 border-gray-200 hover:border-violet-400 hover:shadow-lg'
          : 'bg-gray-50 border-2 border-gray-200'
      }`}
    >
      {/* Status badge */}
      <div className="absolute top-3 right-3 z-10">
        {isActive ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-600 text-white text-xs font-bold rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-600 text-white text-xs font-bold rounded-full">
            <Archive className="w-3 h-3" />
            Retired
          </span>
        )}
      </div>

      {/* Image */}
      <div className={`aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative ${isActive ? '' : 'opacity-75'}`}>
        {item.image_url ? (
          <OptimizedImage
            src={item.image_url}
            alt={`${item.brand} ${item.model}`}
            width={400}
            height={300}
            className="w-full h-full object-contain p-4"
          />
        ) : brandDomain ? (
          // No photo → the brand's logo fills in ("people might get lazy");
          // no token / no logo → the category emoji, same as no-photo before.
          <div className="absolute inset-0 flex items-center justify-center">
            <BrandLogo domain={brandDomain} name={item.brand} size={96} fallback={categoryEmoji} />
          </div>
        ) : (
          categoryEmoji
        )}
      </div>

      {/* Content. Retired items dim the INFO only — the owner actions
          (Edit/Activate/Delete) keep full contrast, which whole-card
          opacity used to wash out. */}
      <div className="p-4 space-y-3">
        <div className={`space-y-3 ${isActive ? '' : 'opacity-75'}`}>
          {/* Category badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-1 rounded-md text-xs font-semibold ${config.color}`}>
              {config.label}
            </span>
          </div>

          {/* Brand & Model */}
          <div>
            <div className="flex items-center gap-1.5">
              {brandDomain && (
                <BrandLogo domain={brandDomain} name={item.brand} size={16} fallback={null} />
              )}
              <h4 className="text-sm font-semibold text-gray-900 leading-tight">{item.brand}</h4>
            </div>
            <p className="text-lg font-bold text-gray-900 leading-tight mt-0.5">{item.model}</p>
            {ownershipSpan && (
              <p className="text-xs text-gray-500 mt-1">{ownershipSpan}</p>
            )}
          </div>

          {/* Specs */}
          {item.specs && Object.keys(item.specs).length > 0 && (
            <div className="space-y-1">
              {Object.entries(item.specs)
                .filter(([, value]) => value)
                .slice(0, 3) // Show only first 3 specs
                .map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    {/* /_/g, not '_': replace() with a string swaps only the
                        FIRST underscore, so a three-word spec key such as
                        batting_glove_size rendered as "Batting glove_size". */}
                    <span className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}</span>
                    <span className="text-gray-900 font-semibold">{value}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Notes preview */}
          {item.notes && (
            <p className="text-xs text-gray-600 line-clamp-2 italic">&quot;{item.notes}&quot;</p>
          )}
        </div>

        {/* Actions (only for own profile) */}
        {isOwnProfile && (
          <div className="space-y-2 pt-2 border-t border-gray-200">
            {/* Primary actions row */}
            <div className="flex items-center gap-2">
              <button
                onClick={onEdit}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition-colors"
              >
                <Edit2 className="w-3 h-3" />
                Edit
              </button>
              <button
                onClick={() => onToggleStatus(item.id)}
                className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    : 'bg-green-100 hover:bg-green-200 text-green-700'
                }`}
              >
                {isActive ? (
                  <>
                    <Archive className="w-3 h-3" />
                    Retire
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    Activate
                  </>
                )}
              </button>
              <button
                onClick={() => onDelete(item.id)}
                aria-label="Delete equipment"
                className="px-3 py-2 min-h-[40px] min-w-[40px] flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* Replace button (only show for active equipment) */}
            {isActive && (
              <button
                onClick={onReplace}
                className="w-full flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg text-xs font-semibold transition-colors border border-violet-200"
              >
                <RefreshCw className="w-3 h-3" />
                Replace / Upgrade
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
