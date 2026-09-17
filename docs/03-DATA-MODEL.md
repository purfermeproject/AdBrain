# 3. Database Schema, Meta Ads Integration & Data Normalization

## 3.1 Conventions (matched to Creative OS for consistency)

- `workspace_id uuid` scopes every table (multi-brand ready from day one, even though V1 runs one brand).
- Domain entities use human-legible `text` primary keys where Creative OS does (`brand_id`, `product_id`); AdBrain's own new entities (recommendations, diagnoses, hypotheses) use `uuid` since they have no natural external key.
- Flexible/variable data lives in `jsonb data` columns; anything queried/filtered/joined on gets a real typed column.
- Every table gets `created_at`/`updated_at` + the shared `set_updated_at()` trigger.
- Platform IDs from Meta (`campaign_id`, `adset_id`, `ad_id`, `creative_id` from the Graph API) are stored as `external_id text` alongside our own `uuid id`, so we never leak Meta's ID format into join logic and can add Google Ads in V2 without a schema break.

## 3.2 Core schema (V1)

```sql
-- ============ tenancy (reuse Creative OS pattern) ============
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- brand_id / product_id are expected to MATCH Creative OS's brands.id /
-- products.id (both are 'PF' / 'PF-COOKIE-BRK' style text ids) so rows can
-- be joined/synced across the two databases without an id-mapping table.
create table brands (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ connections ============
create table ad_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null check (platform in ('meta','google','ga4','shopify','crm')),
  external_account_id text not null,       -- Meta act_<id>
  display_name text,
  access_token_encrypted text not null,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active','expired','revoked','error')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, external_account_id)
);

-- ============ campaign hierarchy ============
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_connection_id uuid not null references ad_connections(id) on delete cascade,
  brand_id text references brands(id) on delete set null,
  external_id text not null,
  name text not null,
  objective text,
  status text,                              -- ACTIVE/PAUSED/... (platform-native)
  daily_budget numeric,
  lifetime_budget numeric,
  buying_type text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_connection_id, external_id)
);

create table ad_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  external_id text not null,
  name text not null,
  status text,
  targeting jsonb not null default '{}'::jsonb,   -- normalized: geo, age, gender,
                                                     -- interests, lookalike_source,
                                                     -- placement, device
  optimization_goal text,
  daily_budget numeric,
  bid_strategy text,
  funnel_stage text check (funnel_stage in ('prospecting','retargeting','remarketing','unknown')),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, external_id)
);

create table ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_set_id uuid not null references ad_sets(id) on delete cascade,
  external_id text not null,
  name text not null,
  status text,
  ad_creative_id uuid references ad_creatives(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_set_id, external_id)
);

-- ============ creative + classification ============
create table ad_creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id text references brands(id) on delete set null,
  product_id text references products(id) on delete set null,
  external_id text not null,
  -- bridge to Creative OS: if this creative originated from a Creative OS
  -- production_job, store that id here so performance can be joined back.
  creative_os_production_job_id text,
  format text check (format in ('static','video','carousel','collection','dpa')),
  primary_asset_url text,
  headline text,
  primary_text text,
  cta_type text,
  destination_url text,
  first_seen_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_id)
);

-- Structured classification taxonomy — see docs/04 for the full dimension
-- list. Kept as its own table (not jsonb-only) so we can index/filter and
-- run group-by aggregations for attribute→performance analysis.
create table ad_creative_attributes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_creative_id uuid not null references ad_creatives(id) on delete cascade,
  dimension text not null,     -- e.g. 'hook_type','angle','opening_frame',
                                -- 'product_timing','offer_type','cta_style',
                                -- 'creator_type','visual_style','emotional_register',
                                -- 'proof_type','duration_bucket','copy_style'
  value text not null,         -- e.g. 'problem_led','ugc','product_in_first_3s'
  confidence numeric check (confidence between 0 and 1),
  source text not null default 'ai' check (source in ('ai','human')),
  model text,                  -- which model/version produced this tag
  created_at timestamptz not null default now(),
  unique (ad_creative_id, dimension)
);

-- ============ performance (grain: ad x day) ============
create table performance_daily (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_id uuid not null references ads(id) on delete cascade,
  ad_set_id uuid not null references ad_sets(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  ad_creative_id uuid references ad_creatives(id) on delete set null,
  date date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  frequency numeric,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  landing_page_views bigint not null default 0,
  add_to_cart bigint not null default 0,
  leads bigint not null default 0,
  purchases bigint not null default 0,
  revenue numeric not null default 0,
  cpa numeric,
  cpl numeric,
  roas numeric,
  conversion_rate numeric,
  raw jsonb not null default '{}'::jsonb,     -- full Meta insights row
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_id, date)
);

-- ============ data quality ============
create table tracking_health_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_connection_id uuid not null references ad_connections(id) on delete cascade,
  check_type text not null,   -- 'pixel_capi_match','event_drop','duplicate_conversion',
                               -- 'utm_missing','attribution_gap'
  status text not null check (status in ('ok','warning','critical')),
  detail text,
  evidence jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

-- ============ intelligence outputs ============
create table anomalies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('account','campaign','ad_set','ad','creative')),
  entity_id uuid,
  metric text not null,
  date date not null,
  observed_value numeric,
  baseline_mean numeric,
  baseline_stddev numeric,
  z_score numeric,
  severity text not null check (severity in ('low','medium','high')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_at timestamptz not null default now()
);

create table diagnoses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('account','campaign','ad_set','ad','creative')),
  entity_id uuid,
  period_start date not null,
  period_end date not null,
  compare_period_start date,
  compare_period_end date,
  headline text not null,          -- one-sentence diagnosis, evidence-backed
  narrative text not null,         -- fuller explanation
  likely_cause text check (likely_cause in
    ('creative_fatigue','audience_saturation','auction_cost','landing_page',
     'tracking','budget_pacing','offer','seasonal','unknown')),
  confidence text check (confidence in ('low','medium','high')),
  evidence jsonb not null default '{}'::jsonb,   -- the exact metrics/deltas used
  anomaly_id uuid references anomalies(id) on delete set null,
  agent_run_id uuid,
  created_at timestamptz not null default now()
);

create table creative_scorecards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_creative_id uuid not null references ad_creatives(id) on delete cascade,
  as_of date not null,
  window_days integer not null default 7,
  status text not null check (status in ('winner','fatiguing','underperforming','neutral','insufficient_data')),
  composite_score numeric,          -- percentile-based score, see docs/04
  fatigue_score numeric,
  winner_reasons jsonb not null default '[]'::jsonb,   -- attribute-level "why"
  fatigue_evidence jsonb not null default '{}'::jsonb, -- frequency/CTR/CPC deltas
  narrative text,
  created_at timestamptz not null default now(),
  unique (ad_creative_id, as_of, window_days)
);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('account','campaign','ad_set','ad','creative')),
  entity_id uuid,
  diagnosis_id uuid references diagnoses(id) on delete set null,
  scorecard_id uuid references creative_scorecards(id) on delete set null,
  problem text not null,
  evidence text not null,
  likely_cause text,
  recommended_action text not null check (recommended_action in
    ('keep_running','watch','investigate','create_new_creative','test_new_hook',
     'test_new_audience','pause_candidate','reduce_budget','increase_budget',
     'fix_tracking','improve_landing_page','duplicate_to_new_audience',
     'expand_geography')),
  action_detail jsonb not null default '{}'::jsonb,   -- e.g. suggested budget delta
  confidence text not null check (confidence in ('low','medium','high')),
  status text not null default 'proposed' check (status in
    ('proposed','approved','rejected','executed','outcome_logged','expired')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ hypothesis engine (hand-off to Creative OS) ============
create table hypotheses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id text references brands(id) on delete set null,
  product_id text references products(id) on delete set null,
  source_recommendation_id uuid references recommendations(id) on delete set null,
  source_scorecard_id uuid references creative_scorecards(id) on delete set null,
  statement text not null,     -- "The angle still works, but the visual
                                --  treatment is saturated..."
  based_on_learnings jsonb not null default '[]'::jsonb,  -- learning ids used
  status text not null default 'proposed' check (status in
    ('proposed','approved','sent_to_creative_os','testing','concluded','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hypothesis_concepts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  hypothesis_id uuid not null references hypotheses(id) on delete cascade,
  angle text,
  hook text,
  format text,
  creator_persona text,
  visual_direction text,
  cta text,
  audience text,
  funnel_stage text,
  test_objective text,
  -- populated once "Send to Creative OS" is clicked:
  creative_os_opportunity_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ experiment memory & learning ============
create table experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  hypothesis_id uuid references hypotheses(id) on delete set null,
  hypothesis_text text not null,
  creative_ids uuid[] not null default '{}',
  audience text,
  campaign_id uuid references campaigns(id) on delete set null,
  expected_outcome text,
  actual_result jsonb not null default '{}'::jsonb,
  conclusion text,
  status text not null default 'running' check (status in ('draft','running','concluded','cancelled')),
  started_at date,
  concluded_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table learnings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id text references brands(id) on delete set null,
  product_id text references products(id) on delete set null,
  component_type text not null,   -- 'attribute','audience','funnel_stage','pricing'...
  component_key text not null,    -- e.g. 'hook_type=problem_led'
  signal text not null,           -- human-readable learning statement
  evidence jsonb not null default '{}'::jsonb,
  confidence text check (confidence in ('low','medium','high')),
  source_experiment_id uuid references experiments(id) on delete set null,
  status text not null default 'active' check (status in ('active','superseded','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ reporting ============
create table daily_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  report_date date not null,
  summary text not null,
  sections jsonb not null default '{}'::jsonb,  -- {what_changed, why, watch_today, test_next}
  created_at timestamptz not null default now(),
  unique (workspace_id, report_date)
);

create table weekly_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  summary text not null,
  sections jsonb not null default '{}'::jsonb,  -- {wins, losses, creative_learnings,
                                                  --  audience_learnings, funnel_issues,
                                                  --  tests_completed, tests_recommended,
                                                  --  budget_observations, next_week_plan}
  created_at timestamptz not null default now(),
  unique (workspace_id, week_start)
);

-- ============ auditability ============
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent text not null,         -- 'ingestion','data_quality','creative_classification',
                                -- 'performance_diagnosis','winner_fatigue','recommendation',
                                -- 'hypothesis','reporting','learning'
  status text not null check (status in ('running','complete','failed')),
  input_ref jsonb not null default '{}'::jsonb,
  output_ref jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
```

Indexes to add alongside the tables above (mirrors Creative OS's index style): `performance_daily(workspace_id, ad_id, date desc)`, `performance_daily(workspace_id, campaign_id, date desc)`, `ad_creative_attributes(workspace_id, dimension, value)`, `diagnoses(workspace_id, entity_type, entity_id, period_end desc)`, `recommendations(workspace_id, status, created_at desc)`, `anomalies(workspace_id, status, severity, date desc)`.

## 3.3 Meta Ads API integration architecture

```
┌────────────┐   OAuth (Business Login)   ┌───────────────┐
│  Marketer   │ ───────────────────────▶ │  ad_connections     │
└────────────┘                             │  (encrypted token)  │
                                            └─────────┬─────────┘
                                                       ▼
                                     ┌───────────────────────────┐
                                     │  Ingestion Agent (server job)   │
                                     │  Meta Marketing Graph API v21+  │
                                     └─────────────┬───────────────┘
              ┌────────────────────────────┤────────────────────────────┤
              ▼                                    ▼                                    ▼
   GET /act_<id>/campaigns             GET .../adsets, .../ads,             GET .../insights
   fields: id,name,objective,           .../adcreatives                     level=ad, time_increment=1
   status,daily_budget,                 fields: id,name,targeting,           fields: spend,impressions,
   lifetime_budget,buying_type          optimization_goal, creative{...}     reach,frequency,clicks,
                                                                              actions,action_values,ctr,
                                                                              cpc,cpm,...
```

**Auth:** Meta Business Login (OAuth2), `ads_read` scope for V1 (read-only — matches the human-approval mandate; `ads_management` is only requested in V2 when "approve & execute" ships, and even then only for the specific scoped write the human approved).

**Sync strategy:**
- **Backfill (once per connection):** pull last 90 days at `time_increment=1` (daily grain) for campaigns/ad sets/ads/creatives + insights, batched via Meta's async Insights API (`/insights` with `async=true`) to avoid rate limits/timeouts on large accounts.
- **Incremental (hourly cron):** pull yesterday + today (today's numbers are provisional and get overwritten as Meta finalizes attribution — the last 3 days are always re-pulled to capture late conversions).
- **Rate limiting:** respect Meta's `X-Business-Use-Case-Usage` header; back off exponentially on `80004`/`17` errors; batch requests via the Batch API (up to 50 per call) for entity metadata.
- **Creative assets:** image/video URLs and text fields pulled from `adcreatives` (`object_story_spec`, `asset_feed_spec` for dynamic/flexible ads); videos over a duration threshold get their thumbnail + first/last frame extracted (via a lightweight ffmpeg step) for the multimodal classification agent — full video ingestion for frame-by-frame analysis is a V2 upgrade, V1 uses thumbnail + on-platform video metadata (duration, captions if present) + ad copy.

## 3.4 Data normalization strategy

1. **Raw landing (optional but recommended):** store the exact Meta API JSON response in `raw jsonb` on each normalized row (already reflected in the schema above) rather than a separate raw-staging table — for MVP scale (one brand, a handful of accounts) this is simpler than a full raw/staging/mart split and still gives full replayability if a normalization bug is found.
2. **Entity resolution:** Meta's own hierarchy (`campaign → adset → ad → creative`) maps directly to our tables; `external_id` + `ad_connection_id` is the natural key for idempotent upserts (`ON CONFLICT ... DO UPDATE`).
3. **Metric derivation:** Meta returns `actions`/`action_values` as an array of `{action_type, value}` — the ingestion normalizer maps known action types (`landing_page_view`, `add_to_cart`, `lead`, `purchase`, `omni_purchase`) into the named columns on `performance_daily`, and preserves the rest in `raw`. Derived ratios (CTR, CPC, CPM, CPA, CPL, ROAS, conversion rate) are **computed at write time**, not left to be recomputed ad hoc in the UI, so every downstream module reads the same numbers.
4. **Currency/timezone:** normalize to the ad account's reporting currency and timezone at ingestion; store both the account timezone and UTC date to avoid off-by-one-day bugs when comparing "yesterday."
5. **Attribution window:** V1 uses the account's configured attribution setting (typically 7-day click / 1-day view) as reported by Meta — AdBrain does not attempt to re-attribute; if the setting changes mid-account-life, that's logged as a `tracking_health_checks` warning since it breaks period-over-period comparability.
6. **Multi-platform readiness:** `ad_connections.platform` and the `external_id` pattern mean Google Ads/GA4 (V2) plug into the same `campaigns/ad_sets/ads/performance_daily` shape rather than needing parallel tables — a platform-specific normalizer feeds the same normalized schema.

## 3.5 Integration with Creative OS

Two intentionally simple integration points for V1 (no shared database, no synchronous coupling — Creative OS keeps running standalone):

1. **Hypothesis → Opportunity hand-off (AdBrain → Creative OS, write):** `POST /api/opportunities` on Creative OS (new endpoint, small addition to that app) creates a row in `creative_os_db.opportunities` from a `hypothesis_concepts` row — `territory_name`, `buyer_tension`, `psychological_lever` etc. are filled from the hypothesis fields, `score`/`evidence_confidence` carried over from AdBrain's confidence rating, and `data` stores a back-reference (`{source: 'adbrain', hypothesis_concept_id}`). This lets a marketer go from "AdBrain says test this" straight into Creative OS's existing angle→hook→brief flow with zero re-typing.
2. **Performance → Creative OS learning sync (AdBrain → Creative OS, write, batched daily):** once a `creative_os_production_job_id` is known for an `ad_creatives` row (i.e., the ad running on Meta was produced by Creative OS), AdBrain writes a rollup into `creative_os_db.performance` (that table already exists with exactly this shape: `creative_id, date, platform, campaign, spend, impressions, clicks, ctr, cpc, purchases, revenue, cpa, roas`) and, when a `learnings` row is created in AdBrain, mirrors it into `creative_os_db.learnings` so Creative OS's own research/angle-generation prompts (which can read that table) benefit from the same account intelligence. This is a one-way, best-effort sync job (not a live join) — AdBrain remains the system of record for performance; Creative OS remains the system of record for creative production.

Both integration points are plain HTTP calls between the two Next.js apps (service-to-service API key, not user OAuth) — no new infrastructure required, and either app can be deployed/scaled independently.
