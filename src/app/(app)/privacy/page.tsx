import Link from 'next/link';
import BrandBar from '@/components/BrandBar';
import { LEGAL_LAST_UPDATED } from '@/lib/legal';

export const metadata = { title: 'Privacy Policy — Edge Athlete' };

// Plain-language privacy policy describing what the app ACTUALLY does
// (Nov 2 2026 — caught up with everything built since July: Google sign-in,
// Sentry, the weather at the course, the golf course data providers, GIFs
// and brand logos, web push, cookies, the coming-soon list, children and
// guardians, the data export, support tickets). Tom reads every change
// before it ships; this is a general template, not legal advice.

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <BrandBar />

      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6 sm:p-10">
          <h1 className="text-3xl font-bold text-primary mb-2">Privacy Policy</h1>
          <p className="text-sm text-muted mb-8">Last updated: {LEGAL_LAST_UPDATED}</p>

          <div className="space-y-6 text-secondary text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">What we collect</h2>
              <p className="mb-2">
                <span className="font-medium">Account information</span>: name, email, handle,
                password (stored hashed by our authentication provider), and optional profile
                details you add — photo, bio, birthday, location, physical stats, social links.
                If you sign in with Google we receive your name, email address and profile
                picture from Google; we never see your Google password.
              </p>
              <p className="mb-2">
                <span className="font-medium">Content you create</span>: posts, photos and videos,
                activities, workouts and stats, rounds and scores, comments, likes, messages, and
                who you follow. Photos and videos have their location metadata removed before
                they are stored.
              </p>
              <p className="mb-2">
                <span className="font-medium">Notifications</span>: if you turn on push
                notifications, your browser gives us a delivery address for that device. We keep
                it only while notifications are on; turning them off in Settings removes it.
              </p>
              <p className="mb-2">
                <span className="font-medium">Support and safety</span>: reports you send about a
                post, a comment, a message or a person, and support requests, are kept as tickets
                so a member of our team can act on them and reply to you.
              </p>
              <p className="mb-2">
                <span className="font-medium">Before we opened</span>: if you left your name and
                email on our coming-soon page, we keep them to send the opening announcement, and
                further news only if you ticked the box. Every message has an unsubscribe link.
              </p>
              <p>
                <span className="font-medium">Technical basics</span>: standard logs needed to run
                the service, and error reports (see &quot;Who helps us run it&quot;). We do not
                run third-party advertising or tracking pixels.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">How it&apos;s used</h2>
              <p>
                To run Edge Athlete: showing your profile and posts to the audiences you choose,
                computing your stats and trends, delivering notifications and messages, answering
                your support requests, and keeping the platform safe. We don&apos;t sell your
                personal information, and we don&apos;t use it for advertising.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Who can see what</h2>
              <p className="mb-2">
                You control profile visibility (public or private) in Settings → Privacy. Private
                profiles are visible only to fans you approve. Messages are visible only to their
                participants. Contact details (email, phone) are never shown to other users.
              </p>
              <p>
                Results you record with other people — a club or league competition, an event, a
                round played with others — are part of those shared records, the way a printed
                results sheet is, and stay there under your name even after you leave.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Where data lives, and who helps us run it</h2>
              <p className="mb-2">
                Your data is stored with <span className="font-medium">Supabase</span> (database,
                authentication, and file storage) and the application is hosted on{' '}
                <span className="font-medium">Vercel</span>. Both process data on our behalf under
                their own security practices.
              </p>
              <p className="mb-2">
                A few other services receive only what is needed for one feature, never your
                account as a whole:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-medium">Google</span> — sign-in, if you choose it; and,
                  if you connect a YouTube channel, the channel&apos;s name, its list of uploads and
                  the uploads you send to it through Edge Athlete (the video goes from your device to
                  YouTube — we never download, store or edit it). The connection is yours to remove
                  at any time from the Videos tab; you can also revoke it in your Google account
                  settings. YouTube&apos;s own terms and Google&apos;s privacy policy apply to the
                  channel.
                </li>
                <li>
                  <span className="font-medium">Sentry</span> — error reports when something
                  breaks, so we can fix it: the error, the page, and a performance sample of about
                  one request in ten. No names, emails or message content are included.
                </li>
                <li>
                  <span className="font-medium">Open-Meteo</span> — the weather for a live golf
                  round: the course&apos;s coordinates are sent, nothing about you.
                </li>
                <li>
                  <span className="font-medium">Golf course data providers</span> — when you pick a
                  course, we look up its name, holes and scorecard. The course is sent, not you.
                </li>
                <li>
                  <span className="font-medium">GIPHY</span> — if you search for a GIF, the search
                  words go to GIPHY.
                </li>
                <li>
                  <span className="font-medium">Logo.dev</span> — brand logos in the equipment
                  picker: the brand name is sent, not you.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Cookies</h2>
              <p>
                Edge Athlete sets only its own cookies: one that keeps you signed in, one that
                remembers your theme, and one for the admin console if you are on our team. There
                are no advertising or analytics cookies and no cookie banner, because there is
                nothing to opt out of. Org websites we host count page views with a daily
                anonymous mark that cannot be linked to you from one day to the next.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Children and guardians</h2>
              <p>
                An athlete under the age where they can consent for themselves (13 in Canada and
                the United States, 14 in Quebec, 13 to 16 in Europe depending on the country, 16
                where we are unsure) cannot open an account alone. Their sign-up is parked with
                nothing but the details needed to reach a parent or guardian, who creates the
                profile, keeps it private by default, decides what is posted and can withdraw
                consent at any time. The consent record is kept as evidence even after the
                profile is deleted, as the law requires.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Your controls</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>Edit or remove any profile field, post, activity, or comment at any time</li>
                <li>Switch your profile between public and private</li>
                <li>Turn notification types, and push notifications, off in Settings → Notifications</li>
                <li>Block or mute people, and report anything that should not be here</li>
                <li>
                  <span className="font-medium">Download your data</span> (Settings → Account) — one
                  file with your profile and everything you have added: posts, comments, rounds,
                  workouts, activities, body metrics, messages you sent, and your settings
                </li>
                <li>
                  Delete your account (Settings → Account) — after a 30-day window in which you can
                  restore it, this permanently removes your profile, login, posts, media, activities,
                  messages, and notifications. Results you recorded with other people — a club or
                  league competition, an event, a round played with others — stay part of those
                  records under your name, so other players&apos; results never change
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-primary mb-2">Questions or requests</h2>
              <p>
                For privacy questions or data requests,{' '}
                <Link href="/contact" className="text-brand-fg hover:text-brand-fg-strong">contact us</Link>{' '}
                and we&apos;ll respond by email. Edge Athlete is run from Canada.
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
