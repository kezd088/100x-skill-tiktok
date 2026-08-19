#!/usr/bin/env node
/**
 * 100x-prompt-compose real validator.
 *
 * WHY THIS FILE EXISTS (same pattern as 100x-search-query / 100x-persona):
 * schema.json (vanilla JSON Schema draft-07, compiled by ajv) can validate PER-ITEM
 * shape: template_id enum, category enum, additionalProperties, the reference_locks
 * status<->value pattern (if/then), the scene/scenes/place/rooms no-lighting-word
 * pattern, and the category<->model/video_unit nullity conditional. It CANNOT:
 *
 *   (a) look up templates.json to confirm rendered_body is a byte-for-byte
 *       reconstruction of the chosen template's body with every {key} substituted
 *       (axiom 1) -- JSON Schema has no notion of "read another file and rebuild a
 *       string from it";
 *   (b) confirm a reference_locks entry with status:"reference_reuse" actually
 *       points at a ref_number that was established earlier -- either in
 *       meta.existing_refs_input (a sibling object) or an earlier first_lock entry
 *       in the same array (axiom 2) -- JSON Schema cannot compare a regex-captured
 *       number embedded in one field's string value against an unrelated array/object
 *       elsewhere in the document;
 *   (c) scan video_unit.final_prompt_wrapped against the per-model duration cap /
 *       banned-word list / required trailing phrase documented in profiles/veo.md
 *       and profiles/seedance.md (axiom 4) -- encoding ~20 banned words per model as
 *       schema if/then branches would mean hand-copying those prose word-lists a
 *       second time inside schema.json, which is the exact "two places to keep in
 *       sync" anti-pattern this build avoids. Kept here as plain JS, exactly like
 *       100x-search-query's PINTEREST_WORDS/TIKTOK_FORMAT_WORDS/REDDIT_QWORDS tables.
 *
 * VALIDATION ORDER: ajv runs first. If ajv fails, this script reports the ajv errors
 * and does NOT run the hand-written aggregate checks below (no point reconstructing
 * a template body against a document that doesn't even have a valid shape).
 *
 * USAGE:
 *   node scripts/validate.js <file1.json> [file2.json ...]
 *     Validates each given ComposedPromptBundle JSON file. Exits 0 if all pass, 1 if
 *     any fails (prints the specific failing rule(s) per file).
 *
 *   node scripts/validate.js --selftest
 *     Runs a fixed regression suite and prints PASS/FAIL for each check. Exits
 *     nonzero if any check doesn't behave as described. See the numbered checks in
 *     selftest() below for exactly what each one proves.
 *
 * DEPENDENCIES: ajv (see package.json). Run `npm install` in this directory first.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const SCHEMA_PATH = path.join(__dirname, '..', 'schema.json');
const TEMPLATES_PATH = path.join(__dirname, '..', 'templates.json');
const EVALS_DIR = path.join(__dirname, '..', 'evals');

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function loadTemplatesFile() {
  return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
}

function loadAjvValidator(schema) {
  // strict:false -- schema.json intentionally uses additionalProperties:true on
  // `meta` (extensible metadata, not a closed set) and allOf/if/then/else, which are
  // legitimate JSON Schema, not mistakes; ajv strict mode flags some stylistic
  // patterns it doesn't need to for correctness.
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatAjvErrors(ajvErrors) {
  return (ajvErrors || []).map((e) => {
    const loc = e.instancePath && e.instancePath.length ? e.instancePath : '(root)';
    const extra = e.params ? ` ${JSON.stringify(e.params)}` : '';
    return `[schema:ajv] ${loc} ${e.message}${extra}`;
  });
}

// ---- Axiom 4 model-wrapper constants ---------------------------------------
// Keep byte-for-byte in sync with profiles/veo.md and profiles/seedance.md.
// This skill wraps ONE rendered template body per call (no multi-shot GU
// splitting -- see profiles/*.md scope disclosures), so each video_unit is a
// single generation unit whose duration must equal (not just be <=) the
// model's cap.
const MODEL_DURATION_CAP = { veo: 8.0, seedance: 10.0, '即创': null };

const MODEL_BANNED_WORDS = {
  veo: [
    'cinematic', 'professional', 'studio', 'stunning', 'flawless', 'perfect',
    'smooth skin', 'polished', 'editorial', 'glamour', 'pristine',
    'quietly', 'deeply', 'fundamentally', 'remarkably', 'arguably',
    'delve', 'utilize', 'leverage', 'robust', 'streamline', 'harness',
  ],
  seedance: [
    'cinematic', 'professional', 'studio', 'beautiful', 'stunning', 'smooth skin',
    'perfect', 'flawless', 'polished', 'editorial', 'glamour',
    'text', 'subtitle', 'caption', 'watermark', 'logo', 'title', 'font', 'letter', 'word', 'overlay',
  ],
  // No banned-word source material for 即创 -- known limitation, see SKILL.md.
  '即创': null,
};

const MODEL_REQUIRED_TRAILING = {
  veo: 'Keep lighting, color grade, and overall visual feel consistent with the reference frame.',
  seedance: 'no text, no subtitles, no watermarks',
  '即创': null,
};

const MODEL_NARRATIVE_SHOT_ENUM = ['情绪', '痛点', '产品', '场景', '对比', '转折', 'CTA'];

function modelWrapperCheck(bundle, errors) {
  if (bundle.category !== '视频' || !bundle.model) return; // axiom4 only applies to video+model
  const vu = bundle.video_unit;
  const model = bundle.model;

  if (!vu) {
    errors.push('[axiom4] category is 视频 with a model chosen but video_unit is missing');
    return;
  }

  const cap = MODEL_DURATION_CAP[model];
  if (cap !== null) {
    if (vu.duration_seconds !== cap) {
      errors.push(`[axiom4] video_unit.duration_seconds is ${vu.duration_seconds}, expected exactly ${cap} for model=${model} (profiles/${model}.md)`);
    }
  }

  const bannedList = MODEL_BANNED_WORDS[model];
  if (bannedList) {
    // Known adaptation (disclosed in profiles/seedance.md): the
    // mandatory closing negative-instruction phrase itself ("no text, no
    // subtitles, no watermarks") necessarily contains 3 of seedance's own
    // banned text-layer words (text/subtitle/watermark). The private-repo
    // seedance axioms.md states both "A8: 0 banned-word hits" and "A9:
    // must end with that exact phrase" without showing how its own (never-
    // provided) validator reconciled the overlap. The only self-consistent
    // reading -- and the one this skill adopts -- is that the required
    // trailing phrase is a whitelisted negative-instruction idiom, not a
    // positive content assertion; it is stripped from the text once before
    // the banned-word scan runs (mirrors veo's own documented exception for
    // "(no subtitles)").
    const requiredTrailing = MODEL_REQUIRED_TRAILING[model];
    let scanText = vu.final_prompt_wrapped || '';
    if (requiredTrailing) {
      scanText = scanText.split(requiredTrailing).join('');
    }
    // Word-boundary match, not substring containment: a naive .includes('text')
    // would false-positive on ordinary UGC vocabulary like "texture" (skin
    // texture is one of the most common words in this exact prompt domain,
    // literally the English translation of realism_suffix's "真实皮肤纹理").
    // Avoids false-positive on ordinary UGC vocabulary like "texture".
    const hits = bannedList.filter((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, 'i').test(scanText));
    if (hits.length > 0) {
      errors.push(`[axiom4] video_unit.final_prompt_wrapped for model=${model} hit banned word(s): ${hits.join(', ')}`);
    }
  }

  if (model === 'veo' && (vu.final_prompt_wrapped || '').includes('"')) {
    errors.push('[axiom4] video_unit.final_prompt_wrapped for model=veo contains a double quote (triggers Veo captions, see profiles/veo.md)');
  }

  const trailing = MODEL_REQUIRED_TRAILING[model];
  if (trailing !== null) {
    if (!(vu.final_prompt_wrapped || '').includes(trailing)) {
      errors.push(`[axiom4] video_unit.final_prompt_wrapped for model=${model} is missing the required trailing phrase "${trailing}"`);
    }
  }

  if (model === '即创') {
    if (!vu.narrative_shot_type || !MODEL_NARRATIVE_SHOT_ENUM.includes(vu.narrative_shot_type)) {
      errors.push('[axiom4] video_unit.narrative_shot_type is required and must be one of the 7 narrative-shot categories when model=即创');
    }
  }
}

// ---- Axiom 1: rendered_body reconstruction against templates.json ----------
function findTemplate(templatesFile, templateId) {
  return templatesFile.templates.find((t) => t.id === templateId);
}

function resolveConditionalClauses(template, variablesUsed) {
  const resolved = {};
  if (!template.conditional) return resolved;

  if (template.id === 'IMG-02-persona-whitebg' && template.conditional.problem_clause) {
    const problem = variablesUsed.problem;
    resolved.problem_clause = problem
      ? template.conditional.problem_clause.replace('{problem}', problem)
      : '';
  }

  if (template.id === 'IMG-05-before-after' && template.conditional.layout_desc) {
    const layout = variablesUsed.layout;
    if (layout === '上下') resolved.layout_desc = '上图/下图';
    else if (layout === '左右') resolved.layout_desc = '左图/右图';
    else resolved.layout_desc = UNRESOLVED_LAYOUT;
  }

  if (template.id === 'PART-HOOK' && template.conditional.hook_clause) {
    const hookType = variablesUsed.hook_type;
    const raw = template.hook_library ? template.hook_library[hookType] : undefined;
    if (!raw) {
      resolved.hook_clause = UNRESOLVED_HOOK_TYPE;
    } else {
      resolved.hook_clause = raw
        .replace(/\{subject\}/g, variablesUsed.subject || '')
        .replace(/\{detail\}/g, variablesUsed.detail || '');
    }
  }

  return resolved;
}

// Internal sentinels: resolveConditionalClauses/expandBracketInstructions emit
// these when a conditional/bracket-expansion input (hook_type / effect_formula /
// layout) is missing or doesn't match a known templates.json library key. They
// must never legitimately survive into a passing rendered_body -- axiom1Check
// below treats their presence as a hard FAIL (see banner there for why this
// can't be caught by the existing {placeholder} regex alone).
const UNRESOLVED_HOOK_TYPE = '__UNRESOLVED_HOOK_TYPE__';
const UNRESOLVED_EFFECT_FORMULA = '__UNRESOLVED_EFFECT_FORMULA__';
const UNRESOLVED_LAYOUT = '__UNRESOLVED_LAYOUT__';
const UNRESOLVED_SENTINELS = [UNRESOLVED_HOOK_TYPE, UNRESOLVED_EFFECT_FORMULA, UNRESOLVED_LAYOUT];

// Bracket-expansion special cases (templates.json meta.render_notes): the
// bracketed authoring instruction is replaced wholesale by the library-resolved
// descriptive text, not left in the output with brackets around it.
function expandBracketInstructions(bodyAfterKeySub, template, variablesUsed) {
  let out = bodyAfterKeySub;

  if (template.id === 'VID-A-efficacy-stack' || template.id === 'VID-F-dark-humor') {
    const effectKey = variablesUsed.effect_formula;
    const lib = template.effect_library || {};
    // VID-A: 【效果公式：{effect_formula}——按所选公式展开变化描写】
    out = out.replace(/【效果公式：[^】]*】/, () => lib[effectKey] || UNRESOLVED_EFFECT_FORMULA);
  }

  if (template.id === 'VID-F-dark-humor') {
    // VID-F also has a second, differently-worded bracket for the same mechanic.
    out = out.replace(/【套效果公式：[^】]*】/, () => {
      const effectKey = variablesUsed.effect_formula;
      const lib = template.effect_library || {};
      return lib[effectKey] || UNRESOLVED_EFFECT_FORMULA;
    });
  }

  if (template.id === 'PART-HOOK') {
    out = out.replace(/【按 hook_type 选骨架】/, '');
  }

  return out;
}

function reconstructExpectedBody(templatesFile, bundle) {
  const template = findTemplate(templatesFile, bundle.template_id);
  if (!template) return { error: `template_id ${bundle.template_id} not found in templates.json` };

  const suffixText = templatesFile.realism_suffix[template.suffix_key];
  if (suffixText === undefined) {
    return { error: `template ${template.id} declares suffix_key "${template.suffix_key}" which does not exist in templates.json realism_suffix` };
  }

  const conditionalResolved = resolveConditionalClauses(template, bundle.variables_used || {});
  const substMap = Object.assign({}, bundle.variables_used, conditionalResolved, { realism_suffix: suffixText });

  let body = template.body;
  body = body.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(substMap, key)) return substMap[key];
    return match; // leave unresolved placeholders visible so the diff below catches them
  });

  body = expandBracketInstructions(body, template, bundle.variables_used || {});

  return { expected: body, template };
}

function axiom1Check(templatesFile, bundle, errors) {
  const result = reconstructExpectedBody(templatesFile, bundle);
  if (result.error) {
    errors.push(`[axiom1] ${result.error}`);
    return;
  }
  if (result.template.category !== bundle.category) {
    errors.push(`[axiom1] bundle.category "${bundle.category}" does not match templates.json's declared category "${result.template.category}" for ${bundle.template_id}`);
  }
  if (result.expected !== bundle.rendered_body) {
    errors.push(`[axiom1] rendered_body is not a byte-for-byte reconstruction of templates.json body with {key} substitution (found a paraphrase, omission, or unresolved placeholder). expected="${result.expected}" actual="${bundle.rendered_body}"`);
  }
  if (/\{[a-zA-Z0-9_]+\}/.test(bundle.rendered_body)) {
    errors.push('[axiom1] rendered_body still contains an unresolved {placeholder} token');
  }
  // Unresolved sentinels check: when hook_type / effect_formula /
  // layout is missing or doesn't match a templates.json library key,
  // resolveConditionalClauses/expandBracketInstructions substitute one of the
  // UNRESOLVED_SENTINELS strings above instead of real content. Those sentinels
  // don't contain "{" so the {placeholder} regex just above never sees them, AND
  // reconstructExpectedBody would happily rebuild the *same* sentinel-bearing
  // string as "expected" -- so a hand-typed rendered_body that copies the same
  // sentinel text passes the strict === check too. Scanning rendered_body for the
  // sentinels directly is the only way to catch this; it cannot be expressed as a
  // schema.json keyword because it depends on the templates.json library lookup
  // that produced the sentinel in the first place.
  UNRESOLVED_SENTINELS.forEach((sentinel) => {
    if ((bundle.rendered_body || '').includes(sentinel)) {
      errors.push(`[axiom1] rendered_body contains the internal unresolved-value sentinel "${sentinel}" -- a required bracket-expansion/conditional input (hook_type / effect_formula / layout) was missing or invalid and never resolved against templates.json's library`);
    }
  });
}

// ---- Axiom 2: reference-lock referential integrity --------------------------
const REF_PATTERN = /^参考图(\d+)(产品|人物)$/;
// Looser, non-anchored version for scanning free-text variables_used values (e.g.
// "（参考图1产品，外形与图一致）" or a bare "参考图99产品") -- those values are not
// required to be an exact match of REF_PATTERN, only to *contain* the shorthand.
const REF_MENTION_PATTERN = /参考图(\d+)(产品|人物)/;

// Referential integrity check: a bundle can leave
// reference_locks[] empty/absent while variables_used.product_lock (or
// persona_ref) still asserts "参考图N产品/人物" in prose (and rendered_body
// repeats that same fabricated claim). The pre-fix version of this function
// returned immediately when reference_locks was empty and never looked at
// variables_used at all, so a wholly invented ref_number sailed through.
//
// Scan every string-valued variables_used entry for the REF_MENTION_PATTERN
// shorthand, not just product_lock/persona_ref, since free-text variables like `persona`
// may also carry reference claims. LOCK_REF_VARIABLE_ENTITY is
// now used only as an *additional* entity-name consistency check for the two
// keys it was originally designed for (does product_lock's mentioned entity
// really match "产品"?); for any other key, the claimed entity is read
// directly off the regex match itself (m[2]), since there is no documented
// key->entity mapping to cross-check a generic key against.
const LOCK_REF_VARIABLE_ENTITY = { product_lock: '产品', persona_ref: '人物' };

function scanVariablesUsedForRefClaims(bundle) {
  const vu = bundle.variables_used || {};
  const claims = [];
  Object.keys(vu).forEach((key) => {
    if (typeof vu[key] !== 'string') return;
    const m = REF_MENTION_PATTERN.exec(vu[key]);
    if (!m) return; // free-text description with no 参考图N产品/人物 shorthand embedded
    const mentionedEntity = m[2]; // 产品 or 人物, read directly off the regex match
    const expectedEntity = LOCK_REF_VARIABLE_ENTITY[key]; // undefined for keys outside the historically-named two
    claims.push({ key, entity: expectedEntity || mentionedEntity, refNum: parseInt(m[1], 10), mentionedEntity, rawValue: vu[key] });
  });
  return claims;
}

// WHY SCHEMA CAN'T DO THIS (whole function): confirming a reference_reuse claim
// is real needs (a) parsing a ref number out of a free-text string, (b) cross-
// checking it against meta.existing_refs_input (a sibling object), and now also
// (c) cross-checking variables_used against reference_locks[] (a second sibling
// array) to make sure the two don't silently disagree. That's a three-way
// cross-field comparison across the document -- JSON Schema has no mechanism for
// comparing a regex-captured number in one field against unrelated
// arrays/objects located elsewhere in the same document.
function checkReferenceLockIntegrity(bundle, errors) {
  const locks = bundle.reference_locks || [];
  const claims = scanVariablesUsedForRefClaims(bundle);
  if (locks.length === 0 && claims.length === 0) return;

  const existing = (bundle.meta && bundle.meta.existing_refs_input) || { '产品': [], '人物': [] };
  const knownSoFar = {
    '产品': new Set(existing['产品'] || []),
    '人物': new Set(existing['人物'] || []),
  };
  const newlyEstablished = { '产品': [], '人物': [] };

  locks.forEach((lock, idx) => {
    if (lock.status === 'reference_reuse') {
      const m = REF_PATTERN.exec(lock.value);
      if (!m) return; // schema/ajv already rejects this shape; nothing more to check here
      const refNum = parseInt(m[1], 10);
      const entityFromValue = m[2];
      if (entityFromValue !== lock.entity) {
        errors.push(`[axiom2] reference_locks[${idx}]: value "${lock.value}" refers to entity "${entityFromValue}" but lock.entity is "${lock.entity}" (mismatch)`);
      }
      if (!knownSoFar[lock.entity] || !knownSoFar[lock.entity].has(refNum)) {
        errors.push(`[axiom2] reference_locks[${idx}]: value "${lock.value}" points at ref_number ${refNum}, which is not in meta.existing_refs_input.${lock.entity} (not established by a prior compose call) -- referential integrity failure, schema.json cannot check this`);
      }
      if (lock.ref_number !== refNum) {
        errors.push(`[axiom2] reference_locks[${idx}]: lock.ref_number (${lock.ref_number}) does not match the number embedded in value "${lock.value}" (${refNum})`);
      }
    } else {
      // first_lock: ref_number must be new (not already established for this entity).
      if (knownSoFar[lock.entity] && knownSoFar[lock.entity].has(lock.ref_number)) {
        errors.push(`[axiom2] reference_locks[${idx}]: status is first_lock but ref_number ${lock.ref_number} for entity ${lock.entity} is already in meta.existing_refs_input (would collide with an already-established lock)`);
      }
      newlyEstablished[lock.entity].push(lock.ref_number);
    }
  });

  // Cross-check variables_used lock-referencing claims independently of whether
  // reference_locks[] was populated -- this is the part that closes the
  // confirmed gap (see banner above).
  claims.forEach((claim) => {
    if (claim.mentionedEntity !== claim.entity) {
      errors.push(`[axiom2] variables_used.${claim.key} = "${claim.rawValue}" mentions entity "${claim.mentionedEntity}" but ${claim.key} is documented (templates.json variable_glossary) to refer to entity "${claim.entity}" (mismatch)`);
    }
    if (!knownSoFar[claim.entity] || !knownSoFar[claim.entity].has(claim.refNum)) {
      errors.push(`[axiom2] variables_used.${claim.key} = "${claim.rawValue}" claims a reference to 参考图${claim.refNum}${claim.entity}, which is not in meta.existing_refs_input.${claim.entity} (not established by a prior compose call) -- checked directly against variables_used because reference_locks[] can be left empty while the rendered prose still asserts the reference`);
    }
    const declaredInLocks = locks.some((l) => {
      if (l.status !== 'reference_reuse' || l.entity !== claim.entity) return false;
      const lm = REF_PATTERN.exec(l.value);
      return !!lm && parseInt(lm[1], 10) === claim.refNum;
    });
    if (!declaredInLocks) {
      errors.push(`[axiom2] variables_used.${claim.key} claims a reference to 参考图${claim.refNum}${claim.entity} but reference_locks[] has no matching status:"reference_reuse" entry for it -- the rendered content and the structural lock ledger have drifted apart`);
    }
  });

  if (locks.length === 0) return; // nothing declared in reference_locks[]: established_refs_after has nothing to reconcile against (any claim-only problems were already reported above)

  const expectedAfter = {
    '产品': Array.from(new Set([...(existing['产品'] || []), ...newlyEstablished['产品']])).sort((a, b) => a - b),
    '人物': Array.from(new Set([...(existing['人物'] || []), ...newlyEstablished['人物']])).sort((a, b) => a - b),
  };
  const actualAfter = (bundle.meta && bundle.meta.established_refs_after) || null;
  if (!actualAfter) {
    errors.push('[axiom2] reference_locks is non-empty but meta.established_refs_after is missing');
  } else {
    ['产品', '人物'].forEach((entity) => {
      const expectedSet = JSON.stringify(expectedAfter[entity]);
      const actualSet = JSON.stringify(Array.from(new Set(actualAfter[entity] || [])).sort((a, b) => a - b));
      if (expectedSet !== actualSet) {
        errors.push(`[axiom2] meta.established_refs_after.${entity} is ${actualSet}, expected ${expectedSet} (existing_refs_input union this call's new first_lock ref_numbers)`);
      }
    });
  }
}

// Full pipeline: ajv structural pass first, then the three cross-file/cross-item
// checks that schema.json cannot express.
function validate(bundle, ajvValidateFn, templatesFile) {
  const structurallyValid = ajvValidateFn(bundle);
  if (!structurallyValid) {
    return formatAjvErrors(ajvValidateFn.errors);
  }
  const errors = [];
  axiom1Check(templatesFile, bundle, errors);
  checkReferenceLockIntegrity(bundle, errors);
  modelWrapperCheck(bundle, errors);
  return errors;
}

function runOne(file, ajvValidateFn, templatesFile) {
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validate(bundle, ajvValidateFn, templatesFile);
  if (errors.length === 0) {
    console.log(`PASS: ${file}`);
  } else {
    console.log(`FAIL: ${file}`);
    errors.forEach((e) => console.log('  - ' + e));
  }
  return errors.length === 0;
}

// ---- Self-test: fixed regression checks -------------------------------------
function baseImageBundle() {
  return {
    template_id: 'IMG-01-product-lock',
    category: '图片',
    variables_used: { product_desc: '白色塑料圆柱形喷雾瓶，50ml，紫到蓝渐变标签，蓝色盾牌图标，白色喷嘴，透明瓶盖' },
    rendered_body: '生成一张产品白底图。产品外观为：白色塑料圆柱形喷雾瓶，50ml，紫到蓝渐变标签，蓝色盾牌图标，白色喷嘴，透明瓶盖。真实塑料/材质质感，标签印刷清晰，无反光眩光。无美颜，无景深，无滤镜，无补光灯，真实皮肤纹理，真实环境。',
    reference_locks: [
      { entity: '产品', ref_number: 1, status: 'first_lock', value: '白色塑料圆柱形喷雾瓶，50ml，紫到蓝渐变标签，蓝色盾牌图标，白色喷嘴，透明瓶盖' },
    ],
    model: null,
    video_unit: null,
    meta: {
      generated_by: '100x-prompt-compose',
      existing_refs_input: { '产品': [], '人物': [] },
      established_refs_after: { '产品': [1], '人物': [] },
      warnings: [],
    },
  };
}

function baseVideoBundle() {
  return {
    template_id: 'VID-D-talking-share',
    category: '视频',
    variables_used: {
      persona: 'synthetic adversarial fixture persona (selftest only, not a real product)',
      body_part: 'a hand holding a small bottle',
      product_name: 'synthetic supplement',
      product_lock: '参考图1产品',
      line_open: 'People keep asking me about my morning routine.',
      line_rec: 'Grab this at the link below.',
    },
    reference_locks: [
      { entity: '产品', ref_number: 1, status: 'reference_reuse', value: '参考图1产品' },
    ],
    model: 'veo',
    video_unit: {
      duration_seconds: 8.0,
      final_prompt_wrapped: 'GU1 (reference range: 0.0-8.0s, generated duration: 8.0s). A woman holds a small bottle near a window, natural skin texture, handheld slight sway. Spoken dialogue (say EXACTLY, word-for-word): People keep asking me about my morning routine. Mouth clearly visible when speaking, lip-sync aligned with the spoken dialogue. Spoken content happens within 0.5-4.0s. From 4.0s to 8.0s, continue the current motion at the same pace-do not slow down or freeze. Keep lighting, color grade, and overall visual feel consistent with the reference frame.',
    },
    meta: {
      generated_by: '100x-prompt-compose',
      existing_refs_input: { '产品': [1], '人物': [] },
      established_refs_after: { '产品': [1], '人物': [] },
      model_choice_source: 'user_specified',
      warnings: [],
    },
  };
}

// Note: baseVideoBundle's rendered_body must ALSO be present and reconstructable
// for axiom1 to pass -- computed here from templates.json at selftest-run time
// via reconstructExpectedBody so the fixture never drifts from the real template.

function baseSeedanceBundle() {
  return {
    template_id: 'VID-A-efficacy-stack',
    category: '视频',
    variables_used: {
      persona: 'a hand wearing yellow rubber gloves',
      product_name: 'synthetic cleaning spray (selftest only, not a real product)',
      product_lock: 'clear wide-mouth plastic bottle with an orange nozzle, no reference photo yet',
      target: 'a turmeric stain on a white countertop',
      effect_formula: '泡沫爆发',
      scene: 'home kitchen counter',
    },
    reference_locks: [],
    model: 'seedance',
    video_unit: {
      duration_seconds: 10.0,
      final_prompt_wrapped: 'Static smartphone rear-camera shot, fixed frame. A hand wearing bright yellow rubber gloves holds a clear wide-mouth plastic spray bottle with an orange nozzle, aiming it at a turmeric stain on a white countertop. Thick white foam bursts out on contact and churns over the stain, then a sponge wipes it away, revealing a clean, faintly damp surface. Home kitchen counter visible in the background, raw smartphone footage, natural skin texture on the hand. no text, no subtitles, no watermarks',
    },
    meta: {
      generated_by: '100x-prompt-compose',
      existing_refs_input: { '产品': [], '人物': [] },
      established_refs_after: { '产品': [], '人物': [] },
      model_choice_source: 'user_specified',
      warnings: [],
    },
  };
}

function selftest() {
  const schema = loadSchema();
  const ajvValidateFn = loadAjvValidator(schema);
  const templatesFile = loadTemplatesFile();
  let allOk = true;
  let n = 0;
  const total = 16;

  function report(ok, label, errors) {
    n += 1;
    if (ok) {
      console.log(`SELFTEST PASS (${n}/${total} ${label})`);
    } else {
      console.log(`SELFTEST FAIL (${n}/${total} ${label})`);
      if (errors) errors.forEach((e) => console.log('  - ' + e));
      allOk = false;
    }
  }

  // 1: schema.json's template_id enum must match templates.json's real id list
  // exactly (guards against the two files drifting apart, since a template could
  // be added/removed in templates.json without anyone remembering to update the
  // enum in schema.json).
  {
    const schemaIds = schema.properties.template_id.enum.slice().sort();
    const fileIds = templatesFile.templates.map((t) => t.id).sort();
    const same = JSON.stringify(schemaIds) === JSON.stringify(fileIds);
    report(same, 'schema.json template_id enum matches templates.json ids', same ? null : [`schema=${JSON.stringify(schemaIds)}`, `file=${JSON.stringify(fileIds)}`]);
  }

  // 2: a real, valid image bundle (IMG-01) must PASS end to end.
  {
    const bundle = baseImageBundle();
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    report(errors.length === 0, 'valid IMG-01 image bundle passes end to end', errors);
  }

  // 3: a real, valid video bundle (VID-D + veo, reusing an existing product lock)
  // must PASS end to end. rendered_body is computed from templates.json so this
  // check can never silently drift from the real template body.
  {
    const bundle = baseVideoBundle();
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    report(errors.length === 0, 'valid VID-D + veo video bundle passes end to end', errors);
  }

  // 4 (axiom 1): rendered_body paraphrased instead of literal {key} substitution
  // must FAIL specifically on axiom1.
  {
    const bundle = baseImageBundle();
    bundle.rendered_body = 'A clean white studio product photo of a spray bottle.'; // paraphrase, not literal substitution
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom1]'));
    report(hit, 'paraphrased rendered_body correctly FAILS axiom1 reconstruction check', hit ? null : errors);
  }

  // 5 (axiom 2): reference_reuse pointing at a ref_number never established
  // (not in meta.existing_refs_input) must FAIL specifically on axiom2.
  {
    const bundle = baseVideoBundle();
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    bundle.meta.existing_refs_input = { '产品': [], '人物': [] }; // ref 1 was never established
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom2]') && e.includes('not established'));
    report(hit, 'reference_reuse to a never-established ref_number correctly FAILS axiom2', hit ? null : errors);
  }

  // 6 (axiom 2): a first_lock ref_number colliding with an already-established
  // number for the same entity must FAIL specifically on axiom2.
  {
    const bundle = baseImageBundle();
    bundle.meta.existing_refs_input = { '产品': [1], '人物': [] }; // ref 1 already exists
    // reference_locks[0] is still ref_number 1, status first_lock -- collision
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom2]') && e.includes('already in meta.existing_refs_input'));
    report(hit, 'first_lock colliding with an already-established ref_number correctly FAILS axiom2', hit ? null : errors);
  }

  // 7 (axiom 3, via ajv patternProperties): a scene variable containing a banned
  // lighting word must FAIL via ajv (schema-native check, run through the same
  // pipeline as everything else).
  {
    const bundle = baseImageBundle();
    bundle.template_id = 'IMG-04-cover-hook';
    bundle.category = '图片';
    bundle.variables_used = {
      subject: 'a dog\'s teeth',
      problem: 'thick yellow tartar buildup',
      persona: 'a woman in her 30s',
      scene: 'home living room with soft warm lighting',
    };
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hitPattern = errors.some((e) => e.includes('/variables_used/scene') || e.toLowerCase().includes('pattern'));
    report(hitPattern, 'scene variable with a banned lighting word correctly FAILS ajv pattern check', errors);
  }

  // 8 (axiom 4): a veo video_unit containing a banned AI word must FAIL
  // specifically on axiom4.
  {
    const bundle = baseVideoBundle();
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    bundle.video_unit.final_prompt_wrapped += ' This is a cinematic, flawless shot.';
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('banned word'));
    report(hit, 'veo video_unit with banned AI words correctly FAILS axiom4', hit ? null : errors);
  }

  // 9 (axiom 4): a veo video_unit with duration_seconds != 8.0 must FAIL
  // specifically on axiom4.
  {
    const bundle = baseVideoBundle();
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    bundle.video_unit.duration_seconds = 12.0;
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('duration_seconds'));
    report(hit, 'veo video_unit with duration_seconds=12.0 correctly FAILS axiom4', hit ? null : errors);
  }

  // 10: a real, valid seedance video bundle (VID-A) must PASS end to end,
  // proving the required-trailing-phrase exclusion (see modelWrapperCheck
  // comment) doesn't accidentally suppress legitimate output.
  {
    const bundle = baseSeedanceBundle();
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    report(errors.length === 0, 'valid VID-A + seedance video bundle passes end to end', errors);
  }

  // 11 (axiom 4): a seedance video_unit with a banned text-layer word (e.g.
  // "logo") appearing OUTSIDE the mandatory trailing phrase must still FAIL --
  // proves the trailing-phrase exclusion is scoped to that exact phrase only,
  // not a blanket bypass of the banned-word scan.
  {
    const bundle = baseSeedanceBundle();
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    bundle.video_unit.final_prompt_wrapped = bundle.video_unit.final_prompt_wrapped.replace(
      'raw smartphone footage',
      'raw smartphone footage, a small logo visible on the bottle cap'
    );
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('banned word') && e.includes('logo'));
    report(hit, 'seedance video_unit with a banned word OUTSIDE the trailing phrase correctly FAILS axiom4', hit ? null : errors);
  }

  // 12 (axiom 2 regression): a fabricated reference claim embedded directly
  // in variables_used.product_lock (e.g. "参考图99产品", a ref_number never
  // established) must FAIL even when reference_locks[] is left empty, because
  // the scan also checks variables_used, not only reference_locks[].
  {
    const bundle = baseVideoBundle();
    bundle.variables_used.product_lock = '参考图99产品';
    bundle.reference_locks = [];
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom2]') && e.includes('variables_used.product_lock'));
    report(hit, 'fabricated 参考图N产品 claim in variables_used.product_lock correctly FAILS axiom2 even with reference_locks left empty', hit ? null : errors);
  }

  // 13 (axiom 1 regression): PART-HOOK with hook_type missing/unresolvable
  // must FAIL, because a hand-typed rendered_body containing the
  // UNRESOLVED_HOOK_TYPE sentinel must not match the reconstructed expected
  // body byte-for-byte.
  {
    const bundle = {
      template_id: 'PART-HOOK',
      category: '通用件',
      variables_used: { subject: '狗的牙齿', detail: '厚层牙结石' }, // hook_type omitted (required, non-optional variable)
      rendered_body: UNRESOLVED_HOOK_TYPE + '无美颜，无景深，无滤镜，无补光灯，真实皮肤纹理，真实环境。',
      reference_locks: [],
      model: null,
      video_unit: null,
      meta: { generated_by: '100x-prompt-compose', warnings: [] },
    };
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom1]') && e.includes('UNRESOLVED_HOOK_TYPE'));
    report(hit, 'PART-HOOK with hook_type missing correctly FAILS axiom1 (unresolved sentinel no longer slips through as "expected")', hit ? null : errors);
  }

  // 14 (axiom 1 regression): VID-A with effect_formula missing/unresolvable
  // must FAIL, same mechanism as check 13. VID-F-dark-humor shares the exact
  // same expandBracketInstructions code path but is not separately selftested
  // here.
  {
    const bundle = baseSeedanceBundle();
    delete bundle.variables_used.effect_formula;
    const rec = reconstructExpectedBody(templatesFile, bundle); // itself now contains the sentinel
    bundle.rendered_body = rec.expected;
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom1]') && e.includes('UNRESOLVED_EFFECT_FORMULA'));
    report(hit, 'VID-A with effect_formula missing correctly FAILS axiom1 (unresolved sentinel no longer slips through as "expected")', hit ? null : errors);
  }

  // 15 (axiom 3 regression): a scene variable containing the English lighting
  // phrase "natural light" must FAIL via ajv, because the closed word list has
  // both the Chinese "自然光" and its English translation "natural light".
  {
    const bundle = baseImageBundle();
    bundle.template_id = 'IMG-04-cover-hook';
    bundle.category = '图片';
    bundle.variables_used = {
      subject: 'a dog\'s teeth',
      problem: 'thick yellow tartar buildup',
      persona: 'a woman in her 30s',
      scene: 'home garage with natural light',
    };
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hitPattern = errors.some((e) => e.includes('/variables_used/scene') || e.toLowerCase().includes('pattern'));
    report(hitPattern, 'scene variable with "natural light" correctly FAILS ajv pattern check', errors);
  }

  // 16 (axiom 2 regression): a fabricated reference claim embedded in a
  // variables_used key OTHER than product_lock/persona_ref (here: `persona`,
  // on a template -- IMG-04 -- that has no establishes_lock/references_lock
  // semantics at all, so reference_locks[] is legitimately empty) must still
  // FAIL, because the scan covers every string-valued variables_used key, not
  // only the two whitelisted key names.
  {
    const bundle = {
      template_id: 'IMG-04-cover-hook',
      category: '图片',
      variables_used: {
        subject: 'a dog\'s teeth',
        problem: 'thick yellow tartar buildup',
        persona: '参考图77人物，与之前完全一致',
        scene: 'home living room',
      },
      reference_locks: [],
      model: null,
      video_unit: null,
      meta: {
        generated_by: '100x-prompt-compose',
        existing_refs_input: { '产品': [], '人物': [] }, // ref 77 was never established
        warnings: [],
      },
    };
    const rec = reconstructExpectedBody(templatesFile, bundle);
    bundle.rendered_body = rec.expected;
    const errors = validate(bundle, ajvValidateFn, templatesFile);
    const hit = errors.some((e) => e.includes('[axiom2]') && e.includes('variables_used.persona'));
    report(hit, 'fabricated 参考图N人物 claim in variables_used.persona (a non-whitelisted key, on a template with no lock semantics) correctly FAILS axiom2', hit ? null : errors);
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
  console.log(ok ? '\nSELFTEST: ALL CHECKS BEHAVED AS EXPECTED' : '\nSELFTEST: AT LEAST ONE CHECK FAILED');
  process.exitCode = ok ? 0 : 1;
} else {
  const schema = loadSchema();
  const ajvValidateFn = loadAjvValidator(schema);
  const templatesFile = loadTemplatesFile();
  let allPass = true;
  args.forEach((f) => {
    const ok = runOne(f, ajvValidateFn, templatesFile);
    if (!ok) allPass = false;
  });
  process.exitCode = allPass ? 0 : 1;
}
