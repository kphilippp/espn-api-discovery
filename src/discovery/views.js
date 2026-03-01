/**
 * views.js
 *
 * View parameter fuzzer. Tries every candidate view name from the wordlist
 * against the league endpoint and detects which ones produce different
 * responses vs. the no-view baseline.
 *
 * Classification:
 *   DISCOVERED  — 200, response differs from no-view baseline
 *   NO_OP       — 200, response identical to no-view baseline
 *   ERROR       — non-200 status
 *
 * Usage:  node src/discovery/views.js
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
  // Simple stable representation for comparison
  return JSON.stringify(body);
}

function getTopLevelKeys(body) {
  if (!body || typeof body !== 'object') return [];
  return Object.keys(body);
}

function diffKeys(a, b) {
  const aKeys = new Set(getTopLevelKeys(a));
  const bKeys = new Set(getTopLevelKeys(b));
  return {
    added: [...bKeys].filter((k) => !aKeys.has(k)),
    removed: [...aKeys].filter((k) => !bKeys.has(k)),
  };
}

async function run() {
  const client = new EspnClient();
  const candidates = loadWordlist('view-names.txt');

  console.log('='.repeat(60));
  console.log('ESPN Fantasy API — View Parameter Fuzzer');
  console.log('='.repeat(60));
  console.log(`Candidates: ${candidates.length}`);
  console.log(`League:     ${config.leagueId || '(none)'}`);
  console.log(`Season:     ${config.season}`);
  console.log(`Auth:       ${config.isAuthenticated ? 'YES' : 'NO'}`);
  console.log('');

  if (!config.hasLeague) {
    console.warn('WARNING: No LEAGUE_ID set. Results will be limited.\n');
  }

  // Baseline: no view param
  console.log('Fetching baseline (no view)...');
  const baselineRes = await client.get(client.leagueUrl());
  if (!baselineRes.ok) {
    console.error(`Baseline request failed: HTTP ${baselineRes.status}`);
    console.error('Check your LEAGUE_ID and credentials.');
    process.exit(1);
  }
  const baselineHash = stableHash(baselineRes.body);
  const baselineKeys = getTopLevelKeys(baselineRes.body);
  console.log(`  Baseline keys: [${baselineKeys.join(', ')}]`);
  console.log(`  Baseline size: ${baselineHash.length} chars\n`);

  const discovered = [];
  const noOp = [];
  const errors = [];

  for (let i = 0; i < candidates.length; i++) {
    const view = candidates[i];
    const progress = `[${String(i + 1).padStart(3)}/${candidates.length}]`;
    process.stdout.write(`${progress} view=${view.padEnd(35)} `);

    const res = await client.get(client.leagueUrl(), { params: { view } });

    if (!res.ok) {
      const entry = { view, status: res.status, body: res.body };
      errors.push(entry);
      console.log(`✗ HTTP ${res.status}`);
      continue;
    }

    const hash = stableHash(res.body);
    if (hash === baselineHash) {
      noOp.push({ view, status: res.status });
      console.log(`~ no-op`);
      continue;
    }

    // Different from baseline — log it as a discovery
    const diff = diffKeys(baselineRes.body, res.body);
    const sizeChange = hash.length - baselineHash.length;
    const sizeMarker = sizeChange > 0 ? `+${sizeChange}` : `${sizeChange}`;
    const entry = {
      view,
      status: res.status,
      keysAdded: diff.added,
      keysRemoved: diff.removed,
      sizeChangedBy: sizeChange,
      body: res.body,
      url: res.url,
    };
    discovered.push(entry);

    // Save full response for discovered views
    client.save(`views-discovered-${view}`, entry);

    const keyInfo = diff.added.length ? `+keys:[${diff.added.join(',')}]` : 'data changed';
    console.log(`✓ DISCOVERED  size=${sizeMarker}  ${keyInfo}`);
  }

  // Save consolidated results
  const summary = {
    testedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    discovered: discovered.map((d) => ({
      view: d.view,
      status: d.status,
      keysAdded: d.keysAdded,
      keysRemoved: d.keysRemoved,
      sizeChangedBy: d.sizeChangedBy,
    })),
    noOp: noOp.map((d) => d.view),
    errors: errors.map((d) => ({ view: d.view, status: d.status })),
  };
  const summaryPath = join(resultsDir, 'views-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  // Print final report
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`\n✓ DISCOVERED (${discovered.length} views):`);
  for (const d of discovered) {
    console.log(`  ${d.view.padEnd(30)} added=[${d.keysAdded.join(', ')}]  size${d.sizeChangedBy > 0 ? '+' : ''}${d.sizeChangedBy}`);
  }
  console.log(`\n~ NO-OP (${noOp.length} views — same as baseline)`);
  console.log(`✗ ERRORS (${errors.length} views)`);
  for (const e of errors) {
    console.log(`  ${e.view.padEnd(30)} HTTP ${e.status}`);
  }
  console.log(`\nFull results: results/views-summary.json`);
  console.log(`Full responses for discovered views: results/views-discovered-*.json`);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
