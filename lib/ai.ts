import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

// Provider-abstracted AI client. Mirrors creatives_system/lib/ai.ts so both
// apps are configured and operated the same way (see docs/02-ARCHITECTURE.md
// §2.3). Every intelligence agent (docs/04, prompts in docs/05) calls
// generateStructured() rather than the provider SDKs directly, so swapping
// providers or adding validation/retries never touches agent code.

export type AIProvider = "gemini" | "openai" | "demo";

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to the recovery strategies below */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      /* fall through */
    }
  }
  return { raw: text };
}

export function configuredProvider(): AIProvider {
  const requested = String(process.env.AI_PROVIDER || "").toLowerCase();
  if (requested === "gemini") return process.env.GEMINI_API_KEY ? "gemini" : "demo";
  if (requested === "openai") return process.env.OPENAI_API_KEY ? "openai" : "demo";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "demo";
}

async function runGemini(systemPrompt: string, input: unknown) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");
  const ai = new GoogleGenAI({ apiKey: key });
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const combined = [
    systemPrompt,
    "\nSYSTEM OUTPUT REQUIREMENT:\nReturn one valid JSON object only. Do not use markdown fences. Do not add commentary outside the JSON.",
    `\nINPUT:\n${JSON.stringify(input, null, 2)}`,
  ].join("\n");

  const response = await ai.models.generateContent({ model, contents: combined });
  const text = response.text || "";
  if (!text) throw new Error("Gemini returned an empty response.");
  return { provider: "gemini" as const, model, output: parseJSON(text) };
}

async function runOpenAI(systemPrompt: string, input: unknown) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  const client = new OpenAI({ apiKey: key });
  const model = process.env.OPENAI_MODEL || "gpt-5.6";
  const response = await client.responses.create({
    model,
    reasoning: { effort: "medium" },
    input: [
      { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
      {
        role: "user",
        content: [{ type: "input_text", text: `Return valid JSON only.\n\nINPUT:\n${JSON.stringify(input, null, 2)}` }],
      },
    ],
  });
  return { provider: "openai" as const, model, output: parseJSON(response.output_text) };
}

async function runOnce(systemPrompt: string, input: unknown) {
  const provider = configuredProvider();
  if (provider === "gemini") return runGemini(systemPrompt, input);
  if (provider === "openai") return runOpenAI(systemPrompt, input);
  return { provider: "demo" as const, model: "demo", output: { ok: true, note: "Configure AI_PROVIDER + an API key to get live output." } };
}

export type StructuredResult<T> = {
  mode: "live" | "demo";
  provider: AIProvider;
  model: string;
  agent: string;
  output: T;
};

/**
 * Calls the configured provider and validates the parsed JSON output before
 * returning it. On a validation failure it retries once with the failure
 * reason appended to the prompt (docs/08 Phase 0 item 4: "JSON-schema
 * validation and retry-on-invalid-output").
 */
export async function generateStructured<T>(
  agent: string,
  systemPrompt: string,
  input: unknown,
  validate?: (value: unknown) => value is T
): Promise<StructuredResult<T>> {
  const first = await runOnce(systemPrompt, input);
  if (!validate || validate(first.output)) {
    return { mode: first.provider === "demo" ? "demo" : "live", agent, ...first, output: first.output as T };
  }

  const retry = await runOnce(
    `${systemPrompt}\n\nYour previous response did not match the required output shape. Return ONLY a JSON object matching the required shape exactly.`,
    input
  );
  if (!validate(retry.output)) {
    throw new Error(`Agent "${agent}" returned output that failed validation twice.`);
  }
  return { mode: retry.provider === "demo" ? "demo" : "live", agent, ...retry, output: retry.output as T };
}
