import { AppShell } from "@/components/AppShell";
import { getWorkspace } from "@/lib/workspace";
import { configuredProvider } from "@/lib/ai";

// This reads live DB/env state on every request (connection status, module
// state) — it must never be statically prerendered at build time, or it
// would permanently bake in whatever env was set during `next build`.
export const dynamic = "force-dynamic";

export default async function Home() {
  const ws = await getWorkspace();
  const provider = configuredProvider();
  const connectedAccounts = ws.adConnections.filter((c: any) => c.status === "active").length;

  return (
    <AppShell active="dashboard">
      <div className="topbar">
        <div>
          <div className="eyebrow">Workspace &middot; {ws.mode.toUpperCase()}</div>
          <h1>{ws.brand.name}</h1>
          <p className="sub">
            Focus product: <b>{ws.product.name}</b>. This is the foundation build (docs/08 Phase 0) &mdash;
            data ingestion, diagnosis, and creative intelligence land in the phases that follow.
          </p>
        </div>
      </div>

      <section className="grid grid3">
        <div className="card">
          <div className="kicker">Run mode</div>
          <div className="metric">{ws.mode}</div>
          <div className="muted">{ws.mode === "live" ? "PostgreSQL connected" : "demo fallback — configure DB_* in .env.local"}</div>
        </div>
        <div className="card">
          <div className="kicker">AI provider</div>
          <div className="metric">{provider}</div>
          <div className="muted">{provider === "demo" ? "set AI_PROVIDER + an API key" : "ready for agent calls"}</div>
        </div>
        <div className="card">
          <div className="kicker">Meta ad accounts connected</div>
          <div className="metric">{connectedAccounts}</div>
          <div className="muted">wired in Phase 1 (docs/08)</div>
        </div>
      </section>

      <section className="section">
        <div className="sectionHead">
          <div>
            <h2>Build roadmap</h2>
            <div className="muted">Tracks docs/08-ROADMAP.md &mdash; status reflects what&apos;s actually implemented, not aspirational scope.</div>
          </div>
        </div>
        <div className="moduleList">
          {ws.modules.map((m) => (
            <div className="moduleRow" key={m.key}>
              <div>
                <div className="moduleTitle">{m.title}</div>
                <div className="moduleMeta">{m.description}</div>
              </div>
              <span className={`badge ${m.status}`}>{m.status.replace("_", " ").toUpperCase()}</span>
            </div>
          ))}
        </div>
      </section>

      {ws.mode === "demo" && (
        <section className="section">
          <div className="alert warn">
            No database configured yet. Copy <code>.env.example</code> to <code>.env.local</code>, point it at a local{" "}
            <code>adbrain_db</code>, run <code>postgres/schema.sql</code> then <code>postgres/seed.sql</code>, and restart{" "}
            <code>npm run dev</code>. See <code>/api/health</code> for live connection status.
          </div>
        </section>
      )}
    </AppShell>
  );
}
