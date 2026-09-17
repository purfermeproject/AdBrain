import { query, withTransaction } from "@/lib/db";
import { decryptToken } from "@/lib/crypto";
import {
  fetchAdSets,
  fetchAdsWithCreatives,
  fetchCampaigns,
  fetchInsightsAsync,
  fetchInsightsSync,
} from "./client";
import { normalizeAd, normalizeAdCreative, normalizeAdSet, normalizeCampaign, normalizeInsightsRow } from "./normalize";

// Orchestrates a full Meta sync: fetch → normalize → upsert, in dependency
// order (campaigns → ad sets → ad creatives → ads → performance_daily),
// matching docs/03-DATA-MODEL.md §3.4. Every upsert is keyed on the natural
// (ad_connection_id/workspace_id, external_id) key, so re-running a sync is
// always safe (docs/08 Phase 1 item 9: "verify idempotency").

type AdConnectionRow = {
  id: string;
  workspace_id: string;
  external_account_id: string;
  access_token_encrypted: string;
  status: string;
};

async function getConnection(adConnectionId: string): Promise<AdConnectionRow> {
  const res = await query<AdConnectionRow>(
    "select id, workspace_id, external_account_id, access_token_encrypted, status from ad_connections where id=$1",
    [adConnectionId]
  );
  const row = res.rows[0];
  if (!row) throw new Error(`ad_connections row ${adConnectionId} not found.`);
  if (row.status !== "active") throw new Error(`ad_connections row ${adConnectionId} is not active (status=${row.status}).`);
  return row;
}

// ---------------- upserts ----------------

export async function upsertCampaign(client: any, workspaceId: string, adConnectionId: string, brandId: string | null, normalized: ReturnType<typeof normalizeCampaign>) {
  const res = await client.query(
    `insert into campaigns (workspace_id, ad_connection_id, brand_id, external_id, name, objective, status, daily_budget, lifetime_budget, buying_type, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (ad_connection_id, external_id) do update set
       name=excluded.name, objective=excluded.objective, status=excluded.status,
       daily_budget=excluded.daily_budget, lifetime_budget=excluded.lifetime_budget,
       buying_type=excluded.buying_type, raw=excluded.raw
     returning id`,
    [
      workspaceId,
      adConnectionId,
      brandId,
      normalized.external_id,
      normalized.name,
      normalized.objective,
      normalized.status,
      normalized.daily_budget,
      normalized.lifetime_budget,
      normalized.buying_type,
      normalized.raw,
    ]
  );
  return res.rows[0].id as string;
}

export async function upsertAdSet(client: any, workspaceId: string, campaignId: string, normalized: ReturnType<typeof normalizeAdSet>) {
  const res = await client.query(
    `insert into ad_sets (workspace_id, campaign_id, external_id, name, status, targeting, optimization_goal, daily_budget, bid_strategy, funnel_stage, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (campaign_id, external_id) do update set
       name=excluded.name, status=excluded.status, targeting=excluded.targeting,
       optimization_goal=excluded.optimization_goal, daily_budget=excluded.daily_budget,
       bid_strategy=excluded.bid_strategy, funnel_stage=excluded.funnel_stage, raw=excluded.raw
     returning id`,
    [
      workspaceId,
      campaignId,
      normalized.external_id,
      normalized.name,
      normalized.status,
      normalized.targeting,
      normalized.optimization_goal,
      normalized.daily_budget,
      normalized.bid_strategy,
      normalized.funnel_stage,
      normalized.raw,
    ]
  );
  return res.rows[0].id as string;
}

export async function upsertAdCreative(
  client: any,
  workspaceId: string,
  brandId: string | null,
  productId: string | null,
  normalized: ReturnType<typeof normalizeAdCreative>
) {
  const res = await client.query(
    `insert into ad_creatives (workspace_id, brand_id, product_id, external_id, format, primary_asset_url, headline, primary_text, cta_type, destination_url, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (workspace_id, external_id) do update set
       format=excluded.format, primary_asset_url=excluded.primary_asset_url, headline=excluded.headline,
       primary_text=excluded.primary_text, cta_type=excluded.cta_type, destination_url=excluded.destination_url,
       raw=excluded.raw
     returning id`,
    [
      workspaceId,
      brandId,
      productId,
      normalized.external_id,
      normalized.format,
      normalized.primary_asset_url,
      normalized.headline,
      normalized.primary_text,
      normalized.cta_type,
      normalized.destination_url,
      normalized.raw,
    ]
  );
  return res.rows[0].id as string;
}

export async function upsertAd(client: any, workspaceId: string, adSetId: string, adCreativeId: string | null, normalized: ReturnType<typeof normalizeAd>) {
  const res = await client.query(
    `insert into ads (workspace_id, ad_set_id, external_id, name, status, ad_creative_id, raw)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (ad_set_id, external_id) do update set
       name=excluded.name, status=excluded.status, ad_creative_id=excluded.ad_creative_id, raw=excluded.raw
     returning id`,
    [workspaceId, adSetId, normalized.external_id, normalized.name, normalized.status, adCreativeId, normalized.raw]
  );
  return res.rows[0].id as string;
}

export async function upsertPerformanceDaily(
  client: any,
  workspaceId: string,
  ids: { adId: string; adSetId: string; campaignId: string; adCreativeId: string | null },
  normalized: ReturnType<typeof normalizeInsightsRow>
) {
  await client.query(
    `insert into performance_daily (
       workspace_id, ad_id, ad_set_id, campaign_id, ad_creative_id, date,
       spend, impressions, reach, frequency, clicks, link_clicks, ctr, cpc, cpm,
       landing_page_views, add_to_cart, leads, purchases, revenue, cpa, cpl, roas, conversion_rate, raw
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     on conflict (ad_id, date) do update set
       ad_set_id=excluded.ad_set_id, campaign_id=excluded.campaign_id, ad_creative_id=excluded.ad_creative_id,
       spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach, frequency=excluded.frequency,
       clicks=excluded.clicks, link_clicks=excluded.link_clicks, ctr=excluded.ctr, cpc=excluded.cpc, cpm=excluded.cpm,
       landing_page_views=excluded.landing_page_views, add_to_cart=excluded.add_to_cart, leads=excluded.leads,
       purchases=excluded.purchases, revenue=excluded.revenue, cpa=excluded.cpa, cpl=excluded.cpl, roas=excluded.roas,
       conversion_rate=excluded.conversion_rate, raw=excluded.raw`,
    [
      workspaceId,
      ids.adId,
      ids.adSetId,
      ids.campaignId,
      ids.adCreativeId,
      normalized.date,
      normalized.spend,
      normalized.impressions,
      normalized.reach,
      normalized.frequency,
      normalized.clicks,
      normalized.link_clicks,
      normalized.ctr,
      normalized.cpc,
      normalized.cpm,
      normalized.landing_page_views,
      normalized.add_to_cart,
      normalized.leads,
      normalized.purchases,
      normalized.revenue,
      normalized.cpa,
      normalized.cpl,
      normalized.roas,
      normalized.conversion_rate,
      normalized.raw,
    ]
  );
}

// ---------------- hierarchy sync (campaigns/ad sets/ads/creatives) ----------------

async function syncHierarchy(connection: AdConnectionRow, brandId: string | null, productId: string | null) {
  const accessToken = decryptToken(connection.access_token_encrypted);
  const [rawCampaigns, rawAdSets, rawAds] = await Promise.all([
    fetchCampaigns(connection.external_account_id, accessToken),
    fetchAdSets(connection.external_account_id, accessToken),
    fetchAdsWithCreatives(connection.external_account_id, accessToken),
  ]);

  const campaignIdByExternal = new Map<string, string>();
  const adSetIdByExternal = new Map<string, string>();

  await withTransaction(async (client) => {
    for (const raw of rawCampaigns) {
      const id = await upsertCampaign(client, connection.workspace_id, connection.id, brandId, normalizeCampaign(raw));
      campaignIdByExternal.set(raw.id, id);
    }

    for (const raw of rawAdSets) {
      const campaignId = raw.campaign_id ? campaignIdByExternal.get(raw.campaign_id) : undefined;
      if (!campaignId) continue; // ad set belongs to a campaign outside this account's fetched set — skip rather than fail the whole sync
      const id = await upsertAdSet(client, connection.workspace_id, campaignId, normalizeAdSet(raw));
      adSetIdByExternal.set(raw.id, id);
    }

    for (const raw of rawAds) {
      const adSetId = raw.adset_id ? adSetIdByExternal.get(raw.adset_id) : undefined;
      if (!adSetId) continue;
      const normalizedCreative = normalizeAdCreative(raw.creative, raw.id);
      const creativeId = await upsertAdCreative(client, connection.workspace_id, brandId, productId, normalizedCreative);
      await upsertAd(client, connection.workspace_id, adSetId, creativeId, normalizeAd(raw));
    }
  });

  return { campaigns: rawCampaigns.length, adSets: rawAdSets.length, ads: rawAds.length };
}

// ---------------- performance sync ----------------

async function syncPerformance(connection: AdConnectionRow, rows: ReturnType<typeof normalizeInsightsRow>[]) {
  // Resolve external ids -> internal uuids up front (one query each,
  // instead of N+1 per row) since insight rows can number in the thousands
  // for a 90-day backfill.
  const [campaignRes, adSetRes, adRes] = await Promise.all([
    query<{ id: string; external_id: string }>("select id, external_id from campaigns where ad_connection_id=$1", [connection.id]),
    query<{ id: string; external_id: string; campaign_id: string }>(
      "select ad_sets.id, ad_sets.external_id, ad_sets.campaign_id from ad_sets join campaigns on campaigns.id = ad_sets.campaign_id where campaigns.ad_connection_id=$1",
      [connection.id]
    ),
    query<{ id: string; external_id: string; ad_set_id: string; ad_creative_id: string | null }>(
      "select ads.id, ads.external_id, ads.ad_set_id, ads.ad_creative_id from ads join ad_sets on ad_sets.id = ads.ad_set_id join campaigns on campaigns.id = ad_sets.campaign_id where campaigns.ad_connection_id=$1",
      [connection.id]
    ),
  ]);

  const campaignByExternal = new Map(campaignRes.rows.map((r) => [r.external_id, r.id]));
  const adSetByExternal = new Map(adSetRes.rows.map((r) => [r.external_id, r]));
  const adByExternal = new Map(adRes.rows.map((r) => [r.external_id, r]));

  let written = 0;
  let skipped = 0;

  // Chunked transactions so a single failure doesn't roll back an entire
  // 90-day backfill, and so we're never holding one enormous transaction open.
  const CHUNK_SIZE = 500;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    // eslint-disable-next-line no-await-in-loop
    await withTransaction(async (client) => {
      for (const row of chunk) {
        const ad = row.ad_external_id ? adByExternal.get(row.ad_external_id) : undefined;
        const campaignId = row.campaign_external_id ? campaignByExternal.get(row.campaign_external_id) : undefined;
        if (!ad || !campaignId) {
          skipped += 1;
          continue;
        }
        await upsertPerformanceDaily(
          client,
          connection.workspace_id,
          { adId: ad.id, adSetId: ad.ad_set_id, campaignId, adCreativeId: ad.ad_creative_id },
          row
        );
        written += 1;
      }
    });
  }

  return { written, skipped };
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function runBackfill(adConnectionId: string, opts?: { days?: number; brandId?: string | null; productId?: string | null }) {
  const connection = await getConnection(adConnectionId);
  const hierarchy = await syncHierarchy(connection, opts?.brandId ?? null, opts?.productId ?? null);

  const days = opts?.days ?? 90;
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const accessToken = decryptToken(connection.access_token_encrypted);
  const rawInsights = await fetchInsightsAsync(connection.external_account_id, accessToken, {
    since: isoDate(since),
    until: isoDate(until),
  });
  const performance = await syncPerformance(connection, rawInsights.map(normalizeInsightsRow));

  await query("update ad_connections set last_synced_at = now() where id=$1", [adConnectionId]);
  return { hierarchy, performance };
}

// Incremental sync always re-pulls the last 3 days (not just "yesterday")
// to capture late-attributed conversions, per docs/03-DATA-MODEL.md §3.3.
export async function runIncrementalSync(adConnectionId: string, opts?: { brandId?: string | null; productId?: string | null }) {
  const connection = await getConnection(adConnectionId);
  const hierarchy = await syncHierarchy(connection, opts?.brandId ?? null, opts?.productId ?? null);

  const until = new Date();
  const since = new Date(until.getTime() - 3 * 24 * 60 * 60 * 1000);
  const accessToken = decryptToken(connection.access_token_encrypted);
  const rawInsights = await fetchInsightsSync(connection.external_account_id, accessToken, {
    since: isoDate(since),
    until: isoDate(until),
  });
  const performance = await syncPerformance(connection, rawInsights.map(normalizeInsightsRow));

  await query("update ad_connections set last_synced_at = now() where id=$1", [adConnectionId]);
  return { hierarchy, performance };
}
