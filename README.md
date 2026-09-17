# AdBrain — AI Paid Media Intelligence System

> Think of this as **"Ryze-style paid media intelligence + a much deeper creative intelligence and generation engine,"** not another reporting dashboard.

AdBrain is an AI decision-support layer that sits above Meta Ads (and later Google Ads, GA4, Shopify, CRM, competitor data) and continuously answers:

- What changed?
- Why did it change?
- What is working, and what is underperforming?
- Is the issue creative, audience, landing page, tracking, budget, or offer?
- Which creatives are fatigued, and which patterns are winning?
- What should we test next — and what should the next batch of creatives actually be?

It does **not** replace human decision-making. Every action AdBrain proposes is reviewed and approved by a human before it is executed (see [Human Approval Gate](docs/06-MEMORY-AND-APPROVAL.md)).

## Core philosophy

```
Data → Diagnosis → Recommendation → Creative Hypothesis → Execution → Learning
```

AdBrain never stops at a metric. A metric is an input; a **diagnosis** is the output:

| Bad | Good |
|---|---|
| "CTR = 0.8%" | "CTR declined 26% over 5 days while CPM stayed flat — this points to creative fatigue, not rising auction cost." |
| "Ad 24 is the winner." | "Ad 24 wins because it combines a problem-first hook, UGC format, a product reveal within 2 seconds, and a benefit-led CTA." |
| "Creative fatigue detected." | "Creative 17 is fatiguing (freq 2.1→3.8, CTR −32%, CPC +27%, CPM flat). Here are 5 replacement concepts based on your winning patterns." |

## Relationship to Creative OS (`creatives_system`)

This workspace already runs **Creative OS**, a production creative-generation pipeline (`research → angles → hooks → concepts → briefs → production`) for the Purferme brand. AdBrain is **not** a second creative-generation tool. AdBrain is the missing upstream half:

```
Meta Ads / GA4 / Shopify  →  AdBrain (diagnose, recommend, hypothesize)  →  Creative OS (generate, brief, produce)  →  Meta Ads (test)  →  AdBrain (learn)
```

- AdBrain owns performance ingestion, diagnosis, fatigue/winner detection, recommendations, and creative **hypotheses**.
- Creative OS owns turning an approved hypothesis into an **opportunity → angle → hook → concept → brief → rendered asset**.
- The two systems share the same *shape* of identifiers (`workspace_id`, `brand_id`, `product_id`, `creative_id`) so performance rows and learnings can flow between them. See [Data Model](docs/03-DATA-MODEL.md#integration-with-creative-os).

## Documentation map

1. [Product Definition, MVP Scope & User Journey](docs/01-PRODUCT-AND-MVP.md)
2. [Feature, Frontend, Backend & Agent Architecture](docs/02-ARCHITECTURE.md)
3. [Database Schema, Meta Ads Integration & Data Normalization](docs/03-DATA-MODEL.md)
4. [Creative Classification, Winner/Fatigue Detection & Recommendation Logic](docs/04-INTELLIGENCE-LOGIC.md)
5. [AI Prompts](docs/05-AI-PROMPTS.md)
6. [Memory/Learning Architecture & Human Approval Workflow](docs/06-MEMORY-AND-APPROVAL.md)
7. [Dashboard / UI Structure](docs/07-UI-STRUCTURE.md)
8. [V1 / V2 / V3 Roadmap & Step-by-Step Development Plan](docs/08-ROADMAP.md)

## MVP V1 in one line

Connect Meta Ads → import campaign/ad/creative performance → analyze 7/14/30-day windows → identify winners, losers, and fatigue → explain why → recommend next actions → generate creative hypotheses → hand a selected hypothesis to Creative OS as a brief-ready opportunity.

## Tech stack (proposed, matches Creative OS for team velocity)

- **Frontend/Backend:** Next.js 16 (App Router), TypeScript, same monorepo conventions as `creatives_system`
- **Database:** PostgreSQL (`adbrain_db`), `pg` driver, SQL migrations checked into `postgres/`
- **AI provider:** Provider-abstracted (Gemini default, OpenAI fallback) — identical pattern to Creative OS's `lib/ai.ts`
- **Jobs/scheduling:** Cron-triggered API routes (Vercel Cron / node-cron) for MVP; upgrade to a queue (BullMQ/Trigger.dev) in V2 when multi-platform ingestion needs concurrency control
- **Meta integration:** Meta Marketing API (Graph API) via server-side OAuth app

## Local setup

```powershell
npm install
```

Copy `.env.example` to `.env.local` and set your local PostgreSQL password (Gemini/Meta/Creative OS keys can stay blank for now — the app runs in demo mode without them):

```env
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=adbrain_db
DB_USER=postgres
DB_PASSWORD=YOUR_LOCAL_POSTGRES_PASSWORD
DB_SSL=false
```

Create the `adbrain_db` database, then run the schema and seed against it (psql, pgAdmin, or any Postgres client):

```
postgres/schema.sql   -- full V1 schema (docs/03-DATA-MODEL.md §3.2)
postgres/seed.sql      -- seeds the PF / PF-COOKIE-BRK workspace/brand/product,
                          matching Creative OS's ids
```

Run it:

```powershell
npm run dev
```

Open:
- App: http://localhost:3000
- Health: http://localhost:3000/api/health

A healthy setup with the database connected should report:

```json
{
  "status": "ok",
  "aiProvider": "demo",
  "geminiConfigured": false,
  "openaiConfigured": false,
  "databaseConfigured": true,
  "databaseOk": true,
  "databaseError": null
}
```

Without a database configured, the app still runs in **demo mode** (shows the PF / PF-COOKIE-BRK demo workspace and the build-roadmap status view) so you can confirm the app boots before setting up Postgres.

Set `AI_PROVIDER=gemini` (or `openai`) with the matching API key in `.env.local` once you're ready to wire up an intelligence agent — see `lib/ai.ts` and [AI Prompts](docs/05-AI-PROMPTS.md).

### Connecting Meta Ads

Requires a Meta developer app (App ID + App Secret) with the Marketing API product added. In `.env.local`, set `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` (must match the app's configured OAuth redirect), and `META_TOKEN_ENCRYPTION_KEY` (any long random string, e.g. `openssl rand -hex 32` — used to encrypt stored access tokens). Then go to **Settings → Connections** in the app and click **Connect Meta Ads**. AdBrain only ever requests the `ads_read` scope — see [Human Approval Gate](docs/06-MEMORY-AND-APPROVAL.md).

## Status

- **Phase 0 (Foundation)** — done. Next.js app scaffold, the pg pool (`lib/db.ts`), the provider-abstracted AI client with structured-output validation/retry (`lib/ai.ts`), workspace resolution with a demo fallback (`lib/workspace.ts`), `/api/health`, and the full V1 Postgres schema + seed (`postgres/`).
- **Phase 1 (Meta Ads ingestion)** — code complete, verified against a real Postgres instance with realistic fixture data (normalize → upsert pipeline confirmed idempotent, all computed metrics hand-checked), but **not yet exercised against the live Meta API** — that requires a real Meta developer app and ad account credentials this environment doesn't have. Built: OAuth flow (`/api/meta/oauth/start` + `/callback`, `ads_read` only), the Graph API client (`lib/meta/client.ts`, paginated fetchers + async Insights API for backfill), normalizers (`lib/meta/normalize.ts`), sync orchestration (`lib/meta/sync.ts`), manual backfill and cron-target incremental sync routes, encrypted token storage (`lib/crypto.ts`), and the Settings → Connections UI.

Performance Intelligence (Phase 2) is next.
