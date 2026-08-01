'use client';

import { useState } from 'react';

/**
 * Brand mark for an equipment suggestion, with an initial-letter fallback.
 *
 * Logos come from Logo.dev, the successor Clearbit itself points to after its
 * own Logo API shut down in December 2025. That shutdown is why this
 * component exists in this shape: the previous code chose the logo purely on
 * whether a URL was *present*, so when the host stopped resolving, all 66
 * brand rows rendered as broken images and each open of the picker fired ~30
 * doomed requests.
 *
 * Three rules, in priority order:
 *
 *  1. No token or no domain → letter tile, no request. Matches the repo's
 *     optional-integration convention (`if (SMTP_USER && SMTP_PASS)`):
 *     missing config disables the feature rather than erroring, so local dev
 *     without the token looks exactly like production without it.
 *  2. Load failure → letter tile. If Logo.dev ever goes the way of Clearbit,
 *     the picker degrades to the clean state instead of to broken images.
 *  3. Lazy, small, and deliberately NOT run through next/image. A plain <img>
 *     is what makes rule 2 reliable — the optimizer proxies the fetch, so a
 *     404 upstream surfaces as an error from our own origin rather than a
 *     clean onError, and every miss would burn an optimization request.
 */

const LOGO_TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

interface BrandLogoProps {
  /** Brand's own domain, e.g. 'titleist.com'. Absent → letter tile. */
  domain?: string;
  /** Brand name — supplies the fallback letter and the alt text. */
  name: string;
  /** Rendered edge length in px. */
  size?: number;
}

export default function BrandLogo({ domain, name, size = 24 }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

  const box = { width: size, height: size };
  const useLogo = Boolean(LOGO_TOKEN && domain) && !failed;

  if (!useLogo) {
    return (
      <div
        style={box}
        className="flex-shrink-0 bg-gray-200 rounded flex items-center justify-center text-xs font-bold text-gray-600"
        aria-hidden="true"
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }

  // A plain <img> is deliberate — see rule 3 above. next/image would proxy the
  // fetch, so an upstream 404 surfaces as an error from our own origin instead
  // of the clean onError this component's fallback depends on.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=${size * 2}&format=png&retina=true`}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      style={box}
      className="flex-shrink-0 object-contain"
      onError={() => setFailed(true)}
    />
  );
}
