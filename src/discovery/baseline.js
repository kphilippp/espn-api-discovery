/**
 * baseline.js
 *
 * Queries all well-known ESPN Fantasy Football views against the configured
 * league and season. Saves each response to results/ and prints a summary
 * table showing fields returned, response size, and HTTP status.
 *
 * Usage:  node src/discovery/baseline.js
 */

import { EspnClient } from '../client.js';
import config from '../config.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(__dirname, '..', '..', 'results');

// All views the community has documented
const KNOWN_VIEWS = [
  'mTeam',
  'mRoster',
  'mMatchup',
  'mBoxscore',
  'mSettings',
  'mSchedule',
  'mDraftDetail',
  'kona_player_info',
  'players_wl',
  'mStatus',
  'mLiveScoring',
  'mPendingTransactions',
  'mTransactions2',
  'mNav',
  'mTopPerformers',
];

function extractTopLevelKeys(body) {
  if (!body || typeof body !== 'object') return [];
  return Object.keys(body);
}

function roughSize(body) {
  return JSON.stringify(body).length;
}

async function run() {
  const client = new EspnClient();

  console.log('='.repeat(60));
  console.log('ESPN Fantasy API — Baseline View Mapper');
  console.log('='.repeat(60));
  console.log(`League:  ${config.leagueId || '(none — using public test)'}`);
  console.log(`Season:  ${config.season}`);
  console.log(`Auth:    ${config.isAuthenticated ? 'YES (cookies set)' : 'NO (public only)'}`);
  console.log('');

  if (!config.hasLeague) {
    console.warn('WARNING: No LEAGUE_ID set. League-specific views will fail.');
    console.warn('Set LEAGUE_ID in your .env to test league views.\n');
  }

  // First, get the no-view baseline so we can detect which views add data
  console.log('Fetching no-view baseline...');
  const baselineRes = await client.get(client.leagueUrl(), { params: {} });
  const baselineKeys = extractTopLevelKeys(baselineRes.body);
  console.log(`  Status: ${baselineRes.status} | Keys: [${baselineKeys.join(', ')}] | Size: ${roughSize(baselineRes.body)} bytes\n`);

  client.save('baseline-no-view', {
    url: baselineRes.url,
    status: baselineRes.status,
    topLevelKeys: baselineKeys,
    body: baselineRes.body,
  });

  // Now probe each known view
  const summary = [];

  for (const view of KNOWN_VIEWS) {
    process.stdout.write(`  Testing view=${view} ... `);
    const res = await client.get(client.leagueUrl(), { params: { view } });

    const keys = extractTopLevelKeys(res.body);
    const newKeys = keys.filter((k) => !baselineKeys.includes(k));
    const size = roughSize(res.body);
    const changed = size !== roughSize(baselineRes.body);

    const entry = {
      view,
      status: res.status,
      topLevelKeys: keys,
      newKeysBeyondBaseline: newKeys,
      responseSizeBytes: size,
      changedFromBaseline: changed,
      url: res.url,
    };
    summary.push(entry);

    // Save full response
    if (res.status === 200) {
      client.save(`baseline-view-${view}`, { ...entry, body: res.body });
    }

    const marker = res.status === 200 ? (changed ? '✓ NEW DATA' : '~ same') : `✗ ${res.status}`;
    console.log(`${marker} | keys=[${newKeys.join(',') || 'none new'}] | ${size} bytes`);
  }

  // Save summary
  const summaryPath = join(resultsDir, 'baseline-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const working = summary.filter((s) => s.status === 200 && s.changedFromBaseline);
  const noData = summary.filter((s) => s.status === 200 && !s.changedFromBaseline);
  const failed = summary.filter((s) => s.status !== 200);

  console.log(`Working views (add data): ${working.length}`);
  for (const s of working) {
    console.log(`  ${s.view.padEnd(25)} new keys: [${s.newKeysBeyondBaseline.join(', ')}]`);
  }
  console.log(`\nNo-op views (same as baseline): ${noData.length}`);
  for (const s of noData) console.log(`  ${s.view}`);

  console.log(`\nFailed views: ${failed.length}`);
  for (const s of failed) console.log(`  ${s.view.padEnd(25)} status: ${s.status}`);

  console.log(`\nResults saved to: results/`);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
