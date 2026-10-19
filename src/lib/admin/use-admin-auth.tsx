'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ADMIN_LOGIN_PATH, type AdminRole } from './session';

/**
 * The console's session on the client (flow changes item 2, B2): ONE probe
 * of GET /api/admin/session per page load, shared by every console page
 * through this provider. The shape mirrors the app's `useAuth()` —
 * `{ user, loading }` — so the moved pages keep their effects; a 401 sends
 * the browser to the login with the current path as `next` and keeps
 * `loading` true meanwhile (a page never sees "signed out" and never
 * redirects to the app on its own).
 */
export interface AdminUser {
  id: string;
  email: string;
  role: AdminRole;
}

interface AdminAuthValue {
  user: AdminUser | null;
  role: AdminRole | null;
  loading: boolean;
}

const Ctx = createContext<AdminAuthValue>({ user: null, role: null, loading: true });

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState<AdminAuthValue>({ user: null, role: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/session', { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401) {
          router.replace(`${ADMIN_LOGIN_PATH}?next=${encodeURIComponent(pathname || '/admin')}`);
          return;
        }
        if (!res.ok) {
          setValue({ user: null, role: null, loading: false });
          return;
        }
        const data = (await res.json()) as { id: string; email: string; role: AdminRole };
        if (cancelled) return;
        setValue({ user: { id: data.id, email: data.email, role: data.role }, role: data.role, loading: false });
      } catch {
        if (!cancelled) setValue({ user: null, role: null, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [router, pathname]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  return useContext(Ctx);
}
