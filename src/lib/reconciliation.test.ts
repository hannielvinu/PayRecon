import assert from "node:assert/strict";
import test from "node:test";
import { demoInput, runReconciliation } from "./reconciliation";
import { makeTriageCases, triagePrompt, validateTriageResult } from "./ai-triage";
import { investigatorPrompt, makeInvestigatorCases, validateInvestigatorResult } from "./ai-investigator";
import { localFinanceCommand, validateFinanceFilters } from "./ai-command";

const orders = "purchase_ref,payment_id,amount_rupees\nORD-1,pay-1,100.00\nORD-2,pay-2,100.00";
const settlements = "payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,fee_rupees,tax_rupees,refund_rupees,net_amount_rupees\npay-1,ORD-1,setl-1,UTR-1,100.00,2.00,0.36,0,97.64\npay-2,ORD-2,setl-1,UTR-1,100.00,2.00,0.36,0,97.64";
const matchingBank = "utr,description,credit_rupees,debit_rupees\nUTR-1,RAZORPAY,195.28,0";
const run = (bankCsv = matchingBank, settlementCsv = settlements, orderCsv = orders) =>
  runReconciliation({ ordersCsv: orderCsv, settlementsCsv: settlementCsv, bankCsv });

test("known-answer sample surfaces its six seeded categories without false matches", () => {
  const report = runReconciliation({ ...demoInput(), mode: "sample" });
  assert.equal(report.benchmark?.sourceRecordCount, 134);
  assert.equal(report.benchmark?.actualCleanMatchCount, 56);
  assert.equal(report.benchmark?.falseMatchCount, 0);
  assert.equal(report.benchmark?.actualExceptionCount, 13);
  assert.equal(report.benchmark?.falseExceptionCount, 0);
  assert.equal(report.benchmark?.falseExceptionCount, 0);
});

test("rejects a gateway row without a stable payment or purchase reference", () => {
  const noIdentity = "settlement_id,utr,gross_amount_rupees,net_amount_rupees\nsetl-1,UTR-1,100.00,97.64";
  assert.throws(() => run(matchingBank, noIdentity), /matching by amount alone is not allowed/);
});

test("rejects malformed or more-than-two-decimal currency values", () => {
  const malformed = "purchase_ref,payment_id,amount_rupees\nORD-1,pay-1,100.001";
  assert.throws(() => run(matchingBank, settlements, malformed), /at most two decimal places/);
});

test("aggregates payout lines by UTR and excludes a debit-only bank row", () => {
  const bank = `${matchingBank}\nUTR-DEBIT,TRANSFER OUT,0,50.00`;
  const report = run(bank);
  assert.equal(report.summary.reconciledSettlementCount, 1);
  assert.equal(report.summary.bankCreditCount, 1);
  assert.equal(report.findings.some(item => item.reference === "UTR-DEBIT"), false);
});

test("does not reconcile when the bank repeats a settlement UTR", () => {
  const bank = `${matchingBank}\nUTR-1,DUPLICATE EXPORT,195.28,0`;
  const report = run(bank);
  assert.equal(report.summary.reconciledSettlementCount, 0);
  assert.ok(report.findings.some(item => item.explanation.includes("Multiple bank rows use UTR UTR-1")));
});

test("rejects generic amount-only bank statements without transaction direction", () => {
  const ambiguousBank = "reference,amount_rupees\nUTR-1,195.28";
  assert.throws(() => run(ambiguousBank), /Generic amount columns are ambiguous/);
});

test("treats payment ID and purchase reference pointing to different orders as ambiguous", () => {
  const conflicting = "payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,net_amount_rupees\npay-1,ORD-2,setl-1,UTR-1,100.00,97.64";
  const report = run(matchingBank, conflicting);
  assert.equal(report.summary.matchedOrderCount, 0);
  assert.ok(report.findings.some(item => item.explanation.includes("point to different merchant orders")));
});

test("does not reconcile a payout containing duplicate payment IDs even if the bank total matches the double-counted lines", () => {
  const duplicateSettlement = `${settlements}\npay-1,ORD-1,setl-1,UTR-1,100.00,2.00,0.36,0,97.64`;
  const doubleCountedBank = "utr,description,credit_rupees\nUTR-1,RAZORPAY,292.92";
  const report = run(doubleCountedBank, duplicateSettlement);
  assert.equal(report.summary.reconciledSettlementCount, 0);
  assert.ok(report.findings.some(item => item.explanation.includes("repeats a payment ID")));
});

test("accepts a one-paise settlement arithmetic rounding difference", () => {
  const onePaisa = "payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,fee_rupees,tax_rupees,refund_rupees,net_amount_rupees\npay-1,ORD-1,setl-1,UTR-1,100.00,2.00,0.36,0,97.63";
  const onePaisaBank = "utr,description,credit_rupees\nUTR-1,RAZORPAY,97.63";
  const report = run(onePaisaBank, onePaisa, "purchase_ref,payment_id,amount_rupees\nORD-1,pay-1,100.00");
  assert.equal(report.findings.some(item => item.category === "settlement_math"), false);
  assert.equal(report.summary.reconciledSettlementCount, 1);
});

test("parses UTF-8 BOM, quoted commas, and multiline CSV fields", () => {
  const quotedOrders = "\uFEFFpurchase_ref,payment_id,amount_rupees\n\"ORD, 1\",pay-1,100.00";
  const quotedSettlement = "payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,net_amount_rupees\npay-1,\"ORD, 1\",setl-1,UTR-1,100.00,97.64";
  const quotedBank = "utr,description,credit_rupees\nUTR-1,\"Razorpay payout\ncredit\",97.64";
  const report = run(quotedBank, quotedSettlement, quotedOrders);
  assert.equal(report.summary.matchedOrderCount, 1);
  assert.equal(report.summary.reconciledSettlementCount, 1);
});

test("processes a 5,000-order synthetic batch with grouped payouts", () => {
  const orderLines = ["purchase_ref,payment_id,amount_rupees"];
  const settlementLines = ["payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,fee_rupees,tax_rupees,refund_rupees,net_amount_rupees"];
  const payouts = new Map<number, number>();
  for (let index = 0; index < 5000; index++) {
    const number = index + 1;
    const payout = Math.floor(index / 5) + 1;
    orderLines.push(`ORD-${number},pay-${number},100.00`);
    settlementLines.push(`pay-${number},ORD-${number},setl-${payout},UTR-${payout},100.00,2.00,0.36,0,97.64`);
    payouts.set(payout, (payouts.get(payout) || 0) + 9764);
  }
  const bankLines = ["utr,description,credit_rupees", ...[...payouts].map(([payout, paise]) => `UTR-${payout},RAZORPAY,${(paise / 100).toFixed(2)}`)];
  const report = runReconciliation({ ordersCsv: orderLines.join("\n"), settlementsCsv: settlementLines.join("\n"), bankCsv: bankLines.join("\n") });
  assert.equal(report.summary.orderCount, 5000);
  assert.equal(report.summary.matchedOrderCount, 5000);
  assert.equal(report.summary.settlementCount, 1000);
  assert.equal(report.summary.reconciledSettlementCount, 1000);
  assert.equal(report.summary.exceptionCount, 0);
});

test("builds a minimized AI payload without source identifiers or amounts", () => {
  const cases = makeTriageCases([{ category: "amount_variance", severity: "high" }]);
  const prompt = triagePrompt(cases);
  assert.deepEqual(cases, [{ caseKey: "F01", category: "amount_variance", severity: "high" }]);
  assert.equal(prompt.includes("ORD-9013"), false);
  assert.equal(prompt.includes("₹"), false);
  assert.throws(() => makeTriageCases(Array.from({ length: 51 }, () => ({ category: "missing_payment", severity: "medium" }))), /between 1 and 50/);
});

test("accepts only case-cited, category-compatible AI triage", () => {
  const cases = makeTriageCases([{ category: "missing_bank_credit", severity: "medium" }]);
  const valid = validateTriageResult(JSON.stringify({ summary: "Check the settlement window first.", cases: [{ caseKey: "F01", priority: "high", rationale: "A missing bank credit needs a timing check.", nextCheck: "check_bank_window" }] }), cases);
  assert.equal(valid.cases[0].caseKey, "F01");
  assert.throws(() => validateTriageResult(JSON.stringify({ summary: "Review this.", cases: [{ caseKey: "F99", priority: "urgent", rationale: "Check it.", nextCheck: "check_bank_window" }] }), cases), /missing or repeated case key/);
  assert.throws(() => validateTriageResult(JSON.stringify({ summary: "Review this.", cases: [{ caseKey: "F01", priority: "urgent", rationale: "Check it.", nextCheck: "inspect_settlement_math" }] }), cases), /does not apply to the finding category/);
});

test("attaches source-row evidence to financial exceptions", () => {
  const orderWithVariance = "purchase_ref,payment_id,amount_rupees\nORD-1,pay-1,120.00\nORD-2,pay-2,50.00";
  const settlementWithMathError = "payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,fee_rupees,tax_rupees,refund_rupees,net_amount_rupees\npay-1,ORD-1,setl-1,UTR-1,100.00,2.00,0.36,0,90.00";
  const report = run(matchingBank, settlementWithMathError, orderWithVariance);
  const grossVariance = report.findings.find(item => item.explanation.includes("differs from gateway gross"));
  const mathError = report.findings.find(item => item.category === "settlement_math");
  const missingOrder = report.findings.find(item => item.category === "missing_payment");

  assert.ok(grossVariance);
  assert.ok(grossVariance.evidence.includes("Merchant order row 2"));
  assert.ok(grossVariance.evidence.includes("Settlement row 2"));
  assert.ok(mathError);
  assert.ok(mathError.evidence.includes("Settlement row 2"));
  assert.ok(missingOrder);
  assert.ok(missingOrder.evidence.includes("Merchant order row 3"));
});

test("sample run includes settlement and bank dates for delay investigation and fee summaries", () => {
  const report = runReconciliation({ ...demoInput(), mode: "sample" });
  const delayed = report.matched.filter(row => row.settlementDate && row.bankCreditDate && Date.parse(row.bankCreditDate) - Date.parse(row.settlementDate) > 48 * 60 * 60 * 1000);
  assert.ok(delayed.length >= 10, "two synthetic Friday payout groups should credit after the 48-hour window");
  assert.ok(report.matched.every(row => row.feePaise !== null));
  assert.ok(report.matched.reduce((sum, row) => sum + (row.feePaise || 0), 0) > 0);
  assert.equal(report.findings.some(item => item.category === "settlement_math" && item.evidence.includes("Settlement row 32")), false, "a one-paisa edge case remains within the deterministic tolerance");
});

test("AI investigator requires exact source identifiers and balanced, evidence-sized draft journals", () => {
  const cases = makeInvestigatorCases([{ category: "settlement_math", severity: "medium", reference: "setl-1", explanation: "Settlement arithmetic differs.", evidence: ["Gross 100.00", "Fee 2.00", "Tax 0.36", "Reported net 90.00"], amountPaise: 836, paymentId: "pay-1", settlementId: "setl-1", purchaseRef: "ORD-1", utr: "UTR-1" }]);
  const prompt = investigatorPrompt(cases);
  assert.ok(prompt.includes("do not invent IDs"));
  const good = { cases: [{ caseKey: "F01", causeType: "unexplained_variance", causeHypothesis: "The export may reflect a separate adjustment; verify its supporting line before accounting.", supportTicket: { subject: "Please review payment pay-1 settlement setl-1", body: "Please investigate payment pay-1, settlement setl-1, order ORD-1, UTR-1. The deterministic finding amount is 836 paise; please confirm the source calculation." }, journalEntry: { status: "not_recommended", debitAccount: "", creditAccount: "", amountPaise: 0, memo: "Do not journal until the variance source and accounting policy are confirmed." } }] };
  assert.equal(validateInvestigatorResult(JSON.stringify(good), cases).cases.length, 1);
  const invented = structuredClone(good);
  invented.cases[0].supportTicket.body = "Please review it. No identifiers or source detail are available in the draft request.";
  assert.throws(() => validateInvestigatorResult(JSON.stringify(invented), cases), /omitted a source identifier/);
  const unbalanced = structuredClone(good);
  unbalanced.cases[0].journalEntry = { status: "draft", debitAccount: "Gateway Fee Expense", creditAccount: "Razorpay Clearing", amountPaise: 900, memo: "Proposed review." };
  assert.throws(() => validateInvestigatorResult(JSON.stringify(unbalanced), cases), /exactly the finding amount/);
});

test("finance command maps only supported query filters and rejects unsafe model output", () => {
  const mapped = localFinanceCommand("Filter unmapped gateway payments above ₹2,000");
  assert.equal(mapped.filters.target, "exceptions");
  assert.equal(mapped.filters.category, "unmapped_gateway_payment");
  assert.equal(mapped.filters.minAmountPaise, 200000);
  const delayed = localFinanceCommand("Which bank settlements were delayed by more than 48 hours?");
  assert.equal(delayed.filters.target, "matched");
  assert.equal(delayed.filters.minDelayHours, 48);
  assert.equal(validateFinanceFilters(mapped.filters).minAmountPaise, 200000);
  assert.throws(() => validateFinanceFilters({ ...mapped.filters, target: "run_sql" }), /unsupported result target/);
});
