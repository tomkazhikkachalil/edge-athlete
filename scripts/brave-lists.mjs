// ── Brave Shields' default filter lists, fetched and cached (every-browser round, Oct 16 2026) ─
// A Brave Android user could not change their cover photo. Brave is Chromium
// plus Shields, ON by default: requests are blocked and elements hidden by
// these lists (Brave's "Standard" set — EasyList, EasyPrivacy, uBlock
// Origin's filters / privacy / unbreak, and Brave's own unbreak and specific
// lists). One loader serves both the Playwright `brave-android` project
// (e2e/helpers/brave.ts) and `npm run check:blocklists`, so a test and the
// check read the same rules.
//
// The lists are fetched once and kept in e2e/.cache/brave-lists/ (gitignored),
// refreshed after 7 days. Offline with a cache → the cache, however old; with
// no cache → an error naming the list (never a silent "nothing blocked").

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BRAVE_LISTS = [
  ['easylist', 'https://easylist.to/easylist/easylist.txt'],
  ['easyprivacy', 'https://easylist.to/easylist/easyprivacy.txt'],
  ['ubo-filters', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt'],
  ['ubo-privacy', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt'],
  ['ubo-unbreak', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt'],
  ['brave-unbreak', 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-unbreak.txt'],
  ['brave-specific', 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-specific.txt'],
  ['brave-firstparty', 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-firstparty.txt'],
];

// The repo root: both callers (npm scripts, Playwright) run from it. Not
// import.meta — Playwright loads this file as CommonJS.
const ROOT = process.cwd();
const CACHE = path.join(ROOT, 'e2e', '.cache', 'brave-lists');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function one(name, url) {
  const file = path.join(CACHE, `${name}.txt`);
  const age = await stat(file).then(s => Date.now() - s.mtimeMs, () => null);
  if (age !== null && age < MAX_AGE_MS) return readFile(file, 'utf8');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, text);
    return text;
  } catch (err) {
    if (age !== null) return readFile(file, 'utf8');
    throw new Error(`brave-lists: could not fetch ${name} (${url}): ${err instanceof Error ? err.message : err}`);
  }
}

/** Every list's text, joined — what `FiltersEngine.parse` takes. */
export async function braveListsText() {
  const texts = await Promise.all(BRAVE_LISTS.map(([name, url]) => one(name, url)));
  return texts.join('\n');
}
