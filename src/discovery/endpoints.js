/**
 * endpoints.js
 *
 * URL pattern prober. Systematically tries variations on known ESPN API
 * URL patterns to discover undocumented endpoints.
 *
 * Probes:
 *   - Segment variations (0, 1, 2, 3)
 *   - Non-FFL game paths (fba, flba, etc.)
 *   - Top-level resource paths (players, proTeams, news, etc.)
 *   - Sub-resource paths under leagues
 *   - Year boundary exploration
 *
 * Usage:  node src/discovery/endpoints.js
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EspnClient } from '../client.js';
import config from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(__dirname, '..', '..', 'results');

const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3';

// All known game types to probe
const GAME_TYPES = ['ffl', 'fba', 'flb', 'flba', 'fhs', 'mens-college-basketball', 'womens-college-basketball'];

// Known top-level resources (under /games/{game}/)
const TOP_LEVEL_RESOURCES = [
  'players',
  'proTeams',
  'news',
  'seasons',
  'games',
  'stats',
  'positions',
  'injuries',
  'transactions',
  'waivers',
  'trades',
  'schedule',
  'standings',
  'rankings',
  'projections',
  'ownership',
  'adp',
];

// Known sub-resources under /seasons/{year}/
const SEASON_SUBRESOURCES = [
  'segments/0/leagues',
  'players',
  'proTeams',
  'proGames',
  'proSchedules',
  'positions',
  'stats',
  'news',
  'rankings',
  'projections',
  'injuries',
];

// Sub-resources under /leagues/{id}/
const LEAGUE_SUBRESOURCES = [
  'members',
  'teams',
  'rosters',
  'matchups',
  'transactions',
  'draftPicks',
  'settings',
  'schedule',
  'standings',
  'messages',
  'activity',
  'news',
  'chat',
];

// Segment IDs to test (0 = preseason known, what about others?)
const SEGMENTS = [0, 1, 2, 3, 4];

function describe(res) {
  if (!res) return 'FETCH_ERROR';
  const bodyHint = typeof res.body === 'object' && res.body !== null
    ? Object.keys(res.body).slice(0, 5).join(',')
    : String(res.body).slice(0, 50);
  return `HTTP ${res.status} | ${res.durationMs}ms | keys=[${bodyHint}]`;
}

async function probeUrl(client, url, label, params = {}) {
  const res = await client.get(url, { params });
  const outcome = {
    label,
    url,
    params,
    status: res?.status,
    ok: res?.ok,
    durationMs: res?.durationMs,
    topLevelKeys: typeof res?.body === 'object' && res?.body ? Object.keys(res.body) : [],
    bodyPreview: typeof res?.body === 'string' ? res.body.slice(0, 200) : null,
    interesting: res?.ok && res?.status === 200,
  };
  return { res, outcome };
}

async function run() {
  const client = new EspnClient();
  const allResults = [];

  console.log('='.repeat(60));
  console.log('ESPN Fantasy API — Endpoint URL Prober');
  console.log('='.repeat(60));
  console.log(`League:  ${config.leagueId || '(none)'}`);
  console.log(`Season:  ${config.season}`);
  console.log('');

  // ─────────────────────────────────────────────
  // 1. Game-type probing (ffl, fba, flb, etc.)
  // ─────────────────────────────────────────────
  console.log('--- 1. Game Type Paths ---');
  for (const game of GAME_TYPES) {
    const url = `${BASE}/games/${game}`;
    const label = `games/${game}`;
    process.stdout.write(`  ${label.padEnd(40)} `);
    const { res, outcome } = await probeUrl(client, url, label);
    allResults.push({ section: 'game-types', ...outcome });
    console.log(describe(res));

    // If it responds, probe seasons under it
    if (res?.ok) {
      const seasonUrl = `${BASE}/games/${game}/seasons/${config.season}`;
      const { res: sRes, outcome: sOutcome } = await probeUrl(
        client, seasonUrl, `games/${game}/seasons/${config.season}`
      );
      allResults.push({ section: 'game-types-seasons', ...sOutcome });
      console.log(`    ↳ /seasons/${config.season}: ${describe(sRes)}`);
    }
  }

  // ─────────────────────────────────────────────
  // 2. Segment variations under FFL
  // ─────────────────────────────────────────────
  console.log('\n--- 2. Segment Variations (FFL) ---');
  if (config.hasLeague) {
    for (const seg of SEGMENTS) {
      const url = `${BASE}/games/ffl/seasons/${config.season}/segments/${seg}/leagues/${config.leagueId}`;
      const label = `segments/${seg}`;
      process.stdout.write(`  ${label.padEnd(40)} `);
      const { res, outcome } = await probeUrl(client, url, label);
      allResults.push({ section: 'segments', segment: seg, ...outcome });
      console.log(describe(res));
    }
  } else {
    console.log('  (skipped — no LEAGUE_ID)');
  }

  // ─────────────────────────────────────────────
  // 3. Top-level resources under /games/ffl/
  // ─────────────────────────────────────────────
  console.log('\n--- 3. Top-Level Resources under /games/ffl/ ---');
  for (const resource of TOP_LEVEL_RESOURCES) {
    const url = `${BASE}/games/ffl/${resource}`;
    const label = `ffl/${resource}`;
    process.stdout.write(`  ${label.padEnd(40)} `);
    const { res, outcome } = await probeUrl(client, url, label);
    allResults.push({ section: 'top-level-resources', resource, ...outcome });
    console.log(describe(res));
  }

  // ─────────────────────────────────────────────
  // 4. Season sub-resources
  // ─────────────────────────────────────────────
  console.log('\n--- 4. Season Sub-Resources ---');
  for (const sub of SEASON_SUBRESOURCES) {
    const url = `${BASE}/games/ffl/seasons/${config.season}/${sub}`;
    const label = `seasons/${config.season}/${sub}`;
    process.stdout.write(`  ${label.padEnd(50)} `);
    const { res, outcome } = await probeUrl(client, url, label);
    allResults.push({ section: 'season-subresources', sub, ...outcome });
    console.log(describe(res));
  }

  // ─────────────────────────────────────────────
  // 5. League sub-resources
  // ─────────────────────────────────────────────
  console.log('\n--- 5. League Sub-Resources ---');
  if (config.hasLeague) {
    const leagueBase = `${BASE}/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}`;
    for (const sub of LEAGUE_SUBRESOURCES) {
      const url = `${leagueBase}/${sub}`;
      const label = `leagues/${config.leagueId}/${sub}`;
      process.stdout.write(`  ${label.padEnd(50)} `);
      const { res, outcome } = await probeUrl(client, url, label);
      allResults.push({ section: 'league-subresources', sub, ...outcome });
      console.log(describe(res));
    }
  } else {
    console.log('  (skipped — no LEAGUE_ID)');
  }

  // ─────────────────────────────────────────────
  // 6. leagueHistory endpoint
  // ─────────────────────────────────────────────
  console.log('\n--- 6. leagueHistory Endpoint ---');
  if (config.hasLeague) {
    for (const year of [2024, 2023, 2022, 2020, 2018, 2015]) {
      const url = `${BASE}/games/ffl/leagueHistory/${config.leagueId}`;
      const label = `leagueHistory (season=${year})`;
      process.stdout.write(`  ${label.padEnd(40)} `);
      const { res, outcome } = await probeUrl(client, url, label, { seasonId: year });
      allResults.push({ section: 'league-history', year, ...outcome });
      console.log(describe(res));
    }
  } else {
    console.log('  (skipped — no LEAGUE_ID)');
  }

  // ─────────────────────────────────────────────
  // 7. proTeams — probe all available view params
  // ─────────────────────────────────────────────
  console.log('\n--- 7. proTeams Endpoint ---');
  const proTeamsUrl = `${BASE}/games/ffl/seasons/${config.season}/proTeams`;
  for (const view of ['mTeam', 'mRoster', 'mSchedule', 'mProTeams', 'proTeams', null]) {
    const params = view ? { view } : {};
    const label = `proTeams view=${view || '(none)'}`;
    process.stdout.write(`  ${label.padEnd(40)} `);
    const { res, outcome } = await probeUrl(client, proTeamsUrl, label, params);
    allResults.push({ section: 'proTeams', view, ...outcome });
    console.log(describe(res));
  }

  // ─────────────────────────────────────────────
  // Save all results
  // ─────────────────────────────────────────────
  const interesting = allResults.filter((r) => r.interesting);
  writeFileSync(
    join(resultsDir, 'endpoints-all.json'),
    JSON.stringify(allResults, null, 2)
  );
  writeFileSync(
    join(resultsDir, 'endpoints-interesting.json'),
    JSON.stringify(interesting, null, 2)
  );

  // Final report
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`\nTotal probed:   ${allResults.length}`);
  console.log(`Responded 200:  ${interesting.length}`);
  console.log(`\nWorking endpoints:`);
  for (const r of interesting) {
    console.log(`  ${r.label.padEnd(50)} keys=[${r.topLevelKeys.join(',')}]`);
  }
  console.log(`\nResults: results/endpoints-interesting.json`);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
