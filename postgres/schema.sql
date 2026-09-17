-- AdBrain — PostgreSQL schema (V1)
-- TARGET: dedicated database adbrain_db
-- IMPORTANT: This resets the PUBLIC schema in the CURRENT database.
-- Run ONLY in adbrain_db. Do not run in another database containing
-- valuable public-schema objects.
--
-- Source of truth for this schema is docs/03-DATA-MODEL.md §3.2 in this
-- repo. Table order here differs slightly from that doc (ad_creatives is
-- created before ads) so foreign keys resolve on a fresh database.

begin;

drop schema if exists public cascade;
create schema public;
grant all on schema public to postgres;
grant all on schema public to public;

create extension if not exists pgcrypto;

-- ---------- shared helpers ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- tenancy ----------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- brand_id / product_id are expected to MATCH Creative OS's brands.id /
-- products.id ('PF' / 'PF-COOKIE-BRK' style text ids) so rows can be
-- joined/synced across the two databases without an id-mapping table.
create table public.brands (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id text not null references public.brands(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- connections ----------
create table public.ad_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null check (platform in ('meta','google','ga4','shopify','crm')),
  external_account_id text not null,
  display_name text,
  access_token_encrypted text not null,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active','expired','revoked','error')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, external_account_id)
);

-- ---------- campaign hierarchy ----------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_connection_id uuid not null references public.ad_connections(id) on delete cascade,
  brand_id text references public.brands(id) on delete set null,
  external_id text not null,
  name text not null,
  objective text,
  status text,
  daily_budget numeric,
  lifetime_budget numeric,
  buying_type text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_connection_id, external_id)
);

create table public.ad_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  external_id text not null,
  name text not null,
  status text,
  targeting jsonb not null default '{}'::jsonb,
  optimization_goal text,
  daily_budget numeric,
  bid_strategy text,
  funnel_stage text check (funnel_stage in ('prospecting','retargeting','remarketing','unknown')),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, external_id)
);

-- ---------- creative + classification (created before ads: ads.ad_creative_id references this) ----------
create table public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id text references public.brands(id) on delete set null,
  product_id text references public.products(id) on delete set null,
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

create table public.ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_set_id uuid not null references public.ad_sets(id) on delete cascade,
  external_id text not null,
  name text not null,
  status text,
  ad_creative_id uuid references public.ad_creatives(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_set_id, external_id)
);

-- Structured classification taxonomy — see docs/04 for the full dimension
-- list. Kept as its own table (not jsonb-only) so we can index/filter and
-- run group-by aggregations for attribute→performance analysis.
create table public.ad_creative_attributes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_creative_id uuid not null references public.ad_creatives(id) on delete cascade,
  dimension text not null,
  value text not null,
  confidence numeric check (confidence between 0 and 1),
  source text not null default 'ai' check (source in ('ai','human')),
  model text,
  created_at timestamptz not null default now(),
  unique (ad_creative_id, dimension)
);

-- ---------- performance (grain: ad x day) ----------
create table public.performance_daily (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  ad_set_id uuid not null references public.ad_sets(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  ad_creative_id uuid references public.ad_creatives(id) on delete set null,
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
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_id, date)
);

-- ---------- data quality ----------
create table public.tracking_health_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_connection_id uuid not null references public.ad_connections(id) on delete cascade,
  check_type text not null,
  status text not null check (status in ('ok','warning','critical')),
  detail text,
  evidence jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

-- ---------- intelligence outputs ----------
create table public.anomalies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
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

create table public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('account','campaign','ad_set','ad','creative')),
  entity_id uuid,
  period_start date not null,
  period_end date not null,
  compare_period_start date,
  compare_period_end date,
  headline text not null,
  narrative text not null,
  likely_cause text check (likely_cause in
    ('creative_fatigue','audience_saturation','auction_cost','landing_page',
     'tracking','budget_pacing','offer','seasonal','unknown')),
  confidence text check (confidence in ('low','medium','high')),
  evidence jsonb not null default '{}'::jsonb,
  anomaly_id uuid references public.anomalies(id) on delete set null,
  agent_run_id uuid,
  created_at timestamptz not null default now()
);

create table public.creative_scorecards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_creative_id uuid not null references public.ad_creatives(id) on delete cascade,
  as_of date not null,
  window_days integer not null default 7,
  status text not null check (status in ('winner','fatiguing','underperforming','neutral','insufficient_data')),
  composite_score numeric,
  fatigue_score numeric,
  winner_reasons jsonb not null default '[]'::jsonb,
  fatigue_evidence jsonb not null default '{}'::jsonb,
  narrative text,
  created_at timestamptz not null default now(),
  unique (ad_creative_id, as_of, window_days)
);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('account','campaign','ad_set','ad','creative')),
  entity_id uuid,
  diagnosis_id uuid references public.diagnoses(id) on delete set null,
  scorecard_id uuid references public.creative_scorecards(id) on delete set null,
  problem text not null,
  evidence text not null,
  likely_cause text,
  recommended_action text not null check (recommended_action in
    ('keep_running','watch','investigate','create_new_creative','test_new_hook',
     'test_new_audience','pause_candidate','reduce_budget','increase_budget',
     'fix_tracking','improve_landing_page','duplicate_to_new_audience',
     'expand_geography')),
  action_detail jsonb not null default '{}'::jsonb,
  confidence text not null check (confidence in ('low','medium','high')),
  status text not null default 'proposed' check (status in
    ('proposed','approved','rejected','executed','outcome_logged','expired')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- hypothesis engine (hand-off to Creative OS) ----------
create table public.hypotheses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id text references public.brands(id) on delete set null,
  product_id text references public.products(id) on delete set null,
  source_recommendation_id uuid references public.recommendations(id) on delete set null,
  source_scorecard_id uuid references public.creative_scorecards(id) on delete set null,
  statement text not null,
  based_on_learnings jsonb not null default '[]'::jsonb,
  status text not null default 'proposed' check (status in
    ('proposed','approved','sent_to_creative_os','testing','concluded','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hypothesis_concepts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hypothesis_id uuid not null references public.hypotheses(id) on delete cascade,
  angle text,
  hook text,
  format text,
  creator_persona text,
  visual_direction text,
  cta text,
  audience text,
  funnel_stage text,
  test_objective text,
  creative_os_opportunity_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- experiment memory & learning ----------
create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hypothesis_id uuid references public.hypotheses(id) on delete set null,
  hypothesis_text text not null,
  creative_ids uuid[] not null default '{}',
  audience text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  expected_outcome text,
  actual_result jsonb not null default '{}'::jsonb,
  conclusion text,
  status text not null default 'running' check (status in ('draft','running','concluded','cancelled')),
  started_at date,
  concluded_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.learnings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id text references public.brands(id) on delete set null,
  product_id text references public.products(id) on delete set null,
  component_type text not null,
  component_key text not null,
  signal text not null,
  evidence jsonb not null default '{}'::jsonb,
  confidence text check (confidence in ('low','medium','high')),
  source_experiment_id uuid references public.experiments(id) on delete set null,
  status text not null default 'active' check (status in ('active','superseded','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- reporting ----------
create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_date date not null,
  summary text not null,
  sections jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, report_date)
);

create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  summary text not null,
  sections jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, week_start)
);

-- ---------- auditability ----------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent text not null,
  status text not null check (status in ('running','complete','failed')),
  input_ref jsonb not null default '{}'::jsonb,
  output_ref jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ---------- indexes ----------
create index idx_campaigns_workspace on public.campaigns(workspace_id, ad_connection_id);
create index idx_ad_sets_campaign on public.ad_sets(workspace_id, campaign_id);
create index idx_ads_ad_set on public.ads(workspace_id, ad_set_id);
create index idx_ad_creatives_workspace on public.ad_creatives(workspace_id, brand_id, product_id);
create index idx_ad_creative_attributes_lookup on public.ad_creative_attributes(workspace_id, dimension, value);
create index idx_performance_daily_ad_date on public.performance_daily(workspace_id, ad_id, date desc);
create index idx_performance_daily_campaign_date on public.performance_daily(workspace_id, campaign_id, date desc);
create index idx_tracking_health_checks_connection on public.tracking_health_checks(workspace_id, ad_connection_id, status);
create index idx_anomalies_status on public.anomalies(workspace_id, status, severity, date desc);
create index idx_diagnoses_entity on public.diagnoses(workspace_id, entity_type, entity_id, period_end desc);
create index idx_creative_scorecards_creative on public.creative_scorecards(workspace_id, ad_creative_id, as_of desc);
create index idx_recommendations_status on public.recommendations(workspace_id, status, created_at desc);
create index idx_hypotheses_status on public.hypotheses(workspace_id, status, created_at desc);
create index idx_hypothesis_concepts_hypothesis on public.hypothesis_concepts(workspace_id, hypothesis_id);
create index idx_experiments_status on public.experiments(workspace_id, status, created_at desc);
create index idx_learnings_component on public.learnings(workspace_id, component_type, component_key, status);
create index idx_agent_runs_workspace on public.agent_runs(workspace_id, agent, started_at desc);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','brands','products','ad_connections','campaigns','ad_sets',
    'ad_creatives','ads','performance_daily','recommendations','hypotheses',
    'experiments','learnings'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || t || '_updated_at', t);
  end loop;
end $$;

commit;

-- Verification helper: after execution this should return a list of AdBrain tables.
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
