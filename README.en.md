<h1 align="center">100x-skill-tiktok</h1>

<p align="center">
  <strong>Break viral methodology into verifiable skills — the framework is open, the data is private.</strong>
</p>

<p align="center">
  A Claude Code / Codex / WorkBuddy(CodeBuddy) agent skill collection for TikTok / UGC content production: script segmentation, persona and scene design, sourcing keywords, and prompt orchestration — every criterion can be verified by running a script, not prose-style methodology.
</p>

<p align="center">
  <img alt="100x-skill-tiktok: script/product/persona inputs flow into a governed skill framework, producing schema-validated structured results" src="./.github/100x-skills-loop.svg" width="100%">
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18+-171716.svg?style=flat-square&labelColor=171716">
  <img alt="JSON Schema" src="https://img.shields.io/badge/JSON_Schema-draft--07-171716.svg?style=flat-square&labelColor=171716">
  <img alt="ajv" src="https://img.shields.io/badge/validator-ajv-171716.svg?style=flat-square&labelColor=171716">
  <img alt="skills" src="https://img.shields.io/badge/skills-8%2F8-171716.svg?style=flat-square&labelColor=171716">
</p>

## What is 100x-skill-tiktok

This repository is not a collection of methodology documents. Every skill's criteria (`axioms.md`) ship with a real, runnable validation script (`scripts/validate.js`) that you can run on the spot with `node scripts/validate.js --selftest` — not a verbal promise like "the logic has already been thought through" with no code behind it.

The repo is layer 2 of a three-layer architecture, the general-purpose capability piece:

```
Layer 1 · Private data foundation   (corpus, knowledge atoms — not in this repo)
        ↓ referenced via requires_data declarations, content not copied
Layer 2 · 100x-skill-tiktok   ← this repo · framework is public
        ↓ registry pins versions
Layer 3 · Product projects          (actual business deployment)
```

> SKILL.md is the framework, atoms are the data. The former is public, the latter is paid.

| Core difference | How this repo handles it |
|---|---|
| Verifiability of criteria | Every axiom must be expressible as a scripted criterion; cross-item/cross-field constraints that JSON Schema can't express (referential integrity, evidence substrings, 5A coverage, etc.) get an additional hand-written validator — the two layers have separate responsibilities and both actually execute |
| Structural-layer validation | `schema.json` (required/additionalProperties/enum/pattern) is uniformly compiled and executed with `ajv`, instead of hand-written code re-implementing what JSON Schema can already do — historically, a hand-written implementation once missed the `additionalProperties` check, and only switching to ajv actually closed that gap |
| Data boundary | `evals/` only holds synthetic samples; real customer corpus/account names/product names never enter the repo; `requires_data` only declares dataset ids, never copies content |
| Quality verification | Every finished skill goes through independent verification (real-corpus run + schema validation, finding counterexamples against each axiom, open-source compliance scanning) — all must pass to count |
| Methodology boundary | This repository contains only open engineering methodology and executable validation contracts; specific calibration thresholds and real-world corpus statistics remain strictly outside this public repository |

## Skill List

All 8 functional skills are built and have passed independent verification (7 originally planned + the out-of-plan 100x-video-reverse), plus 1 pure-router skill.

| Skill | What it does | Trigger phrase examples | Status |
|---|---|---|---|
| [`100x-video-reverse`](./skills/100x-video-reverse) | Local video → strict evidence package → in-chat source video, shot triptychs, people/product/scene assets, prompts and per-segment generation plans | 反推这条视频 · 这个视频怎么复刻 · reverse this video | ✅ v2.1 Verified |
| [`100x-segment`](./skills/100x-segment) | Voiceover script plain text (EN/ES) → three independently-layered splits: paragraph logic (10 modules + 7 archetypes), inferred shot purpose, inline breath marks | "帮我分段" · "这段哪里该喘气" · "segment this script" | ✅ Verified |
| [`100x-localize`](./skills/100x-localize) | Source copy (any source language) → Mexican Spanish localization by default, matched to real-corpus intensity distribution, not word-for-word translation | "本地化成西语" · "翻译成西语文案" · "Mexican Spanish localization" | ✅ Verified |
| [`100x-persona`](./skills/100x-persona) | Script copy → narrator persona + independent scene design, each traceable back to a quote from the original script | "给这条脚本配个人设" · "这个场景怎么设定" · "who should deliver this script" | ✅ Verified |
| [`100x-exaggerate`](./skills/100x-exaggerate) | Script → exaggeration-technique beats + contrast-pair beats, intensity calibrated by market + hat-level ceiling | "帮这条脚本加点夸张" · "怎么做反差" · "add a before/after contrast" | ✅ Verified |
| [`100x-search-query`](./skills/100x-search-query) | Product/persona card → 15 English search phrases each for Pinterest / TikTok / Reddit, for sourcing visual reference material | "给我搜索关键词" · "去哪找参考图" · "what should I search on Pinterest" | ✅ Verified |
| [`100x-visual-fission`](./skills/100x-visual-fission) | ≥2 locked persona/scene/product references + product copy → media-fission prompt matrix (single-frame/head-tail/head-mid-tail/multi-day × ABC camera presets) | "帮我裂变这条视觉参考" · "生成裂变提示词矩阵" · "fission this reference" | ✅ Verified |
| [`100x-prompt-compose`](./skills/100x-prompt-compose) | Template id + variables → verbatim-rendered final generation prompt, wrapped for the target model (Veo/Seedance/Jichuang) | "帮我组装提示词" · "填个模板出提示词" · "compose a video prompt" | ✅ Verified |
| [`100x-tiktok`](./skills/100x-tiktok) | Pure router: diagnoses which skill to start from before the task, points to the next step after; generates no content itself | "/100x-tiktok" · "make a TikTok ad" | Router (not verification-gated) |

## Quick Start

### Codex / Claude Code one-command install

```bash
# Full set
npx -y skills add kezd088/100x-skill-tiktok -g --all

# Video reverse only
npx -y skills add kezd088/100x-skill-tiktok --skill 100x-video-reverse
```

### WorkBuddy / CodeBuddy and local-repo install

```powershell
# Windows: register with Claude Code, Codex, WorkBuddy(CodeBuddy), and generic agents
powershell -ExecutionPolicy Bypass -File .\tools\install.ps1 -SkillName 100x-video-reverse
```

```bash
# macOS / Linux / Git Bash
bash tools/install.sh
```

Both local installers cover four user-level directories: `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, and `~/.codebuddy/skills`. Existing targets are skipped and never overwritten. Restart or reload the client's Skills after installation.

### Use

Attach a video or provide its local path, then say:

```text
Reverse this video
```

`100x-video-reverse` displays the source-video entry, first/highlight/end frames for every shot, people/product/scene assets and prompts, per-segment model/duration/method/input plan, limitations, cost, and elapsed time in the current conversation. If the client cannot render video inline, it provides a clickable video path while still visualizing the shot and asset images.

### Validate

```bash
# Validate a single skill (every skill directory has this)
for d in skills/*/; do
  [ -f "$d/scripts/validate.js" ] && (cd "$d" && npm install && node scripts/validate.js --selftest)
done
```

## Capability Boundaries

This README only describes what's currently built and verified — known limitations are not hidden either:

- `100x-video-reverse` v2.1 requires ffmpeg/ffprobe, Python and `jsonschema` to build local evidence and enforce a strict handoff gate; external multimodal analysis is not authorized by default. A green validator means the timeline, references, paths and provenance are handoff-safe, not that a generated video reaches the same similarity score. Clients have different media-rendering capabilities, so the skill guarantees one content contract rather than an identical player UI

- `100x-search-query`'s sensitive-category guardrail (preventing sexual-health-type copy from passing without a warning): category signals and authority-claim signals share the same scan range (`category`/`product_name` plus the generated `queries.*.q`/`intent_cn`), and the synonym/euphemism word list covers common variants, but a fixed keyword list is not a semantic criterion — wordings outside the list can still slip through, this guardrail doesn't claim to be "fully solved"
- `100x-persona`'s evidence-substring criterion can't stop abuse where "the excerpt is literally a substring of the original text but its meaning is reversed after excerpting" (`checkEvidenceQuotes` only does a literal-containment check); a closed-set self-doubt-phrase disclosure requirement (`checkAuthorityHedgeRisk`) acts as mitigation, but irony / quote-then-refute framed reversals still go undetected — this is the shared ceiling of JSON Schema and string matching
- `100x-localize`'s `tú`/`usted` ban pattern has a Unicode combining-mark ceiling: NFC normalization and supplementary patterns were added, but the full space of Unicode invisible/combining characters can't be exhaustively enumerated
- `100x-prompt-compose`'s content-completeness criterion (e.g. hollow placeholder content like `persona: 'a person'`) has no reliable heuristic fix — length/digit-based heuristics can't reliably distinguish a legitimately short example from a lazy hollow one
- `skills.json`/`.claude-plugin/plugin.json` are currently minimal-viable versions only — marketplace distribution hasn't been verified
- Of the 28 knowledge-atom drafts produced across the original 7 skills, 24 cross-project-reusable engineering-methodology entries have been distilled into reusable lessons; the other 4 involve specific calibration thresholds or real-corpus statistics, so open-source compliance keeps them out of this public repo — where they end up is still undecided

## Repository Conventions

- `skills/` is fully flat — no category subdirectories, no numbering; the `100x-` prefix is a namespace, to avoid name collisions when installed into `~/.claude/skills/` (a flat directory)
- Every skill has a fixed set of seven: `SKILL.md` (for routing — the frontmatter's description must embed the literal Chinese and English trigger phrases), `metadata.json`, `axioms.md`, `workflow.md`, `sources.md`, `schema.json`, `evals/` (synthetic samples only)
- Structural-layer constraints run through `schema.json` via `ajv`; cross-item/cross-field constraints (the parts JSON Schema can't express) are covered by hand-written code in `scripts/validate.js` — the two layers' responsibilities are spelled out in each skill's `metadata.json.validation` field
- Customer names, real account names, real product names, Feishu links, API keys, and customer-decided category dictionaries never enter the repo; knowledge atoms are labeled by category + market, with no customer identifiers

## Documentation Index

| Content | Location |
|---|---|
| Per-skill criteria, workflow, source traceability | each `skills/<name>/{axioms,workflow,sources}.md` |
| Per-skill output contract and validation method | each `skills/<name>/schema.json` + `scripts/validate.js` |
| Repo root registry | [`skills.json`](./skills.json) |
| 中文版 | [`README.md`](./README.md) |
