import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(__dirname, '..', 'results');

if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Core ESPN API client.
 * Handles auth cookies, rate limiting, retries, and result persistence.
 */
export class EspnClient {
  constructor(overrides = {}) {
    this.espnS2 = overrides.espnS2 ?? config.espnS2;
    this.swid = overrides.swid ?? config.swid;
    this.delayMs = overrides.delayMs ?? config.requestDelayMs;
    this._lastRequest = 0;
  }

  get cookieHeader() {
    const parts = [];
    if (this.espnS2) parts.push(`espn_s2=${this.espnS2}`);
    if (this.swid) parts.push(`SWID=${this.swid}`);
    return parts.join('; ');
  }

  /**
   * Make a GET request to any ESPN API URL.
   * @param {string} url - Full URL
   * @param {Object} options
   * @param {Object} options.params - Query params (appended to URL)
   * @param {Object} options.headers - Extra headers (e.g. X-Fantasy-Filter)
   * @param {number} options.retries - Number of retries on 429/5xx
   * @returns {{ status, headers, body, url, durationMs }}
   */
  async get(url, { params = {}, headers = {}, retries = 3 } = {}) {
    // Enforce delay between requests
    const now = Date.now();
    const elapsed = now - this._lastRequest;
    if (elapsed < this.delayMs) await sleep(this.delayMs - elapsed);
    this._lastRequest = Date.now();

    // Build URL with query params
    const fullUrl = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const item of v) fullUrl.searchParams.append(k, item);
      } else {
        fullUrl.searchParams.set(k, v);
      }
    }

    const reqHeaders = {
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-PROD-m.fantasy.espn.com',
      ...headers,
    };
    if (this.cookieHeader) reqHeaders['Cookie'] = this.cookieHeader;

    let attempt = 0;
    while (attempt <= retries) {
      const t0 = Date.now();
      let res;
      try {
        res = await fetch(fullUrl.toString(), { headers: reqHeaders });
      } catch (err) {
        if (attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          attempt++;
          continue;
        }
        throw err;
      }

      const durationMs = Date.now() - t0;

      // Handle rate limit
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
        console.warn(`  [429] Rate limited. Waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        attempt++;
        continue;
      }

      // Parse body
      let body = null;
      const ct = res.headers.get('content-type') || '';
      try {
        body = ct.includes('json') ? await res.json() : await res.text();
      } catch {
        body = null;
      }

      return {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
        body,
        url: fullUrl.toString(),
        durationMs,
      };
    }
  }

  /**
   * Save a result object to results/{filename}.json
   */
  save(filename, data) {
    const fp = join(resultsDir, filename.endsWith('.json') ? filename : `${filename}.json`);
    writeFileSync(fp, JSON.stringify(data, null, 2));
    return fp;
  }

  /**
   * Build the standard league endpoint URL.
   */
  leagueUrl(leagueId = config.leagueId, season = config.season) {
    return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
  }

  /**
   * Build the players endpoint URL.
   */
  playersUrl(season = config.season) {
    return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players`;
  }
}

export default new EspnClient();
