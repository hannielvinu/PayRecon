import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { NextResponse } from "next/server";
import { makeTriageCases, triagePrompt, triageResponseSchema, validateTriageResult, type TriageCase } from "@/lib/ai-triage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MODEL_ID = "gemini-3.8-flash";

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI triage is not configured. Add GEMINI_API_KEY to the local server environment, then restart the app." }, { status: 503 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  let cases: TriageCase[];
  try { cases = makeTriageCases((body as { findings?: unknown } | null)?.findings); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "AI triage input is invalid." }, { status: 400 }); }
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: triagePrompt(cases),
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseJsonSchema: triageResponseSchema(cases),
        maxOutputTokens: 3000,
      },
    });
    const result = validateTriageResult(response.text || "", cases);
    return NextResponse.json({ model: MODEL_ID, result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "AI triage failed. Your deterministic reconciliation report remains available; try again later." }, { status: 502 });
  }
}
