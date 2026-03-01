/**
 * schemas.js
 *
 * Response schema extractor and differ.
 *
 * Two modes:
 *   1. extract — fetch all known views, recursively extract their schema
 *                (field names, types, nesting depth) and save to results/
 *
 *   2. diff    — compare schemas of two saved result files and show
 *                what fields each view uniquely adds
 *
 * The schema format is a nested object where each leaf is a type string:
 *   { "id": "number", "name": "string", "roster": { "entries": "array[object]" } }
 *
 * Usage:
 *   node src/discovery/schemas.js               # extract mode (default)
 *   node src/discovery/schemas.js diff mTeam mRoster
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EspnClient } from '../client.js';
import config from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const resultsDir = join(root, 'results');

const KNOWN_VIEWS = [
  'mTeam', 'mRoster', 'mMatchup', 'mBoxscore', 'mSettings',
  'mSchedule', 'mDraftDetail', 'kona_player_info', 'players_wl',
  'mStatus', 'mLiveScoring', 'mPendingTransactions', 'mTransactions2',
  'mNav', 'mTopPerformers',
];

// ── Schema extraction ─────────────────────────────────────────────────────────

/**
 * Recursively walk any JSON value and produce a schema description.
 * Arrays are sampled (first element) to avoid huge output.
 */
function extractSchema(value, depth = 0, maxDepth = 8) {
  if (depth > maxDepth) return '...';

  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array[]';
    const sample = extractSchema(value[0], depth + 1, maxDepth);
    return `array[${typeof sample === 'object' ? 'object' : sample}]`;
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = extractSchema(v, depth + 1, maxDepth);
    }
    return result;
  }
  return typeof value;
}

/**
 * Flatten a schema into dot-notation paths for easy comparison.
 * { a: { b: "string" } } → { "a.b": "string" }
 */
function flattenSchema(schema, prefix = '') {
  const flat = {};
  if (typeof schema !== 'object' || schema === null) {
    flat[prefix] = schema;
    return flat;
  }
  for (const [k, v] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !String(v).startsWith('array')) {
      Object.assign(flat, flattenSchema(v, path));
    } else {
      flat[path] = v;
    }
  }
  return flat;
}

// ── Schema diffing ────────────────────────────────────────────────────────────

function diffSchemas(schemaA, schemaB, labelA, labelB) {
  const flatA = flattenSchema(schemaA);
  const flatB = flattenSchema(schemaB);

  const keysA = new Set(Object.keys(flatA));
  const keysB = new Set(Object.keys(flatB));

  const onlyInA = [...keysA].filter((k) => !keysB.has(k));
  const onlyInB = [...keysB].filter((k) => !keysA.has(k));
  const inBoth = [...keysA].filter((k) => keysB.has(k));
  const typeMismatches = inBoth.filter((k) => flatA[k] !== flatB[k]);

  return {
    [`only_in_${labelA}`]: onlyInA,
    [`only_in_${labelB}`]: onlyInB,
    in_both: inBoth.length,
    type_mismatches: typeMismatches.map((k) => ({
      path: k,
      [labelA]: flatA[k],
      [labelB]: flatB[k],
    })),
  };
}

// ── Modes ─────────────────────────────────────────────────────────────────────

async function extractMode() {
  const client = new EspnClient();
  const schemas = {};

  console.log('='.repeat(60));
  console.log('ESPN Fantasy API — Schema Extractor');
  console.log('='.repeat(60));
  console.log(`Extracting schemas for ${KNOWN_VIEWS.length} views...\n`);

  // Baseline (no view)
  console.log('Fetching baseline...');
  const baseRes = await client.get(client.leagueUrl());
  if (baseRes.ok) {
    schemas['_baseline'] = extractSchema(baseRes.body);
    console.log(`  baseline: ${Object.keys(schemas['_baseline']).length} top-level fields`);
  }

  for (const view of KNOWN_VIEWS) {
    process.stdout.write(`  ${view.padEnd(30)} `);
    const res = await client.get(client.leagueUrl(), { params: { view } });
    if (!res.ok) {
      console.log(`✗ HTTP ${res.status}`);
      schemas[view] = null;
      continue;
    }
    const schema = extractSchema(res.body);
    const flat = flattenSchema(schema);
    schemas[view] = schema;
    console.log(`✓ ${Object.keys(flat).length} fields`);
    writeFileSync(
      join(resultsDir, `schema-${view}.json`),
      JSON.stringify({ schema, flat }, null, 2)
    );
  }

  // Compute all pairwise diffs vs baseline
  console.log('\nComputing diffs vs baseline...');
  const baselineSchema = schemas['_baseline'];
  if (baselineSchema) {
    for (const view of KNOWN_VIEWS) {
      if (!schemas[view]) continue;
      const diff = diffSchemas(baselineSchema, schemas[view], 'baseline', view);
      const added = diff[`only_in_${view}`] || [];
      console.log(`  ${view.padEnd(30)} +${added.length} unique fields`);
      writeFileSync(
        join(resultsDir, `schema-diff-baseline-vs-${view}.json`),
        JSON.stringify(diff, null, 2)
      );
    }
  }

  // Save master schema index
  const index = {};
  for (const [view, schema] of Object.entries(schemas)) {
    if (!schema) { index[view] = null; continue; }
    index[view] = {
      topLevelKeys: Object.keys(schema),
      totalFields: Object.keys(flattenSchema(schema)).length,
    };
  }
  writeFileSync(join(resultsDir, 'schema-index.json'), JSON.stringify(index, null, 2));

  console.log('\nDone. Results saved to results/schema-*.json');
}

async function diffMode(viewA, viewB) {
  const pathA = join(resultsDir, `schema-${viewA}.json`);
  const pathB = join(resultsDir, `schema-${viewB}.json`);

  if (!existsSync(pathA)) {
    console.error(`Schema file not found: ${pathA}`);
    console.error('Run without arguments first to extract schemas.');
    process.exit(1);
  }
  if (!existsSync(pathB)) {
    console.error(`Schema file not found: ${pathB}`);
    process.exit(1);
  }

  const { schema: schemaA } = JSON.parse(readFileSync(pathA, 'utf8'));
  const { schema: schemaB } = JSON.parse(readFileSync(pathB, 'utf8'));

  const diff = diffSchemas(schemaA, schemaB, viewA, viewB);
  const outPath = join(resultsDir, `schema-diff-${viewA}-vs-${viewB}.json`);
  writeFileSync(outPath, JSON.stringify(diff, null, 2));

  console.log(`Schema diff: ${viewA} vs ${viewB}`);
  console.log(`  Only in ${viewA}: ${diff[`only_in_${viewA}`].length} fields`);
  console.log(`  Only in ${viewB}: ${diff[`only_in_${viewB}`].length} fields`);
  console.log(`  In both: ${diff.in_both}`);
  console.log(`  Type mismatches: ${diff.type_mismatches.length}`);
  console.log(`\nSaved to: ${outPath}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args[0] === 'diff' && args[1] && args[2]) {
  diffMode(args[1], args[2]).catch((err) => { console.error(err); process.exit(1); });
} else {
  extractMode().catch((err) => { console.error(err); process.exit(1); });
}
