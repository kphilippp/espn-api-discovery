/**
 * history.js
 *
 * Historical data boundary finder.
 *
 * Uses binary search to efficiently find the oldest accessible season,
 * then probes each reachable season to catalog which views/data degrade
 * or disappear over time.
 *
 * Also probes:
 *   - leagueHistory endpoint (different URL structure for historical data)
 *   - How far back the players endpoint goes
 *   - What data ESPN restricted post-2025
 *
 * Usage:  node src/discovery/history.js
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EspnClient } from '../client.js';
import config from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(__dirname, '..', '..', 'results');

const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const EARLIEST_POSSIBLE = 1999;
const LATEST_SEASON = config.season;

// Views to test for each accessible season
const PROBE_VIEWS = ['mTeam', 'mRoster', 'mMatchup', 'mSettings', 'mDraftDetail'];

async function isSeasonAccessible(client, season) {
  const url = `${BASE}/seasons/${season}/segments/0/leagues/${config.leagueId}`;
  const res = await client.get(url, { params: { view: 'mSettings' } });
  return { accessible: res.status === 200, status: res.status, body: res.body };
}

async function isSeasonAccessiblePublic(client, season) {
  // Public endpoint — no league needed
  const url = `${BASE}/seasons/${season}/players`;
  const res = await client.get(url, {
    params: { view: 'kona_player_info' },
    headers: { 'X-Fantasy-Filter': JSON.stringify({ players: { limit: 5 } }) },
  });
  return { accessible: res.status === 200, status: res.status, count: Array.isArray(res.body) ? res.body.length : null };
}

async function binarySearchOldest(client, lo, hi, checkFn) {
  let oldest = hi;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    process.stdout.write(`    binary search: season ${mid} ... `);
    const { accessible, status } = await checkFn(client, mid);
    console.log(`HTTP ${status} — ${accessible ? 'accessible' : 'not accessible'}`);
    if (accessible) {
      oldest = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return oldest;
}

async function probeViewsForSeason(client, season) {
  if (!config.hasLeague) return {};

  const results = {};
  const url = `${BASE}/seasons/${season}/segments/0/leagues/${config.leagueId}`;

  for (const view of PROBE_VIEWS) {
    const res = await client.get(url, { params: { view } });
    results[view] = {
      status: res.status,
      ok: res.ok,
      hasData: res.ok && res.body && typeof res.body === 'object' && Object.keys(res.body).length > 1,
      topKeys: res.ok && res.body ? Object.keys(res.body) : [],
    };
  }
  return results;
}

async function run() {
  const client = new EspnClient();
  const report = {
    testedAt: new Date().toISOString(),
    league: config.leagueId || 'none',
    latestSeason: LATEST_SEASON,
    oldestLeagueSeason: null,
    oldestPlayersSeason: null,
    seasonBreakdown: [],
    leagueHistoryEndpoint: {},
  };

  console.log('='.repeat(60));
  console.log('ESPN Fantasy API — Historical Boundary Finder');
  console.log('='.repeat(60));
  console.log(`League:        ${config.leagueId || '(none)'}`);
  console.log(`Latest season: ${LATEST_SEASON}`);
  console.log('');

  // ─────────────────────────────────────────────
  // 1. Find oldest accessible players endpoint (public, no league needed)
  // ─────────────────────────────────────────────
  console.log('--- 1. Binary search: oldest accessible players season ---');
  const oldestPlayers = await binarySearchOldest(
    client, EARLIEST_POSSIBLE, LATEST_SEASON, isSeasonAccessiblePublic
  );
  report.oldestPlayersSeason = oldestPlayers;
  console.log(`  → Oldest players season: ${oldestPlayers}\n`);

  // ─────────────────────────────────────────────
  // 2. Find oldest accessible league season (if LEAGUE_ID set)
  // ─────────────────────────────────────────────
  if (config.hasLeague) {
    console.log('--- 2. Binary search: oldest accessible league season ---');
    const oldestLeague = await binarySearchOldest(
      client, EARLIEST_POSSIBLE, LATEST_SEASON, isSeasonAccessible
    );
    report.oldestLeagueSeason = oldestLeague;
    console.log(`  → Oldest league season: ${oldestLeague}\n`);
  } else {
    console.log('--- 2. League binary search (skipped — no LEAGUE_ID) ---\n');
  }

  // ─────────────────────────────────────────────
  // 3. Per-season view breakdown (all accessible seasons)
  // ─────────────────────────────────────────────
  if (config.hasLeague && report.oldestLeagueSeason) {
    console.log('--- 3. Per-season view breakdown ---');
    const seasons = [];
    for (let y = report.oldestLeagueSeason; y <= LATEST_SEASON; y++) seasons.push(y);

    for (const season of seasons) {
      process.stdout.write(`  Season ${season}: `);
      const viewResults = await probeViewsForSeason(client, season);
      const workingViews = Object.entries(viewResults)
        .filter(([, r]) => r.ok && r.hasData)
        .map(([v]) => v);
      const brokenViews = Object.entries(viewResults)
        .filter(([, r]) => !r.ok || !r.hasData)
        .map(([v]) => v);

      report.seasonBreakdown.push({ season, workingViews, brokenViews, viewDetails: viewResults });
      console.log(`${workingViews.length}/${PROBE_VIEWS.length} views working — [${workingViews.join(', ')}]`);
    }
    console.log('');
  }

  // ─────────────────────────────────────────────
  // 4. leagueHistory endpoint probe
  // ─────────────────────────────────────────────
  console.log('--- 4. leagueHistory Endpoint ---');
  if (config.hasLeague) {
    const historyUrl = `${BASE}/leagueHistory/${config.leagueId}`;
    const testYears = [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2015, 2010, 2005, 2002];

    for (const year of testYears) {
      process.stdout.write(`  leagueHistory?seasonId=${year} ... `);
      const res = await client.get(historyUrl, { params: { seasonId: year, view: 'mSettings' } });
      const ok = res.status === 200;
      const hasData = ok && Array.isArray(res.body) && res.body.length > 0;
      report.leagueHistoryEndpoint[year] = {
        status: res.status,
        ok,
        hasData,
        topKeys: ok && res.body && res.body[0] ? Object.keys(res.body[0]) : [],
      };
      console.log(`HTTP ${res.status} ${hasData ? '— has data' : '— empty/error'}`);
    }
  } else {
    console.log('  (skipped — no LEAGUE_ID)');
  }

  // ─────────────────────────────────────────────
  // 5. Players endpoint year-by-year (around known restriction point)
  // ─────────────────────────────────────────────
  console.log('\n--- 5. Players endpoint: detailed year probe ---');
  const yearsToProbe = Array.from({ length: 10 }, (_, i) => LATEST_SEASON - i).reverse();
  const playersBoundary = [];
  for (const year of yearsToProbe) {
    process.stdout.write(`  players/${year}: `);
    const res = await client.get(`${BASE}/seasons/${year}/players`, {
      params: { view: 'kona_player_info' },
      headers: { 'X-Fantasy-Filter': JSON.stringify({ players: { limit: 5 } }) },
    });
    const count = Array.isArray(res.body) ? res.body.length : (res.body?.players?.length ?? null);
    playersBoundary.push({ year, status: res.status, ok: res.ok, playerCount: count });
    console.log(`HTTP ${res.status}  players=${count ?? '?'}`);
  }
  report.playersBoundary = playersBoundary;

  // ─────────────────────────────────────────────
  // Save report
  // ─────────────────────────────────────────────
  writeFileSync(join(resultsDir, 'history-report.json'), JSON.stringify(report, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Oldest players season: ${report.oldestPlayersSeason}`);
  console.log(`Oldest league season:  ${report.oldestLeagueSeason ?? '(not tested)'}`);
  if (report.seasonBreakdown.length > 0) {
    const allGood = report.seasonBreakdown.filter((s) => s.brokenViews.length === 0);
    const degraded = report.seasonBreakdown.filter((s) => s.brokenViews.length > 0);
    console.log(`Seasons with all views working: ${allGood.length}`);
    console.log(`Seasons with degraded data: ${degraded.length}`);
    if (degraded.length > 0) {
      console.log('Degraded seasons:');
      for (const s of degraded) {
        console.log(`  ${s.season}: broken=[${s.brokenViews.join(', ')}]`);
      }
    }
  }
  console.log(`\nFull report: results/history-report.json`);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
