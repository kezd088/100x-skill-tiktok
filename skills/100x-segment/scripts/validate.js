#!/usr/bin/env node
/**
 * 100x-segment real validator.
 *
 * WHY THIS FILE EXISTS:
 * schema.json (vanilla JSON Schema draft-07) can only validate PER-ITEM shape:
 * enum membership (module/shot_purpose/language/archetype pattern), non-empty
 * strings, integer bounds, array minItems/uniqueItems, additionalProperties.
 * It CANNOT express:
 *   (a) same-object cross-field comparison -- a segment's text_annotated, with
 *       every '‖'/'·' mark stripped, must equal that same segment's raw_text
 *       character-for-character (axiom 2).
 *   (b) cross-array referential integrity + coverage -- every shots[].segment_refs
 *       entry must name a real segments[].segment_id, AND every segment_id must
 *       be covered by >=1 shot (axiom 4's zero-orphan rule, same shape as
 *       100x-persona's axiom 4).
 *   (c) "field value equals 1-based array index" -- segment_id/shot_id must be
 *       sequential starting at 1 in array order (also axiom 4 -- see that
 *       axiom's own "可验证" list in axioms.md, which names this check
 *       explicitly). Schema has no access to an item's own array position,
 *       so it cannot express this at all.
 *   (d) the actual breath-mark PLACEMENT rules (axiom 3): sentence-end/em-dash
 *       -> strong, comma/semicolon -> weak (unless overridden by a following
 *       contrastive conjunction -> strong), one-breath run-length cap (14
 *       words EN / ~16 syllables ES), filler-word follow-up, and "no mark
 *       immediately before a price/number token". These require SPLITTING
 *       text_annotated into runs around its own marks and reasoning about the
 *       words on either side of each mark -- a character-level aggregate
 *       parse of a single string, not a shape any JSON Schema keyword (enum/
 *       pattern/etc.) can express in one anchored match without becoming an
 *       unreadable variable-length-lookbehind mega-regex (schema.json's
 *       top-level description explains why that was rejected).
 *
 * All four are hand-written below, gated behind ajv's structural pass (same
 * ORDER OF OPERATIONS as 100x-search-query/100x-persona: ajv runs first; if it
 * fails, this script reports ajv's errors and does not bother running the
 * aggregate/parsing checks on a document that isn't even structurally valid).
 *
 * The module/shot_purpose/language enums used to build selftest fixtures below
 * are READ BACK from schema.json at runtime (loadSchemaFacts()), not retyped
 * here, so the two files cannot silently drift apart. The breath-mark
 * vocabulary lists (CONTRASTIVE_CONJUNCTIONS and FILLER_WORDS below) are NOT
 * part of schema.json at all (they are generation vocabulary, not structural
 * shape) -- they live here and in axioms.md's 公理3 table in prose form. If
 * you change one, change the other.
 *
 * USAGE:
 *   node scripts/validate.js <file1.json> [file2.json ...]
 *     Validates each given SegmentBundle JSON file. Exits 0 if all pass, 1 if
 *     any fails (prints the specific failing rule(s) per file).
 *
 *   node scripts/validate.js --selftest
 *     Runs a fixed regression suite and prints PASS/FAIL for each check. Exits
 *     nonzero if any check doesn't behave as described. See the numbered
 *     comments inside selftest() for what each check proves.
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

const STRONG = '‖'; // ‖
const WEAK = '·';   // ·

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function loadAjvValidator(schema) {
  // strict:false -- schema.json intentionally uses additionalProperties:true
  // on `meta` (warnings/eval_note are optional extensible metadata, not a
  // closed set), which is legitimate JSON Schema, not a mistake.
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

// Read back the schema-declared enums instead of retyping them, so selftest
// fixture construction can never silently drift from schema.json (per the
// build contract: "脚本需要的正则从schema.json读回，不要在两处各写一份").
function loadSchemaFacts(schema) {
  return {
    languageEnum: schema.properties.language.enum,
    moduleEnum: schema.definitions.segment_item.properties.module.enum,
    shotPurposeEnum: schema.definitions.shot_item.properties.shot_purpose.enum,
  };
}

function formatAjvErrors(ajvErrors) {
  return (ajvErrors || []).map((e) => {
    const loc = e.instancePath && e.instancePath.length ? e.instancePath : '(root)';
    const extra = e.params ? ` ${JSON.stringify(e.params)}` : '';
    return `[schema:ajv] ${loc} ${e.message}${extra}`;
  });
}

// ---- Axiom 3 breath-mark vocabulary ----------------------------------------
// Keep byte-for-byte in sync with axioms.md 公理3's prose table. These are NOT
// expressible in schema.json (they are generation vocabulary, not JSON shape).
const CONTRASTIVE_CONJUNCTIONS = {
  en: ['and then', 'but', 'so'], // longest-phrase-first so "and then" matches before a bare "and" would (we don't list bare "and"/"or" -- too common as a plain conjunction, not a contrastive-turn signal)
  es: ['pero', 'entonces', 'y'],
};
// "so" is ambiguous between the transitional/contrastive-conjunction sense
// ("..., so we stayed inside" = therefore) and the degree/intensifier-adverb
// sense ("so much", "so many" = to that extent). This is the SAME class of
// keyword ambiguity axioms.md already discloses for "like" in the soft
// filler-word rule (规则5) -- except "so" sits inside the HARD fail rule 1
// (转折连词开头=强), so a false match here wrongly FAILS a correct weak mark,
// not just emits an extra warning. followingRunStartsWithPhrase() below
// excludes the single most common intensifier collocation ("so much"/
// "so many") that was concretely observed to do this; it is a partial
// mitigation, not a complete disambiguation of "so" -- other intensifier
// uses (e.g. "so tired that...") are NOT excluded and remain a known
// false-positive risk (see axioms.md 公理3 TODO).
const SO_INTENSIFIER_RE = /^so\s+(much|many)\b/i;
const FILLER_WORDS = {
  en: ['okay so', 'wait', 'like'],
  es: ['o sea', 'bueno'],
};
// One-breath run-length cap (axioms.md 公理3). The "8-14"/"10-16" ranges in
// the guidelines are a recommended band; only the UPPER bound is treated as a
// hard machine-checkable ceiling here -- a short run is never a violation.
const RUN_CAP = { en: 14, es: 16 }; // en: words. es: estimated syllables.
const SENTENCE_END_RE = /[.!?]+$/; // trailing run of . ! ? (any mix/repeat)
const EM_DASH = '—'; // — (口播文案蓝图 §5 "破折号制造停顿" -- treated like sentence-end)
// Closing quote/bracket characters that can sit directly against sentence-end
// punctuation before the required breath mark or space, e.g. dialogue like
// `...it changed everything." Then she smiled.` -- straight/curly double and
// single quotes, closing paren/bracket, guillemets. The mandatory
// sentence-end mark check below allows one of these closing-wrap characters
// to appear immediately after the sentence-end punctuation before the
// whitespace, so a glued closing quote does not cause a missing mark to slip
// through.
const SENTENCE_CLOSING_WRAP = '"\'”’»›)\\]';
// Heuristic price/number token used only for the SOFT (non-blocking) check
// that a breath mark should not sit immediately before an emphasis point.
// Known limitation (documented in axioms.md #3 and SKILL.md): this is a proxy
// pattern, not real semantic price detection -- it can miss real prices
// written unusually, and can flag ordinary numbers that aren't prices.
const PRICE_OR_NUMBER_RE = /^(\$\s?\d|\d+\s?(%|dollars?|d[oó]lares?|lbs?|kg|days?|weeks?|d[ií]as?|semanas?))/i;

// Fixed, non-exhaustive list of common abbreviations ending in a period that
// must NOT be treated as a sentence end by checkBreathPlacement()'s
// mandatory-presence scan below. This is the exact gap axioms.md #3's TODO
// already named ("如果下游真实语料大量出现缩写句点，需要补一份缩写词典"),
// and a confirmed real false-positive on real English corpus: "a.m."/"p.m."
// inside a mid-segment sentence is wrongly flagged as missing a breath mark. A
// targeted fix for the abbreviations concretely observed / commonly expected,
// NOT a general sentence-boundary detector -- any abbreviation not in this
// list still risks the same false positive (known limitation, see axioms.md
// #3 TODO).
const ABBREVIATIONS = {
  en: ['a.m.', 'p.m.', 'mr.', 'mrs.', 'ms.', 'dr.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'u.s.', 'u.k.'],
  es: ['sr.', 'sra.', 'srta.', 'dr.', 'dra.', 'ud.', 'uds.', 'etc.'],
};

// periodIndex = index of the '.' character ending a punctuation run. Looks at
// a short trailing window of text and checks (case-insensitively) whether it
// ends with a known abbreviation.
function isAbbreviationPeriod(text, periodIndex, language) {
  const list = ABBREVIATIONS[language] || [];
  const window = text.slice(Math.max(0, periodIndex - 7), periodIndex + 1).toLowerCase();
  return list.some((ab) => window.endsWith(ab));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function followingRunStartsWithPhrase(run, phrase) {
  const trimmed = run.trimStart().toLowerCase();
  // Guard against the "so much"/"so many" intensifier collocation before
  // counting a bare "so" as the contrastive conjunction -- see the
  // SO_INTENSIFIER_RE comment above for why this is a partial, not complete,
  // fix.
  if (phrase === 'so' && SO_INTENSIFIER_RE.test(trimmed)) return false;
  const re = new RegExp('^' + escapeRegExp(phrase) + '(\\s|$|[,.;!?])', 'i');
  return re.test(trimmed);
}

function estimateEnWordCount(run) {
  return run.trim().split(/\s+/).filter(Boolean).length;
}

// Rough Spanish syllable estimate: count vowel-group nuclei per word (a/e/i/o/u
// + accented forms + ü), then sum across the run. This is a proxy, not a real
// syllabifier -- documented as a known approximation in axioms.md #3 and
// SKILL.md's known-limitations parenthetical (diphthongs/hiatus are not
// disambiguated).
function estimateEsSyllableCount(run) {
  const words = run.trim().split(/\s+/).filter(Boolean);
  let total = 0;
  const vowelGroupRe = /[aeiouáéíóúü]+/gi;
  for (const w of words) {
    const groups = w.match(vowelGroupRe);
    total += groups ? groups.length : 1; // words with no vowel (rare) count as 1
  }
  return total;
}

// ---- Parse text_annotated into runs + marks --------------------------------
// Splits on the two mark characters, keeping the marks themselves so each mark
// can be paired with the run immediately before and after it.
function splitRuns(textAnnotated) {
  const parts = textAnnotated.split(new RegExp(`([${STRONG}${WEAK}])`));
  // parts alternates: run0, mark1, run1, mark2, run2, ...
  const runs = [];
  const marks = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) runs.push(parts[i]);
    else marks.push(parts[i]);
  }
  return { runs, marks }; // runs.length === marks.length + 1
}

// ---- Axiom 2: text_annotated integrity (cross-field, same object) ---------
function checkIntegrity(segment, errors) {
  const stripped = segment.text_annotated.split(new RegExp(`[${STRONG}${WEAK}]`)).join('');
  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  if (normalize(stripped) !== normalize(segment.raw_text)) {
    errors.push(`[axiom2] segment_id=${segment.segment_id}: text_annotated with marks stripped does not match raw_text (breath marks must only ADD characters, never delete/reorder/reword)`);
  }
}

// ---- Axiom 3: breath-mark shape + placement rules --------------------------
function checkBreathPlacement(segment, language, errors, warnings) {
  const text = segment.text_annotated;
  const trimmed = text.trim();

  // Structural shape checks (documented in schema.json as intentionally NOT a
  // schema pattern -- see that file's top-level description for why).
  if (/^[‖·]/.test(trimmed)) {
    errors.push(`[axiom3] segment_id=${segment.segment_id}: text_annotated must not start with a breath mark (nothing precedes it to breathe after)`);
  }
  if (/[‖·]$/.test(trimmed)) {
    errors.push(`[axiom3] segment_id=${segment.segment_id}: text_annotated must not end with a breath mark (segment boundary already implies a stop)`);
  }
  if (/[‖·]\s*[‖·]/.test(text)) {
    errors.push(`[axiom3] segment_id=${segment.segment_id}: two breath marks with no words between them (doubled mark)`);
  }

  // Format rule (workflow.md 2C: "气口字符必须单独用空格前后隔开...不能紧贴
  // 文字"). The three checks above only catch a mark at the very start/end of
  // the string or two marks touching each other -- none of them catch a lone
  // mark glued directly to an ordinary word, which is a separate shape
  // violation workflow.md states as a "must". A mark preceded or followed by
  // a non-whitespace, non-mark character is glued.
  const glueBeforeRe = new RegExp(`[^\\s${STRONG}${WEAK}][${STRONG}${WEAK}]`);
  const glueAfterRe = new RegExp(`[${STRONG}${WEAK}][^\\s${STRONG}${WEAK}]`);
  if (glueBeforeRe.test(text) || glueAfterRe.test(text)) {
    errors.push(`[axiom3] segment_id=${segment.segment_id}: a breath mark is glued directly to a word with no surrounding space (workflow.md 2C requires marks to be space-separated on both sides)`);
  }

  const { runs, marks } = splitRuns(text);

  // Per-mark strength checks.
  for (let i = 0; i < marks.length; i++) {
    const before = runs[i];
    const after = runs[i + 1];
    const mark = marks[i];

    const followingIsContrastive = CONTRASTIVE_CONJUNCTIONS[language].some((p) => followingRunStartsWithPhrase(after, p));
    const precedingIsSentenceEnd = SENTENCE_END_RE.test(before.trim()) || before.trim().endsWith(EM_DASH);
    const precedingIsComma = /[,;]\s*$/.test(before);

    // Priority order (axioms.md 公理3): a contrastive-conjunction opener
    // outranks sentence-end, which outranks a plain comma/semicolon. Computed
    // as a SINGLE required strength first, then compared once, so a mark that
    // correctly satisfies the top-priority rule is not wrongly flagged against
    // a lower-priority rule it was never subject to.
    let requiredStrength = null;
    let requiredReason = null;
    if (followingIsContrastive) {
      requiredStrength = STRONG;
      requiredReason = `precedes a contrastive-conjunction opener ("${CONTRASTIVE_CONJUNCTIONS[language].find((p) => followingRunStartsWithPhrase(after, p))}")`;
    } else if (precedingIsSentenceEnd) {
      requiredStrength = STRONG;
      requiredReason = 'follows sentence-final punctuation or an em dash';
    } else if (precedingIsComma) {
      requiredStrength = WEAK;
      requiredReason = 'follows a comma/semicolon';
    }

    if (requiredStrength && mark !== requiredStrength) {
      const foundLabel = mark === STRONG ? 'strong (‖)' : 'weak (·)';
      const wantLabel = requiredStrength === STRONG ? 'strong (‖)' : 'weak (·)';
      errors.push(`[axiom3] segment_id=${segment.segment_id} mark#${i + 1}: ${requiredReason} -- must be ${wantLabel}, found ${foundLabel}`);
    }
  }

  // Mandatory presence: every mid-segment sentence-ending punctuation / em
  // dash must be followed by a strong mark (a full stop is always a breath
  // point if more text follows in the same segment). This cannot be checked
  // by walking runs[]/marks[] -- same reasoning as the filler-word soft check
  // below: runs[] is built by splitting ON existing marks, so it has no way to
  // represent "a sentence-end position where a mark is missing entirely" (a
  // missing mark never creates a run boundary in the first place). Scan the
  // original string directly instead.
  //
  // Edge cases handled by this check:
  //   (i) '!'/'?' allow zero-space boundaries so glued punctuation like
  //       "Really?Wait" is caught even without intervening whitespace.
  //  (ii) '.' requires whitespace and is checked against ABBREVIATIONS to
  //       prevent abbreviation periods ('a.m.', 'Mr.') from being flagged.
  //       Known limitation (see axioms.md #3): a typo sentence end using '.'
  //       glued with zero space is suppressed to avoid abbreviation false-positives.
  let sentenceEndMissingMark = false;
  {
    const markCharsRe = new RegExp(`^\\s*[${STRONG}${WEAK}]`);
    const wrapPrefixRe = new RegExp(`^[${SENTENCE_CLOSING_WRAP}]*`);
    const punctRunRe = /[.!?]+/g;
    let m;
    while ((m = punctRunRe.exec(text)) !== null) {
      const runEnd = punctRunRe.lastIndex; // index just past this punctuation run
      const lastChar = m[0][m[0].length - 1];
      if (lastChar === '.' && isAbbreviationPeriod(text, runEnd - 1, language)) continue;
      const afterWrap = runEnd + wrapPrefixRe.exec(text.slice(runEnd))[0].length;
      const rest = text.slice(afterWrap);
      if (markCharsRe.test(rest)) continue; // a breath mark is already there
      const gapRe = lastChar === '.' ? /^\s+\S/ : /^\s*\S/;
      if (gapRe.test(rest)) { sentenceEndMissingMark = true; break; }
    }
  }
  if (sentenceEndMissingMark) {
    errors.push(`[axiom3] segment_id=${segment.segment_id}: found sentence-final punctuation followed by more text with no breath mark at all (mid-segment sentence ends must get a strong ‖)`);
  }
  const emDashNoMarkRe = new RegExp(`${EM_DASH}(?!\\s*[${STRONG}${WEAK}])\\s*\\S`, 'g');
  if (emDashNoMarkRe.test(text)) {
    errors.push(`[axiom3] segment_id=${segment.segment_id}: found an em dash followed by more text with no breath mark at all (em dash is treated as a strong breath point, 口播文案蓝图 §5)`);
  }

  // Run-length cap (hard ceiling only -- see RUN_CAP comment above).
  const cap = RUN_CAP[language];
  const estimate = language === 'es' ? estimateEsSyllableCount : estimateEnWordCount;
  runs.forEach((run, i) => {
    const n = estimate(run);
    if (n > cap) {
      const unit = language === 'es' ? 'syllables (estimated)' : 'words';
      errors.push(`[axiom3] segment_id=${segment.segment_id} run#${i + 1}: ${n} ${unit} with no breath mark inside it, exceeds the ${cap}-${unit} one-breath cap for ${language}`);
    }
  });

  // Soft checks -- collected as warnings, never fail the file.
  //
  // NOTE: an earlier draft tried to detect "filler word with no following
  // mark" by walking the runs[]/marks[] arrays produced by splitRuns(). That
  // is structurally impossible: runs[] is built BY SPLITTING ON existing
  // marks, so by construction every non-last run boundary already has a mark
  // -- there is no way to represent "a position with no mark" inside an array
  // that was itself built by cutting the string at mark positions. Detecting
  // a MISSING mark has to scan the original string directly instead (the same
  // approach the sentence-end/em-dash mandatory-presence checks above already
  // use).
  FILLER_WORDS[language].forEach((phrase) => {
    // (?=\s*[A-Za-zÀ-ÿ]) requires an actual following WORD, not just trailing
    // punctuation -- without this, "...feel like." (filler word immediately
    // before the segment's own closing period) false-positived on every first
    // draft of evals/example-01, since ".", technically a non-whitespace
    // character, satisfied a naive "(?=\s*\S)" lookahead.
    const re = new RegExp('\\b' + escapeRegExp(phrase) + '\\b(?!\\s*[' + STRONG + WEAK + '])(?=\\s*[A-Za-zÀ-ÿ])', 'gi');
    if (re.test(text)) {
      warnings.push(`segment_id=${segment.segment_id}: filler word "${phrase}" appears without a following breath mark (soft check, axiom3 filler-word rule)`);
    }
  });
  for (let i = 0; i < marks.length; i++) {
    if (PRICE_OR_NUMBER_RE.test(runs[i + 1].trimStart())) {
      warnings.push(`segment_id=${segment.segment_id} mark#${i + 1}: sits immediately before what looks like a price/number token -- emphasis pauses before prices should not be marked as breath points (soft heuristic, known false-positive/negative risk, see axioms.md #3)`);
    }
  }
}

// ---- Axiom 4: sequential ids in array order (schema can't see array index) -
function checkSequentialIds(bundle, errors) {
  bundle.segments.forEach((s, i) => {
    if (s.segment_id !== i + 1) {
      errors.push(`[axiom4] segments[${i}].segment_id is ${s.segment_id}, expected ${i + 1} (sequential, 1-based, array order)`);
    }
  });
  bundle.shots.forEach((s, i) => {
    if (s.shot_id !== i + 1) {
      errors.push(`[axiom4] shots[${i}].shot_id is ${s.shot_id}, expected ${i + 1} (sequential, 1-based, array order)`);
    }
  });
}

// ---- Axiom 4: shots<->segments referential integrity + zero-orphan coverage
function checkShotSegmentLinkage(bundle, errors) {
  const segmentIds = new Set(bundle.segments.map((s) => s.segment_id));
  const covered = new Set();
  bundle.shots.forEach((shot, i) => {
    shot.segment_refs.forEach((ref) => {
      if (!segmentIds.has(ref)) {
        errors.push(`[axiom4] shots[${i}] (shot_id=${shot.shot_id}): segment_refs contains ${ref}, which is not a real segment_id in segments[]`);
      } else {
        covered.add(ref);
      }
    });
  });
  segmentIds.forEach((id) => {
    if (!covered.has(id)) {
      errors.push(`[axiom4] segment_id=${id} is never referenced by any shots[].segment_refs (zero-orphan rule)`);
    }
  });
}

// Full pipeline: ajv structural pass first, hand-written checks only if it
// passes (mirrors 100x-search-query/100x-persona's validate() ordering).
function validate(bundle, ajvValidateFn) {
  const structurallyValid = ajvValidateFn(bundle);
  if (!structurallyValid) {
    return { errors: formatAjvErrors(ajvValidateFn.errors), warnings: [] };
  }

  const errors = [];
  const warnings = [];

  checkSequentialIds(bundle, errors);
  checkShotSegmentLinkage(bundle, errors);
  bundle.segments.forEach((segment) => {
    checkIntegrity(segment, errors);
    checkBreathPlacement(segment, bundle.language, errors, warnings);
  });

  return { errors, warnings };
}

function runOne(file, ajvValidateFn) {
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { errors, warnings } = validate(bundle, ajvValidateFn);
  if (errors.length === 0) {
    console.log(`PASS: ${file}`);
    warnings.forEach((w) => console.log('  (warning) ' + w));
  } else {
    console.log(`FAIL: ${file}`);
    errors.forEach((e) => console.log('  - ' + e));
  }
  return errors.length === 0;
}

// ---- Self-test: reproduces counterexamples as fixed regression tests -------
function baseGoodBundle() {
  return {
    source_text: 'This stuff works fast. It changes everything you feel every single day.',
    language: 'en',
    archetype: 'A',
    segments: [
      {
        segment_id: 1,
        module: 'hook',
        raw_text: 'This stuff works fast. It changes everything you feel every single day.',
        text_annotated: `This stuff works fast. ${STRONG} It changes everything you feel every single day.`,
      },
    ],
    shots: [
      { shot_id: 1, segment_refs: [1], shot_purpose: 'hook' },
    ],
    meta: { generated_by: '100x-segment', warnings: [] },
  };
}

function selftest() {
  const schema = loadSchema();
  const ajvValidateFn = loadAjvValidator(schema);
  const facts = loadSchemaFacts(schema);
  const evalFiles = fs.existsSync(EVALS_DIR) ? fs.readdirSync(EVALS_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(EVALS_DIR, f)) : [];
  let allOk = true;
  let n = 0;
  // 1 (schema facts) + one check per real evals/ file + 17 fixed counterexamples below.
  const total = 1 + Math.max(evalFiles.length, 1) + 17;

  function report(ok, label, errorsForDebug) {
    n += 1;
    if (ok) {
      console.log(`SELFTEST PASS (${n}/${total} ${label})`);
    } else {
      console.log(`SELFTEST FAIL (${n}/${total} ${label})`);
      if (errorsForDebug) console.log('  errors were:', errorsForDebug);
      allOk = false;
    }
  }

  // 1: schema facts sanity -- proves loadSchemaFacts() actually read real
  // arrays back from schema.json, not empty/undefined.
  report(
    facts.languageEnum.includes('en') && facts.languageEnum.includes('es') && facts.moduleEnum.length === 10 && facts.shotPurposeEnum.length === 7,
    'schema facts read back from schema.json (language/module/shot_purpose enums)'
  );

  // 2..N: every real, shipped evals/ file must pass.
  if (evalFiles.length === 0) {
    report(false, 'real evals/ files found (none found!)');
  }
  evalFiles.forEach((f) => {
    const bundle = JSON.parse(fs.readFileSync(f, 'utf8'));
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.length === 0, `real eval: ${path.relative(process.cwd(), f)}`, errors);
  });

  // Counterexample: injected additionalProperty on a segment_item -> ajv catches it.
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].extra_field_not_in_schema = 'should be rejected';
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('additional properties') || e.includes('additionalProperties')), 'segment_item with an undeclared extra field FAILS via ajv additionalProperties', errors);
  }

  // Counterexample: module outside the 10-value enum -> ajv catches it.
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].module = 'closure'; // not one of the 10 (this is the excluded 11th-module-adjacent trap)
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('allowed values')), 'segment with module outside the 10-value enum FAILS via ajv enum', errors);
  }

  // Counterexample: archetype "A+A" (same letter twice) -> ajv pattern (backreference) catches it.
  {
    const bundle = baseGoodBundle();
    bundle.archetype = 'A+A';
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('pattern')), 'archetype "A+A" (duplicate letter) FAILS via ajv pattern', errors);
  }

  // Counterexample: segment_id not sequential -> hand-written checkSequentialIds catches it.
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].segment_id = 5;
    bundle.shots[0].segment_refs = [5];
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom4]')), 'non-sequential segment_id FAILS on axiom4 (schema cannot see array index)', errors);
  }

  // Counterexample: shots[].segment_refs points at a nonexistent segment_id.
  {
    const bundle = baseGoodBundle();
    bundle.shots[0].segment_refs = [99];
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom4]') && e.includes('not a real segment_id')), 'shots[].segment_refs pointing at a nonexistent segment_id FAILS on axiom4 referential integrity', errors);
  }

  // Counterexample: a segment defined but never referenced by any shot (orphan).
  {
    const bundle = baseGoodBundle();
    bundle.segments.push({
      segment_id: 2,
      module: 'cta',
      raw_text: 'Tap the link right now.',
      text_annotated: 'Tap the link right now.',
    });
    // shots[0] still only references segment_id 1 -- segment 2 is an orphan.
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom4]') && e.includes('never referenced')), 'segment never referenced by any shot FAILS on axiom4 zero-orphan coverage', errors);
  }

  // Counterexample: text_annotated diverges from raw_text (a word was dropped).
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].text_annotated = `This stuff works. ${STRONG} It changes everything you feel every single day.`; // "fast" silently dropped
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom2]')), 'text_annotated that drops a word vs raw_text FAILS on axiom2 integrity', errors);
  }

  // Counterexample: comma followed by a STRONG mark (should be weak).
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].raw_text = 'Tired of waiting, hoping for a fix that never comes.';
    bundle.segments[0].text_annotated = `Tired of waiting, ${STRONG} hoping for a fix that never comes.`;
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom3]') && e.includes('comma')), 'comma followed by a strong mark FAILS on axiom3 (must be weak)', errors);
  }

  // Counterexample: contrastive-conjunction opener ("But") preceded by a weak mark (should be strong).
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].raw_text = 'You have tried everything, but nothing worked until now.';
    bundle.segments[0].text_annotated = `You have tried everything, ${WEAK} but nothing worked until now.`;
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom3]') && e.includes('contrastive-conjunction')), 'contrastive-conjunction opener preceded by a weak mark FAILS on axiom3 (must be strong)', errors);
  }

  // Counterexample: "so much" is
  // the degree-adverb/intensifier sense of "so", not the contrastive
  // conjunction sense -- a correctly weak comma mark here must PASS, not get
  // force-rejected. The old naive keyword match treated every "so" as the
  // contrastive conjunction and wrongly failed this valid input.
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].raw_text = "This routine changed my mornings, so much that I can't imagine going back.";
    bundle.segments[0].text_annotated = `This routine changed my mornings, ${WEAK} so much that I can't imagine going back.`;
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.length === 0, 'comma before intensifier "so much" (not the contrastive-conjunction sense of "so") PASSES, is not force-FAILed on axiom3', errors);
  }

  // Counterexample: one-breath run exceeds the English 14-word cap with zero internal marks.
  {
    const bundle = baseGoodBundle();
    const longRun = 'this is a very long single breath run that just keeps going and going and going without any pause at all whatsoever';
    bundle.segments[0].raw_text = longRun + '.';
    bundle.segments[0].text_annotated = longRun + '.';
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom3]') && e.includes('one-breath cap')), 'run exceeding the 14-word EN one-breath cap with zero marks FAILS on axiom3', errors);
  }

  // Counterexample: sentence-end
  // punctuation glued to a closing quote (dialogue), with NO breath mark
  // anywhere in the segment -- must still be caught. The old regex required
  // whitespace to appear IMMEDIATELY after the punctuation, so a glued
  // closing quote made the mandatory-presence check silently miss this.
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].raw_text = 'She said "it changed everything." Then she smiled.';
    bundle.segments[0].text_annotated = 'She said "it changed everything." Then she smiled.'; // zero marks anywhere
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom3]') && e.includes('no breath mark at all')), 'sentence-end punctuation glued to a closing quote with no mark still FAILS on axiom3', errors);
  }

  // Counterexample: a breath mark glued
  // directly to the following word with no surrounding whitespace.
  // workflow.md 2C states the space-separated format as a "must".
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].raw_text = 'This stuff works fast. It changes everything you feel every single day.';
    bundle.segments[0].text_annotated = `This stuff works fast. ${STRONG}It changes everything you feel every single day.`; // mark glued to "It", zero space after
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom3]') && e.includes('glued')), 'breath mark glued directly to a word (no surrounding space) FAILS on axiom3 (workflow.md 2C format rule)', errors);
  }

  // Soft-check 1/2: filler word with no following mark WARNS (does not fail).
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].raw_text = 'Wait until you see day three. This still works.';
    bundle.segments[0].text_annotated = `Wait until you see day three. ${STRONG} This still works.`;
    const { errors, warnings } = validate(bundle, ajvValidateFn);
    const hasWarning = warnings.some((w) => w.includes('filler word'));
    report(errors.length === 0 && hasWarning, 'filler word with no following mark WARNS (soft check) without failing the file', { errors, warnings });
  }

  // Soft-check 2/2: a mark immediately before a price/number token WARNS.
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].raw_text = 'This works fast. This costs less than $2 a day.';
    bundle.segments[0].text_annotated = `This works fast. ${STRONG} This costs less than ${WEAK} $2 a day.`;
    const { errors, warnings } = validate(bundle, ajvValidateFn);
    const hasWarning = warnings.some((w) => w.includes('price/number'));
    report(errors.length === 0 && hasWarning, 'mark immediately before a price/number token WARNS (soft check) without failing the file', { errors, warnings });
  }

  // Counterexample: sentence-end punctuation glued with zero space to the
  // next word must still be caught for '!'/'?' (no legitimate abbreviation
  // ends in either).
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].raw_text = 'Really?Wait until you see this work.';
    bundle.segments[0].text_annotated = 'Really?Wait until you see this work.'; // zero marks, '?' glued to next word
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.some((e) => e.includes('[axiom3]') && e.includes('no breath mark at all')), "sentence-end '?' glued with zero space to the next word (no marks anywhere) still FAILS on axiom3", errors);
  }

  // Counterexample (English abbreviation test case): an abbreviation period ("a.m.") followed by more real text
  // and no mark must NOT be flagged -- only a genuine sentence end lacking a
  // mark should fail.
  {
    const bundle = baseGoodBundle();
    bundle.segments[0].raw_text = 'Some people wake up at 6 a.m. every single day. This still works for you.';
    bundle.segments[0].text_annotated = `Some people wake up at 6 a.m. every single day. ${STRONG} This still works for you.`;
    const { errors } = validate(bundle, ajvValidateFn);
    report(errors.length === 0, "abbreviation period ('a.m.') followed by more text is not force-FAILed on axiom3 mandatory-presence", errors);
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
    const ok = runOne(f, ajvValidateFn);
    if (!ok) allPass = false;
  });
  process.exitCode = allPass ? 0 : 1;
}
