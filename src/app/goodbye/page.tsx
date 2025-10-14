'use client';

import { useEffect } from 'react';

export default function GoodbyePage() {
  useEffect(() => {
    // Clear any remaining localStorage data
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 sm:p-12 text-center">
          {/* Icon */}
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <i className="fas fa-wave-pulse text-blue-600 text-3xl"></i>
          </div>

          {/* Heading */}
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Your account has been deleted
          </h1>

          {/* Message */}
          <p className="text-lg text-gray-600 mb-8 max-w-xl mx-auto">
            We're sorry to see you go. All your data has been permanently removed from Edge Athlete.
          </p>

          {/* Divider */}
          <div className="border-t border-gray-200 my-8"></div>

          {/* What Happened Section */}
          <div className="text-left bg-gray-50 rounded-lg p-6 mb-8">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <i className="fas fa-check-circle text-green-600"></i>
              What we deleted:
            </h2>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <i className="fas fa-circle text-xs text-gray-400 mt-1.5"></i>
                <span>Your profile and personal information</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fas fa-circle text-xs text-gray-400 mt-1.5"></i>
                <span>All posts, photos, videos, and media content</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fas fa-circle text-xs text-gray-400 mt-1.5"></i>
                <span>Comments, likes, and social interactions</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fas fa-circle text-xs text-gray-400 mt-1.5"></i>
                <span>Followers, following, and connection data</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fas fa-circle text-xs text-gray-400 mt-1.5"></i>
                <span>Performance stats, achievements, and sport data</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fas fa-circle text-xs text-gray-400 mt-1.5"></i>
                <span>Notifications and activity history</span>
              </li>
            </ul>
          </div>

          {/* Feedback Section */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <h3 className="font-semibold text-blue-900 mb-2">
              Help us improve
            </h3>
            <p className="text-sm text-blue-800 mb-4">
              We'd love to hear your feedback about Edge Athlete. Your insights help us build a better platform for athletes.
            </p>
            <a
              href="mailto:support@edgeathlete.com?subject=Account Deletion Feedback"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              <i className="fas fa-envelope"></i>
              Send Feedback
            </a>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/"
              className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-lg"
            >
              <i className="fas fa-sign-in-alt"></i>
              Log In
            </a>
            <a
              href="/"
              className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-colors font-medium text-lg"
            >
              <i className="fas fa-user-plus"></i>
              Sign Up
            </a>
          </div>

          {/* Footer Note */}
          <p className="text-xs text-gray-500 mt-8">
            If you believe this was done in error or need assistance, please contact{' '}
            <a href="mailto:support@edgeathlete.com" className="text-blue-600 hover:underline">
              support@edgeathlete.com
            </a>
          </p>
        </div>

        {/* Bottom Branding */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-500">
            Edge Athlete &copy; 2025 - Building the future of sports
          </p>
        </div>
      </div>
    </div>
  );
}
