"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Finding, ReconciliationReport } from "@/lib/reconciliation";
import type { AiTriageResult, FindingCategory, FindingSeverity } from "@/lib/ai-triage";

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
  const [showAiConsent, setShowAiConsent] = useState(false);
  const [aiTriage, setAiTriage] = useState<AiTriageResult | null>(null);
  const [aiModel, setAiModel] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

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
      setAiTriage(null); setAiModel(""); setAiError(""); setShowAiConsent(false);
      setReport(completed); setActiveTab("overview"); setNotice(`Agent run complete · ${completed.findings.length} review item${completed.findings.length === 1 ? "" : "s"} prepared.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run reconciliation.");
    } finally { setRunning(false); setLoading(false); }
  }

  async function requestAiTriage() {
    if (!report) return;
    setAiLoading(true); setAiError("");
    try {
      const findings = report.findings.map(item => ({ category: item.category as FindingCategory, severity: item.severity as FindingSeverity }));
      const response = await fetch("/api/ai/triage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ findings }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "AI triage could not run.");
      setAiTriage(result.result as AiTriageResult); setAiModel(String(result.model || "Gemini")); setShowAiConsent(false);
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : "AI triage could not run. Your deterministic report is unchanged.");
      setShowAiConsent(false);
    } finally { setAiLoading(false); }
  }

  const visibleFindings = useMemo(() => (report?.findings || []).filter(item =>
    (severityFilter === "all" || item.severity === severityFilter) &&
    `${item.reference} ${item.explanation} ${item.suggestedAction} ${item.category}`.toLowerCase().includes(query.toLowerCase())
  ), [report, severityFilter, query]);
  const reviewedCount = Object.keys(reviewDecisions).length;

  function exportReport() {
    if (!report) return;
    const rows = [["category", "severity", "reference", "explanation", "evidence", "suggested_action", "amount_rupees", "review_outcome", "review_note", "reviewer", "reviewed_at"], ...report.findings.map(item => { const decision = reviewDecisions[item.id]; return [item.category, item.severity, item.reference, item.explanation, item.evidence.join(" | "), item.suggestedAction, (item.amountPaise / 100).toFixed(2), decision?.outcome || "open", decision?.note || "", decision?.reviewer || "", decision?.timestamp || ""]; })];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    downloadFile(`payrecon-exceptions-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    setNotice("Exception worklist exported. Review items remain unchanged.");
  }

  function downloadTemplates() {
    const templates: Array<[string, string]> = [
      ["merchant-orders-template.csv", "purchase_ref,payment_id,amount_rupees,created_at\n"],
      ["razorpay-settlement-template.csv", "payment_id,purchase_ref,settlement_id,utr,gross_amount_rupees,fee_rupees,tax_rupees,refund_rupees,net_amount_rupees\n"],
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
    setReport(null); setReviewDecisions({}); setReviewHistory([]); setQuery(""); setSeverityFilter("all"); setError(""); setNotice("Current run cleared. Upload new ledgers or load the sample data."); setActiveTab("overview"); setReviewFindingId(null);
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
          <div className="runMeta"><span className="runStatus"><i/> {running ? "AGENT RUNNING" : "LAST RUN COMPLETE"}</span><span>{report.mode === "sample" ? "Sample data · synthetic" : "Uploaded files"}</span><span>Run time {reportDate}</span><button onClick={exportReport} disabled={!report.findings.length}>↓ Export exception worklist</button></div>
          <div className="summaryGrid">
            <SummaryCard label="Orders matched" value={`${report.summary.matchedOrderCount} / ${report.summary.orderCount}`} sub="Exact payment/reference matches" tone="blue" icon="↔" />
            <SummaryCard label="Settlements reconciled" value={`${report.summary.reconciledSettlementCount} / ${report.summary.settlementCount}`} sub="Matched to bank by UTR + amount" tone="green" icon="✓" />
            <SummaryCard label="Needs attention" value={String(report.findings.length - reviewedCount)} sub={`${reviewedCount} decisions recorded`} tone="amber" icon="⚑" />
            <SummaryCard label="Value in exception rows" value={formatMoney(report.summary.exceptionAmountPaise)} sub="May overlap across related findings" tone="violet" icon="₹" />
          </div>
          {report.findings.length > 0 && <section className="aiTriagePanel"><div className="aiTriageHead"><div><span className="miniTag">OPTIONAL AI ASSIST</span><h2>Exception triage</h2><p>Ask Gemini to prioritize the exception categories and suggest a safe verification queue.</p></div><button className="secondaryAction" onClick={() => { setAiError(""); setShowAiConsent(true); }} disabled={aiLoading || report.findings.length > 50} title={report.findings.length > 50 ? "AI triage supports up to 50 findings per run" : undefined}>{aiLoading ? "Gemini is reviewing…" : aiTriage ? "Run triage again" : "Prepare AI triage"}</button></div>{report.findings.length > 50 && <div className="aiTriageError">AI triage supports up to 50 findings per run. Narrow the reporting window and rerun reconciliation.</div>}{aiError && <div className="aiTriageError">{aiError}</div>}{aiTriage && <div className="aiTriageResult"><div className="aiSummary"><b>Batch readout · {aiModel}</b><p>{aiTriage.summary}</p><small>AI recommendation only · matching and amounts remain deterministic</small></div><div className="aiCases">{aiTriage.cases.map(item => { const finding = report.findings[Number(item.caseKey.slice(1)) - 1]; return <article className="aiCase" key={item.caseKey}><div><span>{item.caseKey}{finding ? ` · ${finding.category.replaceAll("_", " ")}` : ""}</span><b className={`priorityTag ${item.priority}`}>{item.priority}</b></div><p>{item.rationale}</p><small>Suggested check: {nextCheckLabel(item.nextCheck)}</small></article>; })}</div></div>}<div className="aiTriageDisclosure">Only opaque case labels, finding categories, and severity labels are sent to Google Gemini. Source rows, merchant/payment identifiers, amounts, and bank narration are excluded.</div></section>}
          {report.benchmark && <section className="benchmarkPanel"><div className="benchmarkHeading"><div><span className="miniTag">SYNTHETIC KNOWN-ANSWER BATCH</span><h2>Batch evaluation</h2><p>{report.benchmark.sourceRecordCount} source records · {report.benchmark.orderRecordCount} merchant orders · {report.benchmark.expectedExceptionCount} seeded exception cases</p></div><span className="benchmarkDisclosure">Generated test data · not merchant outcome evidence</span></div><div className="benchmarkMetrics"><div><small>Clean-match precision</small><b>{report.benchmark.precisionPercent}%</b><span>{report.benchmark.actualCleanMatchCount} correct · {report.benchmark.falseMatchCount} false matches</span></div><div><small>Clean-match recall</small><b>{report.benchmark.recallPercent}%</b><span>{report.benchmark.actualCleanMatchCount} / {report.benchmark.expectedCleanMatchCount} expected pairs</span></div><div><small>Known exceptions found</small><b>{report.benchmark.exceptionRecallPercent}%</b><span>{report.benchmark.correctExceptionCount} / {report.benchmark.expectedExceptionCount} seeded categories · {report.benchmark.falseExceptionCount} extra findings</span></div></div></section>}

          <div className="reconTabs"><button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>Overview</button><button className={activeTab === "exceptions" ? "active" : ""} onClick={() => setActiveTab("exceptions")}>Exception worklist <span>{report.findings.length - reviewedCount}</span></button><button className={activeTab === "activity" ? "active" : ""} onClick={() => setActiveTab("activity")}>Agent activity</button></div>

          {activeTab === "overview" && <div className="overviewGrid">
            <section className="panel ledgerPanel"><div className="panelHeader"><div><h2>Ledger bridge</h2><p>How source records connect in this run</p></div><span className="miniTag">3 SOURCES</span></div><div className="ledgerFlow"><LedgerBlock label="Merchant orders" count={report.summary.orderCount} foot="purchase references" tone="merchant"/><span className="flowArrow">→</span><LedgerBlock label="Razorpay lines" count={report.summary.gatewayPaymentCount} foot="payment IDs" tone="razor"/><span className="flowArrow">→</span><LedgerBlock label="Bank credits" count={report.summary.bankCreditCount} foot="UTR references" tone="bank"/></div><div className="matchRule"><span>✓</span><div><b>Match policy</b><small>Exact IDs first · one-paise tolerance for arithmetic rounding · no amount-only auto-match</small></div></div><div className="ledgerFoot"><span>{report.summary.matchedOrderCount} order/payment pairs linked</span><span>{report.summary.reconciledSettlementCount} settlement/bank groups reconciled</span></div></section>
            <section className="panel agentPanel"><div className="panelHeader"><div><h2>Agent run</h2><p>{running ? "Processing the selected ledgers…" : "Completed with traceable steps"}</p></div><span className="agentBadge">{running ? "RUNNING" : "COMPLETE"}</span></div>{running ? <div className="runLoadingInline"><span className="loaderRing"/><div><b>Reconciliation in progress</b><small>The current report remains visible until the new run completes.</small></div></div> : <div className="agentSteps">{report.steps.map(step => <div className="agentStep" key={step.id}><span className="stepMark">✓</span><div><b>{step.title}</b><small>{step.detail}</small></div><code>{step.tool}</code></div>)}</div>}<div className="agentFoot"><span>Deterministic matching engine</span><span>HUMAN APPROVAL REQUIRED</span></div></section>
          </div>}

          {activeTab === "exceptions" && <section className="panel exceptionPanel"><div className="panelHeader exceptionHeader"><div><h2>Exception worklist</h2><p>Each finding includes source-row evidence and a suggested next step</p></div><div className="tableFilters"><input aria-label="Search exceptions" placeholder="Search reference or reason" value={query} onChange={event => setQuery(event.target.value)}/><select aria-label="Filter by severity" value={severityFilter} onChange={event => setSeverityFilter(event.target.value)}><option value="all">All severity</option><option value="high">Needs review</option><option value="medium">Investigate</option><option value="low">Informational</option></select></div></div><div className="exceptionTableWrap"><table className="exceptionTable"><thead><tr><th>SEVERITY</th><th>REFERENCE</th><th>FINDING &amp; EVIDENCE</th><th>VALUE</th><th>REVIEW</th></tr></thead><tbody>{visibleFindings.map(item => <FindingRow key={item.id} item={item} decision={reviewDecisions[item.id]} onReview={() => startReview(item.id)} onReopen={() => reopenFinding(item.id)}/>)}</tbody></table>{visibleFindings.length === 0 && <div className="emptyState">No exceptions match these filters.</div>}</div><div className="tableFooter"><span>Showing {visibleFindings.length} of {report.findings.length} findings · {reviewedCount} decisions retained for this browser session</span><button onClick={exportReport}>Export CSV ↗</button></div></section>}

          {activeTab === "activity" && <section className="panel activityPanel"><div className="panelHeader"><div><h2>Agent activity log</h2><p>Tool sequence and outcome for reconciliation run · {reportDate}</p></div><span className="miniTag">{report.steps.length} TOOL STEPS</span></div><div className="activityTimeline">{report.steps.map((step, index) => <div className="activityItem" key={step.id}><span className="activityIndex">0{index + 1}</span><div className="activityBody"><div className="activityTitle"><b>{step.title}</b><code>{step.tool}</code><span>COMPLETE</span></div><p>{step.detail}</p><small>{step.count.toLocaleString("en-IN")} records / items processed</small></div></div>)}</div><section className="decisionHistory"><div className="panelHeader"><div><h2>Reviewer decision history</h2><p>Human review record for this run</p></div><span className="miniTag">{reviewHistory.length} EVENTS</span></div>{reviewHistory.length ? [...reviewHistory].reverse().map((event, index) => <div className="decisionEvent" key={`${event.findingId}-${event.timestamp}-${index}`}><span className="decisionIcon">{event.action === "reopened" ? "↺" : "✓"}</span><div><b>{event.reference} · {event.action === "reopened" ? "Decision reopened" : outcomeLabel(event.outcome)}</b><p>{event.note}</p><small>{event.reviewer} · {new Date(event.timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div></div>) : <div className="decisionEmpty">No reviewer events recorded yet. Open the exception worklist to record a decision.</div>}</section><div className="activityDisclaimer">The current agent is an auditable deterministic workflow. A language model is not used to calculate balances or invent exception causes.</div></section>}

          {activeTab === "overview" && <section className="panel matchedPanel"><div className="panelHeader"><div><h2>Matched payment lines</h2><p>Exact purchase/payment ID matches · {report.matched.length} rows</p></div><button className="subtleButton" onClick={exportReport}>Download exceptions CSV ↓</button></div><div className="exceptionTableWrap"><table className="matchedTable"><thead><tr><th>PURCHASE REF</th><th>PAYMENT ID</th><th>SETTLEMENT</th><th>GROSS AMOUNT</th><th>NET SETTLED</th><th>UTR</th></tr></thead><tbody>{report.matched.map((row, index) => <tr key={`${row.purchaseRef}-${index}`}><td><b>{row.purchaseRef}</b></td><td>{row.paymentId || "—"}</td><td>{row.settlementId || "—"}</td><td>{formatMoney(row.amountPaise)}</td><td>{formatMoney(row.netPaise)}</td><td>{row.utr || <span className="mutedCell">Not provided</span>}</td></tr>)}</tbody></table>{report.matched.length === 0 && <div className="emptyState">No exact order/payment matches were found.</div>}</div></section>}
        </>}
        {!report && loading && <div className="firstRun"><span className="loaderRing"/><b>Running reconciliation agent</b><p>Loading ledgers, matching payment IDs and UTRs, and preparing the exception worklist…</p></div>}
        {!report && !loading && activeTab === "overview" && <div className="firstRun emptyStart"><span className="firstRunIcon">↔</span><b>Start a reconciliation run</b><p>Load a sample to explore the workflow, or upload your three ledgers above and run reconciliation.</p><button className="primaryAction" onClick={() => void runAgent(true)}>Load sample data and run agent <span>→</span></button></div>}
        {!report && !loading && activeTab === "exceptions" && <EmptyTab title="No exception worklist yet" message="Run a reconciliation to generate findings that need review." action="Run sample" onAction={() => void runAgent(true)} />}
        {!report && !loading && activeTab === "activity" && <EmptyTab title="No agent activity yet" message="Your run steps and results will appear here after reconciliation." action="Run sample" onAction={() => void runAgent(true)} />}
        <footer className="reconFooter"><span>PayRecon · Reconciliation workspace</span><span>Sample figures are synthetic · Uploaded files are processed locally</span></footer>
      </div>
    </section>
    {showAiConsent && report && <div className="dialogBackdrop" onMouseDown={event => { if (event.target === event.currentTarget && !aiLoading) setShowAiConsent(false); }}><section className="helpDialog aiConsentDialog" role="dialog" aria-modal="true" aria-labelledby="ai-consent-title"><div className="dialogHeader"><div><span className="miniTag">EXTERNAL AI REQUEST</span><h2 id="ai-consent-title">Review what will be sent</h2><p>This optional request sends limited exception metadata to Google Gemini.</p></div><button className="dialogClose" aria-label="Close AI triage disclosure" onClick={() => setShowAiConsent(false)}>×</button></div><div className="aiConsentList"><p><b>Sent:</b> {report.findings.length} opaque case labels, finding categories, and severity levels.</p><p><b>Excluded:</b> uploaded files, row evidence, payment/order/UTR references, amounts, merchant names, and narration.</p><p><b>Used for:</b> a short queue summary, priority suggestions, and category-specific verification steps. Output is advisory and checked against this report.</p><p><b>Provider:</b> Google Gemini 3.8 Flash at low thinking level. The local server needs <code>GEMINI_API_KEY</code>.</p></div><div className="aiConsentActions"><button className="secondaryAction" onClick={() => setShowAiConsent(false)}>Cancel</button><button className="primaryAction" onClick={() => void requestAiTriage()} disabled={aiLoading}>{aiLoading ? "Sending labels…" : `Send ${report.findings.length} labels to Gemini`}</button></div></section></div>}
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
function nextCheckLabel(nextCheck: string) { return ({ review_payment_mapping: "Review payment/order reference mapping", inspect_settlement_math: "Inspect settlement fee, tax, and refund arithmetic", check_bank_window: "Check bank statement UTR and date window", verify_source_rows: "Verify the cited source rows", investigate_unmatched_record: "Investigate the unmatched bank or gateway record" } as Record<string, string>)[nextCheck] || "Verify source records"; }
function EmptyTab({ title, message, action, onAction }: { title: string; message: string; action: string; onAction: () => void }) { return <section className="panel firstRun emptyStart"><span className="firstRunIcon">↔</span><b>{title}</b><p>{message}</p><button className="primaryAction" onClick={onAction}>{action} <span>→</span></button></section>; }
