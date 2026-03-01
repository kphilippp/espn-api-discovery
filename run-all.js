/**
 * run-all.js
 *
 * Runs all ESPN API discovery scripts in sequence, streaming their output
 * live. Prints a final summary table of pass/fail and elapsed time per script.
 *
 * Usage:  node run-all.js
 *    or:  npm run discover
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCRIPTS = [
  { name: 'baseline',   path: 'src/discovery/baseline.js',  desc: 'Map all known views' },
  { name: 'endpoints',  path: 'src/discovery/endpoints.js', desc: 'Probe URL patterns' },
  { name: 'views',      path: 'src/discovery/views.js',     desc: 'Fuzz view parameters (~200 candidates)' },
  { name: 'filters',    path: 'src/discovery/filters.js',   desc: 'Map X-Fantasy-Filter keys' },
  { name: 'history',    path: 'src/discovery/history.js',   desc: 'Find historical data boundaries' },
  { name: 'schemas',    path: 'src/discovery/schemas.js',   desc: 'Extract + diff response schemas' },
];

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function fmt(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function runScript(scriptPath) {
  return new Promise((resolve) => {
    const fullPath = join(__dirname, scriptPath);
    const child = spawn(process.execPath, [fullPath], {
      stdio: 'inherit',
      env: process.env,
    });

    const t0 = Date.now();
    child.on('close', (code) => {
      resolve({ code, elapsed: Date.now() - t0 });
    });
    child.on('error', (err) => {
      console.error(`  Failed to start ${scriptPath}: ${err.message}`);
      resolve({ code: 1, elapsed: Date.now() - t0 });
    });
  });
}

async function run() {
  const totalStart = Date.now();

  console.log(`\n${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`${BOLD}  ESPN Fantasy API — Full Discovery Run${RESET}`);
  console.log(`${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`  ${DIM}${SCRIPTS.length} scripts · results saved to results/${RESET}\n`);

  const results = [];

  for (let i = 0; i < SCRIPTS.length; i++) {
    const script = SCRIPTS[i];
    const num = `[${i + 1}/${SCRIPTS.length}]`;

    console.log(`${CYAN}${BOLD}${num} ${script.name}${RESET}${DIM} — ${script.desc}${RESET}`);
    console.log(`${'─'.repeat(62)}`);

    const { code, elapsed } = await runScript(script.path);
    results.push({ ...script, code, elapsed });

    const status = code === 0
      ? `${GREEN}${BOLD}PASSED${RESET}`
      : `${RED}${BOLD}FAILED (exit ${code})${RESET}`;
    console.log(`${'─'.repeat(62)}`);
    console.log(`${num} ${script.name}: ${status} ${DIM}(${fmt(elapsed)})${RESET}\n`);
  }

  const totalElapsed = Date.now() - totalStart;
  const passed = results.filter((r) => r.code === 0);
  const failed = results.filter((r) => r.code !== 0);

  // ── Final summary table ────────────────────────────────────────────────────
  console.log(`\n${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`${BOLD}  RESULTS${RESET}`);
  console.log(`${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`  ${'Script'.padEnd(14)} ${'Status'.padEnd(10)} Time`);
  console.log(`  ${'─'.repeat(40)}`);

  for (const r of results) {
    const status = r.code === 0
      ? `${GREEN}✓ passed${RESET}`
      : `${RED}✗ failed${RESET}`;
    console.log(`  ${r.name.padEnd(14)} ${status.padEnd(19)} ${DIM}${fmt(r.elapsed)}${RESET}`);
  }

  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  ${passed.length}/${SCRIPTS.length} passed  ${DIM}total: ${fmt(totalElapsed)}${RESET}`);

  if (failed.length > 0) {
    console.log(`\n${YELLOW}  Failed scripts:${RESET}`);
    for (const r of failed) {
      console.log(`  ${RED}✗ ${r.name}${RESET} — check output above for errors`);
    }
  }

  console.log(`\n${BOLD}  Next step:${RESET}`);
  console.log(`  ${CYAN}node src/report/generate-guide.js${RESET}`);
  console.log(`  ${DIM}Reads results/ and generates ESPN-API-GUIDE.md${RESET}\n`);

  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
