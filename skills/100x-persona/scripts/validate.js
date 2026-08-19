#!/usr/bin/env node
/**
 * 100x-persona real validator.
 *
 * This file runs schema.json through ajv (a real JSON Schema
 * draft-07 validator, devDependency declared in package.json) for
 * EVERYTHING vanilla JSON Schema can express -- required, type,
 * additionalProperties, enum, pattern, minLength/maxLength, minItems,
 * propertyNames, const. Hand-written code is kept ONLY for the three things
 * JSON Schema draft-07 genuinely cannot express:
 *
 *   1. Referential integrity (axiom 1): a pairing's persona_ref/scene_ref is
 *      correctly *formatted* per its regex pattern (ajv checks that) but
 *      JSON Schema has no construct for "this string must equal one of the
 *      keys of that other object elsewhere in the document."
 *
 *   2. Evidence-quote-is-a-literal-substring-of-source_script (axiom 2): a
 *      cross-FIELD check (comparing one string field's content against
 *      another field's content). JSON Schema cannot compare two sibling
 *      string VALUES to each other at all -- there is no keyword for this.
 *
 *   3. Zero-orphan coverage (axiom 4): every key defined in
 *      `personas`/`scenes` must be referenced by >=1 pairing -- a
 *      cross-object aggregate over the whole document.
 *
 * Axiom 2 heuristic mitigation: `checkEvidenceQuotes` is
 * literal substring matching (`script.includes(quote)`). That proves a quote
 * was copied verbatim, but proves NOTHING about whether the quote's meaning
 * in the persona's field (e.g. "this establishes authority") matches its
 * meaning in the original script. A self-doubting or hedged sentence is a
 * perfectly valid substring and would pass axiom 2 cleanly while being used
 * backwards -- e.g. quoting "如果你不信我" (if you don't
 * believe me) and using it AS the authority anchor.
 *
 * This is NOT fixable with string matching in general -- detecting "does
 * this quote's real-world meaning support the claim it's attached to" is a
 * semantic-understanding problem, not a syntactic one, and no regex/ajv
 * layer can do that. What this file adds is a narrow, honest, closed-list
 * heuristic: `checkAuthorityHedgeRisk` flags `authority_evidence_quote`
 * values that contain one of a fixed set of hedge/self-doubt/conditional-
 * doubt phrases (the pattern class of interest). A hit does not auto-fail -- it requires the bundle to
 * disclose the risk via `meta.warnings` (same convention as workflow.md
 * Phase 1 weak-signal degrade), so the failure mode changes from SILENT
 * pass to MANDATORY human-reviewed disclosure. It still cannot catch, and
 * makes no claim to catch: sarcasm, quote-to-refute framing ("some ads say
 * X, but X proves nothing"), out-of-context boasts, or any reversal that
 * doesn't use one of the listed hedge phrases. Selftest checks 8-10 below
 * prove both the mitigation (8, 9) and the documented remaining gap (10) --
 * check 10 is a passing test that intentionally demonstrates an
 * unmitigated reversal, not a bug.
 *
 * USAGE:
 *   node scripts/validate.js <file1.json> [file2.json ...]
 *   node scripts/validate.js --selftest
 *     10 regression checks, see selftest() below:
 *       6. a persona_item with an extra "scene" field -> must be caught by
 *          ajv's additionalProperties:false, not by any hand-written field
 *          enumeration (there is none left in this file for per-item shape).
 *       7. a persona_item with an invalid relationship_to_camera value ->
 *          must be caught by ajv's enum.
 *     Checks 8-10 are the authority hedge risk mitigation + its documented ceiling:
 *       8. a hedge-marker quote with no disclosure -> FAILS.
 *       9. the same hedge-marker quote WITH a matching meta.warnings entry
 *          -> PASSES (disclosed, not silently swallowed).
 *      10. a quote reversed via refutation/sarcasm framing, containing no
 *          listed hedge marker -> PASSES cleanly. This is the known,
 *          documented gap, not a regression: it proves what this mitigation
 *          does NOT catch, on the record.
 *
 * Requires `npm install` in this skill directory first (package.json
 * declares ajv as a devDependency; this is dev/CI tooling for validating
 * this skill's own output contract, not a runtime dependency of the skill
 * itself -- the skill's actual deliverable is consumed by an LLM reading
 * SKILL.md/axioms.md/workflow.md, not by Node).
 */

'use strict';
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const SCHEMA_PATH = path.join(__dirname, '..', 'schema.json');
const EVALS_DIR = path.join(__dirname, '..', 'evals');

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function compileValidator() {
  const schema = loadSchema();
  // schema.json declares "$schema": "http://json-schema.org/draft-07/schema#";
  // ajv 6.x targets draft-07 natively as its default, so no extra
  // meta-schema wiring is needed. allErrors:true so one run surfaces every
  // violation instead of stopping at the first.
  const ajv = new Ajv({ allErrors: true, verbose: true });
  return ajv.compile(schema);
}

function formatAjvErrors(errors) {
  return (errors || []).map((e) => {
    const loc = e.dataPath && e.dataPath.length ? e.dataPath : '(root)';
    return `[schema/ajv] ${loc} ${e.message} (keyword: ${e.keyword}, params: ${JSON.stringify(e.params)})`;
  });
}

// ---- Axiom 1: referential integrity (schema.json cannot express this) -----
function checkReferentialIntegrity(bundle, errors) {
  const personaKeys = new Set(Object.keys(bundle.personas || {}));
  const sceneKeys = new Set(Object.keys(bundle.scenes || {}));
  (bundle.pairings || []).forEach((pr, i) => {
    const loc = `pairings[${i}]`;
    if (pr.persona_ref && !personaKeys.has(pr.persona_ref)) {
      errors.push(`[axiom1] ${loc}.persona_ref "${pr.persona_ref}" does not exist as a key in personas (referential integrity -- ajv's pattern check only validates FORMAT, not existence; JSON Schema has no cross-object key-reference construct)`);
    }
    if (pr.scene_ref && !sceneKeys.has(pr.scene_ref)) {
      errors.push(`[axiom1] ${loc}.scene_ref "${pr.scene_ref}" does not exist as a key in scenes (referential integrity -- same limitation)`);
    }
  });
}

// ---- Axiom 2: evidence quotes must be literal substrings of source_script --
function checkEvidenceQuotes(bundle, errors) {
  const script = bundle.source_script || '';
  Object.entries(bundle.personas || {}).forEach(([id, p]) => {
    if (typeof p.authority_evidence_quote === 'string' && !script.includes(p.authority_evidence_quote)) {
      errors.push(`[axiom2] personas.${id}.authority_evidence_quote is not a literal substring of source_script -> "${p.authority_evidence_quote}"`);
    }
    if (typeof p.audience_pain_quote === 'string' && !script.includes(p.audience_pain_quote)) {
      errors.push(`[axiom2] personas.${id}.audience_pain_quote is not a literal substring of source_script -> "${p.audience_pain_quote}"`);
    }
  });
  (bundle.pairings || []).forEach((pr, i) => {
    if (typeof pr.script_span_quote === 'string' && !script.includes(pr.script_span_quote)) {
      errors.push(`[axiom2] pairings[${i}].script_span_quote is not a literal substring of source_script -> "${pr.script_span_quote}"`);
    }
  });
}

// ---- Axiom 2 heuristic mitigation: closed-list hedge/self-doubt
// markers inside authority_evidence_quote. See the file-header comment for
// exactly what this does and does not catch. This is NOT part of axiom 2's
// pass/fail contract in the strict sense (it doesn't check the quote is a
// substring -- checkEvidenceQuotes already did that); it's a second, narrower
// pass specifically over authority_evidence_quote looking for a fixed set of
// phrases that are a known real pattern for "self-doubt reversed into a false
// authority anchor". Scoped to authority_evidence_quote only -- NOT applied to
// audience_pain_quote or script_span_quote, because negation there is often
// the legitimate content (e.g. "I can't sleep" is a valid pain quote, not a
// reversal risk) and would just be noise.
const HEDGE_MARKERS = [
  // English
  "if you don't believe me",
  "you don't have to believe me",
  "don't take my word for it",
  "i'm not sure",
  "i am not sure",
  "i don't know if",
  "maybe i'm wrong",
  "i could be wrong",
  "who knows",
  "not 100% sure",
  "i doubt",
  // Chinese
  '如果你不信我',
  '你可以不信',
  '不管你信不信',
  '信不信由你',
  '我不确定',
  '我也不知道',
  '也许我',
  '谁知道呢',
  '说实话我也没底',
];

function findHedgeMarker(quote) {
  const lower = String(quote).toLowerCase();
  return HEDGE_MARKERS.find((m) => lower.includes(m.toLowerCase()));
}

function checkAuthorityHedgeRisk(bundle, errors) {
  const warnings = (bundle.meta && Array.isArray(bundle.meta.warnings)) ? bundle.meta.warnings : [];
  Object.entries(bundle.personas || {}).forEach(([id, p]) => {
    if (typeof p.authority_evidence_quote !== 'string') return;
    const hit = findHedgeMarker(p.authority_evidence_quote);
    if (!hit) return;
    const disclosed = warnings.some((w) => typeof w === 'string' && w.includes(id) && /hedge|自我怀疑|信任反转|待核/i.test(w));
    if (!disclosed) {
      errors.push(`[axiom2-heuristic] personas.${id}.authority_evidence_quote contains a closed-list hedge/self-doubt marker ("${hit}") -- a known real-world pattern for reversing self-doubt into a false authority anchor (see axioms.md #2 "已知天花板"). This heuristic CANNOT tell whether a reversal actually happened, only that this closed-list pattern is present. Fix by either re-selecting an anchor quote that isn't itself a hedge, or adding a meta.warnings entry that mentions "${id}" and "hedge"/"自我怀疑" so a human reviews the semantic direction before this ships.`);
    }
  });
}

// ---- Axiom 4: zero orphans -- every defined persona/scene must be used ----
function checkNoOrphans(bundle, errors) {
  const usedPersonas = new Set();
  const usedScenes = new Set();
  (bundle.pairings || []).forEach((pr) => {
    if (pr.persona_ref) usedPersonas.add(pr.persona_ref);
    if (pr.scene_ref) usedScenes.add(pr.scene_ref);
  });
  Object.keys(bundle.personas || {}).forEach((id) => {
    if (!usedPersonas.has(id)) errors.push(`[axiom4] personas.${id} is defined but never referenced by any pairing (orphan)`);
  });
  Object.keys(bundle.scenes || {}).forEach((id) => {
    if (!usedScenes.has(id)) errors.push(`[axiom4] scenes.${id} is defined but never referenced by any pairing (orphan)`);
  });
}

function validate(bundle, validateSchema) {
  const errors = [];

  // Layer 1: everything schema.json can express, checked by a real JSON
  // Schema validator (ajv) -- required/type/additionalProperties/enum/
  // pattern/minLength/minItems/propertyNames/const all run here for real,
  // not via hand-written re-implementations.
  const schemaOk = validateSchema(bundle);
  if (!schemaOk) {
    errors.push(...formatAjvErrors(validateSchema.errors));
  }

  // Layer 2: the three things schema.json genuinely cannot express. Run
  // these even if layer 1 had issues, as long as the top-level containers
  // are at least the right JS type, so one pass surfaces every problem
  // instead of stopping at the first ajv error.
  if (bundle.personas && typeof bundle.personas === 'object' &&
      bundle.scenes && typeof bundle.scenes === 'object' &&
      Array.isArray(bundle.pairings)) {
    checkReferentialIntegrity(bundle, errors);
    checkEvidenceQuotes(bundle, errors);
    checkAuthorityHedgeRisk(bundle, errors);
    checkNoOrphans(bundle, errors);
  }

  return errors;
}

function runOne(file, validateSchema) {
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validate(bundle, validateSchema);
  if (errors.length === 0) {
    console.log(`PASS: ${file}`);
  } else {
    console.log(`FAIL: ${file}`);
    errors.forEach((e) => console.log('  - ' + e));
  }
  return errors.length === 0;
}

// ---- Self-test fixtures -----------------------------------------------------
function baseGoodBundle() {
  return {
    source_script: 'I have used this every morning for a year and my knees stopped aching on the stairs.',
    personas: {
      PERSONA_A: {
        identity_label: '测试用一年真实用户',
        authority_basis: '以自身长期使用经历建立同理型信任',
        authority_evidence_quote: 'I have used this every morning for a year',
        audience_fit: '上下楼梯膝盖不适的日常用户',
        audience_pain_quote: 'my knees stopped aching on the stairs',
        delivery_style: '第一人称经历叙述',
        relationship_to_camera: 'testimonial-witness',
      },
    },
    scenes: {
      SCENE_A: {
        scene_name: '测试场景',
        trigger_moment: '每天早晨起床后',
        location: '自家楼梯间',
        micro_coordinate: '站在楼梯第一级台阶前',
        visual_props: ['楼梯扶手', '拖鞋'],
        atmosphere: '清晨安静的居家氛围',
      },
    },
    pairings: [
      {
        pairing_id: 'PAIR_1',
        script_span_quote: 'my knees stopped aching on the stairs',
        persona_ref: 'PERSONA_A',
        scene_ref: 'SCENE_A',
        rationale: '楼梯场景直接对应台词里的膝盖痛点',
      },
    ],
    meta: { generated_by: '100x-persona', warnings: [] },
  };
}

function selftest() {
  const validateSchema = compileValidator();
  let allOk = true;

  function report(label, pass, errors) {
    console.log(pass ? `SELFTEST PASS (${label})` : `SELFTEST FAIL (${label})`);
    if (!pass) { console.log('  errors were:', errors); allOk = false; }
  }

  // Check 1: every real, shipped evals/ file must pass (ajv layer + hand-written layer).
  const evalFiles = fs.readdirSync(EVALS_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(EVALS_DIR, f));
  if (evalFiles.length === 0) {
    console.log('SELFTEST FAIL: no files found in evals/');
    allOk = false;
  }
  evalFiles.forEach((f) => {
    const bundle = JSON.parse(fs.readFileSync(f, 'utf8'));
    const errors = validate(bundle, validateSchema);
    report(`1/10 real eval: ${path.relative(process.cwd(), f)}`, errors.length === 0, errors);
  });

  // Check 2: pairing.persona_ref points at a persona that doesn't exist.
  {
    const bundle = baseGoodBundle();
    bundle.pairings[0].persona_ref = 'PERSONA_GHOST';
    const errors = validate(bundle, validateSchema);
    const hit = errors.some((e) => e.includes('[axiom1]') && e.includes('persona_ref'));
    report('2/10 unknown persona_ref correctly FAILS on axiom1 referential integrity', hit, errors);
  }

  // Check 3: pairing.scene_ref points at a scene that doesn't exist.
  {
    const bundle = baseGoodBundle();
    bundle.pairings[0].scene_ref = 'SCENE_GHOST';
    const errors = validate(bundle, validateSchema);
    const hit = errors.some((e) => e.includes('[axiom1]') && e.includes('scene_ref'));
    report('3/10 unknown scene_ref correctly FAILS on axiom1 referential integrity', hit, errors);
  }

  // Check 4: authority_evidence_quote paraphrased, not a literal substring.
  {
    const bundle = baseGoodBundle();
    bundle.personas.PERSONA_A.authority_evidence_quote = 'I have been using this product daily for about twelve months';
    const errors = validate(bundle, validateSchema);
    const hit = errors.some((e) => e.includes('[axiom2]') && e.includes('authority_evidence_quote'));
    report('4/10 paraphrased evidence quote correctly FAILS on axiom2 substring check', hit, errors);
  }

  // Check 5: an extra scene defined but never referenced by any pairing.
  {
    const bundle = baseGoodBundle();
    bundle.scenes.SCENE_ORPHAN = {
      scene_name: '未使用的孤儿场景',
      trigger_moment: '晚上睡前刷手机时',
      location: '客厅沙发',
      micro_coordinate: '窝在沙发靠垫旁',
      visual_props: ['沙发', '手机'],
      atmosphere: '放松的夜间氛围',
    };
    const errors = validate(bundle, validateSchema);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('SCENE_ORPHAN'));
    report('5/10 orphan scene correctly FAILS on axiom4 zero-orphan check', hit, errors);
  }

  // Check 6: inject a "scene" string
  // field directly into a persona_item. axioms.md 公理1 claims this is
  // "结构上不可能落地" via additionalProperties:false. Must be caught by
  // ajv -- there is no hand-written per-item field enumeration left in this
  // file, so if this passes, additionalProperties enforcement isn't real.
  {
    const bundle = baseGoodBundle();
    bundle.personas.PERSONA_A.scene = '浴室';
    const errors = validate(bundle, validateSchema);
    const hit = errors.some((e) => e.includes('[schema/ajv]') && e.includes('additionalProperties'));
    report('6/10 persona_item with injected "scene" field correctly FAILS on ajv additionalProperties', hit, errors);
  }

  // Check 7: relationship_to_camera
  // set to a value outside the enum. Must be caught by ajv's enum keyword.
  {
    const bundle = baseGoodBundle();
    bundle.personas.PERSONA_A.relationship_to_camera = 'telepathic-narrator';
    const errors = validate(bundle, validateSchema);
    const hit = errors.some((e) => e.includes('[schema/ajv]') && e.includes('enum'));
    report('7/10 invalid relationship_to_camera value correctly FAILS on ajv enum', hit, errors);
  }

  // Check 8 (AUTHORITY HEDGE RISK MITIGATION): hedge counterexample class --
  // authority_evidence_quote is a literal substring of source_script (so
  // checkEvidenceQuotes/axiom2 alone would pass it) AND it is itself a
  // hedge/self-doubt phrase ("if you don't believe me") used backwards as an
  // authority anchor, with NO meta.warnings disclosure. Must FAIL.
  {
    const bundle = baseGoodBundle();
    bundle.source_script += " If you don't believe me, that is fine, look at the results yourself.";
    bundle.personas.PERSONA_A.authority_evidence_quote = "If you don't believe me, that is fine";
    const errors = validate(bundle, validateSchema);
    const hit = errors.some((e) => e.includes('[axiom2-heuristic]') && e.includes('PERSONA_A'));
    report('8/10 hedge-marker authority quote with NO disclosure correctly FAILS on axiom2-heuristic', hit, errors);
  }

  // Check 9 (AUTHORITY HEDGE RISK MITIGATION): the exact same hedge-marker quote as
  // check 8, but this time meta.warnings carries a matching disclosure
  // ("PERSONA_A" + "hedge"). This must PASS -- the mitigation's contract is
  // "force disclosure", not "ban the pattern outright" (a human/LLM might
  // deliberately choose this anchor and flag it for review).
  {
    const bundle = baseGoodBundle();
    bundle.source_script += " If you don't believe me, that is fine, look at the results yourself.";
    bundle.personas.PERSONA_A.authority_evidence_quote = "If you don't believe me, that is fine";
    bundle.meta.warnings.push('PERSONA_A authority_evidence_quote 含疑似自我怀疑(hedge)表述，建议人工复核语义方向');
    const errors = validate(bundle, validateSchema);
    report('9/10 same hedge-marker quote WITH matching meta.warnings disclosure correctly PASSES (disclosed, not silently swallowed)', errors.length === 0, errors);
  }

  // Check 10 (DOCUMENTED CEILING -- NOT A BUG): a quote reversed via
  // refutation/sarcasm framing rather than a hedge word. Source script is
  // mocking the "trust me, I am a doctor" claim ("some ads say X just to
  // sell pills, but that proves nothing"); a careless/malicious extraction
  // lifts "trust me, I am a doctor" alone as the authority_evidence_quote.
  // It is a literal substring (passes axiom2) and contains NONE of the
  // closed-list hedge markers (passes checkAuthorityHedgeRisk too) -- so
  // this currently passes with ZERO errors. This is the real, still-open
  // gap: reversal via context/framing outside a fixed keyword list is a
  // semantic-understanding problem no string check here claims to solve.
  // This test exists to keep that gap on the record with a runnable proof,
  // not to assert it should fail.
  {
    const bundle = baseGoodBundle();
    bundle.source_script = 'Some ads will tell you "trust me, I am a doctor" just to sell a bottle of pills, ' +
      'but a title alone proves nothing. If your knees ache on the stairs every morning, that is the moment ' +
      'this actually helps.';
    bundle.personas.PERSONA_A.authority_evidence_quote = 'trust me, I am a doctor';
    bundle.personas.PERSONA_A.audience_pain_quote = 'knees ache on the stairs every morning';
    bundle.pairings[0].script_span_quote = 'knees ache on the stairs every morning';
    const errors = validate(bundle, validateSchema);
    report('10/10 KNOWN GAP (documented, not a bug): refutation-framed reversal with no listed hedge marker passes with ZERO errors -- semantic reversal outside the closed hedge-marker list is NOT caught, see axioms.md #2 "已知天花板"', errors.length === 0, errors);
  }

  return allOk;
}

// ---- CLI entry ---------------------------------------------------------------
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node scripts/validate.js <file1.json> [file2.json ...]');
  console.log('       node scripts/validate.js --selftest');
  process.exit(1);
} else if (args[0] === '--selftest') {
  const ok = selftest();
  console.log(ok ? '\nSELFTEST: ALL 10 CHECKS BEHAVED AS EXPECTED' : '\nSELFTEST: AT LEAST ONE CHECK FAILED');
  process.exitCode = ok ? 0 : 1;
} else {
  const validateSchema = compileValidator();
  let allPass = true;
  args.forEach((f) => {
    const ok = runOne(f, validateSchema);
    if (!ok) allPass = false;
  });
  process.exitCode = allPass ? 0 : 1;
}
