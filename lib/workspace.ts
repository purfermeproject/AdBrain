import { brand, product, initialModules } from "./demo-data";
import { hasDatabase, query } from "./db";
import { getWorkspaceId } from "./workspace-id";

export async function getWorkspace(
  brandId = process.env.DEMO_BRAND_ID || "PF",
  productId = process.env.DEMO_PRODUCT_ID || "PF-COOKIE-BRK",
  workspaceId = getWorkspaceId()
) {
  if (!hasDatabase()) {
    return {
      mode: "demo" as const,
      brand,
      product,
      modules: initialModules,
      adConnections: [],
    };
  }

  const [bRes, pRes, connRes] = await Promise.all([
    query("select * from brands where workspace_id=$1 and id=$2 limit 1", [workspaceId, brandId]),
    query("select * from products where workspace_id=$1 and id=$2 limit 1", [workspaceId, productId]),
    query(
      "select id, platform, external_account_id, display_name, status, last_synced_at from ad_connections where workspace_id=$1 order by created_at desc",
      [workspaceId]
    ),
  ]);

  return {
    mode: "live" as const,
    brand: bRes.rows[0] || brand,
    product: pRes.rows[0] || product,
    modules: initialModules,
    adConnections: connRes.rows,
  };
}
