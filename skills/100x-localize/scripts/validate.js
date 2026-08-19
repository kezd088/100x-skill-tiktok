#!/usr/bin/env node
/**
 * 100x-localize real validator.
 *
 * WHY THIS FILE EXISTS:
 * schema.json (vanilla JSON Schema draft-07, executed by ajv) can validate a
 * LOT for this skill -- required/type/additionalProperties/enum, the axiom-3
 * universal tú-only ban on `localized_script`, and (via if/then) axiom 2's
 * compliance-conservative banned-phrase ban. Those are all single-field
 * pattern/enum checks with at most one sibling-field conditional, which is
 * exactly what JSON Schema draft-07's if/then/pattern keywords are built for.
 *
 * What schema.json structurally CANNOT express:
 *   - Axiom 1 (compression): "len(localized_script) must be <=1.10x and
 *     >=0.5x len(source_script)". JSON Schema has no way to compute the
 *     length of one string field and compare it arithmetically against
 *     another field's length -- there is no keyword for cross-field
 *     arithmetic, only per-field minLength/maxLength against a fixed number.
 *   - Axiom 4 (no fabricated authority claims): "if localized_script
 *     contains an FDA/Harvard/OMS/clinical-proof token that source_script
 *     does not contain anywhere, flag it". This is a cross-field CONTENT
 *     comparison (does field A contain something absent from field B),
 *     which JSON Schema also cannot express -- pattern only tests one field
 *     against a fixed regex, never against another field's live value.
 * Both are cross-field comparisons no vanilla JSON Schema draft (ajv
 * included) can do. They are hand-written below, run only AFTER ajv confirms
 * the bundle is structurally valid.
 *
 * SECOND LINE OF DEFENSE (not duplicated logic): axiom 2 and axiom 3 ARE
 * fully enforced by ajv via schema.json. This script additionally re-checks
 * both by READING the exact pattern strings back out of the loaded
 * schema.json object at runtime (see `readPatternsFromSchema`) rather than
 * re-typing the regex literals a second time -- so schema.json stays the
 * single source of truth and the two files cannot silently drift apart.
 * This mirrors 100x-search-query's axiom-1 ASCII-pattern precedent ("schema
 * catches it, script re-confirms it, reading the same source").
 *
 * VALIDATION ORDER: ajv runs first. If ajv fails, this script reports the
 * ajv errors and does NOT run the hand-written checks (no point computing a
 * compression ratio on a document ajv already rejected). Only once ajv
 * passes does the hand-written layer run.
 *
 * USAGE:
 *   node scripts/validate.js <file1.json> [file2.json ...]
 *     Validates each given LocalizationBundle JSON file. Exits 0 if all
 *     pass, 1 if any fails (prints the specific failing rule(s) per file).
 *
 *   node scripts/validate.js --selftest
 *     Runs 26 fixed adversarial/regression checks plus one PASS check per
 *     shipped evals/ file (29 total as of this writing) and prints PASS/FAIL
 *     for each -- includes 6 case/whitespace/punctuation-obfuscation bypass
 *     checks (axiom 3 all-caps USTED/VOSOTROS, axiom 2 all-caps + doubled-
 *     whitespace banned phrase, axiom 4 dotted/spaced-out "FDA"), PLUS
 *     4 bypass checks (axiom 2 accent-stripped banned phrase, axiom 4
 *     accent-stripped clinical-proof wording, axiom 4 lowercase dot-glued
 *     "f.d.a.", axiom 3 zero-width-space-obfuscated "usted"), PLUS one
 *     regression check (axiom 2's comma variant), PLUS 4 bypass checks
 *     (axiom 4 ZWSP-obfuscated authority token, axiom 3 soft-hyphen-obfuscated
 *     "usted", axiom 3 combining-acute-obfuscated "usted", axiom 2 NFD-decomposed
 *     banned phrase) -- see the banner comment on selftest() below for what each one proves.
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

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function loadAjvValidator(schema) {
  // strict:false -- schema.json intentionally uses additionalProperties:false
  // everywhere but relies on `if`/`then`/`allOf` composition for the
  // register_profile-conditional ban, which is legitimate JSON Schema, not a
  // mistake; ajv's strict mode flags some stylistic patterns it doesn't need
  // to for correctness (same rationale as 100x-search-query/100x-persona).
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

// ---- Read the two axiom-2/axiom-3 pattern strings back out of schema.json
// instead of re-typing them here. Both patterns are already ENFORCED by ajv
// (see loadAjvValidator above) -- this is a deliberate second line of
// defense, not a duplicated implementation: if either pattern in schema.json
// changes, this script picks up the new value automatically because it reads
// the same object ajv compiled, at the same JSON paths, every run.
function readPatternsFromSchema(schema) {
  const personRegisterPattern = schema.properties.localized_script.pattern;
  const conservativeBanPattern = schema.allOf[0].then.properties.localized_script.pattern;
  const registerProfileEnum = schema.properties.register_profile.enum;
  const targetRegionEnum = schema.properties.target_region.enum;
  return { personRegisterPattern, conservativeBanPattern, registerProfileEnum, targetRegionEnum };
}

// ---- Axiom 1: compression ratio (hand-written -- see file header for why
// schema.json cannot express this: it is arithmetic comparison between the
// character lengths of two independent string fields).
// Ceiling/floor rationale (original engineering judgment, not a number taken
// directly from any source document -- see axioms.md 公理1 出处 for full
// disclosure): statistical analysis over reference transcript corpora found
// that the ES transcript set averages more characters than the EN set (roughly ~19% longer).
// That is evidence a literal, uncompressed translation will systematically run longer in Spanish,
// not a live per-bundle measurement. The 1.10 ceiling deliberately sits BELOW that
// ~19% natural gap so localization is forced to actively compress content
// rather than passively translate it; the 0.5 floor exists only to catch a
// degenerate near-empty rewrite gaming the ceiling check.
const COMPRESSION_CEILING = 1.10;
const COMPRESSION_FLOOR = 0.5;

function compressionCheck(bundle, errors) {
  const srcLen = Array.from(bundle.source_script || '').length;
  const outLen = Array.from(bundle.localized_script || '').length;
  if (srcLen === 0) return; // ajv already requires minLength:1; defensive only
  const ratio = outLen / srcLen;
  if (ratio > COMPRESSION_CEILING) {
    errors.push(`[axiom1] compression ceiling exceeded: localized/source ratio=${ratio.toFixed(3)} (source ${srcLen} chars -> localized ${outLen} chars), must be <=${COMPRESSION_CEILING} -- rewrite must compress, not literally translate`);
  }
  if (ratio < COMPRESSION_FLOOR) {
    errors.push(`[axiom1] output too short relative to source: ratio=${ratio.toFixed(3)} (source ${srcLen} chars -> localized ${outLen} chars), must be >=${COMPRESSION_FLOOR} -- looks like content was gutted, not compressed`);
  }
}

// ---- Normalization (axiom 3): a zero-width /
// invisible Unicode "format" character (U+200B ZERO WIDTH SPACE, U+200C ZERO
// WIDTH NON-JOINER, U+200D ZERO WIDTH JOINER, U+FEFF BOM, U+2060 WORD JOINER)
// inserted in the middle of a banned word (e.g. "Us<ZWSP>ted") is invisible
// and reads/sounds identical to a human or TTS engine, but breaks a
// character-literal regex like schema.json's `pattern` -- vanilla JSON
// Schema draft-07 genuinely has no keyword to strip/normalize a string
// BEFORE matching it against `pattern`, so this cannot be pushed into
// schema.json/ajv no matter how the regex itself is written. That is why
// this normalization has to live here, in the hand-written layer.
// Built from explicit code points (not a literal \u-escaped regex) so the
// zero-width characters themselves never have to appear, visibly or as an
// escape sequence, inside this source file -- easier to review and to grep.
const INVISIBLE_CODEPOINTS = [0x200b, 0x200c, 0x200d, 0xfeff, 0x2060, 0x00ad]; // ZWSP, ZWNJ, ZWJ, BOM, WORD JOINER, SOFT HYPHEN
const INVISIBLE_CHARS_RE = new RegExp('[' + INVISIBLE_CODEPOINTS.map((c) => String.fromCharCode(c)).join('') + ']', 'g');

function stripInvisibleChars(text) {
  return (text || '').replace(INVISIBLE_CHARS_RE, '');
}

// ---- Axiom 2/3 secondary check. Reads patterns FROM schema.json (see
// readPatternsFromSchema above, no re-typed regex here). This is no longer
// PURELY redundant defense-in-depth: for the zero-width-obfuscation bypass
// class above, ajv's own pass over the raw string can legitimately PASS a
// string containing an invisible-character-split banned word (the literal
// letter run never appears contiguously), so this stripInvisibleChars()
// re-test is the layer that actually catches that specific bypass -- for
// every other (non-obfuscated) case, ajv already caught it and this is a
// harmless repeat.
function secondaryPatternCheck(bundle, patterns, errors) {
  // stripInvisibleChars alone is not enough -- a combining accent mark
  // (e.g. U+0301) or a precomposed character in NFD decomposed form (base
  // letter + separate combining accent codepoint) can also sit between the
  // letters of a banned word and break a character-literal regex the same way
  // a ZWSP does, but combining marks are NOT invisible-format characters (they
  // visibly modify the preceding glyph). stripDiacritics uses NFD decomposition
  // + combining-mark range removal to normalize both cases -- see the banner
  // comment on stripDiacritics for why this pre-processing can only live in
  // the hand-written layer, not in schema.json/ajv.
  const normalized = stripDiacritics(stripInvisibleChars(bundle.localized_script || ''));
  const personRe = new RegExp(patterns.personRegisterPattern);
  if (!personRe.test(normalized)) {
    errors.push('[axiom3][schema-secondary] localized_script matches the usted/vosotros ban pattern (read from schema.json) once zero-width/invisible Unicode characters AND combining diacritic marks are stripped -- ajv alone cannot do either normalization (no preprocessing keyword in JSON Schema draft-07), so this hand-written re-check is the actual line of defense for invisible-character-obfuscated AND diacritic-obfuscated matches, not merely a redundant repeat');
  }
  if (bundle.register_profile === 'compliance-conservative') {
    const conservativeRe = new RegExp(patterns.conservativeBanPattern);
    if (!conservativeRe.test(normalized)) {
      errors.push('[axiom2][schema-secondary] localized_script matches the compliance-conservative banned-phrase pattern (read from schema.json) once zero-width/invisible Unicode characters AND combining diacritic marks are stripped -- see the axiom-3 rationale above for why this normalization can only live here, not in schema.json');
    }
  }
}

// ---- Axiom 4: no newly-introduced authority/certification claim (hand-
// written -- see file header for why schema.json cannot express this: it is
// a content comparison between two independent string fields, not a fixed-
// pattern check against one field).
// This closed token list is an original selection scoped to 07_西语口播风格
// 规范.md §5's own examples (FDA, Harvard) plus two adjacent institution/
// proof-claim families (OMS/WHO, generic "clinically proven"-style wording)
// -- it is NOT exhaustive of every possible fabricated authority claim (a
// made-up doctor's name or a made-up institute name would not be caught).
// See axioms.md 公理4 TODO for this known limitation.
// Variant strings are written WITHOUT accents on purpose -- the src/out
// strings they are compared against are run through stripDiacritics() first
// (see fabricatedAuthorityCheck below), so an accented variant here would
// never match the already-unaccented candidate string. Writing the accent
// back into these variants would be a no-op at best and a silent drift risk
// at worst if the normalization step were ever changed without updating
// these strings to match.
const AUTHORITY_TOKENS = [
  { label: 'FDA', variants: ['fda'] },
  { label: 'Harvard', variants: ['harvard'] },
  { label: 'OMS/WHO', variants: ['oms', 'who', 'world health organization', 'organizacion mundial de la salud'] },
  { label: 'clinical-proof wording', variants: ['clinicamente probado', 'clinically proven', 'estudio clinico', 'clinical trial', 'clinical study'] },
];

// ---- Normalization (axiom 4): the variants above
// (and the source_script/localized_script text they're checked against) can
// legitimately be typed with or without a written accent mark in real
// Spanish TikTok captions (no-accent keyboards, fast typing, ASCII-only
// input methods are common) -- "clínicamente" and "clinicamente" are the
// same word to a reader. A plain substring `.includes()` check does not
// know that, so this is a cross-field CONTENT comparison concern (same
// category as the rest of this function), not something schema.json's
// single-field `pattern` keyword could express either way. Uses Unicode NFD
// decomposition (splits a precomposed accented letter like 'í' into the
// base letter 'i' plus a separate combining-accent codepoint) and then
// strips the whole Unicode combining-mark block (U+0300-U+036F) -- this
// also happens to normalize a decomposed accent typed via an alternate
// input method, not only the common precomposed form, as a side effect of
// how NFD decomposition works, not because it was specifically targeted.
// Combining-mark range built from explicit code points (0x0300-0x036f), same
// reviewability rationale as INVISIBLE_CHARS_RE above -- no combining marks
// appear literally in this source file, only their hex code points.
const COMBINING_MARKS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

function stripDiacritics(text) {
  return (text || '').normalize('NFD').replace(COMBINING_MARKS_RE, '');
}

// ---- Normalization: a short acronym like "FDA"
// can be spelled out with a dot or a space between each individual letter
// ("F.D.A." / "F D A") to defeat a plain `.includes('fda')` substring check
// while still reading as the same acronym to a human. This is still part of
// the cross-field CONTENT comparison hand-written check above (not a fixed-
// pattern check schema.json's `pattern` keyword could express against a
// single field), so the fix belongs here, not in schema.json.
//
// Two separate sub-patterns, deliberately NOT merged into one case-
// insensitive whitespace-or-dot regex:
//  (A) UPPERCASE letters separated by '.'/whitespace ("F.D.A." / "F D A").
//      ALL-CAPS is itself a strong signal this isn't ordinary prose (normal
//      Spanish sentences are not written in all caps), so a bare whitespace
//      separator is safe here without risking a false match on ordinary
//      single-letter Spanish words.
//  (B) lower/mixed-case letters, but ONLY when glued together with a literal
//      '.' directly after EACH letter and no whitespace in between ("f.d.a."
//      / "F.d.A."). Requiring the dot-glued form (no bare whitespace) for
//      non-uppercase letters is the deliberate safety valve: ordinary
//      Spanish single-letter words ("y", "o", "a", "e", "u") are common and
//      can appear back-to-back ("y a", "o a"), so allowing a plain
//      whitespace separator for lowercase letters would risk collapsing
//      ordinary short words into a false "acronym". A period fused directly
//      onto a single lowercase letter with no gap before the next letter is
//      not how normal Spanish sentences are punctuated, so this stays a
//      low-false-positive way to catch lowercase dotted spellings like "f.d.a.".
function collapseSpacedAcronyms(text) {
  const str = text || '';
  const collapsedCaps = str.replace(/\b(?:[A-Z][.\s]+){1,5}[A-Z]\b/g, (m) => m.replace(/[.\s]+/g, ''));
  const collapsedDottedAnyCase = collapsedCaps.replace(/\b(?:[A-Za-z]\.){2,6}/g, (m) => m.replace(/\./g, ''));
  return collapsedDottedAnyCase;
}

function fabricatedAuthorityCheck(bundle, errors) {
  // stripInvisibleChars is applied here -- a ZWSP inserted inside an authority
  // token (e.g. "O​MS" / "F​D​A") breaks the continuous letter run and
  // evades .includes() the same way it evades a character-literal regex.
  // Normalization order: strip invisible chars first (so a ZWSP between two
  // dotted acronym letters doesn't prevent collapseSpacedAcronyms from
  // folding them), then collapse spaced acronyms, then strip diacritics,
  // then lowercase for the final .includes() comparison.
  const src = stripDiacritics(collapseSpacedAcronyms(stripInvisibleChars(bundle.source_script || ''))).toLowerCase();
  const out = stripDiacritics(collapseSpacedAcronyms(stripInvisibleChars(bundle.localized_script || ''))).toLowerCase();
  AUTHORITY_TOKENS.forEach(({ label, variants }) => {
    const inOutput = variants.some((v) => out.includes(v));
    const inSource = variants.some((v) => src.includes(v));
    if (inOutput && !inSource) {
      errors.push(`[axiom4] localized_script introduces a "${label}"-type authority/certification claim that is not present anywhere in source_script -- looks fabricated during localization, not carried over from the source copy`);
    }
  });
}

// Aggregate checks that schema.json (and therefore ajv) structurally cannot
// express. Only called after ajv has already confirmed the bundle is
// structurally valid, so it's safe to assume shape here.
function aggregateChecks(bundle, schema) {
  const errors = [];
  compressionCheck(bundle, errors);
  secondaryPatternCheck(bundle, readPatternsFromSchema(schema), errors);
  fabricatedAuthorityCheck(bundle, errors);
  return errors;
}

// Full pipeline: ajv structural pass first, aggregate checks only if it passes.
function validate(bundle, ajvValidateFn, schema) {
  const structurallyValid = ajvValidateFn(bundle);
  if (!structurallyValid) {
    return formatAjvErrors(ajvValidateFn.errors);
  }
  return aggregateChecks(bundle, schema);
}

function runOne(file, ajvValidateFn, schema) {
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validate(bundle, ajvValidateFn, schema);
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
    source_script: 'This drink gives you steady focus for hours without the coffee crash. Thousands of people already made the switch this month.',
    target_region: 'mx',
    register_profile: 'default',
    localized_script: 'Esta bebida te da enfoque estable por horas sin el bajón del café. Miles de personas ya hicieron el cambio este mes.',
    meta: { generated_by: '100x-localize', warnings: [] },
  };
}

function selftest() {
  const schema = loadSchema();
  const ajvValidateFn = loadAjvValidator(schema);
  let allOk = true;
  let n = 0;

  // 26 fixed adversarial/regression checks (below) + however many real
  // evals/ files ship with this skill (currently 3) = TOTAL. Computed, not
  // hand-counted, so this number can't drift out of sync with evals/ the way
  // a hardcoded "12" would the moment a 4th eval file is added or removed.
  const evalFileCountForTotal = fs.readdirSync(EVALS_DIR).filter((f) => f.endsWith('.json')).length;
  const TOTAL = evalFileCountForTotal + 26;

  function report(label, ok, errorsIfAny) {
    n += 1;
    if (ok) {
      console.log(`SELFTEST PASS (${n}/${TOTAL} ${label})`);
    } else {
      console.log(`SELFTEST FAIL (${n}/${TOTAL} ${label})`);
      if (errorsIfAny) errorsIfAny.forEach((e) => console.log('  - ' + e));
      allOk = false;
    }
  }

  // 1: both real, shipped evals/ files must pass.
  const evalFiles = fs.readdirSync(EVALS_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(EVALS_DIR, f));
  if (evalFiles.length === 0) {
    n += 1;
    console.log(`SELFTEST FAIL (${n}/${TOTAL} real evals): no files found in evals/`);
    allOk = false;
  } else {
    evalFiles.forEach((f) => {
      const bundle = JSON.parse(fs.readFileSync(f, 'utf8'));
      const errors = validate(bundle, ajvValidateFn, schema);
      report(`real eval: ${path.relative(process.cwd(), f)}`, errors.length === 0, errors);
    });
  }

  // 2: ratio > 1.10 must FAIL axiom1 (ceiling).
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = bundle.localized_script + ' '.repeat(0) +
      'Y todavía hay más que decir sobre esto porque de verdad hace una gran diferencia todos los días sin excepción alguna, créeme.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom1]') && e.includes('ceiling'));
    report('ratio-over-ceiling correctly FAILS axiom1', hit, errors);
  }

  // 3: ratio < 0.5 must FAIL axiom1 (floor).
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Enfoque sin bajón.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom1]') && e.includes('too short'));
    report('ratio-under-floor correctly FAILS axiom1', hit, errors);
  }

  // 4: compliance-conservative + banned phrase present must FAIL (ajv, then-branch).
  // Uses "todo el mundo ya lo está usando ahorita" (a mass-adoption-without-
  // evidence claim), deliberately NOT an AUTHORITY_TOKENS phrase, so this
  // isolates axiom 2 from axiom 4 -- the FDA/Harvard phrases are reused
  // separately in checks 9/10 below where the axiom-4 interaction is the
  // point being demonstrated on purpose.
  {
    const bundle = baseGoodBundle();
    bundle.register_profile = 'compliance-conservative';
    bundle.localized_script = 'Todo el mundo ya lo está usando ahorita y a ti también te puede funcionar para el enfoque diario.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('schema:ajv') && e.includes('pattern'));
    report('compliance-conservative + banned phrase correctly FAILS via ajv', hit, errors);
  }

  // 5: same banned phrase, but register_profile default -> must PASS (proves
  // the ban is conditional, not a blanket ban on the phrase itself).
  {
    const bundle = baseGoodBundle();
    bundle.register_profile = 'default';
    bundle.localized_script = 'Todo el mundo ya lo está usando ahorita y a ti también te puede funcionar para el enfoque diario.';
    const errors = validate(bundle, ajvValidateFn, schema);
    report('same phrase under default profile correctly PASSES (conditional, not blanket)', errors.length === 0, errors);
  }

  // 6: compliance-conservative with the claim paraphrased away (no banned
  // phrase) must PASS -- proves the conservative profile has a legal path.
  {
    const bundle = baseGoodBundle();
    bundle.register_profile = 'compliance-conservative';
    bundle.localized_script = 'Este producto tiene una fórmula concentrada que te ayuda a mantener el enfoque durante el día.';
    const errors = validate(bundle, ajvValidateFn, schema);
    report('compliance-conservative with paraphrased claim correctly PASSES', errors.length === 0, errors);
  }

  // 7: localized_script containing "usted" must FAIL (ajv universal pattern).
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Usted puede sentir la diferencia desde el primer día que lo prueba.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('schema:ajv') && e.includes('pattern'));
    report('"usted" in localized_script correctly FAILS via ajv', hit, errors);
  }

  // 8: localized_script containing "vosotros" must FAIL (ajv universal pattern).
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Vosotros lo vais a notar desde la primera semana de uso.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('schema:ajv') && e.includes('pattern'));
    report('"vosotros" in localized_script correctly FAILS via ajv', hit, errors);
  }

  // 9: authority token present in output but absent from source -> FAIL axiom4.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Esta bebida está aprobada por la FDA y te da enfoque estable por horas.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('FDA'));
    report('fabricated FDA claim (absent from source) correctly FAILS axiom4', hit, errors);
  }

  // 10: authority token present in BOTH source and output -> PASS axiom4
  // (proves the check is about "newly introduced", not "presence").
  {
    const bundle = baseGoodBundle();
    bundle.source_script = bundle.source_script + ' Backed by an FDA filing our team submitted last year.';
    bundle.localized_script = bundle.localized_script + ' Respaldado por un registro ante la FDA que presentó nuestro equipo el año pasado.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom4]'));
    report('FDA mention present in BOTH source and output correctly PASSES axiom4 (not a blanket ban)', !hit, errors);
  }

  // 11: additionalProperties -- extra undeclared top-level field must FAIL via ajv.
  {
    const bundle = baseGoodBundle();
    bundle.extra_field_not_in_schema = 'should be rejected by additionalProperties:false';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('additionalProperties') || e.includes('additional properties'));
    report('undeclared extra top-level field correctly FAILS via ajv additionalProperties', hit, errors);
  }

  // 12: invalid register_profile enum value must FAIL via ajv.
  {
    const bundle = baseGoodBundle();
    bundle.register_profile = 'aggressive';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('allowed values'));
    report('invalid register_profile value correctly FAILS via ajv enum', hit, errors);
  }

  // ---- Checks 13-18 below are regression checks for case/whitespace/punctuation-obfuscation robustness.

  // 13: axiom 3, ALL-CAPS "USTED" (not just leading-capital "Usted") must
  // still FAIL via ajv. Before the fix, schema.json's pattern only had
  // [Uu]sted (first letter case-flexible, rest hardcoded lowercase), so an
  // all-caps ad-copy line like this one slipped through as a false PASS.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'ESTA BEBIDA TE DA ENFOQUE ESTABLE POR HORAS SIN EL BAJON DEL CAFE. USTED YA HIZO EL CAMBIO ESTE MES.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('schema:ajv') && e.includes('pattern'));
    report('ALL-CAPS "USTED" correctly FAILS via ajv (not just leading-capital "Usted")', hit, errors);
  }

  // 14: axiom 3, ALL-CAPS "VOSOTROS" must still FAIL via ajv (same bug class
  // as #13, other banned token).
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'ESTA BEBIDA TE DA ENFOQUE ESTABLE POR HORAS SIN EL BAJON DEL CAFE. VOSOTROS YA HICISTEIS EL CAMBIO ESTE MES.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('schema:ajv') && e.includes('pattern'));
    report('ALL-CAPS "VOSOTROS" correctly FAILS via ajv', hit, errors);
  }

  // 15: axiom 2, ALL-CAPS banned phrase under compliance-conservative must
  // still FAIL via ajv. Before the fix, the then-branch pattern only
  // case-flexed the first letter of each phrase (e.g. [Mm]illones), so an
  // all-caps line slipped through as a false PASS.
  {
    const bundle = baseGoodBundle();
    bundle.register_profile = 'compliance-conservative';
    bundle.localized_script = 'TODO EL MUNDO YA LO ESTÁ USANDO AHORITA PARA EL ENFOQUE DIARIO.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('schema:ajv') && e.includes('pattern'));
    report('compliance-conservative + ALL-CAPS banned phrase correctly FAILS via ajv', hit, errors);
  }

  // 16: axiom 2, banned phrase with a doubled space inserted between two
  // words under compliance-conservative must still FAIL via ajv. Before the
  // fix, the then-branch pattern matched literal single spaces only, so a
  // pure whitespace-variant of the banned phrase (e.g. TikTok caption text
  // with an accidental double space) slipped through as a false PASS.
  {
    const bundle = baseGoodBundle();
    bundle.register_profile = 'compliance-conservative';
    bundle.localized_script = 'Todo el mundo ya lo  está usando ahorita para el enfoque diario.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('schema:ajv') && e.includes('pattern'));
    report('compliance-conservative + doubled-whitespace banned phrase correctly FAILS via ajv', hit, errors);
  }

  // 17: axiom 4, "FDA" spelled with a dot after each letter ("F.D.A.") must
  // still FAIL. Before the fix, fabricatedAuthorityCheck did a plain
  // out.includes('fda') substring test, so a dotted-abbreviation spelling
  // was never normalized down to "fda" and slipped through as a false PASS.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Esta bebida está aprobada por la F.D.A. y te da enfoque estable por horas.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('FDA'));
    report('dotted-abbreviation "F.D.A." correctly FAILS axiom4 (not just bare "FDA")', hit, errors);
  }

  // 18: axiom 4, "FDA" spelled with a space (no punctuation) after each
  // letter ("F D A") must still FAIL -- same bug class as #17, no dots this
  // time, so the fix must be about the spacing itself, not dot-stripping.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Esta bebida está aprobada por la F D A y te da enfoque estable por horas.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('FDA'));
    report('letter-spaced "F D A" (no dots) correctly FAILS axiom4', hit, errors);
  }

  // ---- Checks 19-22 below are regression checks for accent variations, lowercase dotted acronyms, and invisible Unicode format characters.

  // 19: axiom 2, compliance-conservative banned phrase with its one written
  // accent removed ("esta" instead of "está") must still FAIL via ajv.
  // Before the fix, schema.json's then-branch pattern only listed the
  // accented character (á) in its two-case class, so dropping the accent
  // (extremely common in fast TikTok-caption typing) slipped through as a
  // false PASS.
  {
    const bundle = baseGoodBundle();
    bundle.register_profile = 'compliance-conservative';
    bundle.localized_script = 'Todo el mundo ya lo esta usando ahorita para el enfoque diario.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('schema:ajv') && e.includes('pattern'));
    report('compliance-conservative + accent-stripped "esta" (no á) banned phrase correctly FAILS via ajv', hit, errors);
  }

  // 20: axiom 4, "clínicamente probado" with its accent removed
  // ("clinicamente probado") must still FAIL. Before the fix,
  // fabricatedAuthorityCheck lowercased the text but never stripped
  // diacritics, so the accent-stripped spelling of a closed-set clinical-
  // proof phrase was invisible to the `.includes()` check.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = bundle.localized_script + ' Esta clinicamente probado que funciona.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('clinical-proof wording'));
    report('accent-stripped "clinicamente probado" (no í) correctly FAILS axiom4', hit, errors);
  }

  // 21: axiom 4, "FDA" spelled with a dot after each LOWERCASE letter
  // ("f.d.a.") must FAIL -- same bug class as checks 17/18, but those only
  // covered ALL-CAPS spaced/dotted spellings. collapseSpacedAcronyms's
  // original regex required [A-Z], so a lowercase dotted spelling never got
  // folded back to "fda" and slipped through as a false PASS.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Esta bebida esta aprobada por la f.d.a. y te da enfoque estable por horas.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('FDA'));
    report('lowercase dot-glued "f.d.a." correctly FAILS axiom4 (not just ALL-CAPS spaced/dotted forms)', hit, errors);
  }

  // 22: axiom 3, a zero-width space (U+200B) inserted inside "usted" (e.g.
  // "Us<ZWSP>ted") must still FAIL. Before the fix, ajv's raw-string pattern
  // test legitimately PASSED such a bundle (the 5-letter run "usted" never
  // appears contiguously), and secondaryPatternCheck re-tested the exact
  // same raw (unnormalized) string, so nothing caught it. The fix strips a
  // small set of invisible Unicode format characters before the secondary
  // re-test.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Us' + String.fromCharCode(0x200b) + 'ted puede sentir la diferencia desde el primer dia que lo prueba.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom3]'));
    report('zero-width-space-obfuscated "Us\\u200Bted" correctly FAILS via hand-written invisible-character normalization (ajv alone cannot strip it)', hit, errors);
  }

  // 23: axiom 2, the 'erradica/suprime/sana en un abrir y cerrar de ojos,
  // para siempre' arm makes the comma at that one join point optional
  // ([,\s]* instead of \s+), because the exact phrase as documented in
  // profiles/compliance-conservative.md contains a literal comma -- without
  // the optional comma allowance, the documented phrase would not be banned.
  {
    const bundle = baseGoodBundle();
    bundle.register_profile = 'compliance-conservative';
    bundle.localized_script = 'Con este producto, erradica en un abrir y cerrar de ojos, para siempre.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('schema:ajv') && e.includes('pattern'));
    report('documented banned phrase WITH its comma ("...de ojos, para siempre") correctly FAILS via ajv (not just the no-comma variant)', hit, errors);
  }

  // ---- Checks 24-27 below are regression checks ensuring invisible Unicode characters and combining diacritic marks do not bypass axiom checks.

  // 24: axiom 4, ZWSP inserted inside an authority token (e.g. "O​MS"
  // with U+200B between 'O' and 'M') must still FAIL. Before the fix,
  // fabricatedAuthorityCheck did not call stripInvisibleChars, so a ZWSP
  // breaking the continuous letter run of an authority token completely
  // evaded the .includes() substring check.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Esta bebida está certificada por la O' + String.fromCharCode(0x200b) + 'MS y te da enfoque estable por horas.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom4]') && e.includes('OMS/WHO'));
    report('ZWSP-obfuscated authority token "O\\u200BMS" correctly FAILS axiom4 (fabricatedAuthorityCheck now strips invisible chars before substring matching)', hit, errors);
  }

  // 25: axiom 3, SOFT HYPHEN (U+00AD) inserted inside "usted"
  // ("Us­ted") must still FAIL. Before the fix, INVISIBLE_CODEPOINTS
  // only covered 5 codepoints (U+200B/U+200C/U+200D/U+FEFF/U+2060) and
  // did not include U+00AD, so a soft-hyphen-obfuscated "usted" evaded
  // both ajv's raw pattern and the secondaryPatternCheck's invisible-char
  // normalization.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Us' + String.fromCharCode(0x00ad) + 'ted puede sentir la diferencia desde el primer dia que lo prueba.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom3]'));
    report('SOFT HYPHEN-obfuscated "Us\\u00ADted" correctly FAILS via hand-written normalization (U+00AD now in INVISIBLE_CODEPOINTS)', hit, errors);
  }

  // 26: axiom 3, COMBINING ACUTE ACCENT (U+0301) inserted inside
  // "usted" ("Uśted") must still FAIL. Before the fix,
  // secondaryPatternCheck only called stripInvisibleChars, which does
  // not strip combining marks (they are not format/invisible characters),
  // so a combining-acute-obfuscated "usted" evaded both ajv's raw
  // pattern and the secondary check. The fix adds stripDiacritics
  // (NFD + combining-mark removal) to the normalization chain.
  {
    const bundle = baseGoodBundle();
    bundle.localized_script = 'Us' + String.fromCharCode(0x0301) + 'ted puede sentir la diferencia desde el primer dia que lo prueba.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom3]'));
    report('combining-acute-obfuscated "Us\\u0301ted" correctly FAILS via hand-written normalization (secondaryPatternCheck now strips diacritics too)', hit, errors);
  }

  // 27: axiom 2, NFD-decomposed accented character in a
  // compliance-conservative banned phrase must FAIL via the hand-written
  // secondary check (ajv alone cannot normalize so it PASSES). Before the
  // fix, secondaryPatternCheck only called stripInvisibleChars, which does
  // not normalize NFD decomposition. "está" written as the 5-codepoint
  // sequence e + s + t + a + U+0301 (rather than the single precomposed
  // character á) has the base letter 'a' separated from its combining
  // acute accent by the regex class boundary -- after [aAáÁ] matches the
  // raw 'a', the next character U+0301 is not whitespace and doesn't
  // match \s+, so the raw pattern fails. After stripDiacritics, the
  // U+0301 is removed and the continuous "esta usando" run is caught.
  {
    const bundle = baseGoodBundle();
    bundle.register_profile = 'compliance-conservative';
    bundle.localized_script = 'Todo el mundo ya lo est' + 'a' + String.fromCharCode(0x0301) + ' usando ahorita para el enfoque diario.';
    const errors = validate(bundle, ajvValidateFn, schema);
    const hit = errors.some((e) => e.includes('[axiom2][schema-secondary]'));
    report('NFD-decomposed "está" (base a + U+0301) in banned phrase correctly FAILS via secondaryPatternCheck with stripDiacritics (ajv alone would PASS)', hit, errors);
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
  let allPass = true;
  args.forEach((f) => {
    const ok = runOne(f, ajvValidateFn, schema);
    if (!ok) allPass = false;
  });
  process.exitCode = allPass ? 0 : 1;
}
