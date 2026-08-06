import { LOGO_DEV_ENABLED } from '@/lib/logo-dev';

/**
 * Required credit for Logo.dev's free plan.
 *
 * Edge Athlete is commercial by their definition ("startups, including
 * pre-launch and pre-revenue"), so the free plan requires a visible link back.
 * Their verification has three conditions, and two of them constrain how this
 * is written:
 *
 *  1. It must be on the PRODUCTION site — not staging or localhost.
 *  2. It must be publicly accessible and viewable in a browser. The equipment
 *     picker is behind login, so this also renders in the public footer on
 *     `/`; their docs name exactly that case ("on about pages — for apps
 *     behind authentication").
 *  3. It must PASS REFERRER DATA. So `rel` must NOT contain `noreferrer` —
 *     the usual `rel="noopener noreferrer"` reflex would silently fail
 *     verification. `noopener` alone is kept: it closes the reverse-tabnabbing
 *     hole without stripping the referrer.
 *
 * Renders nothing when no token is configured — crediting a service we are not
 * using would be worse than not crediting it.
 *
 * Wording is Logo.dev's own required string; don't paraphrase it.
 */
export default function LogoDevAttribution({ className = '' }: { className?: string }) {
  if (!LOGO_DEV_ENABLED) return null;

  return (
    <a
      href="https://logo.dev"
      target="_blank"
      rel="noopener"
      className={`hover:text-secondary ${className}`}
    >
      Logos provided by Logo.dev
    </a>
  );
}

/**
 * The same credit as a standalone block for the Terms page.
 *
 * Terms is a server component and statically prerendered, so this lands in the
 * HTML with no JavaScript. The login-page footer carries the credit too, but
 * that page is client-rendered — a verifier that does not execute JS would see
 * nothing there.
 */
export function LogoDevCredits() {
  if (!LOGO_DEV_ENABLED) return null;

  return (
    <div className="mt-10 pt-6 border-t border-border">
      <h2 className="text-lg font-semibold text-primary mb-2">Credits</h2>
      <p className="text-sm text-tertiary">
        Brand logos in the equipment picker are provided by Logo.dev.{' '}
        <LogoDevAttribution className="text-brand-fg hover:text-brand-fg-strong font-medium" />
      </p>
    </div>
  );
}
