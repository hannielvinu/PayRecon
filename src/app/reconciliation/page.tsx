"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Finding, ReconciliationReport } from "@/lib/reconciliation";
import type { AiInvestigatorResult } from "@/lib/ai-investigator";
import { emptyFinanceFilters, localFinanceCommand, type FinanceFilters } from "@/lib/ai-command";

type SourceFiles = { orders: File | null; settlements: File | null; bank: File | null };
type ReviewDecision = { outcome: string; note: string; reviewer: string; timestamp: string };
type ReviewEvent = ReviewDecision & { findingId: string; reference: string; action: "decision" | "reopened" };
const formatMoney = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const severityLabel = (value: Finding["severity"]) => value === "high" ? "Needs review" : value === "medium" ? "Investigate" : "Informational";
function downloadFile(name: string, content: BlobPart, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.style.display = "none";
  document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Home() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [profile, setProfile] = useState({ name: "Aarav Mehta", role: "Finance operator", initials: "AM" });
  const [files, setFiles] = useState<SourceFiles>({ orders: null, settlements: null, bank: null });
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "exceptions" | "activity">("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, ReviewDecision>>({});
  const [reviewHistory, setReviewHistory] = useState<ReviewEvent[]>([]);
  const [reviewFindingId, setReviewFindingId] = useState<string | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [investigation, setInvestigation] = useState<AiInvestigatorResult | null>(null);
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [investigationError, setInvestigationError] = useState("");
  const [showInvestigationConsent, setShowInvestigationConsent] = useState(false);
  const [financeCommand, setFinanceCommand] = useState("");
  const [commandResult, setCommandResult] = useState("");
  const [commandError, setCommandError] = useState("");
  const [commandLoading, setCommandLoading] = useState(false);
  const [commandFilters, setCommandFilters] = useState<FinanceFilters>(emptyFinanceFilters);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const saved = sessionStorage.getItem("payrecon-session");
      if (!saved) { router.replace("/login"); return; }
      try { setProfile(JSON.parse(saved)); } catch { sessionStorage.removeItem("payrecon-session"); router.replace("/login"); return; }
      try {
        const savedReport = sessionStorage.getItem("payrecon-current-report");
        if (savedReport) setReport(JSON.parse(savedReport));
        const savedDecisions = sessionStorage.getItem("payrecon-review-decisions");
        if (savedDecisions) setReviewDecisions(JSON.parse(savedDecisions));
        const savedHistory = sessionStorage.getItem("payrecon-review-history");
        if (savedHistory) setReviewHistory(JSON.parse(savedHistory));
      } catch {
        sessionStorage.removeItem("payrecon-current-report");
        sessionStorage.removeItem("payrecon-review-decisions");
        sessionStorage.removeItem("payrecon-review-history");
      }
      setAuthorized(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [router]);

  async function runAgent(sample: boolean) {
    setRunning(true); setLoading(true); setError(""); setNotice("");
    try {
      const payload: Record<string, unknown> = sample ? { sample: true } : {
        ordersCsv: await files.orders!.text(), settlementsCsv: await files.settlements!.text(), bankCsv: await files.bank!.text(),
        sourceNames: { orders: files.orders!.name, settlements: files.settlements!.name, bank: files.bank!.name },
      };
      const response = await fetch("/api/reconciliation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Reconciliation failed.");
      const completed = result as ReconciliationReport;
      sessionStorage.setItem("payrecon-current-report", JSON.stringify(completed));
      sessionStorage.setItem("payrecon-review-decisions", "{}");
      sessionStorage.setItem("payrecon-review-history", "[]");
      setReviewDecisions({}); setReviewHistory([]);
      setInvestigation(null); setInvestigationError(""); setCommandResult(""); setFinanceCommand(""); setCommandFilters(emptyFinanceFilters);
      setReport(completed); setActiveTab("overview"); setNotice(`Agent run complete · ${completed.findings.length} review item${completed.findings.length === 1 ? "" : "s"} prepared.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run reconciliation.");
    } finally { setRunning(false); setLoading(false); }
  }

  function investigatorPayload() {
    if (!report) return [];
    return report.findings.map(item => {
      const related = report.matched.find(row => [row.purchaseRef, row.paymentId, row.settlementId, row.utr].includes(item.reference));
      const paymentId = item.paymentId || related?.paymentId || (item.category === "unmapped_gateway_payment" ? item.reference : "");
      const settlementId = item.settlementId || related?.settlementId || (["missing_bank_credit", "settlement_math"].includes(item.category) ? item.reference : "");
      return { category: item.category, severity: item.severity, reference: item.reference, explanation: item.explanation, evidence: item.evidence, amountPaise: item.amountPaise, paymentId, settlementId, purchaseRef: item.purchaseRef || related?.purchaseRef || (item.category === "missing_payment" ? item.reference : ""), utr: item.utr || related?.utr || "", settlementDate: item.settlementDate || related?.settlementDate || "", bankCreditDate: item.bankCreditDate || related?.bankCreditDate || "" };
    });
  }

  async function requestInvestigation() {
    if (!report) return;
    setInvestigationLoading(true); setInvestigationError("");
    try {
      const response = await fetch("/api/ai/investigate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ findings: investigatorPayload() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Exception investigation could not run.");
      setInvestigation(result.result as AiInvestigatorResult); setShowInvestigationConsent(false);
    } catch (cause) {
      setInvestigationError(cause instanceof Error ? cause.message : "Investigation failed. The deterministic report is unchanged.");
      setShowInvestigationConsent(false);
    } finally { setInvestigationLoading(false); }
  }

  async function runFinanceCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeCommand.trim()) return;
    setCommandLoading(true); setCommandError(""); setCommandResult("");
    try {
      const response = await fetch("/api/ai/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: financeCommand.trim() }) });
      const result = await response.json();
      let mapped;
      if (response.ok) mapped = { filters: result.filters as FinanceFilters, explanation: result.explanation as string };
      else if (response.status === 503) mapped = localFinanceCommand(financeCommand.trim());
      else throw new Error(result.error || "Could not translate the finance question.");
      setCommandFilters(mapped.filters);
      setSeverityFilter(mapped.filters.severity || "all");
      setCommandResult(mapped.explanation);
      if (mapped.filters.summaryMetric === "gateway_fee_deductions" && report) {
        const total = report.matched.reduce((sum, row) => sum + (row.feePaise || 0), 0);
        setCommandResult(`Deterministic total gateway fees across ${report.matched.length} exact matches: ${formatMoney(total)}.`);
      }
      if (mapped.filters.target === "exceptions") setActiveTab("exceptions");
      else setActiveTab("overview");
    } catch (cause) { setCommandError(cause instanceof Error ? cause.message : "Could not translate the finance question."); }
    finally { setCommandLoading(false); }
  }

  async function copyText(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied to clipboard.`); }
    catch { setNotice("Clipboard access was blocked by the browser. Select and copy the text manually."); }
  }

  const visibleFindings = useMemo(() => (report?.findings || []).filter(item =>
    (severityFilter === "all" || item.severity === severityFilter) &&
    (!commandFilters.category || item.category === commandFilters.category) && item.amountPaise >= commandFilters.minAmountPaise &&
    `${item.reference} ${item.explanation} ${item.suggestedAction} ${item.category}`.toLowerCase().includes(query.toLowerCase())
  ), [report, severityFilter, query, commandFilters]);
  const visibleMatches = useMemo(() => (report?.matched || []).filter(row => row.amountPaise >= commandFilters.minAmountPaise && row.netPaise >= commandFilters.minAmountPaise && (() => {
    if (!commandFilters.minDelayHours) return true;
    const settled = Date.parse(row.settlementDate), credited = Date.parse(row.bankCreditDate);
    return Number.isFinite(settled) && Number.isFinite(credited) && credited - settled >= commandFilters.minDelayHours * 3600000;
  })()), [report, commandFilters]);
  const reviewedCount = Object.keys(reviewDecisions).length;

  function exportReport() {
    if (!report) return;
    const rows = [["category", "severity", "reference", "explanation", "evidence", "suggested_action", "amount_rupees", "review_outcome", "review_note", "reviewer", "reviewed_at"], ...report.findings.map(item => { const decision = reviewDecisions[item.id]; return [item.category, item.severity, item.reference, item.explanation, item.evidence.join(" | "), item.suggestedAction, (item.amountPaise / 100).toFixed(2), decision?.outcome || "open", decision?.note || "", decision?.reviewer || "", decision?.timestamp || ""]; })];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    downloadFile(`payrecon-exceptions-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    setNotice("Exception worklist exported. Review items remain unchanged.");
  }

  function exportWorkpaper() {
    if (!report) return;
    const diagnostics = new Map((investigation?.cases || []).map(item => [item.caseKey, item]));
    const headings = ["row_type", "run_generated_at", "orders_source", "settlement_source", "bank_source", "purchase_ref", "payment_id", "settlement_id", "utr", "gross_rupees", "net_rupees", "settlement_date", "bank_credit_date", "category", "severity", "reference", "finding", "evidence", "suggested_action", "exception_value_rupees", "ai_cause_hypothesis", "support_ticket_subject", "support_ticket_body", "journal_status", "journal_debit_account", "journal_credit_account", "journal_amount_paise", "journal_memo", "review_outcome", "review_note", "reviewer", "reviewed_at"];
    const provenance = [report.generatedAt, report.sources.orders, report.sources.settlements, report.sources.bank];
    const matchedRows = report.matched.map(row => ["matched_ledger", ...provenance, row.purchaseRef, row.paymentId, row.settlementId, row.utr, (row.amountPaise / 100).toFixed(2), (row.netPaise / 100).toFixed(2), row.settlementDate, row.bankCreditDate, ...Array(headings.length - 13).fill("")]);
    const exceptionRows = report.findings.map((item, index) => {
      const ai = diagnostics.get(`F${String(index + 1).padStart(2, "0")}`);
      const decision = reviewDecisions[item.id];
      return [decision ? "reviewed_exception" : "open_exception", ...provenance, item.purchaseRef || "", item.paymentId || "", item.settlementId || "", item.utr || "", "", "", item.settlementDate || "", item.bankCreditDate || "", item.category, item.severity, item.reference, item.explanation, item.evidence.join(" | "), item.suggestedAction, (item.amountPaise / 100).toFixed(2), ai?.causeHypothesis || "", ai?.supportTicket.subject || "", ai?.supportTicket.body || "", ai?.journalEntry.status || "", ai?.journalEntry.debitAccount || "", ai?.journalEntry.creditAccount || "", ai?.journalEntry.amountPaise ?? "", ai?.journalEntry.memo || "", decision?.outcome || "open", decision?.note || "", decision?.reviewer || "", decision?.timestamp || ""];
    });
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [headings, ...matchedRows, ...exceptionRows].map(row => row.map(escape).join(",")).join("\r\n");
    downloadFile(`payrecon-auditor-workpaper-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    setNotice("Auditor workpaper exported with matched ledger rows, open exceptions, and available AI/reviewer notes.");
  }

  function downloadTemplates() {
    const templates: Array<[string, string]> = [
      ["merchant-orders-template.csv", "purchase_ref,payment_id,amount_rupees,created_at\n"],
      ["razorpay-settlement-template.csv", "payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,fee_rupees,tax_rupees,refund_rupees,net_amount_rupees,settled_at\n"],
      ["bank-statement-template.csv", "utr,description,credit_rupees,transaction_date\n"],
    ];
    for (const [name, content] of templates) {
      downloadFile(name, content);
    }
    setNotice("Downloaded CSV templates for all three source ledgers.");
  }

  function chooseFile(source: keyof SourceFiles) {
    document.getElementById(`${source}-upload`)?.click();
  }

  function clearRun() {
    sessionStorage.removeItem("payrecon-current-report");
    sessionStorage.removeItem("payrecon-review-decisions");
    sessionStorage.removeItem("payrecon-review-history");
    setFiles({ orders: null, settlements: null, bank: null });
    setReport(null); setReviewDecisions({}); setReviewHistory([]); setQuery(""); setSeverityFilter("all"); setCommandFilters(emptyFinanceFilters); setFinanceCommand(""); setCommandResult(""); setError(""); setNotice("Current run cleared. Upload new ledgers or load the sample data."); setActiveTab("overview"); setReviewFindingId(null);
    document.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(input => { input.value = ""; });
    setShowProfileMenu(false); setShowAccountMenu(false);
  }

  function saveReviewDecision() {
    if (!reviewFindingId || !reviewOutcome || !reviewNote.trim()) { setReviewError("Choose a decision and add a note so another reviewer can understand what you checked."); return; }
    const next = { ...reviewDecisions, [reviewFindingId]: { outcome: reviewOutcome, note: reviewNote.trim(), reviewer: profile.name, timestamp: new Date().toISOString() } };
    const finding = report?.findings.find(item => item.id === reviewFindingId);
    const event: ReviewEvent = { findingId: reviewFindingId, reference: finding?.reference || "Unreferenced", ...next[reviewFindingId], action: "decision" };
    setReviewDecisions(next);
    sessionStorage.setItem("payrecon-review-decisions", JSON.stringify(next));
    setReviewHistory(current => { const events = [...current, event]; sessionStorage.setItem("payrecon-review-history", JSON.stringify(events)); return events; });
    setReviewFindingId(null); setReviewOutcome(""); setReviewNote(""); setReviewError("");
  }

  function startReview(findingId: string) {
    setReviewFindingId(findingId); setReviewOutcome(""); setReviewNote(""); setReviewError("");
  }

  function reopenFinding(findingId: string) {
    const next = { ...reviewDecisions };
    const previous = next[findingId];
    const finding = report?.findings.find(item => item.id === findingId);
    delete next[findingId];
    setReviewDecisions(next);
    sessionStorage.setItem("payrecon-review-decisions", JSON.stringify(next));
    if (previous) {
      const event: ReviewEvent = { findingId, reference: finding?.reference || "Unreferenced", outcome: previous.outcome, note: "Decision reopened; finding returned to the review queue.", reviewer: profile.name, timestamp: new Date().toISOString(), action: "reopened" };
      setReviewHistory(current => { const events = [...current, event]; sessionStorage.setItem("payrecon-review-history", JSON.stringify(events)); return events; });
    }
  }

  function signOut() {
    sessionStorage.removeItem("payrecon-session");
    sessionStorage.removeItem("payrecon-current-report");
    sessionStorage.removeItem("payrecon-review-decisions");
    sessionStorage.removeItem("payrecon-review-history");
    router.replace("/login");
  }

  function switchProfile() {
    const next = profile.role === "Finance operator"
      ? { name: "Priya Nair", role: "Finance controller", initials: "PN" }
      : { name: "Aarav Mehta", role: "Finance operator", initials: "AM" };
    sessionStorage.setItem("payrecon-session", JSON.stringify(next));
    setProfile(next);
    setShowProfileMenu(false); setShowAccountMenu(false);
  }

  if (!authorized) return <main className="sessionLoading"><span className="loaderRing"/><b>Opening your local workspace…</b></main>;

  const reportDate = report ? new Date(report.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Preparing first run…";
  return <main className="reconApp">
    <aside className="reconSidebar">
      <div className="reconBrand"><svg className="reconBrandMark" viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="11" fill="#2b83ea"/><path d="M11 13h12a5 5 0 0 1 0 10H16v5h-5V13Zm5 5v1h7a.5.5 0 0 0 0-1h-7Z" fill="white"/><path d="M22 13h6v4h-6zM22 23h6v5h-6z" fill="#b8dcff"/></svg><span>PayRecon<small>PAYMENTS OPERATIONS</small></span></div>
      <div className="reconWorkspace"><span className="workspaceAvatar">M</span><span><b>Meadow &amp; Moss</b><small>Local workspace</small></span></div>
      <div className="reconNavLabel">WORKSPACE</div>
      <nav className="reconNav">
        <button className={activeTab === "overview" ? "selected" : ""} onClick={() => setActiveTab("overview")}><span>▦</span> Reconciliation</button>
        <button className={activeTab === "exceptions" ? "selected" : ""} onClick={() => setActiveTab("exceptions")}><span>⚑</span> Exceptions{report && <i>{report.findings.length - reviewedCount}</i>}</button>
        <button className={activeTab === "activity" ? "selected" : ""} onClick={() => setActiveTab("activity")}><span>◷</span> Agent activity</button>
      </nav>
      <div className="reconNavLabel sourcesLabel">SOURCE FILES</div>
      <button className="sourceNav" onClick={() => chooseFile("settlements")}><span className="sourceDot razor"/> Razorpay settlements <small>{files.settlements ? "Added" : "CSV"}</small></button>
      <button className="sourceNav" onClick={() => chooseFile("bank")}><span className="sourceDot bank"/> Bank statement <small>{files.bank ? "Added" : "CSV"}</small></button>
      <button className="sourceNav" onClick={() => chooseFile("orders")}><span className="sourceDot merchant"/> Merchant orders <small>{files.orders ? "Added" : "CSV"}</small></button>
      <div className="sidebarBottom"><div className="workspaceHealth"><span/> Local reconciliation ready</div><div className="profileMini"><span className="profileAvatar">{profile.initials}</span><span><b>{profile.role}</b><small>{profile.name}</small></span><div className="popoverWrap"><button aria-label="Account menu" aria-expanded={showAccountMenu} onClick={() => setShowAccountMenu(value => !value)}>···</button>{showAccountMenu && <div className="popover"><span className="popoverTitle">PROFILE &amp; SESSION</span><p>Signed in locally as {profile.name}. Imported rows stay in this browser session.</p><button onClick={switchProfile}>Switch profile · {profile.role === "Finance operator" ? "Controller" : "Operator"}</button><button onClick={clearRun}>Clear current run</button><button onClick={signOut}>Sign out</button></div>}</div></div></div>
    </aside>

    <section className="reconMain">
      <header className="reconTopbar"><div className="breadcrumbs">PayRecon <span>/</span> <b>Reconciliation</b></div><div className="topbarRight"><span className="testMode"><i/> LOCAL WORKSPACE</span><button className="helpButton" onClick={() => setShowHelp(true)}>How it works</button><div className="popoverWrap"><button className="topAvatar profileTrigger" aria-label={`Profile menu for ${profile.name}`} aria-expanded={showProfileMenu} onClick={() => setShowProfileMenu(value => !value)}>{profile.initials}</button>{showProfileMenu && <div className="popover topProfileMenu"><span className="popoverTitle">{profile.name}</span><p>{profile.role} · Meadow &amp; Moss</p><button onClick={switchProfile}>Switch profile · {profile.role === "Finance operator" ? "Controller" : "Operator"}</button><button onClick={signOut}>Sign out</button></div>}</div></div></header>
      <div className="reconContent">
        <div className="reconHeading"><div><div className="overline"><span/> PAYMENTS RECONCILIATION AGENT</div><h1>Settlement reconciliation</h1><p>Match your orders, Razorpay settlements, and bank credits. Let the agent surface only what needs your attention.</p></div><div className="headingActions"><button className="secondaryAction" onClick={() => void runAgent(true)} disabled={running}>↻ <span>Run sample</span></button><button className="primaryAction" onClick={() => void runAgent(false)} disabled={running || !files.orders || !files.settlements || !files.bank}><span>▶</span>{running ? "Agent running…" : "Run reconciliation"}</button></div></div>
        <div className="trustBanner"><span className="trustIcon">✦</span><div><b>Evidence first. Human approval for exceptions.</b><p>The agent matches by payment ID, purchase reference, and settlement UTR—never by amount alone. It prepares explanations and a worklist; it does not post journals, move money, or issue refunds.</p></div><span className="trustTag">AUDITABLE RUN</span></div>

        <section className="uploadSection"><div className="sectionTitle"><div><h2>Source files</h2><p>Upload the three ledgers for the same reporting window</p></div><button className="templateLink" onClick={downloadTemplates}>Download CSV templates ↓</button></div><div className="uploadGrid">
          <UploadCard id="orders-upload" label="Merchant order ledger" detail="Your internal orders / invoices" icon="M" file={files.orders} acceptFile={file => { setFiles(current => ({ ...current, orders: file })); setError(""); }} tone="merchant" />
          <UploadCard id="settlements-upload" label="Razorpay settlement export" detail="Settlement reconciliation report" icon="R" file={files.settlements} acceptFile={file => { setFiles(current => ({ ...current, settlements: file })); setError(""); }} tone="razor" />
          <UploadCard id="bank-upload" label="Bank statement" detail="Credits with UTR / reference" icon="B" file={files.bank} acceptFile={file => { setFiles(current => ({ ...current, bank: file })); setError(""); }} tone="bank" />
        </div></section>

        {error && <div className="errorBanner"><b>Could not complete reconciliation</b><span>{error}</span></div>}
        {notice && <div className="noticeBanner"><span>✓</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {report && <>
          <div className="runMeta"><span className="runStatus"><i/> {running ? "AGENT RUNNING" : "LAST RUN COMPLETE"}</span><span>{report.mode === "sample" ? "Sample data · synthetic" : "Uploaded files"}</span><span>Run time {reportDate}</span><button onClick={exportWorkpaper}>↓ Export auditor workpaper</button><button onClick={exportReport} disabled={!report.findings.length}>Export exceptions CSV</button></div>
          <div className="summaryGrid metricsStrip">
            <SummaryCard label="Transactions processed" value={String(report.summary.orderCount + report.summary.gatewayPaymentCount + report.summary.bankCreditCount)} sub="Source rows across three files" tone="blue" icon="▤" />
            <SummaryCard label="Deterministic auto-match" value={`${report.summary.orderCount ? (report.summary.matchedOrderCount / report.summary.orderCount * 100).toFixed(1) : "0.0"}%`} sub={`${report.summary.matchedOrderCount} of ${report.summary.orderCount} orders exact-linked`} tone="green" icon="↔" />
            <SummaryCard label="Flagged exceptions" value={String(report.findings.length)} sub={`${reviewedCount} reviewed · ${report.findings.length - reviewedCount} open`} tone="amber" icon="⚑" />
            <SummaryCard label="AI categorized" value={`${report.findings.length ? Math.round((investigation?.cases.length || 0) / report.findings.length * 100) : 100}%`} sub={investigation ? `${investigation.cases.length} findings investigated` : "Run Exception Investigator"} tone="violet" icon="✦" />
            <SummaryCard label="Flagged value exposure" value={formatMoney(report.summary.exceptionAmountPaise)} sub="Gross sum · findings may overlap" tone="violet" icon="₹" />
          </div>
          {report.findings.length > 0 && <section className="aiTriagePanel investigatorPanel"><div className="aiTriageHead"><div><span className="miniTag">OPTIONAL AI · HUMAN REVIEW REQUIRED</span><h2>Exception Investigator</h2><p>Generate cautious cause hypotheses, Razorpay support drafts, and balanced journal candidates. Nothing is sent or posted.</p></div><button className="secondaryAction" onClick={() => { setInvestigationError(""); setShowInvestigationConsent(true); }} disabled={investigationLoading || report.findings.length > 50}>{investigationLoading ? "Investigating…" : investigation ? "Investigate again" : "Investigate exceptions"}</button></div>{report.findings.length > 50 && <div className="aiTriageError">Investigation supports up to 50 findings per request. Narrow the reporting period and rerun.</div>}{investigationError && <div className="aiTriageError">{investigationError}</div>}{investigation && <div className="investigatorCases">{investigation.cases.map(result => { const index = Number(result.caseKey.slice(1)) - 1; const finding = report.findings[index]; return <article className="investigatorCase" key={result.caseKey}><div className="investigatorCaseHead"><b>{finding?.reference || result.caseKey} · {finding?.category.replaceAll("_", " ")}</b><span>CAUSE HYPOTHESIS · VERIFY BEFORE USE</span></div><p>{result.causeHypothesis}</p><details><summary>Razorpay support ticket draft</summary><b>{result.supportTicket.subject}</b><pre>{result.supportTicket.body}</pre><button className="subtleButton" onClick={() => void copyText(`${result.supportTicket.subject}\n\n${result.supportTicket.body}`, "Support ticket draft")}>Copy ticket</button></details><details><summary>Bookkeeping journal candidate · {result.journalEntry.status === "draft" ? "Unposted" : "Not recommended"}</summary>{result.journalEntry.status === "draft" ? <p>Dr {result.journalEntry.debitAccount} {formatMoney(result.journalEntry.amountPaise)} · Cr {result.journalEntry.creditAccount} {formatMoney(result.journalEntry.amountPaise)}<br/>{result.journalEntry.memo}</p> : <p>{result.journalEntry.memo}</p>}<small>Draft only. Confirm accounting policy and source documents before posting.</small>{result.journalEntry.status === "draft" && <button className="subtleButton" onClick={() => void copyText(`Dr ${result.journalEntry.debitAccount} ${formatMoney(result.journalEntry.amountPaise)}\nCr ${result.journalEntry.creditAccount} ${formatMoney(result.journalEntry.amountPaise)}\n${result.journalEntry.memo}`, "Journal draft")}>Copy journal draft</button>}</details></article>; })}</div>}<div className="aiTriageDisclosure">Disclosure: when you request an investigation, Google Gemini receives exception categories, severity, finding text/evidence, amount in paise, available payment/order/settlement/UTR identifiers, and related settlement/bank dates. Uploaded CSV files and unrelated rows are excluded. Drafts are advisory and locally validated; they cannot alter matches, calculations, or take actions.</div></section>}
          {report.benchmark && <section className="benchmarkPanel"><div className="benchmarkHeading"><div><span className="miniTag">SYNTHETIC KNOWN-ANSWER BATCH</span><h2>Batch evaluation</h2><p>{report.benchmark.sourceRecordCount} source records · {report.benchmark.orderRecordCount} merchant orders · {report.benchmark.expectedExceptionCount} seeded exception cases</p></div><span className="benchmarkDisclosure">Generated test data · not merchant outcome evidence</span></div><div className="benchmarkMetrics"><div><small>Clean-match precision</small><b>{report.benchmark.precisionPercent}%</b><span>{report.benchmark.actualCleanMatchCount} correct · {report.benchmark.falseMatchCount} false matches</span></div><div><small>Clean-match recall</small><b>{report.benchmark.recallPercent}%</b><span>{report.benchmark.actualCleanMatchCount} / {report.benchmark.expectedCleanMatchCount} expected pairs</span></div><div><small>Known exceptions found</small><b>{report.benchmark.exceptionRecallPercent}%</b><span>{report.benchmark.correctExceptionCount} / {report.benchmark.expectedExceptionCount} seeded categories · {report.benchmark.falseExceptionCount} extra findings</span></div></div></section>}

          <div className="reconTabs"><button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>Overview</button><button className={activeTab === "exceptions" ? "active" : ""} onClick={() => setActiveTab("exceptions")}>Exception worklist <span>{report.findings.length - reviewedCount}</span></button><button className={activeTab === "activity" ? "active" : ""} onClick={() => setActiveTab("activity")}>Agent activity</button></div>

          <section className="financeCommand"><form onSubmit={runFinanceCommand}><span aria-hidden="true">⌕</span><input aria-label="Ask a finance question" value={financeCommand} onChange={event => setFinanceCommand(event.target.value)} placeholder='Ask: “Which settlements were delayed over 48 hours?”'/><button className="primaryAction" disabled={commandLoading || !financeCommand.trim()}>{commandLoading ? "Translating…" : "Ask finance agent"}</button></form><div className="commandExamples"><span>Try:</span><button onClick={() => setFinanceCommand("Which bank settlements were delayed by more than 48 hours?")}>Delayed &gt;48h</button><button onClick={() => setFinanceCommand("Filter unmapped gateway payments above ₹2,000")}>Unmapped &gt;₹2,000</button><button onClick={() => setFinanceCommand("Summarize total gateway fee deductions")}>Gateway fee total</button><small>Query text may be sent to Gemini for translation. Without a key, supported questions use local rules.</small></div>{commandError && <div className="aiTriageError">{commandError}</div>}{commandResult && <div className="commandResult">{commandResult} <button onClick={() => { setCommandFilters(emptyFinanceFilters); setCommandResult(""); setSeverityFilter("all"); }}>Clear filters</button></div>}</section>

          {activeTab === "overview" && <div className="overviewGrid">
            <section className="panel ledgerPanel"><div className="panelHeader"><div><h2>Ledger bridge</h2><p>How source records connect in this run</p></div><span className="miniTag">3 SOURCES</span></div><div className="ledgerFlow"><LedgerBlock label="Merchant orders" count={report.summary.orderCount} foot="purchase references" tone="merchant"/><span className="flowArrow">→</span><LedgerBlock label="Razorpay lines" count={report.summary.gatewayPaymentCount} foot="payment IDs" tone="razor"/><span className="flowArrow">→</span><LedgerBlock label="Bank credits" count={report.summary.bankCreditCount} foot="UTR references" tone="bank"/></div><div className="matchRule"><span>✓</span><div><b>Match policy</b><small>Exact IDs first · one-paise tolerance for arithmetic rounding · no amount-only auto-match</small></div></div><div className="ledgerFoot"><span>{report.summary.matchedOrderCount} order/payment pairs linked</span><span>{report.summary.reconciledSettlementCount} settlement/bank groups reconciled</span></div></section>
            <section className="panel agentPanel"><div className="panelHeader"><div><h2>Agent run</h2><p>{running ? "Processing the selected ledgers…" : "Completed with traceable steps"}</p></div><span className="agentBadge">{running ? "RUNNING" : "COMPLETE"}</span></div>{running ? <div className="runLoadingInline"><span className="loaderRing"/><div><b>Reconciliation in progress</b><small>The current report remains visible until the new run completes.</small></div></div> : <div className="agentSteps">{report.steps.map(step => <div className="agentStep" key={step.id}><span className="stepMark">✓</span><div><b>{step.title}</b><small>{step.detail}</small></div><code>{step.tool}</code></div>)}</div>}<div className="agentFoot"><span>Deterministic matching engine</span><span>HUMAN APPROVAL REQUIRED</span></div></section>
          </div>}

          {activeTab === "exceptions" && <section className="panel exceptionPanel"><div className="panelHeader exceptionHeader"><div><h2>Exception worklist</h2><p>Each finding includes source-row evidence and a suggested next step</p></div><div className="tableFilters"><input aria-label="Search exceptions" placeholder="Search reference or reason" value={query} onChange={event => setQuery(event.target.value)}/><select aria-label="Filter by severity" value={severityFilter} onChange={event => setSeverityFilter(event.target.value)}><option value="all">All severity</option><option value="high">Needs review</option><option value="medium">Investigate</option><option value="low">Informational</option></select></div></div><div className="exceptionTableWrap"><table className="exceptionTable"><thead><tr><th>SEVERITY</th><th>REFERENCE</th><th>FINDING &amp; EVIDENCE</th><th>VALUE</th><th>REVIEW</th></tr></thead><tbody>{visibleFindings.map(item => <FindingRow key={item.id} item={item} decision={reviewDecisions[item.id]} onReview={() => startReview(item.id)} onReopen={() => reopenFinding(item.id)}/>)}</tbody></table>{visibleFindings.length === 0 && <div className="emptyState">No exceptions match these filters.</div>}</div><div className="tableFooter"><span>Showing {visibleFindings.length} of {report.findings.length} findings · {reviewedCount} decisions retained for this browser session</span><button onClick={exportReport}>Export CSV ↗</button></div></section>}

          {activeTab === "activity" && <section className="panel activityPanel"><div className="panelHeader"><div><h2>Agent activity log</h2><p>Tool sequence and outcome for reconciliation run · {reportDate}</p></div><span className="miniTag">{report.steps.length} TOOL STEPS</span></div><div className="activityTimeline">{report.steps.map((step, index) => <div className="activityItem" key={step.id}><span className="activityIndex">0{index + 1}</span><div className="activityBody"><div className="activityTitle"><b>{step.title}</b><code>{step.tool}</code><span>COMPLETE</span></div><p>{step.detail}</p><small>{step.count.toLocaleString("en-IN")} records / items processed</small></div></div>)}</div><section className="decisionHistory"><div className="panelHeader"><div><h2>Reviewer decision history</h2><p>Human review record for this run</p></div><span className="miniTag">{reviewHistory.length} EVENTS</span></div>{reviewHistory.length ? [...reviewHistory].reverse().map((event, index) => <div className="decisionEvent" key={`${event.findingId}-${event.timestamp}-${index}`}><span className="decisionIcon">{event.action === "reopened" ? "↺" : "✓"}</span><div><b>{event.reference} · {event.action === "reopened" ? "Decision reopened" : outcomeLabel(event.outcome)}</b><p>{event.note}</p><small>{event.reviewer} · {new Date(event.timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div></div>) : <div className="decisionEmpty">No reviewer events recorded yet. Open the exception worklist to record a decision.</div>}</section><div className="activityDisclaimer">The current agent is an auditable deterministic workflow. A language model is not used to calculate balances or invent exception causes.</div></section>}

          {activeTab === "overview" && <section className="panel matchedPanel"><div className="panelHeader"><div><h2>Matched payment lines</h2><p>Exact purchase/payment ID matches · {visibleMatches.length} of {report.matched.length} rows</p></div><button className="subtleButton" onClick={exportWorkpaper}>Export auditor workpaper ↓</button></div><div className="exceptionTableWrap"><table className="matchedTable"><thead><tr><th>PURCHASE REF</th><th>PAYMENT ID</th><th>SETTLEMENT</th><th>GROSS AMOUNT</th><th>NET SETTLED</th><th>UTR</th><th>SETTLED</th><th>BANK CREDIT</th></tr></thead><tbody>{visibleMatches.map((row, index) => <tr key={`${row.purchaseRef}-${index}`}><td><b>{row.purchaseRef}</b></td><td>{row.paymentId || "—"}</td><td>{row.settlementId || "—"}</td><td>{formatMoney(row.amountPaise)}</td><td>{formatMoney(row.netPaise)}</td><td>{row.utr || <span className="mutedCell">Not provided</span>}</td><td>{row.settlementDate ? new Date(row.settlementDate).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—"}</td><td>{row.bankCreditDate ? new Date(row.bankCreditDate).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—"}</td></tr>)}</tbody></table>{visibleMatches.length === 0 && <div className="emptyState">No exact matches meet those filters. Questions about settlement delays require dates in both source exports.</div>}</div></section>}
        </>}
        {!report && loading && <div className="firstRun"><span className="loaderRing"/><b>Running reconciliation agent</b><p>Loading ledgers, matching payment IDs and UTRs, and preparing the exception worklist…</p></div>}
        {!report && !loading && activeTab === "overview" && <div className="firstRun emptyStart"><span className="firstRunIcon">↔</span><b>Start a reconciliation run</b><p>Load a sample to explore the workflow, or upload your three ledgers above and run reconciliation.</p><button className="primaryAction" onClick={() => void runAgent(true)}>Load sample data and run agent <span>→</span></button></div>}
        {!report && !loading && activeTab === "exceptions" && <EmptyTab title="No exception worklist yet" message="Run a reconciliation to generate findings that need review." action="Run sample" onAction={() => void runAgent(true)} />}
        {!report && !loading && activeTab === "activity" && <EmptyTab title="No agent activity yet" message="Your run steps and results will appear here after reconciliation." action="Run sample" onAction={() => void runAgent(true)} />}
        <footer className="reconFooter"><span>PayRecon · Reconciliation workspace</span><span>Sample figures are synthetic · Uploaded files are processed locally</span></footer>
      </div>
    </section>
    {showInvestigationConsent && report && <div className="dialogBackdrop" onMouseDown={event => { if (event.target === event.currentTarget && !investigationLoading) setShowInvestigationConsent(false); }}><section className="helpDialog aiConsentDialog" role="dialog" aria-modal="true" aria-labelledby="investigator-consent-title"><div className="dialogHeader"><div><span className="miniTag">EXTERNAL AI REQUEST</span><h2 id="investigator-consent-title">Review investigation data</h2><p>This request uses Gemini to draft hypotheses and review artifacts for the current exception list.</p></div><button className="dialogClose" aria-label="Close investigator disclosure" onClick={() => setShowInvestigationConsent(false)}>×</button></div><div className="aiConsentList"><p><b>Sent:</b> {report.findings.length} exception categories/severities, explanation and evidence, paise values, available payment/order/settlement/UTR identifiers, and related settlement/bank dates.</p><p><b>Excluded:</b> original CSVs, unrelated ledger rows, merchant profile/name, customer information, and bank narration.</p><p><b>Returned:</b> cause hypotheses, exact-ID-citing support-ticket drafts, and candidate journal entries. The app validates IDs, allowed account labels, and journal amount against the finding; a human must verify before use.</p><p><b>Provider:</b> Google Gemini 3.8 Flash at low thinking level. The local server needs <code>GEMINI_API_KEY</code>. No ticket is sent and no journal is posted.</p></div><div className="aiConsentActions"><button className="secondaryAction" onClick={() => setShowInvestigationConsent(false)}>Cancel</button><button className="primaryAction" onClick={() => void requestInvestigation()} disabled={investigationLoading}>{investigationLoading ? "Investigating…" : `Send ${report.findings.length} exception summaries`}</button></div></section></div>}
    {reviewFindingId && report && <div className="dialogBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) setReviewFindingId(null); }}><section className="helpDialog reviewDialog" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="dialogHeader"><div><span className="miniTag">FINANCE REVIEW</span><h2 id="review-title">Record a decision</h2><p>This decision is attached to the finding and included in the session export.</p></div><button className="dialogClose" aria-label="Close review dialog" onClick={() => setReviewFindingId(null)}>×</button></div>{(() => { const item = report.findings.find(finding => finding.id === reviewFindingId); return item ? <div className="reviewEvidence"><b>{item.reference} · {item.category.replaceAll("_", " ")}</b><p>{item.explanation}</p><small>{item.evidence.join(" · ")}</small></div> : null; })()}<label className="fieldLabel" htmlFor="review-outcome">DECISION</label><select id="review-outcome" className="reviewSelect" value={reviewOutcome} onChange={event => { setReviewOutcome(event.target.value); setReviewError(""); }}><option value="" disabled>Select the outcome you verified</option><option value="resolved">Resolved after source verification</option><option value="timing">Accepted as a timing difference</option><option value="escalated">Escalated for follow-up</option><option value="not_an_issue">Confirmed as not an issue</option></select><label className="fieldLabel" htmlFor="review-note">REVIEW NOTE</label><textarea id="review-note" className="reviewTextarea" value={reviewNote} onChange={event => { setReviewNote(event.target.value); setReviewError(""); }} placeholder="Record what you checked and why this decision is appropriate…" rows={3}/>{reviewError && <div className="reviewError">{reviewError}</div>}<div className="reviewDialogActions"><button className="secondaryAction" onClick={() => setReviewFindingId(null)}>Cancel</button><button className="primaryAction" onClick={saveReviewDecision}>Save review decision</button></div></section></div>}
    {showHelp && <div className="dialogBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowHelp(false); }}><section className="helpDialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="dialogHeader"><div><h2 id="help-title">How reconciliation works</h2><p>PayRecon compares three files and prepares an evidence-backed finance review queue.</p></div><button className="dialogClose" aria-label="Close help" onClick={() => setShowHelp(false)}>×</button></div><ol className="helpList"><li><span>1</span><div><b>Upload the three ledgers</b>Merchant orders, Razorpay settlement lines, and bank credits for the same reporting window.</div></li><li><span>2</span><div><b>Run deterministic matching</b>Order/payment rows match by exact IDs; payout groups match to bank entries by UTR. Amount alone is never used as identity.</div></li><li><span>3</span><div><b>Review exceptions and export</b>Each finding includes source-row evidence. PayRecon does not alter books or move funds.</div></li></ol><button className="primaryAction" onClick={() => setShowHelp(false)}>Got it</button></section></div>}
  </main>;
}

function UploadCard({ id, label, detail, icon, file, acceptFile, tone }: { id: string; label: string; detail: string; icon: string; file: File | null; acceptFile: (file: File | null) => void; tone: string }) {
  function removeFile() { const input = document.getElementById(id) as HTMLInputElement | null; if (input) input.value = ""; acceptFile(null); }
  return <div className={`uploadCard ${file ? "hasFile" : ""}`}><label className="uploadControl" htmlFor={id}><input id={id} type="file" accept=".csv,text/csv" onChange={event => acceptFile(event.target.files?.[0] || null)}/><span className={`uploadIcon ${tone}`}>{icon}</span><span className="uploadText"><b>{label}</b><small>{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : detail}</small></span><span className="uploadAction">{file ? "✓ Added" : "+ Add CSV"}</span></label>{file && <button className="fileClear" aria-label={`Remove ${label}`} onClick={removeFile}>×</button>}</div>;
}
function SummaryCard({ label, value, sub, tone, icon }: { label: string; value: string; sub: string; tone: string; icon: string }) { return <div className="summaryCard"><div className="summaryTop"><span>{label}</span><i className={tone}>{icon}</i></div><b className="summaryValue">{value}</b><small>{sub}</small></div>; }
function LedgerBlock({ label, count, foot, tone }: { label: string; count: number; foot: string; tone: string }) { return <div className="ledgerBlock"><span className={`ledgerIcon ${tone}`}>{tone === "merchant" ? "M" : tone === "razor" ? "R" : "B"}</span><b>{label}</b><strong>{count}</strong><small>{foot}</small></div>; }
function FindingRow({ item, decision, onReview, onReopen }: { item: Finding; decision?: ReviewDecision; onReview: () => void; onReopen: () => void }) {
  return <tr><td><span className={`severityPill ${item.severity}`}>{severityLabel(item.severity)}</span></td><td><b>{item.reference || "Unreferenced"}</b><small className="categoryLabel">{item.category.replaceAll("_", " ")}</small></td><td><div className="findingText"><span>{item.explanation}</span><small>{item.evidence.join(" · ")}</small><em>Suggested: {item.suggestedAction}</em>{decision && <div className="decisionInline"><b>{outcomeLabel(decision.outcome)}</b><span>{decision.note}</span><small>{decision.reviewer} · {new Date(decision.timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div>}</div></td><td>{formatMoney(item.amountPaise)}</td><td>{decision ? <button className="reviewButton isReviewed" onClick={onReopen}>Reopen</button> : <button className="reviewButton" onClick={onReview}>Review finding</button>}</td></tr>;
}
function outcomeLabel(outcome: string) { return ({ resolved: "Resolved after source verification", timing: "Accepted as a timing difference", escalated: "Escalated for follow-up", not_an_issue: "Confirmed as not an issue" } as Record<string, string>)[outcome] || outcome; }
function EmptyTab({ title, message, action, onAction }: { title: string; message: string; action: string; onAction: () => void }) { return <section className="panel firstRun emptyStart"><span className="firstRunIcon">↔</span><b>{title}</b><p>{message}</p><button className="primaryAction" onClick={onAction}>{action} <span>→</span></button></section>; }
