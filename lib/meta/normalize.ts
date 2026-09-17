import type { MetaAd, MetaAdCreativeRaw, MetaAdSet, MetaCampaign, MetaInsightRow } from "./client";

// Raw Meta API JSON → the normalized shapes that lib/meta/sync.ts upserts
// into campaigns/ad_sets/ad_creatives/ads/performance_daily. See
// docs/03-DATA-MODEL.md §3.4 (Data normalization strategy) for the rules
// this implements: derived ratios computed at write time, known action
// types mapped to named columns, everything else preserved in `raw`.

function toNumber(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCampaign(raw: MetaCampaign) {
  return {
    external_id: raw.id,
    name: raw.name,
    objective: raw.objective ?? null,
    status: raw.status ?? null,
    daily_budget: toNullableNumber(raw.daily_budget),
    lifetime_budget: toNullableNumber(raw.lifetime_budget),
    buying_type: raw.buying_type ?? null,
    raw,
  };
}

// Heuristic funnel-stage classification from Meta's targeting spec
// (docs/03 §3.2 ad_sets.funnel_stage). Refined in later phases once real
// account data shows which custom-audience naming conventions this brand
// actually uses — this is deliberately conservative (defaults to
// "prospecting" or "unknown" rather than guessing wrong).
function inferFunnelStage(targeting: Record<string, unknown> | undefined): "prospecting" | "retargeting" | "remarketing" | "unknown" {
  if (!targeting) return "unknown";
  const customAudiences = (targeting.custom_audiences as Array<{ name?: string }> | undefined) || [];
  const excludedCustomAudiences = (targeting.excluded_custom_audiences as Array<{ name?: string }> | undefined) || [];

  if (customAudiences.length > 0) {
    const nameBlob = customAudiences.map((a) => (a.name || "").toLowerCase()).join(" ");
    if (/retarget/.test(nameBlob)) return "retargeting";
    if (/remarket|cart|checkout|website/.test(nameBlob)) return "remarketing";
    return "retargeting";
  }
  if (excludedCustomAudiences.length > 0) {
    // Prospecting sets commonly exclude existing customers/engagers.
    return "prospecting";
  }
  return "unknown";
}

export function normalizeAdSet(raw: MetaAdSet) {
  const targeting = (raw.targeting as Record<string, unknown>) || {};
  return {
    external_id: raw.id,
    name: raw.name,
    status: raw.status ?? null,
    targeting,
    optimization_goal: raw.optimization_goal ?? null,
    daily_budget: toNullableNumber(raw.daily_budget),
    bid_strategy: raw.bid_strategy ?? null,
    funnel_stage: inferFunnelStage(targeting),
    campaign_external_id: raw.campaign_id,
    raw,
  };
}

export function normalizeAdCreative(creative: MetaAdCreativeRaw | undefined, adExternalId: string) {
  if (!creative) {
    return {
      external_id: `ad-${adExternalId}`, // fallback so every ad still has a creative row
      format: null,
      primary_asset_url: null,
      headline: null,
      primary_text: null,
      cta_type: null,
      destination_url: null,
      raw: {},
    };
  }

  const storySpec = creative.object_story_spec || {};
  const linkData = storySpec.link_data || {};
  const videoData = storySpec.video_data || {};

  let format: "static" | "video" | "carousel" | "collection" | "dpa" | null = null;
  if (creative.asset_feed_spec) format = "dpa";
  else if (Array.isArray(linkData.child_attachments) && linkData.child_attachments.length > 0) format = "carousel";
  else if (videoData.video_id || creative.video_id) format = "video";
  else if (linkData.link || creative.image_url) format = "static";

  const primaryAssetUrl = creative.thumbnail_url || creative.image_url || linkData.picture || null;
  const headline = linkData.name || videoData.title || null;
  const primaryText = linkData.message || videoData.message || null;
  const ctaType = linkData.call_to_action?.type || videoData.call_to_action?.type || creative.call_to_action_type || null;
  const destinationUrl = linkData.link || videoData.call_to_action?.value?.link || null;

  return {
    external_id: creative.id || `ad-${adExternalId}`,
    format,
    primary_asset_url: primaryAssetUrl,
    headline,
    primary_text: primaryText,
    cta_type: ctaType,
    destination_url: destinationUrl,
    raw: creative,
  };
}

export function normalizeAd(raw: MetaAd) {
  return {
    external_id: raw.id,
    name: raw.name,
    status: raw.status ?? null,
    ad_set_external_id: raw.adset_id,
    raw,
  };
}

// Meta returns conversions as an `actions`/`action_values` array of
// {action_type, value} rather than named fields — this sums the value for
// any of the given action types (multiple types cover cross-device /
// omni-channel variants of the same event, e.g. purchase + omni_purchase).
function sumActionValue(rows: { action_type: string; value: string }[] | undefined, types: string[]): number {
  if (!rows) return 0;
  return rows.filter((r) => types.includes(r.action_type)).reduce((sum, r) => sum + toNumber(r.value), 0);
}

export function normalizeInsightsRow(raw: MetaInsightRow) {
  const spend = toNumber(raw.spend);
  const impressions = toNumber(raw.impressions);
  const reach = toNumber(raw.reach);
  const frequency = toNullableNumber(raw.frequency);
  const clicks = toNumber(raw.clicks);
  const linkClicks = sumActionValue(raw.actions, ["link_click"]);

  const landingPageViews = sumActionValue(raw.actions, ["landing_page_view"]);
  const addToCart = sumActionValue(raw.actions, ["add_to_cart", "omni_add_to_cart"]);
  const leads = sumActionValue(raw.actions, ["lead"]);
  const purchases = sumActionValue(raw.actions, ["purchase", "omni_purchase"]);
  const revenue = sumActionValue(raw.action_values, ["purchase", "omni_purchase"]);

  const ctr = raw.ctr !== undefined ? toNullableNumber(raw.ctr) : impressions > 0 ? (clicks / impressions) * 100 : null;
  const cpc = raw.cpc !== undefined ? toNullableNumber(raw.cpc) : clicks > 0 ? spend / clicks : null;
  const cpm = raw.cpm !== undefined ? toNullableNumber(raw.cpm) : impressions > 0 ? (spend / impressions) * 1000 : null;
  const cpa = purchases > 0 ? spend / purchases : null;
  const cpl = leads > 0 ? spend / leads : null;
  const roas = spend > 0 ? revenue / spend : null;
  const conversionRate = linkClicks > 0 ? (purchases / linkClicks) * 100 : null;

  return {
    date: raw.date_start,
    spend,
    impressions,
    reach,
    frequency,
    clicks,
    link_clicks: linkClicks,
    ctr,
    cpc,
    cpm,
    landing_page_views: landingPageViews,
    add_to_cart: addToCart,
    leads,
    purchases,
    revenue,
    cpa,
    cpl,
    roas,
    conversion_rate: conversionRate,
    ad_external_id: raw.ad_id,
    ad_set_external_id: raw.adset_id,
    campaign_external_id: raw.campaign_id,
    raw,
  };
}
