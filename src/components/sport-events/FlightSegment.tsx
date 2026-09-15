'use client';

/**
 * The flight filter (Events program, phase 2): "All · A · B · C" pills
 * above a board when the field has flights; the selection ranks within
 * the flight (the routes' `?flight=`). Nothing renders without flights.
 * `data-flight` is the e2e hook.
 */
interface Props {
  flights: string[];
  selected: string | null;
  onChange: (next: string | null) => void;
}

export default function FlightSegment({ flights, selected, onChange }: Props) {
  if (flights.length === 0) return null;
  const pill = (key: string | null, text: string) => {
    const on = selected === key;
    return (
      <button
        key={key ?? 'all'}
        type="button"
        aria-pressed={on}
        data-flight={key ?? 'all'}
        onClick={() => onChange(key)}
        className={`shrink-0 min-h-[40px] px-3 rounded-full border text-sm font-semibold transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-surface text-secondary border-border-strong hover:text-primary'}`}
      >
        {text}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Flight" className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 pb-1" data-flight-segment="">
      {pill(null, 'All')}
      {flights.map(f => pill(f, f))}
    </div>
  );
}
