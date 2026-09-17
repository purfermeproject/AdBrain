// Meta Marketing API (Graph API) client. See docs/03-DATA-MODEL.md §3.3 for
// the integration architecture this implements: OAuth (ads_read scope for
// V1), batched/paginated entity fetches, and the async Insights API for
// backfill.

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MetaApiError extends Error {
  code?: number;
  type?: string;
  fbtraceId?: string;
  constructor(message: string, opts?: { code?: number; type?: string; fbtraceId?: string }) {
    super(message);
    this.name = "MetaApiError";
    this.code = opts?.code;
    this.type = opts?.type;
    this.fbtraceId = opts?.fbtraceId;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

// ---------------- OAuth ----------------

export function getAuthorizeUrl(state: string): string {
  const appId = requireEnv("META_APP_ID");
  const redirectUri = requireEnv("META_REDIRECT_URI");
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: "ads_read",
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

async function graphFetch(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url.toString());
  const body = await response.json();

  if (!response.ok || body.error) {
    throw new MetaApiError(body?.error?.message || `Meta API request failed (${response.status})`, {
      code: body?.error?.code,
      type: body?.error?.type,
      fbtraceId: body?.error?.fbtrace_id,
    });
  }
  return body;
}

export async function exchangeCodeForToken(code: string): Promise<{ accessToken: string; expiresIn?: number }> {
  const body = await graphFetch("/oauth/access_token", {
    client_id: requireEnv("META_APP_ID"),
    client_secret: requireEnv("META_APP_SECRET"),
    redirect_uri: requireEnv("META_REDIRECT_URI"),
    code,
  });
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

// Short-lived tokens (~1-2h) are exchanged for a long-lived token (~60 days)
// immediately after the OAuth callback, per Meta's standard flow.
export async function getLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresIn?: number }> {
  const body = await graphFetch("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: requireEnv("META_APP_ID"),
    client_secret: requireEnv("META_APP_SECRET"),
    fb_exchange_token: shortLivedToken,
  });
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

// After OAuth, list the ad accounts this user token can access so the
// caller can create one ad_connections row per account (docs/07-UI-STRUCTURE.md
// §7.9 Settings > Connections shows one row per connected account).
export async function fetchAdAccounts(accessToken: string): Promise<Array<{ accountId: string; name: string }>> {
  const url = `${GRAPH_BASE}/me/adaccounts?fields=account_id,name&limit=100`;
  const rows = await paginate<{ account_id: string; name: string }>(url, accessToken);
  return rows.map((r) => ({ accountId: r.account_id, name: r.name }));
}

// ---------------- Entity fetchers ----------------

export type MetaCampaign = {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  buying_type?: string;
  [key: string]: unknown;
};

export type MetaAdSet = {
  id: string;
  name: string;
  status?: string;
  targeting?: Record<string, unknown>;
  optimization_goal?: string;
  daily_budget?: string;
  bid_strategy?: string;
  campaign_id?: string;
  [key: string]: unknown;
};

export type MetaAdCreativeRaw = {
  id?: string;
  object_story_spec?: Record<string, any>;
  asset_feed_spec?: Record<string, any>;
  effective_object_story_id?: string;
  thumbnail_url?: string;
  video_id?: string;
  image_url?: string;
  call_to_action_type?: string;
  [key: string]: unknown;
};

export type MetaAd = {
  id: string;
  name: string;
  status?: string;
  adset_id?: string;
  creative?: MetaAdCreativeRaw;
  [key: string]: unknown;
};

export type MetaInsightAction = { action_type: string; value: string };

export type MetaInsightRow = {
  date_start: string;
  date_stop: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: MetaInsightAction[];
  action_values?: MetaInsightAction[];
  [key: string]: unknown;
};

async function paginate<T>(firstUrl: string, accessToken: string): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = firstUrl;
  let guard = 0;
  while (url && guard < 200) {
    const requestUrl: string = url.includes("access_token=") ? url : `${url}${url.includes("?") ? "&" : "?"}access_token=${accessToken}`;
    // eslint-disable-next-line no-await-in-loop
    const response: Response = await fetch(requestUrl);
    // eslint-disable-next-line no-await-in-loop
    const body: any = await response.json();
    if (!response.ok || body.error) {
      throw new MetaApiError(body?.error?.message || `Meta API request failed (${response.status})`, {
        code: body?.error?.code,
        type: body?.error?.type,
        fbtraceId: body?.error?.fbtrace_id,
      });
    }
    results.push(...(body.data || []));
    url = body.paging?.next || null;
    guard += 1;
  }
  return results;
}

export async function fetchCampaigns(accountId: string, accessToken: string): Promise<MetaCampaign[]> {
  const url = `${GRAPH_BASE}/act_${accountId}/campaigns?fields=id,name,objective,status,daily_budget,lifetime_budget,buying_type&limit=100`;
  return paginate<MetaCampaign>(url, accessToken);
}

export async function fetchAdSets(accountId: string, accessToken: string): Promise<MetaAdSet[]> {
  const url = `${GRAPH_BASE}/act_${accountId}/adsets?fields=id,name,status,targeting,optimization_goal,daily_budget,bid_strategy,campaign_id&limit=100`;
  return paginate<MetaAdSet>(url, accessToken);
}

export async function fetchAdsWithCreatives(accountId: string, accessToken: string): Promise<MetaAd[]> {
  const creativeFields =
    "id,object_story_spec,asset_feed_spec,effective_object_story_id,thumbnail_url,video_id,image_url,call_to_action_type";
  const url = `${GRAPH_BASE}/act_${accountId}/ads?fields=id,name,status,adset_id,creative{${creativeFields}}&limit=100`;
  return paginate<MetaAd>(url, accessToken);
}

const INSIGHT_FIELDS = [
  "ad_id",
  "adset_id",
  "campaign_id",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
].join(",");

// Small date ranges (incremental sync) — synchronous insights call.
export async function fetchInsightsSync(
  accountId: string,
  accessToken: string,
  opts: { since: string; until: string }
): Promise<MetaInsightRow[]> {
  const url = `${GRAPH_BASE}/act_${accountId}/insights?fields=${INSIGHT_FIELDS}&level=ad&time_increment=1&time_range=${encodeURIComponent(
    JSON.stringify({ since: opts.since, until: opts.until })
  )}&limit=500`;
  return paginate<MetaInsightRow>(url, accessToken);
}

// Large date ranges (90-day backfill) — Meta recommends the async report
// endpoint to avoid request timeouts. Creates a report run, polls until
// complete, then downloads the results.
export async function fetchInsightsAsync(
  accountId: string,
  accessToken: string,
  opts: { since: string; until: string; pollIntervalMs?: number; timeoutMs?: number }
): Promise<MetaInsightRow[]> {
  const createUrl = new URL(`${GRAPH_BASE}/act_${accountId}/insights`);
  createUrl.searchParams.set("access_token", accessToken);
  createUrl.searchParams.set("fields", INSIGHT_FIELDS);
  createUrl.searchParams.set("level", "ad");
  createUrl.searchParams.set("time_increment", "1");
  createUrl.searchParams.set("time_range", JSON.stringify({ since: opts.since, until: opts.until }));

  const createRes = await fetch(createUrl.toString(), { method: "POST" });
  const createBody = await createRes.json();
  if (!createRes.ok || createBody.error) {
    throw new MetaApiError(createBody?.error?.message || "Failed to start async insights report", {
      code: createBody?.error?.code,
    });
  }
  const reportRunId = createBody.report_run_id;

  const pollIntervalMs = opts.pollIntervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 120000;
  const deadline = Date.now() + timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const statusRes = await fetch(`${GRAPH_BASE}/${reportRunId}?access_token=${accessToken}`);
    // eslint-disable-next-line no-await-in-loop
    const statusBody = await statusRes.json();
    if (statusBody.async_status === "Job Completed") break;
    if (statusBody.async_status === "Job Failed" || statusBody.async_status === "Job Skipped") {
      throw new MetaApiError(`Async insights report ${statusBody.async_status}`);
    }
    if (Date.now() > deadline) {
      throw new MetaApiError("Timed out waiting for async insights report to complete.");
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return paginate<MetaInsightRow>(`${GRAPH_BASE}/${reportRunId}/insights?limit=500`, accessToken);
}
