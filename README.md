# ESPN Fantasy API Discovery

A systematic toolkit for reverse-engineering and documenting the undocumented ESPN Fantasy Football API. The community has mapped a handful of endpoints — this project tries to find everything else.

## Background

ESPN runs a private, undocumented REST API that powers their fantasy sports platform. The community has reverse-engineered parts of it over the years, but large swaths remain unknown:

- Hidden `view` parameters that unlock different data payloads
- The full spec of the `X-Fantasy-Filter` header
- Undiscovered endpoint paths and sub-resources
- How far back historical data actually goes
- What data ESPN quietly restricted post-2025

This project automates the discovery process with a suite of focused scripts. Each script probes a specific dimension of the API, saves raw results to `results/`, and prints a human-readable summary.

---

## Known API Basics

| Thing | Value |
|---|---|
| Base URL | `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl` |
| League endpoint | `/seasons/{year}/segments/0/leagues/{leagueId}` |
| Players endpoint | `/seasons/{year}/players` |
| Historical endpoint | `/leagueHistory/{leagueId}?seasonId={year}` |
| Auth cookies | `espn_s2` and `SWID` (from browser DevTools after login) |

---

## Setup

### Prerequisites
- Node.js 18+

### Install

```bash
git clone https://github.com/yourusername/espn-api-discovery.git
cd espn-api-discovery
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required for private league endpoints
ESPN_S2=your_espn_s2_cookie
SWID={your-swid-guid}
LEAGUE_ID=your_league_id

# Season to target (default: 2024)
SEASON=2024

# Delay between requests in ms (default: 300, lower = faster but riskier)
REQUEST_DELAY_MS=300
```

**Where to get your cookies:**
1. Log in to [fantasy.espn.com](https://fantasy.espn.com)
2. Open DevTools → Application → Cookies → `fantasy.espn.com`
3. Copy the values for `espn_s2` and `SWID`

> Without credentials, scripts that target league-specific endpoints will fail or return no data. Scripts that target the players endpoint work without auth.

---

## Scripts

### 1. Baseline Mapper
```bash
node src/discovery/baseline.js
```
Queries all **15 known views** against your league and season. Shows which views actually return different data vs the no-view response, what top-level keys each view adds, and response sizes. **Start here** to establish a working baseline before running the fuzzers.

---

### 2. View Parameter Fuzzer
```bash
node src/discovery/views.js
```
Fires ~200 candidate `view=` parameter values at the league endpoint (from `wordlists/view-names.txt`) and classifies each as:

- `✓ DISCOVERED` — 200 OK, response differs from baseline (new data found)
- `~ no-op` — 200 OK but identical to no-view response
- `✗ error` — non-200 status

Saves full responses for discovered views to `results/views-discovered-{view}.json`.

---

### 3. X-Fantasy-Filter Mapper
```bash
node src/discovery/filters.js
```
Two-phase probe of the `X-Fantasy-Filter` request header:

**Phase 1 — Key discovery:** Tests ~80 candidate filter keys (from `wordlists/filter-keys.txt`) against both the players and league endpoints. Identifies which keys change the response.

**Phase 2 — Value probing:** For each discovered key, tries multiple value shapes (`bool`, `int`, `string`, `array`, `null`, nested objects) to understand what inputs are valid.

---

### 4. Endpoint URL Prober
```bash
node src/discovery/endpoints.js
```
Systematically probes URL pattern variations:

- **Game types** — Tests `fba`, `flb`, `flba`, `fhs`, etc. to see if non-football sports share the same structure
- **Segment IDs** — Tests segments 0–4 (only 0 is documented)
- **Top-level resources** — Tries `/players`, `/proTeams`, `/news`, `/injuries`, `/rankings`, etc.
- **Season sub-resources** — Paths under `/seasons/{year}/`
- **League sub-resources** — Paths under `/leagues/{id}/` like `/members`, `/messages`, `/activity`
- **proTeams endpoint** — Explores the under-documented pro teams resource

---

### 5. Schema Extractor & Differ
```bash
# Extract schemas for all known views
node src/discovery/schemas.js

# Diff two specific views
node src/discovery/schemas.js diff mTeam mRoster
```
Recursively walks every response and produces a typed schema (field names + types at every depth). Then diffs any two schemas to show exactly what fields each view uniquely contributes. Useful for understanding the data model and spotting overlap.

---

### 6. Historical Boundary Finder
```bash
node src/discovery/history.js
```
Uses **binary search** to efficiently find the oldest accessible season without hitting every year. Then:
- Probes each reachable season to see which views still return data vs return empty
- Maps data degradation over time (what ESPN has locked off)
- Tests the `leagueHistory` endpoint structure for all accessible years

---

## Results

All output lands in `results/` (gitignored). Key files:

| File | Contents |
|---|---|
| `baseline-summary.json` | Working/broken views with key counts |
| `views-summary.json` | Fuzzer results: discovered, no-op, errors |
| `views-discovered-{view}.json` | Full response body for each discovered view |
| `filters-summary.json` | Discovered filter keys and where they work |
| `filters-value-probes.json` | Which value types each filter key accepts |
| `endpoints-interesting.json` | All endpoints that returned HTTP 200 |
| `schema-{view}.json` | Full typed schema + flat field list |
| `schema-diff-{a}-vs-{b}.json` | Field-level diff between two views |
| `history-report.json` | Oldest seasons, per-year view breakdown |

---

## Wordlists

The fuzzing candidates live in `wordlists/` — edit these to add your own guesses:

- `view-names.txt` — `view=` parameter candidates, drawn from known naming patterns (`mTeam`, `kona_*`, etc.)
- `filter-keys.txt` — `X-Fantasy-Filter` key candidates

---

## Community Resources

- [cwendt94/espn-api](https://github.com/cwendt94/espn-api) — Python library, most comprehensive
- [Steven Morse's v3 guide](https://stmorse.github.io/journal/espn-fantasy-v3.html) — best written intro
- [nntrn endpoint gist](https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c) — endpoint reference
- [ffscrapr ESPN docs](https://ffscrapr.ffverse.com/articles/espn_getendpoint.html) — R library docs
