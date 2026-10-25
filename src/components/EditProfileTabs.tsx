'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from './Toast';
import LazyImage from './LazyImage';
import ProfilePhotoDoor from './profile/ProfilePhotoDoor';
import { profilePhotoFormData } from '@/lib/profiles/photo-upload-client';
import type { ProfilePhotoPayload } from '@/lib/profiles/photo-recipe';
import { PHOTO_SLOTS } from './profile/ProfilePhotoUploader';
import { coverProxyUrl } from '@/lib/media/cover-url';
import type { ProfilePhotoSlot } from '@/lib/profiles/photo-paths';
import type { Profile } from '@/lib/supabase';
import RecruitingFields from '@/components/recruiting/RecruitingFields';
import {
  UNSEEDED,
  formsFromProfile,
  justOpened,
  recruitingAcademics,
  seedKeyChanged,
  shouldSeed,
  type SeedKey,
} from '@/lib/profiles/edit-forms';
import { getSportDefinition, getAllSports, type SportKey } from '@/lib/sports';
import { resolveSportKey } from '@/lib/sports/resolve-sport-key';
import {
  getSportSettingsSchema,
  settingsToFormValues,
  formValuesToSettings,
  mergeSettingsForSave,
  validateSettingsValues,
  emptySettingsValues,
  type SettingsFormValues,
} from '@/lib/sports/settings-schemas';
import SportSetupFlow, { type SportSetupSaveResult } from './SportSetupFlow';
import { summaryLine } from '@/lib/sports/settings-steps';
import SportMultiSelect from './SportMultiSelect';
import { COPY } from '@/lib/copy';
import ConfirmModal from './ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { GENDERS, GENDER_LABEL, NICKNAME_MAX, PHONE_MAX, POSTAL_CODE_MAX } from '@/lib/profiles/private-details';
import { localDayKey } from '@/lib/calendar/grid';
import PlacePicker from '@/components/PlacePicker';
import { placeToProfileFields } from '@/lib/geo/profile-place';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import {
  getInitials,
  validateHeight
} from '@/lib/formatters';

interface EditProfileTabsProps {
  isOpen: boolean;
  onClose: () => void;
  profile: Profile | null;
  onSave: () => void;
  /** Round H acting-as: a guardian editing their managed athlete. When set,
   *  every save (profile PUT, handle, avatar) targets this profile, and the
   *  sport tabs + sports picker + visibility toggle are hidden — sports are
   *  session-anchored surfaces and safety posture belongs to the console. */
  targetProfileId?: string;
  /** Deep-link tab (e.g. /athlete?edit=sport → the primary sport tab).
   *  Applied on the open transition only; invalid or hidden ids fall back to
   *  the default 'basic'. */
  initialTab?: string;
  /** Convention 52 (Oct 25 2026): a tab's Save also closes the editor — through
   *  requestClose, so typing left unsaved on ANOTHER tab gets the discard
   *  prompt instead of vanishing. The root host closes in its own onSave. */
  closeOnSave?: boolean;
}

/**
 * Five fixed tabs (Program D, Oct 2026). There used to be ONE TAB PER
 * REGISTERED SPORT (≈ 15, every sport in the app, most of them not the
 * athlete's); the Sports tab now holds the picker and a row per sport the
 * athlete plays, each opening its setup as short steps (SportSetupFlow).
 */
type TabId = 'basic' | 'sports' | 'body_metrics' | 'socials' | 'recruiting';

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
    // Your sports + each sport's setup (Program D): the picker moved here from Basic.
    { id: 'sports', label: 'Sports', icon: 'fas fa-medal', enabled: true },
    // Height, weight, grad year… — "Body Metrics" since Oct 14 2026 (it was
    // "Training"; Training is the workouts + activities section).
    { id: 'body_metrics', label: 'Body Metrics', icon: 'fas fa-chart-line', enabled: true },
    { id: 'socials', label: 'Socials', icon: 'fas fa-share-alt', enabled: true },
    // Recruiting: the one gate + school / GPA / notes. Shown only to a
    // guardian acting as a supervised athlete (Oct 4 2026) — the athlete's
    // own door is Settings → Recruiting.
    { id: 'recruiting', label: 'Recruiting', icon: 'fas fa-graduation-cap', enabled: true },
  ];

  // NOTE: there is deliberately no Equipment tab here. Gear is a first-class
  // sport-agnostic feature backed by `athlete_equipment` (profile Equipment
  // tab, `AddEquipmentModal`). This modal used to carry a second, golf-only
  // equipment form that wrote driver/irons/putter fields into
  // `sport_settings` — values no surface ever read back. Removed August 2026.

  return baseTabs;
};

/** Snapshot key for one sport's dirty-close baseline. */
const sportSnapKey = (sportKey: SportKey) => `settings:${sportKey}`;

const TABS = generateTabs();

export default function EditProfileTabs({
  isOpen,
  onClose,
  profile,
  onSave,
  targetProfileId,
  initialTab,
  closeOnSave = false
}: EditProfileTabsProps) {
  const { user, refreshProfile } = useAuth();
  const { showError } = useToast();
  const actingAs = !!targetProfileId;
  // The visibility toggle is honest only for unsupervised self-edits: the
  // server strips it for supervised profiles (child AND guardian — safety
  // posture lives on the guardian console's Safety card).
  const hideVisibility = actingAs || profile?.supervision_state === 'supervised';
  // The private sign-up details (nickname, phone, gender, postal code) are
  // the account holder's own: never in acting-as, never on a supervised
  // profile (the server strips them there too).
  const showPrivateDetails = !actingAs && profile?.supervision_state !== 'supervised';
  // Recruiting (Oct 4 2026): the athlete's door is Settings → Recruiting; this
  // dialog carries the tab only for a guardian acting as a supervised athlete
  // (recruiting is the guardian's decision there).
  // Acting-as never edits sports (/api/sport-settings is session-anchored: it would write the GUARDIAN's own).
  const visibleTabs = TABS.filter(t => (actingAs ? t.id !== 'sports' : true) && (t.id !== 'recruiting' || actingAs));
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The editor stays open after a save (the host decides), so the result has
  // to show HERE: the Save button reads "Saved" for a moment (Oct 15 2026 —
  // no banner; a visible result is the confirmation).
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(t);
  }, [justSaved]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form states — the empty forms (never undefined: controlled inputs). The
  // seeding block below fills them; shapes and the fill live in
  // `src/lib/profiles/edit-forms.ts`.
  const [basicForm, setBasicForm] = useState(() => formsFromProfile(null).basic);

  // Sport selection (order matters: first = primary). initialSports is the
  // loaded baseline for diffing adds/removes on save.
  const [selectedSports, setSelectedSports] = useState<SportKey[]>([]);
  const [initialSports, setInitialSports] = useState<SportKey[]>([]);
  // The selection is loaded asynchronously (the effect below). Until it has
  // landed, an EMPTY selection means "not loaded", not "no sports": a Basic
  // save in that window used to send `sport: ''` and clear the primary sport
  // (caught on WebKit by e2e/edit-profile.spec.ts, Sep 30 2026).
  const [sportsLoaded, setSportsLoaded] = useState(false);

  const [bodyMetricsForm, setBodyMetricsForm] = useState(() => formsFromProfile(null).bodyMetrics);

  const [socialsForm, setSocialsForm] = useState(() => formsFromProfile(null).socials);

  // Recruiting (R1): saved through its own gated route, never the profile PUT.
  const [recruitingForm, setRecruitingForm] = useState(() => formsFromProfile(null).recruiting);
  // Acting-as only: the profile GET strips `recruiting_profile` for a
  // non-owner, so the academics arrive from the recruiting GET (effect
  // below). Until they do, a Recruiting save would null them — Save waits.
  const [academicsReady, setAcademicsReady] = useState(true);

  // Bumped by every seed; the dirty-close baselines and the acting-as
  // academics load key on it.
  const [seedVersion, setSeedVersion] = useState(0);

  // Fill the forms when the modal OPENS, and when the profile it edits
  // becomes a different profile — never on a same-profile refresh while open
  // (a save's refresh, the token refresh), which used to wipe unsaved typing
  // in the other tabs. The tracker starts at a SENTINEL, not the mount-time
  // props: every host mounts this modal with the profile already loaded, and
  // a tracker that started equal to it never filled anything (Sep 30 2026 —
  // Edit Profile opened blank on production; the deep-link tab was lost the
  // same way). Render-phase state sync (house idiom), so neither the empty
  // form nor the 'basic' tab paints for a frame.
  const seedKey: SeedKey = { isOpen, profileId: profile?.id ?? null };
  const [syncedSeed, setSyncedSeed] = useState<SeedKey>(UNSEEDED);
  if (seedKeyChanged(syncedSeed, seedKey)) {
    setSyncedSeed(seedKey);
    // Deep-link tab, on the open transition only.
    if (justOpened(syncedSeed, seedKey) && initialTab && visibleTabs.some(t => t.id === initialTab && t.enabled)) {
      setActiveTab(initialTab as TabId);
    }
    if (shouldSeed(syncedSeed, seedKey)) {
      const loaded = formsFromProfile(profile);
      setBasicForm(loaded.basic);
      setBodyMetricsForm(loaded.bodyMetrics);
      setSocialsForm(loaded.socials);
      setRecruitingForm(loaded.recruiting);
      setAcademicsReady(!actingAs);
      setSeedVersion(v => v + 1);
      // Sport settings come from /api/sport-settings (the effects below).
    }
  }

  // One entry per sport that has a settings schema, keyed by sport key.
  // Replaces the old hand-written `golfForm`/`equipmentForm` pair — every
  // sport's tab now reads and writes through this single map.
  const [sportSettings, setSportSettings] = useState<Partial<Record<SportKey, SettingsFormValues>>>({});

  // The settings objects exactly as stored, kept so a save can preserve keys
  // no schema declares (see `mergeSettingsForSave`). Held in a ref because
  // nothing renders from it.
  const storedSportSettingsRef = useRef<Partial<Record<SportKey, Record<string, unknown>>>>({});

  // Dirty-close support: per-group snapshots of the last loaded/saved
  // values (loads write them directly with local values; successful tab
  // saves refresh their own group). Save is per-tab, so edits in OTHER
  // tabs must survive a save and still count as unsaved on close.
  const snapRef = useRef<Record<string, string>>({});
  const serializeGroup = {
    basic: () => JSON.stringify({ ...basicForm, avatar_photo: basicForm.avatar_photo?.file.name ?? null, cover_photo: basicForm.cover_photo?.file.name ?? null }),
    sports: () => JSON.stringify(selectedSports),
    bodyMetrics: () => JSON.stringify(bodyMetricsForm),
    socials: () => JSON.stringify(socialsForm),
    recruiting: () => JSON.stringify(recruitingForm),
  } as const;

  // Sport settings are snapshotted PER SPORT, not as one blob: saving golf
  // must not mark unsaved basketball edits as clean.
  const serializeSportSettings = (sportKey: SportKey) =>
    JSON.stringify(sportSettings[sportKey] ?? {});

  type GroupKey = keyof typeof serializeGroup;
  /** Dirty anywhere — or, with `except`, anywhere OUTSIDE that group. The
   *  save path asks the second question: the group just saved is clean by
   *  definition, and its state in this closure may still be the pre-save
   *  shape (a pending photo cleared by a setState that has not rendered). */
  const isDirtyOutside = (except?: GroupKey) => {
    const staticDirty = (Object.keys(serializeGroup) as GroupKey[]).some(
      key => key !== except && snapRef.current[key] !== undefined && snapRef.current[key] !== serializeGroup[key]()
    );
    if (staticDirty) return true;

    return (Object.keys(sportSettings) as SportKey[]).some(sportKey => {
      const snapshot = snapRef.current[sportSnapKey(sportKey)];
      return snapshot !== undefined && snapshot !== serializeSportSettings(sportKey);
    });
  };
  const isDirty = () => isDirtyOutside();
  const GROUP_OF_TAB: Record<TabId, GroupKey> = { basic: 'basic', sports: 'sports', body_metrics: 'bodyMetrics', socials: 'socials', recruiting: 'recruiting' };
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
        setSportsLoaded(true);
        snapRef.current.sports = JSON.stringify(ordered);
      } catch (e) {
        console.error('Error loading sports:', e);
      }
    };
    loadSports();
  }, [user?.id, profile?.sport]);

  // No conversion - save exactly what user enters

  // Dirty-close baselines are written to a REF, which must not happen during
  // render. This effect runs right after a seeding render (the block near the
  // top bumps `seedVersion`), so it snapshots exactly the values that were
  // just applied.
  useEffect(() => {
    snapRef.current.basic = JSON.stringify({ ...basicForm, avatar_photo: null, cover_photo: null });
    snapRef.current.bodyMetrics = JSON.stringify(bodyMetricsForm);
    snapRef.current.socials = JSON.stringify(socialsForm);
    snapRef.current.recruiting = JSON.stringify(recruitingForm);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the seed, not on every keystroke
  }, [seedVersion]);

  // Acting-as: load the athlete's academics from the recruiting GET (the
  // guardian is `canEdit` there). Without this the Recruiting tab opened
  // with GPA / notes / level blank and a save wrote the blanks —
  // `recruitingPatchToUpdate` merges explicit nulls over the stored values.
  useEffect(() => {
    if (!isOpen || !targetProfileId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/profile/${targetProfileId}/recruiting`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.canEdit) return;
        const academics = recruitingAcademics(data.profile);
        setRecruitingForm(prev => ({ ...prev, ...academics }));
        // The loaded academics are the baseline, not an unsaved edit (same
        // key order as the form, so the dirty comparison holds).
        const baseline = snapRef.current.recruiting ? JSON.parse(snapRef.current.recruiting) : {};
        snapRef.current.recruiting = JSON.stringify({ ...baseline, ...academics });
        setAcademicsReady(true);
      } catch {
        // Save stays disabled; reopening retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, targetProfileId, seedVersion]);

  // B8 (Sep 2026): removing a sport DELETES its sport_settings row — an
  // accidental uncheck silently loses per-sport settings and drops the
  // sport from the profile surface, so removal is confirm-gated (the
  // dummy-proofing severity-A convention). The ref, not state, carries
  // the confirmation into the immediate saveTab re-call.
  const [confirmRemoveSports, setConfirmRemoveSports] = useState<SportKey[] | null>(null);
  const sportRemovalOkRef = useRef(false);

  const saveTab = async (tabId: TabId) => {
    if (!user?.id) {
      showError('Authentication Error', 'Please log in again.');
      return;
    }
    if (tabId === 'sports' && !actingAs && !sportRemovalOkRef.current) {
      const removed = initialSports.filter(k => !selectedSports.includes(k));
      if (removed.length > 0) {
        setConfirmRemoveSports(removed);
        return;
      }
    }

    setIsSubmitting(true);
    setErrors({});

    // Body Metrics only: the viewer's local day, sent beside the payload when a
    // height or weight changed (the server appends the timeline entry).
    let measuredOn: string | undefined;

    // `wrote`: something reached the server (even if a later step failed) —
    // the shared profile is re-read either way. `saved`: the whole tab saved
    // — the host is told. Both are settled in `finally`.
    let wrote = false;
    let saved = false;

    try {
      // Values may also be '' — the server's clear-to-null convention
      let updateData: Record<string, unknown> = {};
      let hasChanges = false;

      switch (tabId) {
        case 'basic':
          // Handle avatar upload if present
          if (basicForm.avatar_photo) {
            await uploadProfilePhoto('avatar', basicForm.avatar_photo);
            wrote = true;
            // Uploaded: a later save must not send the same file again.
            setBasicForm(prev => ({ ...prev, avatar_photo: null }));
          }
          if (basicForm.cover_photo) {
            await uploadProfilePhoto('cover', basicForm.cover_photo);
            wrote = true;
            setBasicForm(prev => ({ ...prev, cover_photo: null }));
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
                body: JSON.stringify({
                  handle: newHandle,
                  ...(targetProfileId ? { targetProfileId } : {}),
                }),
              });
              if (!handleRes.ok) {
                const err = await handleRes.json();
                // 400s from this route carry {success, message} (e.g. the
                // supervised PII guard) — err.error alone lost that copy.
                throw new Error(err.message || err.error || 'Failed to update handle');
              }
              wrote = true;
            }
          }

          // Empty strings are sent intentionally — the server converts '' to
          // null, which is the only way a user can CLEAR a field. (Sending
          // `undefined` drops the key from JSON and the value can never be
          // emptied.)
          updateData = {
            first_name: basicForm.first_name.trim(),
            middle_name: basicForm.middle_name.trim(),
            last_name: basicForm.last_name.trim(),
            // full_name / display_name are NOT sent: the server derives them
            // from the name parts (src/lib/profiles/derive-names.ts). Sending
            // the loaded full_name back is what kept the old name alive.
            bio: basicForm.bio.trim(),
            ...(showPrivateDetails
              ? {
                  nickname: basicForm.nickname.trim(),
                  phone: basicForm.phone.trim(),
                  gender: basicForm.gender,
                  postal_code: basicForm.postal_code.trim(),
                }
              : {}),
            ...(hideVisibility ? {} : { visibility: basicForm.visibility }),
            // The sports choice (and the primary) saves from the Sports tab (Program D).
          };
          hasChanges = true;
          break;

        case 'sports': {
          // Sport selection: primary → profiles.sport (display name; '' clears);
          // added sports get an empty sport_settings row, removed sports lose
          // theirs. Diffed against the loaded baseline. Never in acting-as
          // mode (the tab is hidden there) and never before the selection
          // has loaded (see sportsLoaded).
          if (actingAs || !sportsLoaded) return;
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
          if (added.length > 0 || removed.length > 0) wrote = true;
          setInitialSports(selectedSports);
          updateData = { sport: selectedSports[0] ? getSportDefinition(selectedSports[0]).display_name : '' };
          hasChanges = true;
          break;
        }

        case 'body_metrics':
          // Save body metrics
          // Validate height
          const heightValidation = validateHeight(bodyMetricsForm.height_cm);
          if (bodyMetricsForm.height_cm.trim() && heightValidation.error) {
            throw new Error(`Height: ${heightValidation.error}`);
          }
          
          // Save weight display value exactly as entered
          let weightDisplay: number | undefined;
          if (bodyMetricsForm.weight_kg && bodyMetricsForm.weight_kg.trim()) {
            weightDisplay = parseFloat(bodyMetricsForm.weight_kg);
            // Save weight with unit
            if (isNaN(weightDisplay) || weightDisplay <= 0) {
              throw new Error(`Please enter a valid weight`);
            }
          } else {
            // Clear weight if no value
            weightDisplay = undefined;
          }
          
          // Height and weight are sent only when their INPUT changed from
          // the loaded / last-saved value: an untouched 5'10" would otherwise
          // round-trip through centimetres on every save, and the server
          // adds a body-metrics timeline entry for each value it is sent that
          // differs from the stored one.
          const loadedBodyMetrics = snapRef.current.bodyMetrics
            ? (JSON.parse(snapRef.current.bodyMetrics) as typeof bodyMetricsForm)
            : null;
          const heightChanged = !loadedBodyMetrics || loadedBodyMetrics.height_cm !== bodyMetricsForm.height_cm;
          const weightChanged =
            !loadedBodyMetrics ||
            loadedBodyMetrics.weight_kg !== bodyMetricsForm.weight_kg ||
            loadedBodyMetrics.weight_unit !== bodyMetricsForm.weight_unit;
          if (heightChanged || weightChanged) measuredOn = localDayKey(new Date());

          // Empty strings intentional — server converts '' to null (clears)
          updateData = {
            ...(heightChanged ? { height_cm: heightValidation.value ?? '' } : {}),
            ...(weightChanged
              ? { weight_display: weightDisplay ?? '', weight_unit: bodyMetricsForm.weight_unit || 'lbs' }
              : {}),
            dob: bodyMetricsForm.dob || '',
            location: bodyMetricsForm.location.trim(),
            // A picked place writes the structured columns (names + ISO
            // codes + coords); free text clears them so search never keeps
            // a stale city behind an edited string.
            ...placeToProfileFields(bodyMetricsForm.place),
            class_year: bodyMetricsForm.class_year ? parseInt(String(bodyMetricsForm.class_year)) : '',
          };
          // Update body metrics in database
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

        case 'recruiting': {
          // Its own gated route (manage_settings): the status, the school and
          // the academics — never the batched profile PUT.
          const gpaRaw = recruitingForm.gpa.trim();
          const gpa = gpaRaw === '' ? null : Number(gpaRaw);
          if (gpa !== null && (!Number.isFinite(gpa) || gpa < 0 || gpa > 5)) {
            throw new Error('GPA must be between 0 and 5');
          }
          const res = await fetch(`/api/profile/${targetProfileId ?? user.id}/recruiting`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: recruitingForm.status,
              school: recruitingForm.school.trim(),
              profile: {
                gpa,
                academic_notes: recruitingForm.academic_notes.trim() || null,
                target_level: recruitingForm.target_level || null,
              },
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to save recruiting details');
          }
          wrote = true;
          saved = true;
          snapRef.current.recruiting = JSON.stringify(recruitingForm);
          return;
        }

        default:
          throw new Error(`No save handler for tab: ${tabId}`);
      }

      if (hasChanges) {
        const response = await fetch('/api/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            profileData: updateData,
            userId: user.id,
            ...(targetProfileId ? { targetProfileId } : {}),
            ...(measuredOn ? { measured_on: measuredOn } : {}),
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save changes');
        }

        await response.json();
        wrote = true;
        saved = true;

        // Only the SAVED tab's group becomes clean. This used to refresh all
        // three snapshots, so saving Training marked unsaved Basic edits as
        // saved and the modal closed on them without asking.
        if (tabId === 'basic') {
          snapRef.current.basic = JSON.stringify({ ...basicForm, avatar_photo: null, cover_photo: null });
        } else if (tabId === 'sports') {
          snapRef.current.sports = serializeGroup.sports();
        } else if (tabId === 'body_metrics') {
          snapRef.current.bodyMetrics = serializeGroup.bodyMetrics();
        } else if (tabId === 'socials') {
          snapRef.current.socials = serializeGroup.socials();
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save changes';
      showError('Save Failed', message);
      
      // Set field-specific errors if needed — the UI reads errors.handle
      if (message.toLowerCase().includes('username') || message.toLowerCase().includes('handle')) {
        setErrors({ handle: message });
      }
    } finally {
      sportRemovalOkRef.current = false;
      // The shared profile (useAuth) is what the header, the chat dock, the
      // feed card, /athlete and Settings render — re-read it HERE so no host
      // can forget to. Three of them used to close under a comment saying
      // useAuth refreshes itself; it does not. Acting-as edits someone else:
      // that host re-reads the athlete in its onSave.
      if (wrote && !actingAs) await refreshProfile();
      setIsSubmitting(false);
      if (saved) {
        setJustSaved(true);
        onSave();
        // Save returns to the profile (Convention 52). The group just saved
        // is clean by definition; if ANOTHER tab still holds unsaved typing
        // the discard prompt asks first (requestClose), else a plain close —
        // the hook's own rule: never confirm after a clean save.
        if (closeOnSave) {
          if (isDirtyOutside(GROUP_OF_TAB[tabId])) requestClose();
          else onClose();
        }
      }
    }
  };

  // A sport's setup (Program D): the ONE save — validate → merge → PUT —
  // then this editor's values and that sport's dirty snapshot follow, so the
  // editor's own isDirty stays truthful. The flow never writes on its own.
  const [setupSport, setSetupSport] = useState<SportKey | null>(null);
  const saveSportSetup = async (sportKey: SportKey, values: SettingsFormValues): Promise<SportSetupSaveResult> => {
    const schema = getSportSettingsSchema(sportKey);
    if (!schema) return { ok: false, errors: {}, message: 'Nothing to set up yet.' };
    const fieldErrors = validateSettingsValues(schema, values);
    if (Object.keys(fieldErrors).length > 0) return { ok: false, errors: fieldErrors, message: Object.values(fieldErrors)[0] };
    const merged = mergeSettingsForSave(schema, storedSportSettingsRef.current[sportKey], values);
    const response = await fetch('/api/sport-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sport: sportKey, settings: merged }),
    });
    if (!response.ok) return { ok: false, errors: {}, message: `Could not save your ${getSportDefinition(sportKey).display_name} setup. Try again.` };
    storedSportSettingsRef.current[sportKey] = merged;
    setSportSettings(prev => ({ ...prev, [sportKey]: values }));
    snapRef.current[sportSnapKey(sportKey)] = JSON.stringify(values);
    setJustSaved(true);
    onSave();
    return { ok: true };
  };

  // The picture and the cover upload the same way (Oct 14 2026): the slot's
  // route and field, the guardian's targetProfileId when acting.
  const uploadProfilePhoto = async (slot: ProfilePhotoSlot, payload: ProfilePhotoPayload) => {
    const def = PHOTO_SLOTS[slot];
    if (payload.file.size > def.maxBytes) throw new Error(`${def.noun} must be less than ${Math.round(def.maxBytes / (1024 * 1024))}MB`);
    const response = await fetch(def.endpoint, { method: 'POST', body: profilePhotoFormData(slot, payload, targetProfileId) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Failed to upload the ${def.noun.toLowerCase()}`);
    }
  };
  const [photoDoor, setPhotoDoor] = useState<ProfilePhotoSlot | null>(null);
  // A pending pick previews as itself (an object URL, revoked on change).
  const [pendingPreview, setPendingPreview] = useState<{ avatar: string | null; cover: string | null }>({ avatar: null, cover: null });
  useEffect(() => {
    const a = basicForm.avatar_photo ? URL.createObjectURL(basicForm.avatar_photo.file) : null;
    const c = basicForm.cover_photo ? URL.createObjectURL(basicForm.cover_photo.file) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the object URLs are the effect's own, revoked below
    setPendingPreview({ avatar: a, cover: c });
    return () => { if (a) URL.revokeObjectURL(a); if (c) URL.revokeObjectURL(c); };
  }, [basicForm.avatar_photo, basicForm.cover_photo]);

  // The name as the form holds it (avatar alt + initials) — the loaded
  // full_name only when both parts are empty.
  const formFullName = `${basicForm.first_name} ${basicForm.last_name}`.trim() || basicForm.full_name;

  const renderBasicTab = () => (
    <div className="space-y-6">
      {/* The two photos (Oct 14 2026): the picture and the cover, each with
          the one door (deferred — uploads on Save) and a preview of the
          pending pick. */}
      <div className="flex items-center gap-4" data-edit-photo="avatar">
        <div className="relative shrink-0">
          {pendingPreview.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL, never remote
            <img src={pendingPreview.avatar} alt="New profile picture" className="w-20 h-20 rounded-full object-cover border-3 border-border-strong" />
          ) : (
            <LazyImage
              src={profile?.avatar_url}
              alt={`${formFullName || 'User'} avatar`}
              className="w-20 h-20 rounded-full object-cover border-3 border-border-strong"
              width={80}
              height={80}
              priority
              fallback={
                <div
                  className="w-20 h-20 rounded-full bg-gray-200 dark:bg-stone-800 flex items-center justify-center border-3 border-border-strong"
                  role="img"
                  aria-label={`${formFullName || 'User'} avatar`}
                >
                  <span className="text-tertiary font-semibold text-xl" aria-hidden="true">
                    {getInitials(formFullName)}
                  </span>
                </div>
              }
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-secondary">Profile picture</p>
          <button type="button" onClick={() => setPhotoDoor('avatar')} className="ea-btn-secondary inline-flex items-center text-sm font-medium mt-1" aria-label="Change profile picture">
            <i className="fas fa-camera mr-2" aria-hidden="true"></i>
            Change profile picture
          </button>
          <p className="mt-1 text-xs text-muted">{basicForm.avatar_photo ? 'Saves with profile.' : 'JPG, PNG, GIF, WebP or HEIC. Max 5MB.'}</p>
        </div>
      </div>
      <div data-edit-photo="cover">
        <p className="text-sm font-semibold text-secondary mb-2">Cover photo</p>
        <div className="w-full max-w-xs aspect-[3/1] rounded-md overflow-hidden border border-border-strong bg-gradient-to-r from-violet-600 via-violet-500 to-purple-500">
          {pendingPreview.cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL, never remote
            <img src={pendingPreview.cover} alt="New cover photo" className="w-full h-full object-cover" />
          ) : profile?.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- the cover proxy's ?v= defeats the optimizer (the header does the same)
            <img src={coverProxyUrl(profile.id, profile.cover_url) ?? undefined} alt="Cover photo" className="w-full h-full object-cover" />
          ) : null}
        </div>
        <button type="button" onClick={() => setPhotoDoor('cover')} className="ea-btn-secondary inline-flex items-center text-sm font-medium mt-2" aria-label="Change cover photo">
          <i className="fas fa-image mr-2" aria-hidden="true"></i>
          Change cover photo
        </button>
        <p className="mt-1 text-xs text-muted">{basicForm.cover_photo ? 'Saves with profile.' : 'A 3:1 banner. Max 10MB.'}</p>
      </div>
      {photoDoor && (
        <ProfilePhotoDoor
          slot={photoDoor}
          hasPhoto={photoDoor === 'avatar' ? !!profile?.avatar_url : !!profile?.cover_url}
          mode="deferred"
          targetProfileId={targetProfileId ?? undefined}
          profileId={targetProfileId ?? profile?.id}
          current={photoDoor === 'avatar'
            ? { photoUrl: profile?.avatar_url ?? null, sourceUrl: profile?.avatar_source_url ?? null, recipe: profile?.avatar_recipe ?? null }
            : { photoUrl: coverProxyUrl(profile?.id, profile?.cover_url), sourceUrl: profile?.cover_source_url ?? null, recipe: profile?.cover_recipe ?? null }}
          onPhotoReady={payload => setBasicForm(prev => (photoDoor === 'avatar' ? { ...prev, avatar_photo: payload } : { ...prev, cover_photo: payload }))}
          onClose={() => setPhotoDoor(null)}
        />
      )}

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

      {/* The private sign-up details. Collected at sign-up; until Sep 30
          2026 no screen showed or edited them again. Owner-only on read. */}
      {showPrivateDetails && (
      <fieldset className="pt-4 border-t border-border">
        <legend className="text-sm font-semibold text-primary">Private details</legend>
        <p className="mt-1 mb-4 text-xs text-muted">
          <i className="fas fa-lock mr-1" aria-hidden="true"></i>
          Only you can see these.
        </p>
        <div className="space-y-4">
          <div>
            <label htmlFor="nickname" className="block text-sm font-medium text-secondary mb-1">
              Nickname <span className="text-faint text-xs">(Optional)</span>
            </label>
            <input
              id="nickname"
              type="text"
              maxLength={NICKNAME_MAX}
              value={basicForm.nickname}
              onChange={(e) => setBasicForm(prev => ({ ...prev, nickname: e.target.value }))}
              className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              placeholder="What people call you"
            />
            <p className="mt-1 text-xs text-muted">
              When set, some screens show it in place of your full name.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-secondary mb-1">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                maxLength={PHONE_MAX}
                value={basicForm.phone}
                onChange={(e) => setBasicForm(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                placeholder="Phone number"
              />
            </div>
            <div>
              <label htmlFor="postal_code" className="block text-sm font-medium text-secondary mb-1">
                Postal code
              </label>
              <input
                id="postal_code"
                type="text"
                autoComplete="postal-code"
                maxLength={POSTAL_CODE_MAX}
                value={basicForm.postal_code}
                onChange={(e) => setBasicForm(prev => ({ ...prev, postal_code: e.target.value }))}
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                placeholder="Postal code"
              />
            </div>
          </div>
          <div>
            <span id="gender-label" className="block text-sm font-medium text-secondary mb-1">Gender</span>
            <div className="flex flex-wrap gap-x-5 gap-y-2" role="radiogroup" aria-labelledby="gender-label">
              {GENDERS.map(g => (
                <label key={g} className="flex min-h-[44px] items-center gap-2 text-sm text-secondary">
                  <input
                    type="radio"
                    name="gender"
                    value={g}
                    checked={basicForm.gender === g}
                    onChange={() => setBasicForm(prev => ({ ...prev, gender: g }))}
                  />
                  {GENDER_LABEL[g]}
                </label>
              ))}
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-secondary">
                <input
                  type="radio"
                  name="gender"
                  value=""
                  checked={basicForm.gender === ''}
                  onChange={() => setBasicForm(prev => ({ ...prev, gender: '' }))}
                />
                Not set
              </label>
            </div>
          </div>
        </div>
      </fieldset>
      )}

      {/* Privacy Toggle — hidden for supervised profiles (child and
          acting-as guardian alike): the server strips visibility there and
          the guardian console's Safety card is the honest control. */}
      {!hideVisibility && (
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
      )}

    </div>
  );

  /**
   * The Sports tab (Program D): the picker (primary first — it drives the
   * profile, feed and composer defaults), then a row per sport the athlete
   * plays with its one-line summary and Set up / Edit → the steps.
   */
  const renderSportsTab = () => (
    <div className="space-y-6" data-sports-tab="">
      {selectedSports.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-secondary mb-2">
            Your sports
          </label>
          <ul className="divide-y divide-border-subtle rounded-lg border border-border" aria-label="Your sports' setup">
            {selectedSports.map(sportKey => {
              const def = getSportDefinition(sportKey);
              const schema = getSportSettingsSchema(sportKey);
              const line = schema ? summaryLine(schema, formValuesToSettings(schema, sportSettings[sportKey] ?? emptySettingsValues(schema))) : '';
              const unsaved = !initialSports.includes(sportKey);
              return (
                <li key={sportKey} className="flex items-center gap-3 px-3 py-3" data-sport-row={sportKey} data-sport-row-state={schema ? (line ? 'set' : 'empty') : 'none'}>
                  <i className={`${def.icon_id} w-6 text-center text-lg text-brand-fg`} aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-primary">
                      {def.display_name}
                      {selectedSports[0] === sportKey && <span className="ml-2 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white align-middle">PRIMARY</span>}
                    </span>
                    <span className="block text-sm text-secondary truncate" data-sport-row-line="">
                      {schema ? (line || (unsaved ? 'Save your sports, then set it up' : 'Not set up yet')) : 'Nothing to set up yet'}
                    </span>
                  </span>
                  {schema && (
                    <button
                      type="button"
                      onClick={() => setSetupSport(sportKey)}
                      disabled={isSubmitting || unsaved}
                      title={unsaved ? 'Save your sports first' : undefined}
                      className="ea-interactive min-h-[44px] rounded-lg border border-border px-3 text-sm font-semibold text-primary disabled:opacity-50"
                      data-sport-setup-open={sportKey}
                    >
                      {line ? 'Edit' : 'Set up'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-secondary mb-2">
          {selectedSports.length > 0 ? 'Add or remove sports' : 'Your sports'}
        </label>
        <SportMultiSelect selected={selectedSports} onChange={setSelectedSports} />
        <p className="mt-2 text-xs text-muted">
          The first is your primary sport. Removing a sport clears its settings. Save Sports keeps the change.
        </p>
      </div>
    </div>
  );

  const renderBodyMetricsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="height" className="block text-sm font-medium text-secondary mb-1">
            Height
          </label>
          <input
            id="height"
            type="text"
            value={bodyMetricsForm.height_cm || ''}
            onChange={(e) => setBodyMetricsForm(prev => ({ ...prev, height_cm: e.target.value }))}
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
              value={bodyMetricsForm.weight_kg || ''}
              onChange={(e) => setBodyMetricsForm(prev => ({ ...prev, weight_kg: e.target.value }))}
              className="flex-1 px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              placeholder={bodyMetricsForm.weight_unit === 'kg' ? '68' : bodyMetricsForm.weight_unit === 'stone' ? '11.7' : '150'}
            />
            <select
              value={bodyMetricsForm.weight_unit}
              onChange={(e) => {
                const newUnit = e.target.value as 'lbs' | 'kg' | 'stone';
                // Just change the unit, don't convert the value
                setBodyMetricsForm(prev => ({ 
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
            {bodyMetricsForm.weight_unit === 'stone' ? 'Enter as stone.pounds (e.g., 11.7 = 11 stone 7 lbs)' : 
             bodyMetricsForm.weight_unit === 'kg' ? 'Enter weight in kilograms' : 
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
          value={bodyMetricsForm.dob || ''}
          onChange={(e) => setBodyMetricsForm(prev => ({ ...prev, dob: e.target.value }))}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
      </div>

      <div>
        <label htmlFor="location" className="block text-sm font-medium text-secondary mb-1">
          Location
        </label>
        <PlacePicker
          id="location"
          value={bodyMetricsForm.place}
          text={bodyMetricsForm.location || ''}
          onChange={(place, text) => setBodyMetricsForm(prev => ({ ...prev, place, location: text }))}
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
          value={bodyMetricsForm.class_year || ''}
          onChange={(e) => setBodyMetricsForm(prev => ({ ...prev, class_year: e.target.value }))}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          placeholder="2025"
        />
      </div>
    </div>
  );

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

  // Recruiting (Oct 4 2026): the fields live in RecruitingFields — the same
  // form Settings → Recruiting renders for the athlete; this dialog shows the
  // tab only to a guardian acting as a supervised athlete.
  const renderRecruitingTab = () => <RecruitingFields value={recruitingForm} onChange={setRecruitingForm} />;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'basic':
        return renderBasicTab();
      case 'sports':
        return renderSportsTab();
      case 'body_metrics':
        return renderBodyMetricsTab();
      case 'socials':
        return renderSocialsTab();
      case 'recruiting':
        return renderRecruitingTab();
      default:
        return null;
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
      <ConfirmModal
        isOpen={confirmRemoveSports !== null}
        title="Remove sports?"
        message={`Removing ${(confirmRemoveSports ?? [])
          .map(k => getSportDefinition(k).display_name)
          .join(', ')} deletes those sports' settings from your profile. This can't be undone.`}
        confirmText="Remove"
        cancelText="Keep them"
        onConfirm={() => {
          sportRemovalOkRef.current = true;
          setConfirmRemoveSports(null);
          void saveTab('sports');
        }}
        onCancel={() => {
          // "I didn't mean to" — put the unchecked sports back.
          setSelectedSports(prev => [
            ...prev,
            ...(confirmRemoveSports ?? []).filter(k => !prev.includes(k)),
          ]);
          setConfirmRemoveSports(null);
        }}
      />
      {setupSport && (() => {
        const schema = getSportSettingsSchema(setupSport);
        return schema ? (
          <SportSetupFlow
            sportKey={setupSport}
            sportName={getSportDefinition(setupSport).display_name}
            schema={schema}
            values={sportSettings[setupSport] ?? emptySettingsValues(schema)}
            onSave={values => saveSportSetup(setupSport, values)}
            onClose={() => setSetupSport(null)}
          />
        ) : null;
      })()}
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
                {actingAs
                  ? `Edit ${profile?.first_name || 'athlete'}'s Profile`
                  : 'Edit Profile'}
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
                {visibleTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => tab.enabled && setActiveTab(tab.id)}
                    className={`min-h-[44px] py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap shrink-0 transition-colors ${
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
            {!actingAs && profile?.supervision_state === 'supervised' && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-violet-200 dark:border-violet-800 bg-brand-soft p-3 text-xs text-violet-900 dark:text-violet-200">
                <i className="fas fa-user-shield mt-0.5" aria-hidden="true"></i>
                <span>Your guardian is notified when you change your profile details.</span>
              </div>
            )}
            {renderTabContent()}
          </div>

          {/* Footer */}
          <div className="shrink-0 bg-surface-muted px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              onClick={() => saveTab(activeTab)}
              disabled={isSubmitting || (activeTab === 'recruiting' && !academicsReady)}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-brand text-base font-medium text-white hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>
                  Saving...
                </>
              ) : justSaved ? (
                <span data-profile-saved="">
                  <i className="fas fa-check mr-2" aria-hidden="true"></i>
                  Saved
                </span>
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