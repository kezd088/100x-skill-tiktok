# 100x-skill-tiktok · Claude Code 入口

@AGENTS.md

本文件只维护 Claude Code 专属适配。仓库的建造契约——八件套结构、ajv 强制、公理格式、
开源合规红线、不代笔编方法论——统一以导入的 `AGENTS.md` 为准，不在这里复制正文。

## Claude Code 适配

- 本仓库同时是 Claude Code plugin（`.claude-plugin/plugin.json`）和 skill 的公开源仓库；执行
  `tools/install.sh` 前确认目标路径（`~/.claude/skills` 等）是否已有同名条目——脚本本身只增不改，
  绝不覆盖已存在目录，但改脚本逻辑前先确认这条行为没被破坏。
- 新建 skill、大改现有 skill 的 `axioms.md`/`schema.json`，或调整 `skills.json`/plugin 注册表，
  属于跨模块且难以恢复的改动，先进 Plan Mode 给出范围和验证方式；诊断某个 skill 判据是否合理、
  读 `sources.md` 溯源这类只读讨论不受此限制。
- 运行 `node scripts/validate.js --selftest` 前，确认对应 `skills/<name>/` 目录下已经
  `npm install`（依赖只有 `ajv`，见该目录 `package.json`）。
