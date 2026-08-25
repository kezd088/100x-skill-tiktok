# 输出契约 v0.1

## 目录

```text
<package>/
├─ source_manifest.json
├─ reverse.json
├─ materialization_manifest.json
├─ validation.json
├─ report.md
├─ evidence/
│  ├─ evidence_manifest.json
│  ├─ audio.wav
│  └─ frames/*.jpg
├─ frames/*.jpg
└─ assets/*
```

`evidence/` 是分析输入；`frames/` 和 `assets/` 是 `reverse.json` 对外引用的交付媒体。可以复制或裁剪证据帧生成交付媒体，但不能修改源视频。所有路径使用相对于 `reverse.json` 的正斜杠路径。

## source_manifest.json

必须记录：

- `schema_version`
- `source_file`、`source_path`、`sha256`、`size_bytes`
- `duration_seconds`、`width`、`height`、`aspect_ratio`、`fps`
- 视频和音频 codec、音轨存在性
- `created_at_utc`

源清单用于确认分析对象未漂移，不包含密钥或外部服务凭据。

## evidence/evidence_manifest.json

必须记录抽帧参数、双检测器阈值、`cut_proposals`、每帧时间戳和相对路径、音频路径、警告。`cut_proposals` 必须明确标记为 `diagnostic_only: true`。

## reverse.json

正式 Schema 位于 `schema.json`。顶层契约：

- `schema_version`：v0.1 继续使用兼容值 `1.0`。
- `candidate_id`：推荐 `100x-video-reverse-v0.1`；审计历史包时保留原值。
- `video_id`、`source_file`、`video`。
- `shots`：连续覆盖全片的语义镜头。
- `assets`：`people`、`products`、`scenes`、`props`、`wardrobe`、`audio`、`text`。
- `prompt_pack`：全局、逐镜、逐资产、模型适配、负向约束、分段、拼接、引用映射和不变量。
- `evidence`：输入模式、采样密度、转写来源、限制和不确定项。

每个镜头包含唯一 `shot_id`、起止/时长、四类关键帧、资产引用、动作与镜头语言、音频/字幕/文字、叙事与转化功能、证据时间戳和置信度。

## validation.json

包含 `valid`、`hard_error_count`、`warning_count`、逐项错误/警告、统计和验证参数。退出码 `1` 表示存在硬错误，不能交给下游；退出码 `0` 允许有显式警告。

## materialization_manifest.json

由媒体物化脚本生成，必须包含源文件 SHA-256、`reverse.json` SHA-256、完成状态，以及每个交付媒体的类型、相对路径、请求时间戳、实际提取时间戳、大小和 SHA-256。严格验证同时核对路径、时间戳和文件内容；只存在非空文件不算有效 provenance。`assets.audio` 指向 `.mp3`、`.wav`、`.m4a`、`.aac` 或 `.flac` 时，v0.1 物化完整源音轨；指向图片时按音频波形/证据截图处理。更细的音频片段需要后续 Schema 明确起止区间。

## 下游兼容边界

生成 Skill 可以读取 `reverse.json` 和包内媒体，但必须自行实时核对供应商输入能力、内容政策、价格和时长限制。后期 Skill 负责确定性字幕、原音频、遮罩、拼接和文字保真。评测 Skill 必须把反推质量与最终复现质量分开评分。

建议的 Skill 套件边界是：`100x-video-reverse`（本 Skill）→ `100x-video-clone`（模型/供应商生成）→ `100x-video-post`（确定性音频、文字与拼接）→ `100x-video-eval`（统一相似度与失败归因）。后续 Skill 通过本契约串联，不把付费、发布或评测权限回灌进反推 Skill。
