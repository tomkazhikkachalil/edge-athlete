import type { PublicSite } from '@/lib/org-sites/server';
import type { WidgetInstance } from '@/lib/site-builder/layout';
import { AGE_GROUPS, HONEYPOT_FIELD, formKindOf, signFormToken } from '@/lib/org-sites/forms';
import type { FormWidgetKey } from '@/lib/site-builder/catalog';

// ── A site form — program 2, D (Sep 11 2026) ──────────────────────────────
// Server-safe and script-free (the (public) contract): a native <form> that
// POSTs to the site's form route; the route answers a 303 back to this page
// at #sent-<id> or #error-<id>, and the :target rules in globals.css show
// the matching line. The form key ties the POST to this widget; the honeypot
// catches bots; the route's buckets do the rest.

const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary';
const LABEL = 'block text-xs font-medium text-secondary mb-1';

export default function SiteFormWidget({ site, w }: { site: PublicSite; w: WidgetInstance }) {
  const key = w.key as FormWidgetKey;
  const kind = formKindOf(key);
  const config = (w.config ?? {}) as Record<string, unknown>;
  const intro = typeof config.intro === 'string' && config.intro.trim() ? config.intro.trim() : null;
  const thanks = typeof config.thanks === 'string' && config.thanks.trim() ? config.thanks.trim() : 'Thanks — we’ll be in touch.';
  const token = signFormToken(site.id, w.id);
  const id = (field: string) => `sf-${w.id}-${field}`;
  return (
    <div id={`form-${w.id}`} data-site-form={kind}>
      {intro && <p className="mb-3 text-sm text-secondary">{intro}</p>}
      <p id={`sent-${w.id}`} className="sb-form-sent mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
        {thanks}
      </p>
      <p id={`error-${w.id}`} className="sb-form-error mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
        That didn’t go through — check the fields and try again in a moment.
      </p>
      <form method="post" action={`/api/public/site-forms/${site.id}/${w.id}`} className="space-y-3">
        {token && <input type="hidden" name="t" value={token} />}
        <div className="sb-hp" aria-hidden="true">
          <label htmlFor={id(HONEYPOT_FIELD)}>Website</label>
          <input id={id(HONEYPOT_FIELD)} type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </div>
        <div>
          <label className={LABEL} htmlFor={id('name')}>
            Your name
          </label>
          <input id={id('name')} name="name" type="text" required maxLength={80} autoComplete="name" className={INPUT} />
        </div>
        <div>
          <label className={LABEL} htmlFor={id('email')}>
            Email
          </label>
          <input id={id('email')} name="email" type="email" required maxLength={200} autoComplete="email" className={INPUT} />
        </div>
        {kind === 'interest' && (
          <>
            <div>
              <label className={LABEL} htmlFor={id('phone')}>
                Phone (optional)
              </label>
              <input id={id('phone')} name="phone" type="tel" maxLength={40} autoComplete="tel" className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor={id('ageGroup')}>
                Age group
              </label>
              <select id={id('ageGroup')} name="ageGroup" required className={INPUT} defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {AGE_GROUPS.map(g => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div>
          <label className={LABEL} htmlFor={id('message')}>
            {kind === 'contact' ? 'Message' : 'Anything we should know? (optional)'}
          </label>
          <textarea id={id('message')} name="message" rows={4} required={kind === 'contact'} maxLength={2000} className={INPUT} />
        </div>
        <button type="submit" className="min-h-[44px] rounded-md px-4 text-sm font-semibold text-white" style={{ backgroundImage: 'linear-gradient(to right, var(--org-accent), var(--org-accent-strong))' }}>
          {kind === 'contact' ? 'Send message' : 'Register interest'}
        </button>
      </form>
    </div>
  );
}
