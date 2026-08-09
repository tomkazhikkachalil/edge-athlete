import Link from 'next/link';
import BrandBar from '@/components/BrandBar';

export const metadata = { title: 'Privacy Policy — Edge Athlete' };

// Plain-language MVP privacy policy describing what the app ACTUALLY does.
// Reviewed content should replace this before any large-scale launch — this
// is a general template, not legal advice.
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <BrandBar />

      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6 sm:p-10">
          <h1 className="text-3xl font-bold text-primary mb-2">Privacy Policy</h1>
          <p className="text-sm text-muted mb-8">Last updated: July 2026</p>

          <div className="space-y-6 text-secondary text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">What we collect</h2>
              <p className="mb-2">
                <span className="font-medium">Account information</span>: name, email, handle,
                password (stored hashed by our authentication provider), and optional profile
                details you add — photo, bio, birthday, location, physical stats, social links.
              </p>
              <p className="mb-2">
                <span className="font-medium">Content you create</span>: posts, photos and videos,
                activities and stats, comments, likes, messages, and who you follow.
              </p>
              <p>
                <span className="font-medium">Technical basics</span>: standard logs needed to run
                the service. We do not run third-party advertising or tracking pixels.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">How it&apos;s used</h2>
              <p>
                To run Edge Athlete: showing your profile and posts to the audiences you choose,
                computing your stats and trends, delivering notifications and messages, and keeping
                the platform safe. We don&apos;t sell your personal information.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Who can see what</h2>
              <p>
                You control profile visibility (public or private) in Settings → Privacy. Private
                profiles are visible only to fans you approve. Messages are visible only to their
                participants. Contact details (email, phone) are never shown to other users.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Where data lives</h2>
              <p>
                Your data is stored with Supabase (database, authentication, and file storage) and
                the application is hosted on Vercel. Both process data on our behalf under their
                own security practices.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Your controls</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>Edit or remove any profile field, post, activity, or comment at any time</li>
                <li>Switch your profile between public and private</li>
                <li>Turn notification types off in Settings → Notifications</li>
                <li>Block users from contacting you</li>
                <li>
                  Delete your account (Settings → Account) — this permanently removes your profile,
                  posts, media, activities, messages, and notifications
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Questions or requests</h2>
              <p>
                For privacy questions or data requests,{' '}
                <Link href="/contact" className="text-brand-fg hover:text-brand-fg-strong">contact us</Link>{' '}
                and we&apos;ll respond by email.
              </p>
            </section>
          </div>

          <div className="mt-8 pt-4 border-t border-border flex flex-wrap gap-x-4 text-sm">
            <Link href="/terms" className="inline-flex min-h-[44px] items-center text-brand-fg hover:text-brand-fg-strong active:text-brand-fg-strong font-medium">Terms of Service</Link>
            <Link href="/contact" className="inline-flex min-h-[44px] items-center text-brand-fg hover:text-brand-fg-strong active:text-brand-fg-strong font-medium">Contact</Link>
            <Link href="/" className="inline-flex min-h-[44px] items-center text-brand-fg hover:text-brand-fg-strong active:text-brand-fg-strong font-medium">← Back to Edge Athlete</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
