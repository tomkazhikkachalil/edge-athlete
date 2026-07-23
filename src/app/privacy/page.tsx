import Link from 'next/link';

export const metadata = { title: 'Privacy Policy — Edge Athlete' };

// Plain-language MVP privacy policy describing what the app ACTUALLY does.
// Reviewed content should replace this before any large-scale launch — this
// is a general template, not legal advice.
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full bg-blue-600 py-3 px-4">
        <h1 className="text-2xl font-bold text-white text-center">Edge Athlete</h1>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-500 mb-8">Last updated: July 2026</p>

          <div className="space-y-6 text-gray-700 text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">What we collect</h2>
              <p className="mb-2">
                <span className="font-medium">Account information</span>: name, email, handle,
                password (stored hashed by our authentication provider), and optional profile
                details you add — photo, bio, birthday, location, physical stats, social links.
              </p>
              <p className="mb-2">
                <span className="font-medium">Content you create</span>: posts, photos and videos,
                golf rounds and scores, comments, likes, messages, and who you follow.
              </p>
              <p>
                <span className="font-medium">Technical basics</span>: standard logs needed to run
                the service. We do not run third-party advertising or tracking pixels.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">How it&apos;s used</h2>
              <p>
                To run Edge Athlete: showing your profile and posts to the audiences you choose,
                computing your stats and trends, delivering notifications and messages, and keeping
                the platform safe. We don&apos;t sell your personal information.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Who can see what</h2>
              <p>
                You control profile visibility (public or private) in Settings → Privacy. Private
                profiles are visible only to fans you approve. Messages are visible only to their
                participants. Contact details (email, phone) are never shown to other users.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Where data lives</h2>
              <p>
                Your data is stored with Supabase (database, authentication, and file storage) and
                the application is hosted on Vercel. Both process data on our behalf under their
                own security practices.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Your controls</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>Edit or remove any profile field, post, round, or comment at any time</li>
                <li>Switch your profile between public and private</li>
                <li>Turn notification types off in Settings → Notifications</li>
                <li>Block users from contacting you</li>
                <li>
                  Delete your account (Settings → Account) — this permanently removes your profile,
                  posts, media, rounds, messages, and notifications
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Questions or requests</h2>
              <p>
                For privacy questions or data requests,{' '}
                <Link href="/contact" className="text-blue-600 hover:text-blue-700">contact us</Link>{' '}
                and we&apos;ll respond by email.
              </p>
            </section>
          </div>

          <div className="mt-10 pt-6 border-t border-gray-200 flex flex-wrap gap-4 text-sm">
            <Link href="/terms" className="text-blue-600 hover:text-blue-700 font-medium">Terms of Service</Link>
            <Link href="/contact" className="text-blue-600 hover:text-blue-700 font-medium">Contact</Link>
            <Link href="/" className="text-blue-600 hover:text-blue-700 font-medium">← Back to Edge Athlete</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
