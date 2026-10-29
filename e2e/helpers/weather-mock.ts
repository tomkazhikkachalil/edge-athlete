import { createServer, type Server } from 'node:http';

// A stand-in for Open-Meteo's forecast API (e2e/golf-forecast.spec.ts). It
// answers exactly the one call src/lib/weather/weather-server.ts makes —
// GET /v1/forecast with a `current` block — with canned conditions, and
// records every request so a spec can prove the cell it was asked for and
// how many times. The LOCAL test server is pointed here by
// playwright.config.ts (WEATHER_MOCK_BASE); a production deployment ignores
// that variable (weatherConfig).

export const WEATHER_MOCK_PORT = 4873;
export const WEATHER_MOCK_BASE = `http://127.0.0.1:${WEATHER_MOCK_PORT}`;

/** What the local test server is started with. */
export const WEATHER_E2E_ENV: Record<string, string> = { WEATHER_MOCK_BASE };

/** The canned current block: 12.2 °C (54 °F), partly cloudy, 20 km/h (moderate). */
export const WEATHER_MOCK_CURRENT = {
  temperature_2m: 12.2,
  apparent_temperature: 10.4,
  is_day: 1,
  precipitation: 0,
  weather_code: 2,
  wind_speed_10m: 20,
  wind_direction_10m: 315,
  wind_gusts_10m: 33.5,
};

export interface WeatherMock {
  /** Requests received, as "GET /v1/forecast?<query>". */
  calls: string[];
  /** Override the next answers' current block (a field or two). */
  setCurrent(over: Partial<typeof WEATHER_MOCK_CURRENT>): void;
  /** Answer the next requests with this status instead (503 = provider down). */
  fail(status: number | null): void;
  close(): Promise<void>;
}

export async function startWeatherMock(): Promise<WeatherMock> {
  const calls: string[] = [];
  let current = { ...WEATHER_MOCK_CURRENT };
  let failWith: number | null = null;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', WEATHER_MOCK_BASE);
    calls.push(`${req.method} ${url.pathname}${url.search}`);
    if (failWith) {
      res.writeHead(failWith, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: true, reason: 'mock failure' }));
      return;
    }
    if (req.method !== 'GET' || url.pathname !== '/v1/forecast') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: true, reason: 'not found' }));
      return;
    }
    const body = {
      latitude: Number(url.searchParams.get('latitude')),
      longitude: Number(url.searchParams.get('longitude')),
      utc_offset_seconds: 0,
      timezone: 'UTC',
      current: { time: Math.floor(Date.now() / 1000), ...current },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(WEATHER_MOCK_PORT, '127.0.0.1', () => resolve());
  });

  return {
    calls,
    setCurrent(over) { current = { ...current, ...over }; },
    fail(status) { failWith = status; },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
