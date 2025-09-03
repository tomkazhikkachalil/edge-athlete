'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [showAthleteRegistration, setShowAthleteRegistration] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    nickname: '',
    email: '',
    phone: '',
    birthday: '',
    gender: '',
    location: '',
    postalCode: '',
    password: '',
    confirmPassword: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { signIn, user, loading } = useAuth();
  const router = useRouter();

  // Redirect to dashboard if user is already logged in
  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  const handleAthleteClick = () => {
    setShowAthleteRegistration(true);
    setError('');
    setSuccess('');
  };

  const handleBackToLogin = () => {
    setShowAthleteRegistration(false);
    setError('');
    setSuccess('');
    setFormData({
      firstName: '',
      lastName: '',
      nickname: '',
      email: '',
      phone: '',
      birthday: '',
      gender: '',
      location: '',
      postalCode: '',
      password: '',
      confirmPassword: '',
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value, name } = e.target;
    const fieldName = id || name;
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const handleRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    setSuccess('');

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setIsSubmitting(false);
      return;
    }

    // Validate required fields
    if (!formData.email || !formData.password || !formData.firstName || !formData.lastName) {
      setError('Please fill in all required fields');
      setIsSubmitting(false);
      return;
    }

    try {
      console.log('Attempting signup with email:', formData.email);
      
      // Use our custom API route for signup
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          profileData: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            nickname: formData.nickname,
            phone: formData.phone,
            birthday: formData.birthday,
            gender: formData.gender as 'male' | 'female' | 'custom',
            location: formData.location,
            postal_code: formData.postalCode,
            user_type: 'athlete',
          }
        }),
      });

      const result = await response.json();
      console.log('Signup result:', result);

      if (!response.ok) {
        setError(result.error || 'An error occurred during registration');
      } else {
        setSuccess('Account created successfully! Please sign in to continue.');
        // Reset form
        setFormData({
          firstName: '',
          lastName: '',
          nickname: '',
          email: '',
          phone: '',
          birthday: '',
          gender: '',
          location: '',
          postalCode: '',
          password: '',
          confirmPassword: '',
        });
        // Switch back to login view after successful registration
        setTimeout(() => {
          setShowAthleteRegistration(false);
        }, 2000);
      }
    } catch (err: unknown) {
      console.error('Registration error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    const formDataObj = new FormData(e.target as HTMLFormElement);
    const email = formDataObj.get('email') as string;
    const password = formDataObj.get('password') as string;

    try {
      const { error } = await signIn(email, password);
      
      if (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid email or password';
        setError(errorMessage);
      } else {
        setSuccess('Login successful! Redirecting to your dashboard...');
        // Redirect will happen automatically via useEffect when user state changes
      }
    } catch (err) {
      setError('An unexpected error occurred');
      console.error('Login error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (showAthleteRegistration) {
    return (
      <div className="min-h-screen flex flex-col bg-blue-50">
        <div className="w-full bg-blue-600 py-3 px-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-white text-center">Edge Athlete</h1>
        </div>
        
        <div className="flex-grow flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="w-full p-4 sm:p-6">
              <h2 className="text-xl sm:text-2xl font-bold text-blue-800 mb-4">Create Athlete Account</h2>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md text-sm">
                  {success}
                </div>
              )}
              <form className="space-y-4" onSubmit={handleRegistrationSubmit}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="first-name" className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                    <input 
                      type="text" 
                      id="firstName" 
                      value={formData.firstName}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" 
                      placeholder="Enter first name"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                    <input 
                      type="text" 
                      id="lastName" 
                      value={formData.lastName}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" 
                      placeholder="Enter last name"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="nickname" className="block text-sm font-medium text-gray-700 mb-1">Nickname</label>
                  <input 
                    type="text" 
                    id="nickname" 
                    value={formData.nickname}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" 
                    placeholder="Enter nickname"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input 
                    type="email" 
                    id="email" 
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" 
                    placeholder="Enter email"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                  <input 
                    type="tel" 
                    id="phone" 
                    value={formData.phone}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" 
                    placeholder="Enter phone number"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="birthday" className="block text-sm font-medium text-gray-700 mb-1">Birthday</label>
                    <input 
                      type="date" 
                      id="birthday" 
                      value={formData.birthday}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                    <div className="flex flex-wrap gap-3 sm:space-x-4 sm:gap-0">
                      <label className="inline-flex items-center">
                        <input 
                          type="radio" 
                          name="gender" 
                          value="female" 
                          checked={formData.gender === 'female'}
                          onChange={handleInputChange}
                          className="form-radio text-blue-600" 
                        />
                        <span className="ml-1 text-sm">Female</span>
                      </label>
                      <label className="inline-flex items-center">
                        <input 
                          type="radio" 
                          name="gender" 
                          value="male" 
                          checked={formData.gender === 'male'}
                          onChange={handleInputChange}
                          className="form-radio text-blue-600" 
                        />
                        <span className="ml-1 text-sm">Male</span>
                      </label>
                      <label className="inline-flex items-center">
                        <input 
                          type="radio" 
                          name="gender" 
                          value="custom" 
                          checked={formData.gender === 'custom'}
                          onChange={handleInputChange}
                          className="form-radio text-blue-600" 
                        />
                        <span className="ml-1 text-sm">Custom</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div>
                  <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                  <div className="relative">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <input 
                          type="text" 
                          id="location" 
                          value={formData.location}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" 
                          placeholder="Enter your location"
                        />
                      </div>
                      <div className="relative">
                        <input 
                          type="text" 
                          id="postalCode" 
                          value={formData.postalCode}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 pr-8" 
                          placeholder="Enter postal code"
                        />
                        <button type="button" className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-blue-500 sm:hidden">
                          <i className="fas fa-location-dot text-sm"></i>
                        </button>
                      </div>
                    </div>
                    <button type="button" className="hidden sm:block absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-blue-500">
                      <i className="fas fa-location-dot"></i>
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="associated-clubs" className="block text-sm font-medium text-gray-700 mb-1">Associated Clubs</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      id="associated-clubs" 
                      className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 pr-8" 
                      placeholder="Search for clubs"
                    />
                    <button type="button" className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-blue-500">
                      <i className="fas fa-magnifying-glass text-sm"></i>
                    </button>
                  </div>
                  <div className="mt-2 p-2 border border-gray-300 rounded-md min-h-[40px]">
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs text-gray-500 italic">No clubs selected</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input 
                    type="password" 
                    id="password" 
                    value={formData.password}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" 
                    placeholder="Enter password"
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                  <input 
                    type="password" 
                    id="confirmPassword" 
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 sm:py-1 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" 
                    placeholder="Confirm password"
                    required
                    minLength={6}
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 transition duration-300 flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <i className="fas fa-spinner fa-spin mr-2"></i> Creating Account...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-user-plus mr-2"></i> Create Account
                    </>
                  )}
                </button>
              </form>
              <div className="mt-4 text-center">
                <p className="text-xs text-gray-600">
                  Already have an account? 
                  <span 
                    className="text-blue-600 hover:underline cursor-pointer ml-1"
                    onClick={handleBackToLogin}
                  >
                    Log in as an Athlete
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-blue-50">
      <div className="w-full bg-blue-600 py-3 px-4 sm:py-4">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white text-center">Edge Athlete</h1>
      </div>
      
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-4xl flex flex-col lg:flex-row bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Login Section */}
          <div className="w-full lg:w-1/2 p-6 sm:p-8 lg:p-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-blue-800 mb-6 sm:mb-8 text-center lg:text-left">Login to Your Account</h2>
            <div className="flex flex-col space-y-3 sm:space-y-4 mb-6">
              <button className="w-full py-3 px-4 rounded-md bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition duration-300 text-sm sm:text-base">
                <i className="fab fa-google mr-2"></i> Login with Google
              </button>
              <button className="w-full py-3 px-4 rounded-md bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition duration-300 text-sm sm:text-base">
                <i className="fab fa-facebook-f mr-2"></i> Login with Facebook
              </button>
              <button className="w-full py-3 px-4 rounded-md bg-black text-white flex items-center justify-center hover:bg-gray-800 transition duration-300 text-sm sm:text-base">
                <i className="fab fa-apple mr-2"></i> Login with Apple
              </button>
            </div>
            <div className="relative my-6">
              <hr className="border-gray-300" />
              <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-gray-500 text-sm">Or</span>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm mb-4">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md text-sm mb-4">
                {success}
              </div>
            )}
            <form className="space-y-4" onSubmit={handleLoginSubmit}>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input 
                  type="email" 
                  name="email"
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-base text-gray-800" 
                  placeholder="Enter your email"
                  required
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                <input 
                  type="password" 
                  name="password"
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-base text-gray-800" 
                  placeholder="Enter your password"
                  required
                />
              </div>
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 transition duration-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i> Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </button>
            </form>
          </div>
          
          {/* Sign Up Section */}
          <div className="w-full lg:w-1/2 bg-blue-600 p-6 sm:p-8 lg:p-12 text-white flex flex-col justify-between">
            <div className="flex flex-col items-center justify-center flex-grow">
              <h2 className="text-2xl sm:text-3xl font-bold mb-4 text-center">New Here?</h2>
              <p className="mb-6 text-center text-sm sm:text-base">Choose your role and sign up to discover new opportunities!</p>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 w-full max-w-sm">
                <button 
                  className="bg-white text-blue-600 py-3 px-3 sm:px-4 rounded-md font-semibold hover:bg-blue-100 transition duration-300 flex flex-col sm:flex-row items-center justify-center text-xs sm:text-sm"
                  onClick={handleAthleteClick}
                >
                  <i className="fas fa-person-running mb-1 sm:mb-0 sm:mr-2 text-lg sm:text-base"></i>
                  <span>Athlete</span>
                </button>
                <button className="bg-white text-blue-600 py-3 px-3 sm:px-4 rounded-md font-semibold hover:bg-blue-100 transition duration-300 flex flex-col sm:flex-row items-center justify-center text-xs sm:text-sm">
                  <i className="fas fa-shield mb-1 sm:mb-0 sm:mr-2 text-lg sm:text-base"></i>
                  <span>Club</span>
                </button>
                <button className="bg-white text-blue-600 py-3 px-3 sm:px-4 rounded-md font-semibold hover:bg-blue-100 transition duration-300 flex flex-col sm:flex-row items-center justify-center text-xs sm:text-sm">
                  <i className="fas fa-trophy mb-1 sm:mb-0 sm:mr-2 text-lg sm:text-base"></i>
                  <span>League</span>
                </button>
                <button className="bg-white text-blue-600 py-3 px-3 sm:px-4 rounded-md font-semibold hover:bg-blue-100 transition duration-300 flex flex-col sm:flex-row items-center justify-center text-xs sm:text-sm">
                  <i className="fas fa-star mb-1 sm:mb-0 sm:mr-2 text-lg sm:text-base"></i>
                  <span>Fan</span>
                </button>
              </div>
            </div>
            <div className="mt-6 sm:mt-8">
              <button className="w-full bg-transparent border-2 border-white text-white py-3 px-4 rounded-md font-semibold hover:bg-white hover:text-blue-600 transition duration-300 flex items-center justify-center text-sm sm:text-base">
                <i className="fas fa-binoculars mr-2"></i> Explore as Guest
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}