#!/usr/bin/env bash
# 100x-skill-tiktok · 打包脚本
#
# 把 skills/<name>/ 复制到 dist/skills/<name>/，供分发/发布用。
# 名字里含 "beta" 的 skill 排除在外（未成熟，不对外分发）。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
DIST_DIR="$REPO_ROOT/dist/skills"

if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "找不到 $SKILLS_DIR" >&2
  exit 1
fi

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

built=0
excluded=0

for skill_path in "$SKILLS_DIR"/*/; do
  [[ -f "${skill_path}SKILL.md" ]] || continue
  name="$(basename "$skill_path")"

  if [[ "$name" == *beta* ]]; then
    echo "排除（名字含 beta，未成熟）: $name"
    excluded=$((excluded + 1))
    continue
  fi

  # node_modules（devDependency，比如 ajv）不进分发包——安装方自己 npm install
  cp -R "$skill_path" "$DIST_DIR/$name"
  rm -rf "$DIST_DIR/$name/node_modules"
  echo "已打包: $name"
  built=$((built + 1))
done

echo ""
echo "完成：打包 $built 个，排除 $excluded 个（beta）。产出目录：$DIST_DIR"
