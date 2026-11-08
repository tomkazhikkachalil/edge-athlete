import type { SVGProps } from 'react';
import type { FaIconDef } from '@/lib/icons/fa-icon';
import { FA_SPRITE_URL } from '@/lib/icons/fa-sprite.generated';

/**
 * A Font Awesome glyph (the icons round, Nov 2026) — what `<i className="fas
 * fa-x …">` drew from the webfont, now drawn from ONE sprite (public/icons/
 * fa-<hash>.svg, cached) through <use>; the module names the symbol and its
 * box, no path travels in JavaScript. Sized like the font: 1em high, as wide
 * as the glyph (or 1.25em centred with `fixedWidth`, FA's `fa-fw`), sitting
 * on the text baseline the way the font did (-0.125em). `spin` is `fa-spin`.
 * Decorative by default (`aria-hidden`); pass `title` for a named icon.
 *
 *   <FaIcon icon={faXmark} className="text-xs mr-1" />
 *   <FaIcon icon={faSpinner} spin />
 */
export interface FaIconProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'width' | 'height'> {
  icon: FaIconDef;
  spin?: boolean;
  fixedWidth?: boolean;
  title?: string;
}

export default function FaIcon({ icon, spin = false, fixedWidth = false, title, className = '', style, ...rest }: FaIconProps) {
  const width = fixedWidth ? '1.25em' : `${Math.round((icon.w / icon.h) * 1000) / 1000}em`;
  return (
    <svg
      viewBox={`0 0 ${icon.w} ${icon.h}`}
      fill="currentColor"
      className={`inline-block align-[-0.125em] shrink-0 overflow-visible${spin ? ' animate-spin' : ''}${className ? ` ${className}` : ''}`}
      style={{ width, height: '1em', ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      data-fa={icon.name}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <use href={`${FA_SPRITE_URL}#${icon.id}`} />
    </svg>
  );
}
