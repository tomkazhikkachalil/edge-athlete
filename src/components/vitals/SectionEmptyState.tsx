'use client';

import type { LucideIcon } from 'lucide-react';

/**
 * The ONE empty-state design for dashboard sections (replaces three
 * near-identical dashed variants). Hero tiles never use this — zeros render
 * honestly there.
 */

interface SectionEmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void };
}

export default function SectionEmptyState({ icon: Icon, title, body, cta }: SectionEmptyStateProps) {
  return (
    <div className="text-center py-10 px-4 border border-dashed border-gray-200 rounded-lg">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
        <Icon className="w-6 h-6 text-gray-400" />
      </div>
      <h4 className="text-sm font-bold text-gray-900 mb-1">{title}</h4>
      <p className="text-xs text-gray-500 max-w-sm mx-auto">{body}</p>
      {cta && (
        <button
          onClick={cta.onClick}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg font-semibold text-sm hover:bg-violet-700 transition-colors"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}
