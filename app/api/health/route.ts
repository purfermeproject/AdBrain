import { NextResponse } from "next/server";
import { hasDatabase, query } from "@/lib/db";
import { configuredProvider } from "@/lib/ai";

// Mirrors creatives_system's /api/health so both apps report status the
// same way for anyone operating them side by side.
export async function GET() {
  const aiProvider = configuredProvider();
  let databaseOk = false;
  let databaseError: string | null = null;

  if (hasDatabase()) {
    try {
      await query("select 1");
      databaseOk = true;
    } catch (error) {
      databaseError = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json({
    status: databaseOk || !hasDatabase() ? "ok" : "degraded",
    aiProvider,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    databaseConfigured: hasDatabase(),
    databaseOk,
    databaseError,
  });
}
