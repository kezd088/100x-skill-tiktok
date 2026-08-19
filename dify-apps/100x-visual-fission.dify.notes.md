# 100x-visual-fission → Dify Workflow DSL — porting notes

Source skill: `skills/100x-visual-fission/`
(read in full: `SKILL.md`, `metadata.json`, `axioms.md`, `workflow.md`, `schema.json`,
`scripts/validate.js`, all 6 `evals/*.json`).

Output: `dify-apps\100x-visual-fission.dify.yml` — `app.mode: workflow`, `version: "0.7.0"`,
29 nodes / 29 edges.

## 1. What needs manual reconnection after import

| Item | Where | What to do |
|---|---|---|
| Model provider/name | 4× `llm` nodes (`extract_common`, `plan_frames`, `generate_prompt_set`, `render_fission_prompt`) + 1× `question-classifier` (`classify_structure`) | All use the placeholder `provider: langgenius/openai/openai`, `name: gpt-4o-mini`. Reselect a real installed model per the target workspace. Temperatures are pre-set per node purpose (0 for the classifier, 0.2 for the JSON-extraction node, 0.3–0.5 for the creative-generation nodes) — keep or retune, not a placeholder. |
| Top-level `dependencies` marketplace identifier | top of file | One `marketplace_plugin_unique_identifier: langgenius/openai:0.2.6@e26656...` entry was added only to satisfy this repo's local `validate_dsl.py` dependency-completeness check (it errors if an `llm`/`question-classifier` node's `model.provider` has no matching top-level dependency). It is a plausible-shaped placeholder, not a verified-current marketplace version/hash — Dify will very likely need you to reselect/reinstall the actual OpenAI plugin on import regardless of what this string says. |
| `dataset_id` (×2, **no real dataset exists yet**) | `kb_retrieve` (`knowledge-retrieval`, field `dataset_ids: ["REPLACE_WITH_DATASET_ID"]`) and `kb_index_write` (`knowledge-index`, field `dataset_id: "REPLACE_WITH_DATASET_ID"`) | Flagging prominently: **this is placeholder wiring, not a working KB integration.** You must create/choose a real Dify Knowledge Base dataset for "past prompt_sets by product category" and put its real ID in both places before the graph will run past `kb_retrieve` (an unresolved dataset reference will fail at runtime, not just look wrong). See §3 for why the two placeholder IDs are NOT required to be the same dataset (retrieval and write-back could reasonably target different datasets in production; wiring them to the same ID here is just the simplest default). |
| Node positions/viewport | whole canvas | The pipeline is long (7 phases, 2 iterations) and laid out on a wide horizontal spine (x from 40 to ~6560). Expect to need "zoom to fit" / manual re-layout after import; `viewport.zoom: 0.4` is a rough starting guess, not tuned against real Dify's renderer. |

## 2. workflow.md phases → nodes (one paragraph)

`start` collects the class-A/B/C inputs (`references_input`, `product_brief`, plus soft
`product_category`/`aspect_ratios_wanted`/`variant_count` and optional class-C
`persona_bundle_json`). **Phase 1** (接收+校验) is `intake_check` (a `code` node doing the
class-A ≥2-references / product_brief-present gate, class-B defaulting, and the Phase-1-step-5
unvisualizable-claim prescan verbatim-ported from `UNVISUALIZABLE_CLAIM_WORDS`) → `gate_class_a`
(`if-else`) → either `end_rejected` (fixed refusal wording ported from `SKILL.md`/`workflow.md`)
or onward. **Phase 2** starts with the KB-augmented VTP skeleton: `kb_retrieve`
(`knowledge-retrieval`, similar-past-prompt-sets-by-category) feeds `extract_common`'s
`context` (VTP step 03, `llm`) → `classify_structure` (VTP's **original extension** — the
four-way single_frame/head_tail/head_mid_tail/multi_day media-fission axis, a
`question-classifier` since it's a genuinely semantic narrative-structure judgment, per
`usecase-node-selection.md`'s own guidance) → `plan_frames` (`llm`, fills in the frame content
for whichever structure was classified, applying the fixed per-structure role/count table
strictly by instruction) → `parse_media_plan` (light JSON parse/normalize) → `build_variant_hints`
+ `prompt_sets_iter` (`iteration` over N variant-hints, VTP step 04, one `generate_prompt_set`
`llm` call per hint) → `assemble_prompt_sets` → `build_fission_tasks` (deterministically expands
media_plan.frames × the fixed VTP A/B/C camera table into one task per frame) →
`fission_iter` (`iteration`, VTP step 06: `render_fission_prompt` `llm` writes the prose,
`finalize_fission_item` `code` node deterministically appends the VTP step-07 fixed
`negative_prompt` constant + realism suffix — never left to the LLM) → `assemble_bundle` merges
everything into one `VisualFissionBundle` JSON. The "逐条自检" step is `structural_check` (plain-
Python port of `schema.json`) → `aggregate_check` (plain-Python port of `scripts/validate.js`'s
aggregate layer) → `gate_valid` (`if-else`), which on failure routes to `format_failure_report` →
`end_failed` (naming the specific failing frame/variant/axiom, not a generic "please recheck"),
and on success routes to `render_summary` (optional human-readable Markdown, per `SKILL.md`'s
"可选再渲染一张人类可读 Markdown 摘要") → `kb_writeback_doc` → `kb_index_write` → `end_success`.
Phase 3 (user-triggered rework, L1/L2/L3) has no dedicated nodes — like the source skill, this is
a conversational/re-invocation concern, not part of the one-shot `workflow`-mode output contract.

## 3. Axiom/check fidelity — what was and wasn't faithfully ported

All four axioms were ported and **fully verified with regression tests**, not just visually compared:
- `selftest_ported_checks.py` (in this scratchpad) extracts `structural_check`'s and
  `aggregate_check`'s `main()` functions straight out of the DSL YAML and runs them against
  the skill's real 6 `evals/*.json` files (all PASS with zero errors) plus 14 mutation-based
  counterexamples mirroring `scripts/validate.js`'s own 16-case `--selftest` suite — identity-lock
  violation, duplicate `prompt_sets`, `frame_count`/array-length mismatch, unknown
  `source_prompt_set_id`, orphan frame, altered `negative_prompt`, an unvisualizable-claim
  phrase, the `manicure`-not-`cure` non-false-positive, an ALL-CAPS `GENERIC` placeholder, the
  `natural-windowsill`/`warmth` camera-keyword substring trick, the `day 3/7/14/30`
  never-cites-day-1 case (must PASS) and the wrong-reference-anchor-flag mutation of it (must
  FAIL). All 20 checks behaved exactly as the source `validate.js` documents.
- `integration_test_visual_fission.py` runs the full 9-code-node data pipeline end-to-end with
  simulated (non-LLM) upstream outputs — including one LLM output deliberately wrapped in a
  ```json fence to prove the fence-stripping logic works — and confirms the assembled bundle
  passes both checkers.

**Both pre-documented known limitations from `axioms.md` are preserved as-is, not worsened:**
1. **Axiom 2 TODO** (`multi_day` `structure_justification` must cite a digit, but nothing can
   verify the digit is faithful to the source narrative rather than fabricated): ported
   byte-for-byte as the same `re.search(r'[0-9]', ...)` check inside `structural_check`, with the
   identical caveat in the comment. The Dify version has exactly the same blind spot as
   `schema.json` did — no more, no less. (The interpolation-with-honest-warning behavior for
   `multi_day` narratives with fewer than 4 cited time points is carried into `plan_frames`'s
   system prompt as an instruction, but — same as the source skill's own Phase 2C, which relies on
   human/LLM honesty at generation time — this is not and cannot be machine-verified either way.)
2. **Axiom 4 TODO** (`UNVISUALIZABLE_CLAIM_WORDS` validated only against supplement-category
   EN+ES real corpus, likely needs expansion for other categories): the exact 29-entry word list
   from `scripts/validate.js` was copied verbatim (including the accented Spanish forms) with no
   invented "universal" additions. **New, Dify-specific wrinkle worth flagging honestly**: the
   source repo keeps this list in exactly one place (`scripts/validate.js`; `metadata.json`
   explicitly notes `axioms.md` quotes it by reference, not by copy). Dify code nodes are
   sandboxed and cannot import a shared module across nodes, so this port necessarily duplicates
   the list in **two** places — `intake_check` (the Phase-1-step-5 prescan) and `aggregate_check`
   (the final scan). If the list is ever expanded for a new category, **both copies must be
   updated together**, or the prescan and the final gate will silently drift apart. This is a
   platform-imposed maintainability cost the original single-file Node implementation didn't have.

**Two deliberate, disclosed architectural divergences** (behaviorally different from the source
skill's own Phase 2E, though never violating any axiom — the checkers still verify both cases
independently regardless of how the bundle was produced):
- `build_fission_tasks` assigns **exactly one** `fission_variant` per planned frame, cycling
  A/B/C/aspect-ratio/prompt-set-id deterministically, rather than leaving "how many camera
  presets to render per frame" to operator judgment. `axioms.md`'s own text says full A/B/C
  coverage per frame is optional ("不要求每帧都凑满 A/B/C 三档全出，够用即可") — this port always
  hits exactly that minimum bar by construction, in exchange for axiom-3 zero-orphan/referential-
  integrity being structurally guaranteed rather than merely hoped-for. It gives up the source
  skill's optional "render extra variants for a frame if you want" richness.
- The VTP step-07 negative-prompt constant and step-06 realism suffix are appended by
  `finalize_fission_item` in **code**, never left for the LLM to remember to include. This is a
  strengthening relative to the source skill (where these are documented as machine-checked
  *after the fact* on human/LLM output), not a weakening.

**Nothing in the four axioms was dropped or silently skipped.** The only genuinely un-portable
piece is the same one the source skill itself documents as unverifiable by any means (axiom 2's
narrative-faithfulness gap) — it is preserved, not papered over.

One additional fidelity fix made during this port (not a limitation, a correction): the first
draft's `assemble_bundle` wrote a generic boilerplate `source_material_note` regardless of input
shape. `workflow.md` Phase 1 step 1 requires an **honest, per-run disclosure** of whether
`references[]` arrived as real vision-reversed JSON (form a) or a text-only degrade (form b,
"text-only degraded path"). Fixed by having `intake_check` classify which form was actually
received (`references_degraded`, true only when every reference item parsed as a JSON object) and
`assemble_bundle` word the note accordingly — verified in `integration_test_visual_fission.py`
(checks 07–08).

## 4. Final validator output (clean run)

```
python scripts/validate_dsl.py --strict --target-version 0.7.0 100x-visual-fission.dify.yml

== 100x-visual-fission.dify.yml
WARN [node.unknown-type] workflow.graph.nodes[27].data.type: Node type 'knowledge-index' is not covered by a strict schema; dynamic outputs will be accepted.
0 error(s), 1 warning(s)
```

`0 errors` (without `--strict`, exit code 0). The **one** remaining warning under `--strict` is
justified, not fixed, deliberately:

- `knowledge-index` **is** an officially-documented Dify 1.16/DSL-0.7.0 node type — it appears in
  this same repo's own `references/dsl-structure.md` "Official Node Type Set" list, and its exact
  field shape (`dataset_id`, `index_chunk_variable_selector`, `keyword_number`, `retrieval_model`)
  is documented in `references/node-schemas.md` and was followed precisely.
- The warning fires only because this **local** `validate_dsl.py`'s per-node-type structural
  checker (`validator.py`, the `_node_output_names`-style `elif` chain) has a dedicated branch for
  every other node type used in this graph (`start`/`llm`/`code`/`if-else`/`question-classifier`/
  `end`/`knowledge-retrieval`/`template-transform`/`iteration`/`iteration-start`) but has no branch
  for `knowledge-index` specifically, so it falls through to the generic "unknown type, dynamic
  outputs accepted" warning — a coverage gap in this checking tool, not a defect in the DSL.
  Confirmed by reading `validator.py` directly (the `elif node_type == ...` chain around line
  1084–1241 lists every node type this graph uses except `knowledge-index`).
  `knowledge-index`'s permissive `outputs=None` handling also means no downstream selector
  references it, so this warning has no other side effects.
- Removing the node to silence the warning would directly remove the late `template-transform → knowledge-index` write-back of the finalized
  prompt sets, so it was kept and the warning documented here instead.
- The node does have a normal outgoing edge to `end_success` (it is not a graph dead-end; no
  separate `graph.dead-end` warning appears for it), so the only artifact is this one
  tool-coverage warning.

## Local verification scripts (this scratchpad, not part of the deliverable)

- `check_visual_fission_code.py` — parses the DSL YAML, `ast.parse()`s all 9 embedded Python
  `code` blocks (0 syntax errors), confirms node/edge counts and type distribution.
- `selftest_ported_checks.py` — the 20-check real-eval + mutation regression suite described in
  §3.
- `integration_test_visual_fission.py` — the full simulated end-to-end pipeline run described in
  §3.
