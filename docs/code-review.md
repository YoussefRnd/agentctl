# Independent AI code review

The review panel offers a manual **Review changes** action for either uncommitted changes or
all session changes. The session provider/model is the default; users can independently choose
any enabled, installed ACP provider or profile, with an advertised/custom model or its default.
No provider names, native review commands, subagent support, structured-output extensions, or
model-specific SDKs are required. The standard ACP driver handles stable v1 and opt-in v2.

## Execution and ownership

`CodeReviewService` owns session lookup, provider readiness, immutable repository comparisons,
background work, persistence, cancellation, and interruption recovery. HTTP handlers only adapt
the typed contracts. Review starts return an operation ID immediately. The app owns each job
through cancellation/shutdown; an app restart marks leftover running reviews failed, preserving
earlier completed reviews. Deleting a session cascades its saved reviews/findings. Review history
uses cursor pagination with a timestamp/ID ordering, including when timestamps are equal.

The reviewer receives the session title/initial user intent, pinned diffs, surrounding changed
source, likely dependencies/callers and related test source. Project guidance is captured too. Repository text is supplied as untrusted data and cannot
change the review contract. The reviewer uses its own ACP driver/connection rather than the coding-session connection pool,
so cancellation cannot terminate another session. It starts a fresh session in an empty temporary directory,
with no MCP servers or additional workspace directories. App-mediated permission requests are
denied and elicitation is cancelled. This workflow never stages, commits, or applies a fix. ACP
cannot sandbox actions a provider executes internally; the temporary working directory and lack
of live workspace access in the prompt reduce accidental coupling without claiming an OS sandbox.

Only the supplied captured diff and source context are reviewed; this is not a full-repository
analysis. The AI does not execute tests; explicit local verification checks are described below. Binary/mode-only changes have limited context. Input beyond 100 changed files
or 60,000 serialized input characters (less for smaller advertised model windows) is refused instead of silently truncated. Output is bounded
and schema-validated; invented paths, invalid diff locations, interrupted/truncated responses,
and malformed JSON fail the run rather than reporting a clean result. Exact duplicate findings
are removed. Review has a three-minute deadline after provider preparation, independent of the
installation/preparation deadlines. Startup arriving after cancellation closes without prompting.
Provider failures are bounded and redacted before storage/display.

## Richer context (V2)

The optional repository `textSnapshot` port exposes bounded listing, text reads and reference
search over one immutable revision. Git reads scoped tree/blob objects with no working-file
reads, textconv filters, submodule recursion or symlink traversal. Other repository backends can
implement the same port; unsupported readers produce an explicit diff-only coverage report.
Nothing in retrieval depends on the ACP provider, model brand or provider-native tools.

Selection prioritizes changed code (including before-image context), direct relative imports,
matching test files, textual references and project `REVIEW.md`/`AGENTS.md`/`README.md`. Import/name
heuristics are not a compiler or complete call graph; references may be definitions or callers.
Selection excludes common credential files and generated/vendor trees. Normal changed-file diffs
remain in scope even when their supplementary source is excluded. Each source is a full file or
an explicitly labelled, line-anchored excerpt. Deleted source uses the before revision. Current
callers and tests come from the captured current revision, including untracked files.

Limits: at most 10,000 indexed paths, 100 search matches, 12 candidates per related category,
40 supplied source entries, 128 KiB per source read and a 15-second collection deadline. Git
listing/search buffers and subprocess timeouts are bounded independently. Candidate/source
quotas keep surrounding source from displacing the original diff. Model capacity hints lower
the input character budget; these are conservative sizing heuristics, not exact token counts.
There is no silent truncation of the original diff or automatic retry. Cancellation stops context
collection before provider launch; installation/readiness keeps its independent deadlines.

Each review saves the exact provided paths, before/current sides, roles, excerpt ranges and
completeness, plus omitted-candidate reasons, discovery limits and prompt size. It does not save
supplementary source text in the report. The collapsed **Context provided** disclosure makes
coverage and limitations available without expanding the compact result. This describes what
was supplied, not proof that the model understood or inspected every line. Missing test context
is explicit, and supplying test source never claims those tests passed. Findings still anchor
introduced defects to the original diff and can cite surrounding context in their explanation.

## Verification evidence (V3)

The collapsed **Verification** section runs a command only when the user types it and chooses
**Run check**. It works without a connected provider. `ReviewVerificationService` owns execution,
result storage, cancellation and recovery; the core runner owns the shell process group. Commands
run in the actual session workspace with installed tools and dependencies and the server process
user's permissions/environment. They can edit files or access the network; this is not an OS
sandbox. Provider profile environments are not supplied, and app transport secrets are removed.
Checks never auto-run from repository guidance, model responses or an AI-proposed command.

Each result saves the command/name, working directory, timeout, timestamps, exit code/signal,
status, expected revision, observed before/after revisions and bounded stdout/stderr. Output tails
are capped at 48,000 characters per stream and labelled when truncated. Commands, errors and
output use the existing credential/home redaction rules before saving; redaction is best effort,
so inspect output before sharing. Streaming persistence includes complete lines only, preventing
partial credentials split across chunks from reaching stored interim output. Logs load on demand;
check summaries use cursor pagination. Using an old command fills the input without executing it;
redacted commands require editing. A three-minute default timeout can be changed up to ten minutes.

Execution uses the session operation lane and a workspace reservation. It rejects active turns,
concurrent checks and an outdated comparison, then rechecks after waiting in the lane. Cancellation,
shutdown and timeouts retire the owned process group. Restart leftovers become interrupted while
retaining previously saved output. Before/after snapshots check both comparison revisions, including
untracked content. Changed or unavailable snapshots cannot supply reproduction evidence. These
observations cannot detect external changes that are reverted between captures, changes in ignored
files/dependencies, or external services: results establish only what ran against the observed source.

Every new finding is **Suspected**. To mark **Reproduced · confirmed by you**, the user must inspect
and select a completed failing check with a nonzero exit code, no terminating signal and matching
before/after snapshots, explain the link to that finding, and explicitly confirm it in the UI.
A failing suite alone proves no particular finding; timeouts, interrupted runs and changed snapshots
are ineligible. Passing checks neither reproduce nor dismiss a finding. Confirmation/reset events
are append-only in `review_finding_evidence`; findings can return to suspected without losing check
output. These assessments apply to the original review revision even when the review becomes
outdated. Manual fixed/dismissed status remains separate from verification state.

**Review again** supplies up to five eligible saved checks from the selected review only when both
comparison revisions still match. Passed and failed results are useful context; log excerpts are
bounded to 1,500 characters per stream and 10,000 serialized characters total, with truncation
explicit. The new review saves the exact evidence check IDs. Every ACP provider receives the same
ordinary text prompt containing app-recorded commands, exit results and excerpts. Logs are untrusted
data, provider-reported tool output is not accepted as execution proof, and model output cannot set
reproduction state. No optional ACP tools, native provider commands or brand-specific branches are
required. Review and check history remain separate; old summaries are not rewritten after a check.

Migration `0053_review_verification` adds `review_checks`, `review_finding_evidence` and nullable
`code_reviews.evidence_check_ids`. Existing reviews remain readable with suspected findings and no
execution evidence. Deleting a session cascades its reviews, checks and confirmation history.

## Persistence and freshness

`code_reviews` stores provider/model, scope, comparison revisions, status, summary, error and timing.
`code_review_findings` stores severity, path/line, title, supporting explanation, status and reason.
Both are SQLite tables introduced by migration `0051_code_reviews`. Migration `0052_review_context`
adds a nullable coverage report; legacy findings remain readable without one. Findings can be marked fixed,
dismissed with a required reason, or reopened. These are manual assessments; marking fixed does
not prove a fix. A new run never overwrites a previous run or its resolutions.

Runs bind to opaque repository `from` and `to` references, including unstaged and untracked files.
Uncommitted reviews compare the captured HEAD tree with the complete workspace tree; session
reviews compare the session baseline with that tree. Staging without content changes preserves
freshness. Committing identical contents makes an uncommitted comparison outdated, but preserves
a session review when its baseline is unchanged. Changes to either comparison revision mark the
review outdated, including edits made while the reviewer is working. Reverting to exactly the
same comparison makes it current again. An unavailable workspace yields unknown freshness,
while keeping findings available.

The UI keeps a compact status row above the changed files. Review options and history use separate,
keyboard-accessible popovers; long model summaries are collapsed by default. Open findings sort by
severity, while resolved findings stay in a disclosure. Dismissal reasons remain editable if saving
fails. Selecting an earlier review is explicit and includes a shortcut back to the latest result.

React Query owns review history. Workspace notifications, captured revision changes and window
focus refresh freshness; running jobs poll until completion. Findings retain their original
locations when outdated; path navigation opens the current diff rather than pretending that old
line numbers describe the new code. There is no automatic review, fix loop, merge approval, or
automatic check execution in this version.

## Acceptance

Regression tests cover baseline ACP v1/v2 SDK peers, providers with no optional features, profile
and model forwarding, bounded/malformed output, cancellation and late startup, SQLite reopen,
restart recovery, ownership and cascade deletion, paginated history, redacted errors, stale
comparisons after edits/staging/commits and UI finding resolution/error states. Existing Git
review and workspace query behavior must continue to pass. V3 tests cover actual shell exit/output,
timeouts/process cleanup, redaction and bounded output, explicit UI execution and confirmation,
revision mismatch rejection, saved result/confirmation history, restart interruption and the same
recorded evidence passing through real ACP v1/v2 SDK peers. Type checks, lint, ownership/dependency
checks and production builds cover the shared contracts through the desktop/web client.

## Inline findings and review continuity

New reviews save the exact reviewed file patches in SQLite. The finding panel loads these patches
on demand, shows old/new line numbers and highlights the finding's original line. More context
expands only a bounded part of its original hunk. These excerpts survive later edits, missing
workspaces and restart; opening the current diff is a separate navigation action. Legacy reviews
try their original immutable repository comparison and show an unavailable state when it cannot
be read. They never substitute current file contents for captured source.

The working diff renders open findings immediately after the matching line in unified and split
layouts. The saved review must be completed, server-current, in the displayed scope, and match
both displayed comparison revisions. Stale or unknown results remain readable in the saved panel
but cannot annotate unrelated live lines. Annotations participate in diff row virtualization and
use the same resolve, dismissal and evidence controls as the saved finding panel.

Each new review receives bounded earlier findings from the same session and scope, restricted to
paths in the current diff. Selection uses the ten most recent completed runs, at most twenty
findings and at most 10,000 serialized characters, reduced for smaller available prompt budgets.
The report records supplied IDs, omissions and the history-window limit. Earlier statuses,
reasons, last manual decisions and historical verification references are captured when the
review starts. Repository content and historical reasons remain untrusted data in the same
provider-neutral prompt. Providers need only standard ACP session and text capabilities.

The app links recurring findings by a location-independent fingerprint of path, normalized title
and nearby captured source. Ambiguous source matches cannot create an automatic link. A reviewer
may optionally return `previousFindingId` to associate a changed/reworded occurrence; the app
accepts it only from the supplied history on the same path and labels the association as the
reviewer's judgment. Providers that omit this optional field still get history context and
application fingerprint matching.

Every reported occurrence starts open and suspected. Earlier dismissals are never automatically
applied, previous reproduction is never promoted to current proof, and absence from a later review
never resolves an earlier finding. Earlier decisions/evidence remain visible with the version
qualification, including through subsequent linked occurrences. Explicitly reopening an occurrence
withdraws the last decision passed forward; its historical snapshot remains available. This is a
bounded aid to recurring findings, not semantic identity across arbitrary refactors or renames.

Migration `0054_review_continuity` adds captured patches/report data on reviews and source
fingerprints/history snapshots on findings. Full patches are excluded from the review-list query
and fetched through a session-scoped file endpoint. As with local coding transcripts, captured
patches may contain source or credentials present in the actual diff; they are stored exactly,
rather than modifying code text and making line evidence misleading.
