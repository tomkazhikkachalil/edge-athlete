'use client';

// Full-width labeled radio card (Wave 4: extracted from the guardian athlete
// page's Safety section so the household-settings page shares the exact
// control). Options come from profile-privacy.ts's PrivacyOption arrays.

export default function RadioCard<V extends string>({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: { value: V; label: string; description: string };
  selected: boolean;
  disabled: boolean;
  onSelect: (value: V) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option.value)}
      disabled={disabled}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all disabled:opacity-60 ${
        selected ? 'border-brand bg-brand-soft' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
            selected ? 'border-brand bg-brand' : 'border-border-strong'
          }`}
        >
          {selected && <i className="fas fa-check text-white text-xs"></i>}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-primary text-sm mb-0.5">{option.label}</h4>
          <p className="text-xs text-tertiary">{option.description}</p>
        </div>
      </div>
    </button>
  );
}
