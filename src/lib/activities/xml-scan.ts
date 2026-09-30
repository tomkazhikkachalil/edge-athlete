// ── A tolerant scanner for the two XML activity formats — pure ─────────────
// GPX and TCX are simple, flat, machine-written XML. A regex scanner reads
// them in the browser AND in node (no DOMParser on the server — a later
// provider may deliver GPX there), stays fast on a 10 MB file, and never
// resolves an entity or a DTD (nothing to exploit). Namespace prefixes are
// ignored: `<gpxtpx:hr>`, `<ns3:hr>` and `<hr>` all read as `hr`.

/** Thrown for a file we cannot read; `message` is shown to the athlete. */
export class ActivityParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityParseError';
  }
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  if (cdata) return cdata[1].trim();
  return raw
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith('#')) {
        const cp = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }
      return ENTITY[k] ?? '';
    })
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A file of 20,000 points asks for the same handful of tags 100,000+ times.
const tagRes = new Map<string, RegExp>();

/** The text of the FIRST element with this local name inside `xml`. */
export function tagText(xml: string, localName: string): string | null {
  let re = tagRes.get(localName);
  if (!re) {
    re = new RegExp(`<(?:[\\w.-]+:)?${escapeRe(localName)}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${escapeRe(localName)}\\s*>`, 'i');
    tagRes.set(localName, re);
  }
  const m = re.exec(xml);
  return m ? decodeXmlText(m[1]) : null;
}

/** A finite number from the first element with this local name, else undefined. */
export function tagNumber(xml: string, localName: string): number | undefined {
  const t = tagText(xml, localName);
  if (t === null || t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** An attribute's value from an element's attribute string. */
export function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${escapeRe(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  if (!m) return null;
  return decodeXmlText(m[1] ?? m[2] ?? '');
}

/** Every element with this local name: `{ attrs, body }` (body '' when self-closing). */
export function eachElement(xml: string, localName: string, visit: (attrs: string, body: string) => void): void {
  const n = escapeRe(localName);
  const re = new RegExp(`<(?:[\\w.-]+:)?${n}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${n}\\s*>)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) visit(m[1] ?? '', m[2] ?? '');
}

/** ISO-8601 → epoch ms, or undefined. */
export function parseTime(v: string | null): number | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}
