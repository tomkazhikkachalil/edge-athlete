#!/usr/bin/env node
// ── Seed the Edge Athlete Demo League (phase 3 R5) ──────────────────────────
// A permanent, clearly-labeled showcase org site: real rows through the
// same tables the product uses, demo-named throughout, and — the owner's
// decision — ZERO PEOPLE: no rosters, no extra memberships, and the staff
// module DISABLED so no human name (including the owner's) ever renders
// on the public site. Idempotent: if the league already exists, it
// reports and exits (delete the league row to reseed — cascades).
//
// Usage: node scripts/seed-demo-org.mjs --owner-email <email>
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local).

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const DEMO_NAME = 'Edge Athlete Demo League';
const DEMO_SLUG = 'edge-athlete-demo-league';

const args = process.argv.slice(2);
const ownerEmail = args[args.indexOf('--owner-email') + 1];
if (!args.includes('--owner-email') || !ownerEmail) {
  console.error('Usage: node scripts/seed-demo-org.mjs --owner-email <email>');
  process.exit(1);
}

const env = { ...process.env };
for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch {
    /* file optional */
  }
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: ownerProfile, error: ownerErr } = await admin
  .from('profiles')
  .select('id')
  .eq('email', ownerEmail.toLowerCase())
  .maybeSingle();
if (ownerErr || !ownerProfile) {
  console.error(`No profile found for ${ownerEmail}`);
  process.exit(1);
}
const ownerId = ownerProfile.id;

const { data: existing } = await admin
  .from('leagues')
  .select('id')
  .eq('name', DEMO_NAME)
  .maybeSingle();
if (existing) {
  console.log(`Already seeded — league ${existing.id}. Delete the league row to reseed.`);
  console.log(`URL: /org/${DEMO_SLUG}`);
  process.exit(0);
}

console.log('Seeding the demo league…');
const { data: league, error: leagueErr } = await admin
  .from('leagues')
  .insert({
    name: DEMO_NAME,
    sport_key: 'ice_hockey',
    owner_profile_id: ownerId,
    city: 'Ottawa',
    region: 'ON',
    country: 'CA',
  })
  .select()
  .single();
if (leagueErr) {
  console.error('league insert failed:', leagueErr.message);
  process.exit(1);
}
const leagueId = league.id;
await admin.from('memberships').insert({ league_id: leagueId, profile_id: ownerId, role: 'owner' });

const { data: season } = await admin
  .from('seasons')
  .insert({ league_id: leagueId, label: '2026–27 Demo Season' })
  .select()
  .single();
const { data: division } = await admin
  .from('divisions')
  .insert({
    league_id: leagueId,
    season_id: season.id,
    sport_key: 'ice_hockey',
    name: 'Demo Division',
  })
  .select()
  .single();

const teamNames = ['Demo Blazers', 'Demo Comets', 'Demo Rapids', 'Demo Summit'];
const { data: teams } = await admin
  .from('teams')
  .insert(teamNames.map(name => ({ league_id: leagueId, name })))
  .select();
await admin
  .from('team_entries')
  .insert(teams.map(t => ({ team_id: t.id, division_id: division.id })));

const { data: comp } = await admin
  .from('competitions')
  .insert({
    league_id: leagueId,
    season_id: season.id,
    sport_key: 'ice_hockey',
    name: 'Demo House League',
    format: 'fixture',
    entrant_type: 'team',
    status: 'active',
    visibility: 'public',
  })
  .select()
  .single();
const { data: entries } = await admin
  .from('competition_entries')
  .insert(teams.map(t => ({ competition_id: comp.id, team_id: t.id, status: 'approved' })))
  .select();
// A plausible early-season table (hockey 2-point wins).
const table = [
  { rank: 1, points: 6, played: 4, stats: { w: 3, l: 1, t: 0, gf: 14, ga: 8, diff: 6 } },
  { rank: 2, points: 5, played: 4, stats: { w: 2, l: 1, t: 1, gf: 11, ga: 9, diff: 2 } },
  { rank: 3, points: 3, played: 4, stats: { w: 1, l: 2, t: 1, gf: 9, ga: 12, diff: -3 } },
  { rank: 4, points: 2, played: 4, stats: { w: 1, l: 3, t: 0, gf: 7, ga: 12, diff: -5 } },
];
await admin.from('competition_standings').insert(
  table.map((row, i) => ({
    competition_id: comp.id,
    entry_id: entries[i].id,
    ...row,
  }))
);

const day = 86_400_000;
const at = offset => new Date(Date.now() + offset).toISOString();
const events = [
  { title: 'Demo Blazers vs Demo Comets', category: 'game', start: 3 * day, team: null },
  { title: 'Demo Rapids vs Demo Summit', category: 'game', start: 3 * day + 2 * 3_600_000, team: null },
  { title: 'Demo Blazers practice', category: 'practice', start: 5 * day, team: teams[0].id },
  { title: 'Season social night', category: 'social', start: 9 * day, team: null },
];
await admin.from('events').insert(
  events.map(e => ({
    organizer_id: ownerId,
    title: e.title,
    starts_at: at(e.start),
    ends_at: at(e.start + 2 * 3_600_000),
    timezone: 'America/Toronto',
    category: e.category,
    ...(e.team ? { team_id: e.team } : { league_id: leagueId }),
    location: 'Demo Community Arena',
  }))
);

const { data: venue } = await admin
  .from('venues')
  .insert({ league_id: leagueId, name: 'Demo Community Arena', city: 'Ottawa', region: 'ON', country: 'CA' })
  .select()
  .single();
await admin.from('facilities').insert([
  { venue_id: venue.id, name: 'Rink A', kind: 'rink' },
  { venue_id: venue.id, name: 'Rink B', kind: 'rink' },
]);

// The site: published, teal accent, hero copy, sponsors — STAFF DISABLED
// (the zero-people rule; there are no rosters to show either).
const { data: site, error: siteErr } = await admin
  .from('org_sites')
  .insert({
    league_id: leagueId,
    subdomain: DEMO_SLUG,
    hero_config: {
      headline: 'Edge Athlete Demo League',
      tagline: 'A live demo of public org sites — schedules, standings, and teams.',
    },
    theme_token_set: { accent: '#0f766e' },
    published_at: new Date().toISOString(),
  })
  .select()
  .single();
if (siteErr) {
  console.error('site insert failed:', siteErr.message);
  process.exit(1);
}
const moduleKeys = ['hero', 'standings', 'schedule', 'teams', 'staff', 'venues', 'affiliations', 'sponsors', 'contact'];
await admin.from('org_site_modules').insert(
  moduleKeys.map((key, i) => ({
    site_id: site.id,
    module_key: key,
    enabled: key !== 'staff', // zero people — no names anywhere
    sort_order: i,
    config:
      key === 'sponsors'
        ? { sponsors: [{ name: 'Demo Sports Supply', url: 'https://example.com/demo-sports' }, { name: 'Demo Rink Co.' }] }
        : {},
  }))
);

await admin.from('org_site_pages').insert({
  site_id: site.id,
  slug: 'about',
  title: 'About This Demo',
  visibility: 'public',
  body: [
    { type: 'heading', text: 'What you are looking at' },
    {
      type: 'paragraph',
      text: 'This is a demonstration site generated by Edge Athlete — every module here (standings, schedule, teams, venues, sponsors, and this page) is rendered from the same product real leagues and clubs use. The names are demo placeholders; the plumbing is real.',
    },
    { type: 'heading', text: 'Get your own site' },
    {
      type: 'link-list',
      links: [{ label: 'Edge Athlete', url: 'https://edge-athlete.vercel.app' }],
    },
  ],
});

console.log(`Seeded. League ${leagueId}, site ${site.id}`);
console.log(`URL: /org/${DEMO_SLUG}`);
