'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './supabase';
import { FEATURE_FLAGS } from './features';
import { setChatDockHidden } from './chat-dock-visibility';

const ACTIVE_PROFILE_KEY = 'ea:active-profile';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  initialAuthCheckComplete: boolean;
  // Guardian-profiles: athletes this user manages (role='guardian') and the
  // acting-as context. activeProfile === null means acting as self. The
  // relationship comes exclusively from profile_access; server routes
  // re-authorize every targetProfileId write via requireProfileRole.
  managedProfiles: Profile[];
  activeProfile: Profile | null;
  setActiveProfile: (p: Profile | null) => void;
  refreshManagedProfiles: () => Promise<void>;
  // No client-direct signUp on purpose: signups go through POST /api/signup
  // (DOB/consent gate + rate limit), which a browser-side auth.signUp bypasses.
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
  const [managedProfiles, setManagedProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfileState] = useState<Profile | null>(null);

  const setActiveProfile = useCallback((p: Profile | null) => {
    setActiveProfileState(p);
    try {
      if (p) window.localStorage.setItem(ACTIVE_PROFILE_KEY, p.id);
      else window.localStorage.removeItem(ACTIVE_PROFILE_KEY);
    } catch {}
  }, []);

  const refreshManagedProfiles = useCallback(async () => {
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) return;
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      setManagedProfiles([]);
      setActiveProfileState(null);
      return;
    }
    // Browser client under RLS: profile_access SELECT allows own rows; the
    // joined profiles read is granted by the 052 additive guardian policy.
    const { data, error } = await supabase
      .from('profile_access')
      .select('profiles!profile_access_profile_id_fkey(*)')
      .eq('user_id', uid)
      .eq('role', 'guardian');
    if (error) {
      console.error('managed profiles fetch failed:', error);
      return;
    }
    const athletes: Profile[] = (data ?? [])
      .map((r: unknown) => (r as { profiles: Profile }).profiles)
      .filter(Boolean);
    setManagedProfiles(athletes);
    // Restore a persisted acting-as selection (only if still managed).
    try {
      const savedId = window.localStorage.getItem(ACTIVE_PROFILE_KEY);
      if (savedId) {
        const match = athletes.find((a: Profile) => a.id === savedId) ?? null;
        setActiveProfileState(match);
        if (!match) window.localStorage.removeItem(ACTIVE_PROFILE_KEY);
      }
    } catch {}
  }, []);

  // Load managed profiles whenever the signed-in user changes.
  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshManagedProfiles();
    } else {
      setManagedProfiles([]);
      setActiveProfileState(null);
    }
  }, [user, refreshManagedProfiles]);
  const [profileCache, setProfileCache] = useState<Map<string, Profile>>(new Map()); // eslint-disable-line @typescript-eslint/no-unused-vars

  useEffect(() => {
    let isMounted = true;

    // Get initial session with 5-second timeout
    const getInitialSession = async () => {
      try {
        // Get session from Supabase (no localStorage caching)
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        // Handle refresh token errors
        if (sessionError) {
          const errorMessage = sessionError.message?.toLowerCase() || '';
          if (errorMessage.includes('refresh') && errorMessage.includes('token')) {
            // Clear session silently
            await supabase.auth.signOut().catch(() => {});
            // Reset state
            setUser(null);
            setProfile(null);
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
          // Fetch profile (simplified, no background refresh)
          await fetchProfile(currentUser.id);
        } else {
          setProfile(null);
        }

        if (isMounted) {
          setLoading(false);
          setInitialAuthCheckComplete(true);
        }
      } catch (error) {
        // Graceful fallback on error
        console.warn('Auth initialization error:', error);
        if (isMounted) {
          setUser(null);
          setProfile(null);
          setLoading(false);
          setInitialAuthCheckComplete(true);
        }
      }
    };

    // Add 5-second timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      if (isMounted && loading) {
        console.warn('Auth check timed out after 5 seconds');
        setLoading(false);
        setInitialAuthCheckComplete(true);
      }
    }, 5000);

    getInitialSession().finally(() => clearTimeout(timeoutId));

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {

        if (!isMounted) return;

        // Keep Realtime authenticated: a channel that joins before the
        // session resolves binds as anon and silently receives NOTHING from
        // RLS-gated tables (live scores, messages). Explicitly pushing the
        // token here closes that race for every channel in the app.
        supabase.realtime.setAuth(session?.access_token ?? null);

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
            return;
          }

          const { error } = await supabase.auth.refreshSession();
          if (error) {
            // If refresh fails due to invalid token, sign out silently
            const errorMessage = error.message?.toLowerCase() || '';
            if (errorMessage.includes('refresh') && errorMessage.includes('token')) {
              await supabase.auth.signOut();
              setUser(null);
              setProfile(null);
              return;
            }
          }
        } catch {
          // Silently handle refresh errors
        }
      }
    }, 15 * 60 * 1000); // Refresh every 15 minutes (reduced frequency)

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
      clearInterval(refreshInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hoisted function declaration, not a `const` arrow: an effect above calls it,
  // and react-hooks/immutability flags a reference to a binding declared later
  // in the body. Function declarations are hoisted, so there is no TDZ.
  async function fetchProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // Error fetching profile
        setProfile(null);
        return;
      }

      if (!data) {
        // Authenticated session but no profile row. Almost always a STALE
        // session for a deleted account: getSession() trusts browser storage,
        // so a JWT can outlive its user. Ask the auth server — a deleted
        // user's token fails getUser() — and drop the dead session, otherwise
        // the landing page spins on "Welcome back" forever (user set,
        // profile forever null, redirect never fires).
        const { error: userError } = await supabase.auth.getUser();
        if (userError) {
          await supabase.auth.signOut().catch(() => {});
          setUser(null);
        }
        setProfile(null);
        return;
      }

      setProfile(data);
      setProfileCache(prev => new Map(prev.set(userId, data)));
    } catch {
      // Error in fetchProfile
      setProfile(null);
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      // A fresh login restores the chat dock: closing it (X) hides it for the
      // rest of the login session only. Here — not in onAuthStateChange —
      // because SIGNED_IN also fires on tab refocus, and OAuth logins boot a
      // fresh document where the first event is INITIAL_SESSION (identical to
      // a refresh). The OAuth twin lives in oauth.ts.
      if (!error) setChatDockHidden(false);
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

      // Force redirect to login page with full page reload to ensure clean state
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- sign-out must reload to guarantee clean state
      window.location.href = '/';
    } catch (error) {
      console.error('Error signing out:', error);
      // Even on error, try to redirect
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- sign-out error path must still reload to guarantee clean state
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
    managedProfiles,
    activeProfile,
    setActiveProfile,
    refreshManagedProfiles,
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