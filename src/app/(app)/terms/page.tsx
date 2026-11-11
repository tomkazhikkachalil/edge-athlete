import Link from 'next/link';
import BrandBar from '@/components/BrandBar';
import { LogoDevCredits } from '@/components/LogoDevAttribution';
import { LEGAL_LAST_UPDATED } from '@/lib/legal';

export const metadata = { title: 'Terms of Service — Edge Athlete' };

// Plain-language terms (Nov 2 2026 — caught up: the guardian flow, results
// that outlive the person, who hosts the service). Tom reads every change
// before it ships; this is a general template, not legal advice.

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <BrandBar />

      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6 sm:p-10 prose-sm">
          <h1 className="text-3xl font-bold text-primary mb-2">Terms of Service</h1>
          <p className="text-sm text-muted mb-8">Last updated: {LEGAL_LAST_UPDATED}</p>

          <div className="space-y-6 text-secondary text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">1. What Edge Athlete is</h2>
              <p>
                Edge Athlete is a social platform for athletes, their clubs and leagues to record
                results, share posts and connect. By creating an account you agree to these terms.
                An athlete under the age of digital consent where they live (13 in Canada and the
                United States, 14 in Quebec, up to 16 in Europe) cannot open an account alone: a
                parent or guardian creates and manages the profile, and can withdraw consent at
                any time. Anyone under the age of majority needs a parent or guardian&apos;s
                permission to use the platform.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">2. Your account</h2>
              <p>
                You are responsible for your account and for keeping your password secure. Provide
                accurate information, don&apos;t impersonate others, and don&apos;t create accounts
                for anyone but yourself (a guardian manages an athlete&apos;s profile through the
                guardian tools, never by sharing a login). You can download a copy of your data
                and delete your account at any time from Settings → Account — after a 30-day
                window, deletion removes your profile, posts, activities, messages, and related
                data. Results you recorded as part of a club, league, event or round with other
                people remain part of those shared records under your name, the way a printed
                results sheet would, so nobody else&apos;s results change because you left.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">3. Your content</h2>
              <p>
                You own what you post — scores, photos, videos, comments, and messages. By posting,
                you grant Edge Athlete a license to store, display, and distribute that content on
                the platform so the service can function (showing your posts to your fans, for
                example). Public content is visible to other users; private profiles limit
                visibility to approved fans.
              </p>
              <p className="mt-2">
                A full game or broadcast you link is a YouTube video: it stays on YouTube, under{' '}
                <a href="https://www.youtube.com/t/terms" className="text-brand-fg hover:text-brand-fg-strong underline" target="_blank" rel="noopener noreferrer">YouTube&apos;s Terms of Service</a> and{' '}
                <a href="https://policies.google.com/privacy" className="text-brand-fg hover:text-brand-fg-strong underline" target="_blank" rel="noopener noreferrer">Google&apos;s Privacy Policy</a>, and Edge Athlete
                shows it through YouTube&apos;s player. By connecting a YouTube channel, or watching a
                video embedded here, you also agree to YouTube&apos;s Terms of Service. If you connect a
                channel and upload through Edge Athlete, the upload goes from your device to YouTube and
                the video is yours there; we keep only the link.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">4. Acceptable use</h2>
              <p>
                Don&apos;t use Edge Athlete to harass, threaten, or abuse others; post unlawful,
                hateful, or sexually explicit content; spam or scrape the platform; attempt to
                access other users&apos; accounts or data; or misrepresent your athletic results.
                We may remove content or suspend accounts that violate these rules.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">5. Performance data</h2>
              <p>
                Stats, scores, and computed values (including performance estimates) are provided for
                personal tracking and social sharing. They are not official records, and Edge
                Athlete makes no guarantee of their accuracy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">6. The service</h2>
              <p>
                Edge Athlete is provided &quot;as is,&quot; without warranties of any kind. The
                service runs on Vercel and Supabase, with a few other providers for single
                features, as the <Link href="/privacy" className="text-brand-fg hover:text-brand-fg-strong">Privacy Policy</Link>{' '}
                lists. We may change, suspend, or discontinue features at any time. To the maximum
                extent permitted by law, Edge Athlete is not liable for indirect or consequential
                damages arising from your use of the platform.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">7. Changes to these terms</h2>
              <p>
                We may update these terms as the platform evolves. Material changes will be
                announced in-app. Continuing to use Edge Athlete after changes take effect means
                you accept the updated terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">8. Contact</h2>
              <p>
                Questions about these terms? <Link href="/contact" className="text-brand-fg hover:text-brand-fg-strong">Contact us</Link>.
              </p>
            </section>
          </div>

          {/* Third-party credits. This page is a SERVER component and is
              statically prerendered, so the Logo.dev link is present in the
              HTML without JavaScript — the login-page footer carries the same
              credit but only after hydration, which a verifier that does not
              run JS would never see. Renders nothing without a token. */}
          <LogoDevCredits />

          <div className="mt-8 pt-4 border-t border-border flex flex-wrap gap-x-4 text-sm">
            <Link href="/privacy" className="inline-flex min-h-[44px] items-center text-brand-fg hover:text-brand-fg-strong active:text-brand-fg-strong font-medium">Privacy Policy</Link>
            <Link href="/contact" className="inline-flex min-h-[44px] items-center text-brand-fg hover:text-brand-fg-strong active:text-brand-fg-strong font-medium">Contact</Link>
            <Link href="/" className="inline-flex min-h-[44px] items-center text-brand-fg hover:text-brand-fg-strong active:text-brand-fg-strong font-medium">← Back to Edge Athlete</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
