#!/usr/bin/env python3
"""Regression smoke test for the deterministic user-facing digest projection."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


SKILL_ROOT = Path(__file__).resolve().parents[1]
FIXTURE = SKILL_ROOT / "evals" / "example-01-synthetic-product-demo.json"
DIGEST = Path(__file__).with_name("digest.py")
PIXEL = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(DIGEST), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="100x-digest-") as raw:
        package = Path(raw) / "synthetic-package"
        package.mkdir()
        reverse_path = package / "reverse.json"
        shutil.copyfile(FIXTURE, reverse_path)
        (package / "validation.json").write_text(
            json.dumps({"valid": True, "hard_error_count": 0, "warning_count": 0}),
            encoding="utf-8",
        )

        fixture = json.loads(reverse_path.read_text(encoding="utf-8"))
        media_paths = {
            frame["relative_path"]
            for shot in fixture["shots"]
            for frame in shot["frames"].values()
        }
        media_paths.update(
            asset["screenshot_relative_path"]
            for bucket in fixture["assets"].values()
            for asset in bucket
            if asset.get("screenshot_relative_path")
        )
        for relative in media_paths:
            target = package / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(PIXEL)

        before = sha256(reverse_path)
        md = run("--package", str(package), "--format", "md")
        if md.returncode != 0:
            raise AssertionError(md.stderr or md.stdout)
        for expected in ("segment_001", "needs_model_selection", "Generate one four-second continuous shot"):
            if expected not in md.stdout:
                raise AssertionError(f"Markdown digest lost expected content: {expected}")

        fragment_dir = package / "fragments"
        fragment = run(
            "--package", str(package), "--format", "fragment",
            "--fragment-dir", str(fragment_dir), "--thumb-width", "64",
        )
        if fragment.returncode != 0:
            raise AssertionError(fragment.stderr or fragment.stdout)
        files = list(fragment_dir.glob("*-v094.html"))
        if len(files) != 1:
            raise AssertionError(f"Expected one v094 fragment, got {len(files)}")
        html = files[0].read_text(encoding="utf-8")
        for expected in (
            "rv-workbench", "data-prompt-inspector", "shotToSegment",
            "segment_001", "needs_model_selection",
        ):
            if expected not in html:
                raise AssertionError(f"Fragment lost expected content: {expected}")
        embedded = re.search(r'<script type="application/json" data-shot-prompts>(.*?)</script>', html)
        if not embedded:
            raise AssertionError("Fragment lost the shot-to-segment prompt map")
        prompt_map = json.loads(embedded.group(1))
        if prompt_map["shotToSegment"].get("shot_001") != "segment_001":
            raise AssertionError("shot_001 no longer maps to segment_001")
        expected_prompt = fixture["prompt_pack"]["segmented_generation_plan"][0]["omni_prompt"]
        if prompt_map["segments"]["segment_001"]["prompt"] != expected_prompt:
            raise AssertionError("Shot interaction no longer exposes the owning segment prompt verbatim")
        if files[0].stat().st_size >= 1_000_000:
            raise AssertionError("Synthetic fragment exceeded the 1 MB contract")
        if sha256(reverse_path) != before:
            raise AssertionError("digest.py modified reverse.json")

        print(json.dumps({
            "digest_selftest_passed": True,
            "fragment": files[0].name,
            "fragment_bytes": files[0].stat().st_size,
            "machine_package_unchanged": True,
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
