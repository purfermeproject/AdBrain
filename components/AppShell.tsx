// Navigation matches docs/07-UI-STRUCTURE.md §7.1. Routes land in later
// roadmap phases (docs/08) — until then they're listed but not linked, so
// the nav is honest about what's actually built.
const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/", live: true },
  { key: "brief", label: "Daily Brief", href: "/brief", live: false },
  { key: "campaigns", label: "Campaigns", href: "/campaigns", live: false },
  { key: "creatives", label: "Creatives", href: "/creatives", live: false },
  { key: "recommendations", label: "Recommendations", href: "/recommendations", live: false },
  { key: "hypotheses", label: "Hypotheses", href: "/hypotheses", live: false },
  { key: "experiments", label: "Experiments", href: "/experiments", live: false },
  { key: "reports", label: "Reports", href: "/reports", live: false },
  { key: "settings", label: "Settings", href: "/settings", live: false },
];

export function AppShell({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brandmark">AdBrain</div>
        <div className="brandsub">Paid Media Intelligence</div>
        <nav className="nav">
          {NAV_ITEMS.map((item) =>
            item.live ? (
              <a key={item.key} href={item.href} className={item.key === active ? "active" : ""}>
                {item.label}
              </a>
            ) : (
              <span key={item.key} style={{ padding: "10px 12px", color: "#8d7f91", display: "flex", justifyContent: "space-between", gap: 8 }}>
                {item.label} <span className="soon">Soon</span>
              </span>
            )
          )}
        </nav>
        <div className="sidebarFoot">{"Data → Diagnosis → Recommendation → Creative Hypothesis → Execution → Learning"}</div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
