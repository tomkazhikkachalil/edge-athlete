'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './supabase';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, profileData: Partial<Profile>) => Promise<{ error: unknown }>;
  signIn: (email: string, password: string) => Promise<{ error: unknown }>;
  signOut: () => Promise<void>;
  updateProfile: (profileData: Partial<Profile>) => Promise<{ error: unknown }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    const getInitialSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      
      if (session?.user) {
        await fetchProfile(session.user.id);
      }
      
      setLoading(false);
    };

    getInitialSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user || null);
        
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
        
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching profile:', error);
        return;
      }

      setProfile(data || null);
    } catch (error) {
      console.error('Error in fetchProfile:', error);
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
        console.log('Supabase auth error:', error);
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
          console.error('Error updating profile:', profileError);
          // Don't return error here as user was created successfully
        }
      }

      return { error: null };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('SignUp catch error:', error);
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
    await supabase.auth.signOut();
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

  const value: AuthContextType = {
    user,
    profile,
    loading,
    signUp,
    signIn,
    signOut,
    updateProfile,
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