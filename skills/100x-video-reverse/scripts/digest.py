#!/usr/bin/env python3
"""Project a validated package into the compact material the delivery needs.

Measured on the first real two-video run: composing the reply cost 211 s of the
741 s total, because the agent re-read the 125 KB reverse.json and probed the
media directories to find frames and asset shots. Everything it needed is
derivable, so this emits it once, with absolute media paths already resolved.

This is a projection, not a second source of truth: reverse.json, validation.json
and source_manifest.json stay authoritative and nothing is invented here.

It does decide the reply's format. Leaving the layout to the calling agent was
tried and did not hold: blocks went missing and the contract in
references/native-output.md was only partly met. So --format md (the default)
emits the five blocks ready to paste, --format fragment adds a media-first tab
without changing the package truth, --format text keeps the old flat listing,
and --json stays the machine view.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path
from typing import Any

ASSET_CATEGORIES = ("people", "products", "scenes", "props", "wardrobe", "audio", "text")
# native-output.md 3: these three get image + prompt + invariants, the rest get one line.
PRIMARY_ASSET_CATEGORIES = ("people", "products", "scenes")
# Enough to show a segment without opening the package; more would just bloat the reply.
FRAMES_PER_SEGMENT = 3
# selection_basis already opens with this; a second label around it doubles the prefix.
ADVICE_PREFIXES = ("建议：", "建议:")
# Word-level kinetic captions sampled at a few fps look like a caption track but are not one.
SAMPLED_TEXT_COVERAGE_MAX = 0.6
SAMPLED_TEXT_MEDIAN_MAX = 0.5
# Fragment surface budget. The host caps a visualization at 1 MB, and its CSP img-src allows
# only data:/blob:/CDN - no file:// - so every still has to be inlined as a data URI. Measured
# at 320px: ~14 KB per base64 thumbnail, ~350 KB for a 19-still package.
THUMB_WIDTH = 320
THUMB_QUALITY = 6
STORYBOARD_WIDTH = 160
# Bump when the inline presentation changes. Codex can keep an already rendered
# fragment by filename, so a visual redesign must produce a fresh filename even
# when reverse.json and the package path are unchanged.
FRAGMENT_PRESENTATION_VERSION = "v094"
# The source file stays the truth. A full-duration, low-bitrate derivative is
# embedded only so the inline sandbox can play it without file:// access.
PREVIEW_MAX_WIDTH = 240
PREVIEW_MIN_WIDTH = 160
PREVIEW_AUDIO_KBPS = 16
PREVIEW_MIN_VIDEO_KBPS = 32
PREVIEW_MAX_VIDEO_KBPS = 112
FRAGMENT_BUDGET_BYTES = 1_000_000
FRAGMENT_WARN_BYTES = 950_000
FRAGMENT_MEDIA_HEADROOM_BYTES = 16_384
# The inline directive resolves a bare filename against this root, so a fragment
# written anywhere else renders as literal text no matter how correct it is.
THREAD_VIS_ROOT_HINT = "~/.codex/visualizations"
THREAD_VIS_MARKER = (".codex", "visualizations")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Emit the compact delivery material for one or more packages.")
    parser.add_argument("--package", type=Path, action="append", default=[], help="Package directory; repeat for a batch")
    parser.add_argument("--out-root", type=Path, help="Batch root; every child package is included")
    parser.add_argument("--format", choices=("md", "text", "fragment"), default="md",
                        help="md (default) emits the paste-ready five blocks; text keeps the flat listing; "
                             "fragment writes a batch overview when needed plus one self-contained, "
                             "media-first HTML fragment per package")
    parser.add_argument("--host", choices=("codex", "terminal"), default="codex",
                        help="codex (default) inlines media; terminal degrades to clickable paths")
    parser.add_argument("--fragment-dir", type=Path,
                        help="fragment output directory; defaults to <batch root>/fragments")
    parser.add_argument("--thumb-width", type=int, default=THUMB_WIDTH,
                        help="fragment thumbnail width in px (default %d); lower it if a package "
                             "exceeds the 1 MB surface budget; the video preview is budgeted automatically" % THUMB_WIDTH)
    parser.add_argument("--json", action="store_true", help="Print raw JSON; wins over --format")
    return parser.parse_args()


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)


def read_json(path: Path, required: bool = True) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        if required:
            fail("Required file does not exist: " + str(path))
        return None
    except json.JSONDecodeError as exc:
        fail("Invalid JSON in " + str(path) + ": " + str(exc))


def absolute(package: Path, relative: Any) -> str | None:
    if not isinstance(relative, str) or not relative.strip():
        return None
    candidate = (package / relative).resolve()
    return str(candidate) if candidate.is_file() else None


def trim_number(value: Any, digits: int = 3) -> str:
    """3 decimals with the trailing zeros dropped, so 4.833 and 0.2 both read naturally."""
    try:
        text = ("%." + str(digits) + "f") % float(value)
    except (TypeError, ValueError):
        return str(value)
    return text.rstrip("0").rstrip(".") if "." in text else text


def clock_time(value: Any) -> str:
    """Compact review timestamp used by the player beat rail."""
    try:
        seconds = max(0.0, float(value))
    except (TypeError, ValueError):
        return "--:--"
    minutes = int(seconds // 60)
    remainder = seconds - minutes * 60
    return "%02d:%04.1f" % (minutes, remainder)


def strip_advice_prefix(text: Any) -> str:
    """selection_basis already starts with 建议：; the label around it must not repeat it."""
    if not isinstance(text, str):
        return ""
    stripped = text.lstrip()
    for prefix in ADVICE_PREFIXES:
        if stripped.startswith(prefix):
            return stripped[len(prefix):].lstrip()
    return stripped


def source_video(package: Path) -> dict[str, Any]:
    """The playable original; source_manifest.json records where it was read from."""
    manifest = read_json(package / "source_manifest.json", required=False) or {}
    name = manifest.get("source_file")
    raw = manifest.get("source_path")
    path = raw if isinstance(raw, str) and raw.strip() else None
    exists = bool(path) and Path(path).is_file()
    if not name and path:
        name = Path(path).name
    return {
        "name": name,
        "path": path,
        "exists": exists,
        "sha256": manifest.get("sha256"),
        "size_bytes": manifest.get("size_bytes"),
        "duration_seconds": manifest.get("duration_seconds"),
        "width": manifest.get("width"),
        "height": manifest.get("height"),
        "has_audio": manifest.get("has_audio"),
    }


def merge_text_layer(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One caption held across a hard cut arrives as two rows; overlaying it twice is wrong.

    Merge only when the text is identical character for character and the windows
    touch or overlap, taking the union window. Different text is never merged.
    """
    merged: list[dict[str, Any]] = []
    for entry in entries:
        window = entry.get("window")
        previous = merged[-1] if merged else None
        if previous is not None and previous["text"] == entry["text"]:
            last = previous.get("window")
            if (window and last and None not in window and None not in last
                    and window[0] <= last[1] and window[1] >= last[0]):
                previous["window"] = [min(last[0], window[0]), max(last[1], window[1])]
                if entry["shot_id"] not in previous["shot_ids"]:
                    previous["shot_ids"].append(entry["shot_id"])
                previous["merged_from"] += 1
                continue
        item = dict(entry)
        item["shot_ids"] = [entry["shot_id"]]
        item["merged_from"] = 1
        merged.append(item)
    return merged


def text_layer_stats(entries: list[dict[str, Any]], duration: Any) -> dict[str, Any]:
    """How much of the video the text layer actually covers, and how short its pieces are."""
    spans = [float(item["window"][1]) - float(item["window"][0])
             for item in entries
             if item.get("window") and item["window"][0] is not None and item["window"][1] is not None]
    covered = sum(spans)
    try:
        total = float(duration)
    except (TypeError, ValueError):
        total = 0.0
    ratio = covered / total if total > 0 else 0.0
    ordered = sorted(spans)
    if not ordered:
        median = 0.0
    elif len(ordered) % 2:
        median = ordered[len(ordered) // 2]
    else:
        median = (ordered[len(ordered) // 2 - 1] + ordered[len(ordered) // 2]) / 2
    sampled = bool(spans) and ratio < SAMPLED_TEXT_COVERAGE_MAX and median <= SAMPLED_TEXT_MEDIAN_MAX
    return {"entry_count": len(entries), "covered_seconds": round(covered, 3),
            "total_seconds": total, "coverage_ratio": round(ratio, 4),
            "median_entry_seconds": round(median, 3), "sampled_fragment": sampled}


def text_layer_stat_line(stats: dict[str, Any]) -> str:
    """The numbers are printed unconditionally; the label below them is only a reading."""
    return ("条目 %d 条 · 覆盖 %.2fs / %ss (%.1f%%) · 条目时长中位数 %ss"
            % (stats["entry_count"], stats["covered_seconds"], trim_number(stats["total_seconds"]),
               stats["coverage_ratio"] * 100, trim_number(stats["median_entry_seconds"])))


SAMPLED_TEXT_LABEL = ("采样片段，非完整字幕轨，不可直接当叠字脚本用"
                      "（逐词 kinetic 字幕遇上帧采样，抽到的是碎片而不是整条轨）。")


def audio_lines(audio: dict[str, Any], input_mode: Any) -> list[str]:
    """frames-only has no audio channel: say that once, then say what would change it.

    Describes the mode only. A pure-local run is a legitimate choice, so nothing
    here points at credentials or tells anyone to install anything.
    """
    track = audio.get("audio_track")
    if track == "present":
        state = "源视频有音轨"
    elif track in ("absent", "none", "missing"):
        state = "源视频没有音轨"
    else:
        state = "音轨状态 %s" % (track or "未记录")
    if input_mode == "frames_only":
        return [state + "，但本次是帧回退模式，没有音频语义通道，口播与音乐都没有分析。",
                "要拿到口播逐字稿与音乐描述，需要以 API 模式重跑这条视频。"]
    lines = [state + "；转写来源：%s" % (audio.get("transcript_source") or "未记录")]
    for item in audio.get("dialogue") or []:
        lines.append("口播 %s：%s" % (item["shot_id"], "；".join(item.get("lines") or [])))
    for note in audio.get("music") or []:
        lines.append("音乐：%s" % note)
    if not audio.get("dialogue"):
        lines.append("未观察到口播。")
    return lines


def pick_segment_frames(package: Path, segment: dict[str, Any], shots: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """First, peak and last of the segment - the minimum that shows what happens in it."""
    ids = [value for value in segment.get("shot_ids", []) if value in shots]
    if not ids:
        return []
    picks: list[tuple[str, str, str]] = [(ids[0], "start", "首帧")]
    if len(ids) > 2:
        picks.append((ids[len(ids) // 2], "highlight", "高光帧"))
    if len(ids) > 1:
        picks.append((ids[-1], "end", "尾帧"))
    frames: list[dict[str, Any]] = []
    for shot_id, role, label in picks[:FRAMES_PER_SEGMENT]:
        frame = (shots[shot_id].get("frames") or {}).get(role) or {}
        path = absolute(package, frame.get("relative_path"))
        if path:
            frames.append({"label": label, "shot_id": shot_id,
                           "at_seconds": frame.get("timestamp_seconds"), "path": path})
    return frames


def pick_storyboard_frames(package: Path, shots: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """One evidence frame per beat, in timeline order, for the media home tab.

    This is a presentation projection of already materialized package frames. It
    never extracts new evidence or changes reverse.json.
    """
    ordered = sorted(
        shots.items(),
        key=lambda item: (float(item[1].get("start_time_seconds") or 0), item[0]),
    )
    frames: list[dict[str, Any]] = []
    for shot_id, shot in ordered:
        candidates = shot.get("frames") or {}
        frame = candidates.get("highlight") or candidates.get("representative") or candidates.get("start") or {}
        path = absolute(package, frame.get("relative_path"))
        if path:
            frames.append({
                "label": shot_id,
                "at_seconds": frame.get("timestamp_seconds"),
                "start_seconds": shot.get("start_time_seconds"),
                "end_seconds": shot.get("end_time_seconds"),
                "narrative_role": shot.get("narrative_function"),
                "action": next((str(value) for value in (shot.get("actions") or []) if value), None),
                "path": path,
            })
    return frames


def narrative_role(segment: dict[str, Any], shots: dict[str, dict[str, Any]]) -> str:
    """native-output.md 2 wants a narrative role per segment; shots carry it, segments do not."""
    roles: list[str] = []
    for shot_id in segment.get("shot_ids") or []:
        role = (shots.get(shot_id) or {}).get("narrative_function")
        if isinstance(role, str) and role.strip() and role not in roles:
            roles.append(role.strip())
    # Roles are whole sentences that already end in 。; " ".join left a stray space
    # inside the table cell. Separate only when the previous role lacks end punctuation.
    text = ""
    for role in roles:
        if text and text[-1] not in "。.！!？?；;":
            text += "；"
        text += role
    return text


def digest_package(package: Path) -> dict[str, Any]:
    reverse = read_json(package / "reverse.json")
    validation = read_json(package / "validation.json", required=False) or {}
    video = reverse.get("video") or {}
    shots = {shot["shot_id"]: shot for shot in reverse.get("shots", []) if isinstance(shot, dict)}
    prompt_pack = reverse.get("prompt_pack") or {}
    evidence = reverse.get("evidence") or {}

    # (1) headline
    headline = {
        "file": reverse.get("source_file"),
        "duration_seconds": video.get("duration_seconds"),
        "aspect_ratio": video.get("aspect_ratio"),
        "resolution": video.get("resolution"),
        "language": video.get("language"),
        "subtitle_type": video.get("subtitle_type"),
        "overall_style": video.get("overall_style"),
        "narrative_structure": video.get("narrative_structure"),
        "hook": video.get("hook"),
        "product_bridge": video.get("product_bridge"),
        "proof_process": video.get("proof_process"),
        "cta": video.get("cta"),
        "counts": {"beats": len(shots), "segments": len(prompt_pack.get("segmented_generation_plan") or []),
                   "assets": sum(len(reverse.get("assets", {}).get(c) or []) for c in ASSET_CATEGORIES)},
        "validation": {"valid": validation.get("valid"),
                       "hard_errors": validation.get("hard_error_count"),
                       "warnings": validation.get("warning_count")},
        "input_mode": evidence.get("input_mode"),
        "global_prompt": prompt_pack.get("global_video_prompt"),
        "source_video": source_video(package),
    }

    # (2) segments - the replication table
    segments = []
    for segment in prompt_pack.get("segmented_generation_plan") or []:
        if not isinstance(segment, dict):
            continue
        recommendation = segment.get("recommendation") or segment.get("execution_plan") or {}
        status = recommendation.get("status")
        model = recommendation.get("recommended_model") or recommendation.get("model_id")
        if not model:
            model = "未选定" if status == "needs_model_selection" else (status or "未记录")
        if recommendation.get("provider") and recommendation.get("model_id"):
            model = "%s / %s" % (recommendation["provider"], recommendation["model_id"])
        if status:
            model = "%s · %s" % (model, status)
        segments.append({
            "segment_id": segment.get("segment_id"),
            "window": [segment.get("start_time_seconds"), segment.get("end_time_seconds")],
            "duration_seconds": round(float(segment.get("end_time_seconds", 0)) - float(segment.get("start_time_seconds", 0)), 3),
            "shot_ids": segment.get("shot_ids"),
            "narrative_role": narrative_role(segment, shots),
            "key_action": segment.get("key_action"),
            "start_state": segment.get("start_state"),
            "end_state": segment.get("end_state"),
            "continuity_anchors": segment.get("continuity_anchors"),
            "prompt": segment.get("omni_prompt"),
            "seedance_prompt_differs": segment.get("seedance_prompt") != segment.get("omni_prompt"),
            "seedance_prompt": segment.get("seedance_prompt") if segment.get("seedance_prompt") != segment.get("omni_prompt") else None,
            "recommendation": {
                "model": model,
                "method": recommendation.get("generation_method") or "未决定",
                "adapter": recommendation.get("model_adapter"),
                "target_duration_seconds": recommendation.get("target_duration_seconds"),
                "basis": recommendation.get("selection_basis"),
                "inputs": [item.get("label") for item in (recommendation.get("input_references") or []) if isinstance(item, dict)],
                "status": status,
            },
            "frames": pick_segment_frames(package, segment, shots),
        })

    # The machine contract generates by segment, not by individual shot. Link
    # each storyboard beat to its owning segment so the review surface can show
    # the exact existing prompt on click without synthesizing a new shot prompt.
    storyboard = pick_storyboard_frames(package, shots)
    storyboard_by_shot = {frame["label"]: frame for frame in storyboard}
    for segment in segments:
        recommendation = segment.get("recommendation") or {}
        adapter = recommendation.get("adapter") or "omni"
        prompt = (segment.get("seedance_prompt") if adapter == "seedance" else None) or segment.get("prompt")
        # Equal Omni/Seedance prompts are deduplicated above, but the active
        # generation adapter is still Seedance and should be labelled truthfully.
        prompt_adapter = "seedance" if adapter == "seedance" else "omni"
        for shot_id in segment.get("shot_ids") or []:
            frame = storyboard_by_shot.get(shot_id)
            if frame:
                frame["segment_id"] = segment.get("segment_id")
                frame["segment_prompt"] = prompt
                frame["segment_prompt_adapter"] = prompt_adapter

    # (3) assets
    assets = []
    for category in ASSET_CATEGORIES:
        for item in reverse.get("assets", {}).get(category) or []:
            if not isinstance(item, dict):
                continue
            assets.append({
                "asset_id": item.get("asset_id"),
                "category": category,
                "name": item.get("name"),
                "path": absolute(package, item.get("screenshot_relative_path")),
                "facts": item.get("observable_facts"),
                "anchors": item.get("consistency_anchors"),
                "invariants": item.get("invariants"),
                "prompt": item.get("generic_prompt"),
                "shot_ids": item.get("shot_ids"),
            })

    # (4) text layer - verbatim, for deterministic post overlay
    raw_text_layer = []
    for shot in reverse.get("shots", []):
        if not isinstance(shot, dict):
            continue
        for entry in (shot.get("screen_text") or []) + (shot.get("subtitles") or []):
            if isinstance(entry, dict) and entry.get("text"):
                raw_text_layer.append({
                    "shot_id": shot.get("shot_id"),
                    "window": [entry.get("start_time_seconds"), entry.get("end_time_seconds")],
                    "text": entry.get("text"),
                    "language": entry.get("language"),
                })
            elif isinstance(entry, str) and entry.strip():
                raw_text_layer.append({"shot_id": shot.get("shot_id"), "window": None, "text": entry, "language": None})
    # The same caption held across a hard cut lands as two rows; pasted as-is it overlays twice.
    text_layer = merge_text_layer(raw_text_layer)
    text_stats = text_layer_stats(text_layer, video.get("duration_seconds"))

    # (5) audio
    dialogue = [{"shot_id": shot.get("shot_id"), "lines": shot.get("dialogue")}
                for shot in reverse.get("shots", [])
                if isinstance(shot, dict) and shot.get("dialogue")]
    music_notes = sorted({shot.get("music") for shot in reverse.get("shots", [])
                          if isinstance(shot, dict) and isinstance(shot.get("music"), str) and shot.get("music")})
    audio = {
        "transcript_source": evidence.get("transcript_source"),
        "dialogue": dialogue,
        "music": music_notes,
        "audio_assets": [item for item in assets if item["category"] == "audio"],
        "audio_track": video.get("audio_track"),
    }

    return {
        "package": str(package),
        "headline": headline,
        "storyboard": storyboard,
        "segments": segments,
        "assets": assets,
        "text_layer": text_layer,
        "text_layer_stats": text_stats,
        "audio": audio,
        "constraints": {
            "negative_constraints": prompt_pack.get("negative_constraints"),
            "must_not_change": prompt_pack.get("must_not_change"),
            "stitching_post_notes": prompt_pack.get("stitching_post_notes"),
        },
        "limitations": evidence.get("limitations"),
        "uncertainties": evidence.get("uncertainties"),
        "warnings": [str(item.get("code")) + " @ " + str(item.get("path"))
                     for item in (validation.get("warnings") or [])][:20],
        "machine_package": {"reverse_json": str(package / "reverse.json"),
                            "validation_json": str(package / "validation.json"),
                            "root": str(package)},
    }


def source_video_label(source: dict[str, Any]) -> str:
    """native-output.md 1 asks for the playable original, so a missing file is stated, not skipped."""
    if source.get("path") and source.get("exists"):
        return str(source["path"])
    if source.get("path"):
        return "%s（源视频不在原路径：%s）" % (source.get("name") or Path(source["path"]).name, source["path"])
    return "未记录（source_manifest.json 没有 source_path）"


def md_cell(value: Any) -> str:
    """A table cell may not carry a raw pipe or a newline, or the row falls apart."""
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\n", " ").strip()


def md_media(label: str, path: str, host: str = "codex") -> str:
    """Absolute local path, no file:// - native-output.md forbids it.

    Forward slashes: Windows accepts them everywhere, and a backslash inside a
    link destination is a Markdown escape character, so a Windows path can lose
    separators depending on the renderer. Spaces still need <>.
    A host that cannot inline images gets the clickable path native-output.md
    §客户端适配 asks for instead, never a silently broken image.
    """
    target = str(path).replace("\\", "/")
    if host == "terminal":
        return "- %s：`%s`" % (label, target)
    return "![%s](%s)" % (label.replace("]", "）"), "<%s>" % target if " " in target else target)


def md_code(text: Any) -> list[str]:
    """Prompts are the deliverable: fenced verbatim, never rewrapped or trimmed."""
    return ["```text", str(text), "```", ""]


def md_window(window: Any) -> str:
    try:
        return "%.3f-%.3fs" % (float(window[0]), float(window[1]))
    except (TypeError, ValueError, IndexError):
        return "时间未定"


def split_inputs(inputs: Any) -> tuple[list[str], list[str]]:
    """Frame refs and asset ids answer different questions.

    The frame list is what the model gets fed, and it does NOT always match the
    frames inlined above the segment: FRAMES_PER_SEGMENT caps the preview at 3 and
    a segment may inline fewer, so "already shown above" would be a lie. Keep every
    ref, just drop the repeated " frame" suffix and split the two kinds apart.
    """
    frames: list[str] = []
    assets: list[str] = []
    for item in inputs or []:
        text = str(item)
        if text.startswith("shot_") and text.endswith(" frame"):
            frames.append(text[:-len(" frame")])
        else:
            assets.append(text)
    return frames, assets


def asset_one_liner(asset: dict[str, Any]) -> str:
    """One line for props/wardrobe/audio/text: the detail stays inside the package."""
    for key in ("facts", "anchors", "invariants"):
        values = asset.get(key) or []
        if values:
            return str(values[0])
    return asset.get("name") or "（包内有明细）"


def markdown(digests: list[dict[str, Any]], host: str = "codex") -> str:
    """The five blocks of references/native-output.md, ready to paste into the reply."""
    lines: list[str] = []
    total = len(digests)
    if total > 1:
        # references/native-output.md §多条视频: the batch overview comes before
        # the per-video blocks, and a failed entry states its reason in the same
        # table instead of being dropped or moved to the end.
        lines.append("# 批次总览（%d 条）" % total)
        lines.append("")
        lines.append("| # | 视频 | 时长 | 节拍 | 分段 | 资产 | 验证 | 警告 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
        for index, digest in enumerate(digests, start=1):
            head = digest["headline"]
            counts, validation = head["counts"], head["validation"]
            if validation["valid"] is True:
                verdict = "通过"
            elif validation["valid"] is None:
                verdict = "未验证（无 validation.json）"
            else:
                verdict = "未通过 · 硬错误 %s" % md_cell(validation["hard_errors"])
            lines.append("| %d | %s | %ss | %s | %s | %s | %s | %s |" % (
                index, md_cell(head["file"] or digest["package"]),
                md_cell(head["duration_seconds"]), md_cell(counts["beats"]),
                md_cell(counts["segments"]), md_cell(counts["assets"]),
                verdict, md_cell(validation["warnings"])))
        lines.append("")
    for index, digest in enumerate(digests, start=1):
        head = digest["headline"]
        counts, validation = head["counts"], head["validation"]
        title = head["file"] or digest["package"]
        lines.append("# %s%s" % ("第 %d／%d 条 · " % (index, total) if total > 1 else "", title))
        lines.append("")

        # ---- 1 一屏结论 ----
        source = head["source_video"]
        lines.append("## 1 · 一屏结论")
        lines.append("")
        if source.get("path") and source.get("exists"):
            lines.append(md_media(source.get("name") or "源视频", source["path"], host))
            lines.append("")
        lines.append("- 源视频：%s" % source_video_label(source))
        lines.append("- 包根目录：`%s`" % digest["machine_package"]["root"])
        lines.append("- 时长 %ss · %s · %s · 节拍 %s · 分段 %s · 资产 %s"
                     % (trim_number(head["duration_seconds"]), head["aspect_ratio"], head["resolution"],
                        counts["beats"], counts["segments"], counts["assets"]))
        lines.append("- 语言 %s · 音轨 %s · 分析模式 %s"
                     % (head["language"], digest["audio"]["audio_track"], head["input_mode"]))
        lines.append("- 字幕/屏幕文字：%s" % (head["subtitle_type"] or "未观察到"))
        lines.append("- 验证：valid=%s · 硬错误 %s · 警告 %s"
                     % (validation["valid"], validation["hard_errors"], validation["warnings"]))
        lines.append("- 整体风格：%s" % (head["overall_style"] or "未观察到"))
        lines.append("- 骨架：%s" % (head["narrative_structure"] or "未观察到"))
        lines.append("- Hook：%s" % (head["hook"] or "未观察到"))
        lines.append("- 产品桥接：%s" % (head["product_bridge"] or "未观察到"))
        lines.append("- 证明过程：%s" % (head["proof_process"] or "未观察到"))
        lines.append("- CTA：%s" % (head["cta"] or "未观察到"))
        lines.append("")
        if head["global_prompt"]:
            lines.append("整片提示词（逐字）：")
            lines.append("")
            lines.extend(md_code(head["global_prompt"]))

        # ---- 2 分段复刻表 ----
        lines.append("## 2 · 分段复刻表")
        lines.append("")
        lines.append("| 段号 | 时间范围 | 时长 | 叙事作用 | 模型 / 状态 | 生成方式 | 目标时长 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for segment in digest["segments"]:
            recommendation = segment["recommendation"]
            lines.append("| %s | %s | %ss | %s | %s | %s | %ss |"
                         % (md_cell(segment["segment_id"]), md_cell(md_window(segment["window"])),
                            md_cell(trim_number(segment["duration_seconds"])), md_cell(segment["narrative_role"]),
                            md_cell(recommendation["model"]), md_cell(recommendation["method"]),
                            md_cell(trim_number(recommendation["target_duration_seconds"]))))
        lines.append("")
        lines.append("模型、状态与生成方式来自当前包内计划；未选定或阻塞状态不得视为可执行。")
        lines.append("")
        for segment in digest["segments"]:
            recommendation = segment["recommendation"]
            lines.append("### %s · %s（%ss）"
                         % (segment["segment_id"], md_window(segment["window"]),
                            trim_number(segment["duration_seconds"])))
            lines.append("")
            for frame in segment["frames"]:
                lines.append(md_media(frame["label"], frame["path"], host))
            if segment["frames"]:
                lines.append("")
            lines.append("- 镜头：%s" % " ".join(segment["shot_ids"] or []))
            lines.append("- 起：%s" % segment["start_state"])
            lines.append("- 动作：%s" % segment["key_action"])
            lines.append("- 止：%s" % segment["end_state"])
            # 建议模型 / 生成方式 / 目标时长 already fill three columns of the 分段总览表
            # directly above; repeating them per segment bought nothing.
            lines.append("- 选型依据：%s" % strip_advice_prefix(recommendation["basis"]))
            frames_in, assets_in = split_inputs(recommendation["inputs"])
            parts = []
            if frames_in:
                parts.append("帧 %s" % " / ".join(frames_in))
            if assets_in:
                parts.append("资产 %s" % "、".join(assets_in))
            lines.append("- 输入：%s" % (" ｜ ".join(parts) or "未指定"))
            lines.append("")
            lines.append("生成提示词（逐字，%s 版 · %d 字符）："
                         % (recommendation["adapter"] or "omni", len(str(segment["prompt"]))))
            lines.append("")
            lines.extend(md_code(segment["prompt"]))
            if segment["seedance_prompt"]:
                lines.append("Seedance 版（逐字 · %d 字符）：" % len(str(segment["seedance_prompt"])))
                lines.append("")
                lines.extend(md_code(segment["seedance_prompt"]))

        # ---- 3 资产 ----
        primary = [item for item in digest["assets"] if item["category"] in PRIMARY_ASSET_CATEGORIES]
        secondary = [item for item in digest["assets"] if item["category"] not in PRIMARY_ASSET_CATEGORIES]
        lines.append("## 3 · 资产（%d 项）" % len(digest["assets"]))
        lines.append("")
        for asset in primary:
            lines.append("### %s · %s（%s）" % (asset["asset_id"], asset["name"] or "", asset["category"]))
            lines.append("")
            if asset["path"]:
                lines.append(md_media(asset["asset_id"], asset["path"], host))
                lines.append("")
            else:
                lines.append("（无截图）")
                lines.append("")
            if asset["prompt"]:
                lines.append("一致性提示词（逐字 · %d 字符）：" % len(str(asset["prompt"])))
                lines.append("")
                lines.extend(md_code(asset["prompt"]))
            if asset["anchors"]:
                lines.append("- 一致性锚点：%s" % "；".join(asset["anchors"]))
            lines.append("- 禁变：%s" % ("；".join(asset["invariants"] or []) or "未记录"))
            lines.append("")
        if secondary:
            lines.append("### 道具 / 服装 / 音频 / 文字（只列 ID，明细在包内）")
            lines.append("")
            for asset in secondary:
                lines.append("- `%s`（%s）%s —— %s"
                             % (asset["asset_id"], asset["category"], asset["name"] or "",
                                asset_one_liner(asset)))
            lines.append("")

        # ---- 4 文字层 ----
        stats = digest["text_layer_stats"]
        lines.append("## 4 · 文字层")
        lines.append("")
        lines.append("文字由后期叠加，不进生成提示词。")
        lines.append("")
        lines.append(text_layer_stat_line(stats))
        lines.append("")
        if stats["sampled_fragment"]:
            lines.append("> %s" % SAMPLED_TEXT_LABEL)
            lines.append("")
        if digest["text_layer"]:
            lines.append("| 时间范围 | 逐字原文 | 语言 |")
            lines.append("| --- | --- | --- |")
            for entry in digest["text_layer"]:
                lines.append("| %s | %s | %s |"
                             % (md_cell(md_window(entry["window"])), md_cell(entry["text"]),
                                md_cell(entry["language"] or "")))
            lines.append("")
        else:
            lines.append("未观察到屏幕文字。")
            lines.append("")

        # ---- 5 音频 ----
        lines.append("## 5 · 音频")
        lines.append("")
        for line in audio_lines(digest["audio"], head["input_mode"]):
            lines.append("- %s" % line)
        lines.append("")

        # ---- 收尾一：约束、限制与不确定项 ----
        constraints = digest["constraints"]
        lines.append("## 约束、限制与不确定项")
        lines.append("")
        lines.append("禁变 %d 条 · 负向 %d 条 · 拼接 %d 条"
                     % (len(constraints["must_not_change"] or []), len(constraints["negative_constraints"] or []),
                        len(constraints["stitching_post_notes"] or [])))
        lines.append("")
        for item in constraints["must_not_change"] or []:
            lines.append("- 必须保持：%s" % item)
        for item in constraints["negative_constraints"] or []:
            lines.append("- 负向：%s" % item)
        for item in constraints["stitching_post_notes"] or []:
            lines.append("- 拼接：%s" % item)
        for item in digest["limitations"] or []:
            lines.append("- 限制：%s" % item)
        for item in digest["uncertainties"] or []:
            lines.append("- 不确定：%s" % item)
        if digest["warnings"]:
            lines.append("- 验证警告：%s" % "；".join(digest["warnings"]))
        lines.append("")

        # ---- 收尾二：机器包 ----
        machine = digest["machine_package"]
        lines.append("## 机器包")
        lines.append("")
        lines.append("- reverse.json：`%s`" % machine["reverse_json"])
        lines.append("- validation.json：`%s`" % machine["validation_json"])
        lines.append("- 包根目录：`%s`" % machine["root"])
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def volume_note(text: str, packages: int) -> str:
    """Reply-size budget.

    native-output.md §多条视频 tells the agent to split per video when the client
    has a single-response limit, but names no threshold, so it was being judged by
    feel. Print the real bytes and the split becomes a decision, not a guess.
    """
    total = format(len(text.encode("utf-8")), ",")
    if packages < 2:
        return "投影体积 %s 字节。" % total
    # Every per-video block starts at column 0 with "# "; "## " and "### " do not match.
    parts = text.split("\n# ")
    sizes = [len(part.encode("utf-8")) for part in parts]
    detail = " / ".join("第 %d 条 %s" % (index, format(size, ","))
                        for index, size in enumerate(sizes[1:], start=1))
    return ("投影体积 %s 字节（总览 %s / %s）。"
            "单次回复放不下时按条分批，用 --package 单独重跑某一条，不要截断某一条。"
            % (total, format(sizes[0], ","), detail))


def outline(digests: list[dict[str, Any]]) -> str:
    """Everything the five blocks need, in one read.

    Deliberately complete rather than a teaser: the agent that has to compose the
    reply should never need a second pass over reverse.json, so the prompts, the
    verbatim text layer and the uncertainties are all here, not just the skeleton.
    """
    lines: list[str] = []
    for digest in digests:
        head = digest["headline"]
        counts, validation = head["counts"], head["validation"]
        lines.append("=" * 74)
        lines.append("【1 结论】%s  时长 %ss  %s  %s" % (head["file"], head["duration_seconds"],
                                                       head["aspect_ratio"], head["resolution"]))
        lines.append("节拍 %s · 分段 %s · 资产 %s · 验证 valid=%s 硬错误 %s 警告 %s · 分析模式 %s"
                     % (counts["beats"], counts["segments"], counts["assets"],
                        validation["valid"], validation["hard_errors"], validation["warnings"], head["input_mode"]))
        lines.append("骨架：%s" % (head["narrative_structure"] or "未观察到"))
        lines.append("Hook：%s" % (head["hook"] or "未观察到"))
        lines.append("产品桥接：%s" % (head["product_bridge"] or "未观察到"))
        lines.append("证明过程：%s" % (head["proof_process"] or "未观察到"))
        lines.append("CTA：%s" % (head["cta"] or "未观察到"))
        lines.append("语言 %s · 字幕 %s · 音轨 %s" % (head["language"], head["subtitle_type"], digest["audio"]["audio_track"]))
        lines.append("源视频：%s" % source_video_label(head["source_video"]))
        if head["global_prompt"]:
            lines.append("整片提示词：%s" % head["global_prompt"])

        lines.append("")
        lines.append("【2 分段复刻表】")
        for segment in digest["segments"]:
            window = segment["window"]
            lines.append("")
            lines.append("  [%s] %.3f-%.3fs (%.3fs) 镜头 %s"
                         % (segment["segment_id"], window[0], window[1], segment["duration_seconds"],
                            " ".join(segment["shot_ids"] or [])))
            lines.append("    起：%s" % segment["start_state"])
            lines.append("    动作：%s" % segment["key_action"])
            lines.append("    止：%s" % segment["end_state"])
            for frame in segment["frames"]:
                lines.append("    %s %s" % (frame["label"], frame["path"]))
            lines.append("    提示词：%s" % segment["prompt"])
            if segment["seedance_prompt"]:
                lines.append("    Seedance 版：%s" % segment["seedance_prompt"])
            recommendation = segment["recommendation"]
            lines.append("    建议：%s ｜ %s ｜ 目标 %ss ｜ 输入 %s"
                         % (recommendation["model"], recommendation["method"],
                            recommendation["target_duration_seconds"], ", ".join(recommendation["inputs"] or [])))
            lines.append("    依据：%s" % strip_advice_prefix(recommendation["basis"]))

        lines.append("")
        lines.append("【3 资产】%d 项" % len(digest["assets"]))
        for asset in digest["assets"]:
            lines.append("  %s（%s）%s" % (asset["asset_id"], asset["category"], asset["name"] or ""))
            lines.append("    图：%s" % (asset["path"] or "（无截图）"))
            lines.append("    提示词：%s" % (asset["prompt"] or ""))
            if asset["anchors"]:
                lines.append("    一致性锚点：%s" % "；".join(asset["anchors"]))
            lines.append("    禁变：%s" % "；".join(asset["invariants"] or []))

        lines.append("")
        lines.append("【4 文字层】%d 条（后期叠加，逐字）" % len(digest["text_layer"]))
        stats = digest["text_layer_stats"]
        lines.append("  %s" % text_layer_stat_line(stats))
        if stats["sampled_fragment"]:
            lines.append("  %s" % SAMPLED_TEXT_LABEL)
        for entry in digest["text_layer"]:
            window = entry["window"]
            stamp = "%.3f-%.3fs" % (window[0], window[1]) if window and window[0] is not None else "时间未定"
            lines.append("  %s  %s" % (stamp, entry["text"]))

        lines.append("")
        audio = digest["audio"]
        lines.append("【5 音频】")
        for line in audio_lines(audio, head["input_mode"]):
            lines.append("  %s" % line)

        constraints = digest["constraints"]
        lines.append("")
        lines.append("【约束】禁变 %d 条 · 负向 %d 条 · 拼接 %d 条"
                     % (len(constraints["must_not_change"] or []), len(constraints["negative_constraints"] or []),
                        len(constraints["stitching_post_notes"] or [])))
        for item in constraints["must_not_change"] or []:
            lines.append("  必须保持：%s" % item)
        for item in constraints["negative_constraints"] or []:
            lines.append("  负向：%s" % item)
        for item in constraints["stitching_post_notes"] or []:
            lines.append("  拼接：%s" % item)
        for item in digest["limitations"] or []:
            lines.append("  限制：%s" % item)
        for item in digest["uncertainties"] or []:
            lines.append("  不确定：%s" % item)
        if digest["warnings"]:
            lines.append("  验证警告：%s" % "；".join(digest["warnings"]))
        lines.append("  机器包：%s" % digest["machine_package"]["root"])
    return "\n".join(lines)


# ---------------------------------------------------------------- fragment ---
# A media home plus the five blocks of native-output.md as six tabs, so only one
# is tall at a time. The delivery is otherwise ~26 screens for two videos.


def h(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def human_bytes(value: Any) -> str:
    try:
        size = int(value)
    except (TypeError, ValueError):
        return "未记录"
    if size >= 1_000_000:
        return "%.2f MB" % (size / 1_000_000)
    if size >= 1_000:
        return "%.0f KB" % (size / 1_000)
    return "%d B" % size


def thumbnail(path: Any, width: int) -> str | None:
    """Shrink one still to a base64 data URI, or None when it cannot be produced."""
    if not isinstance(path, str) or not Path(path).is_file():
        return None
    with tempfile.TemporaryDirectory() as work:
        out = Path(work) / "t.jpg"
        try:
            done = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", path,
                 "-vf", "scale=%d:-2" % width, "-q:v", str(THUMB_QUALITY), str(out)],
                capture_output=True)
        except (OSError, ValueError):
            return None
        if done.returncode != 0 or not out.is_file():
            return None
        return "data:image/jpeg;base64," + base64.b64encode(out.read_bytes()).decode("ascii")


def probe_preview(path: Path) -> tuple[float | None, bool]:
    """Return duration and whether the derivative actually contains audio."""
    try:
        done = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
             "-of", "json", str(path)],
            capture_output=True, text=True,
        )
        payload = json.loads(done.stdout) if done.returncode == 0 else {}
        duration = float((payload.get("format") or {}).get("duration"))
        has_audio = any(stream.get("codec_type") == "audio" for stream in payload.get("streams") or [])
        return duration, has_audio
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None, False


def video_preview(source: dict[str, Any], encoded_budget: int) -> tuple[dict[str, Any] | None, str]:
    """Create a full-duration data-URI preview that fits the fragment's remaining budget.

    The preview is a disposable presentation derivative. The original path and
    hash in source_manifest.json remain authoritative. If a complete preview
    cannot fit, fail closed instead of truncating the video.
    """
    raw = source.get("path")
    if not source.get("exists") or not isinstance(raw, str):
        return None, "源视频文件不可用"
    try:
        duration = float(source.get("duration_seconds"))
    except (TypeError, ValueError):
        duration = 0.0
    if duration <= 0:
        return None, "源视频时长不可用"
    # Base64 expands bytes by 4/3. The utilization factor leaves room for MP4
    # container overhead and ABR variance; a second pass is the bounded fallback.
    raw_budget = max(0, int((encoded_budget - 256) * 0.75))
    if raw_budget < 48_000:
        return None, "片段剩余媒体预算不足"

    last_reason = "ffmpeg 无法生成完整时长预览"
    for utilization in (0.80, 0.62):
        total_kbps = int(raw_budget * 8 / duration / 1000 * utilization)
        wants_audio = bool(source.get("has_audio")) and total_kbps >= PREVIEW_MIN_VIDEO_KBPS + PREVIEW_AUDIO_KBPS
        audio_kbps = PREVIEW_AUDIO_KBPS if wants_audio else 0
        video_kbps = min(PREVIEW_MAX_VIDEO_KBPS, total_kbps - audio_kbps)
        if video_kbps < PREVIEW_MIN_VIDEO_KBPS:
            last_reason = "完整时长预览无法在 1 MB 内达到最低码率"
            continue
        width = PREVIEW_MAX_WIDTH if video_kbps >= 72 else 192 if video_kbps >= 48 else PREVIEW_MIN_WIDTH
        with tempfile.TemporaryDirectory() as work:
            out = Path(work) / "preview.mp4"
            command = [
                "ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                "-map", "0:v:0",
                # A fixed target width plus -2 preserves aspect ratio and forces an
                # even H.264-compatible height. `force_original_aspect_ratio=decrease`
                # can round 9:16 sources to an odd height (for example 192x341).
                "-vf", "fps=20,scale=%d:-2" % width,
                "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "baseline",
                "-pix_fmt", "yuv420p", "-b:v", "%dk" % video_kbps,
                "-maxrate", "%dk" % max(video_kbps + 8, int(video_kbps * 1.25)),
                "-bufsize", "%dk" % max(96, video_kbps * 2),
                "-g", "40", "-keyint_min", "40", "-sc_threshold", "0",
            ]
            if audio_kbps:
                command.extend(["-map", "0:a:0?", "-c:a", "aac", "-b:a", "%dk" % audio_kbps,
                                "-ac", "1", "-ar", "24000"])
            else:
                command.append("-an")
            command.extend(["-movflags", "+faststart", str(out)])
            try:
                done = subprocess.run(command, capture_output=True)
            except (OSError, ValueError):
                continue
            if done.returncode != 0 or not out.is_file():
                continue
            preview_duration, has_audio = probe_preview(out)
            if preview_duration is None or abs(preview_duration - duration) > max(0.4, duration * 0.02):
                last_reason = "压缩预览时长与源视频不一致，已拒绝嵌入"
                continue
            payload = out.read_bytes()
            uri = "data:video/mp4;base64," + base64.b64encode(payload).decode("ascii")
            if len(uri.encode("ascii")) > encoded_budget:
                last_reason = "压缩预览超出片段剩余预算"
                continue
            return ({
                "uri": uri,
                "raw_bytes": len(payload),
                "encoded_bytes": len(uri.encode("ascii")),
                "duration_seconds": round(preview_duration, 3),
                "width": width,
                "fps": 20,
                "video_kbps": video_kbps,
                "audio_kbps": audio_kbps if has_audio else 0,
                "has_audio": has_audio,
            }, "")
    return None, last_reason


def fragment(digest: dict[str, Any], root_id: str, width: int) -> tuple[str, int]:
    head = digest["headline"]
    counts, validation = head["counts"], head["validation"]
    lines: list[str] = ['<meta charset="utf-8">', '<link rel="icon" href="data:,">']
    add = lines.append
    shots = 0

    tabs = (("m", "原片与帧图"), ("c", "结论"), ("s", "分段 %d" % len(digest["segments"])),
            ("a", "资产 %d" % len(digest["assets"])),
            ("t", "文字层 %d" % len(digest["text_layer"])), ("x", "音频与约束"))
    add('<div id="%s">' % root_id)
    batch = digest.get("_batch_context") or {"index": 1, "total": 1}
    batch_label = ("第 %d／%d 条" % (batch["index"], batch["total"])) if batch["total"] > 1 else "单视频审片"
    validation_label = "验证通过" if validation["valid"] is True else "未验证" if validation["valid"] is None else "验证未通过"
    validation_state = "ok" if validation["valid"] is True else "warn"
    add('<header class="rv-header">')
    add('<div class="rv-kicker"><span>100X · VIDEO REVERSE</span><span>%s</span></div>' % h(batch_label))
    add('<div class="rv-title-row"><div><h1>%s</h1><p>%s</p></div>'
        '<span class="rv-status" data-state="%s">%s</span></div>'
        % (h(head.get("file") or Path(digest["package"]).name),
           h(head.get("overall_style") or "参考视频审片与复刻拆解"), validation_state, h(validation_label)))
    add('<div class="rv-meta" aria-label="视频摘要">'
        '<span><b>%s</b> 时长</span><span><b>%s</b> 画幅</span>'
        '<span><b>%s</b> 节拍</span><span><b>%s</b> 分段</span><span><b>%s</b> 资产</span></div>'
        % (h(trim_number(head.get("duration_seconds")) + "s"), h(head.get("aspect_ratio") or "未知"),
           h(counts["beats"]), h(counts["segments"]), h(counts["assets"])))
    add('</header>')
    add('<div class="viz-controls" role="tablist" aria-label="反推交付分块">')
    for index, (key, label) in enumerate(tabs):
        add('<button type="button" id="%s-tab-%s" class="rv-tab" role="tab" data-tab="%s" '
            'aria-controls="%s-panel-%s" aria-selected="%s" tabindex="%s">%s</button>'
            % (root_id, key, key,
               root_id, key, "true" if not index else "false", "0" if not index else "-1", h(label)))
    add('</div>')

    # Media home: source preview + one already-verified frame per beat.
    source = head.get("source_video") or {}
    storyboard = [item for item in digest.get("storyboard") or [] if item.get("_thumb")]
    # Normalize shot-to-segment links so a segment prompt is embedded only once even
    # when several storyboard shots belong to the same generation segment.
    prompt_segments = {}
    shot_to_segment = {}
    for frame in storyboard:
        segment_id = frame.get("segment_id")
        if not segment_id or not frame.get("segment_prompt"):
            continue
        shot_to_segment[frame["label"]] = segment_id
        prompt_segments.setdefault(segment_id, {
            "adapter": frame.get("segment_prompt_adapter"),
            "prompt": frame.get("segment_prompt"),
        })
    shot_prompts = {"shotToSegment": shot_to_segment, "segments": prompt_segments}
    shot_prompts_json = (json.dumps(shot_prompts, ensure_ascii=False)
                         .replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e"))
    preview = digest.get("_preview_video")
    add('<section id="%s-panel-m" role="tabpanel" aria-labelledby="%s-tab-m" data-panel="m">'
        % (root_id, root_id))
    add('<div class="rv-workbench">')
    add('<div class="rv-stage">')
    add('<div class="rv-player-shell">')
    if preview:
        add('<video controls playsinline preload="metadata" data-review-video aria-label="%s 的完整时长压缩预览">'
            '<source src="%s" type="video/mp4">当前客户端无法播放该预览。</video>'
            % (h(source.get("name") or "源视频"), preview["uri"]))
    else:
        add('<div class="viz-media-fallback"><strong>视频预览不可用</strong><p>%s。</p>'
            '<p>仍可通过右侧节拍帧图审阅，原文件证据保留在下方。</p></div>'
            % h(digest.get("_preview_reason") or "未生成"))
    add('</div>')
    if preview:
        add('<div class="rv-stage-foot"><span>完整时长压缩预览 · %spx · %sfps · %s</span>'
            '<strong data-playhead>00:00.0</strong></div>'
            % (preview["width"], preview["fps"], "含源音轨" if preview["has_audio"] else "无音轨"))
    else:
        add('<div class="rv-stage-foot"><span>原片未嵌入，帧图仍可审阅</span><strong>--:--</strong></div>')
    add('</div>')
    add('<aside class="rv-beats" aria-label="按节拍定位的帧图">')
    add('<div class="rv-beats-head"><div><span>FRAME INDEX</span><strong>节拍定位</strong></div>'
        '<span data-current-beat>%s</span></div>' % (h(storyboard[0]["label"]) if storyboard else "无帧图"))
    if storyboard:
        add('<div class="rv-beat-list">')
        for index, frame in enumerate(storyboard, start=1):
            shots += 1
            role = frame.get("narrative_role") or frame.get("action") or "未记录叙事作用"
            action = frame.get("action") or ""
            add('<button type="button" class="rv-beat" data-beat data-shot="%s" data-at="%s" data-start="%s" data-end="%s" '
                'aria-current="%s" aria-label="镜头 %02d，定位到 %s 并查看所属分段提示词">'
                '<img src="%s" alt="镜头 %02d，%s" loading="lazy">'
                '<span class="rv-beat-copy"><span class="rv-beat-line"><strong>镜头 %02d</strong>'
                '<time>%s</time></span><span class="rv-beat-role">%s</span>%s</span></button>'
                % (h(frame.get("label")), h(trim_number(frame.get("at_seconds"))), h(trim_number(frame.get("start_seconds"))),
                   h(trim_number(frame.get("end_seconds"))), "true" if index == 1 else "false",
                   index, h(clock_time(frame.get("at_seconds"))), frame["_thumb"], index,
                   h(role), index, h(clock_time(frame.get("at_seconds"))), h(role),
                   '<span class="rv-beat-action">%s</span>' % h(action) if action and action != role else ""))
        add('</div>')
    else:
        add('<p class="text-warning">包内没有可嵌入的节拍帧图。</p>')
    add('<script type="application/json" data-shot-prompts>%s</script>' % shot_prompts_json)
    add('<section class="rv-prompt-inspector" data-prompt-inspector data-copy-scope role="region" '
        'aria-label="镜头对应的分段提示词" hidden>')
    add('<div class="rv-inspector-head"><div><span>SEGMENT PROMPT</span><h3 data-inspector-title>镜头提示词</h3></div>'
        '<button type="button" class="btn" data-prompt-close>返回帧板</button></div>')
    add('<p class="rv-inspector-note">生成单位是分段；这里显示该镜头所属分段的完整提示词，不另造镜头级提示词。</p>')
    add('<p class="rv-inspector-meta" data-inspector-meta></p>')
    add('<div class="viz-row"><button type="button" class="btn btn-primary" data-copy>复制提示词</button>'
        '<span class="text-muted text-small" data-copy-note>或直接拖选下方文本</span></div>')
    add('<pre data-prompt><code data-inspector-prompt></code></pre>')
    add('</section>')
    add('</aside></div>')
    add('<details class="rv-source-evidence"><summary><span>源文件证据</span>'
        '<span>%s · %s · %s</span></summary><div class="rv-source-grid">'
        % (h(source.get("name") or head.get("file") or "未记录"),
           h("%s×%s" % (source.get("width") or "?", source.get("height") or "?")),
           h(human_bytes(source.get("size_bytes")))))
    for label, value in (
        ("时长", trim_number(source.get("duration_seconds") or head.get("duration_seconds")) + "s"),
        ("SHA-256", (source.get("sha256") or "未记录")[:16] + ("…" if source.get("sha256") else "")),
    ):
        add('<div><dt>%s</dt><dd>%s</dd></div>' % (h(label), h(value)))
    add('<div class="rv-source-path"><dt>原片路径</dt><dd><code>%s</code></dd></div>'
        % h(source_video_label(source)))
    add('</div></details>')
    add('</section>')

    # 1 结论
    add('<section id="%s-panel-c" role="tabpanel" aria-labelledby="%s-tab-c" data-panel="c" hidden>'
        % (root_id, root_id))
    add('<div class="rv-section-intro"><div><span>CONVERSION FLOW</span><h2>一屏看懂这条视频怎么推进</h2></div>'
        '<p>%s</p></div>' % h(head.get("narrative_structure") or "未记录完整叙事骨架"))
    add('<ol class="rv-story-flow">')
    flow = (("01", "HOOK", "钩子", head.get("hook")),
            ("02", "BRIDGE", "产品桥接", head.get("product_bridge")),
            ("03", "PROOF", "证明过程", head.get("proof_process")),
            ("04", "CTA", "行动引导", head.get("cta")))
    for number, english, label, value in flow:
        add('<li><span class="rv-step-number">%s</span><div><span class="rv-step-label">%s · %s</span>'
            '<p>%s</p></div></li>' % (number, english, h(label), h(value or "未观察到")))
    add('</ol>')
    add('<div class="rv-fact-band">')
    for label, value in (("整体风格", head.get("overall_style") or "未观察到"),
                         ("字幕", head.get("subtitle_type") or "未观察到"),
                         ("语言", head.get("language") or "未识别"),
                         ("分析模式", head.get("input_mode") or "未记录")):
        add('<div><span>%s</span><strong>%s</strong></div>' % (h(label), h(value)))
    add('</div>')
    if head.get("global_prompt"):
        add('<details><summary>整片提示词（逐字）</summary>'
            '<div class="viz-row"><button type="button" class="btn" data-copy>复制</button>'
            '<span class="text-muted text-small" data-copy-note>或拖选下方文本</span></div>'
            '<pre data-prompt><code>%s</code></pre></details>' % h(head["global_prompt"]))
    add('</section>')

    # 2 分段
    add('<section id="%s-panel-s" role="tabpanel" aria-labelledby="%s-tab-s" data-panel="s" hidden>'
        % (root_id, root_id))
    add('<div class="table-responsive"><table class="table table-sm"><thead><tr>'
        '<th>段</th><th>时间</th><th>叙事作用</th><th>模型 / 状态</th><th>生成方式</th>'
        '<th class="text-end">目标</th></tr></thead><tbody>')
    for segment in digest["segments"]:
        rec = segment["recommendation"]
        add('<tr><td class="text-nowrap">%s</td><td class="text-nowrap tabular-nums">%s–%ss</td>'
            '<td>%s</td><td>%s</td><td>%s</td><td class="text-end tabular-nums">%ss</td></tr>'
            % (h(str(segment["segment_id"]).replace("segment_", "")),
               trim_number(segment["window"][0]), trim_number(segment["window"][1]),
               h(segment.get("narrative_role") or ""), h(rec["model"]), h(rec["method"]),
               trim_number(rec["target_duration_seconds"])))
    add('</tbody></table></div>')
    for segment in digest["segments"]:
        rec = segment["recommendation"]
        add('<details><summary>%s · %s–%ss · %s</summary>'
            % (h(segment["segment_id"]), trim_number(segment["window"][0]),
               trim_number(segment["window"][1]), h(segment.get("narrative_role") or "")))
        strip = [frame for frame in segment["frames"] if frame.get("_thumb")]
        if strip:
            add('<div class="viz-row">')
            for frame in strip:
                shots += 1
                add('<figure><img src="%s" alt="%s %s" loading="lazy">'
                    '<figcaption class="text-muted text-small">%s %ss</figcaption></figure>'
                    % (frame["_thumb"], h(segment["segment_id"]), h(frame["label"]),
                       h(frame["label"]), trim_number(frame["at_seconds"])))
            add('</div>')
        add('<table class="table table-sm"><tbody>')
        for label, value in (("起", segment["start_state"]), ("动作", segment["key_action"]),
                             ("止", segment["end_state"]), ("依据", rec["basis"])):
            if value:
                add('<tr><th scope="row" class="text-nowrap">%s</th><td>%s</td></tr>' % (h(label), h(value)))
        add('</tbody></table>')
        add('<div class="viz-row"><button type="button" class="btn btn-primary" data-copy>复制提示词</button>'
            '<span class="text-muted text-small" data-copy-note>或直接拖选下方文本</span></div>')
        add('<pre data-prompt><code>%s</code></pre>' % h(segment["prompt"]))
        add('</details>')
    add('</section>')

    # 3 资产
    add('<section id="%s-panel-a" role="tabpanel" aria-labelledby="%s-tab-a" data-panel="a" hidden>'
        % (root_id, root_id))
    primary = [item for item in digest["assets"] if item["category"] in PRIMARY_ASSET_CATEGORIES]
    secondary = [item for item in digest["assets"] if item["category"] not in PRIMARY_ASSET_CATEGORIES]
    for item in primary:
        add('<details><summary>%s · %s（%s）</summary>'
            % (h(item["asset_id"]), h(item["name"] or ""), h(item["category"])))
        if item.get("_thumb"):
            shots += 1
            add('<img src="%s" alt="%s" loading="lazy">' % (item["_thumb"], h(item["asset_id"])))
        add('<table class="table table-sm"><tbody>')
        if item.get("anchors"):
            add('<tr><th scope="row" class="text-nowrap">一致性锚点</th><td>%s</td></tr>'
                % h("；".join(item["anchors"])))
        if item.get("invariants"):
            add('<tr><th scope="row" class="text-nowrap">禁变</th><td>%s</td></tr>'
                % h("；".join(item["invariants"])))
        add('</tbody></table>')
        add('<div class="viz-row"><button type="button" class="btn" data-copy>复制提示词</button>'
            '<span class="text-muted text-small" data-copy-note>或拖选下方文本</span></div>')
        add('<pre data-prompt><code>%s</code></pre>' % h(item["prompt"] or ""))
        add('</details>')
    if secondary:
        add('<table class="table table-sm"><thead><tr><th>ID</th><th>类目</th><th>名称</th>'
            '</tr></thead><tbody>')
        for item in secondary:
            add('<tr><td>%s</td><td>%s</td><td>%s</td></tr>'
                % (h(item["asset_id"]), h(item["category"]), h(item["name"] or "")))
        add('</tbody></table>')
    add('</section>')

    # 4 文字层
    add('<section id="%s-panel-t" role="tabpanel" aria-labelledby="%s-tab-t" data-panel="t" hidden>'
        % (root_id, root_id))
    stats = digest.get("text_layer_stats") or {}
    if stats:
        add('<p class="text-muted text-small">%s</p>' % h(text_layer_stat_line(stats)))
        if stats.get("sampled_fragment"):
            add('<p class="text-warning">采样片段，非完整字幕轨，不可直接当叠字脚本用。</p>')
    if digest["text_layer"]:
        add('<table class="table table-sm"><thead><tr><th>时间</th><th>逐字原文</th></tr>'
            '</thead><tbody>')
        for entry in digest["text_layer"]:
            add('<tr><td class="text-nowrap tabular-nums">%s</td><td>%s</td></tr>'
                % (h(md_window(entry.get("window"))), h(entry["text"])))
        add('</tbody></table>')
    else:
        add('<p class="text-muted">未观察到屏幕文字。</p>')
    add('</section>')

    # 5 音频与约束
    add('<section id="%s-panel-x" role="tabpanel" aria-labelledby="%s-tab-x" data-panel="x" hidden>'
        % (root_id, root_id))
    for line in audio_lines(digest["audio"], head.get("input_mode")):
        add('<p class="text-muted">%s</p>' % h(line))
    constraints = digest["constraints"]
    for label, items in (("必须保持", constraints.get("must_not_change") or []),
                         ("负向约束", constraints.get("negative_constraints") or []),
                         ("拼接", constraints.get("stitching_post_notes") or []),
                         ("限制", digest.get("limitations") or []),
                         ("不确定", digest.get("uncertainties") or [])):
        if items:
            add('<details><summary>%s（%d）</summary><ul>' % (h(label), len(items)))
            for entry in items:
                add('<li>%s</li>' % h(entry))
            add('</ul></details>')
    add('</section>')

    scope = "#" + root_id
    add('<style>')
    add('html,body{margin:0;background:#f0f0ee;color:#171716}body{padding:0}')
    add(scope + '{--rv-canvas:#f0f0ee;--rv-surface:#fff;--rv-muted:#e8e8e5;--rv-border:rgba(23,23,22,.14);'
        '--rv-border-strong:rgba(23,23,22,.24);--rv-ink:#171716;--rv-sub:#5a5a56;--rv-faint:#72726d;'
        '--rv-accent:#2b7fff;--rv-accent-soft:#eaf2ff;--rv-ok:#1f7a4d;--rv-dark:#101110;--rv-review-h:clamp(500px,64vh,640px);'
        'box-sizing:border-box;min-width:0;padding:22px;background:var(--rv-canvas);color:var(--rv-ink);'
        'font-family:"PingFang SC","Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif;'
        'font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}')
    add(scope + ' *,' + scope + ' *::before,' + scope + ' *::after{box-sizing:border-box}')
    add(scope + ' button,' + scope + ' summary{font:inherit}' + scope + ' button{color:inherit}')
    add(scope + ' [hidden]{display:none!important}' + scope + ' h1,' + scope + ' h2,' + scope + ' p{margin-top:0}')
    add(scope + ' .rv-header{padding:4px 0 18px;border-bottom:1px solid var(--rv-border)}')
    add(scope + ' .rv-kicker{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px;color:var(--rv-faint);'
        'font:600 11px/1.2 ui-monospace,"SFMono-Regular",Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}')
    add(scope + ' .rv-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}')
    add(scope + ' .rv-title-row h1{margin:0 0 4px;font-size:clamp(20px,2.2vw,28px);line-height:1.2;letter-spacing:-.025em;overflow-wrap:anywhere}')
    add(scope + ' .rv-title-row p{max-width:760px;margin:0;color:var(--rv-sub);font-size:13px}')
    add(scope + ' .rv-status{flex:0 0 auto;display:inline-flex;align-items:center;min-height:30px;padding:4px 10px;border:1px solid var(--rv-border-strong);'
        'border-radius:999px;background:var(--rv-surface);font-size:12px;font-weight:700}')
    add(scope + ' .rv-status::before{content:"";width:7px;height:7px;margin-right:7px;border-radius:50%;background:#b26b00}')
    add(scope + ' .rv-status[data-state="ok"]::before{background:var(--rv-ok)}')
    add(scope + ' .rv-meta{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:16px;color:var(--rv-sub);font-size:12px}')
    add(scope + ' .rv-meta span{display:flex;gap:6px;align-items:baseline}' + scope + ' .rv-meta b{color:var(--rv-ink);font:700 13px/1.2 ui-monospace,Consolas,monospace}')
    add(scope + ' .viz-controls{display:flex;gap:20px;overflow-x:auto;border-bottom:1px solid var(--rv-border);scrollbar-width:thin}')
    add(scope + ' .rv-tab{appearance:none;flex:0 0 auto;min-height:48px;padding:0 1px;border:0;border-bottom:2px solid transparent;background:transparent;'
        'color:var(--rv-sub);cursor:pointer;font-size:13px;font-weight:650;white-space:nowrap}')
    add(scope + ' .rv-tab:hover{color:var(--rv-ink)}' + scope + ' .rv-tab[aria-selected="true"]{border-bottom-color:var(--rv-accent);color:var(--rv-ink)}')
    add(scope + ' button:focus-visible,' + scope + ' summary:focus-visible{outline:3px solid color-mix(in srgb,var(--rv-accent) 34%,transparent);outline-offset:2px}')
    add(scope + ' [data-panel]{padding-top:18px}')
    add(scope + ' .rv-workbench{display:grid;grid-template-columns:clamp(300px,26vw,368px) minmax(0,1fr);gap:1px;overflow:hidden;'
        'border:1px solid var(--rv-border-strong);border-radius:14px;background:var(--rv-border-strong)}')
    add(scope + ' .rv-stage{min-width:0;background:var(--rv-dark);color:#ecece8;display:flex;flex-direction:column}')
    add(scope + ' .rv-player-shell{height:var(--rv-review-h);min-height:0;padding:16px;display:grid;place-items:center;background:#090a09}')
    add(scope + ' video{display:block;width:auto;max-width:100%;height:100%;max-height:100%;background:#000;object-fit:contain}')
    add(scope + ' .viz-media-fallback{align-self:stretch;min-height:320px;display:grid;place-content:center;padding:32px;text-align:center;color:#d5d5d0}')
    add(scope + ' .viz-media-fallback strong{font-size:18px;color:#fff}' + scope + ' .viz-media-fallback p{max-width:420px;margin:8px auto 0;color:#aaa9a3}')
    add(scope + ' .rv-stage-foot{min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 16px;border-top:1px solid rgba(255,255,255,.12);'
        'color:#aaa9a3;font:500 11px/1.3 ui-monospace,Consolas,monospace}')
    add(scope + ' .rv-stage-foot span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
    add(scope + ' .rv-stage-foot strong{color:#fff;font-size:12px;font-variant-numeric:tabular-nums}')
    add(scope + ' .rv-beats{min-width:0;max-height:calc(var(--rv-review-h) + 49px);display:grid;grid-template-rows:auto minmax(0,1fr);background:var(--rv-surface)}')
    add(scope + ' .rv-beats-head{min-height:66px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid var(--rv-border)}')
    add(scope + ' .rv-beats-head div{display:grid;gap:2px}' + scope + ' .rv-beats-head div>span{color:var(--rv-faint);font:600 10px/1.1 ui-monospace,Consolas,monospace;letter-spacing:.08em}')
    add(scope + ' .rv-beats-head strong{font-size:15px}' + scope + ' .rv-beats-head>span{max-width:120px;color:var(--rv-sub);font:600 11px/1.3 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}')
    add(scope + ' .rv-beat-list{min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:1px;align-content:start;overflow-y:auto;background:var(--rv-border);scrollbar-width:thin}')
    add(scope + ' .rv-beat{appearance:none;width:100%;min-height:110px;display:grid;grid-template-columns:76px minmax(0,1fr);gap:11px;align-items:center;padding:9px 10px;'
        'border:0;background:var(--rv-surface);text-align:left;cursor:pointer}')
    add(scope + ' .rv-beat:hover{background:#f6f6f3}' + scope + ' .rv-beat[aria-current="true"]{position:relative;background:var(--rv-accent-soft);box-shadow:inset 0 0 0 2px var(--rv-accent)}')
    add(scope + ' .rv-beat img{width:76px;height:92px;display:block;border-radius:4px;background:#d9d9d5;object-fit:cover}')
    add(scope + ' .rv-beat-copy{min-width:0;display:grid;gap:4px}' + scope + ' .rv-beat-line{display:flex;align-items:baseline;justify-content:space-between;gap:8px}')
    add(scope + ' .rv-beat-line strong{font-size:12px}' + scope + ' .rv-beat-line time{color:var(--rv-faint);font:600 11px/1 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}')
    add(scope + ' .rv-beat-role,' + scope + ' .rv-beat-action{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical}')
    add(scope + ' .rv-beat-role{-webkit-line-clamp:2;font-size:12px;line-height:1.45}' + scope + ' .rv-beat-action{-webkit-line-clamp:1;color:var(--rv-faint);font-size:11px}')
    add(scope + ' .rv-prompt-inspector{grid-row:2;min-height:0;overflow:auto;padding:18px;background:var(--rv-surface)}')
    add(scope + ' .rv-inspector-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding-bottom:14px;border-bottom:1px solid var(--rv-border)}')
    add(scope + ' .rv-inspector-head>div{min-width:0}' + scope + ' .rv-inspector-head span{color:var(--rv-faint);font:600 10px/1.1 ui-monospace,Consolas,monospace}')
    add(scope + ' .rv-inspector-head h3{margin:5px 0 0;font-size:19px;line-height:1.25;letter-spacing:-.02em}')
    add(scope + ' .rv-inspector-note{max-width:760px;margin:14px 0 6px;color:var(--rv-sub);font-size:12px}')
    add(scope + ' .rv-inspector-meta{margin:0;color:var(--rv-faint);font:600 11px/1.4 ui-monospace,Consolas,monospace}')
    add(scope + ' .rv-prompt-inspector pre{max-height:360px;margin:10px 0 0}')
    add(scope + ' .rv-source-evidence{margin-top:10px;border:1px solid var(--rv-border);border-radius:8px;background:var(--rv-surface)}')
    add(scope + ' .rv-source-evidence>summary{min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 12px;cursor:pointer;list-style-position:inside}')
    add(scope + ' .rv-source-evidence>summary span:last-child{color:var(--rv-sub);font-size:12px;text-align:right}')
    add(scope + ' .rv-source-grid{display:grid;grid-template-columns:140px 220px minmax(0,1fr);gap:12px;padding:12px;border-top:1px solid var(--rv-border)}')
    add(scope + ' .rv-source-grid>div{min-width:0}' + scope + ' .rv-source-grid dt{margin-bottom:4px;color:var(--rv-faint);font-size:11px}')
    add(scope + ' .rv-source-grid dd{margin:0;overflow-wrap:anywhere}' + scope + ' .rv-source-path code{font:11px/1.5 ui-monospace,Consolas,monospace;white-space:normal}')
    add(scope + ' .rv-section-intro{display:grid;grid-template-columns:minmax(0,.8fr) minmax(280px,1.2fr);gap:32px;align-items:end;padding:8px 0 18px}')
    add(scope + ' .rv-section-intro span{color:var(--rv-faint);font:600 10px/1.1 ui-monospace,Consolas,monospace;letter-spacing:.08em}')
    add(scope + ' .rv-section-intro h2{margin:5px 0 0;font-size:22px;line-height:1.25;letter-spacing:-.02em}' + scope + ' .rv-section-intro p{margin:0;color:var(--rv-sub)}')
    add(scope + ' .rv-story-flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;padding:0;border:1px solid var(--rv-border-strong);border-radius:10px;background:var(--rv-surface);list-style:none;overflow:hidden}')
    add(scope + ' .rv-story-flow li{min-height:180px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;gap:28px;border-left:1px solid var(--rv-border)}')
    add(scope + ' .rv-story-flow li:first-child{border-left:0}' + scope + ' .rv-step-number{color:var(--rv-accent);font:700 12px/1 ui-monospace,Consolas,monospace}')
    add(scope + ' .rv-step-label{display:block;margin-bottom:7px;color:var(--rv-faint);font:600 10px/1.1 ui-monospace,Consolas,monospace;letter-spacing:.04em}')
    add(scope + ' .rv-story-flow p{margin:0;font-size:13px;line-height:1.58}')
    add(scope + ' .rv-fact-band{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:12px;border-top:1px solid var(--rv-border);border-bottom:1px solid var(--rv-border)}')
    add(scope + ' .rv-fact-band>div{padding:12px 14px;border-left:1px solid var(--rv-border)}' + scope + ' .rv-fact-band>div:first-child{border-left:0}')
    add(scope + ' .rv-fact-band span{display:block;margin-bottom:4px;color:var(--rv-faint);font-size:10px}' + scope + ' .rv-fact-band strong{font-size:12px;font-weight:650}')
    add(scope + ' .table-responsive{max-width:100%;overflow:auto}' + scope + ' .table{width:100%;border-collapse:collapse;background:var(--rv-surface)}')
    add(scope + ' .table th,' + scope + ' .table td{padding:11px 12px;border-bottom:1px solid var(--rv-border);text-align:left;vertical-align:top}'
        + scope + ' .table thead th{color:var(--rv-faint);font-size:11px;font-weight:650}')
    add(scope + ' .table-sm th,' + scope + ' .table-sm td{padding:9px 10px}' + scope + ' th[scope="row"]{width:1%;color:var(--rv-faint);font-weight:500;white-space:nowrap}')
    add(scope + ' .text-muted{color:var(--rv-sub)}' + scope + ' .text-warning{color:#8a5700}' + scope + ' .text-small{font-size:12px}' + scope + ' .text-end{text-align:right!important}')
    add(scope + ' .text-nowrap{white-space:nowrap}' + scope + ' .tabular-nums{font-variant-numeric:tabular-nums}')
    add(scope + ' .viz-row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;margin:10px 0}')
    add(scope + ' figure{margin:0}' + scope + ' .viz-row figure{flex:0 1 160px}' + scope + ' figure img,' + scope + ' details>img{display:block;width:100%;max-width:180px;height:auto;border-radius:4px}')
    add(scope + ' details:not(.rv-source-evidence){border-bottom:1px solid var(--rv-border);padding:8px 0}' + scope + ' details:not(.rv-source-evidence)>summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:650}')
    add(scope + ' pre{max-height:520px;overflow:auto;white-space:pre-wrap;word-break:break-word;padding:14px;border:1px solid var(--rv-border);border-radius:6px;background:#e9e9e6;color:var(--rv-ink);font:12px/1.65 ui-monospace,Consolas,monospace}')
    add(scope + ' .btn{appearance:none;min-height:44px;padding:7px 12px;border:1px solid var(--rv-border-strong);border-radius:5px;background:var(--rv-surface);cursor:pointer;font-size:12px;font-weight:650}')
    add(scope + ' .btn:hover{background:#f5f5f2}' + scope + ' .btn-primary{border-color:var(--rv-ink);background:var(--rv-ink);color:#fff}' + scope + ' .btn-primary:hover{background:#31312f}')
    add(scope + ' .btn:disabled{opacity:.48;cursor:not-allowed}')
    add(scope + ' ul{padding-left:22px}')
    add('@media (max-width:820px){' + scope + '{padding:14px}' + scope + ' .rv-workbench{grid-template-columns:1fr}'
        + scope + ' .rv-player-shell{height:min(68vh,600px);min-height:420px;padding:10px}'
        + scope + ' .rv-beats{max-height:none;grid-template-rows:auto auto}' + scope + ' .rv-beat-list{display:flex;overflow-x:auto;overflow-y:hidden;background:transparent;scroll-snap-type:x proximity}'
        + scope + ' .rv-beat{flex:0 0 270px;scroll-snap-align:start;border-right:1px solid var(--rv-border);border-bottom:0}'
        + scope + ' .rv-beat[aria-current="true"]{box-shadow:inset 0 3px var(--rv-accent)}'
        + scope + ' .rv-source-grid{grid-template-columns:1fr 1fr}' + scope + ' .rv-source-path{grid-column:1/-1}'
        + scope + ' .rv-section-intro{grid-template-columns:1fr;gap:10px}' + scope + ' .rv-story-flow{grid-template-columns:1fr 1fr}'
        + scope + ' .rv-story-flow li:nth-child(3){border-left:0;border-top:1px solid var(--rv-border)}' + scope + ' .rv-story-flow li:nth-child(4){border-top:1px solid var(--rv-border)}'
        + scope + ' .rv-fact-band{grid-template-columns:1fr 1fr}' + scope + ' .rv-fact-band>div:nth-child(3){border-left:0;border-top:1px solid var(--rv-border)}'
        + scope + ' .rv-fact-band>div:nth-child(4){border-top:1px solid var(--rv-border)}}')
    add('@media (max-width:520px){' + scope + '{padding:10px}' + scope + ' .rv-title-row{display:block}' + scope + ' .rv-status{margin-top:12px}'
        + scope + ' .rv-meta{gap:8px 14px}' + scope + ' .viz-controls{gap:18px}' + scope + ' .rv-source-evidence>summary{align-items:flex-start;flex-direction:column;gap:2px}'
        + scope + ' .rv-source-evidence>summary span:last-child{text-align:left}' + scope + ' .rv-source-grid{grid-template-columns:1fr}' + scope + ' .rv-source-path{grid-column:auto}'
        + scope + ' .rv-story-flow{grid-template-columns:1fr}' + scope + ' .rv-story-flow li{min-height:0;border-left:0;border-top:1px solid var(--rv-border);gap:16px}'
        + scope + ' .rv-story-flow li:first-child{border-top:0}' + scope + ' .rv-fact-band{grid-template-columns:1fr}' + scope + ' .rv-fact-band>div{border-left:0;border-top:1px solid var(--rv-border)}'
        + scope + ' .rv-fact-band>div:first-child{border-top:0}}')
    add('</style>')

    add('<script>')
    add('(function () {')
    add('  var root = document.getElementById(%s);' % json.dumps(root_id))
    add('  if (!root) return;')
    add('  var tabs = root.querySelectorAll("[data-tab]");')
    add('  var activate = function (btn, moveFocus) {')
    add('    var key = btn.getAttribute("data-tab");')
    add('    tabs.forEach(function (other) {')
    add('      var on = other === btn;')
    add('      other.setAttribute("aria-selected", on ? "true" : "false");')
    add('      other.setAttribute("tabindex", on ? "0" : "-1");')
    add('    });')
    add('    root.querySelectorAll("[data-panel]").forEach(function (panel) {')
    add('      panel.hidden = panel.getAttribute("data-panel") !== key;')
    add('    });')
    add('    if (key !== "m") root.querySelectorAll("video").forEach(function (video) { video.pause(); });')
    add('    if (moveFocus) btn.focus();')
    add('  };')
    add('  tabs.forEach(function (btn) {')
    add('    btn.addEventListener("click", function () {')
    add('      activate(btn, false);')
    add('    });')
    add('    btn.addEventListener("keydown", function (event) {')
    add('      var keys = ["ArrowLeft", "ArrowRight", "Home", "End"];')
    add('      if (keys.indexOf(event.key) < 0) return;')
    add('      event.preventDefault();')
    add('      var index = Array.prototype.indexOf.call(tabs, btn);')
    add('      if (event.key === "Home") index = 0;')
    add('      else if (event.key === "End") index = tabs.length - 1;')
    add('      else if (event.key === "ArrowLeft") index = (index - 1 + tabs.length) % tabs.length;')
    add('      else index = (index + 1) % tabs.length;')
    add('      activate(tabs[index], true);')
    add('    });')
    add('  });')
    add('  var reviewVideo = root.querySelector("[data-review-video]");')
    add('  var beats = Array.prototype.slice.call(root.querySelectorAll("[data-beat]"));')
    add('  var playhead = root.querySelector("[data-playhead]");')
    add('  var currentBeat = root.querySelector("[data-current-beat]");')
    add('  var beatList = root.querySelector(".rv-beat-list");')
    add('  var inspector = root.querySelector("[data-prompt-inspector]");')
    add('  var inspectorTitle = root.querySelector("[data-inspector-title]");')
    add('  var inspectorMeta = root.querySelector("[data-inspector-meta]");')
    add('  var inspectorPrompt = root.querySelector("[data-inspector-prompt]");')
    add('  var inspectorClose = root.querySelector("[data-prompt-close]");')
    add('  var shotPrompts = {};')
    add('  try {')
    add('    var promptData = root.querySelector("[data-shot-prompts]");')
    add('    shotPrompts = promptData ? JSON.parse(promptData.textContent) : {};')
    add('  } catch (err) { shotPrompts = {}; }')
    add('  var formatClock = function (value) {')
    add('    if (!isFinite(value)) return "--:--";')
    add('    var minutes = Math.floor(Math.max(0, value) / 60);')
    add('    var seconds = Math.max(0, value) - minutes * 60;')
    add('    return String(minutes).padStart(2, "0") + ":" + seconds.toFixed(1).padStart(4, "0");')
    add('  };')
    add('  var showPrompt = function (beat, moveFocus) {')
    add('    if (!beat || !inspector || !beatList) return;')
    add('    var shot = beat.getAttribute("data-shot");')
    add('    var segmentId = (shotPrompts.shotToSegment || {})[shot];')
    add('    var data = (shotPrompts.segments || {})[segmentId] || {};')
    add('    var title = beat.querySelector(".rv-beat-line strong");')
    add('    inspectorTitle.textContent = (title ? title.textContent : shot || "当前镜头") + " · 对应提示词";')
    add('    inspectorMeta.textContent = segmentId ? segmentId + " · " + String(data.adapter || "omni").toUpperCase() : "未映射到生成分段";')
    add('    inspectorPrompt.textContent = data.prompt || "该镜头没有可用的分段提示词。";')
    add('    var copyButton = inspector.querySelector("[data-copy]");')
    add('    if (copyButton) copyButton.disabled = !data.prompt;')
    add('    beatList.hidden = true;')
    add('    inspector.hidden = false;')
    add('    inspector.scrollTop = 0;')
    add('    if (moveFocus && inspectorClose) inspectorClose.focus();')
    add('  };')
    add('  var closePrompt = function () {')
    add('    if (!inspector || !beatList) return;')
    add('    inspector.hidden = true;')
    add('    beatList.hidden = false;')
    add('    var selected = root.querySelector("[data-beat][aria-current=true]");')
    add('    if (selected) selected.focus();')
    add('  };')
    add('  if (inspectorClose) inspectorClose.addEventListener("click", closePrompt);')
    add('  root.addEventListener("keydown", function (event) {')
    add('    if (event.key === "Escape" && inspector && !inspector.hidden) closePrompt();')
    add('  });')
    add('  var markBeat = function (selected) {')
    add('    if (!selected) return;')
    add('    var previous = root.querySelector("[data-beat][aria-current=true]");')
    add('    beats.forEach(function (beat) { beat.setAttribute("aria-current", beat === selected ? "true" : "false"); });')
    add('    if (currentBeat) {')
    add('      var title = selected.querySelector(".rv-beat-line strong");')
    add('      currentBeat.textContent = title ? title.textContent : "当前节拍";')
    add('    }')
    add('    if (inspector && !inspector.hidden) showPrompt(selected, false);')
    add('    if (previous !== selected && (!inspector || inspector.hidden) && selected.scrollIntoView) selected.scrollIntoView({block:"nearest", inline:"nearest"});')
    add('  };')
    add('  beats.forEach(function (beat) {')
    add('    beat.addEventListener("click", function () {')
    add('      markBeat(beat);')
    add('      showPrompt(beat, true);')
    add('      if (!reviewVideo) return;')
    add('      reviewVideo.pause();')
    add('      var at = Number(beat.getAttribute("data-at"));')
    add('      if (isFinite(at)) reviewVideo.currentTime = Math.max(0, at);')
    add('    });')
    add('  });')
    add('  if (reviewVideo) {')
    add('    var firstFrame = root.querySelector("[data-beat] img");')
    add('    if (firstFrame && !reviewVideo.poster) reviewVideo.poster = firstFrame.src;')
    add('    var syncBeat = function () {')
    add('      var now = reviewVideo.currentTime || 0;')
    add('      if (playhead) playhead.textContent = formatClock(now);')
    add('      var selected = beats.find(function (beat, index) {')
    add('        var start = Number(beat.getAttribute("data-start"));')
    add('        var end = Number(beat.getAttribute("data-end"));')
    add('        return isFinite(start) && now >= start && (isFinite(end) ? now < end : index === beats.length - 1);')
    add('      });')
    add('      if (!selected && beats.length && now >= Number(beats[beats.length - 1].getAttribute("data-start"))) selected = beats[beats.length - 1];')
    add('      markBeat(selected);')
    add('    };')
    add('    reviewVideo.addEventListener("timeupdate", syncBeat);')
    add('    reviewVideo.addEventListener("seeked", syncBeat);')
    add('  }')
    # The surface runs this in sandbox="allow-scripts" with no allow-same-origin, so the
    # origin is opaque and navigator.clipboard.writeText rejects with NotAllowedError.
    # Measured: the legacy execCommand path still works there, so it is the real mechanism.
    add('  var legacyCopy = function (text) {')
    add('    try {')
    add('      var priorFocus = document.activeElement;')
    add('      var area = document.createElement("textarea");')
    add('      area.value = text;')
    add('      area.setAttribute("readonly", "");')
    add('      area.style.position = "absolute";')
    add('      area.style.left = "-9999px";')
    add('      root.appendChild(area);')
    add('      area.select();')
    add('      var ok = document.execCommand("copy");')
    add('      area.remove();')
    add('      if (priorFocus && priorFocus.focus) priorFocus.focus();')
    add('      return ok;')
    add('    } catch (err) { return false; }')
    add('  };')
    add('  root.querySelectorAll("[data-copy]").forEach(function (btn) {')
    add('    var label = btn.textContent;')
    add('    btn.addEventListener("click", function () {')
    add('      var box = btn.closest("[data-copy-scope]") || btn.closest("details") || root;')
    add('      var block = box.querySelector("[data-prompt]");')
    add('      if (!block) return;')
    add('      var text = block.innerText;')
    add('      var note = box.querySelector("[data-copy-note]");')
    add('      var done = function (ok) {')
    add('        btn.textContent = ok ? "已复制 ✓" : "复制失败，请拖选";')
    add('        if (note && !ok) note.textContent = "请拖选下方文本手动复制";')
    add('        setTimeout(function () { btn.textContent = label; }, 2000);')
    add('      };')
    # execCommand first, on purpose. The modern API is blocked by the surface's
    # permissions policy and every attempt logs a console error, while execCommand
    # measurably works here. The modern call stays as the fallback so this keeps
    # working if a host ever drops execCommand.
    add('      if (legacyCopy(text)) { done(true); return; }')
    add('      if (navigator.clipboard && navigator.clipboard.writeText) {')
    add('        navigator.clipboard.writeText(text).then(')
    add('          function () { done(true); }, function () { done(false); });')
    add('      } else { done(false); }')
    add('    });')
    add('  });')
    add('})();')
    add('</script>')
    add('</div>')
    return "\n".join(lines), shots


def batch_fragment(digests: list[dict[str, Any]], root_id: str) -> str:
    """A visual batch index; each package still owns an independent detail fragment."""
    passed = sum(1 for digest in digests if digest["headline"]["validation"]["valid"] is True)
    total_duration = sum(float(digest["headline"].get("duration_seconds") or 0) for digest in digests)
    lines = ['<meta charset="utf-8">', '<link rel="icon" href="data:,">', '<div id="%s">' % root_id]
    add = lines.append
    add('<header class="rv-batch-head"><div class="rv-batch-kicker">100X · REVERSE BATCH</div>'
        '<div class="rv-batch-title"><div><h1>%d 条参考视频</h1>'
        '<p>这是批次导航。下方将按 01 → %02d 依次展开，每条视频保留独立的原片、帧图、分段和提示词。</p></div>'
        '<dl><div><dt>总时长</dt><dd>%s</dd></div><div><dt>验证通过</dt><dd>%d/%d</dd></div></dl></div></header>'
        % (len(digests), len(digests), h(trim_number(total_duration) + "s"), passed, len(digests)))
    add('<div class="rv-batch-list" aria-label="批次视频顺序">')
    for index, digest in enumerate(digests, start=1):
        head = digest["headline"]
        counts, validation = head["counts"], head["validation"]
        if validation["valid"] is True:
            verdict = "通过"
            state = "ok"
        elif validation["valid"] is None:
            verdict = "未验证"
            state = "warn"
        else:
            verdict = "未通过 · 硬错误 %s" % validation["hard_errors"]
            state = "warn"
        first_frame = next((frame.get("_thumb") for frame in (digest.get("storyboard") or []) if frame.get("_thumb")), None)
        add('<article class="rv-batch-item"><div class="rv-batch-number">%02d</div>' % index)
        if first_frame:
            add('<img src="%s" alt="第 %02d 条视频首个节拍帧" loading="lazy">' % (first_frame, index))
        else:
            add('<div class="rv-batch-placeholder" aria-label="没有可用帧图">NO FRAME</div>')
        add('<div class="rv-batch-copy"><div class="rv-batch-row"><div><h2>%s</h2>'
            '<span class="rv-package-name">包：%s</span></div>'
            '<span class="rv-batch-status" data-state="%s">%s</span></div>'
            '<p>%ss · %s · %s 个节拍 · %s 个分段 · %s 项资产</p>'
            '<p class="rv-batch-note">对应下方第 %d 个视频片段%s</p></div></article>'
            % (h(head.get("file") or digest["package"]), h(Path(digest["package"]).name), state, h(verdict),
               h(trim_number(head.get("duration_seconds"))), h(head.get("aspect_ratio") or "画幅未知"),
               h(counts["beats"]), h(counts["segments"]), h(counts["assets"]), index,
               " · %s 条警告" % h(validation["warnings"]) if validation["warnings"] else ""))
    add('</div>')
    scope = "#" + root_id
    add('<style>')
    add('html,body{margin:0;background:#f0f0ee;color:#171716}body{padding:0}')
    add(scope + '{--ink:#171716;--sub:#5a5a56;--faint:#72726d;--surface:#fff;--canvas:#f0f0ee;--border:rgba(23,23,22,.14);'
        '--accent:#2b7fff;box-sizing:border-box;padding:22px;background:var(--canvas);color:var(--ink);font-family:"PingFang SC","Microsoft YaHei UI",system-ui,sans-serif;font-size:14px;line-height:1.5}')
    add(scope + ' *,' + scope + ' *::before,' + scope + ' *::after{box-sizing:border-box}')
    add(scope + ' .rv-batch-head{padding:4px 0 22px;border-bottom:1px solid var(--border)}')
    add(scope + ' .rv-batch-kicker{margin-bottom:12px;color:var(--faint);font:600 11px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.08em}')
    add(scope + ' .rv-batch-title{display:flex;justify-content:space-between;align-items:flex-end;gap:32px}'
        + scope + ' h1{margin:0 0 7px;font-size:28px;line-height:1.15;letter-spacing:-.03em}' + scope + ' p{margin:0;color:var(--sub)}')
    add(scope + ' .rv-batch-title>div{max-width:740px}' + scope + ' dl{display:flex;gap:26px;margin:0;flex:0 0 auto}')
    add(scope + ' dl div{display:grid;gap:3px}' + scope + ' dt{color:var(--faint);font-size:10px}' + scope + ' dd{margin:0;font:700 18px/1.1 ui-monospace,Consolas,monospace}')
    add(scope + ' .rv-batch-list{display:grid;gap:0;margin-top:16px;border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden}')
    add(scope + ' .rv-batch-item{min-width:0;display:grid;grid-template-columns:54px 86px minmax(0,1fr);gap:14px;align-items:center;padding:12px 16px;border-top:1px solid var(--border)}')
    add(scope + ' .rv-batch-item:first-child{border-top:0}' + scope + ' .rv-batch-number{color:var(--accent);font:700 13px/1 ui-monospace,Consolas,monospace}')
    add(scope + ' .rv-batch-item>img,' + scope + ' .rv-batch-placeholder{width:86px;height:100px;display:grid;place-items:center;border-radius:4px;background:#e4e4e0;object-fit:cover}')
    add(scope + ' .rv-batch-placeholder{color:var(--faint);font:600 9px/1 ui-monospace,Consolas,monospace;letter-spacing:.06em}')
    add(scope + ' .rv-batch-copy{min-width:0}' + scope + ' .rv-batch-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}')
    add(scope + ' h2{margin:0 0 8px;font-size:16px;line-height:1.35;overflow-wrap:anywhere}' + scope + ' .rv-batch-copy>p{font-size:12px}')
    add(scope + ' .rv-package-name{display:block;margin:-4px 0 8px;color:var(--faint);font:500 10px/1.3 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}')
    add(scope + ' .rv-batch-note{margin-top:8px!important;color:var(--faint)!important;font-size:11px!important}')
    add(scope + ' .rv-batch-status{flex:0 0 auto;display:inline-flex;align-items:center;min-height:28px;padding:3px 9px;border:1px solid var(--border);border-radius:999px;font-size:11px;font-weight:700}')
    add(scope + ' .rv-batch-status::before{content:"";width:6px;height:6px;margin-right:6px;border-radius:50%;background:#b26b00}' + scope + ' .rv-batch-status[data-state="ok"]::before{background:#1f7a4d}')
    add('@media(max-width:620px){' + scope + '{padding:12px}' + scope + ' .rv-batch-title{display:block}' + scope + ' dl{margin-top:18px}'
        + scope + ' .rv-batch-item{grid-template-columns:34px 64px minmax(0,1fr);gap:10px;padding:10px}' + scope + ' .rv-batch-item>img,' + scope + ' .rv-batch-placeholder{width:64px;height:78px}'
        + scope + ' .rv-batch-row{display:block}' + scope + ' .rv-batch-status{margin-bottom:7px}' + scope + ' h1{font-size:23px}}')
    add('</style>')
    add('</div>')
    return "\n".join(lines)


def batch_fragment_stem(digests: list[dict[str, Any]]) -> str:
    payload = "\n".join(str(Path(digest["package"]).resolve()) for digest in digests)
    suffix = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:8]
    return "reverse-batch-%s-%s" % (suffix, FRAGMENT_PRESENTATION_VERSION)


def write_fragments(digests: list[dict[str, Any]], target: Path, width: int) -> list[dict[str, Any]]:
    target.mkdir(parents=True, exist_ok=True)
    written: list[dict[str, Any]] = []
    total = len(digests)
    # Prepare the shared presentation projection first. The batch index can then
    # reuse each video's first verified beat frame without opening package media
    # a second time, and every detail fragment carries the same sequence label.
    for index, digest in enumerate(digests, start=1):
        digest["_batch_context"] = {"index": index, "total": total}
        for segment in digest["segments"]:
            for frame in segment["frames"]:
                frame["_thumb"] = thumbnail(frame.get("path"), width)
        for item in digest["assets"]:
            if item["category"] in PRIMARY_ASSET_CATEGORIES:
                item["_thumb"] = thumbnail(item.get("path"), width)
        for frame in digest.get("storyboard") or []:
            frame["_thumb"] = thumbnail(frame.get("path"), min(width, STORYBOARD_WIDTH))
    if len(digests) > 1:
        stem = batch_fragment_stem(digests)
        root_id = "hf-" + stem
        body = batch_fragment(digests, root_id)
        batch_stills = sum(1 for digest in digests
                           if any(frame.get("_thumb") for frame in (digest.get("storyboard") or [])))
        path = (target / (stem + ".html")).resolve()
        path.write_text(body, encoding="utf-8")
        parts = [part.lower() for part in path.parts]
        written.append({
            "kind": "batch",
            "file": "批次总览（%d 条）" % len(digests),
            "path": str(path),
            "bytes": len(body.encode("utf-8")),
            "stills": batch_stills,
            "preview": False,
            "preview_bytes": 0,
            "preview_reason": "",
            "in_thread_dir": all(marker in parts for marker in THREAD_VIS_MARKER),
        })
    for index, digest in enumerate(digests, start=1):
        stem = fragment_stem(Path(digest["package"]))
        stable_id = hashlib.sha256(digest["package"].encode("utf-8")).hexdigest()[:8]
        root_id = "hf-reverse-%d-%s" % (index, stable_id)
        digest["_preview_video"] = None
        digest["_preview_reason"] = "视频预览尚未生成"
        base_body, _ = fragment(digest, root_id, width)
        remaining = FRAGMENT_BUDGET_BYTES - len(base_body.encode("utf-8")) - FRAGMENT_MEDIA_HEADROOM_BYTES
        preview, reason = video_preview(digest["headline"].get("source_video") or {}, remaining)
        digest["_preview_video"] = preview
        digest["_preview_reason"] = reason
        body, shots = fragment(digest, root_id, width)
        if preview and len(body.encode("utf-8")) > FRAGMENT_BUDGET_BYTES:
            digest["_preview_video"] = None
            digest["_preview_reason"] = "压缩预览仍使片段超出 1 MB，已拒绝嵌入"
            preview = None
            body, shots = fragment(digest, root_id, width)
        path = (target / (stem + ".html")).resolve()
        path.write_text(body, encoding="utf-8")
        parts = [p.lower() for p in path.parts]
        in_thread = all(m in parts for m in THREAD_VIS_MARKER)
        written.append({"kind": "video", "file": digest["headline"]["file"] or stem, "path": str(path),
                        "bytes": len(body.encode("utf-8")), "stills": shots,
                        "preview": bool(preview), "preview_bytes": preview["raw_bytes"] if preview else 0,
                        "preview_reason": digest["_preview_reason"], "in_thread_dir": in_thread})
    return written


def fragment_stem(package: Path) -> str:
    """Return a stable ASCII filename stem accepted by the inline visualizer.

    Package directories commonly inherit the source filename and may contain
    Chinese characters. Codex resolves the directive as a file read request and
    rejects non-ASCII names, so never use the raw package stem here.
    """
    raw = unicodedata.normalize("NFKD", package.name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", raw).strip("-").lower()
    if not slug:
        slug = "reverse"
    if slug != "reverse" and not slug.startswith("reverse-"):
        slug = "reverse-" + slug
    suffix = hashlib.sha256(str(package.resolve()).encode("utf-8")).hexdigest()[:8]
    return f"{slug}-{suffix}-{FRAGMENT_PRESENTATION_VERSION}"


def main() -> None:
    args = parse_args()
    packages = [item.expanduser().resolve() for item in args.package]
    if args.out_root:
        root = args.out_root.expanduser().resolve()
        if (root / "reverse.json").is_file():
            packages.append(root)
        else:
            packages.extend(sorted(child for child in root.iterdir()
                                   if child.is_dir() and (child / "reverse.json").is_file()))
    if not packages:
        fail("Pass --package (repeatable) or --out-root.")
    seen: list[Path] = []
    for package in packages:
        if package not in seen:
            seen.append(package)
    digests = [digest_package(package) for package in seen]
    if args.json:
        print(json.dumps({"ok": True, "packages": len(digests), "digests": digests}, ensure_ascii=False, indent=2))
    elif args.format == "fragment":
        if args.fragment_dir:
            target = args.fragment_dir.expanduser().resolve()
        elif args.out_root:
            target = args.out_root.expanduser().resolve() / "fragments"
        else:
            target = seen[0].parent / "fragments"
        written = write_fragments(digests, target, args.thumb_width)
        for item in written:
            note = ""
            if item["bytes"] > FRAGMENT_BUDGET_BYTES:
                note = "  ← 超出 1 MB 上限，降低 --thumb-width 重跑"
            elif item["bytes"] > FRAGMENT_WARN_BYTES:
                note = "  ← 接近 1 MB 上限"
            if item["kind"] == "batch":
                media = "批次导航 · 内嵌 %d 张首帧" % item["stills"]
            elif item["preview"]:
                media = "内嵌 %d 张缩略图 + 完整时长视频预览 %s" % (
                    item["stills"], human_bytes(item["preview_bytes"]))
            else:
                media = "内嵌 %d 张缩略图 · 视频未内嵌（%s）" % (
                    item["stills"], item["preview_reason"] or "未生成")
            print("%s  %.0f KB · %s%s" % (item["file"], item["bytes"] / 1024, media, note))
            print(item["path"])
        if any(item["kind"] == "video" and item["stills"] == 0 for item in written):
            print("有包一张缩略图都没内嵌：确认 ffmpeg 可用，且包内媒体已物化。", file=sys.stderr)
        print()
        # The directive below is the one this client actually renders. The bundled
        # visualize plugin documents `visualize{"path":"<abs>"}`, but that form was
        # emitted in three real sessions here and never rendered once - it just shows
        # up as literal text. Every rendered visualization on this machine used
        # `::codex-inline-vis{file="<name>"}` with a BARE FILENAME, resolved against
        # the thread visualization directory. Hence the location check.
        outside = [item for item in written if not item["in_thread_dir"]]
        if outside:
            print()
            print("警告：片段不在 thread 可视化目录下，内联指令按裸文件名解析，很可能不渲染。")
            print("      用 --fragment-dir 指到本轮的 %s/<年>/<月>/<日>/<thread-id>/ 重跑。"
                  % THREAD_VIS_ROOT_HINT)
        print()
        print("按顺序照抄下面每一行发出（多视频时批次总览在前；单独成行，不加 Markdown 链接）：")
        for item in written:
            print('::codex-inline-vis{file="%s"}' % Path(item["path"]).name)
    elif args.format == "text":
        print(outline(digests))
        print("\n完整数据（含全部提示词、事实、锚点）：加 --json 重跑。")
    else:
        text = markdown(digests, args.host)
        print(text)
        print(volume_note(text, len(digests)))
        print("完整数据（含全部提示词、事实、锚点）：加 --json 重跑。")


if __name__ == "__main__":
    main()
