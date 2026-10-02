import { findingCategories, findingSeverities, type FindingCategory, type FindingSeverity } from "@/lib/ai-triage";

export type FinanceFilters = { target: "exceptions" | "matched" | "all"; category: FindingCategory | ""; severity: FindingSeverity | ""; minAmountPaise: number; minDelayHours: number; summaryMetric: "gateway_fee_deductions" | "" };
export const emptyFinanceFilters: FinanceFilters = { target: "all", category: "", severity: "", minAmountPaise: 0, minDelayHours: 0, summaryMetric: "" };

export function localFinanceCommand(query: string): { filters: FinanceFilters; explanation: string } {
  const text = query.toLowerCase();
  const filters = { ...emptyFinanceFilters };
  const amountMatch = text.match(/(?:above|over|greater than|exceed(?:ing)?)\s*(?:₹|rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)/);
  if (amountMatch) filters.minAmountPaise = Math.round(Number(amountMatch[1].replaceAll(",", "")) * 100);
  const delayMatch = text.match(/(?:more than|over|above|greater than)\s*(\d+(?:\.\d+)?)\s*hours?/);
  if (delayMatch) filters.minDelayHours = Number(delayMatch[1]);
  if (/unmapped gateway|orphan gateway/.test(text)) { filters.category = "unmapped_gateway_payment"; filters.target = "exceptions"; }
  else if (/missing bank|bank credit/.test(text)) { filters.category = "missing_bank_credit"; filters.target = "exceptions"; }
  else if (/delayed|delay|lag/.test(text)) filters.target = "matched";
  else if (/exception|flagged/.test(text)) filters.target = "exceptions";
  if (/high|urgent/.test(text)) filters.severity = "high";
  else if (/medium/.test(text)) filters.severity = "medium";
  else if (/low|informational/.test(text)) filters.severity = "low";
  if (/fee deduction|gateway fees?|fee totals?/.test(text)) filters.summaryMetric = "gateway_fee_deductions";
  if (filters.minAmountPaise === 0 && filters.minDelayHours === 0 && !filters.category && !filters.severity && !filters.summaryMetric && filters.target === "all") throw new Error("I could not map that question to supported local filters. Try a threshold, severity, finding category, delayed-settlement window, or gateway-fee summary.");
  return { filters, explanation: "Translated to supported report filters. Results are calculated from the deterministic reconciliation report." };
}

export function validateFinanceFilters(value: unknown): FinanceFilters {
  if (!value || typeof value !== "object") throw new Error("Finance command result is invalid.");
  const input = value as Record<string, unknown>;
  if (!(["exceptions", "matched", "all"] as const).includes(input.target as FinanceFilters["target"])) throw new Error("Finance command returned an unsupported result target.");
  if (input.category !== "" && !findingCategories.includes(input.category as FindingCategory)) throw new Error("Finance command returned an unsupported exception category.");
  if (input.severity !== "" && !findingSeverities.includes(input.severity as FindingSeverity)) throw new Error("Finance command returned an unsupported severity.");
  if (!Number.isSafeInteger(input.minAmountPaise) || (input.minAmountPaise as number) < 0 || (input.minAmountPaise as number) > 1_000_000_000_00 || typeof input.minDelayHours !== "number" || input.minDelayHours < 0 || input.minDelayHours > 8760) throw new Error("Finance command returned an invalid threshold.");
  if (input.summaryMetric !== "" && input.summaryMetric !== "gateway_fee_deductions") throw new Error("Finance command returned an unsupported summary metric.");
  return { target: input.target as FinanceFilters["target"], category: input.category as FinanceFilters["category"], severity: input.severity as FinanceFilters["severity"], minAmountPaise: input.minAmountPaise as number, minDelayHours: input.minDelayHours, summaryMetric: input.summaryMetric as FinanceFilters["summaryMetric"] };
}
