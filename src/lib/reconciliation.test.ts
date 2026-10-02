import assert from "node:assert/strict";
import test from "node:test";
import { demoInput, runReconciliation } from "./reconciliation";

const orders = "purchase_ref,payment_id,amount_rupees\nORD-1,pay-1,100.00\nORD-2,pay-2,100.00";
const settlements = "payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,fee_rupees,tax_rupees,refund_rupees,net_amount_rupees\npay-1,ORD-1,setl-1,UTR-1,100.00,2.00,0.36,0,97.64\npay-2,ORD-2,setl-1,UTR-1,100.00,2.00,0.36,0,97.64";
const matchingBank = "utr,description,credit_rupees,debit_rupees\nUTR-1,RAZORPAY,195.28,0";
const run = (bankCsv = matchingBank, settlementCsv = settlements, orderCsv = orders) =>
  runReconciliation({ ordersCsv: orderCsv, settlementsCsv: settlementCsv, bankCsv });

test("known-answer sample surfaces its six seeded categories without false matches", () => {
  const report = runReconciliation({ ...demoInput(), mode: "sample" });
  assert.equal(report.benchmark?.sourceRecordCount, 132);
  assert.equal(report.benchmark?.actualCleanMatchCount, 58);
  assert.equal(report.benchmark?.falseMatchCount, 0);
  assert.equal(report.benchmark?.actualExceptionCount, 6);
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
