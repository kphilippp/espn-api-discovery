/**
 * filters.js
 *
 * X-Fantasy-Filter exhaustive mapper.
 *
 * Strategy:
 *   Phase 1 — Key discovery: for each candidate key, send
 *     X-Fantasy-Filter: { "<key>": { "value": true } }
 *     with the players endpoint (where filters are most impactful).
 *     Record whether the response changes.
 *
 *   Phase 2 — Value probing: for keys that produced a change,
 *     try multiple value types (bool, int, string, array, null)
 *     to understand what inputs they accept.
 *
 * Usage:  node src/discovery/filters.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EspnClient } from '../client.js';
import config from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const resultsDir = join(root, 'results');

function loadWordlist(filename) {
  const raw = readFileSync(join(root, 'wordlists', filename), 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function stableHash(body) {
  return JSON.stringify(body);
}

// Different probing values to test for each discovered key
const VALUE_PROBES = [
  { label: 'bool-true',   value: { value: true } },
  { label: 'bool-false',  value: { value: false } },
  { label: 'int-1',       value: { value: 1 } },
  { label: 'int-0',       value: { value: 0 } },
  { label: 'string-empty',value: { value: '' } },
  { label: 'array-empty', value: { value: [] } },
  { label: 'null',        value: { value: null } },
  // Nested object patterns seen in known filters
  { label: 'values-array-1', value: { values: [1, 2, 3] } },
  { label: 'values-array-str', value: { values: ['ACTIVE', 'INJURED'] } },
  { label: 'value-and-additional', value: { value: true, additional: true } },
];

async function probeKey(client, url, baselineHash, key, extraParams = {}) {
  const filter = JSON.stringify({ [key]: { value: true } });
  const res = await client.get(url, {
    params: extraParams,
    headers: { 'X-Fantasy-Filter': filter },
  });
  return {
    status: res.status,
    changed: res.ok && stableHash(res.body) !== baselineHash,
    body: res.body,
  };
}

async function run() {
  const client = new EspnClient();
  const candidates = loadWordlist('filter-keys.txt');

  // We'll test against the players endpoint (filters are most useful there)
  // and the league endpoint as secondary
  const playersUrl = client.playersUrl();
  const leagueUrl = client.leagueUrl();

  console.log('='.repeat(60));
  console.log('ESPN Fantasy API — X-Fantasy-Filter Mapper');
  console.log('='.repeat(60));
  console.log(`Filter key candidates: ${candidates.length}`);
  console.log(`Players URL: ${playersUrl}`);
  console.log(`League URL:  ${leagueUrl}`);
  console.log('');

  // Baseline: players endpoint with no filter
  console.log('Fetching baselines...');
  const playersBaseline = await client.get(playersUrl, {
    params: { view: 'kona_player_info' },
  });
  const leagueBaseline = await client.get(leagueUrl);

  if (!playersBaseline.ok) {
    console.warn(`Players baseline: HTTP ${playersBaseline.status} — may need auth`);
  }
  if (!leagueBaseline.ok) {
    console.error(`League baseline: HTTP ${leagueBaseline.status}`);
    process.exit(1);
  }

  const playersHash = stableHash(playersBaseline.body);
  const leagueHash = stableHash(leagueBaseline.body);
  console.log(`  Players baseline: ${playersHash.length} chars`);
  console.log(`  League baseline:  ${leagueHash.length} chars\n`);

  const discovered = [];
  const noOp = [];
  const errors = [];

  // Phase 1: Key discovery
  console.log('--- Phase 1: Key Discovery ---\n');
  for (let i = 0; i < candidates.length; i++) {
    const key = candidates[i];
    const progress = `[${String(i + 1).padStart(3)}/${candidates.length}]`;
    process.stdout.write(`${progress} filter key="${key.padEnd(35)}" `);

    // Try against players endpoint first (most impactful)
    const filter = JSON.stringify({ [key]: { value: true } });

    let playersResult = { status: 'skipped', changed: false };
    if (playersBaseline.ok) {
      const r = await client.get(playersUrl, {
        params: { view: 'kona_player_info' },
        headers: { 'X-Fantasy-Filter': filter },
      });
      playersResult = {
        status: r.status,
        changed: r.ok && stableHash(r.body) !== playersHash,
        sizeBytes: r.ok ? stableHash(r.body).length : 0,
      };
    }

    // Also try against league endpoint
    const leagueRes = await client.get(leagueUrl, {
      headers: { 'X-Fantasy-Filter': filter },
    });
    const leagueChanged = leagueRes.ok && stableHash(leagueRes.body) !== leagueHash;

    const anyChange = playersResult.changed || leagueChanged;
    const anyError = (playersResult.status !== 'skipped' && playersResult.status !== 200)
      && leagueRes.status !== 200;

    if (anyError) {
      errors.push({ key, playersStatus: playersResult.status, leagueStatus: leagueRes.status });
      console.log(`✗ error (players=${playersResult.status}, league=${leagueRes.status})`);
    } else if (anyChange) {
      const entry = {
        key,
        playersChanged: playersResult.changed,
        leagueChanged,
        // Store bodies for phase 2 analysis
        playersSampleBody: playersResult.changed ? leagueRes.body : null,
        leagueSampleBody: leagueChanged ? leagueRes.body : null,
      };
      discovered.push(entry);
      client.save(`filters-discovered-${key}`, {
        ...entry,
        filter,
        leagueBody: leagueRes.body,
      });
      const where = [
        playersResult.changed ? 'players' : null,
        leagueChanged ? 'league' : null,
      ].filter(Boolean).join('+');
      console.log(`✓ DISCOVERED  changed in: ${where}`);
    } else {
      noOp.push(key);
      console.log(`~ no-op`);
    }
  }

  // Phase 2: Value probing for discovered keys
  if (discovered.length > 0) {
    console.log('\n--- Phase 2: Value Probing for Discovered Keys ---\n');
    const valueProbeResults = {};

    for (const { key } of discovered) {
      console.log(`  Probing values for key: ${key}`);
      valueProbeResults[key] = [];

      for (const probe of VALUE_PROBES) {
        const filter = JSON.stringify({ [key]: probe.value });
        const r = await client.get(leagueUrl, {
          headers: { 'X-Fantasy-Filter': filter },
        });
        const changed = r.ok && stableHash(r.body) !== leagueHash;
        const result = { probe: probe.label, status: r.status, changed, filter };
        valueProbeResults[key].push(result);
        console.log(`    ${probe.label.padEnd(25)} HTTP ${r.status} changed=${changed}`);
      }
    }

    client.save('filters-value-probes', valueProbeResults);
  }

  // Save summary
  const summary = {
    testedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    discovered: discovered.map((d) => ({
      key: d.key,
      playersChanged: d.playersChanged,
      leagueChanged: d.leagueChanged,
    })),
    noOp,
    errors,
  };
  writeFileSync(join(resultsDir, 'filters-summary.json'), JSON.stringify(summary, null, 2));

  // Final report
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`\n✓ DISCOVERED keys (${discovered.length}):`);
  for (const d of discovered) {
    const where = [d.playersChanged ? 'players' : null, d.leagueChanged ? 'league' : null]
      .filter(Boolean).join(', ');
    console.log(`  ${d.key.padEnd(35)} in: ${where}`);
  }
  console.log(`\n~ NO-OP keys: ${noOp.length}`);
  console.log(`✗ ERROR keys: ${errors.length}`);
  console.log(`\nResults: results/filters-summary.json`);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
