'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from './Toast';
import LazyImage from './LazyImage';
import AvatarUploader from './AvatarUploader';
import type { Profile } from '@/lib/supabase';
import { getSportDefinition, getAllSports, type SportKey } from '@/lib/sports';
import { resolveSportKey } from '@/lib/sports/resolve-sport-key';
import {
  getSportSettingsSchema,
  settingsToFormValues,
  mergeSettingsForSave,
  validateSettingsValues,
  emptySettingsValues,
  type SettingsFormValues,
} from '@/lib/sports/settings-schemas';
import SportSettingsForm from './SportSettingsForm';
import SportMultiSelect from './SportMultiSelect';
import { COPY, getComingSoonMessage } from '@/lib/copy';
import ConfirmModal from './ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import {
  formatHeight,
  getInitials,
  formatSocialHandle,
  validateHeight
} from '@/lib/formatters';

interface EditProfileTabsProps {
  isOpen: boolean;
  onClose: () => void;
  profile: Profile | null;
  onSave: () => void;
}

/**
 * Sport tabs are keyed by `SportKey` itself rather than a hand-listed union.
 * The old union named only golf/ice_hockey/volleyball while `generateTabs`
 * cast every registered sport into it, so a sport with no `case` compiled
 * fine and rendered a blank tab. Widening the type is what makes the
 * fallthrough visible to TypeScript instead of silent.
 */
type TabId = 'basic' | 'vitals' | 'socials' | SportKey;

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
  enabled: boolean;
  comingSoon?: boolean;
}

// Generate sport-aware tabs dynamically
const generateTabs = (): TabConfig[] => {
  const baseTabs: TabConfig[] = [
    { id: 'basic', label: 'Basic', icon: 'fas fa-user', enabled: true },
    { id: 'vitals', label: 'Vitals', icon: 'fas fa-chart-line', enabled: true },
    { id: 'socials', label: 'Socials', icon: 'fas fa-share-alt', enabled: true },
  ];

  // Add sport-specific tabs
  const allSports = getAllSports();
  allSports.forEach(adapter => {
    const sportDef = getSportDefinition(adapter.sportKey);
    baseTabs.push({
      id: adapter.sportKey,
      label: sportDef.display_name,
      icon: sportDef.icon_id,
      enabled: adapter.isEnabled(),
      comingSoon: !adapter.isEnabled()
    });
  });

  // NOTE: there is deliberately no Equipment tab here. Gear is a first-class
  // sport-agnostic feature backed by `athlete_equipment` (profile Equipment
  // tab, `AddEquipmentModal`). This modal used to carry a second, golf-only
  // equipment form that wrote driver/irons/putter fields into
  // `sport_settings` — values no surface ever read back. Removed August 2026.

  return baseTabs;
};

/** Sport tabs are exactly the tabs whose id is a registered sport key. */
const SPORT_TAB_IDS = new Set<string>(getAllSports().map(adapter => adapter.sportKey));

const isSportTab = (tabId: TabId): tabId is SportKey => SPORT_TAB_IDS.has(tabId);

/** Snapshot key for one sport's dirty-close baseline. */
const sportSnapKey = (sportKey: SportKey) => `settings:${sportKey}`;

const TABS = generateTabs();

export default function EditProfileTabs({
  isOpen,
  onClose,
  profile,
  onSave
}: EditProfileTabsProps) {
  const { user } = useAuth();
  const { showSuccess, showError, showInfo } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form states - Initialize with empty strings to prevent controlled/uncontrolled warnings
  const [basicForm, setBasicForm] = useState({
    first_name: '',
    middle_name: '',
    last_name: '',
    full_name: '', // Fallback display name (NOT editable, NOT a handle)
    handle: '', // Unique @handle identifier (user-editable @username)
    bio: '',
    avatar_file: null as File | null,
    visibility: 'public' as 'public' | 'private',
  });

  // Sport selection (order matters: first = primary). initialSports is the
  // loaded baseline for diffing adds/removes on save.
  const [selectedSports, setSelectedSports] = useState<SportKey[]>([]);
  const [initialSports, setInitialSports] = useState<SportKey[]>([]);

  const [vitalsForm, setVitalsForm] = useState({
    height_cm: '',
    weight_kg: '',
    weight_unit: 'lbs' as 'lbs' | 'kg' | 'stone',
    dob: '',
    location: '',
    class_year: '' as string | number,
  });

  const [socialsForm, setSocialsForm] = useState({
    social_twitter: '',
    social_instagram: '',
    social_facebook: '',
    social_tiktok: '',
  });

  // One entry per sport that has a settings schema, keyed by sport key.
  // Replaces the old hand-written `golfForm`/`equipmentForm` pair — every
  // sport's tab now reads and writes through this single map.
  const [sportSettings, setSportSettings] = useState<Partial<Record<SportKey, SettingsFormValues>>>({});

  // The settings objects exactly as stored, kept so a save can preserve keys
  // no schema declares (see `mergeSettingsForSave`). Held in a ref because
  // nothing renders from it.
  const storedSportSettingsRef = useRef<Partial<Record<SportKey, Record<string, unknown>>>>({});

  const setSportField = (sportKey: SportKey, fieldKey: string, value: string) => {
    setSportSettings(prev => {
      const schema = getSportSettingsSchema(sportKey);
      const current = prev[sportKey] ?? (schema ? emptySettingsValues(schema) : {});
      return { ...prev, [sportKey]: { ...current, [fieldKey]: value } };
    });
  };

  // Dirty-close support: per-group snapshots of the last loaded/saved
  // values (loads write them directly with local values; successful tab
  // saves refresh their own group). Save is per-tab, so edits in OTHER
  // tabs must survive a save and still count as unsaved on close.
  const snapRef = useRef<Record<string, string>>({});
  const serializeGroup = {
    basic: () => JSON.stringify({ ...basicForm, avatar_file: basicForm.avatar_file?.name ?? null }),
    sports: () => JSON.stringify(selectedSports),
    vitals: () => JSON.stringify(vitalsForm),
    socials: () => JSON.stringify(socialsForm),
  } as const;

  // Sport settings are snapshotted PER SPORT, not as one blob: saving golf
  // must not mark unsaved basketball edits as clean.
  const serializeSportSettings = (sportKey: SportKey) =>
    JSON.stringify(sportSettings[sportKey] ?? {});

  const isDirty = () => {
    const staticDirty = (Object.keys(serializeGroup) as (keyof typeof serializeGroup)[]).some(
      key => snapRef.current[key] !== undefined && snapRef.current[key] !== serializeGroup[key]()
    );
    if (staticDirty) return true;

    return (Object.keys(sportSettings) as SportKey[]).some(sportKey => {
      const snapshot = snapRef.current[sportSnapKey(sportKey)];
      return snapshot !== undefined && snapshot !== serializeSportSettings(sportKey);
    });
  };
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, onClose);

  // Every other useDirtyClose consumer pairs it with the scroll lock; this
  // one didn't, so on iOS the page scrolled and rubber-banded under the modal.
  useBodyScrollLock(isOpen);

  // Hydrate every sport's settings in ONE request. The list form of
  // /api/sport-settings returns each row's settings alongside its key, so a
  // per-sport fetch (what the old golf-only loader did) is unnecessary —
  // this scales to any number of sports without adding round trips.
  //
  // Sports with no saved row still get seeded defaults, so their inputs are
  // controlled from first paint and their dirty baseline is meaningful.
  useEffect(() => {
    if (!user?.id) return;

    const loadSportSettings = async () => {
      try {
        const response = await fetch('/api/sport-settings');
        if (!response.ok) return;

        const data = await response.json();
        const stored = new Map<SportKey, Record<string, unknown>>();
        for (const row of data.sports || []) {
          const key = resolveSportKey(row.sportKey);
          if (key) stored.set(key, (row.settings || {}) as Record<string, unknown>);
        }

        const loaded: Partial<Record<SportKey, SettingsFormValues>> = {};
        const rawStored: Partial<Record<SportKey, Record<string, unknown>>> = {};
        for (const adapter of getAllSports()) {
          const schema = getSportSettingsSchema(adapter.sportKey);
          if (!schema) continue;
          const raw = stored.get(adapter.sportKey);
          const values = settingsToFormValues(schema, raw);
          loaded[adapter.sportKey] = values;
          if (raw) rawStored[adapter.sportKey] = raw;
          snapRef.current[sportSnapKey(adapter.sportKey)] = JSON.stringify(values);
        }

        storedSportSettingsRef.current = rawStored;
        setSportSettings(loaded);
      } catch (error) {
        console.error('Error loading sport settings:', error);
      }
    };

    loadSportSettings();
  }, [user?.id]);

  // Load the athlete's sports: declared primary (profiles.sport) leads, then
  // every sport with a sport_settings row (intake-declared).
  useEffect(() => {
    if (!user?.id) return;
    const loadSports = async () => {
      try {
        const primary = resolveSportKey(profile?.sport);
        const response = await fetch('/api/sport-settings');
        const settingsKeys: SportKey[] = [];
        if (response.ok) {
          const data = await response.json();
          for (const row of data.sports || []) {
            const key = resolveSportKey(row.sportKey);
            if (key) settingsKeys.push(key);
          }
        }
        const ordered: SportKey[] = [];
        if (primary) ordered.push(primary);
        for (const key of settingsKeys) if (!ordered.includes(key)) ordered.push(key);
        setSelectedSports(ordered);
        setInitialSports(ordered);
        snapRef.current.sports = JSON.stringify(ordered);
      } catch (e) {
        console.error('Error loading sports:', e);
      }
    };
    loadSports();
  }, [user?.id, profile?.sport]);

  // No conversion - save exactly what user enters

  // Initialize forms when profile changes
  // Seeding the form is state synchronisation — done during render so the
  // previous values never paint for a frame.
  const [syncedProfileTabs, setSyncedProfileTabs] = useState({ profile });
  if (syncedProfileTabs.profile !== profile) {
    setSyncedProfileTabs({ profile });
    const loadedBasic = {
      first_name: (profile?.first_name || '').toString(),
      middle_name: (profile?.middle_name || '').toString(),
      last_name: (profile?.last_name || '').toString(),
      full_name: (profile?.full_name || '').toString(), // fallback display name (not editable)
      handle: (profile?.handle || '').toString(), // unique @handle identifier
      bio: (profile?.bio || '').toString(),
      avatar_file: null as File | null,
      visibility: (profile?.visibility || 'public') as 'public' | 'private',
    };
    setBasicForm(loadedBasic);

    // Initialize weight with user's saved values - no conversion
    const savedUnit = (profile?.weight_unit || 'lbs') as 'lbs' | 'kg' | 'stone';
    const loadedVitals = {
      height_cm: profile?.height_cm ? formatHeight(profile.height_cm) : '',
      weight_kg: profile?.weight_display ? String(profile.weight_display) : '',
      weight_unit: savedUnit,
      dob: (profile?.dob || '').toString(),
      location: (profile?.location || '').toString(),
      class_year: profile?.class_year ? String(profile.class_year) : '',
    };
    setVitalsForm(loadedVitals);

    const loadedSocials = {
      social_twitter: formatSocialHandle(profile?.social_twitter),
      social_instagram: formatSocialHandle(profile?.social_instagram),
      social_facebook: formatSocialHandle(profile?.social_facebook),
      social_tiktok: formatSocialHandle(profile?.social_tiktok),
    };
    setSocialsForm(loadedSocials);

    // Golf and equipment settings are now loaded from sport_settings API
    // (see useEffect above that fetches from /api/sport-settings)
  }

  // Dirty-close baselines are written to a REF, which must not happen during
  // render. This effect runs right after the seeding render above, so it
  // snapshots exactly the values that were just applied.
  useEffect(() => {
    snapRef.current.basic = JSON.stringify({ ...basicForm, avatar_file: null });
    snapRef.current.vitals = JSON.stringify(vitalsForm);
    snapRef.current.socials = JSON.stringify(socialsForm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const saveTab = async (tabId: TabId) => {
    if (!user?.id) {
      showError('Authentication Error', 'Please log in again.');
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      // Values may also be '' — the server's clear-to-null convention
      let updateData: Record<string, unknown> = {};
      let hasChanges = false;

      switch (tabId) {
        case 'basic':
          // Handle avatar upload if present
          if (basicForm.avatar_file) {
            await uploadAvatar(basicForm.avatar_file);
          }

          // Validate required fields
          if (!basicForm.first_name.trim() || !basicForm.last_name.trim()) {
            throw new Error('First name and last name are required');
          }

          // Handle changes go through the dedicated handle system (reserved
          // names, format validation, history, rate limiting) — the generic
          // profile PUT deliberately strips `handle`.
          {
            const newHandle = basicForm.handle.trim().replace(/^@/, '').toLowerCase();
            const currentHandle = (profile?.handle || '').toString().replace(/^@/, '').toLowerCase();
            if (newHandle && newHandle !== currentHandle) {
              const handleRes = await fetch('/api/handles/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ handle: newHandle }),
              });
              if (!handleRes.ok) {
                const err = await handleRes.json();
                throw new Error(err.error || 'Failed to update handle');
              }
            }
          }

          // Sport selection: primary → profiles.sport (display name; '' clears);
          // added sports get an empty sport_settings row, removed sports lose
          // theirs. Diffed against the loaded baseline.
          {
            const added = selectedSports.filter(k => !initialSports.includes(k));
            const removed = initialSports.filter(k => !selectedSports.includes(k));
            await Promise.all([
              ...added.map(key =>
                fetch('/api/sport-settings', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sport: key, settings: {} }),
                })
              ),
              ...removed.map(key =>
                fetch(`/api/sport-settings?sport=${key}`, { method: 'DELETE' })
              ),
            ]);
            setInitialSports(selectedSports);
          }

          // Empty strings are sent intentionally — the server converts '' to
          // null, which is the only way a user can CLEAR a field. (Sending
          // `undefined` drops the key from JSON and the value can never be
          // emptied.)
          updateData = {
            first_name: basicForm.first_name.trim(),
            middle_name: basicForm.middle_name.trim(),
            last_name: basicForm.last_name.trim(),
            full_name: basicForm.full_name.trim() || undefined, // fallback display name (not editable)
            bio: basicForm.bio.trim(),
            visibility: basicForm.visibility,
            sport: selectedSports[0] ? getSportDefinition(selectedSports[0]).display_name : '',
          };
          hasChanges = true;
          break;

        case 'vitals':
          // Save vitals data
          // Validate height
          const heightValidation = validateHeight(vitalsForm.height_cm);
          if (vitalsForm.height_cm.trim() && heightValidation.error) {
            throw new Error(`Height: ${heightValidation.error}`);
          }
          
          // Save weight display value exactly as entered
          let weightDisplay: number | undefined;
          if (vitalsForm.weight_kg && vitalsForm.weight_kg.trim()) {
            weightDisplay = parseFloat(vitalsForm.weight_kg);
            // Save weight with unit
            if (isNaN(weightDisplay) || weightDisplay <= 0) {
              throw new Error(`Please enter a valid weight`);
            }
          } else {
            // Clear weight if no value
            weightDisplay = undefined;
          }
          
          // Empty strings intentional — server converts '' to null (clears)
          updateData = {
            height_cm: heightValidation.value ?? '',
            weight_display: weightDisplay ?? '',
            weight_unit: vitalsForm.weight_unit || 'lbs',
            dob: vitalsForm.dob || '',
            location: vitalsForm.location.trim(),
            class_year: vitalsForm.class_year ? parseInt(String(vitalsForm.class_year)) : '',
          };
          // Update vitals in database
          hasChanges = true;
          break;

        case 'socials':
          // Empty strings intentional — server converts '' to null (clears)
          updateData = {
            social_twitter: socialsForm.social_twitter.trim(),
            social_instagram: socialsForm.social_instagram.trim(),
            social_facebook: socialsForm.social_facebook.trim(),
            social_tiktok: socialsForm.social_tiktok.trim(),
          };
          hasChanges = true;
          break;

        default:
          // Every remaining tab is a sport tab. Saving is driven entirely by
          // the sport's schema, so a newly enabled sport saves correctly with
          // no code change here. Previously this switch had a `case` per
          // sport and anything unlisted fell through to the profiles PUT with
          // `hasChanges` false — no request, no toast, a Save button that
          // silently did nothing for basketball, soccer and baseball.
          {
            if (!isSportTab(tabId)) {
              // Unreachable: the union is exhausted above. Kept so a future
              // non-sport tab cannot silently no-op the way sports did.
              throw new Error(`No save handler for tab: ${tabId}`);
            }

            const sportName = TABS.find(t => t.id === tabId)?.label || 'Sport';
            const schema = getSportSettingsSchema(tabId);

            if (!schema) {
              // Registered sport with no settings schema yet — the tab shows
              // the same "coming soon" panel, so this matches what is on screen.
              showInfo(`${sportName} Settings`, getComingSoonMessage(tabId, 'settings'));
              return;
            }

            const values = sportSettings[tabId] ?? emptySettingsValues(schema);
            const fieldErrors = validateSettingsValues(schema, values);
            if (Object.keys(fieldErrors).length > 0) {
              setErrors(fieldErrors);
              showError('Save Failed', Object.values(fieldErrors)[0]);
              return;
            }

            const merged = mergeSettingsForSave(
              schema,
              storedSportSettingsRef.current[tabId],
              values
            );

            const response = await fetch('/api/sport-settings', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sport: tabId, settings: merged }),
            });

            if (!response.ok) {
              throw new Error(`Failed to save ${sportName.toLowerCase()} settings`);
            }

            // Saved state becomes the new baseline for both dirty-tracking
            // and the next merge, so two saves in one session stay correct.
            storedSportSettingsRef.current[tabId] = merged;
            snapRef.current[sportSnapKey(tabId)] = serializeSportSettings(tabId);
            showSuccess('Changes Saved', `${sportName} settings updated successfully!`);
            onSave(); // Refresh parent data
          }
          return; // Exit early - don't update profiles table
      }

      if (hasChanges) {
        const response = await fetch('/api/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            profileData: updateData,
            userId: user.id
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save changes');
        }

        await response.json();

        // The profile PUT covers basic/vitals/socials plus sports — refresh
        // those snapshots so a saved tab no longer reads as unsaved.
        snapRef.current.basic = serializeGroup.basic();
        snapRef.current.vitals = serializeGroup.vitals();
        snapRef.current.socials = serializeGroup.socials();
        snapRef.current.sports = serializeGroup.sports();
        showSuccess('Changes Saved', `${TABS.find(t => t.id === tabId)?.label} updated successfully!`);
        onSave(); // Refresh parent data
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save changes';
      showError('Save Failed', message);
      
      // Set field-specific errors if needed — the UI reads errors.handle
      if (message.toLowerCase().includes('username') || message.toLowerCase().includes('handle')) {
        setErrors({ handle: message });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    const maxSize = 5 * 1024 * 1024; // 5MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    
    if (file.size > maxSize) {
      throw new Error('Avatar file size must be less than 5MB');
    }
    
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Please select a valid image file (JPG, PNG, GIF, or WebP)');
    }

    const formData = new FormData();
    formData.append('avatar', file);

    const response = await fetch('/api/upload/avatar', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Failed to upload avatar');
    }
  };

  const renderBasicTab = () => (
    <div className="space-y-6">
      {/* Avatar Upload */}
      <div className="flex items-center space-x-4">
        <div className="relative">
          <LazyImage
            src={profile?.avatar_url}
            alt={`${basicForm.full_name || 'User'} avatar`}
            className="w-20 h-20 rounded-full object-cover border-3 border-border-strong"
            width={80}
            height={80}
            priority
            fallback={
              <div 
                className="w-20 h-20 rounded-full bg-gray-200 dark:bg-stone-800 flex items-center justify-center border-3 border-border-strong"
                role="img"
                aria-label={`${basicForm.full_name || 'User'} avatar`}
              >
                <span className="text-tertiary font-semibold text-xl" aria-hidden="true">
                  {getInitials(basicForm.full_name)}
                </span>
              </div>
            }
          />
        </div>
        <div className="flex-1">
          <AvatarUploader
            mode="deferred"
            onFileReady={file => setBasicForm(prev => ({ ...prev, avatar_file: file }))}
            render={({ open }) => (
              <button
                type="button"
                onClick={open}
                className="cursor-pointer inline-flex items-center px-4 py-2 border border-border-strong rounded-md shadow-sm text-sm font-medium text-secondary bg-surface hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
              >
                <i className="fas fa-upload mr-2" aria-hidden="true"></i>
                {basicForm.avatar_file ? 'Avatar ready — saves with profile' : 'Change Avatar'}
              </button>
            )}
          />
          <p className="mt-1 text-xs text-muted">
            JPG, PNG, GIF or WebP. Max 5MB.
          </p>
        </div>
      </div>

      {/* Name Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="first_name" className="block text-sm font-medium text-secondary mb-1">
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            id="first_name"
            type="text"
            value={basicForm.first_name || ''}
            onChange={(e) => setBasicForm(prev => ({ ...prev, first_name: e.target.value }))}
            className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="John"
            required
          />
        </div>

        <div>
          <label htmlFor="last_name" className="block text-sm font-medium text-secondary mb-1">
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            id="last_name"
            type="text"
            value={basicForm.last_name || ''}
            onChange={(e) => setBasicForm(prev => ({ ...prev, last_name: e.target.value }))}
            className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="Doe"
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="middle_name" className="block text-sm font-medium text-secondary mb-1">
          Middle Name <span className="text-faint text-xs">(Optional)</span>
        </label>
        <input
          id="middle_name"
          type="text"
          value={basicForm.middle_name || ''}
          onChange={(e) => setBasicForm(prev => ({ ...prev, middle_name: e.target.value }))}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          placeholder="Michael"
        />
      </div>

      <div>
        <label htmlFor="handle" className="block text-sm font-medium text-secondary mb-1">
          Handle (Username) <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className="text-muted">@</span>
          </div>
          <input
            id="handle"
            type="text"
            value={basicForm.handle || ''}
            onChange={(e) => {
              // Remove @ prefix if user types it, remove spaces, convert to lowercase
              const value = e.target.value.replace(/^@/, '').replace(/\s/g, '').toLowerCase();
              setBasicForm(prev => ({ ...prev, handle: value }));
            }}
            className={`w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent ${
              errors.handle ? 'border-red-500' : 'border-border-strong'
            }`}
            placeholder="yourhandle"
            required
            minLength={3}
            maxLength={20}
            pattern="[a-z0-9][a-z0-9._]*[a-z0-9]"
          />
        </div>
        <p className="mt-1 text-xs text-muted">
          Your unique identifier (3-20 characters, letters/numbers/dots/underscores, no spaces)
        </p>
        {errors.handle && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
            {errors.handle}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="bio" className="block text-sm font-medium text-secondary mb-1">
          Bio
        </label>
        <textarea
          id="bio"
          rows={4}
          maxLength={500}
          value={basicForm.bio || ''}
          onChange={(e) => setBasicForm(prev => ({ ...prev, bio: e.target.value }))}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
          placeholder="Tell us about yourself..."
        />
        <p className="mt-1 text-xs text-muted">
          {basicForm.bio.length}/500 characters
        </p>
      </div>

      {/* Privacy Toggle */}
      <div className="pt-4 border-t border-border">
        <label className="flex items-center justify-between p-4 border-2 border-border rounded-lg cursor-pointer hover:bg-surface-muted transition-colors">
          <div className="flex-1">
            <div className="font-medium text-primary mb-1">Profile Visibility</div>
            <div className="text-sm text-muted">
              {basicForm.visibility === 'public'
                ? 'Anyone can view your profile, posts, and stats'
                : 'Only approved fans can view your profile, posts, and stats'
              }
            </div>
          </div>
          <div className="ml-4 flex-shrink-0">
            <button
              type="button"
              onClick={() => setBasicForm(prev => ({
                ...prev,
                visibility: prev.visibility === 'public' ? 'private' : 'public'
              }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 ${
                basicForm.visibility === 'public' ? 'bg-green-600' : 'bg-gray-300 dark:bg-stone-700'
              }`}
              aria-label={`Toggle profile visibility. Currently ${basicForm.visibility}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                basicForm.visibility === 'public' ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </label>

        {/* Visual indicator */}
        <div className="mt-3 text-center">
          <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
            basicForm.visibility === 'public'
              ? 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800'
          }`}>
            <i className={`fas fa-${basicForm.visibility === 'public' ? 'globe' : 'lock'}`}></i>
            {basicForm.visibility === 'public' ? 'Public Profile' : 'Private Profile'}
          </span>
        </div>

        {/* Explanation */}
        <div className="mt-3 p-3 bg-brand-soft border border-violet-100 dark:border-violet-900 rounded-lg">
          <div className="flex items-start gap-2">
            <i className="fas fa-info-circle text-brand-fg mt-0.5"></i>
            <div className="text-xs text-violet-900 dark:text-violet-200">
              {basicForm.visibility === 'public' ? (
                <>
                  <strong>Public profiles</strong> help you get discovered by coaches, scouts, and other athletes.
                  All your content will be visible to anyone who is logged in.
                </>
              ) : (
                <>
                  <strong>Private profiles</strong> give you control over who sees your content.
                  Only fans you approve will be able to view your profile, posts, and stats.
                </>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 text-xs text-muted text-center">
          You can change this setting anytime
        </p>
      </div>

      {/* Sports — primary drives profile/feed/composer defaults */}
      <div>
        <label className="block text-sm font-medium text-secondary mb-2">
          Your sports
        </label>
        <SportMultiSelect selected={selectedSports} onChange={setSelectedSports} />
        <p className="mt-2 text-xs text-muted">
          Removing a sport clears its settings.
        </p>
      </div>
    </div>
  );

  const renderVitalsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="height" className="block text-sm font-medium text-secondary mb-1">
            Height
          </label>
          <input
            id="height"
            type="text"
            value={vitalsForm.height_cm || ''}
            onChange={(e) => setVitalsForm(prev => ({ ...prev, height_cm: e.target.value }))}
            className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="5'10&quot;, 5 10, 510, or 5.10"
          />
          <p className="mt-1 text-xs text-muted">
            Multiple formats accepted: 5&apos;10&quot;, 5 10, 510, 5.10, 6 feet
          </p>
        </div>

        <div>
          <label htmlFor="weight" className="block text-sm font-medium text-secondary mb-1">
            Weight
          </label>
          <div className="flex space-x-2">
            <input
              id="weight"
              type="number"
              step="0.1"
              value={vitalsForm.weight_kg || ''}
              onChange={(e) => setVitalsForm(prev => ({ ...prev, weight_kg: e.target.value }))}
              className="flex-1 px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              placeholder={vitalsForm.weight_unit === 'kg' ? '68' : vitalsForm.weight_unit === 'stone' ? '11.7' : '150'}
            />
            <select
              value={vitalsForm.weight_unit}
              onChange={(e) => {
                const newUnit = e.target.value as 'lbs' | 'kg' | 'stone';
                // Just change the unit, don't convert the value
                setVitalsForm(prev => ({ 
                  ...prev, 
                  weight_unit: newUnit
                }));
              }}
              className="px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            >
              <option value="lbs">lbs</option>
              <option value="kg">kg</option>
              <option value="stone">stone</option>
            </select>
          </div>
          <p className="mt-1 text-xs text-muted">
            {vitalsForm.weight_unit === 'stone' ? 'Enter as stone.pounds (e.g., 11.7 = 11 stone 7 lbs)' : 
             vitalsForm.weight_unit === 'kg' ? 'Enter weight in kilograms' : 
             'Enter weight in pounds'}
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="dob" className="block text-sm font-medium text-secondary mb-1">
          Date of Birth
        </label>
        <input
          id="dob"
          type="date"
          value={vitalsForm.dob || ''}
          onChange={(e) => setVitalsForm(prev => ({ ...prev, dob: e.target.value }))}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
      </div>

      <div>
        <label htmlFor="location" className="block text-sm font-medium text-secondary mb-1">
          Location
        </label>
        <input
          id="location"
          type="text"
          value={vitalsForm.location || ''}
          onChange={(e) => setVitalsForm(prev => ({ ...prev, location: e.target.value }))}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          placeholder="City, State"
        />
      </div>

      <div>
        <label htmlFor="class_year" className="block text-sm font-medium text-secondary mb-1">
          Class Year
        </label>
        <input
          id="class_year"
          type="number"
          min="2020"
          max="2040"
          value={vitalsForm.class_year || ''}
          onChange={(e) => setVitalsForm(prev => ({ ...prev, class_year: e.target.value }))}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          placeholder="2025"
        />
      </div>
    </div>
  );

  /**
   * One sport tab, rendered from its schema. Sports without a schema get an
   * explicit "coming soon" panel — never a blank one.
   */
  const renderSportTab = (sportKey: SportKey) => {
    const schema = getSportSettingsSchema(sportKey);
    const sportDef = getSportDefinition(sportKey);
    const label = TABS.find(t => t.id === sportKey)?.label || sportDef.display_name;

    if (!schema) {
      return (
        <div className="text-center py-12 text-muted">
          <i className={`${sportDef.icon_id} text-4xl text-gray-300 mb-4`} aria-hidden="true"></i>
          <h3 className="text-lg font-medium mb-2">{label} Settings</h3>
          <p>{getComingSoonMessage(sportKey, 'settings')}</p>
          <div className="mt-4 px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md inline-block">
            <div className="flex items-center justify-center">
              <i className="fas fa-clock text-amber-600 dark:text-amber-400 mr-2" aria-hidden="true"></i>
              <span className="text-sm text-amber-800 dark:text-amber-200 font-medium">{COPY.TABS.COMING_SOON_INDICATOR}</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <SportSettingsForm
        schema={schema}
        values={sportSettings[sportKey] ?? emptySettingsValues(schema)}
        errors={errors}
        onChange={(fieldKey, value) => setSportField(sportKey, fieldKey, value)}
        disabled={isSubmitting}
      />
    );
  };

  const renderSocialsTab = () => (
    <div className="space-y-6">
      <div>
        <label htmlFor="twitter" className="block text-sm font-medium text-secondary mb-1">
          <i className="fa-brands fa-x-twitter text-primary mr-2" aria-hidden="true"></i>
          X Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted text-sm">@</span>
          <input
            id="twitter"
            type="text"
            value={socialsForm.social_twitter || ''}
            onChange={(e) => setSocialsForm(prev => ({ ...prev, social_twitter: e.target.value }))}
            className="w-full pl-8 pr-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="username"
          />
        </div>
      </div>

      <div>
        <label htmlFor="instagram" className="block text-sm font-medium text-secondary mb-1">
          <i className="fab fa-instagram text-pink-500 mr-2" aria-hidden="true"></i>
          Instagram Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted text-sm">@</span>
          <input
            id="instagram"
            type="text"
            value={socialsForm.social_instagram || ''}
            onChange={(e) => setSocialsForm(prev => ({ ...prev, social_instagram: e.target.value }))}
            className="w-full pl-8 pr-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="username"
          />
        </div>
      </div>

      <div>
        <label htmlFor="tiktok" className="block text-sm font-medium text-secondary mb-1">
          <i className="fa-brands fa-tiktok text-primary mr-2" aria-hidden="true"></i>
          TikTok Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted text-sm">@</span>
          <input
            id="tiktok"
            type="text"
            value={socialsForm.social_tiktok || ''}
            onChange={(e) => setSocialsForm(prev => ({ ...prev, social_tiktok: e.target.value }))}
            className="w-full pl-8 pr-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="username"
          />
        </div>
      </div>

      <div>
        <label htmlFor="facebook" className="block text-sm font-medium text-secondary mb-1">
          <i className="fab fa-facebook text-brand-fg mr-2" aria-hidden="true"></i>
          Facebook Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted text-sm">@</span>
          <input
            id="facebook"
            type="text"
            value={socialsForm.social_facebook || ''}
            onChange={(e) => setSocialsForm(prev => ({ ...prev, social_facebook: e.target.value }))}
            className="w-full pl-8 pr-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="username"
          />
        </div>
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'basic':
        return renderBasicTab();
      case 'vitals':
        return renderVitalsTab();
      case 'socials':
        return renderSocialsTab();
      default:
        // Every remaining tab is a sport tab, rendered from its schema.
        // This used to be `return null`, which is exactly why basketball,
        // soccer and baseball rendered an empty panel.
        return isSportTab(activeTab) ? renderSportTab(activeTab) : null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50" aria-labelledby="edit-profile-title" role="dialog" aria-modal="true">
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <div className="flex items-center justify-center h-full p-4">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-gray-500/75 transition-opacity" 
          aria-hidden="true"
          onClick={requestClose}
        ></div>

        {/* Modal */}
        {/*
          `relative z-10` is LOAD-BEARING, not styling. The backdrop above is
          a `fixed` sibling, so it is painted in the positioned layer; this
          panel was `position: static` and therefore painted UNDER it. Every
          click inside the modal — tabs, inputs, Save — landed on the backdrop
          and closed the modal instead.

          It used to work by accident: Tailwind v3's `transform` utility always
          emitted a transform, which creates a stacking context. Under
          Tailwind v4 (see package.json) `transform` computes to `none`, so the
          accident stopped happening and the modal became unusable. Verified in
          production August 2026 via elementFromPoint at a tab's centre.

          Do not remove without checking `document.elementFromPoint` over a tab.
        */}
        <div className="relative z-10 flex w-full max-h-modal flex-col bg-surface-raised rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:max-w-4xl">
          {/* Header */}
          <div className="shrink-0 bg-surface-raised px-4 pt-5 pb-4 sm:px-6 sm:pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 id="edit-profile-title" className="text-lg font-medium text-primary">
                Edit Profile
              </h2>
              {/* No focus:ring override — the global :focus-visible ring owns
                  focus styling. */}
              <button
                onClick={requestClose}
                className="ea-icon-btn inline-flex items-center justify-center text-faint hover:text-muted"
                aria-label="Close modal"
              >
                <i className="fas fa-times text-lg" aria-hidden="true"></i>
              </button>
            </div>

            {/* Tabs. One scrollable row (ProfileMediaTabs pattern), not
                flex-wrap: 15 tabs wrapped to ~6 rows of chrome at 320px and
                pushed the form below the fold. Edge fades signal the
                off-screen tabs below md. */}
            <div className="border-b border-border relative">
              <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-surface-raised to-transparent z-10 pointer-events-none md:hidden" />
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface-raised to-transparent z-10 pointer-events-none md:hidden" />
              <nav className="-mb-px flex gap-x-5 overflow-x-auto scrollbar-hide" aria-label="Profile sections">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => tab.enabled && setActiveTab(tab.id)}
                    className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap shrink-0 transition-colors ${
                      !tab.enabled
                        ? 'border-transparent text-faint cursor-not-allowed'
                        : activeTab === tab.id
                        ? 'border-violet-500 text-brand-fg'
                        : 'border-transparent text-muted hover:text-secondary hover:border-border-strong'
                    }`}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    disabled={!tab.enabled}
                    title={tab.comingSoon ? COPY.COMING_SOON.SPORT_GENERAL : undefined}
                  >
                    <i className={`${tab.icon} mr-2`} aria-hidden="true"></i>
                    {tab.label}
                    {tab.comingSoon && (
                      <span className="ml-1 text-xs text-faint">{COPY.TABS.COMING_SOON_INDICATOR}</span>
                    )}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Tab Content — the panel's ONLY scroll area. It used to be a hard
              max-h-96 box, which pushed the footer below the fold on short
              phones; now the bounded panel keeps Save/Cancel always visible. */}
          <div className="flex-1 min-h-0 overflow-y-auto bg-surface-muted px-4 py-6 sm:px-6">
            {renderTabContent()}
          </div>

          {/* Footer */}
          <div className="shrink-0 bg-surface-muted px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              onClick={() => saveTab(activeTab)}
              disabled={isSubmitting}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-brand text-base font-medium text-white hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>
                  Saving...
                </>
              ) : (
                <>
                  <i className="fas fa-save mr-2" aria-hidden="true"></i>
                  Save {TABS.find(t => t.id === activeTab)?.label}
                </>
              )}
            </button>
            <button
              onClick={requestClose}
              className="mt-3 w-full inline-flex justify-center rounded-md border border-border-strong shadow-sm px-4 py-2 bg-surface text-base font-medium text-secondary hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}