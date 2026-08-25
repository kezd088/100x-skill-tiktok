#!/usr/bin/env python3
"""Create a deterministic, local evidence package for video reverse analysis."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path
from typing import Any


VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
PTS_RE = re.compile(r"pts_time:([0-9]+(?:\.[0-9]+)?)")
SCDET_TIME_RE = re.compile(r"lavfi\.scd\.time=([0-9]+(?:\.[0-9]+)?)")
SCDET_SCORE_RE = re.compile(r"lavfi\.scd\.score=([0-9]+(?:\.[0-9]+)?)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract source metadata, diagnostic cut proposals, dense frames, and audio without uploading the video."
    )
    parser.add_argument("--video", required=True, type=Path, help="Local source video")
    parser.add_argument("--out", required=True, type=Path, help="New or empty package directory")
    parser.add_argument("--max-frames", type=int, default=180)
    parser.add_argument("--uniform-fps", type=float, default=2.0)
    parser.add_argument("--hard-cut-threshold", type=float, default=0.30)
    parser.add_argument("--sensitive-threshold", type=float, default=6.0)
    parser.add_argument("--width", type=int, default=768, help="Maximum extracted-frame width")
    return parser.parse_args()


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def require_binary(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved:
        fail(f"Required binary is unavailable: {name}")
    return resolved


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_rate(value: str | None) -> float:
    if not value or value in {"0/0", "N/A"}:
        return 0.0
    try:
        return float(Fraction(value))
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe_video(ffprobe: str, video: Path) -> dict[str, Any]:
    result = run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(video),
        ]
    )
    if result.returncode != 0:
        fail(f"ffprobe failed: {result.stderr.strip()}")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        fail(f"ffprobe returned invalid JSON: {exc}")
    video_stream = next((item for item in payload.get("streams", []) if item.get("codec_type") == "video"), None)
    audio_stream = next((item for item in payload.get("streams", []) if item.get("codec_type") == "audio"), None)
    if not video_stream:
        fail("No video stream was found in the source file.")
    duration_value = payload.get("format", {}).get("duration") or video_stream.get("duration")
    try:
        duration = float(duration_value)
    except (TypeError, ValueError):
        fail("The source duration could not be determined.")
    if not math.isfinite(duration) or duration <= 0:
        fail("The source duration is not a positive finite number.")
    width = int(video_stream.get("width") or 0)
    height = int(video_stream.get("height") or 0)
    if width <= 0 or height <= 0:
        fail("The source resolution could not be determined.")
    divisor = math.gcd(width, height)
    return {
        "duration_seconds": round(duration, 6),
        "width": width,
        "height": height,
        "aspect_ratio": f"{width // divisor}:{height // divisor}",
        "fps": round(parse_rate(video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate")), 6),
        "video_codec": video_stream.get("codec_name", "unknown"),
        "pixel_format": video_stream.get("pix_fmt", "unknown"),
        "has_audio": audio_stream is not None,
        "audio_codec": audio_stream.get("codec_name", "none") if audio_stream else "none",
        "audio_sample_rate": int(audio_stream.get("sample_rate") or 0) if audio_stream else 0,
        "audio_channels": int(audio_stream.get("channels") or 0) if audio_stream else 0,
    }


def tool_version(binary: str) -> str:
    result = run([binary, "-version"])
    text = result.stdout or result.stderr
    return text.splitlines()[0].strip() if text else "unknown"


def detect_hard_cuts(ffmpeg: str, video: Path, threshold: float) -> tuple[list[float], str | None]:
    filter_text = f"select=gt(scene\\,{threshold:.6f}),showinfo"
    result = run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(video), "-vf", filter_text, "-an", "-f", "null", "-"])
    if result.returncode != 0:
        return [], f"hard-cut detector failed: {result.stderr.strip()[-800:]}"
    times = [float(match.group(1)) for match in PTS_RE.finditer(result.stderr)]
    return sorted(set(round(value, 3) for value in times)), None


def detect_sensitive_cuts(
    ffmpeg: str, video: Path, threshold: float
) -> tuple[list[dict[str, float]], str | None]:
    filter_text = f"scdet=threshold={threshold:.6f},metadata=print"
    result = run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(video), "-vf", filter_text, "-an", "-f", "null", "-"])
    if result.returncode != 0:
        return [], f"sensitive detector failed: {result.stderr.strip()[-800:]}"
    combined = f"{result.stdout}\n{result.stderr}"
    pending_score: float | None = None
    proposals: list[dict[str, float]] = []
    for line in combined.splitlines():
        score_match = SCDET_SCORE_RE.search(line)
        if score_match:
            pending_score = float(score_match.group(1))
        time_match = SCDET_TIME_RE.search(line)
        if time_match:
            proposal = {"timestamp_seconds": round(float(time_match.group(1)), 3)}
            if pending_score is not None:
                proposal["score"] = round(pending_score, 6)
            proposals.append(proposal)
            pending_score = None
    unique: dict[float, dict[str, float]] = {}
    for proposal in proposals:
        unique[proposal["timestamp_seconds"]] = proposal
    return [unique[key] for key in sorted(unique)], None


def merge_cut_proposals(hard: list[float], sensitive: list[dict[str, float]], duration: float) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for timestamp in hard:
        if 0 < timestamp < duration:
            merged.append({"timestamp_seconds": timestamp, "detectors": ["hard_scene_change"]})
    for item in sensitive:
        timestamp = item["timestamp_seconds"]
        if not 0 < timestamp < duration:
            continue
        existing = next((entry for entry in merged if abs(entry["timestamp_seconds"] - timestamp) <= 0.06), None)
        if existing:
            existing["detectors"].append("sensitive_scdet")
            if "score" in item:
                existing["sensitive_score"] = item["score"]
        else:
            entry: dict[str, Any] = {"timestamp_seconds": timestamp, "detectors": ["sensitive_scdet"]}
            if "score" in item:
                entry["sensitive_score"] = item["score"]
            merged.append(entry)
    return sorted(merged, key=lambda item: item["timestamp_seconds"])


def choose_timestamps(
    duration: float,
    cut_proposals: list[dict[str, Any]],
    uniform_fps: float,
    max_frames: int,
    source_fps: float,
) -> tuple[list[dict[str, Any]], list[str]]:
    if uniform_fps <= 0:
        fail("--uniform-fps must be greater than zero.")
    if max_frames < 4:
        fail("--max-frames must be at least 4.")
    warnings: list[str] = []
    candidates: dict[int, dict[str, Any]] = {}
    # Container duration can extend a few milliseconds beyond the last decodable
    # frame. Stay one conservative frame interval inside the reported boundary.
    frame_interval = 1.0 / source_fps if source_fps > 0 else 0.05
    end_margin = min(max(0.05, frame_interval), max(0.001, duration / 2.0))
    safe_end = max(0.0, duration - end_margin)

    def add(timestamp: float, priority: int, reason: str) -> None:
        clamped = max(0.0, min(timestamp, safe_end))
        key = int(round(clamped * 1000))
        current = candidates.get(key)
        if current is None or priority < current["priority"]:
            candidates[key] = {"timestamp_seconds": round(clamped, 3), "priority": priority, "reasons": [reason]}
        elif reason not in current["reasons"]:
            current["reasons"].append(reason)

    add(0.0, 0, "source_start")
    add(safe_end, 0, "source_end_decodable_margin")
    for proposal in cut_proposals:
        timestamp = float(proposal["timestamp_seconds"])
        add(timestamp, 0, "cut_proposal")
        add(timestamp - 0.08, 1, "before_cut_proposal")
        add(timestamp + 0.08, 1, "after_cut_proposal")

    requested_step = 1.0 / uniform_fps
    expected_uniform = int(math.floor(duration / requested_step)) + 1
    effective_step = requested_step
    if expected_uniform > max_frames:
        effective_step = duration / max(1, max_frames - 1)
        warnings.append(
            f"Uniform sampling was reduced from {uniform_fps:.3f} fps to approximately {1.0 / effective_step:.3f} fps by --max-frames."
        )
    timestamp = 0.0
    while timestamp < duration:
        add(timestamp, 2, "uniform_sample")
        timestamp += effective_step

    ranked = list(candidates.values())
    if len(ranked) > max_frames:
        core = sorted((item for item in ranked if item["priority"] == 0), key=lambda item: item["timestamp_seconds"])
        remainder = sorted((item for item in ranked if item["priority"] != 0), key=lambda item: item["timestamp_seconds"])

        def evenly_select(items: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
            if count <= 0 or not items:
                return []
            if len(items) <= count:
                return items
            if count == 1:
                return [items[len(items) // 2]]
            indexes = {round(index * (len(items) - 1) / (count - 1)) for index in range(count)}
            return [items[index] for index in sorted(indexes)]

        if len(core) >= max_frames:
            ranked = evenly_select(core, max_frames)
            retained_cut_frames = sum("cut_proposal" in item["reasons"] for item in ranked)
            warnings.append(
                f"Frame candidates were capped from {len(candidates)} to {max_frames}; core endpoints/cut proposals exceeded the cap, so only {retained_cut_frames} of {len(cut_proposals)} cut-proposal frames were retained with timeline spacing."
            )
        else:
            ranked = core + evenly_select(remainder, max_frames - len(core))
            warnings.append(
                f"Frame candidates were capped from {len(candidates)} to {max_frames}; all {len(cut_proposals)} cut-proposal frames and source endpoints were retained, and remaining slots were spread across the timeline."
            )
    selected = sorted(ranked, key=lambda item: item["timestamp_seconds"])
    for item in selected:
        item.pop("priority", None)
    return selected, warnings


def extract_frame(ffmpeg: str, video: Path, timestamp: float, width: int, target: Path) -> None:
    scale_filter = f"scale=min({width}\\,iw):-2"
    result = run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-ss",
            f"{timestamp:.3f}",
            "-i",
            str(video),
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-vf",
            scale_filter,
            "-q:v",
            "2",
            "-y",
            str(target),
        ]
    )
    if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
        fail(f"Frame extraction failed at {timestamp:.3f}s: {result.stderr.strip()}")


def extract_audio(ffmpeg: str, video: Path, target: Path) -> None:
    result = run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-i",
            str(video),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-y",
            str(target),
        ]
    )
    if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
        fail(f"Audio extraction failed: {result.stderr.strip()}")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    video = args.video.expanduser().resolve()
    output = args.out.expanduser().resolve()
    if not video.is_file():
        fail(f"Source video does not exist: {video}")
    if video.suffix.lower() not in VIDEO_EXTENSIONS:
        fail(f"Unsupported video extension: {video.suffix}")
    if output == video.parent:
        fail("--out must not be the source video directory.")
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        fail(f"Output directory must be new or empty: {output}")
    if args.width < 64:
        fail("--width must be at least 64 pixels.")

    ffmpeg = require_binary("ffmpeg")
    ffprobe = require_binary("ffprobe")
    output.mkdir(parents=True, exist_ok=True)
    frames_dir = output / "evidence" / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    source_hash = sha256_file(video)
    metadata = probe_video(ffprobe, video)
    duration = float(metadata["duration_seconds"])

    hard, hard_warning = detect_hard_cuts(ffmpeg, video, args.hard_cut_threshold)
    sensitive, sensitive_warning = detect_sensitive_cuts(ffmpeg, video, args.sensitive_threshold)
    if hard_warning:
        warnings.append(hard_warning)
    if sensitive_warning:
        warnings.append(sensitive_warning)
    cut_proposals = merge_cut_proposals(hard, sensitive, duration)
    timestamps, sample_warnings = choose_timestamps(
        duration, cut_proposals, args.uniform_fps, args.max_frames, float(metadata["fps"])
    )
    warnings.extend(sample_warnings)

    frame_items: list[dict[str, Any]] = []
    for index, item in enumerate(timestamps, start=1):
        timestamp = float(item["timestamp_seconds"])
        filename = f"frame_{index:04d}_t{timestamp:09.3f}.jpg"
        target = frames_dir / filename
        extract_frame(ffmpeg, video, timestamp, args.width, target)
        frame_items.append(
            {
                "index": index,
                "timestamp_seconds": timestamp,
                "relative_path": f"evidence/frames/{filename}",
                "reasons": item["reasons"],
                "size_bytes": target.stat().st_size,
            }
        )

    audio_relative_path: str | None = None
    if metadata["has_audio"]:
        audio_target = output / "evidence" / "audio.wav"
        extract_audio(ffmpeg, video, audio_target)
        audio_relative_path = "evidence/audio.wav"
    else:
        warnings.append("The source has no audio stream; audio.wav was not created.")

    if sha256_file(video) != source_hash:
        fail("The source file changed while evidence was being prepared.")

    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    source_manifest = {
        "schema_version": "0.1",
        "source_file": video.name,
        "source_path": str(video),
        "sha256": source_hash,
        "size_bytes": video.stat().st_size,
        **metadata,
        "created_at_utc": created_at,
        "tools": {"ffmpeg": tool_version(ffmpeg), "ffprobe": tool_version(ffprobe)},
    }
    evidence_manifest = {
        "schema_version": "0.1",
        "source_sha256": source_hash,
        "created_at_utc": created_at,
        "input_mode": "local_read_only",
        "diagnostic_only": True,
        "sampling": {
            "requested_uniform_fps": args.uniform_fps,
            "max_frames": args.max_frames,
            "extracted_frame_count": len(frame_items),
            "max_width": args.width,
            "hard_cut_threshold": args.hard_cut_threshold,
            "sensitive_threshold": args.sensitive_threshold,
        },
        "cut_proposals": cut_proposals,
        "frames": frame_items,
        "audio": {
            "present": bool(metadata["has_audio"]),
            "relative_path": audio_relative_path,
            "format": "mono 16 kHz PCM WAV" if audio_relative_path else None,
        },
        "warnings": warnings,
    }
    write_json(output / "source_manifest.json", source_manifest)
    write_json(output / "evidence" / "evidence_manifest.json", evidence_manifest)
    print(
        json.dumps(
            {
                "ok": True,
                "package_dir": str(output),
                "duration_seconds": duration,
                "frame_count": len(frame_items),
                "cut_proposal_count": len(cut_proposals),
                "audio_extracted": audio_relative_path is not None,
                "warning_count": len(warnings),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
