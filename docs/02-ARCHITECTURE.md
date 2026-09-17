# 2. Feature Architecture, Frontend, Backend & Agent/Workflow Architecture

## 2.1 Module map

```
┌──────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                 │
│  Meta Ads · (V2: Google Ads, GA4, Shopify, CRM) · Sheets/CSV          │
└───────────────────────────────────────────┬────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                      NORMALIZATION & DATA QUALITY                     │
│  Raw → normalized star schema · Tracking/signal-quality checks        │
└───────────────────────────────────────────┬────────────────────────────┘
          ┌───────────────────────┤───────────────────────┐
          ▼                      ▼                      ▼
┌───────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ PERFORMANCE        │  │ CREATIVE              │  │ AUDIENCE /             │
│ INTELLIGENCE        │  │ INTELLIGENCE          │  │ FUNNEL / BUDGET        │
│ (what/why changed,  │  │ (classification,       │  │ INTELLIGENCE           │
│  anomalies, pacing)  │  │  winner/fatigue)       │  │                        │
└─────────┬──────────┘  └─────────┬────────────┘  └───────────┬────────────┘
          └───────────────────────┬──┴──────────────────────────┘
                                  ▼
                     ┌─────────────────────┐
                     │  RECOMMENDATION ENGINE    │
                     └────────────┬───────────┘
                        ┌─────────┬─────────┘
                        ▼                   ▼
          ┌─────────────────┐  ┌─────────────────┐
          │ CREATIVE HYPOTHESIS    │  │ HUMAN APPROVAL GATE    │
          │ ENGINE                 │  │                        │
          └───────────┬──────────┘  └───────────┬───────────┘
                        │                          ▼
                        │              ┌─────────────────┐
                        │              │ EXECUTION (manual V1,  │
                        │              │ approve&execute V2)     │
                        │              └─────────┬───────────┘
                        ▼                          ▼
          ┌─────────────────┐  ┌─────────────────┐
          │ CREATIVE OS HAND-OFF   │  │ EXPERIMENT MEMORY /     │
          │ (opportunity creation) │  │ LEARNING LAYER          │
          └─────────────────┘  └─────────────────┘
                                  ▲
                                  │ feeds back into every module above
                     ┌─────────────────┐
                     │ REPORTING (daily/weekly) │
                     └─────────────────┘
```

Modules (matches the requested product architecture 1:1):

| # | Module | V1 | V2 | V3 |
|---|---|---|---|---|
| 1 | Data Layer | Meta Ads | + Google Ads, GA4, Shopify | + CRM, Amazon, marketplaces |
| 2 | Performance Intelligence | ✅ | richer funnel | predictive |
| 3 | Creative Intelligence | ✅ | + video frame analysis | + auto-clustering embeddings |
| 4 | Competitor Intelligence | — | ✅ (ad library scraping) | trend forecasting |
| 5 | Audience Intelligence | basic (Meta breakdowns) | ✅ | cross-channel |
| 6 | Funnel Intelligence | Meta-only funnel | ✅ (GA4) | predictive drop-off |
| 7 | Tracking Intelligence | basic pixel/CAPI checks | ✅ full | automated fixes proposed |
| 8 | Recommendation Engine | ✅ | budget-shift automation proposals | richer confidence modeling |
| 9 | Creative Hypothesis Engine | ✅ | richer, multi-format | image/video prompt generation |
| 10 | Creative Generation | hand-off to Creative OS | tighter API integration | asset generation inside AdBrain |
| 11 | Experiment Memory | table + manual outcome | full UI | auto-conclusion drafting |
| 12 | Reporting | daily + weekly | scheduled digests (email/Slack) | multi-account roll-ups |
| 13 | Human Approval | ✅ mandatory | approve & execute (scoped) | broader scoped autonomy (opt-in) |

## 2.2 Frontend architecture

**Framework:** Next.js 16 App Router + TypeScript, same conventions as Creative OS, so the two apps feel and build the same way for one team.

```
app/
  layout.tsx
  page.tsx                     -> redirects to /brief
  brief/page.tsx                -> Daily Intelligence Report (home)
  campaigns/
    page.tsx                    -> campaign list w/ diagnosis chips
    [campaignId]/page.tsx       -> campaign detail (funnel, pacing, diagnosis)
  creatives/
    page.tsx                    -> Creative Intelligence board (grid, filters)
    [creativeId]/page.tsx       -> creative detail: trend, attributes, why it's
                                    winning/losing, fatigue evidence
  recommendations/
    page.tsx                    -> Recommendation inbox (approve/reject/snooze)
    [recommendationId]/page.tsx -> full evidence + hypothesis panel
  hypotheses/
    page.tsx                    -> hypothesis board (proposed/sent/testing/concluded)
    [hypothesisId]/page.tsx     -> concept detail, "Send to Creative OS"
  experiments/
    page.tsx                    -> experiment memory table
  reports/
    page.tsx                    -> archive of daily/weekly reports
    weekly/[weekId]/page.tsx
  audiences/page.tsx             (V1 lite; V2 full)
  settings/
    connections/page.tsx        -> Meta OAuth connection management
    taxonomy/page.tsx           -> creative attribute taxonomy config
    workspace/page.tsx
  api/                          -> route handlers (see backend section)
components/
  brief/ (BriefCard, MetricDelta, DiagnosisNarrative)
  creative/ (AttributeTagList, FatigueBadge, WinnerBadge, TrendSparkline)
  recommendation/ (EvidencePanel, ConfidenceMeter, ApproveRejectBar)
  hypothesis/ (ConceptCard, SendToCreativeOSButton)
  shared/ (DateRangePicker, WorkspaceSwitcher, DataQualityBanner)
lib/
  ai.ts            -> provider-abstracted AI client (mirrors Creative OS)
  db.ts            -> pg pool
  meta/            -> Meta Marketing API client + normalizers
  intelligence/    -> pure-function diagnosis/detection logic (unit-testable,
                      no I/O — see docs/04)
  workspace.ts
```

**State/data fetching:** Server Components for read paths (brief, campaigns, creatives), Server Actions for approve/reject/send-to-Creative-OS mutations. No separate client-side state library needed for V1 — the data is inherently server-computed (diagnosis, scores) and doesn't need client-side real-time sync.

**Design language:** dense, evidence-first cards (see [UI Structure](07-UI-STRUCTURE.md)) — every number is paired with a one-line "why."

## 2.3 Backend architecture

```
app/api/
  meta/
    oauth/callback/route.ts       -> exchanges code, stores long-lived token
    sync/route.ts                 -> triggered by cron: incremental pull
    backfill/route.ts             -> manual/initial 90-day backfill
  intelligence/
    run-diagnosis/route.ts        -> cron: daily performance diagnosis pass
    run-creative-scan/route.ts    -> cron: creative classification + winner/fatigue pass
    run-recommendations/route.ts  -> cron: recommendation generation
    run-hypotheses/route.ts       -> on-demand: generate hypotheses for a given
                                      recommendation/fatigue signal
  reports/
    generate-daily/route.ts       -> cron, ~1 hour after Meta data settles (see 2.4)
    generate-weekly/route.ts      -> cron, weekly
  recommendations/
    [id]/approve/route.ts
    [id]/reject/route.ts
  hypotheses/
    [id]/send-to-creative-os/route.ts  -> writes an `opportunities` row into
                                           creative_os_db (see docs/03)
  webhooks/
    meta/route.ts                 -> (V2) Meta webhook for ad status changes
```

Cron/job orchestration for V1 uses simple scheduled route handlers (Vercel Cron or a node-cron worker) — no queue infrastructure yet. Jobs are idempotent (safe to re-run) and scoped per workspace, which is enough at single-brand scale. V2 introduces a real job queue (BullMQ/Trigger.dev) when multi-account concurrency and webhook-driven triggers arrive.

**AI provider layer (`lib/ai.ts`):** identical pattern to Creative OS — `AI_PROVIDER=gemini|openai`, structured-output calls (JSON schema-constrained) for every intelligence module, since diagnosis/recommendation output feeds UI components and the database, not free text. Narrative prose (daily brief, weekly narrator) is generated as one field *inside* that structured JSON, not as a raw completion — this keeps every AI output auditable and re-renderable.

## 2.4 Agent / workflow architecture

AdBrain is organized as a **pipeline of narrow, single-responsibility agents**, each one a pure function of (data in DB) → (structured output written to DB). None of them call the Meta API directly except the ingestion agent; none of them execute actions. This mirrors Creative OS's `pipeline_runs`/stage model so the two systems are operationally familiar to the same team.

| Order | Agent | Trigger | Input | Output |
|---|---|---|---|---|
| 1 | **Ingestion Agent** | cron (hourly) + manual backfill | Meta Marketing API | rows in `raw_meta_*` + normalized `campaigns/ad_sets/ads/ad_creatives/performance_daily` |
| 2 | **Data Quality Agent** | after ingestion | normalized data | `tracking_health_checks` rows; blocks/flags downstream confidence if signal is unreliable |
| 3 | **Creative Classification Agent** | after ingestion, new/changed creatives only | ad_creative text + image/video + Meta metadata | `ad_creative_attributes` (multimodal LLM tagging against the taxonomy) |
| 4 | **Performance Diagnosis Agent** | daily, after ingestion + data quality | `performance_daily` deltas vs. baseline | `diagnoses`, `anomalies` |
| 5 | **Winner/Fatigue Detection Agent** | daily | `performance_daily` + `ad_creative_attributes` | `creative_scorecards` (winner/fatigue/neutral + evidence + narrative) |
| 6 | **Recommendation Agent** | daily, after 4 & 5 | diagnoses + scorecards + budget/pacing calcs | `recommendations` (Problem/Evidence/Cause/Action/Confidence) |
| 7 | **Hypothesis Agent** | on-demand (from a recommendation or fatigue signal) or weekly batch | scorecards + `learnings` + recommendation | `hypotheses` + `hypothesis_concepts` (3–5 concepts each) |
| 8 | **Reporting Agent** | daily / weekly cron | diagnoses + recommendations + scorecards for the period | `daily_reports` / `weekly_reports` |
| 9 | **Learning Agent** | after an experiment is marked concluded, or weekly | `experiments` + `creative_scorecards` history | `learnings` (used as retrieval context by agents 5–7, see docs/06) |

Each agent run is logged to `agent_runs` (stage, status, input/output refs, cost, duration) — the same auditability pattern as Creative OS's `pipeline_runs`, so every number the UI shows can be traced back to the exact run and prompt version that produced it.

### Why agents, not one big prompt

- **Determinism where it matters:** fatigue/winner detection and anomaly math are rule-based and statistical (docs/04), not LLM guesses. The LLM's job is narrating *already-computed* evidence, never computing the evidence itself. This avoids hallucinated numbers.
- **Debuggability:** each agent has one job, one input shape, one output schema — failures are isolated and re-runnable.
- **Cost control:** classification only runs on new/changed creatives; diagnosis only runs on entities with a meaningful delta (see anomaly thresholds in docs/04), not the whole account every time.
