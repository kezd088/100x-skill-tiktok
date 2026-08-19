# Step2 · 人设 × 夸张反差 × 场景 — Dify Workflow DSL 建造笔记

Output DSL: `step2-persona-exaggerate-scene.dify.yml` (`app.mode: workflow`, `kind: app`,
`version: "0.7.0"`), 21 nodes / 20 edges.
KB seed docs: `kb-seed-persona-patterns/` (51 markdown files, one per canonical
`persona_pattern` atom).

This is a **new, original-design** app — it is not a straight port of `100x-persona` or
`100x-exaggerate`. It replaces an earlier direct-LLM-generation approach (tested in real
production, found to produce poor-quality personas/scenes) with a retrieval-**grounded**,
citation-checked generation mechanism. See §3 for exactly what that means and how it's
enforced.

---

## 1. Manual reconnection checklist (do this before running in a real workspace)

| Item | Where | What to do |
|---|---|---|
| Model provider/model | 3 `llm` nodes: `llm_generate_persona`, `llm_generate_exaggerate`, `llm_generate_scene` | All currently `provider: langgenius/openai/openai`, `name: gpt-4o-mini` (placeholder). Reselect the real model in each node after import — expected regardless of provider. |
| Top-level `dependencies` | root `dependencies:` | One `marketplace` entry for `langgenius/openai` with a placeholder hash (`@REPLACE_WITH_REAL_HASH_AFTER_IMPORT`), matching both precedent apps' convention. Dify's own export will regenerate the real dependency list once you reselect real models — you don't need to hand-fix the hash. |
| **`dataset_id` placeholder** | `kb_retrieve_persona_patterns.dataset_ids: ["REPLACE_WITH_DATASET_ID"]` (the only KB reference in this file — there is no KB-write-back node in this app, see §6) | **No real dataset exists yet.** Before this app can do anything meaningful: (1) create a Dify Knowledge dataset, (2) upload all 51 files from `kb-seed-persona-patterns/` into it via the Dify UI (drag-and-drop batch upload works fine for 51 small files), (3) point `dataset_ids` at its real ID. Until this is done, `code_validate_persona` will deterministically fail every run with an explicit `[retrieval] kb_retrieve_persona_patterns returned 0 candidates...` error (verified in local testing, see §7) — not a silent/confusing failure. |
| Chunking settings on the new dataset | Dify KB dataset config, set at upload time | Recommend "parent-child" or a chunk size generous enough that each ~600-900 character atom doc stays in one chunk (or at minimum, that the first chunk of any doc contains the compact `PATTERN_NAME:`/`AVOID_WHEN:`/`COMPLIANCE_RISKS:` marker block — that block is placed right after the `#` title, before the longer prose sections, specifically so it survives being the *first* chunk even under aggressive default chunking; see §4 for why this placement matters). |
| `top_k: 3` on `kb_retrieve_persona_patterns` | `multiple_retrieval_config.top_k` | Provides 2-3 real, proven persona patterns for grounding. Raise this only if you also raise the LLM's tolerance for reading more context; the citation-check code scales fine either way (it just needs a real citable name to exist per persona, from however many candidates come back). |

---

## 2. What "grounded-creative generation with citation" means here, concretely

The repo owner explicitly rejected a retrieve-and-fill-in-the-blank mechanism (mirroring how
`100x-prompt-compose` does exact template-filling for image/video prompts) as defeating the
purpose of a *methodology* skill. The corrected mechanism, implemented identically for both
persona generation and scene generation:

1. **Retrieval surfaces real precedent, it does not supply output text.** `kb_retrieve_persona_patterns`
   returns 2-3 real `persona_pattern` atoms (name, psychology, applicability, avoid_when,
   compliance_risks — see §4 for the doc format). The LLM reads these as *constraints and
   inspiration*, never as fill-in-the-blank source text.
2. **Every persona must cite what grounded it, and the citation must be checkable.**
   `persona_item.grounded_in[]` requires each entry's `pattern_name` to be copied **verbatim**
   from a `PATTERN_NAME:` line actually present in this run's retrieved candidates.
   `code_validate_persona` does a real, mechanical substring check of every cited name against
   the actual retrieved chunk text (not against a static list, not against the LLM's own claim)
   — a citation that doesn't match any real retrieved candidate is a hard `[citation]` failure.
   This is the one check in this whole file that is fully mechanical and has no honesty caveat:
   either the exact string is present in the retrieved text or it isn't.
3. **Scene generation follows the same shape**, with `persona_ref`/`contrast_refs` playing the
   role of "what grounded this" instead of a KB pattern name (see §5) — scenes cite which
   persona and which contrast beat(s) they respond to, and referential integrity is checked the
   same mechanical way (does that id actually exist among this run's generated personas/beats).
4. **Never verbatim retrieve-and-fill for either stage.** No node in this pipeline does template
   substitution against retrieved/generated text; every LLM call is asked to write fresh,
   script-specific prose, and every downstream check verifies *properties* of that prose
   (citation validity, literal-quote anchoring, enum membership, referential integrity) rather
   than comparing it against a fixed template.

---

## 3. New linking schema invented for this integration (clearly not copied from either source)

Neither `100x-persona/schema.json` nor `100x-exaggerate/schema.json` declares any field that
connects a persona to an exaggeration/contrast beat, or a beat to a scene (`100x-exaggerate`'s
own schema is "fully decoupled", with no `persona_ref`/`scene_ref` fields in the source). Every field below is **original to this
integration**, designed fresh for this pipeline:

- `exaggeration_beat_item.persona_ref` (new) — `PERSONA_...` id, required. Which persona is
  understood to deliver/embody this exaggeration beat.
- `contrast_beat_item.persona_ref` (new) — same shape, required, same reasoning.
- `scene_item.persona_ref` (new) — `PERSONA_...` id, required, single (not an array) — "scene
  follows persona" per the owner's explicit direction, so a scene has exactly one owning
  persona, not a set of them.
- `scene_item.contrast_refs` (new) — array of `CTR_...` ids, **can be empty** — a scene doesn't
  have to visualize any particular contrast beat (plenty of scenes are just "where this persona
  naturally delivers this script span"), but when it does, this is how it says so.
- **The new `state_before_after` ⇒ ≥2 scenes rule** (`code_validate_scene`'s
  `integration-before-after` check) — for every `contrast_beat` whose `contrast_type` is
  `state_before_after`, the code counts how many scenes reference that beat's `beat_id` in
  `contrast_refs`; fewer than 2 is a hard failure naming the exact beat id and the actual count
  found. This is the direct mechanical enforcement of the owner's stated requirement ("a
  state_before_after contrast beat may require the scene to have TWO distinct settings"). It is
  a **new rule**, not present in either source skill individually, and only possible because
  this integration links scenes to contrast beats in the first place.
- **No `pairings[]` join table.** `100x-persona`'s original schema used a separate `pairings[]`
  array to bind persona+scene+script-span together. This integration deliberately does **not**
  carry that structure forward: since beats and scenes now self-declare their own `persona_ref`/
  `contrast_refs`, a separate join table would be redundant (the same relationship expressed
  twice, with the attendant risk of the two copies drifting apart). This is a deliberate
  simplification, not an oversight — flagging it explicitly to contrast with 100x-persona's
  original schema: what's kept is the *referential-integrity discipline* pairings represented (ids must resolve, nothing orphaned),
  not the literal join-table shape, which doesn't fit a design where every entity already
  carries its own refs.
- **Closed 6-value `camera_position` enum** (new) — `rear_camera_pov` / `handheld_pov` /
  `handheld_selfie` / `gopro_pov` / `mirror_selfie` / `night_vision`, derived from the 6-category
  *structure* of `doc-UGC六大机位类型.md` (which camera position exists, what it's typically
  used for). Deliberately **excludes** private-corpus usage-frequency counts from the shipped prompt/schema —
  a public-facing DSL prompt carries the category structure and generic usage guidance only, not private corpus analytics.
  This is a conservative judgment call to keep the DSL clean and public-ready.

---

## 4. KB seed docs (`kb-seed-persona-patterns/`) — format and why

51 files, one per **canonical** `persona_pattern` atom (filtered `_is_canonical is not False`
from both `atom-原子库·内部.jsonl` (28 atoms) and `atom-原子库·外部.jsonl` (23 atoms); the
other 42 rows across both files are `merge`-status duplicates pointing at a canonical id via
`merge_target`, correctly excluded rather than duplicated). One file per atom rather than a few
consolidated files was a deliberate choice: it keeps each retrievable unit mapped 1:1 to one
pattern, which is what makes the citation-check in §2 point 2 reliable — a consolidated file
risks a retrieved chunk mixing partial text from two different patterns, which would make "is
this cited name real" ambiguous. Dify's batch upload handles 51 small files in one UI action, so
this isn't materially more work for the human uploader than fewer, larger files.

Each doc's structure (see e.g. `A000033_权威诊断否定衰老.md`):

```
# 人设方法论：<name>

PATTERN_NAME: <name>
PATTERN_ID: <id>
PSYCHOLOGY_TAG: <psychology_L3>
AVOID_WHEN: <avoid_when joined with " | ">
COMPLIANCE_RISKS: <compliance_risks joined with " | ">

> 来源说明：...（属于哪个来源库、质量分、复用度等）

## 心理机制
...
## 方法论模式（结构参考，不是可直接照抄的成品文案）
<template_L2 + slots>
## 适用条件 / 何时应该避免使用这个模式 / 合规风险提示 / 本地化执行注意
...
```

The compact machine-readable block (`PATTERN_NAME:`/`AVOID_WHEN:`/`COMPLIANCE_RISKS:`) is placed
**immediately after the title**, before any prose, specifically so it's likely to survive being
in the *first* chunk if Dify's chunker splits a doc — `code_validate_persona`'s
compliance-heuristic check (§7) regexes for these exact marker lines out of whatever chunk text
comes back from retrieval, so if the marker block gets separated into a chunk that isn't
retrieved, that specific check silently has nothing to check (degrades to "no overlap found",
not a crash) — but the citation check itself only needs the `PATTERN_NAME:` line to appear
*somewhere* in *any* retrieved chunk from that document, which is robust to this either way.

**Compliance scan performed before writing these files**: I read through a consolidated review
dump of all 51 atoms' `name`/`psychology_L3`/`categories`/`avoid_when`/`compliance_risks`/
`localization_notes`/`slots[].example` fields (the fields most likely to carry raw specifics)
before generating the final markdown. Everything is already abstracted pattern-level language
(generic category tags like `heart_cardiovascular`, generic slot examples like "白大褂/营养师/
研究员", internal anonymized video ids like `V000661` — never a customer name, brand name,
product name, or customer-adjudicated category dictionary). This matches the private repo's own
design: `data/20-distilled/atoms/` is already a distilled/abstracted layer above raw transcripts,
not raw language itself.

---

## 5. workflow phases → Dify nodes

`start` (硬性 `source_script` + 软性 `hat_level`/`market`) → `calibrate_ceiling` (code, verbatim
port of `100x-exaggerate.dify.yml`'s own `calibrate_ceiling` node — same 3-level degrade table,
same "market given / hat_level missing" interpolated-case reasoning) → `kb_retrieve_persona_patterns`
(knowledge-retrieval, top_k 3) → **Stage A**: `llm_generate_persona` (grounded-creative + citation,
§2) → `code_validate_persona` (citation-real + evidence-quote substrings + hedge-marker
disclosure + compliance-heuristic disclosure + structural shape, §7) → `if_persona_valid` gates
to either `llm_generate_exaggerate` (pass) or `tpl_fail_persona`→`end_fail_persona` (fail, names
every specific failing check, never "please recheck"). **Stage B**: `llm_generate_exaggerate`
(100x-exaggerate's own prompt content, reused near-verbatim, + new `persona_ref` requirement) →
`code_validate_exaggerate` (100x-exaggerate's `validate_bundle` logic ported at identical
strictness — axiom 2/3/4 including exact-segment market matching and `-`/`&` delimiter
handling — plus the new `persona_ref` referential-integrity check) → `if_exaggerate_valid` gates the
same way. **Stage C**: `llm_generate_scene` (new prompt: scene-follows-persona + contrast-beat
awareness + closed camera enum) → `code_validate_scene` (100x-persona's vague-word-ban +
≥2-visual_props logic ported verbatim, + new camera-enum/referential-integrity/zero-orphan/
state-before-after checks) → `if_scene_valid` gates the same way. Success path:
`assemble_bundle` (code, merges all 3 stages' outputs + accumulated warnings into one bundle) →
`render_summary_md` (template-transform, human-readable Markdown) → `end_success` (exposes
`status`/`bundle`/`bundle_json`/`summary_markdown`).

---

## 6. Design decisions worth flagging

- **Single-shot generation per stage, not per-item iteration.** The graph uses one `llm` + one `code` node per generation phase — this matches
  `100x-exaggerate.dify.yml`'s shape (one LLM call producing the whole `exaggeration_beats[]` +
  `contrast_beats[]` array at once), not `100x-persona.dify.yml`'s more elaborate
  scan→iterate→assemble shape (which exists because that skill was ported standalone with its
  own multi-phase workflow.md). The simpler, single-shot-per-stage shape was chosen for all
  three generation stages here to keep the graph small enough to author and verify reliably (21 nodes vs. what
  would likely have been 60-90+ nodes under a fully iterated design).
- **No KB-write-back node.** `100x-persona.dify.yml` had a "write generated personas/scenes back
  to KB" step (`knowledge-index` nodes). This app does not write back to the persona-pattern KB
  dataset — that dataset is specifically real, human-curated pattern precedent (the 51 seed
  docs); writing freshly-generated, per-script personas into the same dataset would blur "real
  observed pattern" with "one-off generated instance" and weaken exactly the grounding signal
  the citation mechanism depends on. If a separate "generated output archive" dataset is wanted
  later, that's a new, distinct dataset from this one — out of scope here, not silently done.
- **`assemble_bundle` output has no `pairings`/join-table field** — see §3.
- **All 3 validate nodes and `calibrate_ceiling` return `status`/`error_count` alongside
  `is_valid`/`errors`**, matching `100x-exaggerate.dify.yml`'s existing convention (`status`:
  `"passed"`/`"failed"` string, `error_count`: `len(errors)`) for UI/debugging convenience.

---

## 7. Exactly how citation-checking works, and its honest limitations

**Citation-is-real check (`[citation]` tag) — fully mechanical, no caveat.** For every
`persona_item.grounded_in[].pattern_name`, `code_validate_persona` checks whether that exact
string appears as a substring inside the `title`+`content` of *any* item actually returned by
`kb_retrieve_persona_patterns` this run (verified against Dify 1.16.0's real
`Source` model — `api/core/workflow/nodes/knowledge_retrieval/retrieval.py`, fetched and
read directly from the pinned GitHub tag rather than assumed, since this was load-bearing).
There is no ambiguity here: either the name is present in real retrieved text or it isn't. A
hallucinated or paraphrased pattern name fails deterministically (verified: see §8).

**avoid_when/compliance_risks-not-violated check (`[compliance-heuristic]` tag) — best-effort,
lexical only, and I want to be direct about how weak this is.** For each citation that *did*
match a real retrieved chunk, the code regexes that chunk's `AVOID_WHEN:`/`COMPLIANCE_RISKS:`
marker lines, splits them into phrases, tokenizes each phrase (strip punctuation/whitespace,
drop a small stopword list, drop trivially short tokens), and checks whether any resulting
token appears as a case-insensitive substring inside the persona's own text fields
(`identity_label`+`authority_basis`+`audience_fit`+`delivery_style`+`appearance_note`). If a
token matches and the persona has no `risk_self_check` disclosure, it's a hard failure; if
disclosed, it passes and the disclosure is carried into `warnings`. This is the same
"disclose-or-fail" shape `100x-persona` already uses for its own hedge-marker heuristic,
reused deliberately rather than reinvented.

Honestly, here is what this check can and cannot do:
- It can catch a persona that echoes a distinctive keyword from its own cited pattern's
  avoid_when text (e.g. citing "权威诊断否定衰老" — whose avoid_when literally says "演员过
  年轻缺可信度" — while writing an `identity_label` that itself contains "年轻"). Verified in
  testing (§8).
- It **cannot** catch a semantic violation phrased with different words (e.g. avoid_when says
  "actor too young for credibility" and the persona describes someone who is contextually young
  without ever using a shared token). No semantic/embedding model runs inside Dify's sandboxed
  code node (stdlib only) — this is the same structural ceiling this whole ecosystem's other
  "semantic" checks already live with (100x-persona's hedge-marker check has the identical,
  explicitly documented blind spot for reversal-via-refutation-framing).
- It **can** false-positive on a coincidental keyword match that has nothing to do with the real
  risk (a token like a common short phrase reappearing for an unrelated reason). Because the
  check is disclose-or-fail rather than an unconditional block, a false positive costs a
  `risk_self_check` sentence, not a dead end — this asymmetry (cheap to clear if it's a false
  alarm, hard-blocks if genuinely un-cleared) was a deliberate choice, matching the same
  "sooner to force a human look than to silently pass" bias this repo already applies elsewhere
  (`100x-search-query`'s "宁可多提示不可漏提示" stance, cited by `100x-exaggerate/axioms.md`
  itself as the precedent for this kind of asymmetric default).
- **This is not a substitute for human compliance review of the final creative.** It only
  catches literal/lexical overlap between what an atom explicitly warns about and what the
  generated text explicitly says — nothing more.

**Evidence-quote-substring checks (`[axiom2]` tag)** and **hedge-marker disclosure
(`[axiom2-heuristic]` tag)** are unchanged in mechanism and honesty profile from
`100x-persona`'s own — see that skill's `axioms.md` for the full disclosure of what the
hedge check can/cannot catch (reversal via refutation/sarcasm framing is not detected; this port
does not attempt to close that gap, preserving the existing behavior of these inherited components from 100x-persona).

---

## 8. Local verification performed (no live Dify instance available)

1. **Strict DSL validator**, final clean run:

```
$ python scripts/validate_dsl.py --strict --target-version 0.7.0 --format json step2-persona-exaggerate-scene.dify.yml
{
  "path": "dify-apps\\step2-persona-exaggerate-scene.dify.yml",
  "status": "valid",
  "summary": { "errors": 0, "warnings": 0 },
  "diagnostics": []
}
```
0 errors, 0 warnings, exit code 0 — cleaner than either precedent app (`100x-persona.dify.yml`
carries 2 unavoidable `knowledge-index`-unknown-type warnings from the validator's own coverage
gap; this file doesn't use `knowledge-index` at all, see §6, so that gap doesn't apply here).

2. **All 5 `code` node bodies parsed with Python's `ast` module** directly from the final YAML
   (not from a separate copy) — all 5 parse as valid Python (`calibrate_ceiling` 50 lines,
   `code_validate_persona` 247 lines, `code_validate_exaggerate` 209 lines,
   `code_validate_scene` 155 lines, `assemble_bundle` 38 lines).

3. **All 5 `code` node bodies were `exec()`'d directly out of the final YAML** (not a
   hand-maintained copy) and re-run against realistic fixtures, confirming zero transcription
   drift between what was locally unit-tested during design and what actually shipped in the
   file. Covered: `calibrate_ceiling`'s 4 hat_level/market presence combinations;
   `code_validate_persona`'s baseline-pass and hallucinated-citation-fail cases (plus, in the
   earlier standalone test pass before final assembly, 9 more cases: paraphrased-evidence-quote,
   empty-grounded_in, hedge-undisclosed, hedge-disclosed, compliance-heuristic-undisclosed,
   compliance-heuristic-disclosed, zero-retrieval-candidates, additionalProperties-rejection,
   bad-enum-rejection — all 11 passed); `code_validate_exaggerate`'s baseline-pass,
   bad-persona_ref-fail, and US-market-cap-still-enforced cases (plus, in the earlier standalone
   pass, 8 more: missing-persona_ref, degenerate-contrast, the 5 non-US markets —
   西语区/Russia/Australia/Belarus/南美国家 — all correctly PASS, and the
   2 compound US markets — 美区-通用/US & Canada — both correctly FAIL;
   11/11 passed); `code_validate_scene`'s baseline-2-scenes-cover-before/after-pass and
   only-1-scene-fails-integration-before-after cases (plus, in the earlier standalone pass, 8
   more: vague-word-rejection, single-visual-prop-rejection, bad-camera-enum-rejection,
   bad-persona_ref-rejection, bad-contrast_ref-rejection, zero-orphan-rejection,
   non-before-after-needs-no-minimum-pass, additionalProperties-rejection; 10/10 passed);
   `assemble_bundle`'s merge/warnings-concatenation/status/bundle_json correctness. Every check
   passed on the first post-embedding run.

4. **Jinja2 templates were not executed** (the `jinja2` package is not installed in this
   environment, and installing a new package was out of scope for offline DSL authoring) — instead, each `template-transform` node's Jinja syntax was
   manually traced against constructs already proven to work in the two precedent apps
   (dict dot-access on iteration items, `| join(', ')`, `{{ A if cond else B }}` ternaries,
   `{% for %}` loops including one nested loop for `grounded_in`, and `warnings_a + warnings_b`
   list concatenation, which is standard Jinja2 and was the only construct not already literally
   present in a precedent file — flagging this one specifically since it's the one piece of
   Jinja syntax in this file without a byte-for-byte precedent to point to). This is a real,
   disclosed gap in verification depth relative to the code nodes, not something to gloss over.

---

## 9. What I could not faithfully resolve / open questions for the integrator

- **No live Dify import test.** Everything above is static verification (schema validator +
  direct code execution against fixtures). Model reselection, KB dataset creation/upload, and an
  actual end-to-end run are still needed before this is production-ready — this matches both
  precedent apps' own stated limitations.
- **The compliance-heuristic check's real-world hit rate is unknown.** Like the hedge-marker
  check and the vague-word list before it, this keyword-overlap heuristic has not been run
  against real generated output at scale — it was validated for *correctness of mechanism*
  (does it fire/not-fire exactly when the test fixtures say it should) but not for *usefulness*
  (does it catch real problems at an acceptable false-positive rate on live generations). If it
  turns out to fire too often (annoying, forces disclosure on harmless overlaps) or too rarely
  (misses real tension because avoid_when phrasing rarely lexically overlaps with generated
  persona text), that's a tuning question for after real usage, not something resolvable from
  design-time reasoning alone.
- **`camera_position`'s 6-value enum has not been validated against real generated scenes** for
  whether 6 categories are sufficient or whether some scripts will want a 7th (e.g. a
  fixed tripod/studio shot, which the source doc's 6 types don't include since UGC realism
  explicitly avoids that look) — if that gap surfaces in real use, extending the enum requires
  updating both `llm_generate_scene`'s prompt and `code_validate_scene`'s `CAMERA_POSITION_ENUM`
  together, same "keep two files in sync by hand" caveat `100x-exaggerate/axioms.md` already
  flags for its own calibration table.
