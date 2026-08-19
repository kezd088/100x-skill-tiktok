#!/usr/bin/env node
/**
 * 100x-search-query real validator.
 *
 * WHY THIS FILE EXISTS:
 * schema.json (vanilla JSON Schema draft-07) can only validate PER-ITEM shape:
 * bucket size (minItems/maxItems=15), q ASCII pattern, intent_cn format+length,
 * stage enum membership, additionalProperties. It CANNOT express CROSS-ITEM
 * aggregates -- e.g. axiom 2's "at least 10 of 15 Pinterest items contain an
 * aesthetic word" or axiom 3's "the 45 items must cover at least 3 of the 5
 * distinct 5A stages". A document where every single item is independently
 * valid (stage:"Advocate" is a legal enum value) but ALL 45 items share that
 * one stage passes schema.json cleanly while violating axiom 3. The aggregate
 * checks below (density/coverage/sensitive category/persona-informed coverage)
 * are the real, runnable enforcement of the parts schema.json structurally
 * cannot cover.
 *
 * STRUCTURAL LAYER: this script uses ajv (a real JSON Schema validator) to
 * enforce EVERYTHING schema.json declares -- required, additionalProperties,
 * enum, pattern, minLength/maxLength, minItems/maxItems -- via
 * ajv.compile(schema), rather than hand-picking which parts of schema.json to
 * re-check. Only the parts schema.json genuinely cannot express (axiom 2
 * density, axiom 3 coverage, sensitive-category detection, axiom 5
 * persona-informed coverage) remain hand-written below; those are
 * cross-item/cross-field aggregates that no vanilla JSON Schema draft can
 * express, ajv included.
 *
 * VALIDATION ORDER: ajv runs first. If ajv fails, this script reports the
 * ajv errors and does NOT run the hand-written aggregate checks (no point
 * computing "10/15 Pinterest items hit an aesthetic word" on a document that
 * doesn't even have a valid pinterest array). Only once ajv passes does the
 * hand-written aggregate layer run.
 *
 * The axiom-2 density keyword lists below (PINTEREST_WORDS /
 * TIKTOK_FORMAT_WORDS / REDDIT_QWORDS / REDDIT_BANNED_WORDS) are NOT
 * expressible in schema.json at all -- they only live here and in axioms.md's
 * prose tables. If you change one, change the other.
 *
 * USAGE:
 *   node scripts/validate.js <file1.json> [file2.json ...]
 *     Validates each given SearchQueryBundle JSON file. Exits 0 if all pass,
 *     1 if any fails (prints the specific failing rule(s) per file).
 *
 *   node scripts/validate.js --selftest
 *     Runs thirteen fixed regression checks and prints PASS/FAIL for each:
 *       1. Both files in evals/ must pass (real shipped content, real check).
 *       2. A synthetic 45-item bundle with every stage forced to "Advocate"
 *          must FAIL specifically on the axiom-3 coverage rule.
 *       3. A synthetic Pinterest bucket with zero aesthetic-word hits must FAIL
 *          specifically on the axiom-2 Pinterest density rule.
 *       4. A synthetic sensitive-category bundle (intimate-health category +
 *          fake-authority-claim wording) WITHOUT the required meta.warnings
 *          entry must FAIL on the sensitive-category check (workflow.md
 *          Phase 1 step 6).
 *       5. The same bundle WITH the required warning must PASS -- proves the
 *          check isn't just "always fail on this category", it's checking for
 *          the warning's presence specifically.
 *       6. A query_item with an extra field ajv/schema.json doesn't declare
 *          must FAIL via ajv's additionalProperties enforcement.
 *       7. A query_item with stage set to a value outside the 5-value enum
 *          must FAIL via ajv's enum enforcement.
 *       8. SCAN-SCOPE bypass repro: a bundle whose category/product_name
 *          contain no sensitive-category word at all, but whose GENERATED
 *          q/intent_cn text plainly names the sensitive category + an
 *          authority claim, and meta.warnings is empty -- must FAIL on
 *          sensitive-category.
 *       9. The same bundle as #8 WITH the required warning must PASS that
 *          check -- proves #8 fails specifically because of the missing
 *          warning, not because the category text itself is now "poisoned".
 *      10. WORD-LIST bypass repro: a bundle using euphemisms/near-synonyms
 *          that are NOT present in the word lists (a "stamina"-framed category
 *          signal + a "doctor approved" authority claim, entirely inside
 *          category/product_name so scan-scope is not the variable under
 *          test), with meta.warnings empty -- must FAIL on sensitive-category.
 *      11. The same bundle as #10 WITH the required warning must PASS that
 *          check, same reasoning as #9.
 *      12. Axiom 5 persona-informed repro: meta.persona_informed=true with
 *          real meta.persona_descriptor_terms declared, but 0 of the 45 queries
 *          actually contain them -- must FAIL.
 *      13. Same bundle but with 6 queries actually containing a descriptor term
 *          -- must PASS, proving axiom 5 counts real hits rather than always
 *          failing when persona_informed is true.
 *     Exits nonzero if any of the thirteen checks doesn't behave as described.
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
  // strict:false -- schema.json intentionally uses `additionalProperties: true`
  // on `meta` (warnings/topic_angle are optional extensible metadata, not a
  // closed set) which is legitimate JSON Schema, not a mistake; ajv's strict
  // mode flags some stylistic patterns it doesn't need to for correctness.
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

// ---- Axiom 2 density keyword lists -----------------------------------------
// Keep byte-for-byte in sync with axioms.md 公理2 table.
const PINTEREST_WORDS = ['aesthetic', 'inspo', 'mood', 'cozy', 'minimal', 'styling', 'outfit', 'decor', 'ideas', 'routine', 'self-care', 'self care'];
const TIKTOK_FORMAT_WORDS = ['pov', 'routine', 'haul', 'grwm', 'review', 'tiktokmademebuyit', 'storytime'];
const REDDIT_QWORDS = ['why', 'how', 'anyone else', 'best', 'vs', 'worth it', 'help', 'recommend', 'does it work', 'should i'];
const REDDIT_BANNED_WORDS = ['aesthetic', 'inspo']; // 'mood' intentionally excluded -- see axioms.md 公理2 "mood 假阳性说明"

// ---- Sensitive-category detection (workflow.md Phase1 step 6) --------------
// Keep byte-for-byte in sync with workflow.md Phase1 step 6's two signal lists.
// This is a BEST-EFFORT proxy: it only scans fields that exist in the final
// output bundle (category/product_name/all q/all intent_cn). It cannot see the
// raw input copy Phase 1 actually read (schema.json doesn't store that), so a
// case where the sensitive signal appears ONLY in the raw input and never
// leaks into these output fields will NOT be caught here. This script is the
// second line of defense; Phase 1 (which does see the raw input) is the first.
//
// Two known bypass classes this check addresses:
// 1. SCAN-SCOPE: the category signal (SENSITIVE_CATEGORY_WORDS) and the
//    authority signal both scan the SAME `fullText` (category + product_name +
//    every q + every intent_cn), so a sensitive category named only in the
//    generated q/intent_cn text (not in category/product_name) is still caught.
// 2. WORD-LIST GAP (narrowed, not closed): the lists below include common
//    blackhat euphemisms/near-synonyms for the sensitive category and
//    authority-claim patterns (e.g. "stamina/persistence" framing instead of
//    literal "erectile", "doctor approved" instead of "doctor recommended").
//    This is a real widening, NOT a claim of completeness -- a fixed keyword
//    list can always be evaded by a rephrasing nobody has tested yet. Closing
//    that class of gap for good needs semantic detection, not another round of
//    word-list entries -- see workflow.md Phase1 step 6 and SKILL.md for the
//    disclosed, still-open limitation.
const SENSITIVE_CATEGORY_WORDS = [
  '两性', '两性健康', '成人用品', '性功能', '男性表现', '男性增大', '情趣', '私密护理', '私处护理', '女性私密',
  // common euphemisms/near-synonyms for the same category that
  // do not contain any of the words above (see comment block above this list).
  '壮阳', '持久力', '持久度', '硬度提升', '房事', '夫妻生活', '性生活', '男性雄风', '增大增粗', '私处', '生理需求',
  'adult', 'intimate', 'sexual', 'sexual health', 'sexual wellness', 'libido', 'erectile', 'enhancement gel', 'male performance', 'feminine intimate', 'vaginal',
  'stamina boost', 'boost stamina', 'bedroom performance', 'manhood', 'last longer in bed', 'harder and longer', 'girth', 'virility', 'potency boost',
];
const AUTHORITY_CLAIM_WORDS = [
  '认证', '医生推荐', '医生背书', '泌尿科', '妇科医生', '临床验证', '权威认证',
  // near-synonyms for the same "fake official endorsement" pattern.
  '专家推荐', '权威专家', '三甲医院', '药监局', '国家认证', '医学验证', '科学验证',
  'fda', 'certified', 'certification', 'approved by', 'doctor recommended', 'physician recommended', 'urologist', 'gynecologist', 'clinically proven', 'clinical trial',
  'doctor approved', 'medically reviewed', 'medically endorsed', 'clinically tested', 'scientifically proven', 'board certified',
];
const REQUIRED_SENSITIVE_WARNING_SUBSTRING = '该品类涉及平台内容政策敏感区';

function sensitiveCategoryCheck(bundle, errors) {
  const categoryText = `${bundle.category || ''} ${bundle.product_name || ''}`.toLowerCase();
  const allQueryText = ['pinterest', 'tiktok', 'reddit']
    .flatMap((p) => (Array.isArray(bundle.queries && bundle.queries[p]) ? bundle.queries[p] : []))
    .flatMap((item) => [item && item.q, item && item.intent_cn])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const fullText = `${categoryText} ${allQueryText}`;

  // BOTH signals scan fullText (category + product_name + every generated q +
  // every generated intent_cn), so a sensitive category named only in the
  // generated queries (never in category/product_name) is still caught.
  const hitCategorySignal = SENSITIVE_CATEGORY_WORDS.some((w) => fullText.includes(w.toLowerCase()));
  const hitAuthoritySignal = AUTHORITY_CLAIM_WORDS.some((w) => fullText.includes(w.toLowerCase()));

  if (hitCategorySignal && hitAuthoritySignal) {
    const warnings = (bundle.meta && Array.isArray(bundle.meta.warnings)) ? bundle.meta.warnings : [];
    const hasRequiredWarning = warnings.some((w) => typeof w === 'string' && w.includes(REQUIRED_SENSITIVE_WARNING_SUBSTRING));
    if (!hasRequiredWarning) {
      errors.push(`[sensitive-category] category/product_name hit a sensitive-category signal AND an authority-claim signal was found in the bundle text, but meta.warnings does not contain the required "${REQUIRED_SENSITIVE_WARNING_SUBSTRING}" notice (workflow.md Phase1 step 6)`);
    }
  }
}

// ---- Axiom 5 (original to this repo): persona-informed coverage ------
// See axioms.md 公理5 for full rationale. Only applies when meta.persona_informed
// is true (i.e. Phase 1 category-C persona/insight input was actually provided
// for this run) -- when false/absent, this check is a no-op, not a failure.
const PERSONA_INFORMED_MIN_HITS = 6;

function personaInformedCheck(bundle, errors) {
  const meta = bundle.meta || {};
  if (meta.persona_informed !== true) return; // axiom 5 does not apply this run

  const terms = Array.isArray(meta.persona_descriptor_terms) ? meta.persona_descriptor_terms : [];
  if (terms.length === 0) {
    errors.push('[axiom5] meta.persona_informed is true but meta.persona_descriptor_terms is empty/missing -- claiming persona input was used without saying what terms it produced is not verifiable');
    return;
  }

  const lowerTerms = terms.map((t) => String(t).toLowerCase());
  const allItems = ['pinterest', 'tiktok', 'reddit']
    .flatMap((p) => (Array.isArray(bundle.queries && bundle.queries[p]) ? bundle.queries[p] : []));
  const hitCount = allItems.filter((item) => {
    const text = `${item && item.q ? item.q : ''} ${item && item.intent_cn ? item.intent_cn : ''}`.toLowerCase();
    return lowerTerms.some((t) => t && text.includes(t));
  }).length;

  if (hitCount < PERSONA_INFORMED_MIN_HITS) {
    errors.push(`[axiom5] persona_informed=true but only ${hitCount}/45 queries reflect meta.persona_descriptor_terms (need >=${PERSONA_INFORMED_MIN_HITS}) -- persona input was accepted but not actually driving generation`);
  }
}

function densityCheck(name, arr, errors) {
  const lower = arr.map((it) => (it.q || '').toLowerCase());

  if (name === 'pinterest') {
    const hits = lower.filter((q) => PINTEREST_WORDS.some((w) => q.includes(w))).length;
    if (hits < 10) errors.push(`[axiom2] pinterest: only ${hits}/15 hit PINTEREST_WORDS (need >=10)`);
  }

  if (name === 'tiktok') {
    const hashtagHits = lower.filter((q) => q.trim().startsWith('#')).length;
    const formatHits = lower.filter((q) => TIKTOK_FORMAT_WORDS.some((w) => q.includes(w))).length;
    if (hashtagHits < 8 && formatHits < 10) {
      errors.push(`[axiom2] tiktok: hashtagHits=${hashtagHits} (<8) AND formatHits=${formatHits} (<10), need one branch of the OR to hold`);
    }
  }

  if (name === 'reddit') {
    const qHits = lower.filter((q) => REDDIT_QWORDS.some((w) => q.includes(w)) || q.trim().endsWith('?')).length;
    const bannedHits = lower.filter((q) => REDDIT_BANNED_WORDS.some((w) => q.includes(w))).length;
    if (qHits < 10) errors.push(`[axiom2] reddit: only ${qHits}/15 hit REDDIT_QWORDS (need >=10)`);
    if (bannedHits > 0) errors.push(`[axiom2] reddit: ${bannedHits} item(s) contain a REDDIT_BANNED_WORDS hit (must be 0)`);
  }
}

function nearDupCheck(name, arr, errors) {
  const counts = {};
  arr.forEach((it) => {
    const key = (it.q || '').toLowerCase().trim().split(/\s+/).slice(0, 2).join(' ');
    counts[key] = (counts[key] || 0) + 1;
  });
  const dupCount = Object.values(counts).filter((c) => c > 1).reduce((a, c) => a + (c - 1), 0);
  if (dupCount > 3) errors.push(`[batch self-check] ${name}: too many near-duplicate first-2-word openings (${dupCount}, allowed <=3)`);
}

// Aggregate checks that schema.json (and therefore ajv) structurally cannot
// express. Only called after ajv has already confirmed the bundle is
// structurally valid, so it's safe to assume shape here.
function aggregateChecks(bundle) {
  const errors = [];

  ['pinterest', 'tiktok', 'reddit'].forEach((p) => {
    const arr = bundle.queries[p];
    densityCheck(p, arr, errors);
    nearDupCheck(p, arr, errors);
  });

  const stages = new Set();
  ['pinterest', 'tiktok', 'reddit'].forEach((p) => {
    bundle.queries[p].forEach((item) => stages.add(item.stage));
  });
  if (stages.size < 3) {
    errors.push(`[axiom3] 5A coverage across all 45 items is only ${stages.size} distinct stage(s), need >=3 (schema.json's per-item enum check cannot catch this)`);
  }

  sensitiveCategoryCheck(bundle, errors);
  personaInformedCheck(bundle, errors);

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
function buildValidGoodBucket(prefix) {
  // A minimal, schema-valid, axiom-2/3/4-passing 15-item bucket used to build
  // synthetic adversarial fixtures below. Not meant to be realistic content --
  // only meant to isolate ONE violation at a time so the self-test proves the
  // script catches that ONE thing.
  const stages = ['Aware', 'Appeal', 'Ask', 'Act', 'Advocate'];
  return Array.from({ length: 15 }, (_, i) => ({
    q: `${prefix} aesthetic routine idea ${i}`,
    intent_cn: `泛用:测试用条目${i}`,
    stage: stages[i % stages.length],
  }));
}

function baseGoodBundle() {
  return {
    product_name: 'synthetic adversarial fixture (selftest only, not a real product)',
    category: '通用',
    queries: {
      pinterest: buildValidGoodBucket('pinterest'),
      tiktok: buildValidGoodBucket('#tiktok'),
      reddit: buildValidGoodBucket('why reddit'),
    },
    meta: { based_on_5a: 'Aware+Ask', generated_by: '100x-search-query' },
  };
}

function selftest() {
  const ajvValidateFn = loadAjvValidator();
  let allOk = true;

  // Check 1: both real, shipped evals/ files must pass.
  const evalFiles = fs.readdirSync(EVALS_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(EVALS_DIR, f));
  if (evalFiles.length === 0) {
    console.log('SELFTEST FAIL: no files found in evals/');
    allOk = false;
  }
  evalFiles.forEach((f) => {
    const bundle = JSON.parse(fs.readFileSync(f, 'utf8'));
    const errors = validate(bundle, ajvValidateFn);
    if (errors.length === 0) {
      console.log(`SELFTEST PASS (1/13 real evals): ${path.relative(process.cwd(), f)}`);
    } else {
      console.log(`SELFTEST FAIL (1/13 real evals, expected PASS): ${path.relative(process.cwd(), f)}`);
      errors.forEach((e) => console.log('  - ' + e));
      allOk = false;
    }
  });

  // Check 2: 45/45 items validly stage:"Advocate".
  // Structurally valid (would pass ajv/schema.json cleanly) but must FAIL this
  // script's hand-written axiom-3 coverage aggregate.
  {
    const bundle = baseGoodBundle();
    bundle.queries.pinterest = bundle.queries.pinterest.map((it) => ({ ...it, stage: 'Advocate' }));
    bundle.queries.tiktok = bundle.queries.tiktok.map((it) => ({ ...it, stage: 'Advocate' }));
    bundle.queries.reddit = bundle.queries.reddit.map((it) => ({ ...it, stage: 'Advocate' }));
    bundle.meta.based_on_5a = 'Advocate';
    const errors = validate(bundle, ajvValidateFn);
    const hitCoverageError = errors.some((e) => e.includes('[axiom3]') && e.includes('coverage'));
    if (hitCoverageError) {
      console.log('SELFTEST PASS (2/13 all-Advocate adversarial correctly FAILS on axiom3 coverage)');
    } else {
      console.log('SELFTEST FAIL (2/13): all-Advocate adversarial did NOT trigger the axiom3 coverage error as expected');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 3: Pinterest bucket with zero aesthetic-word hits must FAIL axiom-2
  // density specifically (proves the density check is real, not decorative).
  {
    const bundle = baseGoodBundle();
    bundle.queries.pinterest = Array.from({ length: 15 }, (_, i) => ({
      q: `plain product search term number ${i}`,
      intent_cn: `泛用:测试用条目${i}`,
      stage: ['Aware', 'Appeal', 'Ask', 'Act', 'Advocate'][i % 5],
    }));
    const errors = validate(bundle, ajvValidateFn);
    const hitDensityError = errors.some((e) => e.includes('[axiom2] pinterest'));
    if (hitDensityError) {
      console.log('SELFTEST PASS (3/13 zero-aesthetic Pinterest bucket correctly FAILS on axiom2 density)');
    } else {
      console.log('SELFTEST FAIL (3/13): zero-aesthetic Pinterest bucket did NOT trigger the axiom2 density error as expected');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 4/13: sensitive-category detection (workflow.md Phase1 step 6).
  // Feminine intimate care with a fake FDA + fake gynecologist-
  // endorsement pattern.
  function buildSensitiveBundle(withWarning) {
    const bundle = baseGoodBundle();
    bundle.product_name = 'synthetic adversarial fixture: fda certified gynecologist recommended intimate gel (selftest only, not a real product)';
    bundle.category = '两性健康(女性私密护理)';
    bundle.queries.pinterest = buildValidGoodBucket('intimate care');
    bundle.queries.tiktok = buildValidGoodBucket('#intimatecare');
    bundle.queries.reddit = buildValidGoodBucket('why intimate');
    bundle.meta.warnings = withWarning ? ['该品类涉及平台内容政策敏感区，Pinterest/TikTok搜索词生成前建议人工过一遍平台规则'] : [];
    return bundle;
  }

  {
    const errors = validate(buildSensitiveBundle(false), ajvValidateFn);
    const hitSensitiveError = errors.some((e) => e.includes('[sensitive-category]'));
    if (hitSensitiveError) {
      console.log('SELFTEST PASS (4/13 sensitive-category bundle WITHOUT required warning correctly FAILS)');
    } else {
      console.log('SELFTEST FAIL (4/13): sensitive-category bundle without warning did NOT trigger the check as expected');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }
  {
    const errors = validate(buildSensitiveBundle(true), ajvValidateFn);
    const hitSensitiveError = errors.some((e) => e.includes('[sensitive-category]'));
    if (!hitSensitiveError) {
      console.log('SELFTEST PASS (5/13 sensitive-category bundle WITH required warning correctly PASSES that check)');
    } else {
      console.log('SELFTEST FAIL (5/13): sensitive-category bundle WITH the warning still triggered the check (false positive)');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 6/13: ajv additionalProperties enforcement -- a hand-rolled checker
  // that only looks at q/intent_cn/stage would never ask "are there other
  // fields present that schema.json forbids?".
  {
    const bundle = baseGoodBundle();
    bundle.queries.pinterest[0].extra_field_not_in_schema = 'should be rejected by additionalProperties:false';
    const errors = validate(bundle, ajvValidateFn);
    const hitAdditionalPropsError = errors.some((e) => e.includes('additionalProperties') || e.includes('additional properties'));
    if (hitAdditionalPropsError) {
      console.log('SELFTEST PASS (6/13 query_item with an undeclared extra field correctly FAILS via ajv additionalProperties)');
    } else {
      console.log('SELFTEST FAIL (6/13): query_item with an undeclared extra field did NOT get rejected -- additionalProperties is not being enforced');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 7/13: ajv enum enforcement for `stage` -- regression guard so the
  // enum check is never silently lost.
  {
    const bundle = baseGoodBundle();
    bundle.queries.pinterest[0].stage = 'Mature';
    const errors = validate(bundle, ajvValidateFn);
    // ajv's enum error message text is "must be equal to one of the allowed
    // values" (it does not literally contain the word "enum" -- that's the
    // *keyword* name, not the message), so match on the actual message text.
    const hitEnumError = errors.some((e) => e.includes('allowed values'));
    if (hitEnumError) {
      console.log('SELFTEST PASS (7/13 query_item with stage outside the 5-value enum correctly FAILS via ajv enum)');
    } else {
      console.log('SELFTEST FAIL (7/13): query_item with an invalid stage value did NOT get rejected -- enum is not being enforced');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 8/13: SCAN-SCOPE bypass repro. category/product_name are clean of
  // any sensitive-category word; the sensitive-category word AND the authority-
  // claim word only appear inside the GENERATED q/intent_cn text, with
  // meta.warnings empty -- this must FAIL on sensitive-category.
  function buildScanScopeBypassBundle(withWarning) {
    const bundle = baseGoodBundle();
    bundle.product_name = 'synthetic adversarial fixture: daily wellness gel (selftest only, not a real product)';
    bundle.category = '通用保健';
    bundle.queries.tiktok[0] = { q: '#libido boost gel honest review', intent_cn: '种草:活力凝胶体验分享', stage: 'Act' };
    bundle.queries.reddit[0] = { q: 'is this libido gel fda approved by a real doctor', intent_cn: '质疑:这个凝胶真的有官方认证吗', stage: 'Ask' };
    bundle.meta.warnings = withWarning ? ['该品类涉及平台内容政策敏感区，Pinterest/TikTok搜索词生成前建议人工过一遍平台规则'] : [];
    return bundle;
  }

  {
    const errors = validate(buildScanScopeBypassBundle(false), ajvValidateFn);
    const hitSensitiveError = errors.some((e) => e.includes('[sensitive-category]'));
    if (hitSensitiveError) {
      console.log('SELFTEST PASS (8/13 scan-scope bypass: sensitive words only in generated q/intent_cn, category/product_name clean -- correctly FAILS now)');
    } else {
      console.log('SELFTEST FAIL (8/13): scan-scope bypass bundle did NOT trigger the sensitive-category check -- scan-scope check failed');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }
  {
    const errors = validate(buildScanScopeBypassBundle(true), ajvValidateFn);
    const hitSensitiveError = errors.some((e) => e.includes('[sensitive-category]'));
    if (!hitSensitiveError) {
      console.log('SELFTEST PASS (9/13 same scan-scope bypass bundle WITH required warning correctly PASSES that check)');
    } else {
      console.log('SELFTEST FAIL (9/13): scan-scope bypass bundle WITH the warning still triggered the check (false positive)');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 10/13: WORD-LIST bypass repro. The sensitive-category signal IS
  // inside category/product_name (so scan-scope is NOT the variable under test
  // here), but it's phrased using euphemisms the word lists did not contain
  // at all ("持久力"/"stamina" framing instead of any literal word in
  // SENSITIVE_CATEGORY_WORDS; "doctor approved" instead of "doctor
  // recommended" in AUTHORITY_CLAIM_WORDS), with meta.warnings empty -- this
  // must FAIL on sensitive-category.
  function buildSynonymBypassBundle(withWarning) {
    const bundle = baseGoodBundle();
    bundle.product_name = 'synthetic adversarial fixture: stamina boost formula, doctor approved (selftest only, not a real product)';
    bundle.category = '男性持久力';
    bundle.queries.pinterest = buildValidGoodBucket('stamina');
    bundle.queries.tiktok = buildValidGoodBucket('#stamina');
    bundle.queries.reddit = buildValidGoodBucket('why stamina');
    bundle.meta.warnings = withWarning ? ['该品类涉及平台内容政策敏感区，Pinterest/TikTok搜索词生成前建议人工过一遍平台规则'] : [];
    return bundle;
  }

  {
    const errors = validate(buildSynonymBypassBundle(false), ajvValidateFn);
    const hitSensitiveError = errors.some((e) => e.includes('[sensitive-category]'));
    if (hitSensitiveError) {
      console.log('SELFTEST PASS (10/13 word-list bypass: euphemism category+authority wording correctly triggers check -- correctly FAILS now)');
    } else {
      console.log('SELFTEST FAIL (10/13): word-list bypass bundle did NOT trigger the sensitive-category check -- word-list expansion regressed');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }
  {
    const errors = validate(buildSynonymBypassBundle(true), ajvValidateFn);
    const hitSensitiveError = errors.some((e) => e.includes('[sensitive-category]'));
    if (!hitSensitiveError) {
      console.log('SELFTEST PASS (11/13 same word-list bypass bundle WITH required warning correctly PASSES that check)');
    } else {
      console.log('SELFTEST FAIL (11/13): word-list bypass bundle WITH the warning still triggered the check (false positive)');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }

  // Check 12/13: axiom 5 persona-informed coverage. persona_informed=true
  // + real descriptor terms declared, but NONE of the 45 queries actually
  // contain them -- the exact "accepted the card but ignored it" bug this axiom
  // exists to catch.
  function buildPersonaInformedBundle(hitCount) {
    const bundle = baseGoodBundle();
    bundle.meta.persona_informed = true;
    bundle.meta.persona_descriptor_terms = ['postpartum recovery', 'new mom'];
    if (hitCount > 0) {
      const pinterestArr = bundle.queries.pinterest;
      for (let i = 0; i < hitCount && i < pinterestArr.length; i++) {
        pinterestArr[i] = { ...pinterestArr[i], q: `postpartum recovery aesthetic idea ${i}` };
      }
    }
    return bundle;
  }

  {
    const errors = validate(buildPersonaInformedBundle(0), ajvValidateFn);
    const hitAxiom5Error = errors.some((e) => e.includes('[axiom5]') && e.includes('0/45'));
    if (hitAxiom5Error) {
      console.log('SELFTEST PASS (12/13 persona_informed=true with 0/45 term hits correctly FAILS on axiom5)');
    } else {
      console.log('SELFTEST FAIL (12/13): persona_informed=true with 0/45 term hits did NOT trigger axiom5 as expected');
      console.log('  errors were:', errors);
      allOk = false;
    }
  }
  {
    const errors = validate(buildPersonaInformedBundle(6), ajvValidateFn);
    const hitAxiom5Error = errors.some((e) => e.includes('[axiom5]'));
    if (!hitAxiom5Error) {
      console.log('SELFTEST PASS (13/13 persona_informed=true with 6/45 term hits correctly PASSES axiom5, proving the check counts hits rather than always failing)');
    } else {
      console.log('SELFTEST FAIL (13/13): persona_informed=true with 6/45 term hits still triggered axiom5 (false positive)');
      console.log('  errors were:', errors);
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
  console.log(ok ? '\nSELFTEST: ALL 13 CHECKS BEHAVED AS EXPECTED' : '\nSELFTEST: AT LEAST ONE CHECK FAILED');
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
