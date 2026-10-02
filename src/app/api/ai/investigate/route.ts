import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { NextResponse } from "next/server";
import { investigatorPrompt, investigatorResponseSchema, makeInvestigatorCases, validateInvestigatorResult, type InvestigatorCase } from "@/lib/ai-investigator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MODEL_ID = "gemini-3.8-flash";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  let cases: InvestigatorCase[];
  try { cases = makeInvestigatorCases((body as { findings?: unknown } | null)?.findings); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Investigation input is invalid." }, { status: 400 }); }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI investigation is not configured. Add GEMINI_API_KEY to the local server environment, then restart the app." }, { status: 503 });
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: investigatorPrompt(cases),
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, responseMimeType: "application/json", responseJsonSchema: investigatorResponseSchema(cases), maxOutputTokens: 7000 },
    });
    const result = validateInvestigatorResult(response.text || "", cases);
    return NextResponse.json({ model: MODEL_ID, result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "AI investigation failed validation or the provider is unavailable. Your deterministic reconciliation report remains unchanged." }, { status: 502 });
  }
}
