# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SNIPER is a deterministic meme coin evaluation platform for Solana tokens. It's a rule-based system (not ML) that enforces consistency through hard filters and category scoring.

**Core Philosophy:**
- Rules are immutable and versioned
- Outcomes never affect future evaluations (append-only)
- Everything is logged for audit
- Binary verdicts: APPROVE (≥4.20) or REJECT (<4.20)

## Development Commands

### Backend (Express.js)

```bash
cd sniper
npm install
cp .env.example .env  # Configure database and API settings
npm run dev           # Development with nodemon
npm start             # Production
```

Backend runs at `http://localhost:3000`

### Frontend (React + Vite)

```bash
cd sniper-frontend
npm install
cp .env.example .env  # Set VITE_API_BASE
npm run dev           # Development server
npm run build         # Production build
npm run preview       # Preview production build
```

Frontend runs at `http://localhost:5173`

### Database Setup

Run the schema SQL in Supabase SQL Editor (file should be in project root as `sniper_schema.sql`). This creates all 8 tables with proper constraints and seed data.

## Architecture Overview

### Request Flow

```
Frontend (React)
    ↓
Backend API (Express)
    ↓
Controller → Service → DB Query
    ↓
Scrapers (X, Reddit, Dexscreener)
    ↓
Hard Filters (8 filters, any trigger = REJECT)
    ↓
Scoring (4 categories, 0-5 each)
    ↓
Verdict (APPROVE ≥4.20 | REJECT <4.20)
```

### Backend Structure

```
sniper/src/
├── server.js              # Entry point, middleware, route mounting
├── routes/                # API endpoint definitions
│   ├── evaluationRoutes.js
│   └── scannerRoutes.js
├── controllers/           # HTTP request handlers
│   ├── evaluationController.js
│   ├── outcomeController.js
│   └── scannerController.js
├── services/              # Core business logic
│   ├── evaluationService.js    # MAIN ORCHESTRATOR
│   ├── enrichmentService.js    # Coordinates all scrapers
│   ├── hardFilterService.js    # 8 binary filters
│   ├── scoringService.js       # 4 category scorers
│   ├── tagService.js           # Frozen enum tags
│   └── scannerService.js       # Autonomous scanning
├── scrapers/              # External data fetchers
│   ├── xTwitterScraper.js      # MANDATORY (X API/scraping)
│   ├── redditScraper.js
│   └── dexscreenerScraper.js
├── db/
│   ├── pool.js                 # PostgreSQL connection
│   └── queries/                # Parameterized SQL queries
│       ├── assetQueries.js
│       └── evaluationQueries.js
└── middleware/
    └── errorHandler.js
```

### Key Service: evaluationService.js

**This is the brain of SNIPER.** It orchestrates the entire evaluation pipeline:

1. Upsert asset (idempotent by contract_address)
2. Fetch active ruleset version
3. Create evaluation record (status: pending)
4. Enrich data via scrapers (X, Reddit, Dexscreener)
5. If enrichment blocked → log reason & halt
6. Run 8 hard filters → if ANY triggered → REJECT
7. Run 4 category scorers → calculate average
8. Determine verdict (≥4.20 = APPROVE)
9. Assign frozen tags
10. Persist all results to database

**Important:** This service is STATELESS per evaluation. It never reads the `outcomes` table.

## Critical Concepts

### 1. Hard Filters (8 Total)

Location: [hardFilterService.js](sniper/src/services/hardFilterService.js)

These are binary pass/fail checks. **ANY single filter triggered = immediate REJECT**, regardless of scores.

Examples:
- Entry near ATH with no reclaim
- Vertical pump + failed reclaim
- No clear meme narrative
- Low liquidity (<$10k default)
- Insider concentration (top 10 wallets >70%)

All 8 filters run on every evaluation. Results are logged to `hard_filter_results` table.

### 2. Category Scoring (4 Categories)

Location: [scoringService.js](sniper/src/services/scoringService.js)

Each category scores 0.00–5.00 based on enriched data:

1. **Chart Setup** (DEX chart patterns, breakouts, support)
2. **Momentum** (Volume, price action, holder growth)
3. **Social Sentiment** (X engagement, Reddit activity, narrative strength)
4. **Risk** (Liquidity depth, wallet concentration, rugpull indicators)

**Scoring Rules:**
- All scores truncated to 2 decimals (NOT rounded): `Math.floor(num * 100) / 100`
- Final score = arithmetic average of 4 categories
- APPROVE if final ≥ 4.20
- REJECT if final < 4.20

Results stored in `category_scores` table with reasoning text.

### 3. Immutable Rulesets

Rules are versioned in the `rulesets` table. Each evaluation links to a specific `ruleset_version`.

**Critical constraint:** Once a ruleset is marked `active`, it's locked. Old evaluations remain tied to their original version forever. This ensures backtest integrity.

To update rules:
1. Insert new row with new version (e.g., `v1.3`)
2. Mark old version as `deprecated`
3. Set new version to `active`

### 4. Outcomes Never Affect Scoring

The `outcomes` table is **append-only** and has **zero foreign key back to evaluations**. By design, past performance never influences future verdicts.

Outcomes are purely for manual post-mortem logging (e.g., "Trade executed", "Avoided rug pull").

### 5. X (Twitter) Scraping is Mandatory

Location: [xTwitterScraper.js](sniper/src/scrapers/xTwitterScraper.js)

If X scraping fails, the entire evaluation halts with `BLOCKED_MISSING_X`.

**Production note:** Public scraping is fragile. X blocks bots aggressively. For production:
- Use paid X API (add credentials to `.env`)
- Implement proxy rotation
- Consider alternative data providers (LunarCrush, CoinGecko)

## Database Schema (8 Tables)

1. **assets** — Master coin registry (ticker, contract_address, chain)
2. **evaluations** — Core evaluation record (status, verdict, final_score)
3. **category_scores** — 4 scoring categories per evaluation
4. **hard_filter_results** — Binary filter outcomes (triggered/not triggered)
5. **evaluation_tags** — Frozen enum tags (e.g., "high_momentum", "rug_risk")
6. **outcomes** — Manual post-mortem logs (never read by engine)
7. **enrichment_snapshots** — Raw scraper data (audit trail)
8. **rulesets** — Immutable versioned rules (version, active, deprecated)

**Key constraints:**
- `assets.contract_address` is unique per chain
- `evaluations.ruleset_version` links to immutable ruleset
- `outcomes` has no FK back to evaluations (by design)

## API Endpoints

### Evaluations
- `POST /api/evaluations` — Run manual evaluation
- `GET /api/evaluations` — List all evaluations
- `GET /api/evaluations/:id` — Get evaluation detail
- `POST /api/evaluations/:id/outcome` — Log outcome (manual)
- `GET /api/evaluations/:id/outcome` — Get outcome

### Scanner
- `POST /api/scanner/start` — Start autonomous scanner
- `POST /api/scanner/stop` — Stop scanner
- `POST /api/scanner/scan` — Trigger manual scan
- `GET /api/scanner/status` — Get scanner status

## Environment Variables

### Backend (.env)

```env
# Database (Supabase or local PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=sniper

# Server
PORT=3000

# Scraper Settings
SCRAPER_TIMEOUT_MS=10000
SCRAPER_RETRY_COUNT=2

# Scanner Settings
SCAN_INTERVAL_MS=300000        # 5 min autonomous scan interval
MIN_LIQUIDITY_USD=10000        # Min liquidity to consider
MIN_VOLUME_24H_USD=50000       # Min 24h volume to consider
```

### Frontend (.env)

```env
VITE_API_BASE=http://localhost:3000/api
```

## Common Patterns

### Adding a New Hard Filter

1. Define filter function in [hardFilterService.js](sniper/src/services/hardFilterService.js)
2. Return `{ triggered: boolean, evidence: string }`
3. Add to `ALL_FILTERS` array
4. Update `rulesets` table with new version
5. Test with known edge cases

### Adding a New Category

1. Define scorer function in [scoringService.js](sniper/src/services/scoringService.js)
2. Return `{ score: 0.00-5.00, reasoning: string }`
3. Use `truncate2dp()` for all numeric outputs
4. Add to `runScoring()` function
5. Update final score calculation (average of N categories)

### Modifying Scrapers

Scrapers should return structured data that matches the evaluation logic. All scrapers must handle:
- Timeouts (default 10s)
- Retries (default 2)
- Rate limiting
- Null/missing data gracefully

If a scraper fails, the enrichment service decides whether to block or continue with partial data.

## Deployment

- **Database:** Supabase (free tier)
- **Backend:** Railway or Render
- **Frontend:** Vercel or Netlify

All platforms have free tiers suitable for development/portfolio use.

## Troubleshooting

**"No active ruleset found"**
- Run the schema SQL to seed the `rulesets` table
- Ensure exactly one ruleset has `active = true`

**X scraping always fails**
- Expected behavior — X blocks scrapers heavily
- Use manual evaluation form to test the rest of the system
- For production, obtain X API credentials

**Scanner not finding coins**
- Check `MIN_LIQUIDITY_USD` and `MIN_VOLUME_24H_USD` settings
- Dexscreener API may rate-limit — add delays between requests
- Verify Solana chain is specified correctly

**Database connection errors**
- Verify connection string in `.env`
- Check Supabase allows connections from your IP
- Ensure `DB_NAME` is `postgres` (not project name)
