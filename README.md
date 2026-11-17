# Franchise Manager

A management and profitability system for a multi-route DPD franchise owner. It automates the administration (earnings, fuel, expenses, month-end reports), flags what deserves attention, and keeps every figure auditable.

**Automate the administration. Highlight the important decisions. Make everything else effortless.**

* **Dashboard** — today, this month, franchise comparison, drivers, alerts, sync status.
* **Drivers** — join/leave, assignments, per-driver performance, earnings history, attributed costs.
* **Earnings** — daily and monthly, original DPD figures beside adjustments and final pay.
* **Fuel & Expenses** — imported or hand-entered, attributed only when it can be done reliably.
* **Adjustments** — guided pay adjustments and driver cover; append-only, reversible by correcting entry.
* **Reports** — monthly PDF per franchise or consolidated; CSV exports.
* **Data & Integrations** — DPD portal (read-only), Dropbox, drag-and-drop upload, review queue.
* **Settings** — franchises, revenue, schedule (UK time), alert levels, categories.

## Stack

Next.js 16 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage) · Zod · Playwright (portal automation and e2e tests) · Vitest · PDFKit · unpdf · Dropbox API (OAuth 2.0) · Vercel (web, cron) · Docker worker (browser jobs).

## Documentation

| | |
| --- | --- |
| `DEVELOPMENT.md` | Status, what is tested, known limitations, next steps |
| `docs/DISCOVERY.md` | Discovery report, open questions, credentials needed |
| `docs/PORTAL_INVENTORY.md` | DPD portal capability inventory (currently *unverified*) |
| `docs/ARCHITECTURE.md` | How the pieces fit together |
| `docs/DATABASE.md` | Schema and the guarantees the database enforces |
| `docs/FINANCE.md` | Every formula, and how double-counting is avoided |
| `docs/DEPLOYMENT.md` | Vercel, Supabase, worker, Dropbox, DPD setup; local development |

## Quick start (local)

```
npm install
npx supabase start -x realtime,studio,edge-runtime,logflare,vector,imgproxy,supavisor
cp .env.example .env.local   # fill in the values from `npx supabase status -o env`
npm run seed:demo            # synthetic demo data
npm run dev
```

Sign in at http://localhost:3000 with `demo@example.test` / `demo-password-123`. All demo data is synthetic.

**No real DPD data, credentials or documents are included anywhere in this repository.**
