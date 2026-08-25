#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

const skillRoot = path.resolve(__dirname, "..");
const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);
const ASSET_KEYS = ["people", "products", "scenes", "props", "wardrobe", "audio", "text"];
const SHOT_ASSET_KEYS = ["people", "products", "scenes", "props", "wardrobe"];
const EPSILON = 0.05;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function issue(code, location, message) {
  return { code, path: location, message };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes("\\")) return false;
  return !value.split("/").includes("..");
}

function checkPlaceholders(value, location, errors) {
  if (typeof value === "string") {
    if (/\b(?:TODO|TBD|PLACEHOLDER)\b|<[^>]+>/i.test(value)) {
      errors.push(issue("placeholder", location, "Unresolved placeholder is not allowed."));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkPlaceholders(item, `${location}[${index}]`, errors));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => checkPlaceholders(item, `${location}.${key}`, errors));
  }
}

function validateBundle(bundle) {
  const errors = [];
  const schemaOk = validateSchema(bundle);
  if (!schemaOk) {
    for (const entry of validateSchema.errors || []) {
      errors.push(issue("schema", entry.instancePath || "$", entry.message || "Schema validation failed."));
    }
  }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return errors;

  const duration = bundle.video && bundle.video.duration_seconds;
  if (!isFiniteNumber(duration) || duration <= 0) {
    errors.push(issue("video_duration", "$.video.duration_seconds", "Video duration must be a positive finite number."));
  }
  if (!bundle.video || !isFiniteNumber(bundle.video.fps) || bundle.video.fps <= 0) {
    errors.push(issue("video_fps", "$.video.fps", "FPS must be a positive finite number."));
  }

  const shots = Array.isArray(bundle.shots) ? bundle.shots : [];
  const shotIds = new Set();
  shots.forEach((shot, index) => {
    const base = `$.shots[${index}]`;
    if (shotIds.has(shot.shot_id)) errors.push(issue("duplicate_shot_id", `${base}.shot_id`, "Shot IDs must be unique."));
    shotIds.add(shot.shot_id);
    const start = shot.start_time_seconds;
    const end = shot.end_time_seconds;
    const declared = shot.duration_seconds;
    if (![start, end, declared].every(isFiniteNumber) || end <= start) {
      errors.push(issue("shot_time", base, "Shot start/end/duration must be finite and end must be greater than start."));
    } else if (Math.abs((end - start) - declared) > EPSILON) {
      errors.push(issue("shot_duration", `${base}.duration_seconds`, "Declared duration must equal end minus start."));
    }
    if (!isFiniteNumber(shot.confidence) || shot.confidence < 0 || shot.confidence > 1) {
      errors.push(issue("confidence", `${base}.confidence`, "Confidence must be between 0 and 1."));
    }
    if (shot.frames && isFiniteNumber(start) && isFiniteNumber(end)) {
      for (const [kind, frame] of Object.entries(shot.frames)) {
        if (!isFiniteNumber(frame.timestamp_seconds) || frame.timestamp_seconds < start - EPSILON || frame.timestamp_seconds > end + EPSILON) {
          errors.push(issue("frame_time", `${base}.frames.${kind}.timestamp_seconds`, "Frame timestamp must fall inside its shot."));
        }
        if (!isSafeRelativePath(frame.relative_path)) {
          errors.push(issue("unsafe_path", `${base}.frames.${kind}.relative_path`, "Media path must be a safe forward-slash relative path."));
        }
      }
    }
    for (const [textKey, entries] of [["dialogue", shot.dialogue], ["subtitles", shot.subtitles], ["screen_text", shot.screen_text]]) {
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, textIndex) => {
        if (!isFiniteNumber(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
          errors.push(issue("confidence", `${base}.${textKey}[${textIndex}].confidence`, "Confidence must be between 0 and 1."));
        }
      });
    }
    if (Array.isArray(shot.evidence_timestamps) && isFiniteNumber(start) && isFiniteNumber(end)) {
      shot.evidence_timestamps.forEach((timestamp, evidenceIndex) => {
        if (!isFiniteNumber(timestamp) || timestamp < start - EPSILON || timestamp > end + EPSILON) {
          errors.push(issue("evidence_time", `${base}.evidence_timestamps[${evidenceIndex}]`, "Evidence timestamp must fall inside its shot."));
        }
      });
    }
  });

  if (shots.length > 0) {
    if (Math.abs(shots[0].start_time_seconds) > EPSILON) {
      errors.push(issue("timeline_start", "$.shots[0].start_time_seconds", "Timeline must begin at 0."));
    }
    for (let index = 1; index < shots.length; index += 1) {
      if (Math.abs(shots[index].start_time_seconds - shots[index - 1].end_time_seconds) > EPSILON) {
        errors.push(issue("timeline_continuity", `$.shots[${index}].start_time_seconds`, "Adjacent shots must touch without a gap or overlap."));
      }
    }
    if (isFiniteNumber(duration) && Math.abs(shots[shots.length - 1].end_time_seconds - duration) > EPSILON) {
      errors.push(issue("timeline_end", `$.shots[${shots.length - 1}].end_time_seconds`, "Timeline must end at video duration."));
    }
  }

  const assetSets = {};
  const allAssetIds = new Set();
  for (const key of ASSET_KEYS) {
    assetSets[key] = new Set();
    const entries = bundle.assets && Array.isArray(bundle.assets[key]) ? bundle.assets[key] : [];
    entries.forEach((asset, index) => {
      const base = `$.assets.${key}[${index}]`;
      if (allAssetIds.has(asset.asset_id)) errors.push(issue("duplicate_asset_id", `${base}.asset_id`, "Asset IDs must be globally unique."));
      allAssetIds.add(asset.asset_id);
      assetSets[key].add(asset.asset_id);
      if (!isSafeRelativePath(asset.screenshot_relative_path)) {
        errors.push(issue("unsafe_path", `${base}.screenshot_relative_path`, "Asset screenshot path must be safe and relative."));
      }
      if (!isFiniteNumber(asset.confidence) || asset.confidence < 0 || asset.confidence > 1) {
        errors.push(issue("confidence", `${base}.confidence`, "Confidence must be between 0 and 1."));
      }
      for (const ref of asset.shot_ids || []) {
        if (!shotIds.has(ref)) errors.push(issue("unknown_shot", `${base}.shot_ids`, `Unknown shot reference: ${ref}`));
      }
    });
  }

  shots.forEach((shot, index) => {
    for (const key of SHOT_ASSET_KEYS) {
      for (const ref of shot[key] || []) {
        if (!assetSets[key].has(ref)) errors.push(issue("unknown_asset", `$.shots[${index}].${key}`, `Unknown ${key} asset: ${ref}`));
      }
    }
  });

  const shotPromptIds = new Set();
  for (const [index, prompt] of ((bundle.prompt_pack && bundle.prompt_pack.shot_prompts) || []).entries()) {
    if (!shotIds.has(prompt.shot_id)) errors.push(issue("unknown_shot", `$.prompt_pack.shot_prompts[${index}].shot_id`, `Unknown shot: ${prompt.shot_id}`));
    if (shotPromptIds.has(prompt.shot_id)) errors.push(issue("duplicate_shot_prompt", `$.prompt_pack.shot_prompts[${index}].shot_id`, "Each shot may have only one prompt entry."));
    shotPromptIds.add(prompt.shot_id);
  }
  for (const shotId of shotIds) {
    if (!shotPromptIds.has(shotId)) errors.push(issue("missing_shot_prompt", "$.prompt_pack.shot_prompts", `Missing prompt for ${shotId}`));
  }

  for (const [index, prompt] of ((bundle.prompt_pack && bundle.prompt_pack.asset_prompts) || []).entries()) {
    if (!allAssetIds.has(prompt.asset_id)) errors.push(issue("unknown_asset", `$.prompt_pack.asset_prompts[${index}].asset_id`, `Unknown asset: ${prompt.asset_id}`));
  }
  for (const [index, segment] of ((bundle.prompt_pack && bundle.prompt_pack.segmented_generation_plan) || []).entries()) {
    const base = `$.prompt_pack.segmented_generation_plan[${index}]`;
    if (!isFiniteNumber(segment.start_time_seconds) || !isFiniteNumber(segment.end_time_seconds) || segment.end_time_seconds <= segment.start_time_seconds) {
      errors.push(issue("segment_time", base, "Segment end must be greater than start."));
    }
    for (const ref of segment.shot_ids || []) {
      if (!shotIds.has(ref)) errors.push(issue("unknown_shot", `${base}.shot_ids`, `Unknown shot: ${ref}`));
    }
    const requiresExecutionPlan = typeof bundle.candidate_id === "string"
      && /(?:^|-)(?:v2\.1|v0\.2)(?:-|$)/.test(bundle.candidate_id);
    const execution = segment.execution_plan;
    if (requiresExecutionPlan && (!execution || typeof execution !== "object" || Array.isArray(execution))) {
      errors.push(issue("missing_execution_plan", `${base}.execution_plan`, "Current packages require a user-visible execution plan."));
      continue;
    }
    if (!execution || typeof execution !== "object" || Array.isArray(execution)) continue;

    const inputReferences = Array.isArray(execution.input_references) ? execution.input_references : [];
    inputReferences.forEach((reference, referenceIndex) => {
      const referencePath = `${base}.execution_plan.input_references[${referenceIndex}]`;
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
        errors.push(issue("invalid_input_reference", referencePath, "Input reference must be an object."));
        return;
      }
      if (typeof reference.asset_id === "string" && !allAssetIds.has(reference.asset_id)) {
        errors.push(issue("unknown_asset", `${referencePath}.asset_id`, `Unknown asset: ${reference.asset_id}`));
      }
      if (typeof reference.shot_id === "string" && !shotIds.has(reference.shot_id)) {
        errors.push(issue("unknown_shot", `${referencePath}.shot_id`, `Unknown shot: ${reference.shot_id}`));
      }
      if (typeof reference.relative_path === "string" && !isSafeRelativePath(reference.relative_path)) {
        errors.push(issue("unsafe_path", `${referencePath}.relative_path`, "Input media path must be a safe forward-slash relative path."));
      }
      if (typeof reference.relative_path !== "string" && typeof reference.asset_id !== "string") {
        errors.push(issue("unresolved_input_reference", referencePath, "Input reference requires relative_path or asset_id."));
      }
    });

    if (execution.status === "ready") {
      for (const field of ["provider", "model_id", "capability_checked_at_utc"]) {
        if (typeof execution[field] !== "string" || execution[field].trim().length === 0) {
          errors.push(issue("incomplete_ready_plan", `${base}.execution_plan.${field}`, `Ready plan requires ${field}.`));
        }
      }
      if (!new Set(["omni", "seedance"]).has(execution.model_adapter)) {
        errors.push(issue("incomplete_ready_plan", `${base}.execution_plan.model_adapter`, "Ready plan requires a verified model adapter."));
      }
      if (execution.generation_method === "undecided") {
        errors.push(issue("incomplete_ready_plan", `${base}.execution_plan.generation_method`, "Ready plan requires a concrete generation method."));
      }
      if (inputReferences.length === 0) {
        errors.push(issue("incomplete_ready_plan", `${base}.execution_plan.input_references`, "Ready plan requires at least one input reference."));
      }
    }
  }

  checkPlaceholders(bundle, "$", errors);
  return errors;
}

function runSelftest() {
  const fixturePath = path.join(skillRoot, "evals", "example-01-synthetic-product-demo.json");
  const valid = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const cases = [
    ["valid fixture passes", valid, true],
    ["timeline mismatch fails", (() => { const value = clone(valid); value.shots[0].end_time_seconds = 3.5; return value; })(), false],
    ["unknown asset fails", (() => { const value = clone(valid); value.shots[0].products = ["product_missing"]; return value; })(), false],
    ["path traversal fails", (() => { const value = clone(valid); value.shots[0].frames.start.relative_path = "../escape.jpg"; return value; })(), false],
    ["empty prompt fails", (() => { const value = clone(valid); value.prompt_pack.global_video_prompt = ""; return value; })(), false],
    ["placeholder fails", (() => { const value = clone(valid); value.prompt_pack.global_video_prompt = "TODO replace this"; return value; })(), false],
    ["missing execution plan fails", (() => { const value = clone(valid); delete value.prompt_pack.segmented_generation_plan[0].execution_plan; return value; })(), false],
    ["incomplete ready plan fails", (() => { const value = clone(valid); value.prompt_pack.segmented_generation_plan[0].execution_plan.status = "ready"; return value; })(), false],
    ["unknown execution asset fails", (() => { const value = clone(valid); value.prompt_pack.segmented_generation_plan[0].execution_plan.input_references[3].asset_id = "product_missing"; return value; })(), false]
  ];
  let passed = 0;
  for (const [name, value, shouldPass] of cases) {
    const ok = validateBundle(value).length === 0;
    if (ok === shouldPass) {
      passed += 1;
    } else {
      console.error(`FAIL: ${name}`);
    }
  }
  console.log(`100x-video-reverse selftest: ${passed}/${cases.length}`);
  return passed === cases.length;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--selftest") {
    process.exit(runSelftest() ? 0 : 1);
  }
  if (args.length === 0) {
    console.error("Usage: node scripts/validate.js <reverse.json> [more.json] | --selftest");
    process.exit(2);
  }
  let failed = false;
  for (const input of args) {
    let bundle;
    try {
      bundle = JSON.parse(fs.readFileSync(input, "utf8"));
    } catch (error) {
      console.error(`${input}: unreadable JSON: ${error.message}`);
      failed = true;
      continue;
    }
    const errors = validateBundle(bundle);
    if (errors.length === 0) {
      console.log(`${input}: PASS`);
    } else {
      failed = true;
      console.error(`${input}: FAIL (${errors.length})`);
      for (const entry of errors) console.error(`- [${entry.code}] ${entry.path}: ${entry.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { validateBundle };
