export type AgentStep = { id: string; title: string; tool: string; detail: string; count: number; status: "complete" };
export type InputRow = Record<string, string>;
export type OrderRow = { purchaseRef: string; paymentId: string; amountPaise: number; sourceRow: number };
export type SettlementRow = { paymentId: string; purchaseRef: string; settlementId: string; utr: string; grossPaise: number; feePaise: number | null; taxPaise: number | null; refundPaise: number | null; netPaise: number; sourceRow: number };
export type BankRow = { utr: string; description: string; amountPaise: number; sourceRow: number };
export type Finding = { id: string; category: "missing_payment" | "unmapped_gateway_payment" | "amount_variance" | "settlement_math" | "missing_bank_credit" | "bank_unmatched"; severity: "high" | "medium" | "low"; reference: string; explanation: string; evidence: string[]; suggestedAction: string; amountPaise: number };
export type ReconciliationReport = {
  generatedAt: string;
  mode: "sample" | "uploaded";
  sources: { orders: string; settlements: string; bank: string };
  summary: { orderCount: number; gatewayPaymentCount: number; bankCreditCount: number; matchedOrderCount: number; reconciledSettlementCount: number; settlementCount: number; exceptionCount: number; exceptionAmountPaise: number };
  steps: AgentStep[];
  findings: Finding[];
  matched: Array<{ purchaseRef: string; paymentId: string; settlementId: string; amountPaise: number; netPaise: number; utr: string }>;
  benchmark?: { label: string; sourceRecordCount: number; orderRecordCount: number; expectedCleanMatchCount: number; actualCleanMatchCount: number; falseMatchCount: number; expectedExceptionCount: number; actualExceptionCount: number; correctExceptionCount: number; falseExceptionCount: number; precisionPercent: number; recallPercent: number; exceptionPrecisionPercent: number; exceptionRecallPercent: number };
};

function asRupees(paise: number) { return (paise / 100).toFixed(2); }
export function demoInput() {
  const orderLines = ["purchase_ref,payment_id,amount_rupees,created_at"];
  const settlementLines = ["payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,fee_rupees,tax_rupees,refund_rupees,net_amount_rupees"];
  const bankGroups = new Map<number, number>();
  for (let index = 0; index < 60; index++) {
    const orderNumber = index + 1;
    const batch = Math.floor(index / 5) + 1;
    const orderRef = `ORD-${String(9000 + orderNumber)}`;
    const paymentId = `pay_demo_${String(orderNumber).padStart(3, "0")}`;
    const orderGross = 100000 + (index * 13721 % 1900000);
    orderLines.push(`${orderRef},${paymentId},${asRupees(orderGross)},2026-09-${String(1 + index % 28).padStart(2, "0")}T10:00:00Z`);
    if (index === 57) continue; // known missing payment row
    const settlementGross = orderGross + (index === 12 ? 5000 : 0); // known gross conflict
    const fee = Math.round(settlementGross * 0.02);
    const tax = Math.round(fee * 0.18);
    const net = settlementGross - fee - tax + (index === 23 ? 500 : 0); // known arithmetic exception
    const settlementId = `setl_demo_${String(batch).padStart(2, "0")}`;
    const utr = `UTR-DEMO-${String(batch).padStart(3, "0")}`;
    settlementLines.push(`${paymentId},${orderRef},${settlementId},${utr},${asRupees(settlementGross)},${asRupees(fee)},${asRupees(tax)},0.00,${asRupees(net)}`);
    bankGroups.set(batch, (bankGroups.get(batch) || 0) + net);
  }
  // Known orphan settlement. It shares a payout with valid payments so group arithmetic stays realistic.
  const orphanGross = 735000, orphanFee = Math.round(orphanGross * 0.02), orphanTax = Math.round(orphanFee * 0.18), orphanNet = orphanGross - orphanFee - orphanTax;
  settlementLines.push(`pay_demo_orphan,ORD-LEGACY-77,setl_demo_12,UTR-DEMO-012,${asRupees(orphanGross)},${asRupees(orphanFee)},${asRupees(orphanTax)},0.00,${asRupees(orphanNet)}`);
  bankGroups.set(12, (bankGroups.get(12) || 0) + orphanNet);
  const bankLines = ["utr,description,credit_rupees,transaction_date"];
  for (const [batch, amountPaise] of bankGroups) {
    if (batch === 9) continue; // known missing bank credit
    bankLines.push(`UTR-DEMO-${String(batch).padStart(3, "0")},RAZORPAY SETTLEMENT setl_demo_${String(batch).padStart(2, "0")},${asRupees(amountPaise)},2026-10-01`);
  }
  bankLines.push("BANK-OTHER-22,NEFT CUSTOMER CREDIT,4200.00,2026-10-01"); // known unmatched credit
  return { ordersCsv: orderLines.join("\n"), settlementsCsv: settlementLines.join("\n"), bankCsv: bankLines.join("\n") };
}

function parseCsv(text: string, sourceName: string): InputRow[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error(`${sourceName}: CSV ends inside a quoted field.`);
  if (field || row.length) { row.push(field); if (row.some(cell => cell.trim())) rows.push(row); }
  if (rows.length < 2) throw new Error(`${sourceName}: add a header row and at least one data row.`);
  const headers = rows[0].map(header => normalizeHeader(header));
  if (new Set(headers).size !== headers.length) throw new Error(`${sourceName}: duplicate column headers are ambiguous.`);
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])));
}

function normalizeHeader(header: string) { return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function value(row: InputRow, ...names: string[]) { for (const name of names) { const result = row[normalizeHeader(name)]; if (result !== undefined && result !== "") return result; } return ""; }
function amount(row: InputRow, names: string[], source: string, line: number, required = true): number {
  const raw = value(row, ...names);
  if (!raw && !required) return 0;
  if (!raw) throw new Error(`${source} row ${line}: ${names[0]} is required.`);
  const numeric = Number(raw.replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(numeric) || numeric < 0 || !/^\d+(\.\d{1,2})?$/.test(raw.replace(/[₹,\s]/g, ""))) throw new Error(`${source} row ${line}: ${names[0]} must be a non-negative amount in rupees with at most two decimal places.`);
  return Math.round(numeric * 100);
}
function money(paise: number) { return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function finding(id: string, category: Finding["category"], severity: Finding["severity"], reference: string, explanation: string, evidence: string[], suggestedAction: string, amountPaise: number): Finding {
  return { id, category, severity, reference, explanation, evidence, suggestedAction, amountPaise };
}

function parseOrders(text: string): OrderRow[] {
  return parseCsv(text, "Merchant order ledger").map((row, index) => {
    const purchaseRef = value(row, "purchase_ref", "merchant_order_id", "order_reference", "receipt", "order_id");
    if (!purchaseRef) throw new Error(`Merchant order ledger row ${index + 2}: missing purchase_ref/order_id.`);
    return { purchaseRef, paymentId: value(row, "payment_id", "razorpay_payment_id", "pay_id"), amountPaise: amount(row, ["amount_rupees", "gross_amount_rupees", "order_amount_rupees", "amount", "gross_amount"], "Merchant order ledger", index + 2), sourceRow: index + 2 };
  });
}
function parseSettlements(text: string): SettlementRow[] {
  return parseCsv(text, "Razorpay settlement export").map((row, index) => {
    const paymentId = value(row, "payment_id", "razorpay_payment_id", "pay_id");
    const purchaseRef = value(row, "purchase_ref", "merchant_order_id", "order_reference", "receipt", "order_id");
    if (!paymentId && !purchaseRef) throw new Error(`Razorpay settlement export row ${index + 2}: include payment_id or purchase_ref; matching by amount alone is not allowed.`);
    return {
      paymentId, purchaseRef, settlementId: value(row, "settlement_id", "entity_id"), utr: value(row, "utr", "utr_number", "bank_reference", "utr_reference"),
      grossPaise: amount(row, ["gross_amount_rupees", "payment_amount_rupees", "gross_amount", "amount_rupees", "amount"], "Razorpay settlement export", index + 2),
      feePaise: value(row, "fee_rupees", "fees_rupees", "fee", "fees", "razorpay_fee") ? amount(row, ["fee_rupees", "fees_rupees", "fee", "fees", "razorpay_fee"], "Razorpay settlement export", index + 2) : null,
      taxPaise: value(row, "tax_rupees", "gst_rupees", "tax", "gst", "fee_tax") ? amount(row, ["tax_rupees", "gst_rupees", "tax", "gst", "fee_tax"], "Razorpay settlement export", index + 2) : null,
      refundPaise: value(row, "refund_rupees", "refund_amount_rupees", "refund", "refund_offset") ? amount(row, ["refund_rupees", "refund_amount_rupees", "refund", "refund_offset"], "Razorpay settlement export", index + 2) : null,
      netPaise: amount(row, ["net_amount_rupees", "settled_amount_rupees", "net_amount", "settlement_amount", "settled_amount"], "Razorpay settlement export", index + 2), sourceRow: index + 2,
    };
  });
}
function parseBank(text: string): BankRow[] {
  const rows = parseCsv(text, "Bank statement");
  const creditHeaders = ["credit_rupees", "deposit_rupees", "credit", "deposit", "credit_amount_rupees", "credit_amount"];
  const debitHeaders = ["debit_rupees", "withdrawal_rupees", "debit", "withdrawal", "debit_amount_rupees", "debit_amount"];
  const hasCreditColumn = rows.length > 0 && creditHeaders.some(header => Object.hasOwn(rows[0], normalizeHeader(header)));
  const hasDebitColumn = rows.length > 0 && debitHeaders.some(header => Object.hasOwn(rows[0], normalizeHeader(header)));
  return rows.flatMap((row, index) => {
    const utr = value(row, "utr", "utr_number", "bank_reference", "reference", "transaction_reference");
    const description = value(row, "description", "narration", "particulars", "remarks");
    const direction = value(row, "transaction_type", "type", "dr_cr", "cr_dr", "debit_credit").trim().toLowerCase();
    const creditText = value(row, ...creditHeaders);
    const debitText = value(row, ...debitHeaders);
    const isDebit = ["debit", "dr", "withdrawal", "withdraw", "payment"].includes(direction);
    const isCredit = ["credit", "cr", "deposit", "receipt"].includes(direction);
    if (isDebit || (hasDebitColumn && debitText && !creditText && Number(debitText.replace(/[₹,\s]/g, "")) > 0)) return [];
    if (!hasCreditColumn && !hasDebitColumn && !isCredit) {
      throw new Error("Bank statement: include a clearly named credit/deposit column (or a transaction type column). Generic amount columns are ambiguous and could include outgoing debits.");
    }
    if (hasCreditColumn && !creditText) return [];
    if (hasCreditColumn && Number(creditText.replace(/[₹,\s]/g, "")) === 0) return [];
    if (hasDebitColumn && debitText && Number(debitText.replace(/[₹,\s]/g, "")) > 0 && !creditText) return [];
    if (!utr && !description) throw new Error(`Bank statement row ${index + 2}: include a UTR/reference or narration.`);
    const amountHeaders = hasCreditColumn ? creditHeaders : ["amount_rupees", "amount", "transaction_amount_rupees", "transaction_amount"];
    return [{ utr, description, amountPaise: amount(row, amountHeaders, "Bank statement", index + 2), sourceRow: index + 2 }];
  });
}

export function runReconciliation(input: { ordersCsv: string; settlementsCsv: string; bankCsv: string; mode?: "sample" | "uploaded"; sourceNames?: { orders?: string; settlements?: string; bank?: string } }): ReconciliationReport {
  const orders = parseOrders(input.ordersCsv);
  const settlements = parseSettlements(input.settlementsCsv);
  const bank = parseBank(input.bankCsv);
  const findings: Finding[] = [];
  const matched: ReconciliationReport["matched"] = [];
  const orderByPayment = new Map<string, OrderRow>();
  const orderByRef = new Map<string, OrderRow>();
  const duplicateOrderPayments = new Set<string>();
  const duplicateOrderRefs = new Set<string>();
  for (const order of orders) {
    if (orderByRef.has(order.purchaseRef)) {
      duplicateOrderRefs.add(order.purchaseRef);
      findings.push(finding(`duplicate-order-${order.sourceRow}`, "amount_variance", "high", order.purchaseRef, "The merchant ledger contains this purchase reference more than once; the match is ambiguous.", [`Merchant ledger rows ${orderByRef.get(order.purchaseRef)!.sourceRow} and ${order.sourceRow}`], "Resolve duplicate purchase references before accepting any order match.", order.amountPaise));
    }
    else orderByRef.set(order.purchaseRef, order);
    if (order.paymentId) {
      if (orderByPayment.has(order.paymentId)) {
        duplicateOrderPayments.add(order.paymentId);
        findings.push(finding(`duplicate-order-payment-${order.sourceRow}`, "amount_variance", "high", order.paymentId, "The merchant ledger assigns this payment ID to multiple orders; the match is ambiguous.", [`Merchant ledger rows ${orderByPayment.get(order.paymentId)!.sourceRow} and ${order.sourceRow}`], "Resolve the duplicate payment ID before accepting any order match.", order.amountPaise));
      }
      else orderByPayment.set(order.paymentId, order);
    }
  }

  const ordersWithPaymentRows = new Set<OrderRow>();
  const seenPaymentIds = new Map<string, SettlementRow>();
  const unsafeSettlementRows = new Set<number>();
  for (const settlement of settlements) {
    if (settlement.paymentId && seenPaymentIds.has(settlement.paymentId)) {
      const original = seenPaymentIds.get(settlement.paymentId)!;
      unsafeSettlementRows.add(original.sourceRow);
      unsafeSettlementRows.add(settlement.sourceRow);
      findings.push(finding(`duplicate-payment-${settlement.sourceRow}`, "amount_variance", "high", settlement.paymentId, "The settlement export repeats a payment ID; totals could be double-counted.", [`Settlement export row ${settlement.sourceRow}`], "Inspect both rows and confirm whether this is a duplicate export line or a distinct adjustment.", settlement.grossPaise));
      continue;
    }
    if (settlement.paymentId) seenPaymentIds.set(settlement.paymentId, settlement);
    const paymentCandidate = settlement.paymentId && !duplicateOrderPayments.has(settlement.paymentId) ? orderByPayment.get(settlement.paymentId) : undefined;
    const referenceCandidate = settlement.purchaseRef && !duplicateOrderRefs.has(settlement.purchaseRef) ? orderByRef.get(settlement.purchaseRef) : undefined;
    const identityConflict = Boolean(paymentCandidate && referenceCandidate && paymentCandidate !== referenceCandidate);
    if (identityConflict) {
      findings.push(finding(`identity-conflict-${settlement.sourceRow}`, "amount_variance", "high", settlement.paymentId || settlement.purchaseRef, "The payment ID and purchase reference point to different merchant orders; this row is ambiguous.", [`Payment ID ${settlement.paymentId} maps to merchant row ${paymentCandidate!.sourceRow}`, `Purchase reference ${settlement.purchaseRef} maps to merchant row ${referenceCandidate!.sourceRow}`, `Settlement row ${settlement.sourceRow}`], "Resolve the conflicting identifiers in the source ledgers before accepting this payment match.", settlement.grossPaise));
    }
    const order = identityConflict ? undefined : paymentCandidate || referenceCandidate;
    if (!order && !identityConflict) {
      findings.push(finding(`orphan-payment-${settlement.sourceRow}`, "unmapped_gateway_payment", "high", settlement.paymentId || settlement.purchaseRef, "A Razorpay settlement row did not match a merchant order by payment ID or purchase reference. Amount-only matching was not attempted.", [`Razorpay settlement row ${settlement.sourceRow}`, settlement.settlementId || "No settlement ID"], "Check the merchant reference mapping and settlement period; confirm the intended order before linking it.", settlement.grossPaise));
    } else if (order) {
      ordersWithPaymentRows.add(order);
      if (order.paymentId && settlement.paymentId && order.paymentId !== settlement.paymentId) {
        findings.push(finding(`payment-id-variance-${settlement.sourceRow}`, "amount_variance", "high", order.purchaseRef, "The purchase reference matched but the payment IDs conflict.", [`Merchant payment ${order.paymentId}`, `Gateway payment ${settlement.paymentId}`, `Merchant row ${order.sourceRow}`, `Settlement row ${settlement.sourceRow}`], "Verify the payment-to-order mapping; do not auto-correct conflicting IDs.", settlement.grossPaise));
      }
      if (order.amountPaise !== settlement.grossPaise) {
        findings.push(finding(`gross-variance-${settlement.sourceRow}`, "amount_variance", "high", order.purchaseRef, `Merchant gross ${money(order.amountPaise)} differs from gateway gross ${money(settlement.grossPaise)}.`, [`Merchant order row ${order.sourceRow}`, `Settlement row ${settlement.sourceRow}`, `Difference ${money(Math.abs(order.amountPaise - settlement.grossPaise))}`], "Review partial capture, adjustment, or mapping before accepting the match.", Math.abs(order.amountPaise - settlement.grossPaise)));
      }
      if (order.amountPaise === settlement.grossPaise && (!order.paymentId || !settlement.paymentId || order.paymentId === settlement.paymentId)) {
        matched.push({ purchaseRef: order.purchaseRef, paymentId: settlement.paymentId || order.paymentId, settlementId: settlement.settlementId, amountPaise: order.amountPaise, netPaise: settlement.netPaise, utr: settlement.utr });
      }
    }
    const computedNet = settlement.feePaise !== null && settlement.taxPaise !== null && settlement.refundPaise !== null ? settlement.grossPaise - settlement.feePaise - settlement.taxPaise - settlement.refundPaise : null;
    if (computedNet !== null && Math.abs(computedNet - settlement.netPaise) > 1) {
      findings.push(finding(`settlement-math-${settlement.sourceRow}`, "settlement_math", "medium", settlement.settlementId || settlement.paymentId, `Gross less fee, tax, and refund is ${money(computedNet)}, while the export reports ${money(settlement.netPaise)} net.`, [`Gross ${money(settlement.grossPaise)}`, `Fee ${money(settlement.feePaise!)}`, `Tax ${money(settlement.taxPaise!)}`, `Refund/offset ${money(settlement.refundPaise!)}`, `Reported net ${money(settlement.netPaise)}`, `Settlement row ${settlement.sourceRow}`], "Inspect the settlement line and any separate adjustment before accounting sign-off.", Math.abs(computedNet - settlement.netPaise)));
    }
  }

  for (const order of orders) {
    const matchedOrder = ordersWithPaymentRows.has(order);
    if (!matchedOrder) findings.push(finding(`missing-payment-${order.sourceRow}`, "missing_payment", "medium", order.purchaseRef, "No Razorpay settlement row matched this merchant order by payment ID or purchase reference.", [`Merchant order row ${order.sourceRow}`, `Expected gross ${money(order.amountPaise)}`, order.paymentId ? `Expected payment ${order.paymentId}` : "Merchant payment ID not supplied"], "Check whether payment is still pending, outside the export date range, or absent; confirm in the provider dashboard.", order.amountPaise));
  }

  const settlementsByKey = new Map<string, SettlementRow[]>();
  for (const row of settlements) {
    const key = row.utr ? `utr:${row.utr}` : row.settlementId ? `setl:${row.settlementId}` : `row:${row.sourceRow}`;
    const group = settlementsByKey.get(key);
    if (group) group.push(row);
    else settlementsByKey.set(key, [row]);
  }
  const usedBankRows = new Set<number>();
  const bankRowsByUtr = new Map<string, BankRow[]>();
  for (const entry of bank) if (entry.utr) {
    const group = bankRowsByUtr.get(entry.utr);
    if (group) group.push(entry);
    else bankRowsByUtr.set(entry.utr, [entry]);
  }
  let reconciledSettlementCount = 0;
  for (const [key, rows] of settlementsByKey) {
    const utr = rows.find(row => row.utr)?.utr || "";
    const settlementId = rows.find(row => row.settlementId)?.settlementId || key.replace(/^(utr:|setl:)/, "");
    const expectedNet = rows.reduce((sum, row) => sum + row.netPaise, 0);
    const candidates = utr ? bankRowsByUtr.get(utr) || [] : [];
    if (rows.some(row => unsafeSettlementRows.has(row.sourceRow))) {
      candidates.forEach(row => usedBankRows.add(row.sourceRow));
      continue;
    }
    if (candidates.length > 1) {
      candidates.forEach(row => usedBankRows.add(row.sourceRow));
      findings.push(finding(`bank-ambiguous-${settlementId}`, "amount_variance", "high", settlementId, `Multiple bank rows use UTR ${utr}; the settlement cannot be safely reconciled automatically.`, [`Settlement rows ${rows.map(row => row.sourceRow).join(", ")}`, ...candidates.map(row => `Bank row ${row.sourceRow}: ${money(row.amountPaise)}`)], "Review duplicate UTR entries and confirm which bank credit, if any, corresponds to this settlement.", expectedNet));
      continue;
    }
    const bankMatch = candidates[0];
    if (!bankMatch) {
      findings.push(finding(`bank-missing-${settlementId}`, "missing_bank_credit", "medium", settlementId, `Settlement net of ${money(expectedNet)} has no exact UTR match in the uploaded bank statement.`, [`Settlement ${settlementId}`, utr ? `Expected UTR ${utr}` : "Settlement export has no UTR", `Expected credit ${money(expectedNet)}`], "Check the bank statement date range and settlement timing. Escalate only if the credit is overdue.", expectedNet));
      continue;
    }
    usedBankRows.add(bankMatch.sourceRow);
    if (bankMatch.amountPaise === expectedNet) reconciledSettlementCount++;
    else findings.push(finding(`bank-variance-${settlementId}`, "amount_variance", "high", settlementId, `Bank credit ${money(bankMatch.amountPaise)} differs from settlement net ${money(expectedNet)}.`, [`Settlement ${settlementId}`, `UTR ${utr}`, `Settlement export rows ${rows.map(row => row.sourceRow).join(", ")}`, `Bank statement row ${bankMatch.sourceRow}`], "Review the difference and any separate bank charge/adjustment; do not auto-post the variance.", Math.abs(bankMatch.amountPaise - expectedNet)));
  }
  for (const row of bank) if (!usedBankRows.has(row.sourceRow)) findings.push(finding(`bank-unmatched-${row.sourceRow}`, "bank_unmatched", "low", row.utr || row.description, "This bank credit did not match any settlement UTR in the uploaded export.", [`Bank statement row ${row.sourceRow}`, row.utr ? `UTR ${row.utr}` : "No UTR", `Credit ${money(row.amountPaise)}`, row.description || "No narration"], "Check for a settlement outside this export period or a non-Razorpay credit; confirm before assigning it.", row.amountPaise));

  const steps: AgentStep[] = [
    { id: "ingest", title: "Ingest three source ledgers", tool: "load_source_files", detail: `Read ${orders.length} merchant orders, ${settlements.length} Razorpay settlement lines, and ${bank.length} bank credits.`, count: orders.length + settlements.length + bank.length, status: "complete" },
    { id: "normalize", title: "Normalize and validate records", tool: "normalize_currency_and_keys", detail: "Converted rupee amounts to integer paise; rejected invalid rows and ambiguous headers.", count: orders.length + settlements.length + bank.length, status: "complete" },
    { id: "match", title: "Match merchant orders to payments", tool: "match_payment_id_or_purchase_ref", detail: `Matched ${matched.length} order/payment pairs with exact payment ID or purchase reference. Never matched on amount alone.`, count: matched.length, status: "complete" },
    { id: "settle", title: "Reconcile settlement batches to bank", tool: "group_settlement_and_match_utr", detail: `Compared ${settlementsByKey.size} settlement groups with exact UTR and net-credit amounts.`, count: reconciledSettlementCount, status: "complete" },
    { id: "diagnose", title: "Diagnose exceptions with evidence", tool: "classify_variance_and_attach_rows", detail: `Classified ${findings.length} exceptions and attached source-row evidence plus a review action.`, count: findings.length, status: "complete" },
    { id: "prepare", title: "Prepare finance review package", tool: "draft_exception_worklist", detail: "Generated a review queue and export. No ledger entries, payments, refunds, or merchant messages were executed.", count: findings.length, status: "complete" },
  ];
  const report: ReconciliationReport = {
    generatedAt: new Date().toISOString(), mode: input.mode || "uploaded",
    sources: { orders: input.sourceNames?.orders || "merchant-orders.csv", settlements: input.sourceNames?.settlements || "razorpay-settlement.csv", bank: input.sourceNames?.bank || "bank-statement.csv" },
    summary: { orderCount: orders.length, gatewayPaymentCount: settlements.length, bankCreditCount: bank.length, matchedOrderCount: matched.length, reconciledSettlementCount, settlementCount: settlementsByKey.size, exceptionCount: findings.length, exceptionAmountPaise: findings.reduce((sum, item) => sum + item.amountPaise, 0) },
    steps, findings, matched,
  };
  if (input.mode === "sample") {
    const expectedCleanPairs = new Set(Array.from({ length: 60 }, (_, index) => index)
      .filter(index => index !== 12 && index !== 57)
      .map(index => `pay_demo_${String(index + 1).padStart(3, "0")}|ORD-${9001 + index}`));
    const actualKeys = matched.map(row => `${row.paymentId}|${row.purchaseRef}`);
    const truePositives = actualKeys.filter(key => expectedCleanPairs.has(key)).length;
    const falseMatches = actualKeys.length - truePositives;
    const expectedExceptionCounts = new Map<string, number>([["amount_variance", 1], ["settlement_math", 1], ["unmapped_gateway_payment", 1], ["missing_payment", 1], ["missing_bank_credit", 1], ["bank_unmatched", 1]]);
    const actualExceptionCounts = new Map<string, number>();
    for (const item of findings) actualExceptionCounts.set(item.category, (actualExceptionCounts.get(item.category) || 0) + 1);
    const correctExceptions = [...expectedExceptionCounts].reduce((sum, [category, expected]) => sum + Math.min(expected, actualExceptionCounts.get(category) || 0), 0);
    const falseExceptions = findings.length - correctExceptions;
    report.benchmark = {
      label: "Known-answer synthetic batch",
      sourceRecordCount: orders.length + settlements.length + bank.length,
      orderRecordCount: orders.length,
      expectedCleanMatchCount: expectedCleanPairs.size,
      actualCleanMatchCount: truePositives,
      falseMatchCount: falseMatches,
      expectedExceptionCount: 6,
      actualExceptionCount: findings.length,
      correctExceptionCount: correctExceptions,
      falseExceptionCount: falseExceptions,
      precisionPercent: actualKeys.length ? Math.round(truePositives / actualKeys.length * 1000) / 10 : 0,
      recallPercent: expectedCleanPairs.size ? Math.round(truePositives / expectedCleanPairs.size * 1000) / 10 : 0,
      exceptionPrecisionPercent: findings.length ? Math.round(correctExceptions / findings.length * 1000) / 10 : 0,
      exceptionRecallPercent: 100 * correctExceptions / 6,
    };
  }
  return report;
}

export function formatMoney(paise: number) { return money(paise); }
