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

## Status

This repository currently contains design documentation only, per the project's explicit instruction to define architecture, data model, logic, and workflows before implementation begins. Implementation starts at [Roadmap → V1](docs/08-ROADMAP.md#v1-step-by-step-development-plan).
