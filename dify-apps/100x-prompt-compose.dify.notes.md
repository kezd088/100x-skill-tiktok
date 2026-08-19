# 100x-prompt-compose -> Dify Workflow DSL — build notes

Source skill: `skills/100x-prompt-compose/`
Output DSL: `100x-prompt-compose.dify.yml` (29 nodes / 50 edges, `app.mode: workflow`, `version: "0.7.0"`)

## 1. Manual reconnection needed after import

- **LLM/classifier model bindings.** `wrap_veo`, `wrap_seedance`, `classify_tid`, `classify_shot` all use the placeholder `provider: langgenius/openai/openai`, `name: gpt-4o-mini`. Reselect a real, authorized model for each after import (the marketplace dependency entry for `langgenius/openai` is included but the workspace still needs its own credential).
- **Start-form JSON inputs.** `variables_used_json` and `existing_refs_input_json` are plain `paragraph` fields holding hand-typed/upstream-generated JSON strings, not a Dify-native structured form (Dify's `start` node cannot express "one of 14 different variable sets depending on which template is chosen" — see design note in §2). Whoever wires this workflow into a chat app or an upstream agent needs to actually produce valid JSON for these two fields; there's no client-side schema validation before it reaches `prep_ctx`.
- **No knowledge-base node was added.** This skill's data (`templates.json`, `profiles/veo.md`, `profiles/seedance.md`) is small, closed, and enumerable, and axiom 1 requires byte-for-byte reconstruction against it — a KB retrieval node would add non-determinism (retrieval ranking, chunking) to something that must be exact. All of it is instead embedded as literal Python dict/list data inside the relevant `code` nodes. No `dataset_id` placeholder needed.
- **Positions/layout** are approximate canvas coordinates for readability, not a polished auto-layout; expect to tidy the graph visually after import.

## 2. workflow.md phases -> nodes

**Phase 1 (接收+校验)** maps to `start -> has_tid -> {validate_tid | classify_tid -> map_classify} -> merge_tid -> prep_ctx -> input_ok`. `prep_ctx` is the workhorse: it looks up the resolved template's metadata (category, required/optional variables, `establishes_lock`/`references_lock`, `model_hint`), rejects on missing required variables (never guesses), auto-fills omitted *optional* variables as `""` (see §3 for why), and resolves `model` to `model_hint[0]` with a warning when a video template's model is left blank — mirroring workflow.md step 4's "ask once, default after no answer" behavior collapsed into this single-shot batch `workflow` app (no human-input node; see §3). A failed `input_ok` check routes straight to the `reject_input` terminal with the specific missing-variable list, standing in for workflow.md's "追问" turn since a `workflow` app has no conversational back-and-forth on its own.

**Phase 2 (渲染+模型包装+自检)** maps to `render_body` (axiom-1 construction: `{key}` substitution, the three hardcoded conditional clauses, VID-A/VID-F/PART-HOOK bracket expansion, plus axiom-2 construction: reference-lock first_lock/reference_reuse assignment) `-> verify_axiom1` (independent reconstruction-and-diff against the same embedded template data, mirroring `scripts/validate.js`'s `reconstructExpectedBody`/`axiom1Check` architecture) `-> verify_axiom2_3` (referential-integrity check mirroring `checkReferenceLockIntegrity`/`scanVariablesUsedForRefClaims`, plus the scene/place/scenes/rooms lighting-word scan that in the source skill lives entirely in `schema.json`'s `patternProperties`, reimplemented here in plain Python since Dify's sandboxed code node cannot run ajv) `-> is_video -> model_branch {wrap_veo->check_veo | wrap_seedance->check_seedance | classify_shot->assemble_jichuang} | skip_video -> merge_video -> assemble_final`. `assemble_final` is the "逐项自检" step: it consolidates all four axioms' pass/fail and error lists and builds the final `ComposedPromptBundle` JSON.

**Phase 3 (用户触发的返工)** is **not** implemented as in-graph nodes — see §3.

## 3. What could not be faithfully ported (disclosed, not silently dropped)

- **即创 has no duration/banned-word source material — preserved as a real gap, not invented.** `classify_shot` + `assemble_jichuang` only classify into the 7 narrative-shot categories (情绪/痛点/产品/场景/对比/转折/CTA) and pass `rendered_body` through as Chinese `final_prompt_wrapped` unchanged. `assemble_jichuang`'s `axiom4_pass` is `True` whenever a valid shot category was assigned — there is no duration cap or banned-word list check for 即创 anywhere in this DSL, exactly matching the source skill's own documented limitation (axioms.md axiom 4, SKILL.md 核心约束 #4). I did not invent placeholder duration/banned-word rules to make 即创 "look" as strictly checked as veo/seedance.
- **The veo/seedance banned-word scan's "professional" false positive is preserved, not fixed.** `check_veo`/`check_seedance` use plain `\bword\b` word-boundary regex matching (mirroring `modelWrapperCheck` in `scripts/validate.js` exactly), so a `persona`/dialogue value that truthfully translates someone's real job title into English (e.g. "a health professional") will still trip the veo banned-word list even though it isn't an AI-cliché aesthetic adjective. I did not add part-of-speech or semantic disambiguation — doing so would mean silently narrowing a banned-word list that was ported verbatim from the private repo's `veo`/`seedance` material, which axioms.md explicitly says not to do without evidence of the original scope.
- **No automatic 3x-retry loop.** workflow.md's Phase 2 failure handling says a `video_unit` that fails axiom 4 gets rewritten up to 3 times, keeping the best version if all 3 fail. This DSL generates `wrap_veo`/`wrap_seedance` exactly once per run and, on failure, routes straight to `end_fail` with the specific failing checks. Implementing true multi-attempt retry-and-keep-best inside a Dify `loop` container was judged to add substantial graph complexity for behavior that is fundamentally about interactive refinement — a poor fit for a single-shot batch `workflow` app. The caller (human or upstream agent) re-triggers the whole run instead. Documented as a scope decision, not a silent omission.
- **Template-candidate listing degrades to single-best-guess-or-UNCLEAR.** workflow.md Phase 1 step 1 says an ambiguous requirement description should list multiple candidate templates for the user to pick from ("不代选"). Dify's `question-classifier` (`classify_tid`) can only emit one `class_name`; there is no native way to return "these 3 templates all plausibly match." It picks its single best guess, or `UNCLEAR` when nothing fits (routed to the same missing-template rejection as an invalid `template_id`). Flagged on a canvas note next to the node.
- **`meta.established_refs_after` representation differs slightly from the hand-written evals.** The source skill's evals omit this key entirely for templates with no lock semantics (e.g. `PART-CTA`); `render_body` here always emits it (defaulting to whatever `existing_refs_input` was, since `checkReferenceLockIntegrity` only reconciles it when `reference_locks` is non-empty anyway — confirmed by running this DSL's own `verify_axiom2_3` logic against that exact case, see §4). This is strictly more information, not less, and doesn't affect any pass/fail check; noted here so it isn't mistaken for an unnoticed bug.
- **PART-CTA's "your your {object}" duplication is preserved verbatim**, not patched — confirmed byte-for-byte against the real eval fixture (`example-04-cta-part-generic.json`) during testing (see §4). This is `templates.json`'s own body text design, faithfully reproduced.

## 4. Validation

Structural validator (0 errors, 0 warnings):

```
python scripts/validate_dsl.py --strict --target-version 0.7.0 dify-apps/100x-prompt-compose.dify.yml
== dify-apps\100x-prompt-compose.dify.yml
OK
```

JSON form: `{"status": "valid", "summary": {"errors": 0, "warnings": 0}, "diagnostics": []}`.

Beyond structural validation, every `code` node's embedded Python was extracted and actually executed (not just syntax-checked) against the source skill's own real `evals/*.json` fixtures and against adversarial inputs mirroring `scripts/validate.js`'s own `--selftest` suite:

- `render_body`'s output matched `evals/example-01-supplement-vial-lock.json`, `example-02-testimonial-veo-reference-reuse.json` (reference_reuse path), `example-03-cleaning-spray-seedance.json`, and `example-04-cta-part-generic.json` **byte-for-byte** on `rendered_body` and exactly on `reference_locks`.
- `verify_axiom1` correctly passed all four real fixtures and correctly failed a paraphrased `rendered_body`.
- `verify_axiom2_3` correctly passed all four real fixtures; correctly failed a fabricated `参考图77人物` claim embedded in a non-whitelisted `persona` key on a lock-free template (mirrors `--selftest` check 16/16); correctly failed real axiom-3 violations (`"soft warm lighting"` and `"natural light"`); correctly allowed a weather word (`"阴天"`).
- `check_veo`/`check_seedance` correctly accepted `example-02`'s and `example-03`'s own real `final_prompt_wrapped` text, and correctly failed on injected banned words (`cinematic`, `flawless`) plus a missing trailing phrase.
- `prep_ctx` correctly rejected a missing required variable, correctly defaulted an omitted optional variable (`PART-CTA.urgency`) to `""`, and correctly defaulted an unspecified video `model` to `model_hint[0]` with the matching warning text.

## 5. Scope boundary

This DSL stops at producing the packaged, ready-to-feed prompt (`rendered_body` for images/通用件, or `video_unit.final_prompt_wrapped` + `duration_seconds` for video). **It does not call any real Veo, Seedance, or 即创 generation API** — `wrap_veo`/`wrap_seedance` are text-transformation LLM calls only (Chinese `rendered_body` -> model-specific English packaging text), not video-generation calls, and there is no `tool`/`http-request` node anywhere in this graph pointed at an actual generation endpoint. That integration is explicitly out of scope for this prompt packaging workflow.
