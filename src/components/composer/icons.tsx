// Line icons of the General post composer (stroke 1.8, round caps), drawn
// inline in the same hand as the scoring card's (golf/scoring/icons.tsx), so
// they take any size and colour from their parent.
const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 18, className, children, weight }: IconProps & { children: React.ReactNode; weight?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className={className} {...LINE} {...(weight ? { strokeWidth: weight } : {})}>
      {children}
    </svg>
  );
}

export const EyeIcon = (p: IconProps) => <Svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></Svg>;
export const UploadIcon = (p: IconProps) => <Svg {...p}><path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" /><path d="M4.5 15.5v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5" /></Svg>;
export const PeopleIcon = (p: IconProps) => <Svg {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.4-3.2 2.8-5 6-5s5.6 1.8 6 5" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c2 .6 3.2 2.2 3.5 4.7" /></Svg>;
export const GaugeIcon = (p: IconProps) => <Svg {...p}><path d="M4.2 17.5a9 9 0 1 1 15.6 0" /><path d="M12 13.5 15.8 8.5" /><circle cx="12" cy="13.8" r="1.3" fill="currentColor" stroke="none" /></Svg>;
export const PinIcon = (p: IconProps) => <Svg {...p}><path d="M12 21s6.5-5.7 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.3 6.5 11 6.5 11Z" /><circle cx="12" cy="10" r="2.4" /></Svg>;
export const SparkIcon = (p: IconProps) => <Svg {...p}><path d="M12 3.5 13.9 10.1 20.5 12 13.9 13.9 12 20.5 10.1 13.9 3.5 12 10.1 10.1 12 3.5Z" /></Svg>;
export const RetryIcon = (p: IconProps) => <Svg {...p} weight={2.2}><path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" /><path d="M19.5 4.5v4.2h-4.2" /></Svg>;
export const PlayMark = (p: IconProps) => <Svg {...p}><path d="M8 5.5v13l11-6.5L8 5.5Z" fill="currentColor" /></Svg>;
export const CropIcon = (p: IconProps) => <Svg {...p}><path d="M7 2.5V17h14.5" /><path d="M2.5 7H17v14.5" /></Svg>;
export const AdjustIcon = (p: IconProps) => <Svg {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Svg>;
export const FilterIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="8.5" r="5" /><circle cx="8.5" cy="14.5" r="5" /><circle cx="15.5" cy="14.5" r="5" /></Svg>;
export const CoverIcon = (p: IconProps) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M12 8.3 13.1 10.8 15.8 11.1 13.8 12.9 14.4 15.6 12 14.2 9.6 15.6 10.2 12.9 8.2 11.1 10.9 10.8 12 8.3Z" /></Svg>;
export const DiscIcon = (p: IconProps) => <Svg {...p}><path d="M6 4.5h9.5L19.5 8.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Z" /><path d="M8 4.5v4.5h6V4.5M8 19.5v-5.5h8v5.5" /></Svg>;
