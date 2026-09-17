import { AppShell } from "@/components/AppShell";
import { BackfillButton } from "@/components/BackfillButton";
import { getWorkspace } from "@/lib/workspace";

// Settings > Connections (docs/07-UI-STRUCTURE.md §7.9): connect/reconnect
// Meta OAuth, see per-account sync status, trigger a manual backfill.
export const dynamic = "force-dynamic";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const { connected } = await searchParams;
  const ws = await getWorkspace();

  return (
    <AppShell active="settings">
      <div className="topbar">
        <div>
          <div className="eyebrow">Settings</div>
          <h1>Connections</h1>
          <p className="sub">Connect a Meta Ads account (read-only, `ads_read` scope) to start importing campaign, ad, creative and performance data.</p>
        </div>
        <a className="btn btnPrimary" href="/api/meta/oauth/start">
          Connect Meta Ads
        </a>
      </div>

      {connected === "1" && (
        <section className="section">
          <div className="alert ok">Meta account connected. Run a backfill below to import the last 90 days of data.</div>
        </section>
      )}

      <section className="section">
        <div className="sectionHead">
          <div>
            <h2>Connected accounts</h2>
            <div className="muted">{ws.mode === "demo" ? "Demo mode — connect a database to see real connections." : `${ws.adConnections.length} connection(s)`}</div>
          </div>
        </div>

        {ws.adConnections.length === 0 ? (
          <div className="card">
            <div className="muted">No ad accounts connected yet. Click &ldquo;Connect Meta Ads&rdquo; above to start the OAuth flow.</div>
          </div>
        ) : (
          <div className="moduleList">
            {ws.adConnections.map((c: any) => (
              <div className="connectionRow" key={c.id}>
                <div>
                  <div className="moduleTitle">{c.display_name || c.external_account_id}</div>
                  <div className="connectionMeta">
                    {c.platform} &middot; act_{c.external_account_id} &middot; last synced: {c.last_synced_at ? new Date(c.last_synced_at).toLocaleString() : "never"}
                  </div>
                </div>
                <span className={`badge ${c.status === "active" ? "live" : "blocked"}`}>{String(c.status).toUpperCase()}</span>
                <BackfillButton adConnectionId={c.id} />
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
