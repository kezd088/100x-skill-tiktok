# 100x-exaggerate -> Dify Workflow DSL — conversion notes

Source skill: `skills/100x-exaggerate/` (v1.2.0)
Output: `dify-apps\100x-exaggerate.dify.yml` (`app.mode: workflow`, `version: "0.7.0"`, 9 nodes / 8 edges)

## 1. What needs manual reconnection after import

- **LLM model selection.** The `generate_beats` node ships with a placeholder
  `model.provider: langgenius/openai/openai`, `model.name: gpt-4o-mini`, matched by a
  placeholder `dependencies[0].marketplace_plugin_unique_identifier: langgenius/openai:0.2.6@...`.
  Reselect the actual model/credentials in the target workspace after import — this is
  placeholder is intentional (it will need reselecting in the target workspace regardless), not an oversight.
- **Dependency hash.** The marketplace plugin identifier's trailing `@hash` is copied from
  this skill repo's own reference example (`05-question-classifier.yml`) purely so the
  string has a syntactically plausible shape; it is not a real installable version pin.
  Dify will either resolve the real `langgenius/openai` plugin already installed in the
  workspace or prompt to install/reselect it.
- **Start-node `select` options for `hat_level`.** Options are the literal 3-value enum
  (`blackhat`/`grayhat`/`whitehat`); no change needed, but if this app is ever embedded in
  a form where end users shouldn't see raw hat-level jargon, the labels may want localizing.
- **No secrets, tokens, or workspace-bound IDs are embedded anywhere in this file** — nothing
  else requires credential reconnection.

## 2. workflow.md phases -> nodes

`start_1` (硬性必填 `source_script` paragraph + 软性可选 `hat_level` select / `market`
text-input) receives Phase 1's 类别 A/B inputs. `calibrate_ceiling` (code, python3) is a
direct, deterministic port of Phase 1's "类别 B 三级降级" table — both given / hat_level-only
/ neither-given — producing `effective_hat_level` + `effective_market` + `warnings`, with no
LLM call involved since this step is pure lookup logic, not judgment. `generate_beats` (llm)
covers Phase 2A (夸张点生成) and 2B (反差点生成) in one pass: its system prompt embeds
axioms.md 公理1's full 5-technique / 4-contrast_type closed enum tables (with the same short
Chinese definitions the repo's own axioms.md table gives, not any private-corpus wording),
the axiom-3 ceiling rule text, the axiom-4 non-degeneracy requirement, and the SKILL.md
禁用词 list, then asks for exactly the `exaggeration_beats[]`/`contrast_beats[]` JSON shape.
`validate_bundle` (code, python3) is Phase 2C's "逐条自检" + Phase 2D's "批量自检" + Phase
3's pre-return gate collapsed into one hand-written pass: it parses the LLM's JSON, re-checks
every structural constraint schema.json declares (required/additionalProperties/enum/pattern/
minLength/maxLength/minItems — see §3 on why ajv itself can't run here), then — only if
structurally clean, mirroring validate.js's own "ajv first, aggregates second" order — runs
axiom 2 (literal substring anchoring), axiom 4 (contrast non-degeneracy), and axiom 3
(hat_level+market calibration ceiling, full `isUsMarket`/segment-split/alias-table port
including exact-segment market matching and `-`/`&` delimiter handling). `route_valid`
(if-else on `validate_bundle.is_valid`) implements Phase 3's "全部校验通过才可以把 JSON
作为终稿返回" gate. The pass branch (`assemble_output`, template-transform) builds the
optional human-readable Markdown summary Phase 3 step 3 describes ("JSON 是唯一的机器可读
契约，Markdown 是给用户读的附加产物"), then `end_pass` returns `status`/`bundle_json`/
`summary_markdown`/`warnings`. The fail branch (`format_fail_report`, template-transform)
turns the specific error list into a readable report, then `end_fail` returns `status` plus
the verbatim `validation_errors` array (each entry keeps its `[schema:...]`/`[axiom2]`/
`[axiom3]`/`[axiom4]` tag) so a caller sees exactly which check failed, never a generic
"generation failed" message.

## 3. Design decisions

- **if-else, not loop, for the regenerate-on-fail path.** workflow.md Phase 2C describes a
  bounded per-*beat* rewrite (retry a single beat up to 3 times, keep best version on
  persistent failure) as part of the LLM's own generation discipline, not a graph-level
  control-flow loop — that per-item judgment call belongs inside one LLM pass, not a Dify
  `loop` container. Phase 3's gate ("not returned as final until it passes") is the one
  genuinely graph-level control point, using if-else as the default routing mechanism.
  default there. I did not hand-author a Dify `loop` node for a whole-bundle regenerate
  cycle: the reference material (`node-schemas.md`, `official-0.7-target.md`) repeatedly
  warns to copy loop internals (`loop-start`, `parentId`/`isInLoop` wiring) from a real
  workspace export rather than hand-authoring them, and I had no such export to copy from
  for this skill. A hand-built loop risks being structurally plausible but operationally
  unreliable on real Dify Cloud import, which is a worse failure mode than a single-pass
  generate -> validate -> explicit, specific fail-end. If a regenerate loop is wanted later,
  the safest path is exporting a minimal loop skeleton from a real Dify workspace once and
  splicing `generate_beats` + `validate_bundle` + `route_valid` into it.
- **No knowledge-retrieval / KB node.** The market/hat_level ceiling table is 3 hat_level
  entries x a 6-alias market list x one delimiter regex — the same small closed table
  axioms.md itself keeps as inline prose (explicitly flagging the burden of keeping
  axioms.md's prose table and validate.js's code table in sync by hand, as an accepted
  trade-off). The 5 exaggeration techniques and 4 contrast types are likewise a small fixed
  enum with one-line definitions. Neither warrants a queryable Dify dataset; both are
  hand-coded directly (ceiling logic in `validate_bundle`'s code, enum+definitions in
  `generate_beats`'s system prompt), matching the source skill's own choice not to
  externalize this into a lookup dataset.
- **Two `end` nodes, not one with a status flag only.** Both are literal ports of the
  Phase-3 "pass" and "Phase 1/2 failure handling" outcomes described in workflow.md; keeping
  them separate lets the fail path surface `raw_llm_output` for debugging without cluttering
  the pass path's output contract.
- **`market` given / `hat_level` missing is an interpolated case, not an invented one.**
  workflow.md Phase 1 类别 B literally enumerates exactly 3 combinations (both given /
  hat_level-only / neither), leaving "market given, hat_level missing" unstated. I resolved
  it in `calibrate_ceiling` by applying the "hat_level missing -> infer grayhat" half of rule
  3 together with the "market given -> use as-is, no conservative default needed" half of
  rule 1, since axiom 3's own mechanism (the market default branch triggers only on
  *market absence*, independent of hat_level) supports exactly this reading and no other
  documented rule contradicts it. This is flagged in the code node's own comment and here,
  to make design decisions explicit and avoid silently inventing behavior beyond the spec.

## 4. Axioms/checks ported, and one honest gap

All 4 axioms are ported at the **same** strictness as `scripts/validate.js`, verified by
literally re-running validate.js's own 8-point `--selftest` scenario matrix against the
extracted Python from this DSL's `validate_bundle` node (see verification log in §5) —
every one of the 8 behaviors matched, including the two regression cases that pin the exact
behavior down: 5 non-US markets containing "us"/"美国" as substrings — 西语区/Russia/Australia/
Belarus/南美国家 — must all still PASS (proving `isUsMarket` is exact-segment matching, not
substring matching), and `美区-通用` / `US & Canada` must still FAIL (proving `-`/`&` are in
the delimiter set). Axiom 1 (closed enums) is enforced twice, redundantly, by
design: the LLM is instructed to the closed lists, and `validate_bundle` independently
re-checks enum membership regardless of what the LLM actually emitted — nothing here trusts
the model's compliance.

**One thing is not, and cannot be, faithfully ported: ajv itself.** `scripts/validate.js`
runs real ajv 8.x (`new Ajv({allErrors:true, strict:false})`) compiled directly from
`schema.json`, which is the repo's actual documented mechanism for axiom 1's "closed enum"
and all the structural constraints (per `metadata.json.validation.structural_and_per_item`:
"executed by ajv... this is everything vanilla JSON Schema CAN express"). Dify's sandboxed
code node cannot import ajv or third-party schema packages (cannot assume `jsonschema` is importable in arbitrary Dify sandboxes), so `validate_bundle`'s structural-check block is a **hand-written
re-implementation** of schema.json's constraints in stdlib Python, not a schema-driven
validator. I mitigated the usual risk of hand-written structural checks silently drifting
from schema.json (an early hand-rolled validator in this repo's own history once let a
schema-forbidden field through silently — the exact reason the source skill moved to ajv) by
re-deriving every constraint directly from the
current `schema.json` field-by-field (required/additionalProperties/enum/pattern/minLength/
maxLength/minItems) rather than from memory, and by testing the additionalProperties path
explicitly (selftest check 2, confirmed FAIL as expected — see §5). But this is a structural
difference worth being honest about: this DSL's validation is "hand-written code that
currently matches schema.json" rather than "schema.json executed by a real validator", so the
two can only be kept in sync by a human remembering to update both files together — exactly
the coupling risk `schema.json`'s own header comment warns ajv exists to remove. This is
disclosed, not hidden, to call out architectural trade-offs and anything not fully portable.

Two structural constraints are enforced **by construction** rather than by an explicit
runtime check, which is a mechanical difference from ajv (which validates an arbitrary input
object) even though the *rule* itself is identical: top-level `additionalProperties: false`
(the `bundle` dict literal in code has exactly the 4 allowed keys — there is no code path
that could add a 5th) and `meta`'s three required fields / `generated_by` const (always
constructed literally, never taken from arbitrary input). `exaggeration_beat_item` /
`contrast_beat_item`'s `additionalProperties: false` genuinely needs (and has) an active
runtime check, since those objects come from the LLM's free-form JSON output.

One rule was deliberately **not** added even though it might look like a reasonable
strengthening: duplicate `beat_id` values across an array are not flagged. Neither
`schema.json` (no `uniqueItems`/custom keyword) nor `scripts/validate.js` (no dedup check)
enforces this in the source skill — adding it here would be scope creep beyond "port the same
rules at the same strictness," so it was left out to avoid silently shipping a stricter DSL
than the skill it was ported from.

The SKILL.md 禁用词 list (弱化表达/AI客服腔调/编造宣称) is carried into `generate_beats`'s
system prompt as instruction, matching its actual enforcement level in the source skill:
it is house style guidance in `SKILL.md`, not one of the 4 formal axioms, and
`scripts/validate.js` has no machine check for it either. So this DSL doesn't invent a new
machine gate for banned words — that would again be stricter than the source.

## 5. Validator output (final, clean run)

```
$ python "...\dify-workflow-dsl-skill\scripts\validate_dsl.py" --strict --target-version 0.7.0 --format json "dify-apps\100x-exaggerate.dify.yml"
{
  "path": "dify-apps\\100x-exaggerate.dify.yml",
  "status": "valid",
  "summary": {
    "errors": 0,
    "warnings": 0
  },
  "diagnostics": []
}
```

0 errors, 0 warnings under `--strict`. No warnings were suppressed or left unaddressed —
there simply are none to justify.

**Additional verification beyond the DSL structural validator** (the validator only checks
`def main(...)` exists via regex, not that the code is correct Python, and cannot exercise
Dify's own runtime): both `code` nodes' source was extracted from the YAML and (a) parsed
with Python's `ast` module to confirm valid syntax, (b) actually executed against the 3 real
`evals/*.json` bundles from the source skill (re-serialized as if they were the LLM's raw
output, including one run wrapped in ```json fences to exercise the defensive fence-stripping
path) — all 3 passed `validate_bundle` end to end — and (c) executed against hand-built
counterexamples reproducing every one of `scripts/validate.js --selftest`'s 8 checks
(baseline pass, additionalProperties rejection, technique-enum rejection, contrast_type-enum
rejection, axiom-2 fabricated-quote rejection, axiom-4 degenerate-contrast rejection, axiom-3
US-market cap rejection, axiom-3 five-non-US-market pass, axiom-3 two-compound-US-market
rejection) — all 8 reproduced the original's PASS/FAIL behavior exactly. The Phase-1 degrade
code node was separately executed against all 4 hat_level/market presence combinations plus
one invalid-enum input, confirming the interpolated "market given, hat_level missing" case
(§3) resolves as designed and flows correctly end-to-end into `validate_bundle`.
