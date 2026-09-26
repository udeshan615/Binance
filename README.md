xt# Binance Futures HQ Signal Monitor

Production-ready **Order Block + Lifecycle** scanner for Binance USDT-M Futures.

- **Server-side scan** every 5 minutes (Vercel Cron) — browser does **not** need to stay open
- **Signal lifecycle**: WATCHING → READY → ONGOING → COMPLETED_PROFIT / STOPPED / INVALIDATED
- **No duplicate signals** (deterministic `signal_id`)
- **Supabase-ready** database abstraction (service role server-only)
- **Telegram** notifications only on meaningful state changes
- Preserves original HQ scoring: **4H → 1H**, Conservative entry, **Score ≥ 70**

---

## File structure

```
binance-signal-monitor/
├── app/
│   ├── page.js                 # Frontend (polls /api/signals)
│   ├── layout.js
│   ├── globals.css
│   └── api/
│       ├── cron/scan/route.js  # Vercel Cron endpoint
│       ├── signals/route.js    # GET ongoing/ready/watching/history
│       └── scan/route.js       # GET scan status
├── lib/
│   ├── config/signalConfig.js
│   ├── binance/client.js
│   ├── scanner/
│   │   ├── scanner.js          # Full scan orchestrator
│   │   ├── scoreSetup.js       # Original scoring (preserved)
│   │   ├── orderBlocks.js
│   │   ├── fvg.js
│   │   ├── structure.js
│   │   ├── liquidity.js
│   │   └── indicators.js
│   ├── signals/
│   │   ├── signalLifecycle.js
│   │   ├── proximity.js
│   │   └── signalId.js
│   ├── database/
│   │   ├── index.js            # Supabase / dev memory adapter
│   │   ├── signals.js
│   │   └── scanRuns.js
│   └── telegram/telegram.js
├── supabase/migrations/001_initial_schema.sql
├── vercel.json                 # Cron every 5 min
├── package.json
├── .env.example
└── README.md
```

---

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** → paste and run `supabase/migrations/001_initial_schema.sql`
3. **Settings → API**:
   - Copy **Project URL** → `SUPABASE_URL`
   - Copy **anon public** → `SUPABASE_ANON_KEY`
   - Copy **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (server only!)

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.

---

## 2. Telegram setup

1. Open Telegram → talk to **@BotFather** → `/newbot` → copy token → `TELEGRAM_BOT_TOKEN`
2. Start a chat with your bot (or add to a group)
3. Get chat ID:
   - Message the bot, then open  
     `https://api.telegram.org/bot<TOKEN>/getUpdates`  
     and read `chat.id` → `TELEGRAM_CHAT_ID`

---

## 3. Environment variables (Vercel)

| Variable | Required | Notes |
|----------|----------|-------|
| `SUPABASE_URL` | Prod yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod yes | Server only |
| `SUPABASE_ANON_KEY` | Optional | If client reads DB directly |
| `TELEGRAM_BOT_TOKEN` | Recommended | |
| `TELEGRAM_CHAT_ID` | Recommended | |
| `CRON_SECRET` | Prod yes | Random long string |
| `BINANCE_API_BASE_URL` | No | Default `https://fapi.binance.com` |

Generate CRON_SECRET: `openssl rand -hex 32`

---

## 4. Deploy to Vercel

```bash
cd binance-signal-monitor
npm install
# optional local test:
# cp .env.example .env.local  # fill values
# npm run dev

vercel  # or connect GitHub repo in Vercel dashboard
```

In Vercel project **Settings → Environment Variables**, add all keys above.

**Cron**: `vercel.json` already schedules `*/5 * * * *` → `/api/cron/scan`.

### ⚠️ Vercel Free (Hobby) plan

Vercel Free **only allows daily cron**. Every-5-minute cron needs Pro.

**Solution (100% free):** use an external cron service.

#### Free external cron setup (cron-job.org) — recommended

1. Go to [https://cron-job.org](https://cron-job.org) → create free account
2. Create new cron job:
   - **URL**: `https://YOUR-APP.vercel.app/api/cron/scan?secret=YOUR_CRON_SECRET`
   - **Schedule**: every 5 minutes (`*/5 * * * *`)
   - **Request method**: GET
   - (Optional) Header: `Authorization: Bearer YOUR_CRON_SECRET`
3. Save & enable the job

That’s it. Now TP1 / TP2 / TP3 / SL updates will come to Telegram automatically even on Vercel Free.

Other free alternatives: [easycron.com](https://www.easycron.com), [cron-job.org](https://cron-job.org), [uptime-kuma](https://github.com/louislam/uptime-kuma) self-hosted.

---

## 5. How the 5-minute scanner works

1. Vercel Cron (or external) hits `GET/POST /api/cron/scan` with secret
2. Endpoint validates `CRON_SECRET`
3. Acquires DB scan lock (no concurrent full scans)
4. Creates `scan_runs` row
5. Loads Binance symbols + tickers
6. **Updates all active signals** (lifecycle: proximity, entry, TP/SL, age)
7. Scans symbols in batches (rate-limit safe)
8. Runs original **scoreSetup** (OB, FVG, structure, …)
9. Builds deterministic `signal_id` → create only if new
10. Persists to Supabase, writes `signal_events`
11. Sends Telegram only when notification flags are false and send succeeds
12. Completes scan_run, releases lock

Frontend only polls `GET /api/signals` every ~45s — **no scanning in browser**.

---

## 6. Signal lifecycle

```
WATCHING ──► READY ──► ONGOING ──► COMPLETED_PROFIT
                │          │
                │          └──► STOPPED
                └──► INVALIDATED
WATCHING ──► INVALIDATED
```

- **WATCHING**: score ≥ 70, valid OB, price still far from entry  
- **READY**: price within dynamic threshold (~0.5 × 5m ATR, capped by OB width)  
- **ONGOING**: entry zone hit (tolerance ~0.15 ATR)  
- **COMPLETED_PROFIT**: TP3 hit  
- **STOPPED**: SL hit while ONGOING  
- **INVALIDATED**: max age 48h or setup broken (pre-entry only)

**No reverse**: ONGOING never goes back to READY/WATCHING.

---

## 7. Duplicate prevention

```text
signal_id = SYMBOL_DIRECTION_obTimestamp_entryRounded
```

Same OB + same entry on the next scan → **update existing**, never create a second row.

New OB timestamp or different entry → new `signal_id`.

---

## 8. Proximity (READY)

```js
readyDistance = min(0.5 * ATR_5M, 0.5 * OB_width)
// clamped between minReadyDistancePct and maxReadyDistancePct of entry
isReady = distanceToEntry <= readyDistance
```

Configurable in `lib/config/signalConfig.js`.

---

## 9. Local development

Without Supabase env vars, the app uses an **in-memory store** (dev only).  
Production **requires** Supabase and will refuse to scan without it.

```bash
npm install
npm run dev
# Trigger a scan:
curl -X POST http://localhost:3000/api/cron/scan
```

---

## 10. Test checklist

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Price far from entry | WATCHING, no Telegram |
| 2 | Price approaches entry | WATCHING → READY, 1 READY msg |
| 3 | Still near entry next scan | Still READY, no duplicate Telegram |
| 4 | Price hits entry zone | READY → ONGOING, 1 ENTRY msg |
| 5 | Still ONGOING | No duplicate ENTRY |
| 6–8 | TP1 / TP2 / TP3 | Notifications once each; TP3 → COMPLETED_PROFIT |
| 9 | SL after entry | STOPPED, 1 SL msg |
| 10 | Age > 48h pre-entry | INVALIDATED |
| 11 | Same setup every 5 min | One DB row |
| 12 | New OB same symbol | New signal_id |

---

## 11. Security notes

- Service role key **only** on server (API routes / cron)
- Frontend never writes signal status
- Cron protected by `CRON_SECRET`
- RLS enabled; writes via service role only

---

## Config defaults (HQ — full lifecycle)

| Key | Value |
|-----|-------|
| HTF | 4h |
| OB | 1h |
| Entry style | conservative |
| Min score | 70 |
| Scan universe | top 80 by volume |
| Chunk size | 12 (Hobby-safe) |
| persistSignals | **true** |
| skipLifecycle | **false** |
| Cron | every 5 minutes (use external cron on Free plan) |

Edit `lib/config/signalConfig.js` to tune thresholds without touching scoring weights.

**Mode:** Full lifecycle is ON. Signals are saved to Supabase. Telegram gets READY → ENTRY → TP1 → TP2 → TP3 / SL updates automatically.


---

## Site password (login) — disabled for now

Shared password gate was removed temporarily. Add signup/signin later, then re-enable auth.

## Auto-scan Start / Stop

Default: **OFF**.

1. Log in to the dashboard
2. Click **▶ Auto-Scan OFF** to enable → becomes **⏹ Auto-Scan ON**
3. External cron / Vercel Cron hits `/api/cron/scan` every 5 min
4. If auto-scan is OFF, cron returns `{ skipped: true }` and does nothing

Endpoints (require login cookie):

- `POST /api/scan/start`
- `POST /api/scan/stop`
- `GET /api/scan` includes `auto_scan_enabled`

Flag stored in Supabase `app_state` key `auto_scan_enabled` (see migration `002_app_state.sql`).

## Telegram charts (READY + ENTRY)

Uses **QuickChart.io** (no native canvas deps on Vercel).

When READY or ENTRY_HIT fires, the bot sends a **photo** (price line + Entry/SL/TP/OB annotations) with the usual HTML caption. TP/SL/INVALIDATED stay text-only.

No extra npm package required — `fetch` to `https://quickchart.io/chart?...`.

