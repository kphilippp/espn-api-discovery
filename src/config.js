import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Load .env manually (no dotenv dependency needed for simple key=value)
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

export const config = {
  espnS2: process.env.ESPN_S2 || '',
  swid: process.env.SWID || '',
  leagueId: process.env.LEAGUE_ID || '',
  season: parseInt(process.env.SEASON || '2024', 10),
  requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || '300', 10),

  // Base URLs
  baseUrl: 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl',
  playersUrl: 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons',

  get isAuthenticated() {
    return Boolean(this.espnS2 && this.swid);
  },

  get hasLeague() {
    return Boolean(this.leagueId);
  },
};

export default config;
