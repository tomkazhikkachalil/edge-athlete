'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './supabase';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  initialAuthCheckComplete: boolean;
  signUp: (email: string, password: string, profileData: Partial<Profile>) => Promise<{ error: unknown }>;
  signIn: (email: string, password: string) => Promise<{ error: unknown }>;
  signOut: () => Promise<void>;
  updateProfile: (profileData: Partial<Profile>) => Promise<{ error: unknown }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialAuthCheckComplete, setInitialAuthCheckComplete] = useState(false);
  const [profileCache, setProfileCache] = useState<Map<string, Profile>>(new Map()); // eslint-disable-line @typescript-eslint/no-unused-vars

  useEffect(() => {
    let isMounted = true;

    // Get initial session with faster localStorage check and caching
    const getInitialSession = async () => {
      try {
        // Ultra-fast initial check - use synchronous localStorage access
        let cachedUser = null;
        let cachedProfile = null;
        
        if (typeof window !== 'undefined') {
          // Check for cached user data first
          const cachedUserData = localStorage.getItem('edge-athlete-user-cache');
          const cachedProfileData = localStorage.getItem('edge-athlete-profile-cache');
          
          if (cachedUserData && cachedProfileData) {
            try {
              cachedUser = JSON.parse(cachedUserData);
              cachedProfile = JSON.parse(cachedProfileData);
              
              // Set immediately for instant UI response
              if (isMounted && cachedUser && cachedProfile) {
                setUser(cachedUser);
                setProfile(cachedProfile);
                setProfileCache(new Map([[cachedUser.id, cachedProfile]]));
              }
            } catch {
              // Invalid cache, clear it
              localStorage.removeItem('edge-athlete-user-cache');
              localStorage.removeItem('edge-athlete-profile-cache');
            }
          }
        }

        // Then verify/update with fresh data from Supabase
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        // Handle refresh token errors silently
        if (sessionError) {
          // Check for any variant of refresh token error
          const errorMessage = sessionError.message?.toLowerCase() || '';
          if (errorMessage.includes('refresh') && errorMessage.includes('token')) {
            // Clear all auth-related storage silently
            await supabase.auth.signOut().catch(() => {});
            if (typeof window !== 'undefined') {
              localStorage.removeItem('edge-athlete-user-cache');
              localStorage.removeItem('edge-athlete-profile-cache');
              // Also clear Supabase auth storage
              try {
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                if (supabaseUrl) {
                  const projectId = supabaseUrl.split('//')[1]?.split('.')[0];
                  if (projectId) {
                    localStorage.removeItem(`sb-${projectId}-auth-token`);
                  }
                }
              } catch {
                // Silently handle storage key generation errors
              }
            }
            // Reset state immediately
            setUser(null);
            setProfile(null);
            // Skip further processing
            if (isMounted) {
              setLoading(false);
              setInitialAuthCheckComplete(true);
            }
            return;
          }
        }
        
        if (!isMounted) return;
        
        const currentUser = session?.user || null;
        setUser(currentUser);
        
        if (currentUser) {
          // If we don't have cached data or user changed, fetch profile
          if (!cachedProfile || cachedUser?.id !== currentUser.id) {
            await fetchProfile(currentUser.id);
          } else {
            // We already set the cached profile, but still refresh it in background
            fetchProfile(currentUser.id); // Don't await - background refresh
          }
        } else {
          // Clear cache if no user
          setProfile(null);
          if (typeof window !== 'undefined') {
            localStorage.removeItem('edge-athlete-user-cache');
            localStorage.removeItem('edge-athlete-profile-cache');
          }
        }
        
        if (isMounted) {
          setLoading(false);
          setInitialAuthCheckComplete(true);
        }
      } catch {
        // Error getting initial session
        if (isMounted) {
          setLoading(false);
          setInitialAuthCheckComplete(true);
        }
      }
    };

    getInitialSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: any, session: any) => {
        
        if (!isMounted) return;
        
        setUser(session?.user || null);
        
        if (session?.user && event !== 'SIGNED_OUT') {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
        
        if (isMounted) {
          setLoading(false);
          setInitialAuthCheckComplete(true);
        }
      }
    );

    // Set up periodic session refresh to prevent token expiry
    const refreshInterval = setInterval(async () => {
      if (isMounted) {
        try {
          // First check if we have a session before trying to refresh
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            // No session to refresh, skip
            return;
          }

          const { error } = await supabase.auth.refreshSession();
          if (error) {
            // If refresh fails due to invalid token, sign out silently
            const errorMessage = error.message?.toLowerCase() || '';
            if (errorMessage.includes('refresh') && errorMessage.includes('token')) {
              // Clear everything silently without logging the error
              await supabase.auth.signOut();
              setUser(null);
              setProfile(null);
              // Clear cached auth data
              if (typeof window !== 'undefined') {
                localStorage.removeItem('edge-athlete-user-cache');
                localStorage.removeItem('edge-athlete-profile-cache');
                // Also clear Supabase auth storage
                try {
                  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                  if (supabaseUrl) {
                    const projectId = supabaseUrl.split('//')[1]?.split('.')[0];
                    if (projectId) {
                      localStorage.removeItem(`sb-${projectId}-auth-token`);
                    }
                  }
                } catch {
                  // Silently handle storage key generation errors
                }
              }
              // Don't throw or log - this is expected behavior when token expires
              return;
            }
          }
        } catch {
          // Silently handle refresh errors - user will be redirected to login if needed
        }
      }
    }, 5 * 60 * 1000); // Refresh every 5 minutes

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      clearInterval(refreshInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // Error fetching profile
        // Don't return early, set profile to null and continue
      }

      const profileData = data || null;
      setProfile(profileData);
      
      // Update cache
      if (profileData) {
        setProfileCache(prev => new Map(prev.set(userId, profileData)));
        
        // Cache in localStorage for faster next load
        if (typeof window !== 'undefined') {
          localStorage.setItem('edge-athlete-user-cache', JSON.stringify(user));
          localStorage.setItem('edge-athlete-profile-cache', JSON.stringify(profileData));
        }
      }
    } catch {
      // Error in fetchProfile
      setProfile(null);
    }
  };

  const signUp = async (email: string, password: string, profileData: Partial<Profile>) => {
    try {
      // First check if email already exists in our profiles table
      const { data: existingProfiles } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', email.toLowerCase());

      // If we found any profiles with this email, it's already taken
      if (existingProfiles && existingProfiles.length > 0) {
        return { 
          error: { 
            message: 'There is already an account registered under this email address. Please use a different email or try logging in.'
          }
        };
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        // Handle Supabase auth errors
        if (error.message.includes('already registered') || 
            error.message.includes('already exists') ||
            error.message.includes('User already registered') ||
            error.message.includes('already been registered') ||
            error.message.includes('Email already') ||
            error.message.includes('duplicate')) {
          return { 
            error: { 
              message: 'There is already an account registered under this email address. Please use a different email or try logging in.'
            }
          };
        }
        return { error };
      }

      // If Supabase doesn't return an error but also no user, it might be a duplicate
      if (!data.user && !error) {
        return { 
          error: { 
            message: 'There is already an account registered under this email address. Please use a different email or try logging in.'
          }
        };
      }

      // If signup successful, update the profile with additional data
      if (data.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            first_name: profileData.first_name,
            last_name: profileData.last_name,
            nickname: profileData.nickname,
            phone: profileData.phone,
            birthday: profileData.birthday,
            gender: profileData.gender,
            location: profileData.location,
            postal_code: profileData.postal_code,
            user_type: profileData.user_type || 'athlete',
          })
          .eq('id', data.user.id);

        if (profileError) {
          // Error updating profile
          // Don't return error here as user was created successfully
        }
      }

      return { error: null };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // SignUp catch error
      if (errorMessage?.includes('already registered') || 
          errorMessage?.includes('already exists') ||
          errorMessage?.includes('duplicate') ||
          errorMessage?.includes('Email already')) {
        return { 
          error: { 
            message: 'There is already an account registered under this email address. Please use a different email or try logging in.'
          }
        };
      }
      return { error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error };
    } catch (error) {
      return { error };
    }
  };

  const signOut = async () => {
    try {
      // Sign out from Supabase
      await supabase.auth.signOut();

      // Clear local state
      setUser(null);
      setProfile(null);

      // Clear all cached auth data from localStorage
      if (typeof window !== 'undefined') {
        localStorage.removeItem('edge-athlete-user-cache');
        localStorage.removeItem('edge-athlete-profile-cache');

        // Also clear Supabase auth storage
        try {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          if (supabaseUrl) {
            const projectId = supabaseUrl.split('//')[1]?.split('.')[0];
            if (projectId) {
              localStorage.removeItem(`sb-${projectId}-auth-token`);
            }
          }
        } catch {
          // Silently handle errors
        }
      }

      // Force redirect to login page with full page reload to ensure clean state
      window.location.href = '/';
    } catch (error) {
      console.error('Error signing out:', error);
      // Even on error, try to redirect
      window.location.href = '/';
    }
  };

  const updateProfile = async (profileData: Partial<Profile>) => {
    if (!user) return { error: 'No user logged in' };

    try {
      const { error } = await supabase
        .from('profiles')
        .update(profileData)
        .eq('id', user.id);

      if (!error) {
        await fetchProfile(user.id);
      }

      return { error };
    } catch (error) {
      return { error };
    }
  };

  const refreshProfile = async () => {
    if (user?.id) {
      await fetchProfile(user.id);
    }
  };

  const value: AuthContextType = {
    user,
    profile,
    loading,
    initialAuthCheckComplete,
    signUp,
    signIn,
    signOut,
    updateProfile,
    refreshProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}