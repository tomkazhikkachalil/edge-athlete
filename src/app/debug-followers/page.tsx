'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';

export default function DebugFollowersPage() {
  const { user, profile } = useAuth();
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const testAPI = async (type: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/followers?type=${type}`);
      const data = await response.json();
      setApiResponse({ type, status: response.status, data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Followers Debug Page</h1>

        {/* Current User */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Current User</h2>
          {user ? (
            <div className="space-y-2">
              <p><strong>User ID:</strong> {user.id}</p>
              <p><strong>Email:</strong> {user.email}</p>
              <p><strong>Profile Name:</strong> {profile?.first_name} {profile?.middle_name} {profile?.last_name}</p>
              <p><strong>Username:</strong> {profile?.full_name}</p>
            </div>
          ) : (
            <p className="text-red-600">❌ Not logged in</p>
          )}
        </div>

        {/* Test Buttons */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Test API Endpoints</h2>
          <div className="flex gap-4">
            <button
              onClick={() => testAPI('followers')}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Test Followers
            </button>
            <button
              onClick={() => testAPI('following')}
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              Test Following
            </button>
            <button
              onClick={() => testAPI('requests')}
              disabled={loading}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
            >
              Test Requests
            </button>
          </div>
        </div>

        {/* API Response */}
        {apiResponse && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">
              API Response: {apiResponse.type}
              <span className={`ml-4 text-sm ${apiResponse.status === 200 ? 'text-green-600' : 'text-red-600'}`}>
                Status: {apiResponse.status}
              </span>
            </h2>
            <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
              {JSON.stringify(apiResponse.data, null, 2)}
            </pre>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            Error: {error}
          </div>
        )}

        {/* Expected Data */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
          <h2 className="text-xl font-bold mb-4">Expected Results</h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-bold">Tom (491d40c8-8452-4f0a-b80c-eace800fd13b):</h3>
              <ul className="list-disc ml-6">
                <li>Followers: Should show John Tom Doe</li>
                <li>Following: Should be empty</li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold">John (8ea6e939-1972-45ec-a5ca-6d6f97cc212c):</h3>
              <ul className="list-disc ml-6">
                <li>Followers: Should be empty</li>
                <li>Following: Should show Tom Kazhikkachalil</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
