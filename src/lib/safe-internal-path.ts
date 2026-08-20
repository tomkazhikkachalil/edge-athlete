// Pure sanitizer for post-login "return to" paths (?next=…). Only
// same-origin absolute paths pass: anything protocol-relative ("//evil"),
// absolute-URL, or backslash-tricked is rejected — a login redirect must
// never become an open redirect.

export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v.startsWith('/')) return null;
  if (v.startsWith('//')) return null;
  if (v.includes('\\')) return null;
  if (v.includes('://')) return null;
  return v;
}
