import { NextResponse } from "next/server";
import { hasDatabase, query } from "@/lib/db";
import { runIncrementalSync } from "@/lib/meta/sync";

// Cron target (hourly): incrementally re-syncs every active Meta connection
// in the workspace (docs/08 Phase 1 item 9). Always re-pulls the last 3
// days per connection to capture late-attributed conversions.
export async function POST() {
  if (!hasDatabase()) {
    return NextResponse.json({ ok: false, error: "Database is not configured." }, { status: 503 });
  }

  const connections = await query<{ id: string; external_account_id: string }>(
    "select id, external_account_id from ad_connections where platform='meta' and status='active'"
  );

  const results: Array<{ adConnectionId: string; ok: boolean; error?: string; written?: number; skipped?: number }> = [];

  for (const row of connections.rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await runIncrementalSync(row.id, {
        brandId: process.env.DEMO_BRAND_ID || "PF",
        productId: process.env.DEMO_PRODUCT_ID || "PF-COOKIE-BRK",
      });
      results.push({ adConnectionId: row.id, ok: true, written: result.performance.written, skipped: result.performance.skipped });
    } catch (error) {
      results.push({ adConnectionId: row.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return NextResponse.json({ ok: true, connections: results.length, results });
}
