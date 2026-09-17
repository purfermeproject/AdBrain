# 1. Product Definition, MVP Scope & User Journey

## 1.1 Product definition

**AdBrain is an AI paid media intelligence system that understands performance, diagnoses problems, explains why they are happening, and turns those insights into the next creative tests.**

It is a decision-support layer, not a dashboard. The differentiator is the combination of:

1. **Performance intelligence** — automatic diagnosis of what changed and why, across campaigns, ad sets, ads, audiences, and funnel stages.
2. **Creative intelligence** — every creative is decomposed into structured attributes (format, hook, angle, opening frame, CTA style, etc.) and those attributes are statistically linked to outcomes.
3. **Creative generation** — insights don't stop at "replace this creative." They become concrete, testable hypotheses that flow into Creative OS as briefs.

A dashboard shows numbers. AdBrain produces sentences with evidence, a cause, a confidence level, and a recommended action — and, where the issue is creative, a ready-to-test replacement concept.

## 1.2 Who uses it

- **Primary user (MVP):** a performance/growth marketer running Meta Ads for one or more brands (starting with Purferme), who currently spends hours per week manually cross-referencing Ads Manager, spreadsheets, and gut feel.
- **Secondary user (V2+):** a creative strategist who wants a structured feed of "what to brief next" instead of guessing from a gut read on winners.
- **Tertiary (V3):** an agency/brand owner who wants a weekly narrative without opening Ads Manager at all.

## 1.3 Core differentiator (restated for the build team)

> Not "another dashboard." An AI system that understands performance, diagnoses problems, explains *why*, and turns insight into the next creative test — closing the loop **Data → Diagnosis → Recommendation → Creative Hypothesis → Execution → Learning.**

The biggest differentiator versus Ryze-style tools is depth on the **creative** side: attribute-level classification, winner/fatigue explanations, and a hypothesis engine that hands off to actual creative production (via Creative OS), not just a "this ad is fatigued" badge.

## 1.4 MVP V1 scope (build this first, nothing else)

In scope:

- Meta Ads connection (OAuth, campaign/ad set/ad/creative + insights import)
- Performance Intelligence (what changed, why, over 7/14/30-day windows + custom ranges, vs. previous period)
- Creative Intelligence (attribute classification + attribute-performance linkage)
- Winner Detection (with explanation, not just a badge)
- Creative Fatigue Detection (with cause discrimination: fatigue vs. audience saturation vs. auction cost)
- Recommendation Engine (Problem / Evidence / Likely cause / Recommended action / Confidence)
- Creative Hypothesis Engine (turns a diagnosis into 3–5 testable concepts)
- Daily Intelligence Report + Weekly Performance Narrator
- Human Approval Gate for every recommended action (no autonomous execution of any kind)
- One-click hand-off of an approved hypothesis into Creative OS as a new `opportunity`

Explicitly out of scope for V1 (see [Roadmap](08-ROADMAP.md) for when they land):

- Google Ads, GA4, Shopify, CRM connections
- Competitor intelligence
- Landing page match analysis
- Full funnel intelligence beyond Meta's own funnel events (LPV/ATC/Lead/Purchase come from Meta's reported conversion events in V1; GA4-level funnel richness is V2)
- Experiment Management UI (V1 stores hypotheses and lets you mark "tested" + outcome manually; a dedicated experiment tracker UI is V2)
- Any AI-executed action against the Meta API (V1 recommendations are marked "approved" in-app; the human still clicks the button in Ads Manager). "Approve & Execute" via the Marketing API write endpoints is V2, and still human-gated per click.

## 1.5 User journey (V1)

```
1. Connect Meta Ads (OAuth) → select ad account(s)
2. Initial backfill import (last 90 days campaign/adset/ad/creative + daily insights)
3. Land on the Daily Brief:
     "Spend +12%, revenue +6% — efficiency weakened slightly. The decline is
      concentrated in Campaign B, driven by CTR deterioration on 2 high-spend
      creatives. Landing-page conversion held steady. Recommend replacing
      those creatives before touching campaign structure."
4. Drill into Campaign B → see the diagnosis, the two creatives, their
   attribute breakdown, and the fatigue evidence (frequency, CTR, CPC trend)
5. Open the Recommendation: "Replace Creative 17 and Creative 22" with
   Problem / Evidence / Cause / Action / Confidence
6. Open the Creative Hypothesis panel for that recommendation → 5 new
   concepts generated from the account's own winning patterns
7. Pick a concept → "Send to Creative OS" → creates a pre-filled
   `opportunity` row in Creative OS, ready for the angle/hook/brief pipeline
8. Approve or reject the recommendation (approval is logged, nothing is
   auto-executed)
9. Next day: Daily Brief references yesterday's approved actions and
   whether the metric moved
10. End of week: Weekly Narrator tells the story of the week, not just the
    numbers — wins, losses, creative learnings, next week's plan
```

## 1.6 Success criteria for V1

- A marketer can go from "open the app" to "know what to fix today and why" in under 2 minutes.
- Every recommendation has evidence a marketer could defend in a meeting without re-pulling Ads Manager.
- At least 3 of the 5 generated creative concepts per hypothesis are judged "briefable as-is" by the creative strategist (i.e., don't need a rewrite to become a Creative OS brief).
- Zero autonomous writes to Meta Ads.
