#!/usr/bin/env node
/**
 * 100x-visual-fission real validator.
 *
 * WHY THIS FILE EXISTS (same pattern as 100x-search-query / 100x-persona):
 * schema.json (vanilla JSON Schema draft-07, ajv-compiled) can validate a huge
 * share of this skill's rules -- including several FIXED deterministic lookup
 * tables (camera_variant A/B/C -> lighting/color keywords, aspect_ratio ->
 * resolution, media_plan.structure -> frame_count) via if/then/const, which
 * schema.json uses aggressively. What it structurally CANNOT express:
 *
 *   1. An array's length must equal a SIBLING numeric field
 *      (media_plan.frames.length === media_plan.frame_count). A document can
 *      declare frame_count:2 (valid per the structure->frame_count if/then)
 *      while frames[] actually holds 3 items -- ajv has no keyword that reads
 *      a sibling property's VALUE to bound an array's length.
 *   2. Ordering / sequence constraints across array items (media_plan.frames
 *      roles must appear in the structure's required order; multi_day's
 *      day_index values must be strictly ascending and distinct; and, for
 *      multi_day, which day-role frame is the reference-anchor "first" frame
 *      is whichever one has the SMALLEST day_index in the whole array --
 *      day_index holds the real source-narrative day number (e.g. a source
 *      that only ever cites day 3/7/14/30 must keep those literal numbers,
 *      never a re-indexed 1..N placeholder), so this is a genuine cross-item
 *      "find the minimum" comparison, not a per-item day_index==1 check).
 *      Vanilla JSON Schema validates each item against `items` independently;
 *      it has no "item N's role must come before item N+1's role" concept,
 *      and no "find the array item with the minimum value of field X" concept
 *      either. This "find the minimum day_index" rule is enforced here by
 *      dayFrameFirstReferenceCheck, since schema.json has no such construct.
 *   3. Referential integrity from one array's foreign-key-shaped field back
 *      to another array's actually-defined identity (fission_variants[].
 *      source_prompt_set_id must be a real prompt_sets[].id; frame_role +
 *      day_index must match a real media_plan.frames[] entry). schema.json's
 *      pattern/enum keywords can check FORMAT, never "does this value exist
 *      as a key/id somewhere else in the document" -- the same limitation
 *      100x-persona's axiom 1 documents for persona_ref/scene_ref.
 *   4. Zero-orphan coverage: every frame defined in media_plan.frames must be
 *      referenced by >=1 fission_variants[] entry. This needs a reverse
 *      "does every definition get used" sweep across the whole document --
 *      the same class of check as 100x-persona's axiom 4.
 *   5. Cross-branch byte-equality between two DIFFERENT top-level array
 *      fields (every fission_variants[].prompt_json.negative_prompt must
 *      equal the single top-level negative_prompt const). const can pin ONE
 *      field to a literal value; it cannot pin a field buried inside an array
 *      item to equal ANOTHER top-level field's value.
 *   6. Case-insensitive content screening against a curated word/phrase list
 *      (axiom 4's unvisualizable-claim scan -- see UNVISUALIZABLE_CLAIM_WORDS
 *      below). This IS theoretically expressible as a vanilla-regex `pattern`
 *      using per-letter case-alternation groups (e.g. "[fF][dD][aA]"), but for
 *      ~25 multi-word English/Spanish phrases that regex would be unreadable
 *      and impossible to keep in sync by hand -- so, unlike the fixed lookup
 *      tables above (which schema.json DOES enforce via if/then), this one
 *      stays in JavaScript, where matching each phrase as a whole word/phrase
 *      (see wordMatch() below) is the natural, maintainable way to express
 *      it, and lives in exactly one place (this file; axioms.md quotes it by
 *      reference, not by copy). NOTE: an earlier version matched with plain
 *      `.toLowerCase().includes(...)` (bare substring containment, no word
 *      boundary) -- short single-word entries like 'cure' then false-positive
 *      matched inside completely unrelated English words that merely contain
 *      that substring ('secure', 'manicure'), which real photography-style
 *      prompt text can plausibly contain. Fixed by requiring each entry to
 *      match as a whole word/phrase (\b-bounded), not merely as a substring.
 *
 * VALIDATION ORDER: ajv runs first. If ajv fails, this script reports the ajv
 * errors and does NOT run the hand-written aggregate checks below (no point
 * checking frame coverage on a document whose media_plan doesn't even have a
 * schema-valid shape). Only once ajv passes does the aggregate layer run.
 *
 * USAGE:
 *   node scripts/validate.js <file1.json> [file2.json ...]
 *     Validates each given VisualFissionBundle JSON file. Exits 0 if all
 *     pass, 1 if any fails (prints the specific failing rule(s) per file).
 *
 *   node scripts/validate.js --selftest
 *     Runs sixteen fixed regression checks and prints PASS/FAIL for each --
 *     see the numbered comments inside selftest() for what each one proves.
 *     Exits nonzero if any of the sixteen doesn't behave as described.
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
  // strict:false -- schema.json's `constants`/`meta` objects intentionally use
  // additionalProperties:true (extensible metadata, not a closed set), and the
  // if/then blocks reach into nested `properties.prompt_json.properties.*`
  // paths, both legitimate JSON Schema that ajv's strict mode flags stylistically.
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

// ---- Axiom 4 unvisualizable-claim word list --------------------------------
// Extracted (abstractly) from reading the two real hat-graded
// TikTok ad transcript corpora (EN + ES) used to build/test this skill: these
// are the recurring phrase SHAPES of claims that cannot be literally turned
// into a photographable frame (fabricated mechanism/authority claims, numeric
// marketing promises) as opposed to genuinely visualizable actions (unboxing a
// product, applying a cream, a facial-expression change).
const UNVISUALIZABLE_CLAIM_WORDS = [
  'cellular health', 'mitochondrial', 'anti-aging', 'anti aging',
  'clinically proven', 'clinically tested', 'third party tested', 'third-party tested',
  'fda', 'nsf approved', 'doctor recommended', 'physician recommended',
  'harvard lab', 'harvard-lab', 'money back guarantee', 'money-back guarantee',
  'guarantee', 'guaranteed', 'cure', 'reverse aging', 'no side effects',
  'sin efectos secundarios', 'clínicamente probado', 'clínicamente comprobado',
  'aprobado por la fda', 'garantía de devolución', 'garantizado',
  'laboratorio de harvard', 'sin hormonas', '% off', '% de descuento',
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// \b-bounded whole word/phrase match -- see header comment (#6) for why plain
// substring `.includes()` produced false positives (e.g. 'cure' inside
// 'secure'/'manicure') and this replaced it.
function wordMatch(haystackLower, phraseLower) {
  const re = new RegExp('\\b' + escapeRegExp(phraseLower) + '\\b');
  return re.test(haystackLower);
}

function frameKey(f) {
  return `${f.role}:${f.day_index === null || f.day_index === undefined ? 'null' : f.day_index}`;
}

// [axiom2] schema.json cannot bind an array's length to a sibling numeric field.
function frameCountMatchesArrayLength(bundle, errors) {
  const declared = bundle.media_plan.frame_count;
  const actual = bundle.media_plan.frames.length;
  if (declared !== actual) {
    errors.push(`[axiom2] media_plan.frame_count=${declared} but media_plan.frames actually has ${actual} item(s) (array length is not schema-bindable to a sibling field)`);
  }
}

const EXPECTED_ROLE_SEQUENCE = {
  single_frame: ['head'],
  head_tail: ['head', 'tail'],
  head_mid_tail: ['head', 'mid', 'tail'],
};

// [axiom2] schema.json validates each frame item independently; it cannot
// express "item N's role must precede item N+1's role" or "day_index values
// across the array must be strictly ascending and distinct".
function frameSequenceCheck(bundle, errors) {
  const structure = bundle.media_plan.structure;
  const frames = bundle.media_plan.frames;
  if (structure === 'multi_day') {
    const allDay = frames.every((f) => f.role === 'day');
    if (!allDay) errors.push('[axiom2] media_plan.structure=multi_day but not every frame has role:"day"');
    const dayIndexes = frames.map((f) => f.day_index);
    for (let i = 1; i < dayIndexes.length; i++) {
      if (!(dayIndexes[i] > dayIndexes[i - 1])) {
        errors.push(`[axiom2] media_plan.frames day_index is not strictly ascending at position ${i} (${dayIndexes[i - 1]} -> ${dayIndexes[i]})`);
      }
    }
    if (new Set(dayIndexes).size !== dayIndexes.length) {
      errors.push('[axiom2] media_plan.frames has duplicate day_index values (must be distinct)');
    }
  } else {
    const expected = EXPECTED_ROLE_SEQUENCE[structure] || [];
    const actual = frames.map((f) => f.role);
    const matches = expected.length === actual.length && expected.every((r, i) => r === actual[i]);
    if (!matches) {
      errors.push(`[axiom2] media_plan.structure=${structure} requires frame roles in order [${expected.join(',')}] but got [${actual.join(',')}]`);
    }
  }
}

// [axiom2] schema.json cannot single out "the array item with the minimum
// value of field X". For multi_day, day_index is the REAL source-narrative
// day number (a source that only ever cites day 3/7/14/30 must keep those
// literal numbers, never a re-indexed 1..N placeholder) -- so the frame that
// counts as the "first" reference-anchor frame is whichever day-role frame
// has the SMALLEST day_index, not the one whose day_index literally equals 1.
// schema.json used to hardcode day_index==1->false / day_index>=2->true via
// if/then/const, which rejected any valid multi_day bundle whose first cited
// day wasn't literally "1" (e.g. a real corpus item narrating day 3 -> 7 ->
// 14 -> 30, which never mentions day 1 at all). That hardcoding has been
// removed from schema.json; this is the only place the rule is enforced now.
function dayFrameFirstReferenceCheck(bundle, errors) {
  const dayFrames = bundle.media_plan.frames.filter((f) => f.role === 'day');
  if (dayFrames.length === 0) return;
  const minDayIndex = Math.min(...dayFrames.map((f) => f.day_index));
  dayFrames.forEach((f) => {
    const expected = f.day_index !== minDayIndex;
    if (f.uses_first_frame_as_reference !== expected) {
      errors.push(`[axiom2] media_plan.frames day_index=${f.day_index} (minimum day_index among role:"day" frames is ${minDayIndex}) has uses_first_frame_as_reference=${f.uses_first_frame_as_reference}, expected ${expected} (only the frame with the smallest day_index is the reference anchor, regardless of its literal value)`);
    }
  });
}

// [axiom1] the real, runnable enforcement of "constants never change across a
// fission branch": schema.json's pattern keyword can format-check the anchor
// strings themselves, but has no way to check that ANOTHER field (a whole
// different array's string) contains them as a substring.
function identityLockCheck(bundle, errors) {
  const anchors = [
    ['person_identity_anchor', bundle.constants.person_identity_anchor],
    ['scene_identity_anchor', bundle.constants.scene_identity_anchor],
    ['product_identity_anchor', bundle.constants.product_identity_anchor],
  ].map(([label, val]) => [label, (val || '').toLowerCase()]);

  bundle.prompt_sets.forEach((ps, i) => {
    const text = (ps.combined_prompt || '').toLowerCase();
    anchors.forEach(([label, a]) => {
      if (!text.includes(a)) {
        errors.push(`[axiom1] prompt_sets[${i}].combined_prompt does not contain constants.${label} verbatim (identity lock broken)`);
      }
    });
  });

  bundle.fission_variants.forEach((fv, i) => {
    const text = ((fv.prompt_json && fv.prompt_json.prompt) || '').toLowerCase();
    anchors.forEach(([label, a]) => {
      if (!text.includes(a)) {
        errors.push(`[axiom1] fission_variants[${i}].prompt_json.prompt does not contain constants.${label} verbatim (identity lock broken)`);
      }
    });
  });
}

// [axiom1] VTP step 04's "each must vary on 2+ axes" rule, operationalized as
// pairwise textual distinctness -- schema.json validates each prompt_set item
// in isolation and has no way to compare item i against item j.
function promptSetsDistinctCheck(bundle, errors) {
  const seen = new Map();
  bundle.prompt_sets.forEach((ps, i) => {
    const key = (ps.combined_prompt || '').trim().toLowerCase();
    if (seen.has(key)) {
      errors.push(`[axiom1] prompt_sets[${i}].combined_prompt is byte-identical to prompt_sets[${seen.get(key)}] (must be pairwise distinct)`);
    } else {
      seen.set(key, i);
    }
  });
}

// [axiom3] referential integrity: schema.json's enum/pattern can check FORMAT
// but never "does this id/tuple actually exist as a defined key elsewhere in
// the document" -- same limitation as 100x-persona's axiom 1.
function fissionReferentialIntegrityCheck(bundle, errors) {
  const promptSetIds = new Set(bundle.prompt_sets.map((ps) => ps.id));
  const frameKeys = new Set(bundle.media_plan.frames.map((f) => frameKey(f)));
  bundle.fission_variants.forEach((fv, i) => {
    if (!promptSetIds.has(fv.source_prompt_set_id)) {
      errors.push(`[axiom3] fission_variants[${i}].source_prompt_set_id=${fv.source_prompt_set_id} does not match any prompt_sets[].id`);
    }
    const key = frameKey({ role: fv.frame_role, day_index: fv.day_index });
    if (!frameKeys.has(key)) {
      errors.push(`[axiom3] fission_variants[${i}] (frame_role=${fv.frame_role}, day_index=${fv.day_index}) does not match any media_plan.frames[] entry`);
    }
  });
}

// [axiom3] zero-orphan frame coverage -- same class of check as 100x-persona's
// axiom 4 (every defined entity must be used by >=1 downstream reference).
function frameCoverageCheck(bundle, errors) {
  const referenced = new Set(bundle.fission_variants.map((fv) => frameKey({ role: fv.frame_role, day_index: fv.day_index })));
  bundle.media_plan.frames.forEach((f, i) => {
    const key = frameKey(f);
    if (!referenced.has(key)) {
      errors.push(`[axiom3] media_plan.frames[${i}] (role=${f.role}, day_index=${f.day_index}) is never referenced by any fission_variants[] entry (orphan frame -- planned but never rendered)`);
    }
  });
}

// [axiom4] cross-branch byte-equality: schema.json's `const` pins ONE field to
// a literal; it cannot pin a field nested inside an array item to equal a
// DIFFERENT top-level field's value elsewhere in the same document.
function negativePromptConsistencyCheck(bundle, errors) {
  bundle.fission_variants.forEach((fv, i) => {
    const np = fv.prompt_json && fv.prompt_json.negative_prompt;
    if (np !== bundle.negative_prompt) {
      errors.push(`[axiom4] fission_variants[${i}].prompt_json.negative_prompt does not byte-equal the top-level negative_prompt constant`);
    }
  });
}

// [axiom2] meta.based_on_media_structure is a human-facing echo field; nothing
// in schema.json ties its value back to media_plan.structure (two different
// top-level branches).
function metaConsistencyCheck(bundle, errors) {
  if (bundle.meta.based_on_media_structure !== bundle.media_plan.structure) {
    errors.push(`[axiom2] meta.based_on_media_structure="${bundle.meta.based_on_media_structure}" does not equal media_plan.structure="${bundle.media_plan.structure}"`);
  }
}

// [axiom4] case-insensitive scan against a curated phrase list -- see the
// header comment (#6) for why this is script-only rather than a schema pattern.
function unvisualizableClaimCheck(bundle, errors) {
  const surfaces = [];
  bundle.media_plan.frames.forEach((f) => surfaces.push(f.visual_action));
  bundle.prompt_sets.forEach((ps) => surfaces.push(ps.character_prompt, ps.scene_prompt, ps.action_prompt, ps.combined_prompt));
  bundle.fission_variants.forEach((fv) => surfaces.push(fv.prompt_json && fv.prompt_json.prompt));
  const fullText = surfaces.filter(Boolean).join(' \n ').toLowerCase();
  const hits = UNVISUALIZABLE_CLAIM_WORDS.filter((w) => wordMatch(fullText, w.toLowerCase()));
  if (hits.length > 0) {
    errors.push(`[axiom4] found ${hits.length} unvisualizable/exaggerated-claim phrase(s) copied literally into visual prompt text: ${hits.join('; ')} (abstract these into a genuinely photographable action/texture change instead, see workflow.md Phase 2 step 4)`);
  }
}

// Aggregate checks that schema.json (and therefore ajv) structurally cannot
// express. Only called after ajv has already confirmed the bundle is
// structurally valid, so it's safe to assume shape here.
function aggregateChecks(bundle) {
  const errors = [];
  frameCountMatchesArrayLength(bundle, errors);
  frameSequenceCheck(bundle, errors);
  dayFrameFirstReferenceCheck(bundle, errors);
  identityLockCheck(bundle, errors);
  promptSetsDistinctCheck(bundle, errors);
  fissionReferentialIntegrityCheck(bundle, errors);
  frameCoverageCheck(bundle, errors);
  negativePromptConsistencyCheck(bundle, errors);
  metaConsistencyCheck(bundle, errors);
  unvisualizableClaimCheck(bundle, errors);
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
const NEGATIVE_PROMPT_CONST = 'blurry, low quality, distorted, extra fingers, extra limbs, watermark, cartoon, illustration, anime, 3D render, oversaturated, plastic skin, oversmoothed, stock image feel, ring light, studio lighting, flash, artificial lighting, neon';

function makeAnchors() {
  return {
    person: 'young woman, shoulder-length brown hair, light-medium skin tone, grey hoodie (selftest fixture, not a real person)',
    scene: 'small apartment bathroom counter, single overhead bulb light (selftest fixture)',
    product: 'white capsule bottle with a plain blue label (selftest fixture, not a real product)',
  };
}

function makeCameraPrompt(anchors, variant) {
  const table = {
    A: 'natural-window lighting, warm color grading',
    B: 'ring-light lighting, neutral color grading',
    C: 'overcast-natural lighting, muted color grading',
  };
  return `${anchors.person}, ${anchors.scene}, ${anchors.product}, holding product naturally, ${table[variant]}, shot on iPhone, visible pores, natural skin texture, minor imperfections, photorealistic`;
}

// A minimal, schema-valid, all-axiom-passing head_tail bundle used as the base
// fixture for the mutation-based regression checks below. Not meant to be
// realistic content -- only meant to isolate ONE violation at a time.
function buildBaseBundle() {
  const anchors = makeAnchors();
  return {
    product_name: 'synthetic selftest fixture (not a real product)',
    category: '通用',
    constants: {
      person_identity_anchor: anchors.person,
      scene_identity_anchor: anchors.scene,
      product_identity_anchor: anchors.product,
    },
    variables: [
      { dimension: 'camera', name: 'framing', observed_values: ['medium shot', 'close-up'], range_description: 'medium establishing shot vs. tight product close-up' },
    ],
    media_plan: {
      structure: 'head_tail',
      frame_count: 2,
      frames: [
        { role: 'head', day_index: null, visual_action: 'tired posture, dull expression', uses_first_frame_as_reference: false },
        { role: 'tail', day_index: null, visual_action: 'relaxed posture, brighter expression (using frame 1 as reference, rest unchanged)', uses_first_frame_as_reference: true },
      ],
      structure_justification: 'source copy only contrasts a before/after feeling, no explicit day-by-day timeline (selftest fixture)',
    },
    prompt_sets: [
      { id: 1, variant_label: 'medium establishing', character_prompt: anchors.person, scene_prompt: anchors.scene, action_prompt: 'holding product naturally, medium shot', combined_prompt: `${anchors.person}, ${anchors.scene}, ${anchors.product}, holding product naturally, medium shot`, axis_tags: ['camera', 'pose'] },
      { id: 2, variant_label: 'product close-up', character_prompt: anchors.person, scene_prompt: anchors.scene, action_prompt: 'product resting on counter, close-up, flat-lay composition', combined_prompt: `${anchors.person}, ${anchors.scene}, ${anchors.product}, product resting on counter, close-up, flat-lay composition`, axis_tags: ['camera', 'composition'] },
    ],
    fission_variants: [
      { id: 1, source_prompt_set_id: 1, frame_role: 'head', day_index: null, camera_variant: 'A', aspect_ratio: '9:16', prompt_json: { prompt: makeCameraPrompt(anchors, 'A'), negative_prompt: NEGATIVE_PROMPT_CONST, resolution: '1080x1920' } },
      { id: 2, source_prompt_set_id: 2, frame_role: 'tail', day_index: null, camera_variant: 'B', aspect_ratio: '9:16', prompt_json: { prompt: makeCameraPrompt(anchors, 'B'), negative_prompt: NEGATIVE_PROMPT_CONST, resolution: '1080x1920' } },
    ],
    negative_prompt: NEGATIVE_PROMPT_CONST,
    meta: { based_on_media_structure: 'head_tail', generated_by: '100x-visual-fission', warnings: [] },
  };
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// A schema-valid, all-axiom-passing multi_day bundle whose day_index values
// reproduce a real corpus shape (day 3 -> 7 -> 14 -> 30) that NEVER cites day
// 1 -- the exact scenario that used to be structurally impossible to satisfy
// under the old day_index==1->false/day_index>=2->true if/then hardcode.
function buildMultiDayNonSequentialBundle() {
  const anchors = makeAnchors();
  const dayIndexes = [3, 7, 14, 30];
  const frames = dayIndexes.map((d, i) => ({
    role: 'day',
    day_index: d,
    visual_action: i === 0
      ? `day ${d} baseline check-in, neutral posture, morning routine clothing`
      : `using frame 1 as reference, day ${d} progressive improvement, rest of the room unchanged`,
    uses_first_frame_as_reference: i !== 0,
  }));
  const promptSets = [
    { id: 1, variant_label: 'medium shot, side-on', character_prompt: anchors.person, scene_prompt: anchors.scene, action_prompt: 'medium shot, side-on stance', combined_prompt: `${anchors.person}, ${anchors.scene}, ${anchors.product}, medium shot, side-on stance`, axis_tags: ['camera', 'pose'] },
    { id: 2, variant_label: 'close-up, front-on', character_prompt: anchors.person, scene_prompt: anchors.scene, action_prompt: 'close-up, front-on stance, product-hero composition', combined_prompt: `${anchors.person}, ${anchors.scene}, ${anchors.product}, close-up, front-on stance, product-hero composition`, axis_tags: ['camera', 'composition'] },
  ];
  const cameraCycle = ['A', 'B', 'C', 'A'];
  const fissionVariants = dayIndexes.map((d, i) => ({
    id: i + 1,
    source_prompt_set_id: (i % 2) + 1,
    frame_role: 'day',
    day_index: d,
    camera_variant: cameraCycle[i],
    aspect_ratio: '9:16',
    prompt_json: {
      prompt: `${makeCameraPrompt(anchors, cameraCycle[i])}, day ${d} progression`,
      negative_prompt: NEGATIVE_PROMPT_CONST,
      resolution: '1080x1920',
    },
  }));
  return {
    product_name: 'synthetic selftest fixture (not a real product)',
    category: '通用',
    constants: {
      person_identity_anchor: anchors.person,
      scene_identity_anchor: anchors.scene,
      product_identity_anchor: anchors.product,
    },
    variables: [
      { dimension: 'camera', name: 'framing', observed_values: ['medium shot', 'close-up'], range_description: 'medium establishing shot vs. tight product close-up (selftest fixture)' },
    ],
    media_plan: {
      structure: 'multi_day',
      frame_count: dayIndexes.length,
      frames,
      structure_justification: `source copy cites day ${dayIndexes.join('/')} as explicit milestones, day 1 is never mentioned (selftest fixture reproducing a real-corpus narrative shape)`,
    },
    prompt_sets: promptSets,
    fission_variants: fissionVariants,
    negative_prompt: NEGATIVE_PROMPT_CONST,
    meta: { based_on_media_structure: 'multi_day', generated_by: '100x-visual-fission', warnings: [] },
  };
}

function selftest() {
  const ajvValidateFn = loadAjvValidator();
  let allOk = true;
  let n = 0;
  const TOTAL = 16;

  function check(label, errors, expectFail) {
    n++;
    const failed = errors.length > 0;
    const ok = expectFail ? failed : !failed;
    if (ok) {
      console.log(`SELFTEST PASS (${n}/${TOTAL} ${label})`);
    } else {
      console.log(`SELFTEST FAIL (${n}/${TOTAL} ${label})`);
      errors.forEach((e) => console.log('  - ' + e));
      allOk = false;
    }
    return errors;
  }

  // 1: all real, shipped evals/ files must pass.
  const evalFiles = fs.readdirSync(EVALS_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(EVALS_DIR, f));
  if (evalFiles.length === 0) {
    console.log('SELFTEST FAIL: no files found in evals/');
    allOk = false;
  }
  evalFiles.forEach((f) => {
    const bundle = JSON.parse(fs.readFileSync(f, 'utf8'));
    const errors = validate(bundle, ajvValidateFn);
    // All real evals/ files share slot 1 in the numbering (mirrors
    // 100x-search-query's "(1/7 real evals): file" style) -- n is NOT
    // incremented per file, only once all real evals have been checked.
    if (errors.length === 0) {
      console.log(`SELFTEST PASS (1/${TOTAL} real eval: ${path.relative(process.cwd(), f)})`);
    } else {
      console.log(`SELFTEST FAIL (1/${TOTAL} real eval, expected PASS: ${path.relative(process.cwd(), f)})`);
      errors.forEach((e) => console.log('  - ' + e));
      allOk = false;
    }
  });
  n = 1;

  // 2: identity-lock violation -- drop the product anchor from one prompt_set.
  {
    const b = clone(buildBaseBundle());
    b.prompt_sets[1].combined_prompt = 'a woman standing near a counter, close-up, flat-lay composition';
    const errors = validate(b, ajvValidateFn);
    check('identity-lock violation correctly FAILS on axiom1', errors.filter((e) => e.includes('[axiom1]') && e.includes('identity lock')), true);
  }

  // 3: duplicate prompt_sets (byte-identical combined_prompt).
  {
    const b = clone(buildBaseBundle());
    b.prompt_sets[1].combined_prompt = b.prompt_sets[0].combined_prompt;
    const errors = validate(b, ajvValidateFn);
    check('duplicate prompt_sets correctly FAILS on axiom1 distinctness', errors.filter((e) => e.includes('[axiom1]') && e.includes('byte-identical')), true);
  }

  // 4: frame_count mismatched with actual frames[] length (schema-valid on its
  // own -- structure=head_tail + frame_count=2 both pass ajv's if/then).
  {
    const b = clone(buildBaseBundle());
    b.media_plan.frames.push({ role: 'tail', day_index: null, visual_action: 'extra stray frame', uses_first_frame_as_reference: true });
    // frame_count is left at 2 while frames[] now has 3 items.
    const errors = validate(b, ajvValidateFn);
    check('frame_count/array-length mismatch correctly FAILS on axiom2', errors.filter((e) => e.includes('[axiom2]') && e.includes('frame_count')), true);
  }

  // 5: frame role sequence out of order.
  {
    const b = clone(buildBaseBundle());
    const tmp = b.media_plan.frames[0];
    b.media_plan.frames[0] = b.media_plan.frames[1];
    b.media_plan.frames[1] = tmp;
    // fission_variants still point at role:head/role:tail which now exist at
    // swapped positions -- referential integrity is keyed on role, not array
    // index, so this isolates ONLY the sequence violation.
    const errors = validate(b, ajvValidateFn);
    check('frame role sequence out of order correctly FAILS on axiom2', errors.filter((e) => e.includes('[axiom2]') && e.includes('requires frame roles in order')), true);
  }

  // 6: fission_variants[].source_prompt_set_id points at a nonexistent id.
  {
    const b = clone(buildBaseBundle());
    b.fission_variants[0].source_prompt_set_id = 999;
    const errors = validate(b, ajvValidateFn);
    check('unknown source_prompt_set_id correctly FAILS on axiom3 referential integrity', errors.filter((e) => e.includes('[axiom3]') && e.includes('source_prompt_set_id')), true);
  }

  // 7: orphan frame -- a planned frame that no fission_variant ever renders.
  {
    const b = clone(buildBaseBundle());
    b.media_plan.structure = 'head_mid_tail';
    b.media_plan.frame_count = 3;
    b.media_plan.frames.splice(1, 0, { role: 'mid', day_index: null, visual_action: 'mid transition action, applying product', uses_first_frame_as_reference: true });
    b.media_plan.structure_justification = 'source copy has a single continuous apply-then-reveal action (selftest fixture)';
    // fission_variants still only cover head + tail -- mid is now an orphan.
    const errors = validate(b, ajvValidateFn);
    check('orphan frame (never rendered) correctly FAILS on axiom3 coverage', errors.filter((e) => e.includes('[axiom3]') && e.includes('orphan frame')), true);
  }

  // 8: negative_prompt altered on one fission_variant only.
  {
    const b = clone(buildBaseBundle());
    b.fission_variants[0].prompt_json.negative_prompt = 'blurry, low quality';
    const errors = validate(b, ajvValidateFn);
    check('altered negative_prompt correctly FAILS on axiom4 consistency', errors.filter((e) => e.includes('[axiom4]') && e.includes('negative_prompt')), true);
  }

  // 9: an unvisualizable/exaggerated claim copied verbatim into a frame's
  // visual_action (the exact failure mode the real corpus test run surfaced).
  {
    const b = clone(buildBaseBundle());
    b.media_plan.frames[1].visual_action = 'clinically proven anti-aging results visible, using frame 1 as reference';
    const errors = validate(b, ajvValidateFn);
    check('unvisualizable claim phrase correctly FAILS on axiom4 claim scan', errors.filter((e) => e.includes('[axiom4]') && e.includes('unvisualizable')), true);
  }

  // 10 (ajv additionalProperties): stray field injected into a fission_variant.
  {
    const b = clone(buildBaseBundle());
    b.fission_variants[0].extra_field_not_in_schema = 'should be rejected by additionalProperties:false';
    const errors = validate(b, ajvValidateFn);
    check('fission_variant with an undeclared extra field correctly FAILS via ajv additionalProperties', errors.filter((e) => e.includes('additionalProperties') || e.includes('additional properties')), true);
  }

  // 11 (ajv enum): camera_variant set outside the fixed A/B/C 3-preset table.
  {
    const b = clone(buildBaseBundle());
    b.fission_variants[0].camera_variant = 'D';
    const errors = validate(b, ajvValidateFn);
    check('camera_variant outside the A/B/C enum correctly FAILS via ajv enum', errors.filter((e) => e.includes('allowed values')), true);
  }

  // 12: multi_day day_index sequence that NEVER cites day 1 (day 3/7/14/30,
  // reproducing a real corpus shape) must fully PASS -- proves the old
  // day_index==1->false/day_index>=2->true if/then hardcode (which used to
  // reject exactly this bundle) has been removed from schema.json.
  {
    const b = buildMultiDayNonSequentialBundle();
    const errors = validate(b, ajvValidateFn);
    check('multi_day day_index never citing day 1 (3/7/14/30) correctly PASSES on axiom2', errors, false);
  }

  // 13: same non-sequential multi_day bundle, but the frame with the smallest
  // day_index (day 3) is wrongly marked uses_first_frame_as_reference:true --
  // must FAIL via the new cross-item dayFrameFirstReferenceCheck (schema.json
  // no longer has any if/then that could catch this on its own).
  {
    const b = buildMultiDayNonSequentialBundle();
    b.media_plan.frames[0].uses_first_frame_as_reference = true;
    const errors = validate(b, ajvValidateFn);
    check('wrong reference-anchor flag on the minimum-day_index frame correctly FAILS on axiom2 dayFrameFirstReferenceCheck', errors.filter((e) => e.includes('[axiom2]') && e.includes('uses_first_frame_as_reference')), true);
  }

  // 14: a benign word that merely CONTAINS 'cure' as a substring ('manicure')
  // must NOT trip the unvisualizable-claim scan -- proves the word-boundary
  // fix (wordMatch) replaced the old bare `.includes()` substring check that
  // false-positived on 'secure'/'manicure'/etc.
  {
    const b = clone(buildBaseBundle());
    b.media_plan.frames[1].visual_action = 'gentle manicure-style finishing touch on the fingertips, using frame 1 as reference, calmer expression';
    const errors = validate(b, ajvValidateFn);
    check("benign word containing 'cure' as a bare substring ('manicure') correctly does NOT FAIL axiom4", errors, false);
  }

  // 15 (ajv pattern, identity_anchor): an ALL-CAPS vague placeholder ('GENERIC')
  // must be REJECTED -- proves the identity_anchor pattern's earlier
  // lower/Title-Case-only word list (which let ALL-CAPS placeholders through)
  // has been fixed by adding the missing ALL-CAPS form.
  {
    const b = clone(buildBaseBundle());
    b.constants.person_identity_anchor = 'GENERIC woman standing near a window';
    const errors = validate(b, ajvValidateFn);
    check("ALL-CAPS vague placeholder ('GENERIC') in an identity anchor correctly FAILS via ajv pattern", errors.filter((e) => e.includes('pattern')), true);
  }

  // 16 (ajv pattern, camera_variant keyword lock): a camera_variant:"A" prompt
  // that only contains 'natural-windowsill'/'warmth' (longer words that
  // merely CONTAIN the required 'natural-window'/'warm' keywords as bare
  // substrings, without either keyword appearing as its own word) must be
  // REJECTED -- proves the \b-bounded keyword patterns replaced the old bare
  // substring lookaheads.
  {
    const b = clone(buildBaseBundle());
    const anchors = makeAnchors();
    b.fission_variants[0].camera_variant = 'A';
    b.fission_variants[0].prompt_json.prompt = `${anchors.person}, ${anchors.scene}, ${anchors.product}, natural-windowsill vantage point, warmth radiating from her smile, shot on iPhone, visible pores, natural skin texture, minor imperfections, photorealistic`;
    const errors = validate(b, ajvValidateFn);
    check("camera_variant A prompt using 'natural-windowsill'/'warmth' (substring trick, not the whole keyword) correctly FAILS via ajv pattern", errors.filter((e) => e.includes('pattern')), true);
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
  console.log(ok ? '\nSELFTEST: ALL 16 CHECKS BEHAVED AS EXPECTED' : '\nSELFTEST: AT LEAST ONE CHECK FAILED');
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
