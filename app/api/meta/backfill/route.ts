import { NextRequest, NextResponse } from "next/server";
import { runBackfill } from "@/lib/meta/sync";

// Manual/initial 90-day backfill for one ad connection (docs/08 Phase 1
// item 9). POST { adConnectionId, days? } — not a cron target; triggered
// once when a connection is first created (Settings > Connections).
export async function POST(request: NextRequest) {
  let body: { adConnectionId?: string; days?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with adConnectionId." }, { status: 400 });
  }

  if (!body.adConnectionId) {
    return NextResponse.json({ error: "adConnectionId is required." }, { status: 400 });
  }

  try {
    const result = await runBackfill(body.adConnectionId, {
      days: body.days,
      brandId: process.env.DEMO_BRAND_ID || "PF",
      productId: process.env.DEMO_PRODUCT_ID || "PF-COOKIE-BRK",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
