import { NextResponse } from "next/server";
import { demoInput, runReconciliation } from "@/lib/reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_SOURCE_CHARS = 2_000_000;

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const input = body as Partial<{ sample: boolean; ordersCsv: string; settlementsCsv: string; bankCsv: string; sourceNames: { orders?: string; settlements?: string; bank?: string } }>;
  const source = input.sample ? demoInput() : input;
  if (![source.ordersCsv, source.settlementsCsv, source.bankCsv].every(value => typeof value === "string" && value.length > 0)) {
    return NextResponse.json({ error: "Upload all three CSVs: merchant orders, Razorpay settlement export, and bank statement." }, { status: 400 });
  }
  if ([source.ordersCsv, source.settlementsCsv, source.bankCsv].some(value => value!.length > MAX_SOURCE_CHARS)) {
    return NextResponse.json({ error: "Each CSV must be smaller than 2 MB." }, { status: 413 });
  }
  try {
    const report = runReconciliation({
      ordersCsv: source.ordersCsv!, settlementsCsv: source.settlementsCsv!, bankCsv: source.bankCsv!,
      mode: input.sample ? "sample" : "uploaded", sourceNames: input.sourceNames,
    });
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reconciliation could not process these files." }, { status: 400 });
  }
}
