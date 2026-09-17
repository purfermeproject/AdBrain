// Matches Creative OS's demo brand/product exactly (lib/demo-data.ts in
// creatives_system) so both apps show the same account when no database is
// configured yet.
export const brand = {
  id: "PF",
  name: "Pur’ Ferme Project",
  category: "Functional foods",
};

export const product = {
  id: "PF-COOKIE-BRK",
  name: "Millet & Oats Breakfast Cookies",
  sku: "Cookies_Breakfast",
};

export type ModuleStatus = "not_started" | "in_progress" | "live";

export type ModuleSummary = {
  key: string;
  title: string;
  description: string;
  status: ModuleStatus;
};

// Mirrors the phase order in docs/08-ROADMAP.md so the home screen always
// reflects what's actually built, not what's aspirational.
export const initialModules: ModuleSummary[] = [
  { key: "connections", title: "Meta Ads Connection", description: "OAuth + campaign/ad/creative + insights import", status: "not_started" },
  { key: "performance", title: "Performance Intelligence", description: "Anomaly detection, cause discrimination, diagnoses", status: "not_started" },
  { key: "creative", title: "Creative Intelligence", description: "Classification, winner/fatigue detection", status: "not_started" },
  { key: "recommendations", title: "Recommendation Engine", description: "Problem / Evidence / Cause / Action / Confidence", status: "not_started" },
  { key: "hypotheses", title: "Creative Hypothesis Engine", description: "New concepts + hand-off to Creative OS", status: "not_started" },
  { key: "reporting", title: "Daily / Weekly Reporting", description: "Intelligence report + performance narrator", status: "not_started" },
];
