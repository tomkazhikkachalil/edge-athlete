'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

// ── The ONE Edit Profile pop-up for the signed-in account (Oct 2 2026) ──────
// Tom: choosing Edit Profile from the top menu took him to his profile page,
// where he had to choose it a second time. The editor is a pop-up that each
// page had to mount for itself, and only three of ~65 pages that render the
// header did — everywhere else the menu entry fell back to a plain navigation
// to /athlete.
//
// So the editor is mounted ONCE, here, at the app root (the tab bar's and the
// chat dock's pattern), and anything may open it over the page the user is on:
//
//   const editProfile = useEditProfile();
//   editProfile.open();          // or .open('vitals') for a starting tab
//
// It is the editor for the ACCOUNT'S OWN profile. Two doors stay their own on
// purpose: the profile page (/athlete — it reloads its own data after a save
// and owns the ?edit=sport deep link) and the guardian's athlete page (a
// different profile, `targetProfileId`).
//
// Mounted at the root it also sits outside the header, which is backdrop-blur:
// a `fixed` pop-up inside it would be clipped to the header's own box.

const loadEditor = () => import('@/components/EditProfileTabs');
// ~1,000 lines: fetched on the first open (or by preload), never on page load.
const EditProfileTabs = dynamic(loadEditor, { ssr: false });

interface EditProfileApi {
  /** Open the editor over the current page. `tab` is an EditProfileTabs tab id. */
  open: (tab?: string) => void;
  /** Fetch the editor's code ahead of the tap (a menu that offers it just opened). */
  preload: () => void;
}

const NOOP: EditProfileApi = { open: () => {}, preload: () => {} };
const EditProfileContext = createContext<EditProfileApi>(NOOP);

export function useEditProfile(): EditProfileApi {
  return useContext(EditProfileContext);
}

export function EditProfileProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<string | undefined>(undefined);
  // Nothing of the editor renders (so nothing is fetched) until it is first wanted.
  const [wanted, setWanted] = useState(false);

  // A root-mounted pop-up outlives the page under it: when the route changes
  // (Back, a link behind it, a redirect) it closes rather than follow the user
  // to another page. Render-phase state sync — the house idiom.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (isOpen) setIsOpen(false);
  }

  const open = useCallback((startTab?: string) => {
    setTab(startTab);
    setWanted(true);
    setIsOpen(true);
  }, []);
  const preload = useCallback(() => {
    void loadEditor();
  }, []);
  const api = useMemo(() => ({ open, preload }), [open, preload]);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <EditProfileContext.Provider value={api}>
      {children}
      {wanted && user && (
        <EditProfileTabs
          isOpen={isOpen}
          onClose={close}
          profile={profile}
          initialTab={tab}
          // The modal has already re-read the shared profile (useAuth) by the
          // time it reports a save, so every screen reading it has followed.
          onSave={close}
        />
      )}
    </EditProfileContext.Provider>
  );
}
