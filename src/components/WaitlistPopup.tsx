'use client';

import { useState } from 'react';

interface WaitlistPopupProps {
  isOpen: boolean;
  onClose: () => void;
  userType: string;
}

export default function WaitlistPopup({ isOpen, onClose, userType }: WaitlistPopupProps) {
  const [email, setEmail] = useState('');
  const [selectedType, setSelectedType] = useState(userType);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email || !selectedType) {
      setError('Please fill in all fields');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          userType: selectedType,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Something went wrong. Please try again.');
        return;
      }
      
      setIsSubmitted(true);
    } catch (err) {
      // Waitlist submission error
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setSelectedType(userType);
    setIsSubmitted(false);
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {!isSubmitted ? (
          <div className="p-6">
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  Thank you for your enthusiasm!
                </h2>
                <p className="text-gray-600 text-sm">
                  We&apos;re not quite ready for {selectedType.toLowerCase()} profiles yet, but we&apos;d love to notify you when we launch.
                </p>
              </div>
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                aria-label="Close popup"
              >
                ×
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your email"
                  required
                />
              </div>

              <div>
                <label htmlFor="userType" className="block text-sm font-medium text-gray-700 mb-1">
                  Profile Type
                </label>
                <select
                  id="userType"
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="Club">Club</option>
                  <option value="League">League</option>
                  <option value="Fan">Fan</option>
                  <option value="Guest">Guest Explorer</option>
                </select>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-md text-sm">
                  {error}
                </div>
              )}

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition duration-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isSubmitting ? (
                    <>
                      <i className="fas fa-spinner fa-spin mr-2"></i>
                      Joining...
                    </>
                  ) : (
                    'Join Waitlist'
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-check text-green-600 text-2xl"></i>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              You&apos;re on the list!
            </h3>
            <p className="text-gray-600 mb-6">
              We&apos;ll notify you at <strong>{email}</strong> when {selectedType.toLowerCase()} profiles are ready.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              In the meantime, you can still sign up as an Athlete to explore the platform!
            </p>
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200"
            >
              Got it!
            </button>
          </div>
        )}
      </div>
    </div>
  );
}