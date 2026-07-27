import Link from 'next/link';
import BrandBar from '@/components/BrandBar';

export const metadata = { title: 'Terms of Service — Edge Athlete' };

// Plain-language MVP terms. Reviewed content should replace this before any
// large-scale launch — this is a general template, not legal advice.
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <BrandBar />

      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-10 prose-sm">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
          <p className="text-sm text-gray-500 mb-8">Last updated: July 2026</p>

          <div className="space-y-6 text-gray-700 text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">1. What Edge Athlete is</h2>
              <p>
                Edge Athlete is a social platform for athletes to share performance data, posts,
                and connect with other athletes. By creating an account you agree to these terms.
                If you are under the age of majority where you live, you need a parent or
                guardian&apos;s permission to use the platform.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">2. Your account</h2>
              <p>
                You are responsible for your account and for keeping your password secure. Provide
                accurate information, don&apos;t impersonate others, and don&apos;t create accounts
                for anyone but yourself. You can delete your account at any time from Settings —
                deletion removes your profile, posts, activities, messages, and related data.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">3. Your content</h2>
              <p>
                You own what you post — scores, photos, videos, comments, and messages. By posting,
                you grant Edge Athlete a license to store, display, and distribute that content on
                the platform so the service can function (showing your posts to your fans, for
                example). Public content is visible to other users; private profiles limit
                visibility to approved fans.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">4. Acceptable use</h2>
              <p>
                Don&apos;t use Edge Athlete to harass, threaten, or abuse others; post unlawful,
                hateful, or sexually explicit content; spam or scrape the platform; attempt to
                access other users&apos; accounts or data; or misrepresent your athletic results.
                We may remove content or suspend accounts that violate these rules.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">5. Performance data</h2>
              <p>
                Stats, scores, and computed values (including performance estimates) are provided for
                personal tracking and social sharing. They are not official records, and Edge
                Athlete makes no guarantee of their accuracy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">6. The service</h2>
              <p>
                Edge Athlete is provided &quot;as is,&quot; without warranties of any kind. We may
                change, suspend, or discontinue features at any time. To the maximum extent
                permitted by law, Edge Athlete is not liable for indirect or consequential damages
                arising from your use of the platform.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">7. Changes to these terms</h2>
              <p>
                We may update these terms as the platform evolves. Material changes will be
                announced in-app. Continuing to use Edge Athlete after changes take effect means
                you accept the updated terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">8. Contact</h2>
              <p>
                Questions about these terms? <Link href="/contact" className="text-violet-600 hover:text-violet-700">Contact us</Link>.
              </p>
            </section>
          </div>

          <div className="mt-10 pt-6 border-t border-gray-200 flex flex-wrap gap-4 text-sm">
            <Link href="/privacy" className="text-violet-600 hover:text-violet-700 font-medium">Privacy Policy</Link>
            <Link href="/contact" className="text-violet-600 hover:text-violet-700 font-medium">Contact</Link>
            <Link href="/" className="text-violet-600 hover:text-violet-700 font-medium">← Back to Edge Athlete</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
