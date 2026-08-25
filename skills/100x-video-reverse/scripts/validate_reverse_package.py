#!/usr/bin/env python3
"""Validate a 100X video reverse package and its local media references."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ASSET_CATEGORIES = ("people", "products", "scenes", "props", "wardrobe", "audio", "text")
SHOT_ASSET_FIELDS = ("people", "products", "scenes", "props", "wardrobe")
FRAME_FIELDS = ("start", "representative", "highlight", "end")
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac"}
TOP_REQUIRED = ("schema_version", "candidate_id", "video_id", "source_file", "video", "shots", "assets", "prompt_pack", "evidence")
PLACEHOLDER_RE = re.compile(r"^\s*(?:TODO|TBD|PLACEHOLDER|\[TODO[^\]]*\]|<[^>]+>|\{\{[^}]+\}\})\s*$", re.IGNORECASE)
VIDEO_CONTENT_FIELDS = (
    "filename",
    "aspect_ratio",
    "resolution",
    "audio_track",
    "language",
    "subtitle_type",
    "overall_style",
    "narrative_structure",
    "hook",
    "product_bridge",
    "proof_process",
    "cta",
)
SHOT_CONTENT_FIELDS = (
    "transition",
    "shot_size",
    "camera_position",
    "camera_motion",
    "lighting",
    "color",
    "narrative_function",
    "conversion_function",
)
ASSET_CONTENT_FIELDS = (
    "asset_type",
    "name",
    "crop_instruction",
    "generic_prompt",
    "omni_prompt",
    "seedance_prompt",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate reverse.json structure, timeline, references, and package media.")
    parser.add_argument("--package", required=True, type=Path, help="Path to reverse.json")
    parser.add_argument("--source-manifest", type=Path, help="Optional source_manifest.json")
    parser.add_argument("--require-media", action="store_true", help="Treat missing frame/asset media as hard errors")
    parser.add_argument(
        "--legacy-unverified-media",
        action="store_true",
        help="Audit historical packages without materialization provenance; never use for a new handoff",
    )
    parser.add_argument("--max-segment-seconds", type=float, default=10.0, help="Compatibility warning threshold")
    parser.add_argument("--report", type=Path, help="Write the full validation result as JSON")
    return parser.parse_args()


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"File does not exist: {path}") from None
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from None


def as_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add(items: list[dict[str, str]], code: str, path: str, message: str) -> None:
    items.append({"code": code, "path": path, "message": message})


def walk_strings(value: Any, path: str = "$") -> Iterable[tuple[str, str]]:
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk_strings(item, f"{path}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from walk_strings(item, f"{path}.{key}")


def media_path(package_root: Path, relative: Any) -> tuple[Path | None, str | None]:
    if not isinstance(relative, str) or not relative.strip():
        return None, "media path is empty"
    candidate = Path(relative)
    if candidate.is_absolute():
        return None, "media path must be relative to reverse.json"
    resolved = (package_root / candidate).resolve()
    try:
        resolved.relative_to(package_root.resolve())
    except ValueError:
        return None, "media path escapes the package directory"
    return resolved, None


def validate_schema(data: Any, schema_path: Path, errors: list[dict[str, str]], warnings: list[dict[str, str]]) -> None:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        add(
            errors,
            "schema_library_unavailable",
            "$",
            "jsonschema is unavailable; full contract validation cannot run. Install it in an isolated environment before handoff.",
        )
        if not isinstance(data, dict):
            add(errors, "top_level_type", "$", "Top-level JSON must be an object.")
            return
        for key in TOP_REQUIRED:
            if key not in data:
                add(errors, "required_field", f"$.{key}", "Required top-level field is missing.")
        return
    try:
        schema = read_json(schema_path)
    except ValueError as exc:
        add(errors, "schema_unavailable", "$", str(exc))
        return
    validator_class = jsonschema.validators.validator_for(schema)
    validator_class.check_schema(schema)
    validator = validator_class(schema)
    for issue in sorted(validator.iter_errors(data), key=lambda item: list(item.absolute_path)):
        location = "$" + "".join(f"[{part}]" if isinstance(part, int) else f".{part}" for part in issue.absolute_path)
        add(errors, "schema_validation", location, issue.message)


def validate_media_reference(
    root: Path,
    relative: Any,
    location: str,
    require_media: bool,
    errors: list[dict[str, str]],
    warnings: list[dict[str, str]],
) -> None:
    resolved, problem = media_path(root, relative)
    if problem:
        add(errors, "invalid_media_path", location, problem)
        return
    if resolved is not None and not resolved.is_file():
        target = errors if require_media else warnings
        add(target, "missing_media", location, f"Referenced media does not exist: {relative}")


def validate_timeline(data: dict[str, Any], errors: list[dict[str, str]], warnings: list[dict[str, str]]) -> set[str]:
    video = data.get("video") if isinstance(data.get("video"), dict) else {}
    duration = as_number(video.get("duration_seconds"))
    shots = data.get("shots") if isinstance(data.get("shots"), list) else []
    if duration is None or duration <= 0:
        add(errors, "invalid_duration", "$.video.duration_seconds", "Video duration must be a positive finite number.")
        duration = 0.0
    if not shots:
        add(errors, "empty_timeline", "$.shots", "At least one shot is required.")
        return set()
    parsed: list[tuple[float, float, int, dict[str, Any]]] = []
    shot_ids: set[str] = set()
    for index, raw in enumerate(shots):
        location = f"$.shots[{index}]"
        if not isinstance(raw, dict):
            add(errors, "invalid_shot", location, "Shot must be an object.")
            continue
        shot_id = raw.get("shot_id")
        if not isinstance(shot_id, str) or not shot_id.strip():
            add(errors, "invalid_shot_id", f"{location}.shot_id", "Shot ID must be a non-empty string.")
        elif shot_id in shot_ids:
            add(errors, "duplicate_shot_id", f"{location}.shot_id", f"Duplicate shot ID: {shot_id}")
        else:
            shot_ids.add(shot_id)
        start = as_number(raw.get("start_time_seconds"))
        end = as_number(raw.get("end_time_seconds"))
        declared = as_number(raw.get("duration_seconds"))
        if start is None or end is None or end <= start:
            add(errors, "invalid_shot_range", location, "Shot start/end must be finite and end must be greater than start.")
            continue
        if start < -0.01 or (duration and end > duration + 0.2):
            add(errors, "shot_out_of_range", location, f"Shot range {start:.3f}-{end:.3f}s is outside the video duration.")
        actual = end - start
        if declared is None:
            add(errors, "invalid_shot_duration", f"{location}.duration_seconds", "Shot duration must be numeric.")
        elif abs(declared - actual) > 0.5:
            add(errors, "shot_duration_mismatch", f"{location}.duration_seconds", f"Declared {declared:.3f}s differs from range by more than 0.5s.")
        elif abs(declared - actual) > 0.15:
            add(warnings, "shot_duration_rounding", f"{location}.duration_seconds", f"Declared {declared:.3f}s differs from range by {abs(declared - actual):.3f}s.")
        parsed.append((start, end, index, raw))
    parsed.sort(key=lambda item: item[0])
    if parsed:
        if parsed[0][0] > 0.25:
            add(errors, "timeline_start_gap", "$.shots", f"Timeline starts at {parsed[0][0]:.3f}s.")
        elif parsed[0][0] > 0.05:
            add(warnings, "timeline_start_rounding", "$.shots", f"Timeline starts at {parsed[0][0]:.3f}s.")
        if duration and duration - parsed[-1][1] > 0.25:
            add(errors, "timeline_end_gap", "$.shots", f"Timeline ends {duration - parsed[-1][1]:.3f}s before the video ends.")
        elif duration and duration - parsed[-1][1] > 0.05:
            add(warnings, "timeline_end_rounding", "$.shots", f"Timeline ends {duration - parsed[-1][1]:.3f}s before the video ends.")
    for left, right in zip(parsed, parsed[1:]):
        delta = right[0] - left[1]
        if delta > 0.25:
            add(errors, "timeline_gap", f"$.shots[{right[2]}]", f"Uncovered gap of {delta:.3f}s before this shot.")
        elif delta > 0.05:
            add(warnings, "timeline_gap_rounding", f"$.shots[{right[2]}]", f"Gap of {delta:.3f}s before this shot.")
        elif delta < -0.25:
            add(errors, "timeline_overlap", f"$.shots[{right[2]}]", f"Overlap of {-delta:.3f}s with the previous shot.")
        elif delta < -0.05:
            add(warnings, "timeline_overlap_rounding", f"$.shots[{right[2]}]", f"Overlap of {-delta:.3f}s with the previous shot.")
    return shot_ids


def require_nonempty_string(value: Any, path: str, errors: list[dict[str, str]]) -> None:
    if not isinstance(value, str) or not value.strip():
        add(errors, "empty_required_content", path, "A non-empty descriptive string is required; use an explicit observed-none statement when applicable.")


def require_nonempty_list(value: Any, path: str, errors: list[dict[str, str]]) -> None:
    if not isinstance(value, list) or not value:
        add(errors, "empty_required_content", path, "At least one evidence-backed item is required.")


def validate_semantic_content(data: dict[str, Any], errors: list[dict[str, str]]) -> None:
    for field in ("schema_version", "candidate_id", "video_id", "source_file"):
        require_nonempty_string(data.get(field), f"$.{field}", errors)

    video = data.get("video") if isinstance(data.get("video"), dict) else {}
    for field in VIDEO_CONTENT_FIELDS:
        require_nonempty_string(video.get(field), f"$.video.{field}", errors)

    shots = data.get("shots") if isinstance(data.get("shots"), list) else []
    for shot_index, shot in enumerate(shots):
        if not isinstance(shot, dict):
            continue
        location = f"$.shots[{shot_index}]"
        for field in SHOT_CONTENT_FIELDS:
            require_nonempty_string(shot.get(field), f"{location}.{field}", errors)
        require_nonempty_list(shot.get("actions"), f"{location}.actions", errors)
        require_nonempty_list(shot.get("evidence_timestamps"), f"{location}.evidence_timestamps", errors)
        frames = shot.get("frames") if isinstance(shot.get("frames"), dict) else {}
        for frame_name in FRAME_FIELDS:
            frame = frames.get(frame_name)
            if isinstance(frame, dict):
                require_nonempty_string(frame.get("reason"), f"{location}.frames.{frame_name}.reason", errors)
        for timed_field in ("dialogue", "subtitles", "screen_text"):
            entries = shot.get(timed_field) if isinstance(shot.get(timed_field), list) else []
            for item_index, item in enumerate(entries):
                if not isinstance(item, dict):
                    continue
                for field in ("speaker", "text", "language"):
                    require_nonempty_string(item.get(field), f"{location}.{timed_field}[{item_index}].{field}", errors)

    assets = data.get("assets") if isinstance(data.get("assets"), dict) else {}
    for category in ASSET_CATEGORIES:
        entries = assets.get(category) if isinstance(assets.get(category), list) else []
        for asset_index, asset in enumerate(entries):
            if not isinstance(asset, dict):
                continue
            location = f"$.assets.{category}[{asset_index}]"
            require_nonempty_string(asset.get("asset_id"), f"{location}.asset_id", errors)
            for field in ASSET_CONTENT_FIELDS:
                require_nonempty_string(asset.get(field), f"{location}.{field}", errors)
            for field in ("shot_ids", "observable_facts", "consistency_anchors", "invariants"):
                require_nonempty_list(asset.get(field), f"{location}.{field}", errors)

    prompt_pack = data.get("prompt_pack") if isinstance(data.get("prompt_pack"), dict) else {}
    for field in ("global_video_prompt", "omni_version", "seedance_version"):
        require_nonempty_string(prompt_pack.get(field), f"$.prompt_pack.{field}", errors)
    for field in ("negative_constraints", "stitching_post_notes", "must_not_change"):
        require_nonempty_list(prompt_pack.get(field), f"$.prompt_pack.{field}", errors)
    for prompt_index, prompt in enumerate(
        prompt_pack.get("shot_prompts") if isinstance(prompt_pack.get("shot_prompts"), list) else []
    ):
        if isinstance(prompt, dict):
            for field in ("common", "omni", "seedance"):
                require_nonempty_string(prompt.get(field), f"$.prompt_pack.shot_prompts[{prompt_index}].{field}", errors)
    for prompt_index, prompt in enumerate(
        prompt_pack.get("asset_prompts") if isinstance(prompt_pack.get("asset_prompts"), list) else []
    ):
        if isinstance(prompt, dict):
            for field in ("common", "omni", "seedance"):
                require_nonempty_string(prompt.get(field), f"$.prompt_pack.asset_prompts[{prompt_index}].{field}", errors)
    segments = (
        prompt_pack.get("segmented_generation_plan")
        if isinstance(prompt_pack.get("segmented_generation_plan"), list)
        else []
    )
    require_nonempty_list(segments, "$.prompt_pack.segmented_generation_plan", errors)
    for segment_index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            continue
        location = f"$.prompt_pack.segmented_generation_plan[{segment_index}]"
        for field in ("start_state", "key_action", "end_state", "omni_prompt", "seedance_prompt"):
            require_nonempty_string(segment.get(field), f"{location}.{field}", errors)
        for field in ("shot_ids", "continuity_anchors"):
            require_nonempty_list(segment.get(field), f"{location}.{field}", errors)

    evidence = data.get("evidence") if isinstance(data.get("evidence"), dict) else {}
    for field in ("input_mode", "sampling_density", "transcript_source"):
        require_nonempty_string(evidence.get(field), f"$.evidence.{field}", errors)


def validate_refs_and_media(
    data: dict[str, Any],
    root: Path,
    shot_ids: set[str],
    require_media: bool,
    errors: list[dict[str, str]],
    warnings: list[dict[str, str]],
) -> set[str]:
    asset_ids: set[str] = set()
    assets_by_category: dict[str, set[str]] = {category: set() for category in ASSET_CATEGORIES}
    assets = data.get("assets") if isinstance(data.get("assets"), dict) else {}
    for category in ASSET_CATEGORIES:
        entries = assets.get(category) if isinstance(assets.get(category), list) else []
        for index, asset in enumerate(entries):
            location = f"$.assets.{category}[{index}]"
            if not isinstance(asset, dict):
                continue
            asset_id = asset.get("asset_id")
            if not isinstance(asset_id, str) or not asset_id.strip():
                add(errors, "invalid_asset_id", f"{location}.asset_id", "Asset ID must be a non-empty string.")
            elif asset_id in asset_ids:
                add(errors, "duplicate_asset_id", f"{location}.asset_id", f"Duplicate asset ID: {asset_id}")
            else:
                asset_ids.add(asset_id)
                assets_by_category[category].add(asset_id)
            for shot_id in asset.get("shot_ids", []) if isinstance(asset.get("shot_ids"), list) else []:
                if shot_id not in shot_ids:
                    add(errors, "unknown_asset_shot", f"{location}.shot_ids", f"Asset references unknown shot: {shot_id}")
            validate_media_reference(root, asset.get("screenshot_relative_path"), f"{location}.screenshot_relative_path", require_media, errors, warnings)

    shots = data.get("shots") if isinstance(data.get("shots"), list) else []
    for shot_index, shot in enumerate(shots):
        if not isinstance(shot, dict):
            continue
        frames = shot.get("frames") if isinstance(shot.get("frames"), dict) else {}
        start = as_number(shot.get("start_time_seconds"))
        end = as_number(shot.get("end_time_seconds"))
        for frame_name in FRAME_FIELDS:
            frame = frames.get(frame_name)
            location = f"$.shots[{shot_index}].frames.{frame_name}"
            if not isinstance(frame, dict):
                continue
            timestamp = as_number(frame.get("timestamp_seconds"))
            if timestamp is not None and start is not None and end is not None and not (start - 0.1 <= timestamp <= end + 0.1):
                add(errors, "frame_outside_shot", f"{location}.timestamp_seconds", f"Frame timestamp {timestamp:.3f}s is outside the shot.")
            validate_media_reference(root, frame.get("relative_path"), f"{location}.relative_path", require_media, errors, warnings)
        for field in SHOT_ASSET_FIELDS:
            values = shot.get(field) if isinstance(shot.get(field), list) else []
            for asset_id in values:
                if asset_id not in assets_by_category[field]:
                    add(errors, "unknown_shot_asset", f"$.shots[{shot_index}].{field}", f"Shot references unknown {field} asset: {asset_id}")
    return asset_ids


def collect_expected_media(
    data: dict[str, Any], root: Path, errors: list[dict[str, str]]
) -> dict[str, dict[str, Any]]:
    expected: dict[str, dict[str, Any]] = {}

    def collect(relative: Any, timestamp: Any, location: str, kind: str) -> None:
        resolved, problem = media_path(root, relative)
        if problem or resolved is None:
            return
        number = as_number(timestamp)
        if number is None:
            return
        key = resolved.relative_to(root.resolve()).as_posix()
        previous = expected.get(key)
        if previous is not None and abs(previous["requested_timestamp_seconds"] - number) > 0.001:
            add(
                errors,
                "media_timestamp_conflict",
                location,
                f"The same media path maps to {previous['requested_timestamp_seconds']:.3f}s and {number:.3f}s.",
            )
        elif previous is not None and previous["kind"] != kind:
            add(errors, "media_kind_conflict", location, f"The same media path is declared as {previous['kind']} and {kind}.")
        else:
            expected[key] = {"requested_timestamp_seconds": number, "kind": kind}

    shots = data.get("shots") if isinstance(data.get("shots"), list) else []
    for shot_index, shot in enumerate(shots):
        if not isinstance(shot, dict):
            continue
        frames = shot.get("frames") if isinstance(shot.get("frames"), dict) else {}
        for frame_name in FRAME_FIELDS:
            frame = frames.get(frame_name)
            if isinstance(frame, dict):
                collect(
                    frame.get("relative_path"),
                    frame.get("timestamp_seconds"),
                    f"$.shots[{shot_index}].frames.{frame_name}",
                    "frame",
                )
    assets = data.get("assets") if isinstance(data.get("assets"), dict) else {}
    for category in ASSET_CATEGORIES:
        entries = assets.get(category) if isinstance(assets.get(category), list) else []
        for asset_index, asset in enumerate(entries):
            if isinstance(asset, dict):
                declared_path = asset.get("screenshot_relative_path")
                collect(
                    declared_path,
                    asset.get("screenshot_timestamp_seconds"),
                    f"$.assets.{category}[{asset_index}]",
                    "audio"
                    if category == "audio" and isinstance(declared_path, str) and Path(declared_path).suffix.lower() in AUDIO_EXTENSIONS
                    else "frame",
                )
    return expected


def validate_materialization_provenance(
    data: dict[str, Any],
    root: Path,
    package_path: Path,
    expected_media: dict[str, dict[str, Any]],
    source_manifest: dict[str, Any] | None,
    errors: list[dict[str, str]],
    warnings: list[dict[str, str]],
) -> None:
    provenance_path = root / "materialization_manifest.json"
    try:
        provenance = read_json(provenance_path)
    except ValueError as exc:
        add(errors, "materialization_provenance_missing", "$.media", str(exc))
        return
    if not isinstance(provenance, dict):
        add(errors, "materialization_provenance_invalid", "$.media", "materialization_manifest.json must be an object.")
        return
    if provenance.get("complete") is not True:
        add(errors, "materialization_incomplete", "$.media", "Materialization provenance is not complete.")
    if provenance.get("source_file") != data.get("source_file"):
        add(errors, "materialization_source_mismatch", "$.media", "Materialization source filename differs from reverse.json.")
    if provenance.get("reverse_sha256") != sha256_file(package_path):
        add(
            errors,
            "materialization_reverse_hash_mismatch",
            "$.media",
            "reverse.json changed after materialization; rerun materialization to verify or rebuild every referenced medium.",
        )
    source_hash = provenance.get("source_sha256")
    if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", source_hash):
        add(errors, "materialization_source_hash_invalid", "$.media", "Materialization source SHA-256 is missing or invalid.")
    if source_manifest and isinstance(source_manifest.get("sha256"), str) and source_hash != source_manifest.get("sha256"):
        add(errors, "materialization_source_hash_mismatch", "$.media", "Materialization source SHA-256 differs from source_manifest.json.")

    entries = provenance.get("media") if isinstance(provenance.get("media"), list) else []
    by_path: dict[str, dict[str, Any]] = {}
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict) or not isinstance(entry.get("relative_path"), str):
            add(errors, "materialization_entry_invalid", f"$.media[{index}]", "Media provenance entry is invalid.")
            continue
        relative = entry["relative_path"]
        if relative in by_path:
            add(errors, "materialization_entry_duplicate", f"$.media[{index}]", f"Duplicate provenance path: {relative}")
        by_path[relative] = entry

    for relative, expected in expected_media.items():
        entry = by_path.get(relative)
        if not entry:
            add(errors, "materialization_entry_missing", "$.media", f"No provenance entry for required media: {relative}")
            continue
        if entry.get("kind") != expected["kind"]:
            add(errors, "materialization_kind_mismatch", "$.media", f"Provenance kind differs for {relative}.")
        recorded_timestamp = as_number(entry.get("requested_timestamp_seconds"))
        if recorded_timestamp is None or abs(recorded_timestamp - expected["requested_timestamp_seconds"]) > 0.001:
            add(errors, "materialization_timestamp_mismatch", "$.media", f"Provenance timestamp differs for {relative}.")
        resolved, problem = media_path(root, relative)
        if problem or resolved is None or not resolved.is_file():
            continue
        recorded_hash = entry.get("sha256")
        actual_hash = sha256_file(resolved)
        if recorded_hash != actual_hash:
            add(errors, "materialization_media_hash_mismatch", "$.media", f"Media hash differs from provenance: {relative}")
    unused = sorted(set(by_path) - set(expected_media))
    if unused:
        add(warnings, "unused_materialization_entries", "$.media", f"Provenance contains {len(unused)} media entries no longer referenced by reverse.json.")


def validate_prompt_pack(
    data: dict[str, Any],
    shot_ids: set[str],
    asset_ids: set[str],
    max_segment_seconds: float,
    errors: list[dict[str, str]],
    warnings: list[dict[str, str]],
) -> None:
    prompt_pack = data.get("prompt_pack") if isinstance(data.get("prompt_pack"), dict) else {}
    prompt_shots: set[str] = set()
    for index, item in enumerate(prompt_pack.get("shot_prompts", []) if isinstance(prompt_pack.get("shot_prompts"), list) else []):
        if not isinstance(item, dict):
            continue
        shot_id = item.get("shot_id")
        if shot_id in prompt_shots:
            add(errors, "duplicate_shot_prompt", f"$.prompt_pack.shot_prompts[{index}].shot_id", f"Duplicate shot prompt: {shot_id}")
        elif shot_id not in shot_ids:
            add(errors, "unknown_prompt_shot", f"$.prompt_pack.shot_prompts[{index}].shot_id", f"Prompt references unknown shot: {shot_id}")
        elif isinstance(shot_id, str):
            prompt_shots.add(shot_id)
    missing_prompts = sorted(shot_ids - prompt_shots)
    if missing_prompts:
        add(errors, "missing_shot_prompts", "$.prompt_pack.shot_prompts", f"Missing prompts for shots: {', '.join(missing_prompts)}")

    for index, item in enumerate(prompt_pack.get("asset_prompts", []) if isinstance(prompt_pack.get("asset_prompts"), list) else []):
        if isinstance(item, dict) and item.get("asset_id") not in asset_ids:
            add(errors, "unknown_prompt_asset", f"$.prompt_pack.asset_prompts[{index}].asset_id", f"Prompt references unknown asset: {item.get('asset_id')}")

    segments = prompt_pack.get("segmented_generation_plan") if isinstance(prompt_pack.get("segmented_generation_plan"), list) else []
    segment_ranges: list[tuple[float, float, int]] = []
    seen_segment_ids: set[str] = set()
    covered_shots: set[str] = set()
    for index, segment in enumerate(segments):
        location = f"$.prompt_pack.segmented_generation_plan[{index}]"
        if not isinstance(segment, dict):
            continue
        segment_id = segment.get("segment_id")
        if isinstance(segment_id, str):
            if segment_id in seen_segment_ids:
                add(errors, "duplicate_segment_id", f"{location}.segment_id", f"Duplicate segment ID: {segment_id}")
            seen_segment_ids.add(segment_id)
        start = as_number(segment.get("start_time_seconds"))
        end = as_number(segment.get("end_time_seconds"))
        if start is not None and end is not None and end > start:
            segment_ranges.append((start, end, index))
            if end - start > max_segment_seconds + 0.05:
                add(warnings, "segment_too_long", location, f"Segment duration {end - start:.3f}s exceeds compatibility threshold {max_segment_seconds:.3f}s.")
        for shot_id in segment.get("shot_ids", []) if isinstance(segment.get("shot_ids"), list) else []:
            if shot_id not in shot_ids:
                add(errors, "unknown_segment_shot", f"{location}.shot_ids", f"Segment references unknown shot: {shot_id}")
            else:
                covered_shots.add(shot_id)
    if segments and shot_ids - covered_shots:
        add(errors, "uncovered_segment_shots", "$.prompt_pack.segmented_generation_plan", f"Shots absent from every segment: {', '.join(sorted(shot_ids - covered_shots))}")
    segment_ranges.sort(key=lambda item: item[0])
    for left, right in zip(segment_ranges, segment_ranges[1:]):
        delta = right[0] - left[1]
        if delta > 0.25:
            add(errors, "segment_gap", f"$.prompt_pack.segmented_generation_plan[{right[2]}]", f"Segment gap of {delta:.3f}s.")
        elif delta < -0.25:
            add(errors, "segment_overlap", f"$.prompt_pack.segmented_generation_plan[{right[2]}]", f"Segment overlap of {-delta:.3f}s.")

    must_not_change = prompt_pack.get("must_not_change") if isinstance(prompt_pack.get("must_not_change"), list) else []
    if not must_not_change:
        add(errors, "missing_invariants", "$.prompt_pack.must_not_change", "At least one global invariant is required.")


def compare_source_manifest(data: dict[str, Any], manifest: dict[str, Any], errors: list[dict[str, str]], warnings: list[dict[str, str]]) -> None:
    source_name = manifest.get("source_file")
    if isinstance(source_name, str) and data.get("source_file") != source_name:
        add(errors, "source_file_mismatch", "$.source_file", f"reverse.json names {data.get('source_file')!r}, manifest names {source_name!r}.")
    reverse_duration = as_number((data.get("video") or {}).get("duration_seconds") if isinstance(data.get("video"), dict) else None)
    manifest_duration = as_number(manifest.get("duration_seconds"))
    if reverse_duration is not None and manifest_duration is not None:
        delta = abs(reverse_duration - manifest_duration)
        if delta > 0.2:
            add(errors, "source_duration_mismatch", "$.video.duration_seconds", f"Duration differs from source manifest by {delta:.3f}s.")
        elif delta > 0.05:
            add(warnings, "source_duration_rounding", "$.video.duration_seconds", f"Duration differs from source manifest by {delta:.3f}s.")


def main() -> None:
    args = parse_args()
    package_path = args.package.expanduser().resolve()
    root = package_path.parent
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    source_manifest_data: dict[str, Any] | None = None
    try:
        data = read_json(package_path)
    except ValueError as exc:
        result = {"valid": False, "hard_error_count": 1, "warning_count": 0, "errors": [{"code": "package_unreadable", "path": "$", "message": str(exc)}], "warnings": []}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    schema_path = Path(__file__).resolve().parent.parent / "schema.json"
    validate_schema(data, schema_path, errors, warnings)
    if not isinstance(data, dict):
        add(errors, "top_level_type", "$", "Top-level JSON must be an object.")
        shot_ids: set[str] = set()
        asset_ids: set[str] = set()
    else:
        for path, value in walk_strings(data):
            if PLACEHOLDER_RE.fullmatch(value):
                add(errors, "unresolved_placeholder", path, f"Unresolved placeholder: {value}")
        shot_ids = validate_timeline(data, errors, warnings)
        validate_semantic_content(data, errors)
        asset_ids = validate_refs_and_media(data, root, shot_ids, args.require_media, errors, warnings)
        validate_prompt_pack(data, shot_ids, asset_ids, args.max_segment_seconds, errors, warnings)
        evidence = data.get("evidence") if isinstance(data.get("evidence"), dict) else {}
        limitations = evidence.get("limitations") if isinstance(evidence.get("limitations"), list) else []
        uncertainties = evidence.get("uncertainties") if isinstance(evidence.get("uncertainties"), list) else []
        if not limitations:
            add(warnings, "limitations_empty", "$.evidence.limitations", "No limitations were recorded; confirm this is intentional.")
        if not uncertainties:
            add(warnings, "uncertainties_empty", "$.evidence.uncertainties", "No uncertainties were recorded; confirm this is intentional.")
        if args.source_manifest:
            try:
                manifest = read_json(args.source_manifest.expanduser().resolve())
                if not isinstance(manifest, dict):
                    raise ValueError("Source manifest must be a JSON object.")
                source_manifest_data = manifest
                compare_source_manifest(data, manifest, errors, warnings)
            except ValueError as exc:
                add(errors, "source_manifest_unreadable", "$", str(exc))
        if args.legacy_unverified_media:
            if not args.require_media:
                add(errors, "legacy_media_flag_misuse", "$.media", "--legacy-unverified-media requires --require-media.")
            else:
                add(
                    warnings,
                    "legacy_unverified_media",
                    "$.media",
                    "Historical media existence was checked without source/timestamp/hash provenance; do not use this package for a new handoff.",
                )
        elif args.require_media:
            expected_media = collect_expected_media(data, root, errors)
            validate_materialization_provenance(
                data, root, package_path, expected_media, source_manifest_data, errors, warnings
            )

    result = {
        "schema_version": "0.1",
        "validated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "package": str(package_path),
        "valid": not errors,
        "hard_error_count": len(errors),
        "warning_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "shot_count": len(shot_ids),
            "asset_count": len(asset_ids),
        },
        "parameters": {
            "require_media": args.require_media,
            "legacy_unverified_media": args.legacy_unverified_media,
            "max_segment_seconds": args.max_segment_seconds,
        },
    }
    if args.report:
        report_path = args.report.expanduser().resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("valid", "hard_error_count", "warning_count", "stats")}, ensure_ascii=False))
    raise SystemExit(0 if not errors else 1)


if __name__ == "__main__":
    main()
