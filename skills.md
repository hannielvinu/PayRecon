# PayRecon Coding-Agent Handoff

This is the project-specific continuation guide for any coding agent working on this repository. Read this together with `README.md` before editing. The user has pivoted away from the former IntentLock retry-gating concept: **the product is now PayRecon**, an evidence-first payment settlement reconciliation agent. Do not revert to the old name or make recovery gating the main product.

The user wants the assistant to complete the project phase by phase without needing a new prompt after every phase, prefers fast progress, and expects a polished working local application rather than an abstract pitch.

## Immediate state

- Product now has a public PayRecon landing page, local profile-selection sign-in, and a reconciliation workspace with three CSV uploads, one-click sample run, ledger summary, six-step agent trace, evidence-backed exception queue, reviewer decisions with notes, and downloadable exception CSV.
- The interface now uses a Razorpay-inspired blue/white/neutral payments dashboard style with a custom PayRecon logo and SVG app icon. Landing, local profile-selection sign-in, role switching, sign-out, protected workspace entry, desktop layout, and 390px mobile layout were browser-verified. A review decision dialog requires an explicit outcome plus note; decisions and reopen events appear in activity history and current decisions are included in CSV export.
- Latest reconciliation report and exception decisions survive same-tab reload using `sessionStorage`; decisions include reviewer, outcome, note, and timestamp and appear in the activity log/export. Raw CSV files are not persisted. Report state is removed when signing out or clearing the current run. This is not durable history or access control.
- `POST /api/reconciliation` runs the deterministic end-to-end workflow.
- Sample dataset now contains 60 merchant orders, 60 gateway settlement/payment rows, and 12 bank rows (132 source records total), with 58 clean exact matches, 11 reconciled settlement groups, and 6 seeded exception cases. A known-answer synthetic benchmark is returned and shown in the UI; its 100% precision/recall is fixture correctness only, not merchant or live-data evidence.
- The previous IntentLock recovery API routes, domain/store modules, PostgreSQL files/dependencies, and old CSS were removed from active source. The ignored `.intentlock/store.json` user data has not been deleted; PayRecon does not read it.
- Verified on 2026-10-02: lint/build pass after the multi-route redesign; all six regression tests pass; landing, login, icon, and signed-out route guard work; profile selection/switch/sign-out work; sample run reports 132 rows and expected seeded cases; review decision and same-tab refresh persistence work; one uploaded batch with a bank debit reconciles against only its valid credit; exception CSV download includes review outcome, note, reviewer, and timestamp columns. Browser download confirmation was verified by inspecting the generated file. These checks do not establish production readiness or real-merchant accuracy.
- Current engine safeguards reject blank/malformed required amounts, preserve missing cost components as unknown (no false zero assumption), reject duplicate bank UTR matches as ambiguous, and prevent duplicate merchant purchase/payment identifiers from being used as unique matches. Bank parsing now requires clear credit semantics and excludes debit-only rows; grouping no longer repeatedly copies arrays and order-payment existence uses a set.
- The product is a deterministic orchestrated workflow, not an LLM or trained model. Do not present it as AI reasoning unless a real model integration is implemented, configured, and verifiable.

## First actions on a continuation

1. Read this file, `README.md`, and `AGENTS.md`. Preserve the Next.js-managed block in `AGENTS.md`.
2. Inspect `git status --short` and the current source. Preserve the user’s work and ignored local data.
3. Before editing Next.js, follow `AGENTS.md` and read the relevant installed guide under `node_modules/next/dist/docs/` (this repository uses Next.js 16).
4. Make a focused change that advances the next product phase. Do not stop to ask routine questions; ask only for a truly blocking business choice, unavailable credential/data, or explicit authorization.

## Product truth and positioning

PayRecon reconciles the merchant’s internal order/invoice ledger, a Razorpay settlement export, and the merchant bank statement. Razorpay already provides settlement reports and payment/settlement detail. PayRecon’s hypothesis is that operators still benefit from joining gateway output back to their own orders and bank credits, then seeing evidence-backed exceptions in one worklist. State this as a hypothesis to validate—not a proven universal pain or a claim that Razorpay reports are inadequate.

Do not overstate the current supported inputs: the workflow accepts canonical CSV formats and some header aliases. Direct ingestion of every live Razorpay export version is not yet validated. The sample rows are synthetic. No live integration, accounting posting, refund, payment, external communication, or durable run history exists.

## Critical invariants

- Never auto-match by amount, name, or date alone. Primary identity is exact payment ID or purchase reference; settlement/bank identity is exact UTR.
- Store/compare monetary values in integer paise internally. User-facing canonical CSV amounts are rupees. Be explicit when an input format uses a different unit.
- Settlement arithmetic is `gross − fee − tax − refund/offset = reported net`, with a one-paise tolerance in the current implementation. Do not silently absorb larger differences.
- Do not auto-correct conflicting IDs, fees, taxes, refunds, bank amounts, or ledger rows. Explain and cite source rows; leave decisions with a finance operator.
- Keep a distinction between payment-to-order identity matching and settlement-to-bank payout matching. One settlement can contain multiple payment lines; aggregate net lines before comparing to a bank credit.
- Watch for duplicate payment IDs, duplicate UTRs, duplicate export lines, multiple settlement groups sharing references, and bank duplicates. Never let `.find()` silently pick one when more than one candidate exists; report ambiguity.
- Missing bank credit may be a date-window/timing issue, not lost money. No loss, fraud, overdue status, or overcharge claim without evidence and dates/policy.
- Exception amount totals can double-count overlapping findings; label this clearly or change to a non-overlapping measure.
- PayRecon’s agent may automatically parse, match, calculate, classify, explain, and prepare an export; it must not post a journal, modify source systems, move funds, issue refunds, or contact people.
- Uploaded ledgers can contain sensitive finance/customer information. Current route processes in memory and does not persist the CSV, but it has no auth and is local-only. Do not expose it publicly or add external AI transmission without explicit scope and a privacy/data-flow design.
- Do not present sample outputs, findings, values, model probabilities, accuracy, time saved, or ROI as real evidence.

## Code map

- `src/app/page.tsx` — PayRecon landing page and entry points.
- `src/app/login/page.tsx` — local profile-selection sign-in.
- `src/app/reconciliation/page.tsx` — workspace, uploads, run control, report tabs, exception filtering and decisions, export, templates, help and session menus.
- `src/app/payrecon.css` — Razorpay-inspired blue/neutral dashboard styling and responsive behavior.
- `src/app/site.css` — landing/sign-in styling plus dashboard type and decision-history styling.
- `src/app/globals.css` — fonts and shared baseline.
- `src/app/layout.tsx` — PayRecon metadata and global style imports.
- `src/lib/reconciliation.ts` — demo fixtures, CSV parser, header aliases, normalization, exact ID matching, settlement arithmetic, UTR grouping, findings, workflow trace.
- `src/app/api/reconciliation/route.ts` — accepts sample or three uploaded CSVs, 2 MB per-source limit, invokes workflow, serializes output/errors.
- `README.md` — complete product brief, target architecture, schemas, setup, API, data/AI scope, limitations, roadmap.
- `AGENTS.md` — Next.js rules and pointer to this handoff.

## Next recommended work

Continue autonomously through the phases with concise progress updates; the user should not need to prompt after every phase. Prioritize completing a credible local product over adding speculative AI or live integration.

1. Expand regression coverage for duplicate IDs, CSV quoting/BOM, rounding tolerance, exception evidence, and upload API limits/errors. Existing tests cover the no-amount-only-match invariant, invalid currency, repeated UTR, grouped payouts, credit/debit filtering, ambiguous bank input, and the sample benchmark.
2. Actual three-file upload and reconciliation have been browser-verified with generated canonical CSVs (1/1 exact match and 1/1 settlement reconciled). Still verify malformed upload feedback, template download, and rerunning a different uploaded batch.
3. Landing, sign-in, role switcher, workspace route and key controls have been browser-checked at desktop/mobile widths; continue checking edge cases and keyboard/accessibility behavior.
4. Bank statement handling now excludes explicit debits and rejects ambiguous generic amount-only files. Validate more real-world credit/debit header conventions using redacted sample exports.
5. Keep direct Razorpay native export compatibility explicitly unverified until tested against redacted real examples or authoritative sample files. Add mappings only when their meaning is clear.
6. Add persistence only after choosing a safe retention model. Do not store full files by default; keep review actions and run provenance auditable if persistence is introduced.
7. Leave AI, live Razorpay APIs, accounting posting, and merchant communications out of scope until the deterministic product is reliable and data/privacy requirements are defined.
8. After meaningful changes, run lint/build and exercise sample plus uploaded input paths. Report what is verified versus still pending.

## Later phases

### Operator product completion

- Give useful empty/loading/error states and verify at laptop and mobile widths.
- Verify template downloads, actual CSV file uploads, error handling, exception filters, required review decision/note, decision log, report export, and rerunning a different batch.
- Consider a source mapping step if actual Razorpay/bank column formats vary. Never guess silently; show resolved mappings to the operator.
- Persist run IDs and review actions only after choosing a storage/retention model. Do not store full uploaded financial files by default.

### Optional AI assistance

The current chain is deterministic; that is deliberate for calculations and auditability. If a language model is added, it may summarize already-computed findings or prioritize a constrained set of safe review actions, but it must receive minimized evidence, return validated structured output, cite existing row/evidence IDs, and never supply calculations or create facts. Keep deterministic fallback if no key/network. Do not put keys in client code. Clearly disclose external data transfer and do not send real finance data without authorization.

### Integrations and pilot

Real Razorpay import, bank integrations, normalized persistence, authentication, multi-tenant access, and accounting exports are out of scope until requirements and credentials/data are available. A pilot needs merchant interviews, redacted samples, privacy/security review, shadow validation, explicit user approvals for any external action, rollback, and measurement. First establish exception precision and time saved; do not claim improved finance outcomes from the synthetic sample.

## Verification workflow

Commands:

```bash
npm run lint
npm test
npm run build
```

Exercise `POST /api/reconciliation` with `{ "sample": true }`; expected sample counts are documented above. Also upload generated template files with populated sample rows through the UI/API and verify report/export. If a check cannot run, report exactly why. A passing build does not prove matching correctness.

When reporting progress, distinguish implemented, verified, implemented-but-unverified, and future work. Preserve the new PayRecon scope, the honest market hypothesis, and the explicit no-auto-posting boundary.
