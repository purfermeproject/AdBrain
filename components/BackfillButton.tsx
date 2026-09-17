"use client";

import { useState } from "react";

export function BackfillButton({ adConnectionId }: { adConnectionId: string }) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function run() {
    setStatus("running");
    setMessage("");
    try {
      const res = await fetch("/api/meta/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adConnectionId }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setStatus("error");
        setMessage(body.error || `Request failed (${res.status})`);
        return;
      }
      setStatus("done");
      setMessage(
        `${body.hierarchy.campaigns} campaigns, ${body.hierarchy.adSets} ad sets, ${body.hierarchy.ads} ads. ${body.performance.written} performance rows written (${body.performance.skipped} skipped).`
      );
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <button className="btn btnGhost" onClick={run} disabled={status === "running"}>
        {status === "running" ? "Backfilling…" : "Backfill last 90 days"}
      </button>
      {message && (
        <div className="muted" style={{ fontSize: 12, maxWidth: 260, textAlign: "right", color: status === "error" ? "#8f3128" : undefined }}>
          {message}
        </div>
      )}
    </div>
  );
}
