# 7. Dashboard / UI Structure

Design principle: **every screen leads with a sentence, not a number.** Numbers back up the sentence; they never stand alone as the primary content. This is the visible expression of the product's core differentiator.

## 7.1 Navigation

```
Daily Brief (home) · Campaigns · Creatives · Recommendations · Hypotheses ·
Experiments · Reports · Audiences (V1-lite) · Settings
```

## 7.2 Daily Brief (home page)

- **Top:** one-paragraph AI summary (the Daily Intelligence Report), account-level headline deltas (spend, revenue, ROAS, CPA — each with a `MetricDelta` component showing direction + a one-line "why" pulled from the linked diagnosis, not just an arrow).
- **Watch today:** a short list (max 5) of the highest-severity open anomalies/diagnoses, each a click-through to its full evidence.
- **Needs your approval:** count + top 3 pending recommendations inline, "View all" to the Recommendation Inbox.
- **Data quality banner:** only shown when a `tracking_health_checks` row is `warning`/`critical` — persistent until resolved, and it visibly caps the confidence shown elsewhere ("Confidence capped at Low — tracking issue detected") so the user never acts on unreliable data without knowing it (§11 of the spec).

## 7.3 Campaigns

- List view: campaign name, status, spend, ROAS/CPA, pacing indicator, and a **diagnosis chip** (e.g. "Declining — creative fatigue" in amber, "Improving" in green, "Watch" in gray) — not a raw sparkline as the primary signal.
- Detail view: funnel visualization (Impressions→Clicks→LPV→ATC/Lead→Purchase) with the break-point highlighted per docs/04 §4.5; ad set breakdown; linked diagnoses and recommendations for this campaign; pacing chart vs. budget.

## 7.4 Creative Intelligence board

- Grid of creative cards: thumbnail, format, `WinnerBadge`/`FatigueBadge`/neutral, key metric trend sparkline, and the top 2 attribute tags.
- Filters: format, funnel stage, status (winner/fatiguing/underperforming/neutral), date window (7/14/30/custom).
- **Attribute leaderboard panel** (side panel or separate tab): the docs/04 §4.1.3 lift table, rendered per dimension — "Problem-led hooks: +34% CTR, n=12 ads, 87K impressions" — sample size always shown next to any lift claim so the user can judge reliability at a glance.
- Creative detail page: full trend charts (CTR/CPC/CPM/CPA/ROAS over time), full attribute list with confidence, the winner/fatigue narrative, and — if fatiguing — a direct "Generate replacement concepts" button that runs the Hypothesis Agent on demand.

## 7.5 Recommendation Inbox

- Card per `recommendations` row: Problem / Evidence / Likely cause / Recommended action / Confidence, laid out as labeled fields (not paragraph prose) so a marketer can scan a dozen of these fast.
- Actions: Approve / Reject (with required note) / Snooze (with re-check date).
- If `recommended_action` implies a hypothesis, an inline "View generated concepts" expands the linked `hypothesis_concepts` without navigating away.
- Filter/sort by confidence, entity, recommended_action, status.

## 7.6 Hypothesis board

- Kanban-style columns: Proposed → Sent to Creative OS → Testing → Concluded (statuses from `hypotheses.status`).
- Each hypothesis card shows its `statement` and its 3–5 concept cards (angle/hook/format/creator/visual/CTA/audience/objective, exactly the structured fields from docs/04 §4.9).
- `SendToCreativeOSButton` on each concept — confirms, then shows the resulting Creative OS opportunity link once created (cross-app hand-off, docs/03 §3.5).

## 7.7 Experiments

- Table: hypothesis, creative(s), audience, campaign, expected outcome, actual result, conclusion, status — directly mirrors the spec's experiment record shape. "Mark concluded" opens a small form (actual result + conclusion) which triggers the Learning Agent.

## 7.8 Reports

- Archive list of daily reports (one-line summary each) and weekly reports (full narrative, expandable sections matching the Weekly Narrator's output schema: wins, losses, biggest changes, creative learnings, audience learnings, funnel issues, tests completed, tests recommended, budget observations, next-week plan).

## 7.9 Settings

- **Connections:** Meta OAuth connect/reconnect, per-account sync status and last-synced time, manual "re-sync last 7 days" button.
- **Taxonomy:** view/edit the creative attribute taxonomy (docs/04 §4.1.1) per brand.
- **Workspace:** brand/product list (kept in sync conceptually with Creative OS's own brand/product records — same ids).

## 7.10 Visual/interaction conventions

- Confidence is always shown as a small labeled badge (Low/Medium/High), never a bare percentage, to keep it interpretable at a glance.
- Every AI-written sentence that cites a number is expandable to "show evidence" — the raw `evidence`/`scorecard` JSON rendered as a small table, so nothing is a black box.
- Color is reserved for status (winner/fatigue/anomaly severity) — not decoration — following the same "evidence over chrome" principle as the rest of the product.
