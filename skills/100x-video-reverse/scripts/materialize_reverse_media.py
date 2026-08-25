#!/usr/bin/env python3
"""Materialize shot frames and asset screenshots declared by reverse.json."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


FRAME_FIELDS = ("start", "representative", "highlight", "end")
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract declared reverse-package media from the immutable source video.")
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--package", required=True, type=Path, help="Path to reverse.json")
    parser.add_argument("--source-manifest", type=Path, help="Optional source_manifest.json for source identity verification")
    parser.add_argument("--width", type=int, default=768, help="Maximum output width")
    return parser.parse_args()


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"File does not exist: {path}")
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON in {path}: {exc}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def resolve_media(root: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value.strip():
        fail("reverse.json contains an empty media path.")
    relative = Path(value)
    if relative.is_absolute():
        fail(f"Media path must be relative: {value}")
    target = (root / relative).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        fail(f"Media path escapes the package directory: {value}")
    return target


def valid_timestamp(value: Any, duration: float, source_fps: float, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f"Timestamp is not numeric at {label}.")
    timestamp = float(value)
    if not math.isfinite(timestamp) or timestamp < 0 or timestamp > duration + 0.2:
        fail(f"Timestamp {timestamp!r} is outside the video at {label}.")
    frame_interval = 1.0 / source_fps if source_fps > 0 else 0.05
    end_margin = min(max(0.05, frame_interval), max(0.001, duration / 2.0))
    return min(timestamp, max(0.0, duration - end_margin))


def extract_frame(ffmpeg: str, video: Path, timestamp: float, width: int, target: Path) -> str | None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=".100x-frame-", suffix=target.suffix, dir=target.parent, delete=False) as handle:
        temporary = Path(handle.name)
    scale_filter = f"scale=min({width}\\,iw):-2"
    result = subprocess.run(
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
            str(temporary),
        ],
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0 or not temporary.is_file() or temporary.stat().st_size == 0:
        temporary.unlink(missing_ok=True)
        return result.stderr.strip() or "ffmpeg did not produce a non-empty frame"
    temporary.replace(target)
    return None


def extract_audio(ffmpeg: str, video: Path, target: Path) -> str | None:
    target.parent.mkdir(parents=True, exist_ok=True)
    suffix = target.suffix.lower()
    codec_args = {
        ".mp3": ["-c:a", "libmp3lame", "-q:a", "2"],
        ".wav": ["-c:a", "pcm_s16le"],
        ".m4a": ["-c:a", "aac", "-b:a", "192k"],
        ".aac": ["-c:a", "aac", "-b:a", "192k"],
        ".flac": ["-c:a", "flac"],
    }.get(suffix)
    if codec_args is None:
        return f"unsupported audio asset extension: {suffix or '[none]'}"
    with tempfile.NamedTemporaryFile(prefix=".100x-audio-", suffix=suffix, dir=target.parent, delete=False) as handle:
        temporary = Path(handle.name)
    result = subprocess.run(
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
            *codec_args,
            "-y",
            str(temporary),
        ],
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0 or not temporary.is_file() or temporary.stat().st_size == 0:
        temporary.unlink(missing_ok=True)
        return result.stderr.strip() or "ffmpeg did not produce a non-empty audio asset"
    temporary.replace(target)
    return None


def main() -> None:
    args = parse_args()
    video = args.video.expanduser().resolve()
    package = args.package.expanduser().resolve()
    if not video.is_file():
        fail(f"Source video does not exist: {video}")
    if not package.is_file():
        fail(f"reverse.json does not exist: {package}")
    if args.width < 64:
        fail("--width must be at least 64 pixels.")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        fail("Required binary is unavailable: ffmpeg")
    data = read_json(package)
    if not isinstance(data, dict):
        fail("reverse.json must contain a JSON object.")
    video_data = data.get("video") if isinstance(data.get("video"), dict) else {}
    duration_value = video_data.get("duration_seconds")
    if isinstance(duration_value, bool) or not isinstance(duration_value, (int, float)) or float(duration_value) <= 0:
        fail("reverse.json has no positive video.duration_seconds.")
    duration = float(duration_value)
    fps_value = video_data.get("fps")
    source_fps = float(fps_value) if isinstance(fps_value, (int, float)) and not isinstance(fps_value, bool) else 0.0
    if data.get("source_file") != video.name:
        fail(f"Source filename mismatch: reverse.json={data.get('source_file')!r}, video={video.name!r}")
    source_hash = sha256_file(video)
    if args.source_manifest:
        manifest = read_json(args.source_manifest.expanduser().resolve())
        if not isinstance(manifest, dict):
            fail("source_manifest.json must contain a JSON object.")
        if manifest.get("source_file") != video.name:
            fail("Source filename does not match source_manifest.json.")
        expected_hash = manifest.get("sha256")
        if isinstance(expected_hash, str) and expected_hash and source_hash != expected_hash:
            fail("Source SHA-256 does not match source_manifest.json.")

    provenance_path = package.parent / "materialization_manifest.json"
    had_provenance = provenance_path.exists()
    previous_entries: dict[str, dict[str, Any]] = {}
    if had_provenance:
        previous = read_json(provenance_path)
        if not isinstance(previous, dict):
            fail("materialization_manifest.json must contain a JSON object.")
        if previous.get("source_sha256") != source_hash:
            fail("Existing materialization provenance belongs to a different source SHA-256.")
        raw_entries = previous.get("media") if isinstance(previous.get("media"), list) else []
        for entry in raw_entries:
            if isinstance(entry, dict) and isinstance(entry.get("relative_path"), str):
                previous_entries[entry["relative_path"]] = entry

    requests: dict[Path, dict[str, Any]] = {}

    def request(relative: Any, timestamp: Any, label: str, kind: str) -> None:
        target = resolve_media(package.parent, relative)
        safe_timestamp = valid_timestamp(timestamp, duration, source_fps, label)
        requested_timestamp = float(timestamp)
        relative_path = target.relative_to(package.parent.resolve()).as_posix()
        existing = requests.get(target)
        if existing and abs(existing["requested_timestamp_seconds"] - requested_timestamp) > 0.001:
            fail(
                f"The same media path maps to different timestamps: {target} "
                f"({existing['requested_timestamp_seconds']:.3f}s vs {requested_timestamp:.3f}s)"
            )
        if existing and existing["kind"] != kind:
            fail(f"The same media path is declared as both {existing['kind']} and {kind}: {target}")
        requests[target] = {
            "requested_timestamp_seconds": requested_timestamp,
            "extracted_timestamp_seconds": safe_timestamp,
            "relative_path": relative_path,
            "label": label,
            "kind": kind,
        }

    shots = data.get("shots") if isinstance(data.get("shots"), list) else []
    for shot_index, shot in enumerate(shots):
        if not isinstance(shot, dict):
            continue
        frames = shot.get("frames") if isinstance(shot.get("frames"), dict) else {}
        for frame_name in FRAME_FIELDS:
            frame = frames.get(frame_name)
            if isinstance(frame, dict):
                request(
                    frame.get("relative_path"),
                    frame.get("timestamp_seconds"),
                    f"shots[{shot_index}].frames.{frame_name}",
                    "frame",
                )
    assets = data.get("assets") if isinstance(data.get("assets"), dict) else {}
    for category, entries in assets.items():
        if not isinstance(entries, list):
            continue
        for asset_index, asset in enumerate(entries):
            if isinstance(asset, dict):
                declared_path = asset.get("screenshot_relative_path")
                request(
                    declared_path,
                    asset.get("screenshot_timestamp_seconds"),
                    f"assets.{category}[{asset_index}]",
                    "audio"
                    if category == "audio" and isinstance(declared_path, str) and Path(declared_path).suffix.lower() in AUDIO_EXTENSIONS
                    else "frame",
                )

    extracted = 0
    skipped = 0
    failures: list[dict[str, Any]] = []
    media_entries: list[dict[str, Any]] = []
    for target, item in sorted(requests.items(), key=lambda pair: str(pair[0])):
        if target.exists():
            if not target.is_file() or target.stat().st_size == 0:
                failures.append({"path": str(target), "label": item["label"], "error": "existing path is not a non-empty file"})
                continue
            previous_entry = previous_entries.get(item["relative_path"])
            if not previous_entry:
                failures.append(
                    {
                        "path": str(target),
                        "label": item["label"],
                        "error": "existing media has no matching materialization provenance; use a new package directory",
                    }
                )
                continue
            if previous_entry.get("kind") != item["kind"]:
                failures.append(
                    {
                        "path": str(target),
                        "label": item["label"],
                        "error": "existing media kind differs from provenance",
                    }
                )
                continue
            previous_timestamp = previous_entry.get("requested_timestamp_seconds")
            if not isinstance(previous_timestamp, (int, float)) or abs(float(previous_timestamp) - item["requested_timestamp_seconds"]) > 0.001:
                failures.append(
                    {
                        "path": str(target),
                        "label": item["label"],
                        "error": "existing media provenance timestamp differs from reverse.json; use a new revision directory",
                    }
                )
                continue
            current_hash = sha256_file(target)
            if previous_entry.get("sha256") != current_hash:
                failures.append({"path": str(target), "label": item["label"], "error": "existing media hash differs from provenance"})
                continue
            skipped += 1
        else:
            if item["kind"] == "audio":
                problem = extract_audio(ffmpeg, video, target)
            else:
                problem = extract_frame(ffmpeg, video, item["extracted_timestamp_seconds"], args.width, target)
            if problem:
                failures.append({"path": str(target), "label": item["label"], "error": problem})
                continue
            extracted += 1
        media_entries.append(
            {
                "relative_path": item["relative_path"],
                "requested_timestamp_seconds": round(item["requested_timestamp_seconds"], 6),
                "extracted_timestamp_seconds": round(item["extracted_timestamp_seconds"], 6),
                "label": item["label"],
                "kind": item["kind"],
                "size_bytes": target.stat().st_size,
                "sha256": sha256_file(target),
            }
        )
    provenance = {
        "schema_version": "0.1",
        "updated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source_file": video.name,
        "source_sha256": source_hash,
        "reverse_sha256": sha256_file(package),
        "complete": not failures and len(media_entries) == len(requests),
        "media": media_entries,
        "failures": failures,
    }
    provenance_written = extracted > 0 or had_provenance
    if provenance_written:
        write_json_atomic(provenance_path, provenance)
    result = {
        "ok": not failures,
        "requested": len(requests),
        "extracted": extracted,
        "skipped_existing": skipped,
        "failure_count": len(failures),
        "failures": failures,
        "provenance_manifest": str(provenance_path) if provenance_written else None,
    }
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if not failures else 1)


if __name__ == "__main__":
    main()
