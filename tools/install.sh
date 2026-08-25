#!/usr/bin/env bash
# 100x-skill-tiktok · 本地安装脚本
#
# 把 skills/<name>/ 以软链接方式接入本机 Claude Code / Codex /
# WorkBuddy(CodeBuddy) / 通用 agent 的 skill 加载目录。
#
# 只增不改：目标路径已存在（无论是已有 skill、其他仓库的 junction，还是
# 之前装过的本仓 skill）一律跳过并提示，绝不覆盖或删除任何已有条目。
# 这是硬规矩——各运行时加载路径可能含大量其他项目的 junction，本脚本不改动
# 任何已有条目。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
INSTALL_HOME_ROOT="${SKILLS_INSTALL_HOME:-$HOME}"

TARGETS=(
  "$INSTALL_HOME_ROOT/.claude/skills"
  "$INSTALL_HOME_ROOT/.codex/skills"
  "$INSTALL_HOME_ROOT/.agents/skills"
  "$INSTALL_HOME_ROOT/.codebuddy/skills"
)

if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "找不到 $SKILLS_DIR" >&2
  exit 1
fi

installed=0
skipped=0
failed=0

for skill_path in "$SKILLS_DIR"/*/; do
  [[ -f "${skill_path}SKILL.md" ]] || continue
  name="$(basename "$skill_path")"
  skill_abs="$(cd "$skill_path" && pwd)"

  for target_root in "${TARGETS[@]}"; do
    mkdir -p "$target_root"
    link_path="$target_root/$name"

    if [[ -e "$link_path" || -L "$link_path" ]]; then
      echo "跳过（已存在，不覆盖）: $link_path"
      skipped=$((skipped + 1))
      continue
    fi

    if ln -s "$skill_abs" "$link_path" 2>/dev/null; then
      echo "已链接: $link_path -> $skill_abs"
      installed=$((installed + 1))
    else
      echo "软链接失败: $link_path（Windows 下可能需要开发者模式/管理员权限，或手动用 mklink /J "\""$link_path"\"" "\""$skill_abs"\"" 建 junction）" >&2
      failed=$((failed + 1))
    fi
  done
done

echo ""
echo "完成：新装 $installed 个，跳过 $skipped 个（已存在），失败 $failed 个。"
echo "测试方式：重启或重载 Agent 的 Skills，然后直接说触发词（比如"\""反推这个视频"\""）。"

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
