// Line icons of the scoring card and the map keys (stroke 1.8, round caps),
// drawn inline so they take any size and colour from their parent.
const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 20, className, children, weight }: IconProps & { children: React.ReactNode; weight?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className={className} {...LINE} {...(weight ? { strokeWidth: weight } : {})}>
      {children}
    </svg>
  );
}

export const PlusIcon = (p: IconProps) => <Svg {...p} weight={2.2}><path d="M12 5v14M5 12h14" /></Svg>;
export const MinusIcon = (p: IconProps) => <Svg {...p} weight={2.2}><path d="M5 12h14" /></Svg>;
export const CloseIcon = (p: IconProps) => <Svg {...p} weight={2}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const CheckIcon = (p: IconProps) => <Svg {...p} weight={3}><path d="M5 12.5 10 17.5 19 7" /></Svg>;
export const ChevronLeftIcon = (p: IconProps) => <Svg {...p} weight={2.2}><path d="M15 5 8 12l7 7" /></Svg>;
export const ChevronRightIcon = (p: IconProps) => <Svg {...p} weight={2.2}><path d="M9 5l7 7-7 7" /></Svg>;
export const ChevronDownIcon = (p: IconProps) => <Svg {...p} weight={2.2}><path d="M5 9l7 7 7-7" /></Svg>;
export const UpDownIcon = (p: IconProps) => <Svg {...p}><path d="M7 9.5 12 4.5l5 5M7 14.5l5 5 5-5" /></Svg>;
export const WarningIcon = (p: IconProps) => <Svg {...p}><path d="M12 3.5 2.6 19.5h18.8L12 3.5Z" /><path d="M12 10v4.5M12 17.2v.1" /></Svg>;
export const CameraIcon = (p: IconProps) => <Svg {...p}><path d="M3.5 8.5a2 2 0 0 1 2-2h2l1.4-2h6.2l1.4 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z" /><circle cx="12" cy="13" r="3.4" /></Svg>;
export const VideoIcon = (p: IconProps) => <Svg {...p}><rect x="3" y="6.5" width="12.5" height="11" rx="2.2" /><path d="M15.5 10.5 21 7.5v9l-5.5-3" /></Svg>;
export const PencilIcon = (p: IconProps) => <Svg {...p}><path d="M4 20l1-4.2L16.4 4.4a1.6 1.6 0 0 1 2.3 0l.9.9a1.6 1.6 0 0 1 0 2.3L8.2 19 4 20Z" /><path d="M14.5 6.3 17.7 9.5" /></Svg>;
export const InfoIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.1" /></Svg>;
export const SkipStartIcon = (p: IconProps) => <Svg {...p}><path d="M6 5v14" /><path d="M19 5.5 9 12l10 6.5v-13Z" /></Svg>;
export const LayersIcon = (p: IconProps) => <Svg {...p}><path d="M12 3.5 3 8.5l9 5 9-5-9-5Z" /><path d="M3 13l9 5 9-5" /></Svg>;
export const LocateIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></Svg>;
export const FollowIcon = (p: IconProps) => <Svg {...p}><path d="M12 3.5 19 20l-7-3.6L5 20l7-16.5Z" /></Svg>;
export const TargetIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></Svg>;
export const RecenterIcon = (p: IconProps) => <Svg {...p}><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></Svg>;
