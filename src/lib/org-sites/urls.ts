/**
 * Absolute-URL base for org-site SEO surfaces (phase 3 R4) — the repo's
 * first absolute-URL helper. Everything derives from NEXT_PUBLIC_APP_URL
 * so the canonical-domain question (vercel.app today, a real apex later)
 * is an env/ops decision, never a code change. No trailing slash.
 */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app').replace(
    /\/$/,
    ''
  );
}
