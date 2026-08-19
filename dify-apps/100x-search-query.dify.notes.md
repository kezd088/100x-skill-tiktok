# 100x-search-query -> Dify Workflow DSL — porting notes

Source skill: `skills/100x-search-query/` (v1.4.0)
Output DSL: `100x-search-query.dify.yml` (`app.mode: workflow`, `version: "0.7.0"`, 15 nodes, 16 edges)

## 1. What needs manual reconnection after import

- **Model selection (3 LLM nodes: `pinterest_llm`, `tiktok_llm`, `reddit_llm`).** All three use the
  placeholder `model.provider: langgenius/openai/openai`, `model.name: gpt-4o-mini`. This mirrors the
  exact provider/model pairing used in this reference kit's own verified-importable examples
  (`01-text-summarizer.yml`, `03-excel-markdown-analysis.yml`), paired with a matching top-level
  `dependencies:` entry (`marketplace_plugin_unique_identifier: langgenius/openai:0.2.6@...`). It will
  still need reselecting/reauthorizing against whatever model provider is actually installed in the
  target Dify Cloud workspace.
- **`dataset_id` placeholders (2 nodes): `kb_retrieval.dataset_ids: ["REPLACE_WITH_DATASET_ID"]` and
  `kb_index.dataset_id: "REPLACE_WITH_DATASET_ID"`.** These do not point at a real Dify Knowledge Base.
  Either (a) create a dataset in the target workspace and replace both placeholder strings with its real
  ID, or (b) if the KB-wiring is not wanted, delete `kb_retrieval`, `kb_writeback_format`, and `kb_index`
  and rewire `class_a_gate`'s `"false"` edge directly to `pinterest_llm`/`tiktok_llm`/`reddit_llm`, and
  each LLM node's `context.enabled` to `false`. Until reconnected, import itself will succeed (dataset IDs
  are workspace-scoped references, not import-time-validated), but actually **running** the workflow will
  fail at `kb_retrieval`/`kb_index` until a real dataset exists.
- **Icon/branding** (`app.icon: "🔍"`, `icon_background: "#E0F2FE"`) is cosmetic placeholder, change freely.
- Nothing else requires reconnection — no other credentials, tool auth, or workspace-bound IDs are used
  anywhere in this graph (no `tool`/`agent`/trigger nodes).

## 2. workflow.md phases -> nodes

**Phase 1 (接收+校验)** maps to `start` (the 7 input fields: `category` required, `product_name` /
`core_benefit` / `target_audience` / `brand_tone` / `topic_angle` / `raw_input_text` all optional) feeding
a single Python `code` node, `phase1_gate`, which does everything Phase 1 steps 2/3/6 describe in one
pass: the class-A category gate (`category` empty -> `reject`), the class-A `product_name` placeholder
fallback (`"[品类锚点] <category>"`), the class-B `core_benefit`-missing flag (soft degrade, not a reject),
the `topic_angle` validation/default and its exact 2A quota-table lookup (verified locally to sum to 45 for
all four branches), and the sensitive-category **pre**-scan (see §3). `class_a_gate` (`if-else`) is the
one true fail-fast gate in the graph: it reads `phase1_gate.reject` and routes straight to `reject_end`
(the fixed re-ask message) without spending an LLM call, exactly matching the "don't waste an LLM call
generating queries for input that's going to be rejected" instinct — though note this is the *only* place
that instinct actually applies (see §3 on why the sensitive-category check does **not** get the same
fail-fast treatment). **Phase 2 (生成+自检)** maps to: an optional `kb_retrieval` knowledge-retrieval node
(see §"KB wiring" below), then three parallel `llm` nodes (`pinterest_llm`/`tiktok_llm`/`reddit_llm`, one
per 2C table row, each with its own platform-specific system prompt embedding that platform's exact word
bank / OR-logic / banned-word rules and the 25-label closed-set `intent_cn` format), then one Python `code`
node `assemble_and_validate` that plays the role of 2D (per-item self-check) and 2E (batch self-check) at
once — it is a from-scratch hand-rolled port of `schema.json`'s structural rules (ajv-equivalent, since
Dify's sandboxed code node cannot import ajv/jsonschema) plus `scripts/validate.js`'s cross-item aggregate
checks (axiom2 density, axiom3 coverage, near-dup, sensitive-category post-hoc). `final_gate` (`if-else`)
reads its `is_valid` output and routes to either `rework_end` (surfacing the *specific* failing
checks — one line per violation, same style as `scripts/validate.js`'s own error format) or onward to
success. **Phase 3 (返工)** is intentionally *not* built as an automatic in-graph retry loop — see §3.

## 3. What could NOT be (or was not) faithfully ported, and why

**The sensitive-category guardrail is carried over at full strength — verified, not assumed.** I copied
`SENSITIVE_CATEGORY_WORDS`/`AUTHORITY_CLAIM_WORDS` byte-for-byte from `scripts/validate.js` (including
every addition the source already contains), and reproduced the exact scan scope: both signals scan the *same*
`fullText` (`category` + `product_name` + every generated `q` + every generated `intent_cn`), not just
`category`/`product_name`. A local Python test harness
(`scratchpad/pytest/test_assemble.py`) reconstructs two real bypass fixtures (one where sensitive/authority
words appear only inside generated `q`/`intent_cn` with a clean `category`/`product_name`, and one where
newer synonyms — "持久力"/"doctor approved" — appear inside `category`/`product_name`) and confirms the ported
`assemble_and_validate` logic catches both, exactly as the source `scripts/validate.js` does. The two real
`evals/*.json` files also run through the identical Python logic and both come back with zero errors.

**One place I deliberately went beyond 1:1 parity, disclosed rather than hidden:** the source's own
`workflow.md` describes Phase 1 as "the first line of defense" because it *sees the raw input text*,
while `scripts/validate.js` is explicitly documented as "the second, imperfect one" because it can only
scan fields that survive into the output bundle. In the original single-agent skill this two-line-of-defense
structure is conceptual (one agent doing both passes in sequence). In this Dify graph it is concretely two
separate scans: `phase1_gate` scans `category + product_name + core_benefit + target_audience + brand_tone
+ raw_input_text` (the broad, first-line scan — `raw_input_text` never reaches the output bundle, so this
is strictly more visibility than `scripts/validate.js` ever had), and `assemble_and_validate` independently
re-scans the *actual generated* `category + product_name + q + intent_cn` (the narrow, second-line scan,
byte-for-byte matching `scripts/validate.js`'s `sensitiveCategoryCheck`). The final warning is appended if
*either* scan trips, which self-heals the one class of failure that would otherwise be unrecoverable in a
single-pass workflow (an LLM incidentally introducing a sensitive+authority word combination that wasn't in
the raw input at all). This is a structural consequence of splitting one agent's sequential reasoning into
a graph with a hard node boundary between "read input" and "read output" — not a new capability invented
on top of the source's design, and it does **not** change the fundamental, still-open limitation: this
remains a **fixed keyword-list check, not a semantic one**. I did not add any LLM-based or semantic
sensitive-content classifier on top of it, and any rephrasing outside both word lists still evades both
scans, exactly as `axioms.md`/`workflow.md`/`SKILL.md` disclose. Do not read the dual-scan design as a
claim that this gap is closed — it isn't, and the source is explicit that closing it needs semantic
detection, not another word-list round.

**Axiom 4's documented semantic gap was preserved, not silently fixed.** `axioms.md` #4 is explicit that
the closed-set-label regex is a *format* lock, not a *semantic* one: `q:"does this supplement actually
work"` paired with `intent_cn:"质疑:这个补剂真的有效吗"` (a label-wrapped, word-for-word translation) passes
the pattern. I ported the identical regex (not a stricter one) and specifically tested this exact
counterexample locally — it still passes `assemble_and_validate` with zero `intent_cn`/`axiom4` errors,
confirming I did not accidentally over-tighten this check. Closing it for real needs an EN-CN semantic
dictionary the source explicitly doesn't have and chose not to build; I did not build one
either.

**Not ported: axiom-4-adjacent 2D per-item 3x-retry-then-keep-best.** `workflow.md` 2D describes retrying
an individual failing query up to 3 times and, if still failing, keeping the best version with a
`meta.warnings` note ("`<平台>第N条未通过公理X，保留最佳版`"). This is per-*item* granularity inside a single
LLM call's output and would require an `iteration`/`loop` node wrapping each of the 45 items individually —
following the single-pass graph design that routes failures to an end node surfacing specific
failing checks rather than auto-looping, this was intentionally not automated as an in-graph loop. `rework_end` surfaces every specific
violation (mirroring `scripts/validate.js`'s own per-line error format) so a human/LLM can fix and re-run,
but there is no automatic per-item retry loop inside the graph. Phase 3's L1/L2/L3 user-triggered rework
(re-do one query / re-do one platform bucket / re-do all 45) has no dedicated graph nodes either — in
Dify's UI this maps naturally onto re-running a single node (L1/L2) or the whole workflow (L3) from the
run inspector, which is arguably a reasonable structural analog, but it is not automated inside the DSL
itself, and there is deliberately no L4 (non-English output) branch anywhere, matching axiom 1's explicit
"no exception, ever" boundary — the source's since-removed L4 escape hatch is not resurrected.

**Not ported (matches the source's own documented scope, not an oversight):** the `SKILL.md` banned-word
list (`attractive/beautiful/stunning/serene/pristine/elegant/cinematic/professional/studio/flawless`, AI
customer-service tone, Chinese hedge words) and the "don't fabricate `r/xxx` subreddit names" rule are both
explicitly documented in the source's `workflow.md` as **prompt-level discipline that `scripts/validate.js`
itself does not check** ("本脚本未覆盖，属人工/上层 prompt 纪律，非结构性判据"). I preserved that exact
boundary: both rules are baked into all three LLM system prompts, but I deliberately did *not* add new
hand-rolled structural regex checks for them in `assemble_and_validate` that the source itself doesn't
have — adding stricter enforcement than the audited source would be scope creep, not fidelity.

**Not wired:** `schema.json`'s optional `source_language_note` field. It's genuinely optional in the output
contract (not one of the 4 axioms, not checked by `scripts/validate.js`), and reliably detecting source
language without a stdlib-only, no-network dependency wasn't worth the complexity for an optional
diagnostic field. `queries.pinterest/tiktok/reddit`, `meta.based_on_5a`, `meta.generated_by`,
`meta.topic_angle`, and `meta.warnings` — the fields that actually carry axiom/guardrail weight — are all
wired and validated.

**`meta.based_on_5a` is computed from the actual generated stage tally, not the a-priori quota table** —
I checked this against real data before committing to it: naively taking the topic_angle quota table's
top-2 targets (e.g. `aesthetic` -> `Appeal:18, Act:9` -> `"Appeal+Act"`) does **not** match
`evals/example-02-drawer-organizer.json`'s real `based_on_5a: "Ask+Appeal"` for the same `topic_angle:
"aesthetic"`. `schema.json` itself describes this field as "Dominant 5A stage(s) this run **leaned on**"
(past tense, describing actual output), so `assemble_and_validate` tallies the real `stage` values across
all 45 parsed items and reports the top-2 by count. This is a corrected design decision, not a deviation
I'm hiding — the naive quota-based approach would have been wrong against the source's own real fixtures.

## KB wiring — decision and reasoning

Kept it, but as non-blocking, optional-context wiring rather than a hard dependency. Reasoning: "which
search-query patterns worked for which product category" is a genuinely reusable lookup key (`category` is
already the one truly-required input field), so an early `knowledge-retrieval` keyed on
`phase1_gate.category_final` feeding into each LLM node's `context` (RAG-style, `context.enabled: true` +
`variable_selector`) is low-cost and architecturally clean — if the dataset is empty or unset, the LLM
nodes still work fine on the direct input fields alone (context is additive, not required). The late
write-back (`render_tables` -> `kb_writeback_format` -> `knowledge-index`) only fires after `final_gate`
confirms the bundle actually passed every check, so only validated, self-consistent query sets ever get
indexed — never a rejected or failed-validation bundle. The complexity cost is 3 extra nodes
(`kb_retrieval`, `kb_writeback_format`, `kb_index`) against 15 total, which felt proportionate. If this
were a lower-volume or one-off skill I'd have left it out; a search-query generator that will plausibly be
re-run across many product categories is close to the ideal case for this pattern.

## Validator output (final, clean run)

```
$ python scripts/validate_dsl.py --strict --target-version 0.7.0 dify-apps/100x-search-query.dify.yml
== dify-apps\100x-search-query.dify.yml
WARN [node.unknown-type] workflow.graph.nodes[13].data.type: Node type 'knowledge-index' is not covered by a strict schema; dynamic outputs will be accepted.
0 error(s), 1 warning(s)
```

**This warning is justified/intentional, not a defect — documented, not silently ignored.** I grepped the
validator's own source (`scripts/dify_dsl_validator/validator.py`) to confirm: `"knowledge-index"` appears
exactly once in the entire file, inside `_validate_dependencies`'s plugin-scanning set
(`{"agent", "knowledge-retrieval", "knowledge-index", "datasource"}`) — it was never added to
`_validate_node`'s per-type dispatch table (the part that emits per-field structural errors and declares
known outputs), unlike its sibling `knowledge-retrieval`, which *is* handled there with zero warnings. That
sibling type validates cleanly in this same file (see `kb_retrieval`, node index 4), which supports that my
general knowledge-node usage pattern is correct — this is specifically a per-type coverage gap in this
third-party checker for one node type, not a sign anything is malformed. The `knowledge-index` field shape
I used (`dataset_id`, `index_chunk_variable_selector`, `keyword_number`, `retrieval_model`) is copied
verbatim from this reference kit's own `references/node-schemas.md` "knowledge-index" section. `--strict`
mode fails on any warning by design (`node.unknown-type` here), which is why exit code is 1 despite zero
actual errors — I did not weaken or bypass strict mode to hide this; it's reported here in full.
