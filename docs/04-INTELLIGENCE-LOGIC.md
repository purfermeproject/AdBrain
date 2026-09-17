# 4. Creative Classification, Detection Logic & Recommendation Engine

Everything in this document is **computed deterministically first**; the LLM is only used to (a) classify creative attributes from raw assets and (b) narrate already-computed evidence. No AI model is ever asked to "decide" whether something is a winner or is fatigued from scratch — that would be unauditable and inconsistent. Thresholds below are sensible defaults; make them configurable per workspace once real data shows they need tuning.

## 4.1 Creative classification system

### 4.1.1 Taxonomy (the `ad_creative_attributes.dimension` / `.value` vocabulary)

| Dimension | Example values |
|---|---|
| `format` | static, video, carousel, collection, dpa |
| `hook_type` | problem_led, benefit_led, curiosity, social_proof, statistic, testimonial_open, question |
| `angle` | freeform text, but rolled up to a small controlled set per brand (synced from Creative OS's `angles.name` where available) |
| `opening_frame` | product_in_frame, person_in_frame, text_only, lifestyle_scene |
| `product_timing` | shown_first_3s, shown_mid, shown_late, not_shown |
| `offer_type` | discount, bundle, free_shipping, no_offer, urgency_limited_time |
| `cta_style` | direct_buy, learn_more, soft_ask, benefit_framed |
| `creator_type` | ugc_creator, founder, actor_model, none_voiceover_only, animation |
| `visual_style` | raw_ugc, polished_studio, lifestyle, product_macro, meme_native |
| `emotional_register` | emotional, rational, humorous, aspirational |
| `messaging_mode` | product_led, lifestyle_led |
| `proof_type` | testimonial, review_screenshot, stat_claim, before_after, none |
| `urgency_signal` | present, absent |
| `duration_bucket` | (video only) under_6s, 6_15s, 15_30s, over_30s |
| `copy_style` | short_punchy, story_driven, list_style, direct_response_long |
| `headline_structure` | question, command, benefit_statement, curiosity_gap |

This taxonomy is stored as a config table/JSON (not hardcoded) so it can be extended per brand without a migration — but the **column names on `ad_creative_attributes` stay generic** (`dimension`/`value`) precisely so the taxonomy can grow.

### 4.1.2 Classification pipeline

1. Trigger: a new `ad_creatives` row appears, or `primary_asset_url`/`headline`/`primary_text` changes.
2. Input to the model: primary image (or extracted video thumbnail + first/last frame), headline, primary text, CTA type, destination URL domain.
3. Output: one structured JSON object with every dimension above, each with a `value` + `confidence` (0–1). See exact prompt in [docs/05](05-AI-PROMPTS.md#creative-classification-agent).
4. Low-confidence tags (`confidence < 0.55`) are stored but flagged `source='ai', confidence=<value>` and excluded from attribute-performance aggregation (4.1.3) until either a higher-confidence re-classification or a human override (`source='human'`) occurs.
5. Re-classification is idempotent (`unique(ad_creative_id, dimension)` — upsert), so improving the taxonomy or the model later can be backfilled with a re-run.

### 4.1.3 Attribute → performance linkage (how "problem-led UGC beats static by 34% on CTR" gets computed)

For a chosen metric (CTR, CPC, CPA, ROAS, CVR) and window:

```
for each dimension d:
  for each value v of d:
    group_ads = ads whose ad_creative has attribute (d, v), confidence >= 0.55
    require: distinct_ad_count(group_ads) >= 5  AND  sum(impressions) >= 5,000
             (raise conversion-based metrics like CPA/ROAS to require
              sum(purchases) >= 20 — otherwise mark 'insufficient_data')
    group_metric = spend-weighted average of metric across group_ads
    baseline_metric = same calc across all eligible ads EXCLUDING group_ads
    lift_pct = (group_metric - baseline_metric) / baseline_metric   -- sign
               flipped for "lower is better" metrics like CPC/CPA
  rank values of d by lift_pct desc, keep top/bottom 3 with |lift_pct| > 10%
```

This produces the exact sentence shape requested: *"Problem-led UGC ads with the product shown in the first 3 seconds are outperforming static ads by 34% on CTR and 21% on CPA"* — by intersecting two dimensions (`hook_type=problem_led` AND `format=ugc` AND `product_timing=shown_first_3s`) when the single-dimension lift is large and the combined group still clears the sample-size floor; otherwise it's reported as two separate single-dimension findings to avoid an underpowered combined claim.

## 4.2 Anomaly detection

Baseline: trailing 14-day mean and standard deviation of the metric **excluding** the day being evaluated and excluding any day already flagged as an anomaly (so one bad day doesn't poison the baseline).

```
z = (observed_today - baseline_mean) / baseline_stddev
flag if |z| > 2.0            -> severity = medium
flag if |z| > 3.0             -> severity = high
minimum baseline sample: 7 days of data; otherwise 'insufficient_data', no flag
minimum volume floor: metric must be computed on >= 1,000 impressions (or
  >= 10 conversions for CPA/ROAS) that day, else treat as noise, don't flag
```

Applies per entity (account/campaign/ad set/ad) for: spend, CTR, CPC, CPM, CPA, ROAS, conversion volume, frequency. Anomalies are the *trigger* for the Performance Diagnosis Agent to write a `diagnoses` row — diagnosis isn't run on every entity every day, only where an anomaly (or a smaller but sustained 3-day directional trend, see 4.3) exists, to keep noise and AI cost down.

**Alert suppression (avoid overwhelming the user):** at most one `anomalies` row per entity per metric per rolling 3-day window (a metric that's been bad for 3 days doesn't re-alert daily — it escalates severity and gets referenced in the existing open anomaly instead of creating a new one). Anomalies auto-resolve when the metric returns within 1 standard deviation of baseline for 2 consecutive days.

## 4.3 Sustained-trend detection (catches gradual decline anomaly-detection misses)

For CTR, CPC, CPA, ROAS, conversion rate: compare the trailing 3-day spend-weighted average to the prior 3-day spend-weighted average.

```
pct_change = (recent_3d - prior_3d) / prior_3d
flag as a directional diagnosis trigger if:
  |pct_change| >= 15%   AND
  recent_3d window has >= 1,000 impressions (or >= 10 conversions for CPA/ROAS)
```

This is what catches "CTR declined 26% over 5 days" even though no single day was a statistical outlier.

## 4.4 Cause discrimination (creative fatigue vs. audience saturation vs. auction cost vs. landing page vs. tracking)

Run in this order — first matching rule wins as the *primary* likely cause (others are still recorded as contributing factors in `evidence`):

| Check | Signal pattern | Likely cause |
|---|---|---|
| 1. Tracking check first | `tracking_health_checks` has an open `critical` finding for this account/date range | `tracking` (recommendation engine downgrades confidence on everything else until resolved — see 4.7) |
| 2. Funnel-stage isolation | Landing-page-view→purchase rate stable, but landing-page-view volume/CTR collapsed | not a landing-page issue → check 3/4 |
| 3. Creative fatigue | `frequency` up >30% over the window AND `frequency` absolute > 2.5 AND CTR down >=15% AND CPM flat (±10%) | `creative_fatigue` |
| 4. Audience saturation | `frequency` up similarly, but **CTR stable/flat** and CPM/CPC rising, and it's occurring **account-wide across multiple creatives in the same ad set**, not isolated to one creative | `audience_saturation` |
| 5. Auction cost | CPM up account-wide (multiple unrelated ad sets/campaigns move together) with CTR stable | `auction_cost` (external/seasonal, not this account's doing) |
| 6. Landing page | CTR stable/up, but landing-page-view→ATC or ATC→purchase rate drops while creative/audience unchanged | `landing_page` |
| 7. Budget/pacing | none of the above, but spend pattern is erratic vs. budget (see 4.6) | `budget_pacing` |
| 8. Offer | ATC→purchase drop correlates with a known price/offer change logged for the product | `offer` |
| Fallback | none of the above clears its evidence bar | `unknown`, confidence = low, recommended_action = `investigate` |

This is exactly the discrimination the product spec calls for: *"High CTR + low LPV → possible page speed issue; High LPV + low ATC → offer/product page issue; High ATC + low purchase → checkout/pricing issue"* is check 2/6/8 above, generalized into the funnel breakpoint logic in 4.5.

## 4.5 Funnel break-point logic

Compute stage-to-stage conversion rates for the window and its comparison period:

```
Impressions → Clicks        (CTR)
Clicks → Landing Page Views (LPV rate)          — flags "page load/redirect issue" if low
LPV → Add to Cart / Lead    (ATC/Lead rate)      — flags "offer/product page issue" if low
ATC → Purchase              (checkout rate)      — flags "checkout/pricing issue" if low
```

Diagnosis picks the **earliest stage with a significant rate drop** (>=15% relative decline, same volume floors as 4.3) as the primary funnel break point, since fixing an upstream break is usually higher leverage than a downstream one, and reports the others as secondary.

## 4.6 Budget & pacing intelligence

```
expected_spend_so_far = daily_budget * (elapsed_hours_in_account_tz / 24)
pacing_ratio = actual_spend_so_far / expected_spend_so_far
flag 'overspending' if pacing_ratio > 1.3
flag 'underdelivering' if pacing_ratio < 0.7  (and campaign is ACTIVE, not
  learning-phase-limited)

spend_share = campaign_spend / account_spend  (trailing window)
purchase_share = campaign_purchases / account_purchases  (same window)
flag 'spend concentration mismatch' if spend_share - purchase_share > 15
  percentage points  (e.g. "42% of spend but only 19% of purchases")
```

Budget recommendations are always framed as **proposals with both opportunity and risk** (per spec §13/§20) — e.g., "Campaign A is using 42% of spend but contributes only 19% of purchases. Consider shifting ~10–15% of daily budget to Campaign C, which is under-delivering relative to its efficiency. Risk: Campaign A's ROAS has been more stable historically; verify creative fatigue isn't the actual driver (see linked diagnosis) before reallocating." No budget is ever changed automatically.

## 4.7 Winner detection

Eligibility floor (avoid ranking noise): `impressions >= 3,000` and `spend >= 0.5x average daily ad spend` over the scoring window (default 7 days).

```
For eligible ads, compute percentile rank (0-100) within their peer group
(same funnel_stage, same objective, same window) for each of: CTR, CPA
(inverted), ROAS, CVR (weight: 25% each, configurable).
composite_score = weighted average of the four percentile ranks
status = 'winner' if composite_score >= 80th percentile of its peer group
          AND at least 2 of the 4 component metrics are individually >= 70th
          percentile (avoids a fluke single-metric spike calling itself a winner)
```

**Explaining *why*:** once an ad is a winner, look up its `ad_creative_attributes` and cross-reference against the current attribute→performance leaderboard (4.1.3). The narrative names the 2–3 attributes that both (a) this ad has and (b) are currently in the top-lift set for its funnel stage — producing *"Ad 24 is winning because it combines a problem-first hook, UGC format, product reveal within 2 seconds, and a strong benefit-led CTA"* rather than a bare score. Those named attributes are exactly what the Hypothesis Engine (4.9) treats as "reusable elements."

## 4.8 Fatigue detection (scorecard `fatigue_score`)

```
fatigue_score (0-100) = weighted sum of normalized signal strengths:
  35%  frequency_trend   = clamp((freq_now - freq_7d_ago) / freq_7d_ago, 0, 1) * 100
                            (only counted if freq_now > 2.2, per platform norms)
  30%  ctr_decline        = clamp(-(ctr_recent3d - ctr_prior3d) / ctr_prior3d, 0, 1) * 100
  20%  cpc_increase       = clamp((cpc_recent3d - cpc_prior3d) / cpc_prior3d, 0, 1) * 100
  15%  cpa_or_roas_trend  = clamp(cpa increase % or roas decrease %, 0, 1) * 100

status = 'fatiguing' if fatigue_score >= 55 AND likely_cause (4.4) ==
          'creative_fatigue' (i.e., CPM stayed flat — if CPM also rose, the
          same numbers point to auction_cost/audience_saturation instead,
          and the ad is NOT labeled fatigued even though its raw numbers look
          similar — this is the fatigue-vs-saturation-vs-auction split)
```

Narrative example matches the spec directly: *"Creative 17 shows probable fatigue: frequency increased from 2.1 to 3.8, CTR dropped 32%, and CPC increased 27% while CPM remained stable."*

## 4.9 Creative Hypothesis Engine

Input: a `recommendations` row with `recommended_action IN ('create_new_creative','test_new_hook','test_new_audience')`, or directly a `creative_scorecards` row with `status='fatiguing'`.

Pipeline:

1. **Pull winning pattern context:** current top-lift attribute values for this brand/funnel-stage (4.1.3 output), plus active `learnings` rows for this brand/product (docs/06).
2. **Pull the fatiguing/underperforming creative's own attributes** — the hypothesis must state what's saturated, not just what's winning in general.
3. **LLM call (structured output)** produces:
   - `statement`: a diagnosis-style hypothesis sentence — *"The angle still works, but the current visual treatment is saturated. Test the same product benefit through lifestyle-led and routine-based creative."*
   - 3–5 `hypothesis_concepts`, each with `angle / hook / format / creator_persona / visual_direction / cta / audience / funnel_stage / test_objective` — matching the exact shape in the product spec's example ("Angle: Morning breakfast routine / Hook: ... / Format: UGC / Audience: ... / Funnel: Prospecting / Objective: ...").
4. **Constraint:** concepts must vary at least one attribute from the current top-lift set (that's the point — proposing more of exactly what's already saturating isn't a new test) while keeping at least one proven-winning element anchored (so it's not a random shot in the dark either). The prompt explicitly encodes this trade-off (see [docs/05](05-AI-PROMPTS.md#hypothesis-generation-agent)).
5. Each concept, once approved and sent to Creative OS, becomes traceable end-to-end: `hypothesis_concepts.creative_os_opportunity_id` → Creative OS `opportunities.id` → ... → `production_jobs` → the rendered creative → (once live) a new `ad_creatives` row with `creative_os_production_job_id` set, closing the loop back into `performance_daily`.

## 4.10 Recommendation engine

Every diagnosis/scorecard with a non-trivial finding maps to exactly one `recommendations` row with all five required fields:

```
Problem:            one sentence, what's wrong (or what opportunity exists)
Evidence:            the specific numbers (pulled verbatim from the
                     diagnosis/scorecard's `evidence` jsonb — never re-stated
                     loosely by the LLM)
Likely cause:        from the controlled vocabulary in 4.4
Recommended action:  from the controlled vocabulary (keep_running, watch,
                     investigate, create_new_creative, test_new_hook,
                     test_new_audience, pause_candidate, reduce_budget,
                     increase_budget, fix_tracking, improve_landing_page,
                     duplicate_to_new_audience, expand_geography)
Confidence:          low/medium/high, driven mechanically by: sample size
                     vs. the floors in 4.1–4.8, whether tracking health is
                     ok (any open critical tracking issue caps confidence
                     at 'low' account-wide per §11 of the spec), and whether
                     cause-discrimination (4.4) hit a specific rule or the
                     'unknown' fallback
```

Mapping table (deterministic — the LLM fills in the prose, this table decides the action):

| Signal | Action |
|---|---|
| Winner (4.7), spend headroom available, stable 7+ days | `increase_budget` or `duplicate_to_new_audience` (see 4.11) |
| Winner, but already at high spend share | `keep_running` |
| Fatiguing (4.8) | `create_new_creative` (+ auto-triggers Hypothesis Engine) |
| Underperforming, cause=`creative_fatigue` or `unknown`, recent (<5 days) | `watch` |
| Underperforming, sustained (>=5 days), cause=`creative_fatigue` | `pause_candidate` + `create_new_creative` |
| cause=`tracking` | `fix_tracking`, confidence forced to `low` on any co-occurring recommendation for the same account until resolved |
| cause=`landing_page` | `improve_landing_page` |
| cause=`budget_pacing`, overspend/underdeliver | `reduce_budget` / `increase_budget` with the exact numbers from 4.6 |
| cause=`audience_saturation` | `test_new_audience` |
| cause=`auction_cost` | `watch` (external, not actionable at the account level beyond bidding, which is out of scope for V1 recommendations) |

## 4.11 Scaling intelligence

Triggered only off an existing `winner` scorecard with >=7 days of stable "winner" status:

- **Increase budget:** recommend a bounded step (e.g., +20–25%, aligned with Meta's own guidance to avoid resetting the learning phase) — never an unbounded "scale hard" suggestion.
- **Duplicate into new audience:** recommend when the winning ad set's targeting has a clear adjacent, untested audience (e.g., a lookalike percentage not yet tested, or a geography with spend headroom).
- **Expand geography / more variants of winning angle:** surfaced as options, each with an explicit "Risk:" line (e.g., "duplicating resets the learning phase and may temporarily raise CPA for 3–5 days").

## 4.12 Audience intelligence (V1-lite, using Meta's native breakdowns)

For each ad set, use Meta's `breakdowns` (age, gender, placement, device, region where available) on `performance_daily.raw` to compute the same percentile/lift logic as 4.1.3, but keyed on audience dimensions instead of creative attributes — e.g. *"UGC performs well for prospecting but static offer-led ads perform better in remarketing"* is the 4.1.3 lift calculation re-run with `funnel_stage` as an additional group-by key, which is why `ad_sets.funnel_stage` is a first-class column. Full standalone audience-intelligence UI/reporting is V2 (docs/08); V1 folds these findings into diagnoses and recommendations rather than a dedicated audience dashboard.
