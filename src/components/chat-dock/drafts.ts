// Mini-window draft persistence — a half-typed message must survive
// navigation AND refresh (persistence is the product). Versioned localStorage
// keys with TTL, copied from the workouts-draft skeleton (do not import
// workout code). SSR/private-mode safe: every storage op no-ops on throw.

const DRAFT_VERSION = 1;
const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

const draftKey = (conversationId: string) => `ea:chat-draft:v${DRAFT_VERSION}:${conversationId}`;

interface DraftPayload {
  v: number;
  savedAt: number;
  text: string;
}

export function loadDraft(conversationId: string): string {
  try {
    const raw = window.localStorage.getItem(draftKey(conversationId));
    if (!raw) return '';
    const parsed = JSON.parse(raw) as DraftPayload;
    if (parsed?.v !== DRAFT_VERSION || typeof parsed.text !== 'string') return '';
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      window.localStorage.removeItem(draftKey(conversationId));
      return '';
    }
    return parsed.text;
  } catch {
    return '';
  }
}

export function saveDraft(conversationId: string, text: string): void {
  try {
    if (text.trim() === '') {
      window.localStorage.removeItem(draftKey(conversationId));
      return;
    }
    const payload: DraftPayload = { v: DRAFT_VERSION, savedAt: Date.now(), text };
    window.localStorage.setItem(draftKey(conversationId), JSON.stringify(payload));
  } catch {
    // private mode / quota — draft just won't survive refresh
  }
}
