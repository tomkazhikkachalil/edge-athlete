import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

/**
 * The icons round (Nov 2026): Font Awesome's glyphs are drawn inline from
 * per-icon modules (src/lib/icons/fa/<name>.ts, generated from the package's
 * own SVGs) through <FaIcon>; the webfont stylesheet (90 KB) and its three
 * font files (259 KB) are gone from every page, and a route carries only the
 * glyphs its code and data name. These pin: no <i class="fa …"> is left, the
 * stylesheet is not imported, every glyph import has its module and the
 * modules are current (the generator's --check), and the component sizes a
 * glyph the way the font did.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('icons — the webfont is gone', () => {
  const files = walk(join(ROOT, 'src'));
  it('no <i> draws a Font Awesome class any more, and nothing imports the stylesheet', () => {
    const offenders = files
      .filter((f) => !f.includes(`${join('src', 'lib', 'icons')}`) && !f.endsWith('FaIcon.tsx'))
      .filter((f) => /<i\b[^>]*\bfa[srb]?\b[^>]*fa-[a-z]/.test(readFileSync(f, 'utf8')) || /fontawesome-free\/css/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });
  it('the package is a build-time dependency only (the generator reads its SVGs)', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies['@fortawesome/fontawesome-free']).toBeUndefined();
    expect(pkg.devDependencies['@fortawesome/fontawesome-free']).toBeDefined();
  });
});

describe('icons — the glyph modules', () => {
  const files = walk(join(ROOT, 'src'));
  it('every glyph import has its module, and every module is imported somewhere', () => {
    const imported = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/from '@\/lib\/icons\/fa\/([a-z0-9-]+)'/g)) imported.add(m[1]);
    const onDisk = new Set(readdirSync(join(ROOT, 'src/lib/icons/fa')).map((n) => n.replace(/\.ts$/, '')));
    expect([...imported].filter((b) => !onDisk.has(b))).toEqual([]);
    expect([...onDisk].filter((b) => !imported.has(b))).toEqual([]);
    expect(imported.size).toBeGreaterThan(150);
  });
  it('the generator finds the modules current (names, aliases, paths)', () => {
    const r = spawnSync(process.execPath, ['scripts/gen-fa-icons.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stderr + r.stdout).toBe(0);
  });
  it('each module names its symbol and box — no path in JavaScript — and carries the attribution', () => {
    const sample = ['xmark', 'trophy', 'golf-ball-tee', 'heart-regular', 'instagram-brands'];
    for (const b of sample) {
      const p = join(ROOT, 'src/lib/icons/fa', `${b}.ts`);
      expect(existsSync(p), b).toBe(true);
      const src = readFileSync(p, 'utf8');
      expect(src).toMatch(/CC BY 4\.0/);
      expect(src).toMatch(new RegExp(`id: '${b}', name: '[a-z0-9-]+', w: \\d+, h: 512 \\}`));
      expect(src).not.toMatch(/\bd: '/);
    }
  });
  it('the ONE sprite holds every module\'s symbol, is content-hashed, and the component draws through <use>', () => {
    const urlSrc = read('src/lib/icons/fa-sprite.generated.ts');
    const url = /FA_SPRITE_URL = '(\/icons\/fa-[0-9a-f]{12}\.svg)'/.exec(urlSrc)?.[1];
    expect(url).toBeTruthy();
    const sprite = read(join('public', url!));
    expect(sprite).toMatch(/CC BY 4\.0/);
    for (const f of readdirSync(join(ROOT, 'src/lib/icons/fa'))) {
      const id = f.replace(/\.ts$/, '');
      expect(sprite, id).toContain(`<symbol id="${id}" viewBox="0 0 `);
    }
    const comp = read('src/components/FaIcon.tsx');
    expect(comp).toContain('<use href={`${FA_SPRITE_URL}#${icon.id}`} />');
    expect(comp).not.toMatch(/<path d=/);
  });
});

describe('icons — the component', () => {
  it('sizes a glyph like the font did and is decorative unless titled', () => {
    const src = read('src/components/FaIcon.tsx');
    expect(src).toContain("fixedWidth ? '1.25em'");
    expect(src).toContain("height: '1em'");
    expect(src).toContain('inline-block align-[-0.125em] shrink-0');
    expect(src).toContain("aria-hidden={title ? undefined : true}");
    expect(src).toContain("spin ? ' animate-spin' : ''");
    expect(src).toContain('fill="currentColor"');
  });
});
