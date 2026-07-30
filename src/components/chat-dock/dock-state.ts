// Chat-dock layout state — pure reducer + persistence serializer, unit
// tested. The dock's DATA all comes from MessagesProvider; this module only
// tracks which windows are open/minimized and whether the panel is
// expanded, and survives refreshes via localStorage (ea:chat-dock:v1).
// Persistence is the product: this state is why a conversation is exactly
// where the user left it after navigation or a reload.

export const DOCK_STORAGE_KEY = 'ea:chat-dock:v1';
export const MAX_OPEN_WINDOWS = 3;
/** px: reserved for the panel + margins; per-window footprint incl. gap. */
const RESERVED_PX = 360;
const WINDOW_PX = 336;

export interface DockState {
  panelOpen: boolean;
  open: string[];      // conversation ids, oldest first; length <= cap
  minimized: string[]; // conversation ids
  cap: number;         // width-aware, in-memory only
}

export const initialDockState: DockState = {
  panelOpen: false,
  open: [],
  minimized: [],
  cap: MAX_OPEN_WINDOWS,
};

export type DockAction =
  | { type: 'OPEN_WINDOW'; id: string }
  | { type: 'CLOSE_WINDOW'; id: string }
  | { type: 'MINIMIZE'; id: string }
  | { type: 'RESTORE'; id: string }
  | { type: 'TOGGLE_PANEL' }
  | { type: 'CLOSE_PANEL' }
  | { type: 'HYDRATE'; state: Pick<DockState, 'panelOpen' | 'open' | 'minimized'> }
  | { type: 'SET_CAP'; cap: number }
  | { type: 'CLEAR_WINDOWS' }
  | { type: 'PRUNE'; validIds: string[] };

/** Width-aware window cap: how many 320px windows fit beside the panel. */
export function windowCapForWidth(viewportWidth: number): number {
  const fit = Math.floor((viewportWidth - RESERVED_PX) / WINDOW_PX);
  return Math.min(Math.max(fit, 1), MAX_OPEN_WINDOWS);
}

/**
 * Routes where the dock stays out of the way. Two reasons a path is here:
 * `/messages` IS the full experience (one system, two doors), and focused
 * workflows — forms, wizards, consequential decisions — must not have a
 * floating panel over their submit buttons, fields, or validation. The dock
 * only hides its UI on these routes; its state keeps running, so windows and
 * half-typed drafts are intact when the user comes back out.
 *
 * Deliberately NOT here: /privacy and /terms (long reading pages, not
 * workflows), /dashboard/* (status lists), and all browsing surfaces.
 */
export const DOCK_HIDDEN_PREFIXES = [
  '/messages',
  '/app/guardian',        // add-athlete ("Add Sub-Profile"), consent, credentials, approvals, transfers
  '/app/transfer',        // irreversible transfer-of-control wizard
  '/app/workout',         // workout editor
  '/onboarding',
  '/auth/complete-profile',
  '/activate',
  '/invite',
  '/reset-password',
  '/forgot-password',
  '/contact',
  '/settings',
];

/**
 * `/` is matched EXACTLY (it's the sign-in page; prefix-matching it would
 * hide the dock everywhere). Prefixes require a full segment boundary, so
 * `/contact` never swallows a future `/contacts`.
 */
export function isDockSuppressedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return true; // unknown route: stay out of the way
  if (pathname === '/') return true;
  return DOCK_HIDDEN_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(prefix + '/')
  );
}

/** Enforce the cap by minimizing the OLDEST open windows. */
function applyCap(state: DockState): DockState {
  if (state.open.length <= state.cap) return state;
  const overflow = state.open.slice(0, state.open.length - state.cap);
  return {
    ...state,
    open: state.open.slice(state.open.length - state.cap),
    minimized: [...state.minimized.filter(id => !overflow.includes(id)), ...overflow],
  };
}

export function dockReducer(state: DockState, action: DockAction): DockState {
  switch (action.type) {
    case 'OPEN_WINDOW': {
      if (state.open.includes(action.id)) return state; // already open
      return applyCap({
        ...state,
        open: [...state.open, action.id],
        minimized: state.minimized.filter(id => id !== action.id),
      });
    }
    case 'CLOSE_WINDOW':
      return {
        ...state,
        open: state.open.filter(id => id !== action.id),
        minimized: state.minimized.filter(id => id !== action.id),
      };
    case 'MINIMIZE': {
      if (!state.open.includes(action.id)) return state;
      return {
        ...state,
        open: state.open.filter(id => id !== action.id),
        minimized: state.minimized.includes(action.id)
          ? state.minimized
          : [...state.minimized, action.id],
      };
    }
    case 'RESTORE': {
      if (!state.minimized.includes(action.id)) return state;
      return applyCap({
        ...state,
        minimized: state.minimized.filter(id => id !== action.id),
        open: [...state.open, action.id],
      });
    }
    case 'TOGGLE_PANEL':
      return { ...state, panelOpen: !state.panelOpen };
    case 'CLOSE_PANEL':
      return state.panelOpen ? { ...state, panelOpen: false } : state;
    case 'CLEAR_WINDOWS':
      // Closing the widget tears down the whole messaging workspace:
      // panel collapsed, every open and minimized window gone.
      return { ...state, panelOpen: false, open: [], minimized: [] };
    case 'HYDRATE': {
      // Dedupe open∩minimized (open wins) before capping.
      const open = [...new Set(action.state.open)];
      const minimized = [...new Set(action.state.minimized)].filter(id => !open.includes(id));
      return applyCap({ ...state, panelOpen: action.state.panelOpen, open, minimized });
    }
    case 'SET_CAP':
      return applyCap({ ...state, cap: Math.min(Math.max(action.cap, 1), MAX_OPEN_WINDOWS) });
    case 'PRUNE': {
      // Drop persisted ids that no longer exist in the conversation list.
      const valid = new Set(action.validIds);
      const open = state.open.filter(id => valid.has(id));
      const minimized = state.minimized.filter(id => valid.has(id));
      if (open.length === state.open.length && minimized.length === state.minimized.length) {
        return state;
      }
      return { ...state, open, minimized };
    }
    default:
      return state;
  }
}

// ── Persistence (SSR/private-mode safe — silently no-op on throw) ────────────

interface PersistedDockState {
  v: 1;
  panelOpen: boolean;
  open: string[];
  minimized: string[];
}

export function serializeDockState(state: DockState): string {
  const payload: PersistedDockState = {
    v: 1,
    panelOpen: state.panelOpen,
    open: state.open,
    minimized: state.minimized,
  };
  return JSON.stringify(payload);
}

export function parseDockState(raw: string | null): Pick<DockState, 'panelOpen' | 'open' | 'minimized'> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedDockState;
    if (parsed?.v !== 1) return null;
    return {
      panelOpen: parsed.panelOpen === true,
      open: Array.isArray(parsed.open) ? parsed.open.filter(id => typeof id === 'string') : [],
      minimized: Array.isArray(parsed.minimized) ? parsed.minimized.filter(id => typeof id === 'string') : [],
    };
  } catch {
    return null;
  }
}

export function loadDockState(): Pick<DockState, 'panelOpen' | 'open' | 'minimized'> | null {
  try {
    return parseDockState(window.localStorage.getItem(DOCK_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveDockState(state: DockState): void {
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, serializeDockState(state));
  } catch {
    // private mode / quota — dock still works for this session
  }
}
