# 8. V1 / V2 / V3 Roadmap & Step-by-Step Development Plan

## 8.1 Roadmap overview

| | V1 | V2 | V3 |
|---|---|---|---|
| **Data sources** | Meta Ads only | + Google Ads, GA4, Shopify | + CRM, Amazon/marketplaces |
| **Intelligence** | Performance + Creative Intelligence, Winner/Fatigue, Recommendations, Hypotheses | + full Funnel Intelligence (GA4), Landing Page Match, Competitor Intelligence, Experiment Management UI | Predictive insights, richer account memory, cross-channel audience intelligence |
| **Creative generation** | Hand-off to Creative OS (hypothesis → opportunity) | Tighter API integration (status sync both directions), multi-format prompt generation | Automatic asset generation inside AdBrain, campaign drafting |
| **Execution** | Human-only, no writes to Meta at all | "Approve & Execute" for a narrow allow-listed action set | Optional broader scoped autonomy (still opt-in, still logged) |
| **Reporting** | Daily brief + weekly narrator, in-app | Scheduled digests (email/Slack) | Multi-account/agency roll-ups |

## 8.2 V1 — step-by-step development plan

Each step below should ship as a working, demoable increment — not a big-bang release at the end.

### Phase 0 — Foundation (repo + infra)
1. Scaffold Next.js 16 + TypeScript app in this repo, matching Creative OS's project conventions (`lib/`, `app/`, `postgres/`).
2. Stand up `adbrain_db` PostgreSQL, write the migration for the full V1 schema (docs/03 §3.2), verify with a schema-listing query (same verification pattern Creative OS uses).
3. `lib/db.ts` (pg pool), `lib/workspace.ts`, seed one workspace/brand/product row matching Creative OS's existing `PF` / `PF-COOKIE-BRK` ids.
4. `lib/ai.ts` provider abstraction (Gemini default, OpenAI fallback), `generateStructured<T>()` helper with JSON-schema validation and retry-on-invalid-output.
5. Health check endpoint (`/api/health`) mirroring Creative OS's.

### Phase 1 — Data Layer (Meta Ads ingestion)
6. Meta app registration, OAuth flow (`/api/meta/oauth/callback`), encrypted token storage in `ad_connections`.
7. Meta client (`lib/meta/client.ts`): campaigns/ad sets/ads/creatives fetchers + insights fetcher (batch + async insights for backfill).
8. Normalizers: raw Meta JSON → `campaigns`/`ad_sets`/`ads`/`ad_creatives`/`performance_daily` upserts (docs/03 §3.4).
9. Backfill route (90 days) + incremental hourly sync route; verify idempotency (re-running produces no duplicate/divergent rows).
10. **Demo checkpoint:** connect a real Meta ad account, see normalized campaign/ad/performance data land in Postgres.

### Phase 2 — Performance Intelligence
11. Implement anomaly detection (docs/04 §4.2) and sustained-trend detection (§4.3) as pure functions with unit tests against fixture data (known-good z-scores, known trend percentages).
12. Implement cause discrimination (§4.4), funnel break-point logic (§4.5), budget/pacing logic (§4.6) as pure functions.
13. Performance Diagnosis Agent: wire the pure-function evidence into the diagnosis prompt (docs/05), write `diagnoses` rows.
14. Campaigns list/detail UI (docs/07 §7.3) reading from `diagnoses`/`anomalies`.
15. **Demo checkpoint:** open a real account with a real performance dip, see a correct, evidence-backed diagnosis on screen.

### Phase 3 — Creative Intelligence
16. Build the taxonomy config (docs/04 §4.1.1) and the Creative Classification Agent; run against a batch of real existing creatives, spot-check accuracy manually before trusting it in aggregation.
17. Attribute→performance linkage query (§4.1.3) with sample-size floors; expose as an internal API for the leaderboard panel.
18. Winner detection (§4.7) and fatigue detection (§4.8) scoring jobs, writing `creative_scorecards`.
19. Creative Intelligence board + creative detail UI (docs/07 §7.4).
20. **Demo checkpoint:** the account's actual current winner and actual current fatiguing creative are correctly identified and explained, matching what the marketer already suspects from manual review (this is the key trust-building milestone before automating recommendations).

### Phase 4 — Recommendation Engine
21. Implement the deterministic action-mapping table (docs/04 §4.10) as a pure function over diagnoses/scorecards.
22. Recommendation Agent wiring + `recommendations` writes.
23. Recommendation Inbox UI + approve/reject/snooze actions (docs/07 §7.5, docs/06 §6.2).
24. **Demo checkpoint:** a full day's worth of recommendations reviewed and approved/rejected by the actual marketer in under 10 minutes.

### Phase 5 — Creative Hypothesis Engine + Creative OS hand-off
25. Hypothesis Generation Agent (docs/05), triggered from a fatiguing scorecard or an approved `create_new_creative`/`test_new_hook` recommendation.
26. Hypothesis board UI (docs/07 §7.6).
27. Add `POST /api/opportunities` to Creative OS (small addition to that existing app) and the corresponding `SendToCreativeOSButton` call from AdBrain (docs/03 §3.5).
28. **Demo checkpoint:** a fatigue detection → 5 concepts → one sent to Creative OS → appears as a real `opportunities` row ready for the angle/hook/brief pipeline, end to end.

### Phase 6 — Reporting + Learning loop
29. Daily Intelligence Report Agent + cron + Daily Brief UI (docs/07 §7.2).
30. Experiments table + manual conclude flow (docs/07 §7.7); Learning Agent (docs/06 §6.1).
31. Weekly Performance Narrator Agent + cron + Reports archive UI (docs/07 §7.8).
32. Performance/learning sync job to Creative OS (docs/03 §3.5, docs/06 §6.1).
33. **Demo checkpoint:** first full week of the system running unattended, producing a daily brief every morning and a coherent weekly narrative on schedule.

### Phase 7 — Hardening
34. Tracking/data-quality checks (docs/03 §3.2 `tracking_health_checks`) — at minimum: pixel/CAPI event-count sanity check, missing-UTM detection, attribution-window-change detection.
35. `agent_runs` logging/observability on every agent; basic cost tracking per run.
36. Alert-suppression tuning (docs/04 §4.2) against real usage — adjust thresholds if the marketer reports the brief as too noisy or too quiet.
37. Settings pages (connections, taxonomy) polish.

V1 is done when Phases 0–7 are complete and the account has run unattended (aside from human approvals) for at least one full week with correct daily/weekly reports.

## 8.3 V2 (after V1 is validated on real spend)

- Add Google Ads and GA4 connectors, extending the same normalized schema (`ad_connections.platform`, docs/03 §3.4 point 6) rather than parallel tables.
- Add Shopify connection for true revenue/order-level truth (reconciling Meta-reported purchases vs. actual store orders — this materially upgrades tracking-quality confidence).
- Full Funnel Intelligence using GA4 events (session→PDP→ATC→checkout→purchase) layered on top of the existing funnel break-point logic.
- Landing Page Match Analysis: scrape/render the destination URL, LLM-compare ad promise vs. page content (offer, headline, pricing, trust elements) — flags mismatches per the spec's example.
- Competitor Intelligence: Meta Ad Library scraping for the brand's category, classified through the *same* creative taxonomy (docs/04 §4.1.1) so competitor and own-account creatives are directly comparable — this is what makes "white space" findings possible ("most competitors use discount messaging; lifestyle routine positioning is underused").
- Experiment Management UI becomes a first-class module (richer than the V1 table) with hypothesis templates pulled from the Hypothesis Engine automatically.
- "Approve & Execute" — the narrow allow-listed Meta API write actions described in docs/06 §6.2.
- Scheduled digest delivery (email/Slack) of the daily brief and weekly narrative.
- Audience Intelligence becomes a dedicated module/UI rather than folded into diagnoses.

## 8.4 V3

- Predictive insights (e.g., forecasted fatigue onset before it happens, using the historical fatigue_score trajectory).
- Automatic creative asset generation inside AdBrain itself (image/video generation prompts executed, not just written) — at this point AdBrain and Creative OS's production capabilities may merge into one pipeline rather than staying two integrated apps.
- Campaign drafting (AI proposes a full new campaign/ad set structure for a hypothesis, still human-approved before creation).
- Multi-channel recommendations spanning Meta + Google + Amazon budget allocation.
- Richer account memory: multi-brand/multi-account learning transfer where patterns are broad enough to generalize (careful — must remain brand-specific by default; cross-brand learning is opt-in and clearly labeled as such, never silently blended).
- Optional, narrowly-scoped autonomous execution for specific low-risk, high-confidence, repeatedly-approved-by-a-human action types — opt-in per workspace, never a default.
