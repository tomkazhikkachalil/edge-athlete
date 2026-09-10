import { describe, expect, it } from 'vitest';
import { EMBED_FRAME_HOSTS, embedSrc, embedTitle, osmEmbedAround, parseEmbed, parseEmbedUrl } from '../embeds';
import { buildCsp, buildStaticCsp } from '@/lib/csp';

// Phase 6: a pasted link becomes a STRUCTURE; the frame src is rebuilt from
// it against a closed provider list — the same list the CSP frame-src
// carries. Nothing a manager pastes ever reaches an iframe as typed.
describe('embeds', () => {
  it('parses every YouTube link shape to the 11-char id', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
    ]) {
      expect(parseEmbedUrl(url), url).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    }
    expect(parseEmbedUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseEmbedUrl('https://www.youtube.com/@channel')).toBeNull();
  });

  it('parses Vimeo links', () => {
    expect(parseEmbedUrl('https://vimeo.com/123456789')).toEqual({ provider: 'vimeo', id: '123456789' });
    expect(parseEmbedUrl('https://player.vimeo.com/video/123456789?h=abc')).toEqual({ provider: 'vimeo', id: '123456789' });
    expect(parseEmbedUrl('https://vimeo.com/channels/staffpicks/123456789')).toEqual({ provider: 'vimeo', id: '123456789' });
    expect(parseEmbedUrl('https://vimeo.com/about')).toBeNull();
  });

  it('parses OpenStreetMap embed and share links into a bbox (+ marker)', () => {
    expect(
      parseEmbedUrl('https://www.openstreetmap.org/export/embed.html?bbox=-0.13,51.50,-0.11,51.51&layer=mapnik&marker=51.505,-0.12')
    ).toEqual({ provider: 'osm', bbox: [-0.13, 51.5, -0.11, 51.51], marker: [51.505, -0.12] });
    const share = parseEmbedUrl('https://www.openstreetmap.org/?mlat=51.505&mlon=-0.12#map=15/51.505/-0.12');
    expect(share?.provider).toBe('osm');
    if (share?.provider === 'osm') {
      const [w, s, e, n] = share.bbox;
      expect(w).toBeLessThan(-0.12);
      expect(e).toBeGreaterThan(-0.12);
      expect(s).toBeLessThan(51.505);
      expect(n).toBeGreaterThan(51.505);
      expect(share.marker).toEqual([51.505, -0.12]);
    }
    // An inverted or out-of-range box is not a map.
    expect(parseEmbedUrl('https://www.openstreetmap.org/export/embed.html?bbox=1,2,0,3')).toBeNull();
    expect(parseEmbedUrl('https://www.openstreetmap.org/export/embed.html?bbox=-200,0,1,1')).toBeNull();
    expect(parseEmbedUrl('https://www.openstreetmap.org/about')).toBeNull();
  });

  it('refuses everything else — other hosts, non-http, garbage', () => {
    for (const url of [
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://www.google.com/maps/embed?pb=abc',
      'javascript:alert(1)',
      'not a url',
      '',
      'https://evil.youtube.com.attacker.example/watch?v=dQw4w9WgXcQ',
    ]) {
      expect(parseEmbedUrl(url), url).toBeNull();
    }
  });

  it('rebuilds the frame src on the allowed hosts only', () => {
    const yt = embedSrc({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    const vm = embedSrc({ provider: 'vimeo', id: '123456789' });
    const osm = embedSrc({ provider: 'osm', bbox: [-0.13, 51.5, -0.11, 51.51], marker: [51.505, -0.12] });
    expect(yt).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(vm).toBe('https://player.vimeo.com/video/123456789');
    expect(osm).toBe('https://www.openstreetmap.org/export/embed.html?bbox=-0.13,51.5,-0.11,51.51&layer=mapnik&marker=51.505,-0.12');
    for (const src of [yt, vm, osm]) {
      expect(EMBED_FRAME_HOSTS.some(h => src.startsWith(`${h}/`)), src).toBe(true);
    }
    expect(embedTitle({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toBe('YouTube video');
  });

  it('parseEmbed is defensive: a stored config from any build renders nothing rather than something else', () => {
    expect(parseEmbed({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseEmbed({ provider: 'youtube', id: '<script>' })).toBeNull();
    expect(parseEmbed({ provider: 'vimeo', id: 'abc' })).toBeNull();
    expect(parseEmbed({ provider: 'osm', bbox: [0, 0, 1] })).toBeNull();
    expect(parseEmbed({ provider: 'osm', bbox: [0, 0, 1, 1], marker: [999, 0] })).toEqual({ provider: 'osm', bbox: [0, 0, 1, 1] });
    expect(parseEmbed({ provider: 'gmaps', src: 'https://maps.google.com' })).toBeNull();
    expect(parseEmbed(null)).toBeNull();
    expect(parseEmbed('https://youtu.be/dQw4w9WgXcQ')).toBeNull();
  });

  it('osmEmbedAround (phase 11): a box around a point at a zoom, the point as marker; round-trips the parser and matches the share link', () => {
    const e = osmEmbedAround(43.65, -79.38, 15);
    expect(e.provider).toBe('osm');
    expect(e.marker).toEqual([43.65, -79.38]);
    expect(e.bbox[0]).toBeLessThan(-79.38);
    expect(e.bbox[2]).toBeGreaterThan(-79.38);
    expect(parseEmbed(e)).toEqual(e);
    expect(parseEmbedUrl('https://www.openstreetmap.org/?mlat=43.65&mlon=-79.38#map=15/43.65/-79.38')).toEqual(e);
    // Clamped at the edges; the zoom clamped 1..19.
    expect(osmEmbedAround(89.99, 179.99, 1).bbox[3]).toBe(90);
    expect(osmEmbedAround(0, 0, 99).bbox[2]).toBeGreaterThan(0);
  });

  it('the CSP frame-src in BOTH builders is exactly the provider list', () => {
    const expected = `frame-src ${EMBED_FRAME_HOSTS.join(' ')}`;
    expect(buildCsp('n0nce')).toContain(expected);
    expect(buildStaticCsp()).toContain(expected);
    // One frame-src per policy, and no other frame host.
    for (const policy of [buildCsp('n0nce'), buildStaticCsp({ dev: true })]) {
      const directives = policy.split('; ').filter(d => d.startsWith('frame-src'));
      expect(directives).toEqual([expected]);
    }
  });
});
