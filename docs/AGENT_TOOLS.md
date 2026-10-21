# Agent tools: the contract (step 4.1)

**Status: APPROVED by the owner on 16 October 2026, all ten recommendations of section 10 taken.** It was written before any code, and is changed only with the owner's approval (`WORK_PLAN.md`,
step 4.1). It describes the *application agent* (the assistant inside the web app, Gemini through the Worker), not the
development agents that work on the code.

**Amendment of 17 October 2026 (step 4.7, section 5.6):** the tool `prepare_import` and the rule that all imports go through the
inbox. The owner approved the principle (the agent recognises an import file, only prepares it, the user opens the wizard) and,
the same day, the form "one tool with `kind`" instead of four tools (section 10, question 11).

**Amendment of 17 October 2026 (step 4.6.1, question 12):** `remember_rule` is gone; a confirmed rule is written to `rules.md` by
the page at the user's click on a question card, and the rule is bound to one answer (`remember.option`). Fourteen tools.

**Amendment of 17 October 2026 (step 4.6.2, question 13):** a confirmed alias of a client. The question `choose_client` offers to
remember the buyer printed on its documents for the chosen client; the page keeps it in `clients/<client>/aliases.json`, and the
code accepts it as routing proof (`add_rows` `routed_by: "alias"`, `find_client` `match: "alias"`).

**Amendment of 17 October 2026 (step 5.1):** the rules of the work moved out of `web/agent/prompts.js` into `web/skills/<name>/SKILL.md`; see
section 2, "Skills". The tools, their count (14) and their contracts did not change.

What this document fixes: the run, the conventions every tool follows, the facts that extraction returns, and for each
tool its inputs, outputs, validation, effects and what it may never do. What it leaves to later steps: the Hebrew
wording of prompts and skills (phase 5), the panel layout (4.3), the exact model ids (phase 3).

## 1. Principles and how each one is enforced

The rules are those of `AGENTS.md`. A rule that only the prompt states is not a rule; each row names the mechanism and
the test that proves it (the tests are written in 4.2 and later and are part of those steps' "Done when").

| Rule | Mechanism in code | Test |
| --- | --- | --- |
| The agent changes data only through these tools | The loop dispatches only names of a closed registry. Tools do not import file stores: they receive a `services` object that exposes only the allowed operations | Registry snapshot (names); `services` keys snapshot; a scripted model calls an unknown tool |
| The agent never closes a month, never reopens, never deletes | No such tool and no such operation in `services` (no `finalizeDeclaration`, `reopenLockedDeclaration`, `deleteDeclaration`, `archiveDeclaration`; the only removal is the inbox original that `move_file_to_declaration` takes out after its copy in the declaration was read back and compared) | Scripted model asks for `close_month` / `delete_row`: refused, file tree unchanged. Static check: tool files import nothing from the declaration or workspace stores |
| The agent never changes OCR facts | Facts exist only as extraction output in the run's fact store. `add_rows` takes a **fact handle**, not values; the code copies the values. A change of a fact is only a `propose_change` that the user applies | Row values equal the extraction output byte for byte, whatever extra fields the model sends (the schema rejects unknown fields) |
| Amounts, VAT, duplicates, year, periods, ceilings, 25% are computed by code | `facts_for`, `add_rows` and `run_report` call `intake-facts.js`, `row-calculations.js`, `home-utilities.js`, `pcn-review.js`, `reports.js`; the model supplies only a decision, an account code, a reason | Existing unit tests of those modules; a test that no tool schema has a numeric money field the model may fill |
| A locked declaration is never written | The lowest layer (`services`) refuses any write to a declaration whose status is not `open`, whatever the tool says | Each write tool against a locked month: error `locked`, bytes unchanged |
| Existing rows change only by a click of the user | After a run, a change to a row that already exists is a `propose_change` card that the user applies | Scripted model calls `propose_change`: table unchanged until the apply handler runs |
| The table is copied before the agent writes | The first write of a run to a declaration first writes `draft-table.before-agent-<time>.json`; if the copy fails, the write is refused | Copy exists before the first row; copy failure blocks the write |
| An error of the agent leaves the rows editable | Rows are ordinary rows the moment they are written; a failed or cancelled run ends with a summary, no row stays "waiting" | Scripted model fails in the middle: rows written so far are editable and saved |
| `rules.md` gets only what the user confirmed | No tool writes it. The page appends the exact rule text of the card when the user ticks "זכור ללקוח" and clicks the answer the rule belongs to (`ask_user` `remember.option`); the user edits the file from the client card. Nothing in `web/agent/` imports a writer of the file (services only `readRules`) | Without the tick, or with another answer: nothing written; text in the file equals text on the card; static check of the imports |
| A document is not routed to a client on a guess | `add_rows` needs `routed_by`; the code verifies it (folder, VAT number match, a buyer the user once confirmed as this client and no other (alias, 4.6.2), or an answer of the user). Aliases are written only by the page after the user ticked the box of `choose_client`; nothing in `web/agent/` imports a writer of `aliases.json` | `_unsorted` file with a name-only match: refused until the user answers or confirms the buyer; an alias of two clients is no proof; static check of the imports |
| Import has no AI | The agent starts only after files are in `inbox/`; nothing here changes `inbox-store.js` add | Existing tests |
| Imports of journals, ledgers and income reports go through the inbox, and the agent never writes them (4.7) | `prepare_import` only parses (`prepareImport`, `prepareLedger`, `prepareReconcile`, `readIncomeReportFile`) and returns counts and check results; `services` has no operation that commits an import; the wizard opens only by the user's click on the card and keeps its own steps and its own copies before writing; the original leaves the inbox for `clients/<client>/imports/` only after the wizard wrote and the copy was read back | Tool files import no commit function (`commitImport`, `commitLedger`, `commitReconcile`); a scripted model that calls `prepare_import` leaves the file tree byte-equal; the card carries counts, no parsed rows reach the model |

## 2. The run

**Start.** The button "בדוק מסמכים חדשים", or a free request typed in the panel. One run handles one request. The code builds the
first message: today's date, the waiting files by folder (counts), the user's text if any.

**Roles.** Two model roles, both through the Worker (`POST /v1/model`, `web/model-client.js`):

- *Orchestrator*: text only, function calling. Decides the order, calls tools, writes the closing summary in Hebrew.
  Never sees pixels.
- *Extractor*: vision, one document per call, started by the code inside `extract_document` with a JSON response
  schema. Fallback "strong" model for a document the first read could not handle.

The ids are in `ALLOWED_MODELS` (`worker/src/model.js`); the defaults come from phase 3. Gemini 3 models need the
`thoughtSignature` of a function-call part sent back unchanged; the Worker already lets that field through.
**Not verified yet:** the exact multi-turn rules; step 4.2 checks them against the current Gemini function-calling
documentation and records the source in `HANDOFF.md`.

**Loop.** Send the conversation and the tool declarations; run the function calls the model returns (several in
parallel, at most 3 extractions at once); append the results; repeat until the model answers without a call or a limit
is reached. Tool failures go back to the model as results (section 3), they do not stop the loop.

**Limits** (constants in one file; starting values): 60 model turns, 400 tool calls, 200 extractions (2 per file),
15 questions, 30 minutes. When a limit is reached the run ends with the state "limit reached" and a summary; a new run
continues, because filed files have left the inbox and `add_rows` is idempotent. A request to the model above 20 MiB is
refused by the Worker, so the code shrinks images before sending (a phone photo can be bigger).

**Cancel.** A button sets an abort signal. In-flight model calls are aborted; a tool that is writing finishes that one
row or file (each write is atomic per row or file); then the loop stops and the summary says what was done.

**Errors.** A model call that fails with "busy" or "unavailable" is retried twice with a pause; then the run ends as
failed. Whatever was written stays and is editable. Two refusals by the model's safety filter end the run with a message.

**Run log.** The code writes `common/agent-runs/<runId>.json` in the data root: tool names, arguments, short results,
timings, model ids, and in its header the version of the instruction and of each skill (`agent.version`, `agent.skills`). No images, no document text beyond the fact fields. It is local only (the backup
copies it with the rest of the root). It is how a wrong row is explained and how a run is reproduced.

**Skills** (step 5.1). The rules of the work live in `web/skills/<name>/SKILL.md`, in the Agent Skills format: frontmatter with `name` (the
folder name: lowercase letters, digits, single hyphens), `description` and `metadata.version` (a positive integer), then the text. The list is
closed in `agent/skills.js` (a file that is not on it is never loaded). Today: `invoice-extraction` (the instruction of the vision call of
`extract_document`, and of nothing else), `classification` and `periods-and-duplicates` (the orchestrator). `pcn-allocation` and
`month-closing-checklist` are created when they get content (5.2, 6.2).

- *What the model is told.* The orchestrator's system instruction is the base prompt (`agent/prompts.js`: role, tools, routing proof to a
  client, imports, talking to the user, rules of a client) followed by the whole text of its skills. There is no `read_skill` tool: all
  skills go in whole, and the tool count stays 14. The rules of the client (`rules.md`) reach the model through `get_client_context`, not
  through the instruction.
- *Loading.* At the start of every run the page fetches each file from its own site (`skills/<name>/SKILL.md`, `cache: "no-cache"`, so a
  new deployment reaches the next run and Ctrl+F5 refreshes the page's own scripts). If any file cannot be fetched or does not parse, the
  run does not start: the result is `failed` with `code: "skills_unavailable"`, the dock shows an error naming the skill, no model is
  called and no run log is written. There is no running on part of the rules.
- *Versions.* Every row the agent writes stores `agent.skills` (name → version) next to `agent.version` (`AGENT_VERSION`, the version of the
  base prompt); the run log carries both in its header. A change of the text of a skill raises its `metadata.version`: `test/skills.test.mjs`
  keeps a hash of every file (`test/fixtures/skill-hashes.json`) and fails when the text changed and the version did not.
- *Tests.* The tests read the files from disk (`test/skills-fixture.mjs`). The test that held the prompts as they were before 5.1 was removed
  with 5.2, which changed the rules on purpose; since then a rule is checked by the eval (`npm run eval`, `web/eval/`), run before and after
  every change of a skill.
- *Agent Skills format outside the app.* The files can also be used by Claude Code or Codex for debugging. Note that `metadata.version` is an
  integer here, while the open specification describes metadata values as strings.

## 3. Conventions for every tool

- **Handles, not ids.** The model sees short run-local handles: files `F1`, facts `F1.1` (first document in file 1),
  rows `R1`, clients `C1`, questions `Q1`, proposals `P1`. The code keeps the map to real ids (SHA-256, `documentId`,
  `clientId`). An unknown handle is `not_found`. The model cannot invent a hash or a row. Handles never reach the user:
  in the final answer the code replaces every issued `C`, `F`, `F1.1` and `R` handle by the client name, the file name or
  "שורה N (MM/YYYY)" (`handles.readable`); `Q`, `P` and `I` have no name and stay as written.
- **Result envelope.** Success: `{ "ok": true, ... }`. Failure: `{ "ok": false, "error": { "code", "message" } }`.
  The message is English, for the model; text for the user is Hebrew and is produced by the code or written by the
  model into `reason` / `question`. Codes: `not_found`, `invalid_argument`, `locked`, `not_allowed`, `conflict`,
  `limit_reached`, `cancelled`, `unavailable`, `internal`; and, for `prepare_import` only, `wrong_format`. A tool never throws
  into the loop.
- **Validation.** Arguments are checked against the declared schema before anything runs: unknown fields refused, types,
  enums, lengths, list sizes.
- **Reason.** Every tool that writes or proposes takes `reason` (Hebrew, one sentence, 1 to 300 characters). It is shown
  to the user and stored in the row (`agentOpinion`) or the card.
- **Size.** A result is at most 20 KB of JSON. Lists take `limit` (default 50, maximum 200) and return `next` when more
  exist. Free text from documents (purpose, title, supplier name) is cut to 120 characters and stripped of control
  characters before it reaches the model.
- **Idempotent.** Calling a write tool again with the same fact or file changes nothing and says so
  (`already_added`, `already_filed`).
- **Language.** Everything the user reads is Hebrew. Tool names, argument names and error codes are English.

## 4. The fact record (what extraction returns)

One file can hold several documents (a multi-page PDF) and one invoice with several VAT groups is several records that
share the document number, as today. Field names follow ocr's Pass 1 where they exist. Classification, `include`,
opinion and highlight boxes of Pass 1 are **not** extraction output any more: classification belongs to the
orchestrator's decision, `include` to the code.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `expense_invoice`, `payment_confirmation`, `income_report`, `other` | As printed. An insurer's payment letter is `payment_confirmation` and may become an expense by decision |
| `page` | integer or null | 1-based page of a PDF, null for an image |
| `date` | `YYYY-MM-DD` or null | Israeli day/month/year read as such; today's date is given for two-digit years |
| `period_from`, `period_to` | `YYYY-MM-DD` or null | Insurance period, billing period. Never replaces `date` |
| `document_title` | text or null | As printed |
| `supplier_name`, `supplier_vat_id` | text, digits | Issuer. The id is digits only |
| `buyer_name`, `buyer_vat_id` | text, digits, or null | **New.** Needed to route `_unsorted` files (4.5) and to warn about a document addressed to someone else |
| `document_number` | text or null | The full printed number |
| `allocation_number` | digits or null | "מספר הקצאה" |
| `currency` | `ILS` or an ISO code | Anything but `ILS` adds the issue `foreign_currency` |
| `net`, `vat`, `total` | numbers | **Source** amounts as printed; the recognition percentages are applied later by code |
| `vat_percent` | number | Printed rate; 0 for an exempt group |
| `purpose` | text | What was bought, a few Hebrew words |
| `confidence` | 0 to 100 | Of the whole record |
| `issues` | list of codes | From the model: `blurred`, `date_unclear`, `amount_unclear`, `cropped`, `handwritten`, `other_language`. Added by code: `amounts_mismatch` (net + vat differs from total after rounding), `bad_vat_id` (`taxIdProblem`), `no_date`, `foreign_currency` |

After the model answers, the code validates the JSON against the schema, normalises dates (`dateKey`) and ids,
recomputes the amount check, and stores the record. From then on the record is **immutable** for the run.

## 5. The tools

Fourteen tools: seven that read, compute or extract, one that prepares an import and writes nothing (`prepare_import`, 5.6),
two that write (`add_rows`, `move_file_to_declaration`), two that ask the user (`propose_change`, `ask_user`; a rule the user
confirms on an `ask_user` card is written by the page, not by a tool), two for reports and closing. Headings below are the registry names; a test compares them with
the registry so that this file and the code cannot drift apart.

### 5.1 Read

#### `list_inbox`

- **Purpose.** What is waiting.
- **Input.** `{ folder?, kind?, status?, limit?, next? }`. `folder` is a client folder name or `_unsorted`; `kind` is
  `image`, `pdf`, `spreadsheet`; `status` is `waiting`, `extracted`, `filed` (state in this run).
- **Output.** `{ counts: { total, waiting, byFolder }, files: [{ file, name, folder, kind, size_kb, source_date,
  added_at, status, note? }], next? }`. A spreadsheet has a neutral `note` ("spreadsheet: not extracted; read it with
  `read_document`") and is never sent to the vision model; from 4.7 on the agent recognises it and, if it is an import file,
  prepares it with `prepare_import` (5.6). Before 4.7 the agent only says what it is (question 1, superseded by question 11).
- **Validation.** Enums only.
- **Effect.** Registers handles. Reads `inbox/index.json`.
- **Never.** List `_trash`; return file content.

#### `read_document`

- **Purpose.** Look at what a file is without the vision call: size, pages, and the text that exists in it.
- **Input.** `{ file, page?, max_chars? }` (`max_chars` default 6000, maximum 20000).
- **Output.** Image: `{ kind, width, height }`. PDF: `{ kind, pages, text? }` where `text` is the text layer of the page
  when there is one. CSV or workbook: sheet names and the first rows as text. `truncated` when cut.
- **Validation.** The file is in the inbox now; `page` within range.
- **Effect.** None. The text layer of a PDF is also handed to the extractor with the image (removes the
  dropped-first-digit class of errors that ocr saw). From 4.7 it is also how the agent recognises an import file: a
  workbook's sheet names and first rows, a PDF's text layer. The sample is bounded (`max_chars`, the first rows only);
  the full parse is done by code in `prepare_import`.
- **Never.** Return pixels: the orchestrator is text only; return more than the bounded sample of a file.

#### `find_client`

- **Purpose.** Which client a document is for.
- **Input.** `{ vat_id?, name? }`, at least one.
- **Output.** `{ matches: [{ client, name, vat_id, match }] }`, at most 5; `match` is `vat_id` (digits equal, leading
  zeros ignored), `alias` (4.6.2: a confirmed alias of the client proves the buyer given: by `vat_id` when one is given, otherwise
  by the exact normalised `name`), `name_exact` or `name_partial`. Only active clients inside the data root.
- **Effect.** None. Only `vat_id` and `alias` are evidence for routing; a name match must be confirmed by the user.
- **Never.** Create or edit a client.

#### `get_client_context`

- **Purpose.** What the agent needs to know about one client before deciding.
- **Input.** `{ client }`.
- **Output.** `{ client, name, activity, kind: "home"|"office", pcn_required, vat_id, vat_period, advances_period,
  locked_through, declarations: [{ month, status, rows }], chart: [{ code, name, type }], chart_source:
  "client"|"built-in", rules, rules_truncated }`. `chart` is the client's own chart when it has one, otherwise the
  built-in Form 6111 map plus the root-local custom codes; at most 400 accounts. `rules` is `rules.md` (at most 8 KB; the
  newest lines are kept if it is longer, and `rules_truncated` is set). `aliases: [{ vat_id, name }]` are the buyers confirmed as
  this client (4.6.2); `aliases_damaged` is set when `aliases.json` cannot be read (then it proves nothing).
- **Effect.** None.
- **Never.** Return the advance percent or other report settings; return another client's data.

#### `query_rows`

- **Purpose.** Answers to the user's questions about the table ("Levi's invoices without an allocation number").
- **Input.** `{ client, month?, where?: { text?, supplier?, date_from?, date_to?, has_allocation?, account?, flag? },
  limit?, next? }`. `flag` is one of `review`, `duplicate`, `excluded`, `agent`, `pcn_pending`.
- **Output.** `{ rows: [{ row, month, position, date, supplier, supplier_vat_id, document_number, allocation_number,
  net, vat, total, account, flags, status, agent_reason? }], next? }`. The open table is read as the user sees it,
  including edits not yet saved.
- **Effect.** Registers row handles.
- **Never.** Return images; page through more than 200 rows in one call.

#### `facts_for`

- **Purpose.** Everything the code knows about one fact in the context of one client. This is the only place where the
  rules of Anna are computed.
- **Input.** `{ fact, client, month? }`. Without `month` the code uses its own target month.
- **Output.** `{ target_month, doc_month, month_reason, month_state: "open"|"locked"|"missing", year: { status, basis,
  year, allowed_year }, duplicates: { level, matches: [{ level, month, status, row?, position }] }, deduction:
  "ok"|"check"|"late", exclude: null|"previous-year"|"duplicate", pcn: { applies, threshold, over, allocation_missing },
  home_utility, buyer_mismatch, amounts: { reconcile }, suggested_status: "ready"|"review", reasons: [code] }`.
  Duplicates are searched among the rows of every declaration from the document month on (locked months included),
  the open table, **and the rows added earlier in this run**.
- **Effect.** None. Pure computation.
- **Never.** Take a number from the model.

### 5.2 Extract

#### `extract_document`

- **Purpose.** Turn one file into fact records.
- **Input.** `{ file, hint?, model? }`. `hint` is the user's own words about the file (at most 200 characters, treated as
  data). `model` is `default` or `strong`.
- **Output.** `{ file, documents: [{ fact, page, ...record (section 4) }], note? }`. `documents: []` with a `note` when
  the file holds no financial document.
- **Validation.** The file is in the inbox. A file is extracted once per run; a second call returns the stored result.
  `strong` is allowed once per file and replaces the stored facts only if no row was made from them. Over the
  extraction limit: `limit_reached`.
- **Effect.** One model call per call (a PDF that would exceed the request limit is split by pages and merged). The
  system instruction is the `invoice-extraction` skill; temperature 0; JSON response schema with no free fields beyond
  those of section 4. Stores the records in the fact store.
- **Never.** Send any other file; classify; decide anything about the books; write to disk (except the run log).

### 5.3 Write (draft rows and files)

#### `add_rows`

- **Purpose.** Put documents into the monthly table as ordinary draft rows.
- **Input.** `{ client, rows: [{ fact, routed_by, routing_ask?, decision, account?, needs_review, reason,
  month_override?: { month, ask } }] }`, at most 40 rows per call.
  - `routed_by`: `folder` (the file sits in this client's inbox folder), `vat_id` (the fact's `buyer_vat_id` equals
    the client's VAT number), `alias` (4.6.2: the buyer of the fact is a confirmed alias of this client and of no other client;
    when the fact prints the buyer's VAT number only the number counts, otherwise the exact normalised name; a client's own VAT
    number counts as its alias for the "no other client" check), or `user` (`routing_ask` names an answered question, or the user's message of this run
    named the client).
  - `decision`: `expense`, `not_expense`, `unclear`. `account` only for an expense, a code from the chart.
  - `month_override`: only when the user asked for a month; `ask` names that answer.
- **Output.** Per row `{ fact, row, month, state: "created"|"already_added"|"moved_month"|"rejected", status:
  "ready"|"review", reasons, excluded: null|"duplicate"|"previous-year", account_rejected? , message? }`.
- **What the code does, in order.**
  1. Resolves the fact; refuses a row whose `routed_by` it cannot verify.
  2. Runs `intakeFacts` for the target month. A month inside the filed range moves to the first open month (existing
     rule); a missing declaration for a month after the last locked one is created open (question 2); a locked month is
     never written.
  3. Checks `account` against the chart; a code that is not in it is dropped, the row is added without a code and marked
     "needs a code".
  4. Makes the pre-run copy of that declaration (once per run and declaration).
  5. Builds the row through the existing row path: values copied from the fact, the recognition percentages by the
     business rule (utilities 25% by `home-utilities.js`), `autoExclude` from the facts (a duplicate or a previous-year
     document becomes an inactive row with its reason, as today), PCN review, `agentOpinion` = `reason`. Adds
     `agent: { run, skill_version, file, page, fact }`.
  6. Status **ready** only when the decision is `expense`, the code is valid, the model did not ask for a review, nothing
     in the facts warns (`amounts_mismatch`, `bad_vat_id`, `buyer_mismatch`, a possible duplicate, a deduction in
     doubt, `date_unclear`, `amount_unclear`) and `confidence` is at least 80 (starting value, tuned by the eval of
     5.3). Otherwise **review**, with the reasons. The model cannot make a row "ready" on its own.
  7. Saves: through the live table when the declaration is the one open in the page (so the user sees rows appear and
     the table's own autosave persists them), otherwise into `draft-table.json` with the same row format. Never both.
- **Never.** Accept an amount, date, name, number or id from the model; write to a locked declaration; overwrite or
  delete a row; set recognition percentages; include a row that the code excluded; create a client.

#### `move_file_to_declaration`

- **Purpose.** After rows exist, give them their original.
- **Input.** `{ file, client, months: [..] }` (usually one month).
- **Output.** `{ file, image_file, rows, inbox_removed }`.
- **Validation.** The declaration is open; at least one row from this file exists in each month (so no file is moved
  without a row); not already filed (`already_filed`).
- **Effect.** Copies the original into `declarations/<month>/images/` with the next sequence name (`NNN.<ext>`, as
  today), reads the copy back and compares the hash, sets `imageFile` on the rows, then drops the entry from the inbox
  index and removes the original from the inbox folder. A file that holds rows of several months is copied to each and
  removed after the last copy is verified. A PDF is stored as the original (how the viewer shows a page is 4.4).
- **Never.** Delete anything in a declaration; touch a locked month; move a file that has no row (it stays in the inbox
  with a note for the user).

### 5.4 Ask and propose (the user decides)

#### `propose_change`

- **Purpose.** Suggest a change to rows that already exist. Corrections of OCR facts and everything the user asks for
  in a free request go through here.
- **Input.** `{ client, title, changes: [{ row, field, value, reason }] }`, at most 50 changes. `field`: `date`,
  `supplier_name`, `supplier_vat_id`, `document_number`, `allocation_number`, `purpose`, `net`, `vat`, `total`,
  `account`, `vat_recognized_percent`, `expense_recognized_percent`, `include`, `month` (a move to another month).
- **Output.** `{ proposal, count }` at once; the loop continues without waiting.
- **Validation.** Rows known and in an open declaration; field in the list; the value has the type of the field; an
  account in the chart; a `month` that is open.
- **Effect.** A card in the panel with old value, new value and reason per change, and the buttons "החל הכל", "דחה" and
  a tick per change. **Applying is done by the page's own code when the user clicks**, through the same edit path as
  typing in the cell (recalculation, duplicate recheck, autosave), and is written to the run log. The model is told the
  outcome in the next run's context, not in this one.
- **Never.** Change anything by itself; touch a locked declaration; propose a deletion or a closing.

#### `ask_user`

- **Purpose.** A short question with buttons. (The plan called it `ask_anna`; the app is also used by the owner.)
- **Input.** `{ question, options: [{ id, label }], allow_other, about?: { files?, rows? }, remember?: { client, rule, option } }`.
  `question` up to 200 characters; 2 to 6 options, labels up to 40 characters; `rule` up to 200 characters; `option` is the id
  of the option the rule belongs to.
- **Output.** `{ ask, answer: { type: "option"|"other"|"dismissed", id?, text? }, remember, saved? }`. `remember` is true only
  if the card offered it, the user ticked the box and clicked the option of the rule; `saved` (only then) says whether the
  page wrote it.
- **Effect.** Shows a card (thumbnails of `about.files`, the rule text and a box "זכור ללקוח" when `remember` is given)
  and **waits** for the answer. A dismissed question returns `dismissed`; the agent must go on with the rows as
  `unclear`, never stall. The same question text twice returns the first answer. More than 15 questions: `limit_reached`.
- **Labels.** The button of an option that carries a `client` shows that client's name (the code sets it, whatever label the model gave); a label that is a handle (`C1`, `F2.1`) is refused.
- **Which client (`choose_client`, 17 October 2026, approved by the owner).** `{ question, choose_client: true, clients?: [client handles, at most 5], about: { files }, allow_other }`, no `options`. The code builds the card: the candidates as buttons with their names, every active client, the candidates too, in a list ("לקוח אחר…", sorted by name); the client open in the page is always the first button (service `clients.open`), and each button says why it is offered (open, or the best match `find_client` gave for it in this run: VAT number, same name, similar name), and for several files a button "לקוחות שונים" without a client. The answer carries `client`, the handle of the chosen client; the click is the routing proof of `add_rows` and `prepare_import` for every file of the question, as a button with a client always was. Without `choose_client`, `options` (2 to 6) stay required. A question about files whose text or buttons speak of the client ("לקוח", "client") but whose buttons carry no client is refused with a pointer to `choose_client`; buttons that only number ("לקוח א", "בחירה ב'", "option A") are refused anywhere.
- **Remember the buyer (`choose_client`, step 4.6.2, question 13).** When every file of the question was extracted and all its documents print one buyer (the same VAT number when either prints one, otherwise the same normalised name), and no client holds that buyer yet (by its own VAT number or an alias), the card has a box "לזכור: מסמכים שהקונה בהם «name» מס׳ N שייכים ללקוח שייבחר". When the user ticks it and chooses a client (a button or the list; not "לקוחות שונים", not "דלג"), **the page** adds `{ vatId, name }` to `clients/<client>/aliases.json` (`schemaVersion` 1; an alias already in force is not added twice; a damaged or newer file is never overwritten) and the card says so. The answer then has `alias_saved`. The user sees the aliases in the dialog "כללים של הלקוח" of the client card and removes one there (it stays in the file with `removedAt` and no longer counts).
- **Remember (step 4.6.1, replaces the tool `remember_rule`; question 12).** The rule is cleaned to one line (no control
  characters, single spaces) before the card shows it, and `option` must be one of the options; `remember` is refused with
  `choose_client` (the routing question gets its own, code-built remember in 4.6.2). The box reads "זכור ללקוח «name» (בתשובה
  «label»): rule". When the user ticks it and clicks that option, **the page** (not the tool, not the model) appends one line to
  `clients/<client>/rules.md` (created if missing): `- <rule> (<date>, אושר ע״י המשתמש)`; a rule already in the file, also one the
  user typed, is not added twice. The card then says "saved", "already there", "not saved: another answer was chosen" or the
  error. The file is read into every later run for this client (`get_client_context`), and the user views and edits it from the
  client card ("כללים של הלקוח"); that save keeps the text before in `rules.before-<time>.md`.
- **Never.** Ask for secrets; accept an answer outside the options except through `other`; write anything (the rule is written by
  the page at the user's click).

### 5.5 Reports and closing (phase 6)

#### `run_report`

- **Purpose.** Numbers for a question ("VAT for May and June").
- **Input.** `{ client, kind: "vat"|"advances"|"profitLoss"|"ledger", from, to }` (months).
- **Output.** The tables as computed by `reports.js` over the saved declarations, plus `view`: what the "open report"
  button of the card will open. The card shows the tables from this result; numbers in the model's prose are not
  trusted.
- **Never.** Compute a figure itself; save or print a report; change data.

#### `ready_to_close`

*Built 21 October 2026 (step 6.2); what differs from the text below: `summary` has no `duplicates_open` (a row
that is a possible duplicate is marked for review and counted in `review`) and has `inbox_unsorted`; a blocker and the warning
`rows_to_review` carry `positions` (the # column) instead of row handles; a locked month answers `state: "locked"`, `ready: false`.
The shared function is `lockProblems(rows, { pcnRequired })` in `web/lock-check.js`.*

- **Purpose.** Tell the user whether a month can be locked and what is in the way.
- **Input.** `{ client, month }`.
- **Output.** `{ ready, blockers: [{ code, count, rows? }], warnings: [{ code, count }], summary: { rows, active,
  excluded, review, pcn_pending, pcn_missing_allocation, duplicates_open, inbox_waiting } }`.
  `blockers` are exactly the refusals of the lock button, produced by one shared function that the button also calls
  (no active row; PCN rows not approved or without an allocation number). `warnings` are the rest: rows still marked
  "review", files for this client still in the inbox.
- **Effect.** None. The user locks the month with the existing button and its confirmation; the agent can only say
  "ready to close".
- **Never.** Lock, unlock or change anything.

### 5.6 Imports of spreadsheets and reports (step 4.7)

#### `prepare_import`

- **Purpose.** For an inbox file that the agent recognised as an import file (a Rivhit journal, a classification-codes
  ledger, an operations ledger, a periodic income report): parse it read-only, check it, and leave the user a card with a button that opens the
  existing wizard with that file. This is the replacement of the menu "ייבוא ובדיקות": every function of the menu is reached
  from the inbox through this tool. One tool with `kind`, not four (question 11).
- **Input.** `{ file, kind, client, routed_by, routing_ask?, month?, reason }`.
  - `kind`: `journal` (the Rivhit journal "יומן קליטה", `.xlsx`), `ledger_codes` (the classification-codes ledger
    "כרטסת קודי מיון", PDF or `.xlsx`), `ledger_check` (the operations ledger "כרטסת", for the check against the
    declarations), `income_report` (the periodic income report PDF "דיווח הכנסות תקופתי").
  - `client`: a client handle. `routed_by` as in `add_rows`: `folder` (the file lies in this client's inbox folder) or
    `user` (`routing_ask` names an answered question whose option carries this client). A name match alone is no proof. No
    `vat_id` or `alias` route: none of the four parsers reads the client's VAT number from the file (a parser that does would add it
    here, with the same code check as `add_rows`).
  - `month`: optional `YYYY-MM`, a suggestion for the wizard that the user can change there. The code compares it with
    the month or months the file itself holds; a difference is reported as a problem and the card shows the file's month.
    The model never overrides what the parser found.
  - `reason`: Hebrew, one sentence, shown on the card: why the agent thinks this is that kind of file.
- **Output.** `{ prepared, kind, client, month, summary, checks: [{ code, ok, count? }], problems: [{ code, count? }],
  wizard }`. `summary` holds counts only (journal: sheets, rows, months, new accounts; ledger_codes: accounts, types to
  confirm; ledger_check: operations, matched, unmatched; income_report: periods, rows to add). `checks` are the results of the
  validators and checksums that the existing preparers run. `problems` are things that make the wizard refuse or warn (target
  month locked, rows already imported, a month that differs from the suggestion). `wizard` names the dialog the button opens
  (`excel_import`, `ledger_codes`, `ledger_check`, `income_report`). Parsed rows, names and amounts are not in the result.
- **Errors.** `wrong_format` (new code, section 3) with the message of the parser (for example, "not a Rivhit journal"):
  the checks of the existing readers (file signature, sheet layout, header row, report title, checksums) rejected the file.
  `not_found` (unknown handle, or the file is not a spreadsheet or PDF), `not_allowed` (the client is not proven),
  `invalid_argument` (a kind that does not fit the file type, for example `journal` for a PDF).
- **Validation.** The file is in the inbox now; the kind fits the type of the file; the client is active and inside the data
  root. The same file with the same kind twice returns the stored result (`already_prepared`).
- **Effect.** Reads the file and calls the preparers that the wizards call first (`prepareImport`, `prepareLedger`,
  `prepareReconcile`, `readIncomeReportFile`): a read-only parse, nothing is written. Stores the prepared result in the run and
  shows a card with the summary, the checks and problems, the reason, and the button "פתח אשף". **The button belongs to the
  page**: a click opens the existing wizard dialog of that kind with the file preloaded; the wizard's own steps, its
  confirmations and its own copies before writing stay as they are. After the wizard has written successfully the page, not the
  agent, files the original: copy to `clients/<client>/imports/`, read back and compare the hash, then drop the inbox
  entry and remove the file (the order of `move_file_to_declaration`). If the wizard is closed, fails or writes nothing, the
  file stays in the inbox and the card stays.
- **Built so far (17 October 2026).** `kind: journal` (4.7.2) and `kind: ledger_codes` (4.7.3, PDF or `.xlsx`, `prepareLedger`: the
  summary has the number of codes, whether the client's own codes are replaced and how many imported rows get new codes; problems
  `replaces_own_chart`, `lines_skipped`, `rows_not_remapped`, `locked_months_not_remapped`; a file in which the reader of operations
  finds dated movements is `wrong_format` with a pointer to `ledger_check`; the button opens the ledger-codes dialog)
  and `kind: ledger_check` (4.7.4, the operations ledger, PDF or `.xlsx`, `prepareReconcile`: year, operations, matched, missing, how
  many can be added and how many declarations would be created, rows of the tables without a match; problems `operations_missing`,
  `missing_unknown_class`, `missing_in_locked_month`, `rows_not_in_ledger`, and the error `maybe_other_client` when less than a fifth of
  at least 10 operations is found although the client's tables have rows in the ledger's months; the button opens the ledger-check dialog);
  and `kind: income_report` (4.7.5, the periodic income report of morning, PDF, `readIncomeReportFile`: month, period, number of
  documents, one or two rows, whether the listing matches the summary; problems are the report's own codes and `listing_unread`, and the
  errors `month_missing` / `month_locked` for the declaration of its month. The import has no dialog: the button opens that month's
  declaration (it must exist and be open), asks for a confirmation and runs the existing import, which keeps the PDF in the images of
  the declaration; the original also goes to `imports/`); the enum of the schema lists the kinds that exist and widens with
  4.7.3 to 4.7.5 (a kind that is not in it is `invalid_argument`). The tool calls the service `imports.prepare`, which runs
  `prepareImport` and `inspectImportTarget` (adapter `agent/adapters/imports.js`) and hands back counts, checks and problems for
  the model and the totals for the card only. The card is `ctx.ui.importCard`; its button asks the page to open the wizard (the
  page opens the card's client first, because the wizards work on the open client); the filing is `fileImportOriginal` in
  `inbox-store.js`, run by the page when the wizard reports that it wrote. `problems` carry the parser's codes (`draft-rows`,
  `footer-mismatch` with its `key`, ...) and, from the adapter, `month_differs`, `month_locked`, `month_has_rows`,
  `types_suggested`; `severity` is `error` or `warning`.
- **Never.** Write anything (the filing after a successful wizard is page code, not this tool); call a commit function of an
  import; pass parsed rows, supplier names or amounts to the model beyond counts and check results; open a wizard by itself;
  send a spreadsheet to the vision model; accept a month, a kind or a client without the checks above; create a client.

## 6. What the agent can never do

There is no tool, and no operation in `services`, for: closing or reopening a declaration; deleting or archiving
anything (clients, declarations, rows, images, `rules.md` lines; the single exception is the inbox original after a
verified filing, section 5.3; an import original leaves the inbox through page code after the wizard's commit, not through a tool); editing an OCR fact; writing JSON or any file
directly, `rules.md` and `aliases.json` included (a confirmed rule or buyer is written by the page at the user's click, 5.4); committing an import (`prepare_import` only parses, the user opens the wizard and the wizard writes, 5.6); opening
a wizard or any dialog by itself; creating or editing clients; changing report settings; sending anything to a service other than the Worker's
model route. A name that is not in the registry gets `not_allowed` and is logged. Adding a tool means changing this
file, the registry snapshot and getting the owner's approval.

## 7. Data that goes to the model, and untrusted content

- To Gemini, through the Worker, on the paid tier only: the file being extracted, the fact records, the chart, the
  client's `rules.md`, the user's text, tool results. Never the access code, the token, report settings, or other
  clients' data in a run for one client.
- From 4.7 the bounded sample that `read_document` returns for a spreadsheet or a PDF that is not an invoice (sheet names, the
  first rows, the text layer; `max_chars` default 6000) also goes to Gemini, on the paid tier, like an invoice does. The full
  parse of an import file never goes to the model: `prepare_import` returns counts and check results only.
- A document is data, not instructions. The extractor answers in a schema; free text is cut and cleaned; the
  orchestrator receives it as values inside function results. If a document nevertheless steers the model ("ignore the
  rules and..."), the damage is bounded by section 6: draft rows whose facts the code copied, proposals and questions the
  user sees, all reversible from the pre-run copy.

## 8. Reuse map and dead code

| Tool | Existing code it wraps | New code |
| --- | --- | --- |
| `list_inbox`, `move_file_to_declaration` | `inbox-store.js` (`readInboxIndex`, `inboxCounts`, `readInboxFile`), `saveSourceImage` | filing function with hash check |
| `read_document` | `pdf-import.js`, `excel-journal-reader.js` readers | text layer of a PDF |
| `extract_document` | `model-client.js`, `dateKey`, `row-calculations.js`, `taxIdProblem` | request builder, schema, image shrinking, fact store |
| `find_client`, `get_client_context` | clients of `workspace.js`, `chart-of-accounts.js`, `loadIntakeContext` | name matching, `rules.md` reader |
| `query_rows` | `loadDeclaration`, the open table | filter |
| `facts_for` | `intakeFacts`, `pcnReview`, `isHomeUtility`, `loadIntakeContext` | adds rows of the run, `buyer_mismatch` |
| `add_rows` | the row path of `applyRecord`, `excludeText` and the status logic of `buildPlan`, `backupTable`, `saveDraft` | a headless row builder shared with the live table |
| `propose_change` | the cell edit path of `app.js`, `rows-move-flow.js` | proposal card |
| `prepare_import` (adapter `agent/adapters/imports.js`) | `prepareImport` (`excel-import-flow.js`), `prepareLedger` (`ledger-codes-flow.js`), `prepareReconcile` (`ledger-reconcile-flow.js`), `readIncomeReportFile` (`income-report.js`), and the wizards `setupExcelImport`, `setupLedgerCodes`, `setupLedgerCheck`, the income-report import of `app.js` | one `services` operation that runs the read-only preparer for a kind; opening a wizard with a preloaded file; filing the original after the wizard's commit |
| `ask_user` remember (page code, not a tool) | `rules-store.js` `readRules` | `appendRule`, `saveRules`, `rule-text.js`, the dialog `client-rules-ui.js` |
| `choose_client` remember the buyer, `routed_by alias` (4.6.2) | `nameTokens` of `intake-facts.js` | `client-alias.js` (pure rule of proof), `aliases-store.js` (`readAliases` for `services.clients.aliases`; `addAlias`, `removeAlias` for the page), `agent/aliases.js` |
| `run_report` | `reports.js`, `report-data.js` | none |
| `ready_to_close` | `pcnSummary`, the checks of the lock handler | one shared `lockProblems()` |

Dead code left by 0.3, proposed for 4.4 once this document is approved (question 8): delete `runBookkeeper`,
`BATCH_SIZE`, `agentRow`, `applyBookkeeperPlan`, `applyBookkeeperRecheck`, the row flag `processing` and the `.retry`
CSS (replaced by the loop); keep `backupTable`, `excludeText`, `intakeContext` (moved); keep `renderPdfPages` until
the viewer of 4.4 is decided; delete `pdf-report.js`, `createDraftExportDirectory`, `history-ranker.js` (no caller).

## 9. Tests this contract requires

For 4.2 (loop, with a scripted fake model): happy path; a tool error returned to the model; a refused call (unknown
name, locked month); cancel in the middle; failure in the middle leaves editable rows; a limit stops the run; the
pre-run copy; the registry and `services` snapshots; this file's headings equal the registry. Per tool: valid input,
each validation, idempotence, and every "never" of section 5 as a failing case. For 6.2: `ready_to_close` blockers equal
the lock refusals. For 4.7 (`prepare_import`): each kind with a valid fixture (counts and checks, no rows in the result); each
kind with a wrong file (`wrong_format`, the message of the parser); a kind that does not fit the file type; a client without proof
(`not_allowed`); idempotence; the file tree byte-equal after the call; the tool files import no commit function; the filing after a
successful wizard (hash checked, inbox entry gone) and its absence after a failed or closed wizard. For 4.6.1 (rules): nothing
written without the tick, with another answer or a dismissed card; the text of the file equals the text of the card; a rule is
not added twice; the user's edit keeps a copy; no source of the agent imports a writer of `rules.md`. For 4.6.2 (aliases): a name
without confirmation is refused; after a ticked click a later run routes by `alias` without a question; an alias of two clients is
refused; a printed number that is not the alias is refused; no box when the buyers differ, one is missing, a file was not read or a
client holds the buyer; nothing is written without a chosen client; no source of the agent imports a writer of `aliases.json`.

## 10. Questions for the owner

Approving the document means answering these. The recommended answer is first; "all as recommended" is a valid reply.

| # | Question | Recommendation | If not |
| --- | --- | --- | --- |
| 1 | Excel/CSV files in the inbox | **Superseded on 17 October 2026 by question 11 (step 4.7).** As approved on 16 October: the agent lists them and tells the user to use "ייבוא מ‑Excel" (they are journals, not invoices; that wizard has its own checks). `kind: spreadsheet`, no extraction | The agent would parse arbitrary workbooks: much more surface, no gain for Anna |
| 2 | A document belongs to a month that has no declaration yet (after the last locked month) | The code creates the declaration open, never for a locked month. The month is decided by `intakeFacts`, not by the model | The agent asks the user for every new month, or leaves the row in the inbox |
| 3 | Rows that already exist | Change only by the user's click on a `propose_change` card (also for "this one is for September", "classify these as fuel") | A direct `update_rows` tool: faster, but the agent could overwrite the user's edits |
| 4 | Changes to the plan's tool list | Add `get_client_context` and `query_rows` (the plan has no way to read rules, chart or the table); narrow `read_document` to text and metadata; rename `ask_anna` to `ask_user`; `add_rows` takes fact handles | Stay with the plan's list: the agent cannot read the client's chart or answer questions about the table |
| 5 | Highlight boxes of Pass 1 (where on the photo each value was read) | Not in v1: the original opens next to the table (4.4) and the user looks | Keep boxes: bigger schema, more model errors, "ready, missing marks" status again |
| 6 | Limits | 60 turns, 400 calls, 200 extractions, 15 questions, 30 min, concurrency 3 | Other numbers: they are constants |
| 7 | "ready" status | Only code decides it: expense, valid code, no warning, `confidence` ≥ 80, model did not ask for review | Let the model's `needs_review: false` suffice: one wrong confident answer becomes a "sure" row |
| 8 | Dead code of 0.3 (section 8) | Delete as listed in 4.4 | Keep it: two paths to maintain |
| 9 | Run log in `common/agent-runs/` | Yes, local, no images | No log: a wrong row cannot be explained afterwards |
| 10 | PDFs | Stored as the original in `images/`; facts carry `page`; the viewer in 4.4 shows the page | Render pages to JPEG on filing: bigger folders, a second copy of the truth |
| 11 | **New, 17 October 2026 (4.7):** the import functions of the menu "ייבוא ובדיקות" through the inbox. The principle is **approved**: the agent reads a bounded sample, recognises the file, and a read-only tool prepares it; the user opens the wizard from a card. **Confirmed by the owner on 17 October 2026:** one tool `prepare_import` with `kind` (`journal`, `ledger_codes`, `ledger_check`, `income_report`) | One tool: 15 tools in all, one description and one schema to test, a new kind is an enum value (and a new owner approval, as every change here). The four wizards differ in the summary only | Four tools, `prepare_journal`, `prepare_ledger_codes`, `prepare_ledger_check`, `prepare_income_report`: 18 tools, four near-identical schemas and declarations sent to the model on every turn; a model choosing between four names is no safer than choosing one enum value |
| 13 | **New, 17 October 2026 (4.6.2):** the agent asks "whose is this?" again for documents of a buyer the user already answered. **Decided by the owner on 17 October 2026:** a confirmed alias in a small structured file `clients/<client>/aliases.json`, written by the page when the user ticks the box of `choose_client`, accepted by the code as routing proof (`routed_by alias`) | Routing proof must not come from parsing free text that the user and the model write (`rules.md`); a structured file has one reader and one writer, and the code checks it like a VAT number. A name alone still proves nothing until the user confirmed it once | Keep the aliases as lines of `rules.md`: one file for the user, but the proof would depend on the wording of a line |
| 12 | **New, 17 October 2026 (4.6):** who writes a confirmed rule into `rules.md`. **Decided by the owner on 17 October 2026:** the page, at the user's click; `remember_rule` is removed (14 tools); the rule is bound to one answer (`remember.option`) | The tick is the confirmation, so nothing the model does afterwards should matter: if the model had to call `remember_rule`, a forgotten call lost the user's tick (an instruction alone did not hold the model for `choose_client`). With the page as the only writer, no tool can write the file at all | Keep `remember_rule { ask }`: the contract as approved on 16 October, but a confirmed rule depends on one more model call |

## 11. Changes against the plan of 16 October

`WORK_PLAN.md` 4.1 listed twelve tools. This draft has fourteen: added `get_client_context`, `query_rows`; `ask_anna`
became `ask_user`; `read_document` no longer returns images; `add_rows` takes handles instead of values; `list_inbox`
and `move_file_to_declaration` are as planned. Phase 6's `run_report` and `ready_to_close` are specified here so that
the registry is complete, and are built in phase 6.

**17 October 2026 (step 4.7):** a fifteenth tool, `prepare_import` (5.6); a new error code `wrong_format`; question 1 is
superseded by question 11; `read_document` is also the way the agent recognises import files (the sample is bounded and goes to
Gemini on the paid tier); principle row and sections 6, 7, 8 and 9 extended. Four tools (18 in all) were considered and not
recommended. The principle and the single tool with `kind` are the owner's decisions of 17 October. Code: 4.7.1 changed the neutral note
of `list_inbox` and the instruction of the orchestrator; 4.7.2 built the tool for `journal`.

**17 October 2026 (step 4.6.1):** `remember_rule` removed (fourteen tools); `ask_user` `remember` takes `option` and returns
`saved`; the page writes the rule (question 12); principle row, sections 5, 6, 8 and 9 changed.

**17 October 2026 (step 4.6.2):** confirmed aliases (question 13): `find_client` `match: alias`, `get_client_context` `aliases`,
`add_rows` `routed_by: alias`, the box of `choose_client` and `alias_saved`; principle row, sections 5, 6, 8 and 9 changed.
