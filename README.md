# SNIPER — Deterministic Meme Coin Evaluation Platform

A rule-based crypto asset evaluation system for Solana meme coins. Built to enforce consistency, not intelligence.

## 📋 Project Overview

**What it does:**
- Scans meme coins (manual or autonomous)
- Pulls data from X, Reddit, and Dexscreener
- Runs 8 hard filters (any trigger = instant REJECT)
- Scores across 4 categories (0–5 each, truncated to 2 decimals)
- Issues binary verdict: APPROVE (≥4.20) or REJECT (<4.20)
- Logs everything for audit

**What it doesn't do:**
- Auto-execute trades (v1)
- Use ML or adaptive models
- Change rules based on outcomes
- Make discretionary decisions

---

## 🏗️ Architecture

```
Frontend (React + Vite)  →  Backend (Express.js)  →  Database (PostgreSQL)
     ↓                              ↓                        ↓
  Vercel/Netlify              Railway/Render            Supabase
```

---

## 🚀 Quick Start

### 1. Database Setup (Supabase)

1. Go to [supabase.com](https://supabase.com) and create a free project
2. In the SQL Editor, paste the contents of `sniper_schema.sql`
3. Run it — this creates all 8 tables + seed data
4. Copy your connection string from Settings → Database

### 2. Backend Setup

```bash
cd sniper
npm install
cp .env.example .env
```

Edit `.env`:
```env
DB_HOST=db.xxxxx.supabase.co
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=postgres
PORT=3000
```

Start the server:
```bash
npm run dev
```

Backend runs at `http://localhost:3000`

### 3. Frontend Setup

```bash
cd sniper-frontend
npm install
cp .env.example .env
```

Edit `.env`:
```env
VITE_API_BASE=http://localhost:3000/api
```

Start the dev server:
```bash
npm run dev
```

Frontend runs at `http://localhost:5173`

---

## 📡 API Endpoints

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

---

## 🌐 Deployment

### Backend (Railway)

1. Go to [railway.app](https://railway.app)
2. Create new project → Deploy from GitHub
3. Add PostgreSQL service (or connect to Supabase)
4. Set environment variables from `.env.example`
5. Deploy — Railway auto-generates a URL

### Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repo
3. Framework: Vite
4. Build command: `npm run build`
5. Output directory: `dist`
6. Set `VITE_API_BASE` to your Railway backend URL
7. Deploy

---

## 🔧 Configuration

### Scanner Settings (`.env`)

```env
SCAN_INTERVAL_MS=300000        # How often to scan (5 min default)
MIN_LIQUIDITY_USD=10000        # Min liquidity to consider
MIN_VOLUME_24H_USD=50000       # Min 24h volume to consider
```

### Ruleset Versioning

Rules are immutable. To update:
1. Insert a new row in `rulesets` table with a new version (e.g. `v1.3`)
2. Mark old version as `deprecated`
3. Set new version to `active`

Old evaluations remain linked to their original ruleset version.

---

## 📊 Database Schema

8 tables:
1. **assets** — Master coin registry
2. **evaluations** — Core eval record
3. **category_scores** — 4 scoring categories
4. **hard_filter_results** — Binary filter checks
5. **evaluation_tags** — Frozen enum tags
6. **outcomes** — Manual post-mortem (never affects scoring)
7. **enrichment_snapshots** — Raw scraper data (audit trail)
8. **rulesets** — Immutable versioned rules

---

## 🛠️ Tech Stack

**Backend:**
- Node.js + Express.js
- PostgreSQL (via `pg`)
- Axios + Cheerio (scraping)

**Frontend:**
- React 18
- Vite
- Axios

**Deployment:**
- Database: Supabase
- Backend: Railway / Render
- Frontend: Vercel / Netlify

---

## 📝 Important Notes

### X (Twitter) Scraping
X is **mandatory**. If it fails → evaluation stops with `BLOCKED_MISSING_X`.

Public scraping is fragile — X blocks bots aggressively. For production, consider:
- Paid X API access (add key to `.env`)
- Alternative data sources (CoinGecko, LunarCrush)
- Rate-limiting + proxy rotation

### Outcomes Never Affect Scoring
The `outcomes` table is **append-only** and has zero foreign key back into the evaluation engine. By design, the database won't let outcomes influence future verdicts.

### Frozen Rules
Once a ruleset is marked `active`, it's locked. Old evaluations stay tied to their original ruleset version forever. This is critical for backtest integrity.

---

## 🎯 Portfolio Use

This project demonstrates:
- Full-stack development (React + Express + PostgreSQL)
- Database design (8-table normalized schema with constraints)
- External API integration (DEX, X, Reddit)
- Deterministic rule engine architecture
- Separation of concerns (services, controllers, routes)
- Audit logging and data persistence

Perfect for interviews — shows you can build a real, working system end-to-end.

---

## 🐛 Troubleshooting

**Database won't connect:**
- Check your connection string in `.env`
- Make sure Supabase allows connections from your IP
- Verify `DB_NAME` is `postgres` (not your project name)

**X scraping fails:**
- Expected — X blocks scrapers heavily
- Use the manual evaluation form to test the rest of the system
- For production, get X API credentials

**Scanner not finding coins:**
- Check `MIN_LIQUIDITY_USD` and `MIN_VOLUME_24H_USD` — may be too restrictive
- Dexscreener API may rate-limit you — add delays between requests

---

## 📦 Files Included

```
sniper_complete.zip
├── sniper/                  ← Backend
│   ├── src/
│   │   ├── services/        ← Core business logic
│   │   ├── scrapers/        ← X, Reddit, Dexscreener
│   │   ├── controllers/     ← HTTP handlers
│   │   ├── routes/          ← API endpoints
│   │   ├── db/              ← PostgreSQL queries
│   │   └── server.js        ← Entry point
│   ├── package.json
│   └── .env.example
│
├── sniper-frontend/         ← Frontend
│   ├── src/
│   │   ├── App.jsx          ← Main dashboard
│   │   ├── main.jsx
│   │   └── index.css
│   ├── package.json
│   ├── vite.config.js
│   └── .env.example
│
└── sniper_schema.sql        ← Database DDL
```

---

## 🚨 License

This is a portfolio project. Use it however you want.

---

**Built with Claude Sonnet 4.5**
