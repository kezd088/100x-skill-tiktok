---
name: 100x-video-reverse
description: "把本地参考视频反推成可验证、可生成、可在 Agent 对话中直接审阅的分镜表、首帧/高光帧/尾帧、资产库和分段生成方案。用户说‘反推这条视频’‘这个视频怎么复刻’‘reverse this video’或需要视频复刻前拉片、证据提取、反推包审计时使用；不用于直接生成视频、发布素材、通用剪辑或字幕烧录。"
metadata:
  version: "2.1.0"
  golden-baseline: "shuohao_composite@2026-08-25"
  supersedes: "100x-video-reverse@2.0.0"
---

# 100X Video Reverse v2.1

把参考视频转成用户可直接审阅、下游生成 Skill 可消费的标准反推包。默认只分析和验证，不调用付费生成、不上传原视频、不发布素材。

## 开始前

1. 确认用户提供的视频可读和授权边界。用户未指定输出目录时，直接使用当前工作区下 `outputs/100x-video-reverse/<video-stem>-<timestamp>/`，不为目录选择额外追问；始终只读源文件并输出到新的独立目录。
2. 始终阅读 [workflow.md](workflow.md)、[output-contract.md](references/output-contract.md) 与 [native-output.md](references/native-output.md)。进行模型分析时再读 [analysis-prompt.md](references/analysis-prompt.md)。涉及商业文案、密集剪辑、外部上传或准备交给生成环节时读 [failure-gates.md](references/failure-gates.md)。只有评估、替换或升级本 Skill 时才读 [golden-baseline.md](references/golden-baseline.md)。
3. 检查 `ffmpeg`、`ffprobe`、Python `jsonschema` 和本地读写权限。缺少 `jsonschema` 时验证器必须硬停止；只在隔离环境补依赖，不做全局安装。调用任何外部模型前，实时核对官方模型列表和输入限制；用户指定模型优先。不能核实时停止外部调用，但继续完成本地证据包。

## 执行流程

1. 用 `scripts/prepare_evidence.py` 建立源文件指纹、规格、双阈值切点提议、稠密帧和独立音轨。自动切点只是诊断信号，不是真实镜头边界。
2. 同时查看完整视频与证据包，优先使用当前 Agent 已有的本地媒体理解能力，不要求用户另配 API。只有当前任务已明确授权外部语义分析时，才可沿用金样的 Google 官方 `gemini-3.7-flash`；调用前必须从官方模型列表核实真实 ID 和视频输入能力，不可用时保留原始错误并停止外部阶段，不静默换旧模型。按 `references/analysis-prompt.md` 校正镜头时间轴，区分可观察事实、推断和未知，不以固定间隔代替语义切镜。
3. 建立稳定资产 ID 和跨镜头一致性锚点，覆盖人物、商品、场景、道具、服装、音频与文字。看不清或听不清的品牌、价格、功效、台词和屏幕文字不得补写。
4. 生成完整的 `reverse.json`：镜头、四类关键帧、资产引用、音频/字幕、通用提示词、模型适配提示词、分段方案、拼接说明和 `must_not_change`。每个分段还要包含 `execution_plan`：目标时长、生成状态、选定模型、生成方式和输入素材；没有实时核实模型能力时明确写 `needs_model_selection`，不得伪装成可执行。
5. 用 `scripts/materialize_reverse_media.py` 将镜头帧和资产截图物化到包内相对路径，并生成 `materialization_manifest.json`。已有媒体只有在源 SHA-256、请求时间戳和文件 SHA-256 全部匹配 provenance 时才复用；否则硬停止，不覆盖。
6. 用 `scripts/validate_reverse_package.py` 做媒体与契约预检。硬错误必须修复后才能继续；警告必须保留并解释，不能改成通过。
7. 按 [native-output.md](references/native-output.md) 直接在当前 Agent 对话中交付：先展示可播放源视频，再展示分镜三帧、人物/产品/场景资产及提示词、逐段模型/时长/生成方式/输入素材/提示词，最后给机器包路径、警告、成本和耗时。使用当前客户端原生媒体能力；客户端不能内联视频时，保留分镜图片的可视化展示并给出可点击源视频路径。

用户给出观看反馈时，把每条反馈映射到具体镜头、资产或提示词字段，并明确标为“用户偏好/修正”，不要反写成源视频观察事实。新建修订包，只改受影响字段和媒体，再完整验证；不覆盖上一版。

## 命令

```powershell
python <skill-root>\scripts\prepare_evidence.py --video <source.mp4> --out <new-package-dir>
python <skill-root>\scripts\materialize_reverse_media.py --video <source.mp4> --package <new-package-dir>\reverse.json --source-manifest <new-package-dir>\source_manifest.json
python <skill-root>\scripts\validate_reverse_package.py --package <new-package-dir>\reverse.json --source-manifest <new-package-dir>\source_manifest.json --require-media --report <new-package-dir>\validation.json
```

`<new-package-dir>` 必须不存在或为空。不要用 `--out` 指向源视频目录。

## 不可突破的边界

- 反推包通过验证，只说明结构、证据和引用可执行；不代表最终视频视觉相似度达标。
- 不在本 Skill 内生成、重试生成、做后期或评分。它们应由独立 Skill 消费本输出契约。
- Agent 原生回复只是 `reverse.json` 和包内媒体的呈现层，不是第二份业务真源；任何修订先改机器包，再刷新当前回复。
- 不因供应商当前限制把“固定 10 秒切片”写成镜头真相。优先按真实镜头和叙事边界分段；验证器的 10 秒仅是可配置的下游兼容警告。
- 未得到明确授权时，不把本地视频上传到公网 URL、对象存储或第三方服务。
- 不复制许可证不明或用途相反的候选代码，只吸收经同样本验证的方法和失败经验。

## 完成标准

完成时必须存在：`source_manifest.json`、`evidence/evidence_manifest.json`、证据媒体、`reverse.json`、`materialization_manifest.json` 和 `validation.json`；严格媒体验证为零硬错误。当前对话必须展示源视频入口、全部分镜三帧、资产图与资产提示词、逐段生成方案、所有警告、限制、不确定项、成本和耗时。`--legacy-unverified-media` 只允许审计历史包，禁止用于新交接。
