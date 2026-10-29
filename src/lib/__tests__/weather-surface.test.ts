import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Weather at the course (Oct 29 2026) — the shape of the surface, read from
// the source: the route is public by construction (no gate, no cookie, no
// Vary) and CDN-cached per cell; the provider's host lives in ONE server
// module; the browser calls our route; the Conditions step credits the
// source; the composer offers the forecast to a LIVE round only.
const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe('the weather route', () => {
  const route = code('src/app/api/weather/route.ts');

  it('is public by construction: no gate, no cookie read, no Vary; the CDN holds a cell for 10 minutes', () => {
    expect(route).not.toMatch(/getServerAuth|requireAuth|requireAdmin|cookies\(\)|Vary/);
    expect(route).toMatch(/public, s-maxage=600, stale-while-revalidate=1800/);
    expect(route).toMatch(/enforceRateLimit\(request, 'weather'\)/);
    expect(route).toMatch(/hitDailyBudget\(/);
    expect(route).toMatch(/roundCoord\(/);
  });

  it('never logs a coordinate or the provider URL', () => {
    expect(route).not.toMatch(/reportRoute(Error|Warning)\([^)]*(lat|lng|cell|url)/i);
  });
});

describe('the provider host', () => {
  it('is named in weather-server.ts only — the browser calls OUR route', () => {
    const offenders = walk(path.join(ROOT, 'src'))
      .filter(f => !f.endsWith(path.join('weather', 'weather-server.ts')))
      .filter(f => /api\.open-meteo\.com\/v1\/forecast|customer-api\.open-meteo\.com\/v1\/forecast/.test(read(path.relative(ROOT, f))));
    expect(offenders).toEqual([]);
    const client = code('src/lib/weather/weather-client.ts');
    expect(client).toMatch(/fetch\(`\/api\/weather\?lat=/);
    expect(client).not.toMatch(/open-meteo/);
  });

  it('the pure module imports nothing', () => {
    expect(code('src/lib/weather/weather.ts')).not.toMatch(/^\s*import /m);
  });
});

describe('the Conditions step and the composer', () => {
  const step = code('src/components/golf/round-steps/ConditionsStep.tsx');
  const composer = code('src/components/golf/GolfComposerSection.tsx');

  it('credits the source with a safe link and names the button', () => {
    expect(step).toMatch(/WEATHER_ATTRIBUTION\.text/);
    expect(step).toMatch(/rel="noopener noreferrer"/);
    expect(step).toMatch(/Use the forecast at the course/);
    expect(step).toMatch(/data-golf-forecast=""/);
  });

  it('offers the forecast to a live round at a catalog course only, and a typed value marks the conditions manual', () => {
    expect(composer).toMatch(/!sharedRoundDetails\.alreadyPlayed && selectedCourse\?\.lat != null && selectedCourse\?\.lng != null\s*\?\s*\{ status: forecastStatus/);
    expect(composer).toMatch(/conditionsSource: 'manual', conditionsAt: null/);
    expect(composer).toMatch(/conditionsSource: 'forecast'/);
  });

  it('the finished round carries its conditions and their source (291): the mirror copies them, the readers select them', () => {
    const mirror = code('src/lib/golf/round-mirror.ts');
    expect(mirror).toMatch(/weather_conditions, temperature, wind_speed, conditions_source, conditions_at/);
    expect(mirror).toMatch(/weather: golfData\.weather_conditions \?\? null/);
    expect(mirror).toMatch(/wind: golfWindBandFromMph\(golfData\.wind_speed\)/);
    expect(mirror).toMatch(/conditions_source: golfData\.conditions_source \?\? null/);
    for (const f of ['src/app/api/golf/rounds/[roundId]/route.ts', 'src/app/api/posts/[id]/route.ts']) {
      expect(code(f), f).toMatch(/conditions_source/);
    }
    const writer = code('src/app/api/group-posts/route.ts');
    expect(writer).toMatch(/golf_data\.conditions_source === 'forecast' \|\| golf_data\.conditions_source === 'manual'/);
  });

  it('the temperature column stays Fahrenheit: the step converts at its edge, the composer stores golfTempF', () => {
    expect(step).toMatch(/fromInput\('temp', f, 'imperial'\)/);
    expect(step).toMatch(/toDisplay\('temp', fromInput\('temp', v, sys\), 'imperial'\)/);
    expect(composer).toMatch(/temperature: String\(golfTempF\(w\.tempC\)\)/);
  });
});
