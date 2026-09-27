import Image from 'next/image';
import { teamInitials } from '@/lib/teams/initials';

// A team's crest (sports-team website program, L2, Sep 27 2026): its own
// logo through the tokenless team-logo streamer, else its initials in the
// team's colour (the site accent when it has none). Server-safe; the colours
// arrive re-validated (PublicTeam via teamLook), so the inline style only
// ever carries a #rrggbb value.

const HEX = /^#[0-9a-f]{6}$/i;

export default function TeamCrest({
  name,
  logoUrl,
  color,
  ink,
  size,
}: {
  name: string;
  logoUrl?: string | null;
  color?: string | null;
  ink?: string | null;
  size: number;
}) {
  if (logoUrl) {
    // /api/media/* is never optimizer-eligible — unoptimized is mandatory.
    return <Image src={logoUrl} alt="" width={size} height={size} unoptimized className="shrink-0 rounded-full object-contain bg-surface" />;
  }
  const ring = color && HEX.test(color) ? color : 'var(--org-accent)';
  const text = ink && HEX.test(ink) ? ink : 'var(--brand-fg)';
  return (
    <span
      aria-hidden="true"
      className="shrink-0 inline-flex items-center justify-center rounded-full bg-surface font-bold"
      style={{ width: size, height: size, border: `${Math.max(2, Math.round(size / 16))}px solid ${ring}`, color: text, fontSize: Math.round(size * 0.38) }}
    >
      {teamInitials(name)}
    </span>
  );
}
