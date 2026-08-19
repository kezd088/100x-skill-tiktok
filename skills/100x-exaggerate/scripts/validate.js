#!/usr/bin/env node
/**
 * 100x-exaggerate real validator.
 *
 * WHY THIS FILE EXISTS (same class of gap as 100x-search-query's and
 * 100x-persona's scripts/validate.js -- see those files' header comments):
 * schema.json (vanilla JSON Schema draft-07) can only validate PER-ITEM shape:
 * required fields, enum membership (technique/contrast_type/intensity/hat_level),
 * ID pattern, additionalProperties, minItems, string length. It CANNOT express:
 *
 *   1. (axiom 2) that script_span_quote / anchor_quote_a / anchor_quote_b are
 *      literal substrings of source_script -- a cross-field string-containment
 *      check. A fabricated or paraphrased quote that is a non-empty string
 *      passes schema.json cleanly.
 *   2. (axiom 4) that anchor_quote_a and anchor_quote_b on the same
 *      contrast_beat_item are not the same sentence doing double duty as both
 *      ends of the "contrast" -- JSON Schema draft-07 has no keyword to compare
 *      two sibling string properties against each other.
 *   3. (axiom 3) that an exaggeration_beat_item's intensity does not exceed the
 *      calibration ceiling implied by meta.hat_level + meta.market. The ceiling
 *      is a lookup-table function of TWO sibling string fields (one on `meta`,
 *      one per-item) -- not expressible as any single schema keyword. This is
 *      the direct machine-verifiable encoding of 词典06's own calibration note
 *      about US-market restraint on emotion-driven exaggeration (see
 *      axioms.md #3 for the abstracted description of that note -- exact
 *      source wording is not reproduced here per this repo's compliance rule
 *      against literal excerpting of private-corpus text).
 *
 * All three are enforced below, AFTER ajv has confirmed the bundle is
 * structurally valid (same "ajv first, hand-written aggregates second" pipeline
 * 100x-search-query uses -- see that file for the full rationale of why ajv
 * replaces hand-rolled structural checking rather than the reverse).
 *
 * USAGE:
 *   node scripts/validate.js <file1.json> [file2.json ...]
 *     Validates each given ExaggerationContrastBundle JSON file. Exits 0 if all
 *     pass, 1 if any fails (prints the specific failing rule(s) per file).
 *
 *   node scripts/validate.js --selftest
 *     Runs eight fixed regression checks and prints PASS/FAIL for each:
 *       1. All files in evals/ must pass (real shipped content, real check).
 *       2. A query_item... (see below, per-check comments) with an extra field
 *          ajv/schema.json doesn't declare must FAIL via additionalProperties.
 *       3. Both a technique value AND a contrast_type value outside their
 *          respective closed enums must FAIL via ajv's enum enforcement
 *          (sub-checks 3a/3b, the technique-enum and contrast_type-enum
 *          counterexamples axioms.md 公理1 attributes to this one check).
 *       4. A fabricated script_span_quote (not a literal substring of
 *          source_script) must FAIL on the axiom-2 substring check.
 *       5. A contrast_beat_item whose anchor_quote_a equals anchor_quote_b must
 *          FAIL on the axiom-4 non-degeneracy check.
 *       6. An emotion_reaction_hyperbole beat with intensity "aggressive" under
 *          hat_level "blackhat" + market "美区" must FAIL on the axiom-3
 *          calibration ceiling (this is 词典06's own US-market calibration
 *          note made machine-verifiable; see axioms.md #3 for the abstracted
 *          description -- exact source wording is not reproduced in this repo).
 *       7. The same beat/intensity but with a market string that must NOT
 *          trip the US cap must PASS that same check -- covers "西语区" plus
 *          four counterexamples (market
 *          names that happen to CONTAIN the letters "us" or the characters
 *          "美国" as part of an unrelated word: Russia/Australia/Belarus/
 *          南美国家). All five passing proves the ceiling is a real
 *          per-market computation, not "anything that looks vaguely US-ish
 *          gets capped".
 *       8. The same beat/intensity but with a market string that combines a
 *          real US alias with another value via a hyphen or ampersand
 *          ("美区-通用", "US & Canada") must FAIL that same check, because
 *          hyphen and ampersand are treated as multi-value delimiters.
 *     Exits nonzero if any of the eight checks doesn't behave as described.
 *
 * DEPENDENCIES: ajv (see package.json). Run `npm install` in this directory
 * before using this script. Everything else is Node builtins.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const SCHEMA_PATH = path.join(__dirname, '..', 'schema.json');
const EVALS_DIR = path.join(__dirname, '..', 'evals');

function loadAjvValidator() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

function formatAjvErrors(ajvErrors) {
  return (ajvErrors || []).map((e) => {
    const loc = e.instancePath && e.instancePath.length ? e.instancePath : '(root)';
    const extra = e.params ? ` ${JSON.stringify(e.params)}` : '';
    return `[schema:ajv] ${loc} ${e.message}${extra}`;
  });
}

// ---- Axiom 3: calibration ceiling table -----------------------------------
// Keep byte-for-byte in sync with axioms.md 公理3's prose table. Not
// expressible in schema.json -- see file header point 3.
//
// Base ceiling by hat_level (own reasoning, disclosed as original judgment in
// sources.md "原创判断披露" -- creative beat dictionary hat-level calibration section only gives a
// qualitative, three-tier strength lean per hat_level, in its own wording not
// reproduced here per this repo's compliance rule against literal excerpting
// of private-corpus text -- this script turns that into an ordinal ceiling).
const INTENSITY_RANK = { mild: 1, moderate: 2, aggressive: 3 };
const BASE_CEILING_BY_HAT_LEVEL = { whitehat: 1, grayhat: 2, blackhat: 3 };

// US-market alias list, matched against meta.market as whole delimited
// segments (see isUsMarket below), NOT a bare substring match. Grounded in
// 词典06's explicit calibration note under L1 #6 extreme_emotion_reaction and
// Type H2 -- both say (in the source's own wording, not reproduced here per
// this repo's compliance rule against literal excerpting of private-corpus
// text) that US-market audiences read emotion-driven exaggeration as less
// credible than other markets do. That note is specifically about
// emotion_reaction_hyperbole, not the other 4 techniques, which is why the
// cap below only applies to that one technique. See axioms.md #3.
const US_MARKET_ALIASES = ['美区', '美国', 'us', 'usa', 'united states', 'america'];

// A bare case-insensitive substring match on the whole market string
// (`s.includes(alias)`) would false-positive on any market name that merely
// CONTAINS one of the short aliases as a letter/character sequence --
// 'Russia'/'Australia'/'Belarus' all contain the letters "us" (r-US-sia,
// a-US-tralia, belar-US), and a Chinese string like '南美国家' (South
// American countries) happens to spell out '美国' across the '南美'/'国家'
// word boundary. These four are permanent regression cases, see --selftest
// check 7 below.
//
// isUsMarket splits meta.market on common multi-value delimiters (comma/顿号/
// semicolon/pipe/parentheses, both ASCII and CJK punctuation) -- deliberately
// NOT on plain whitespace, since the alias 'united states' must survive as one
// segment -- then requires an EXACT (trimmed, case-insensitive) match of a
// whole segment against an alias, instead of a substring match anywhere in
// the raw string. This matches '美区'/'美国'/'US'/'USA'/'United States'/'America'
// used standalone or combined with other values in one field (e.g. '美区/US',
// '美国, 加拿大').
//
// The MARKET_SEGMENT_SPLIT_RE delimiter set includes a hyphen '-' and an
// ampersand '&' (the '-' is placed at the end of the character class so it is
// not parsed as a range operator), so a combined multi-value market string
// like "美区-通用" or "US & Canada" is split into segments and the US-alias
// segment still trips the US-market cap. These two market strings are
// permanent regression cases, see --selftest check 8 below.
//
// KNOWN RESIDUAL LIMITATION (disclosed, not fixed here -- see axioms.md #3
// and SKILL.md 核心约束 #3): this still cannot correctly pull an alias out of
// a longer CJK compound that has no delimiter at all (e.g. '美国市场' as one
// unbroken run of characters would NOT match '美国', because Chinese has no
// whitespace to fall back on and this script does no real word segmentation/
// tokenization). schema.json's own documented examples for meta.market are
// short standalone descriptors ('美区', 'US', '西语区', '通用'), so this
// narrower matching is judged an acceptable trade-off versus a broader
// matching that would re-introduce false positives -- but it is a real, disclosed
// gap, not a claim of complete market-string parsing.
const MARKET_SEGMENT_SPLIT_RE = /[,，、;；|&()（）\/-]+/;

function isUsMarket(marketStr) {
  const raw = marketStr || '';
  return raw
    .split(MARKET_SEGMENT_SPLIT_RE)
    .map((seg) => seg.trim().toLowerCase())
    .filter((seg) => seg.length > 0)
    .some((seg) => US_MARKET_ALIASES.includes(seg));
}

// meta.market missing entirely defaults to the CONSERVATIVE branch (as if it
// were a US market) rather than the permissive one -- workflow.md Phase 1
// documents this as the safe default when the calibration-relevant input is
// simply absent, not silently guessed as "probably fine to go aggressive".
function emotionCeilingForMarket(marketStr) {
  const hasMarket = typeof marketStr === 'string' && marketStr.trim().length > 0;
  if (!hasMarket) return INTENSITY_RANK.moderate; // conservative default, see workflow.md Phase 1
  return isUsMarket(marketStr) ? INTENSITY_RANK.moderate : INTENSITY_RANK.aggressive;
}

function calibrationCheck(bundle, errors) {
  const hatLevel = bundle.meta && bundle.meta.hat_level;
  const market = bundle.meta && bundle.meta.market;
  const baseCeiling = BASE_CEILING_BY_HAT_LEVEL[hatLevel];
  if (!baseCeiling) return; // ajv already rejects an invalid/missing hat_level; nothing more to compute here

  (bundle.exaggeration_beats || []).forEach((item) => {
    const itemRank = INTENSITY_RANK[item.intensity];
    let ceiling = baseCeiling;
    if (item.technique === 'emotion_reaction_hyperbole') {
      ceiling = Math.min(ceiling, emotionCeilingForMarket(market));
    }
    if (itemRank > ceiling) {
      const ceilingLabel = Object.keys(INTENSITY_RANK).find((k) => INTENSITY_RANK[k] === ceiling);
      errors.push(`[axiom3] ${item.beat_id}: intensity "${item.intensity}" exceeds calibration ceiling "${ceilingLabel}" for technique "${item.technique}" under hat_level "${hatLevel}"${market ? ` / market "${market}"` : ' / market unspecified (conservative default applied)'}`);
    }
  });
}

// ---- Axiom 2: literal-quote anchoring --------------------------------------
// Cross-field check (a string field's value must appear verbatim inside
// ANOTHER field's value) -- JSON Schema has no such keyword. Case-sensitive,
// exact substring, no paraphrase/translation tolerance (same convention as
// 100x-persona's checkEvidenceQuotes).
function checkQuoteSubstrings(bundle, errors) {
  const script = bundle.source_script || '';
  (bundle.exaggeration_beats || []).forEach((item) => {
    if (!script.includes(item.script_span_quote)) {
      errors.push(`[axiom2] ${item.beat_id}: script_span_quote is not a literal substring of source_script`);
    }
  });
  (bundle.contrast_beats || []).forEach((item) => {
    if (!script.includes(item.anchor_quote_a)) {
      errors.push(`[axiom2] ${item.beat_id}: anchor_quote_a is not a literal substring of source_script`);
    }
    if (!script.includes(item.anchor_quote_b)) {
      errors.push(`[axiom2] ${item.beat_id}: anchor_quote_b is not a literal substring of source_script`);
    }
  });
}

// ---- Axiom 4: contrast pair non-degeneracy ---------------------------------
// Cross-field check (two sibling string properties on the same object must
// differ) -- JSON Schema draft-07 cannot compare sibling properties to each
// other at all. Grounded in 词典06 Type-D 对比冲击画面's own stated core
// requirement: "对比感: 两端必须有明显视觉落差" (a contrast whose two ends
// are literally the same sentence has zero 落差 by definition).
//
// KNOWN LIMITATION (disclosed, not fixed here -- see axioms.md #4 TODO and
// sources.md, and 100x-persona's own unresolved TODO on the same class of
// problem for micro_coordinate/location): this only catches EXACT duplication
// (case + whitespace normalized). It does not catch a near-duplicate paraphrase
// that is technically two different strings but carries no real informational
// gap -- that would need a similarity/edit-distance threshold, which has no
// validated cutoff in this repo yet.
function normalizeForDuplicateCheck(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function checkContrastNonDegenerate(bundle, errors) {
  (bundle.contrast_beats || []).forEach((item) => {
    if (normalizeForDuplicateCheck(item.anchor_quote_a) === normalizeForDuplicateCheck(item.anchor_quote_b)) {
      errors.push(`[axiom4] ${item.beat_id}: anchor_quote_a and anchor_quote_b are the same quote (normalized) -- no real contrast gap`);
    }
  });
}

// Aggregate checks that schema.json (and therefore ajv) structurally cannot
// express. Only called after ajv has already confirmed the bundle is
// structurally valid, so it's safe to assume shape here.
function aggregateChecks(bundle) {
  const errors = [];
  checkQuoteSubstrings(bundle, errors);
  checkContrastNonDegenerate(bundle, errors);
  calibrationCheck(bundle, errors);
  return errors;
}

// Full pipeline: ajv structural pass first, aggregate checks only if it passes.
function validate(bundle, ajvValidateFn) {
  const structurallyValid = ajvValidateFn(bundle);
  if (!structurallyValid) {
    return formatAjvErrors(ajvValidateFn.errors);
  }
  return aggregateChecks(bundle);
}

function runOne(file, ajvValidateFn) {
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validate(bundle, ajvValidateFn);
  if (errors.length === 0) {
    console.log(`PASS: ${file}`);
  } else {
    console.log(`FAIL: ${file}`);
    errors.forEach((e) => console.log('  - ' + e));
  }
  return errors.length === 0;
}

// ---- Self-test: reproduces counterexamples as fixed regression tests -------
function baseGoodBundle() {
  return {
    source_script: 'Look at this before photo, my skin was so dry and dull. After just three days it feels smooth again. Do not use more than one pump a day, trust me, or your skin will glow too much. Scientists confirm this works.',
    meta: {
      generated_by: '100x-exaggerate',
      hat_level: 'grayhat',
      market: '西语区',
      warnings: [],
    },
    exaggeration_beats: [
      {
        beat_id: 'EXG_01',
        script_span_quote: 'Scientists confirm this works.',
        technique: 'authority_absolutism_hyperbole',
        label_cn: '权威绝对化',
        intensity: 'moderate',
        rationale: 'synthetic selftest fixture, not a real product',
      },
    ],
    contrast_beats: [
      {
        beat_id: 'CTR_01',
        contrast_type: 'state_before_after',
        label_cn: '前后反差',
        anchor_quote_a: 'my skin was so dry and dull',
        anchor_quote_b: 'After just three days it feels smooth again',
        rationale: 'synthetic selftest fixture, not a real product',
      },
    ],
  };
}

function selftest() {
  const ajvValidateFn = loadAjvValidator();
  let allOk = true;

  // Check 1: all real, shipped evals/ files must pass.
  const evalFiles = fs.readdirSync(EVALS_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(EVALS_DIR, f));
  if (evalFiles.length === 0) {
    console.log('SELFTEST FAIL: no files found in evals/');
    allOk = false;
  }
  evalFiles.forEach((f) => {
    const bundle = JSON.parse(fs.readFileSync(f, 'utf8'));
    const errors = validate(bundle, ajvValidateFn);
    if (errors.length === 0) {
      console.log(`SELFTEST PASS (1/8 real evals): ${path.relative(process.cwd(), f)}`);
    } else {
      console.log(`SELFTEST FAIL (1/8 real evals, expected PASS): ${path.relative(process.cwd(), f)}`);
      errors.forEach((e) => console.log('  - ' + e));
      allOk = false;
    }
  });

  // Check 2/8: ajv additionalProperties enforcement -- inject a field
  // schema.json doesn't declare into an exaggeration_beat_item.
  {
    const bundle = baseGoodBundle();
    bundle.exaggeration_beats[0].extra_field_not_in_schema = 'should be rejected by additionalProperties:false';
    const errors = validate(bundle, ajvValidateFn);
    const hit = errors.some((e) => e.includes('additionalProperties') || e.includes('additional properties'));
    if (hit) {
      console.log('SELFTEST PASS (2/8 exaggeration_beat_item with an undeclared extra field correctly FAILS via ajv additionalProperties)');
    } else {
      console.log('SELFTEST FAIL (2/8): extra field did NOT get rejected -- additionalProperties is not being enforced');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 3/8: ajv enum enforcement -- technique AND contrast_type outside
  // their respective closed sets (sub-checks 3a/3b), matching axioms.md 公理1's
  // 反例 section which attributes both the technique-enum and the
  // contrast_type-enum counterexamples to this one check number.
  {
    const bundle = baseGoodBundle();
    bundle.exaggeration_beats[0].technique = 'made_up_technique';
    const errors = validate(bundle, ajvValidateFn);
    const hit = errors.some((e) => e.includes('allowed values'));
    if (hit) {
      console.log('SELFTEST PASS (3/8a exaggeration_beat_item with technique outside the closed enum correctly FAILS via ajv enum)');
    } else {
      console.log('SELFTEST FAIL (3/8a): invalid technique value did NOT get rejected -- enum is not being enforced');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }
  {
    const bundle = baseGoodBundle();
    bundle.contrast_beats[0].contrast_type = 'shock_value';
    const errors = validate(bundle, ajvValidateFn);
    const hit = errors.some((e) => e.includes('allowed values'));
    if (hit) {
      console.log('SELFTEST PASS (3/8b contrast_beat_item with contrast_type outside the closed enum correctly FAILS via ajv enum)');
    } else {
      console.log('SELFTEST FAIL (3/8b): invalid contrast_type value did NOT get rejected -- enum is not being enforced');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 4/8: axiom 2 -- fabricated/paraphrased quote (not a literal
  // substring of source_script) must FAIL.
  {
    const bundle = baseGoodBundle();
    bundle.exaggeration_beats[0].script_span_quote = 'Doctors unanimously agree this is a miracle';
    const errors = validate(bundle, ajvValidateFn);
    const hit = errors.some((e) => e.includes('[axiom2]'));
    if (hit) {
      console.log('SELFTEST PASS (4/8 fabricated script_span_quote correctly FAILS on axiom2 substring check)');
    } else {
      console.log('SELFTEST FAIL (4/8): fabricated quote did NOT trigger the axiom2 error as expected');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 5/8: axiom 4 -- anchor_quote_a === anchor_quote_b (degenerate
  // "contrast" with zero gap) must FAIL.
  {
    const bundle = baseGoodBundle();
    bundle.contrast_beats[0].anchor_quote_b = bundle.contrast_beats[0].anchor_quote_a;
    const errors = validate(bundle, ajvValidateFn);
    const hit = errors.some((e) => e.includes('[axiom4]'));
    if (hit) {
      console.log('SELFTEST PASS (5/8 contrast_beat_item with anchor_quote_a === anchor_quote_b correctly FAILS on axiom4 non-degeneracy)');
    } else {
      console.log('SELFTEST FAIL (5/8): degenerate contrast pair did NOT trigger the axiom4 error as expected');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 6/8: axiom 3 -- emotion_reaction_hyperbole at "aggressive" under
  // hat_level "blackhat" + market "美区" must FAIL (this is the literal
  // 词典06 calibration note made machine-verifiable).
  {
    const bundle = baseGoodBundle();
    bundle.meta.hat_level = 'blackhat';
    bundle.meta.market = '美区';
    bundle.exaggeration_beats[0].technique = 'emotion_reaction_hyperbole';
    bundle.exaggeration_beats[0].intensity = 'aggressive';
    const errors = validate(bundle, ajvValidateFn);
    const hit = errors.some((e) => e.includes('[axiom3]'));
    if (hit) {
      console.log('SELFTEST PASS (6/8 emotion_reaction_hyperbole=aggressive under blackhat+美区 correctly FAILS on axiom3 calibration ceiling)');
    } else {
      console.log('SELFTEST FAIL (6/8): over-ceiling emotion_reaction_hyperbole did NOT trigger the axiom3 error as expected');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 7/8: axiom 3 regression guard -- same beat/intensity but with a
  // market string that must NOT trip the US cap must PASS the calibration
  // check, proving check 6 is a real per-market computation, not "always
  // reject emotion_reaction_hyperbole". Covers the original "西语区" case plus
  // four false-positive counterexamples: market names that happen to CONTAIN
  // the letters "us" or the characters "美国" as part of an unrelated word
  // (Russia/Australia/Belarus/南美国家). All five must PASS.
  {
    const nonUsMarkets = ['西语区', 'Russia', 'Australia', 'Belarus', '南美国家'];
    let allNonUsPass = true;
    nonUsMarkets.forEach((market) => {
      const bundle = baseGoodBundle();
      bundle.meta.hat_level = 'blackhat';
      bundle.meta.market = market;
      bundle.exaggeration_beats[0].technique = 'emotion_reaction_hyperbole';
      bundle.exaggeration_beats[0].intensity = 'aggressive';
      const errors = validate(bundle, ajvValidateFn);
      const hit = errors.some((e) => e.includes('[axiom3]'));
      if (hit) {
        console.log(`SELFTEST FAIL (7/8): market "${market}" (blackhat+aggressive, no real US cap should apply) wrongly triggered axiom3 -- false positive in isUsMarket`);
        console.log('  errors were:', errors);
        allNonUsPass = false;
      }
    });
    if (allNonUsPass) {
      console.log('SELFTEST PASS (7/8 five non-US markets -- 西语区/Russia/Australia/Belarus/南美国家 -- under blackhat+aggressive all correctly PASS axiom3, including four substring-collision false positives)');
    } else {
      allOk = false;
    }
  }

  // Check 8/8: axiom 3 regression guard -- a meta.market string that combines
  // a real US alias with another value via a hyphen or ampersand ("美区-通用",
  // "US & Canada") must still trigger the same axiom-3 cap, because '-'/'&'
  // are multi-value delimiters.
  {
    const usCompoundMarkets = ['美区-通用', 'US & Canada'];
    let allCompoundCapped = true;
    usCompoundMarkets.forEach((market) => {
      const bundle = baseGoodBundle();
      bundle.meta.hat_level = 'blackhat';
      bundle.meta.market = market;
      bundle.exaggeration_beats[0].technique = 'emotion_reaction_hyperbole';
      bundle.exaggeration_beats[0].intensity = 'aggressive';
      const errors = validate(bundle, ajvValidateFn);
      const hit = errors.some((e) => e.includes('[axiom3]'));
      if (!hit) {
        console.log(`SELFTEST FAIL (8/8): market "${market}" (blackhat+aggressive, contains a US alias joined by '-'/'&') wrongly PASSED axiom3 -- false negative in isUsMarket delimiter handling`);
        allCompoundCapped = false;
      }
    });
    if (allCompoundCapped) {
      console.log("SELFTEST PASS (8/8 two US-alias market strings joined by '-'/'&' -- 美区-通用/US & Canada -- under blackhat+aggressive both correctly FAIL axiom3, proving delimiter handling works)");
    } else {
      allOk = false;
    }
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
  console.log(ok ? '\nSELFTEST: ALL 8 CHECKS BEHAVED AS EXPECTED' : '\nSELFTEST: AT LEAST ONE CHECK FAILED');
  process.exitCode = ok ? 0 : 1;
} else {
  const ajvValidateFn = loadAjvValidator();
  let allPass = true;
  args.forEach((f) => {
    const ok = runOne(f, ajvValidateFn);
    if (!ok) allPass = false;
  });
  process.exitCode = allPass ? 0 : 1;
}
