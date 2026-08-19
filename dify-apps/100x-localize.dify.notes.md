# 100x-localize -> Dify Workflow DSL: porting notes

Source skill: `skills/100x-localize/` (v1.3.0).
Output: `dify-apps\100x-localize.dify.yml`, `app.mode: workflow`, DSL `version: "0.7.0"`.
14 nodes, 12 edges.

## 1. What needs manual reconnection after import

- **Model selection (`generate_llm` node)**: `model.provider: langgenius/openai/openai`,
  `model.name: gpt-4o-mini` is a generic placeholder, as instructed. The matching top-level
  `dependencies` marketplace entry (`langgenius/openai:0.2.6@...`) is also a placeholder hash
  copied from a known-working reference export. After import, reselect/reauthorize a real model
  in the target workspace; Dify may prompt to reinstall the plugin dependency.
- **Retry budget**: the loop's `break_conditions` hard-code an attempt cap of 3
  (`attempt >= 3`, i.e. 1 initial generation + 2 retries) and `loop_count: 5` as an outer safety
  net. The "3" is a direct port of axiom 1's documented `单轮压缩重写上限 2 次`
  (single-round compression rewrite cap of 2 retries); axioms 2/3/4 don't have their own
  documented numeric retry cap in workflow.md, so this port applies the same cap uniformly to
  all four axioms (see axioms/checks section below). Adjust the `"3"` value in
  `localize_loop.break_conditions` directly if a different retry budget is wanted.
- **LLM temperature** (`completion_params.temperature: 0.5`) is an unrequested-but-reasonable
  default, not specified anywhere in the source skill. Tune after reviewing real output quality.
- **`target_region` / `register_profile` input widgets**: these are `text-input` (free string)
  start variables, not Dify `select` dropdowns. This is deliberate, not an oversight -- see the
  design rationale below. If a nicer dropdown UX is wanted for the common human-fills-a-form
  case, they can be changed to `type: select` with `options: [mx, generic-latam]` /
  `[default, compliance-conservative]` after import; `normalize_inputs`' degrade-with-warning
  logic keeps working unchanged as a defensive backstop for callers hitting the workflow's API
  directly (where a `select` constraint may or may not be enforced depending on how the caller
  submits the request).
- **Icon / color** (`🌎`, `#FDE7C8`) are cosmetic placeholders, change freely.
- **Canvas layout**: node `position`/`positionAbsolute` values are hand-computed to produce a
  non-overlapping, left-to-right readable graph (verified consistent for the loop's child-vs-
  container offset math), but were never rendered in a live Dify canvas -- expect to nudge a few
  nodes after opening the workflow in the editor.

## 2. workflow.md phases -> nodes (one paragraph)

Phase 1 (接收+校验) maps to `start` (raw inputs) -> `normalize_inputs` (a `code` node: defaults
`target_region` to `mx` and `register_profile` to `default` when absent, soft-degrades an
unsupported `target_region` to `generic-latam` with a warning exactly as documented, and runs
the class-A "is source_script non-empty" check) -> `input_gate` (an `if-else` that routes empty
input straight to a dedicated `end_input_error` node carrying the skill's fixed refusal message,
without spending an LLM call). Phase 2 (本地化改写+自检: 2A 语域决策/2B 自然化/2C 压缩/2D 逐句
自检/2E 批量自检) maps to the `localize_loop` container: `generate_llm` (an `llm` node whose
system prompt encodes 2A's register branching, 2B's natural-delivery rules, and 2C's compression
priorities/floor-ceiling, i.e. the parts of Phase 2 that are genuinely generative reasoning) is
followed by `validate_code` (a `code` node that is the real, mechanically-enforced form of 2D/2E's
self-check checklist, porting `scripts/validate.js`'s `compressionCheck`/`secondaryPatternCheck`/
`fabricatedAuthorityCheck` line-for-line into Python) and `record_attempt` (an `assigner` that
carries the attempt's result into loop-scoped state for the next retry or for post-loop routing).
Phase 2's documented failure handling ("压缩比超上限 -> 回 2C 继续砍…单轮压缩重写上限 2 次" and
"该句重写" for axioms 2/3/4) is what makes this a `loop` rather than a single `if-else` pass:
the loop retries up to 3 attempts, breaking early once every axiom is clean. Phase 3 (用户触发的
返工 L1/L2/L3) is **not** represented as in-graph nodes -- see the disclosure below for why and
what the mapping is instead. After the loop, `route_result` (an `if-else` reading
`hard_fail_count`, not `fully_clean`) implements the asymmetry the skill documents between axiom 1
(soft-degradable: ship the closest version with a warning) and axioms 2/3/4 (hard gate, no
ship-with-warning escape hatch in `schema.json`): `format_success` -> `end_success` assembles the
`schema.json`-shaped `LocalizationBundle`, while `format_failure` -> `end_failure` surfaces the
specific still-failing axiom-tagged checks rather than a generic rejection message.

## 3. Axioms/checks that could not be ported with full, unmodified fidelity

Ported **faithfully and verified** (see report for the full test methodology): axiom 1's exact
1.10/0.5 ceiling/floor on Unicode-codepoint-aware length; axiom 2's 5 banned-claim archetypes
(7 patterns after expanding the 3-verb "erradica/suprime/sana" alternation), case-insensitive,
whitespace-tolerant, accent-insensitive, comma-optional, register_profile-conditional; axiom 3's
universal tú-only ban with the same normalization; axiom 4's `AUTHORITY_TOKENS` closed list,
`collapseSpacedAcronyms` (both the ALL-CAPS-spaced and lowercase-dot-glued forms), diacritic
stripping, and invisible-character stripping (all 6 codepoints: ZWSP/ZWNJ/ZWJ/BOM/WORD
JOINER/SOFT HYPHEN, plus NFD combining-mark removal for the combining-acute-accent bypass).
A 27-case regression suite mirroring `scripts/validate.js --selftest`'s adversarial checks
(all-caps, doubled whitespace, dotted/spaced acronyms, accent-stripped phrases, ZWSP/soft-hyphen/
combining-mark obfuscation, NFD-decomposed accents) passes 27/27 against the ported Python.

What is **not** a literal 1:1 port, disclosed honestly:

- **The two-layer ajv-raw-pattern + hand-written-secondary-normalized-recheck structure
  (axioms 2/3) is collapsed into one always-normalized check.** The original always strips
  invisible characters and diacritics before the *secondary* recheck only, because vanilla
  JSON Schema's `pattern` keyword has no preprocessing step and so the *primary* ajv layer
  cannot normalize at all. Dify's code node has no equivalent "two separate validators" concept,
  so `validate_code` always normalizes first. This is a strict superset of what the original
  would catch, never weaker -- but it is a structural simplification worth naming rather than
  silently presenting as identical.
- **The retry loop itself is an architectural translation, not a literal feature of the source
  skill.** In the original, a single LLM/agent turn performs Phase 2D/2E's self-check
  reasoning *within one generation pass* before ever emitting JSON. Dify workflow nodes cannot
  do in-call self-reflection that way, so this port externalizes it into up to 3 separate `llm`
  calls gated by a real `code`-node judge in between. This is arguably *stricter* (a real
  external check gates the output rather than trusting the model's self-report), but it is a
  different execution shape than "one coherent agent turn," and is called out rather than implied
  to be the same mechanism.
- **Phase 3 (用户触发返工 L1/L2/L3) has no in-graph representation.** Phase 3 is inherently
  conversational ("太长了" / "这版太保守了" / "换个地区" / "整篇重来" as follow-up user turns),
  which does not fit `app.mode: workflow` (one-shot, no conversation turns).
  The mapping instead is: re-invoke this same workflow with adjusted `start` inputs from the
  calling side (a different `register_profile` for "太保守了/太激进了", a different
  `target_region` for "换地区" when it's within v1 scope, resubmitting for "整篇重来"). The one
  Phase 3 row with **no** valid mapping at all -- "人称不对/换个更正式的语气" -- correctly has no
  implementation here either, matching the source's own "只支持 tú，没有对应返工路径" statement.
- **Class A's "固定拒绝话术追问" (ask once more) is not a retry loop.** `workflow` mode has no
  multi-turn re-prompt concept, so the empty-`source_script` path is: Dify's own `required: true`
  platform-level guard on the start variable (first line of defense) plus a defensive in-graph
  check (`normalize_inputs` + `input_gate`) that reproduces the skill's exact fixed refusal
  wording as a dedicated `end_input_error` output if an empty value still reaches the graph (e.g.
  a caller bypassing client-side validation). No re-ask loop is implemented, since that is
  inherently a conversational turn this app mode does not have.
- **`register_profile`'s invalid-value fallback is new logic, not in the source spec.**
  workflow.md documents a soft-degrade path only for `target_region`; it never says what should
  happen if `register_profile` is given but is neither `default` nor `compliance-conservative`
  (schema.json's 2-value enum leaves no valid third state). This port falls back to `'default'`
  with a warning, by analogy with `target_region`'s documented philosophy (always have a safe,
  disclosed fallback, never hard-reject a soft field) -- but this specific fallback choice is an
  extrapolation this build made, not something workflow.md/axioms.md states.
- **Known residual gaps already disclosed in the source's own `axioms.md` are carried over
  unchanged, not fixed or expanded.** `INVISIBLE_CODEPOINTS` is still exactly the same 6
  codepoints (not an exhaustive Unicode format-character enumeration); axiom 4's
  `AUTHORITY_TOKENS` is still the same closed list (cannot catch a wholly invented institution or
  doctor name outside FDA/Harvard/OMS/clinical-proof wording). The goal is to port the same
  rules at the same strictness, not to silently alter limitations the source skill itself
  already named as open TODOs.
- **Dify Knowledge Base is deliberately not wired up.** `profiles/compliance-conservative.md`'s
  5 banned phrases and 6 hook templates are small and static, not a corpus needing retrieval, so
  they are folded directly into `generate_llm`'s system prompt instead, skipping unnecessary KB lookup overhead.
- **No live Dify workspace was available to test actual runtime execution of the `loop`
  container** (loop_variables initialization, break_conditions evaluation, assigner writes).
  Verification here is the maximum achievable offline: (a) the strict structural validator
  reports 0 errors/0 warnings, (b) every node's `loop`/`loop-start`/`assigner` field shapes are
  copied field-for-field from a real working Dify 1.16.0 example
  (`examples/dify-1.16.0/07-quality-loop.yml`) rather than invented from the prose reference docs
  alone, and (c) all four code nodes' Python bodies were extracted and executed standalone against
  27+25 test cases, including one bundle round-tripped through the *original* skill's own
  `node scripts/validate.js` (ajv + hand-written checks), which passed. Actual Dify Cloud import
  and a live run are the one verification step this environment cannot perform.

## 4. Final validator output (clean)

Command:
```
python scripts/validate_dsl.py --strict --target-version 0.7.0 dify-apps/100x-localize.dify.yml
```
Output:
```
== dify-apps\100x-localize.dify.yml
OK
```
JSON form (`--format json`):
```json
{
  "path": "dify-apps\\100x-localize.dify.yml",
  "status": "valid",
  "summary": {
    "errors": 0,
    "warnings": 0
  },
  "diagnostics": []
}
```
