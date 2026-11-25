import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The live round's map view (Tom's live-round spec, Nov 25 2026 — section D):
// what is drawn OVER the map changed; what the map DOES did not. Read from
// source (the suite has no DOM); the behaviour keeps its own pure tests
// (map-follow, hole-geometry, hole-detail) and e2e specs.
const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const map = code('src/components/golf/CourseMapInner.tsx');
const page = code('src/app/(app)/live/[groupPostId]/page.tsx');
const css = code('src/app/globals.css');

describe('behaviour untouched', () => {
  it('one position watcher, started by a tap or an existing grant, never uploaded', () => {
    expect(map.match(/watchPosition\(/g)?.length).toBe(1);
    expect(map).toMatch(/enableHighAccuracy: true, maximumAge: 5000, timeout: 15000/);
    expect(map).toMatch(/navigator\.permissions/);
    // The fix leaves the component only through onFix (to the page's state).
    expect(map).not.toMatch(/fetch\(/);
  });
  it('a target is still set by a tap on the map while a hole is focused', () => {
    expect(map).toMatch(/map\.on\('click', e => \{\s*const f = focusedLineRef\.current;\s*if \(!f\) return;\s*setTarget\(\{ hole: f\.hole, ll: \[e\.latlng\.lat, e\.latlng\.lng\] \}\);/);
  });
  it('the keys call the same handlers the old buttons did', () => {
    expect(map).toMatch(/onClick=\{\(\) => setLayer\(l => \(l === 'satellite' \? 'osm' : 'satellite'\)\)\}/);
    expect(map).toMatch(/onClick=\{\(\) => \(tracking \? stopTracking\(\) : startTracking\(\)\)\}/);
    expect(map).toMatch(/onClick=\{toggleFollow\}/);
    expect(map).toMatch(/<button type="button" onClick=\{recenter\} aria-label="Re-center on my position"/);
    expect(map).toMatch(/mapRef\.current\?\.zoomIn\(\)/);
    expect(map).toMatch(/mapRef\.current\?\.zoomOut\(\)/);
  });
  it('the Set target key only shows or clears a target; with none it asks the caller to say how', () => {
    expect(map).toMatch(/onClick=\{\(\) => \(activeTarget \? setTarget\(null\) : onTargetHelp\?\.\(\)\)\}/);
    expect(page).toMatch(/onTargetHelp=\{\(\) => setMapInfoOpen\(true\)\}/);
  });
});

describe('the furniture', () => {
  it('overlay mode draws its own zoom keys and credit; the card map keeps Leaflet\'s', () => {
    expect(map).toMatch(/\.\.\.\(overlayControls \? \{ zoomControl: false, attributionControl: false \} : \{\}\)/);
  });
  it('the credit strip carries the tile layer\'s own credit, the hole lines\' and the links', () => {
    expect(map).toMatch(/dangerouslySetInnerHTML=\{\{ __html: \(layer === 'satellite' \? SATELLITE : OSM\)\.attribution \}\}/);
    expect(map).toMatch(/hole lines © <a href="https:\/\/www\.openstreetmap\.org\/copyright"/);
    expect(map).toMatch(/overflow-x-auto overflow-y-hidden whitespace-nowrap/);
    const tiles = code('src/lib/maps/tiles.ts');
    expect(tiles).toContain('Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community');
    expect(tiles).toContain('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
  });
  it('the two hints are behind the info key, in the spec\'s words', () => {
    expect(map.slice(map.indexOf('{overlayControls ? ('), map.indexOf(') : (\n        <>\n          <div className="mt-2'))).not.toMatch(/Tap the map|stays on your device/);
    expect(page).toContain('<p>Tap the map to set a target.</p>');
    expect(page).toContain('{roundOpen && <p>Your position stays on your device. It is never uploaded.</p>}');
  });
  it('the keys and every offset are in px, so enlarged text cannot push one part onto another', () => {
    expect(map).toMatch(/const ROUND_KEY = 'ea-mech-round inline-flex h-\[44px\] w-\[44px\]/);
    for (const cls of ['live-map-plate', 'live-map-controls', 'live-map-zoom', 'live-map-notes', 'live-map-footer', 'live-map-bar']) {
      expect(css, cls).toMatch(new RegExp(`\\.${cls} \\{ position: absolute;`));
    }
    expect(css).toMatch(/@media \(max-height: 480px\) \{\s*\.live-map-capsule \{ flex-direction: row; \}/);
  });
  it('the top bar: Back, the red LIVE badge, Scorecard | Map as tabs', () => {
    expect(page).toMatch(/<RoundBadge status="live" scope="live" \/>/);
    expect(page).toMatch(/role="tablist" aria-label="Round views"/);
    expect(page).toMatch(/role="tab"\s*aria-selected=\{tab === id\}/);
    expect(css).toMatch(/\.ea-mech-key\[aria-pressed="true"\],\s*\.ea-mech-key\[aria-selected="true"\] \{/);
  });
  it('"Hole N" stays one string for a reader on the plate', () => {
    expect(page).toContain('<span className="sr-only">Hole {displayHole}</span>');
  });
});

describe('the marks (D4)', () => {
  it('the line of play: white under the route colour, round caps and joins', () => {
    expect(map).toContain("L.polyline(vertices, { color: '#ffffff', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round' })");
    expect(map).toContain("L.polyline(vertices, { color: '#8b5cf6', weight: 3.5, opacity: 1, lineCap: 'round', lineJoin: 'round' })");
  });
  it('the tee marker, the flag and the player carry hooks (no test finds a mark by its colour)', () => {
    expect(map).toContain('data-tee-marker="${hole}"');
    expect(map).toContain('data-green-flag=""');
    expect(map).toContain('data-player-dot=""');
    expect(map).toContain('fill="#e5333b"');
    expect(map).toContain('background:#4da3ff');
  });
});
