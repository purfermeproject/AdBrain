# 6. Memory/Learning Architecture & Human Approval Workflow

## 6.1 Memory/learning architecture

**Goal:** the system gets smarter from the account's own data, not from a generic prior. The `learnings` table (docs/03) is the single knowledge store; every agent that generates language (recommendation, hypothesis, diagnosis, reporting) retrieves relevant active learnings as context before generating.

### How a learning is created

1. **Automatic, from concluded experiments:** when an `experiments` row is marked `concluded` with a filled `actual_result`, the Learning Agent compares `expected_outcome` vs `actual_result`, drafts a `signal` + `confidence`, and inserts a `learnings` row referencing `source_experiment_id`. Example from the spec: hypothesis "lifestyle messaging will improve CTR vs. ingredient-led" → result "+18% CTR / −5% CVR" → learning signal: *"Lifestyle hooks lift traffic quality signals (CTR) but currently underperform on purchase intent for this product — pair lifestyle hooks with stronger product proof before scaling."*
2. **Automatic, from sustained attribute-lift patterns:** weekly, the Learning Agent scans the attribute→performance leaderboard (docs/04 §4.1.3); any lift that has held (same direction, similar magnitude) for 3+ consecutive weekly computations gets promoted to a `learnings` row (`component_type='attribute'`), so durable patterns like *"testimonial UGC works best for remarketing"* get captured even without a formally tracked experiment.
3. **Manual:** a human can add/edit a learning directly in the UI (`source='human'`-equivalent — the `experiments`/`source_experiment_id` link is simply null) — this is important because not every real-world insight ("the manufacturer changed the product recipe in March") will be visible in the data alone.

### How a learning is retrieved

No embeddings/RAG needed for V1 — retrieval is a structured filter, which is both cheaper and more auditable at single-brand scale:

```sql
select * from learnings
where workspace_id = $1
  and status = 'active'
  and (brand_id = $2 or brand_id is null)
  and (product_id = $3 or product_id is null)
order by
  case confidence when 'high' then 3 when 'medium' then 2 else 1 end desc,
  updated_at desc
limit 15;
```

This result set is injected into the Recommendation Agent and Hypothesis Generation Agent prompts (docs/05) as `ACTIVE_LEARNINGS`. V2/V3 can upgrade to embedding-based semantic retrieval once the learnings table is large enough (hundreds of rows across multiple brands) that a flat filter starts returning too much or too little.

### Lifecycle

`active → superseded` (when a newer learning on the same `component_key` contradicts or refines it — the old row is kept, not deleted, for audit trail) `→ archived` (manually, if no longer relevant, e.g. product discontinued). Superseding is automatic when the Learning Agent detects a same-`component_key` learning already exists: it writes the new row and flips the old one to `superseded` with a pointer, rather than ever silently overwriting history.

### Sync to Creative OS

As described in docs/03 §3.5, new/updated learnings for creatives that originated from Creative OS are mirrored (best-effort, daily batch) into `creative_os_db.learnings`, which that app's own pipeline prompts already read from — closing the loop so Creative OS's *next* research/angle stage is informed by what actually happened on Meta, not just what was hypothesized.

## 6.2 Human approval workflow

**This is a hard constraint, not a default that can be silently changed later: in V1, AdBrain never autonomously increases/decreases spend, launches, pauses, or changes bids/audiences on Meta.** The workflow is exactly:

```
AI identifies issue  →  AI proposes action (`recommendations` row, status='proposed')
        │
        ▼
Human reviews (Recommendation Inbox UI, docs/07) — sees Problem / Evidence /
Likely cause / Recommended action / Confidence, and any linked hypothesis
        │
        ├─▶ Approve  → status='approved', reviewed_by/reviewed_at/review_note set
        │              → V1: human then performs the action in Meta Ads Manager
        │                themselves (AdBrain shows a copy-ready summary of exactly
        │                what to change, but makes no API write call)
        │              → V2: an explicit second "Execute in Meta Ads" button appears
        │                ONLY for a narrow allow-list of safe, reversible actions
        │                (pause a specific ad, adjust a specific ad set's daily
        │                budget within a capped % range) — clicking it is a SEPARATE
        │                human action from "Approve", makes one scoped Marketing
        │                API write call, and is fully logged with before/after values
        │
        ├─▶ Reject   → status='rejected', review_note required (captured as a
        │              negative-signal input the Learning Agent can use — a rejected
        │              recommendation type that recurs is itself worth surfacing:
        │              "You've rejected 3 'reduce budget' recommendations for
        │              Campaign A this month — should this rule be tuned?")
        │
        └─▶ Snooze   → status stays 'proposed' but is hidden from the active inbox
                       until a re-check date; re-evaluated by the next
                       Recommendation Agent run against fresh data, not just
                       resurfaced unchanged
```

### Approval gate implementation details

- Every `recommendations` row requires an explicit terminal state before it's excluded from the "needs attention" count on the Daily Brief — nothing disappears silently.
- `hypothesis_concepts.sent_at`/`creative_os_opportunity_id` is itself a form of approval logging — sending a concept to Creative OS is a deliberate, logged human click, not automatic even when a recommendation with `recommended_action='create_new_creative'` is approved (approving the *recommendation* to make new creative is not the same click as approving *which specific concept* to brief).
- **Execution scope for V2's "Approve & Execute"** is defined narrowly and explicitly, not "give the AI ads_management and let the UI ask permission each time": the allow-list is a fixed set of Marketing API calls (pause a specific `ad_id`; set a specific `ad_set`'s `daily_budget` within ±30% of current) hard-coded server-side, so even a compromised or buggy UI cannot cause AdBrain to make a Meta API call outside that list.
- Audit trail: every approve/reject/execute is a row with `reviewed_by` (user id) and a timestamp — sufficient for "who approved this and when" in any post-mortem.

### Why this matters to the product story

The spec is explicit that autonomous execution is *never* the differentiator here — the differentiator is the depth of diagnosis and the creative hypothesis loop. The approval gate is what makes it trustworthy enough that a marketer will actually act on 3–5 recommendations a day instead of ignoring an over-eager auto-pilot.
