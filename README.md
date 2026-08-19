<h1 align="center">100x-skill-tiktok</h1>

<p align="center">
  <strong>把爆款方法论拆成可验证的 skill，框架公开，数据私有。</strong>
</p>

<p align="center">
  面向 TikTok / UGC 内容生产的 Claude Code / Codex agent skill 合集：脚本分段、人物与场景设定、取材关键词、提示词编排，每条判据都能跑脚本验证，不是散文式方法论。
</p>

<p align="center">
  <img alt="100x-skill-tiktok：脚本/产品/人设输入汇入受治理的skill框架，产出经schema验证的结构化结果" src="./.github/100x-skills-loop.svg" width="100%">
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18+-171716.svg?style=flat-square&labelColor=171716">
  <img alt="JSON Schema" src="https://img.shields.io/badge/JSON_Schema-draft--07-171716.svg?style=flat-square&labelColor=171716">
  <img alt="ajv" src="https://img.shields.io/badge/validator-ajv-171716.svg?style=flat-square&labelColor=171716">
  <img alt="skills" src="https://img.shields.io/badge/skills-8%2F8-171716.svg?style=flat-square&labelColor=171716">
</p>

## 100x-skill-tiktok 是什么

这个仓库不是一份方法论文档合集。每个 skill 的判据（`axioms.md`）都配一个真实可运行的校验脚本（`scripts/validate.js`），能跑 `node scripts/validate.js --selftest` 当场验证——不是"逻辑已经想清楚"这种没有代码支撑的口头承诺。

仓库是三层架构里的第 2 层，通用能力件：

```
第1层 · 私有数据底座        （语料、知识原子，不进这个仓）
        ↓ requires_data 声明引用，不复制内容
第2层 · 100x-skill-tiktok   ← 本仓 · 框架公开
        ↓ registry 钉版本
第3层 · 产品项目            （实际业务落地）
```

> SKILL.md 是框架，atoms 是数据。前者公开，后者收费。

| 核心差异 | 这个仓库的处理方式 |
|---|---|
| 判据可验证性 | 每条公理必须能写成脚本判据；JSON Schema 表达不了的跨条目/跨字段约束（引用完整性、证据子串、5A覆盖率等）额外配手写校验，两层职责分开、都能真实执行 |
| 结构层校验 | 统一用 `ajv` 编译执行 `schema.json`（required/additionalProperties/enum/pattern），不用手写代码重新实现 JSON Schema 已经能做的事——历史上手写实现漏掉过 `additionalProperties` 检查，换 ajv 后才真被堵住 |
| 数据边界 | `evals/` 只放合成样例，真实客户语料/账号名/产品名一律不进仓；`requires_data` 只声明数据集 id，不复制内容 |
| 质量验证 | 每个 skill 建成后经过独立验证（真实语料实跑与 schema 校验、公理逐条找反例、开源合规扫描），全部通过才算数 |
| 方法论边界 | 本仓库仅包含可公开的工程方法论与可运行校验契约；涉及具体校准阈值与真实语料统计的部分严格保持在本公开仓之外 |

## Skill 清单

8 个功能 skill 全部建成并通过独立验证（原规划 7 个 + 计划外新增的 100x-video-reverse），另有 1 个纯路由 skill。

| Skill | 做什么 | 触发词示例 | 状态 |
|---|---|---|---|
| [`100x-video-reverse`](./skills/100x-video-reverse) | 视频 →（ffmpeg 抽帧）→ 两段产出：复刻提示词（分镜时间轴 + 画面形态轴双轴）+ 变量化（{VAR} 插槽模板 + 跨镜头不变量与变化轴），中英双语 | 反推这条视频 · 这个视频怎么复刻 · reverse this video | ✅ 已验证 |
| [`100x-segment`](./skills/100x-segment) | 口播脚本纯文本（英/西）→ 三层独立叠加切分：段落逻辑（10模块+7原型）+ 镜头目的预判 + 行内气口标记 | "帮我分段" · "这段哪里该喘气" · "segment this script" | ✅ 已验证 |
| [`100x-localize`](./skills/100x-localize) | 源文案（任意源语言）→ 墨西哥西语默认本地化版本，贴合真实语料强度分布，非逐字翻译 | "本地化成西语" · "翻译成西语文案" · "Mexican Spanish localization" | ✅ 已验证 |
| [`100x-persona`](./skills/100x-persona) | 脚本文案 → 讲述人物设定 + 独立场景设定，每条可回溯到脚本原文引用 | "给这条脚本配个人设" · "这个场景怎么设定" · "who should deliver this script" | ✅ 已验证 |
| [`100x-exaggerate`](./skills/100x-exaggerate) | 脚本 → 夸张技法 beat + 反差配对 beat，强度按市场+帽度天花板校准 | "帮这条脚本加点夸张" · "怎么做反差" · "add a before/after contrast" | ✅ 已验证 |
| [`100x-search-query`](./skills/100x-search-query) | 产品/人设卡片 → Pinterest / TikTok / Reddit 三平台各15条英文搜索短语，用于找视觉参考素材 | "给我搜索关键词" · "去哪找参考图" · "what should I search on Pinterest" | ✅ 已验证 |
| [`100x-visual-fission`](./skills/100x-visual-fission) | ≥2条锁定的人物/场景/产品参考 + 产品文案 → 媒介裂变提示词矩阵（单帧/首尾/首中尾/数日 × ABC机位） | "帮我裂变这条视觉参考" · "生成裂变提示词矩阵" · "fission this reference" | ✅ 已验证 |
| [`100x-prompt-compose`](./skills/100x-prompt-compose) | 模板id + 变量 → 逐字渲染、按目标模型（Veo/Seedance/即创）包装好的最终生成提示词 | "帮我组装提示词" · "填个模板出提示词" · "compose a video prompt" | ✅ 已验证 |
| [`100x-tiktok`](./skills/100x-tiktok) | 纯路由：任务前诊断该从哪个 skill 入手，任务后指出下一步；不生成内容 | "/100x-tiktok" · "做一条 TikTok 广告" | 路由（不参与验证） |

## 快速开始

### 一键安装（推荐）

```bash
# 整套：装进本机 Claude Code / Codex / 通用 agent 的 skills 目录
npx -y skills add kezd088/100x-skill-tiktok -g --all

# 单模块：只装一个 skill（<skill-name> 换成 skills/ 下的目录名，如 100x-segment）
npx -y skills add kezd088/100x-skill-tiktok --skill <skill-name>
```

### 本地软链（备选）

```bash
# 本机软链到 ~/.claude/skills、~/.codex/skills、~/.agents/skills，只增不覆盖
bash tools/install.sh
```

`tools/install.sh` 会把 `skills/<name>/` 软链接进 `~/.claude/skills`、`~/.codex/skills`、`~/.agents/skills` 三处，目标路径已存在会跳过、绝不覆盖。装完开一个新会话，直接说触发词或用 `/skill-name` 调用。

### 验证

```bash
# 单独验证某个 skill（每个 skill 目录下都有）
for d in skills/*/; do
  [ -f "$d/scripts/validate.js" ] && (cd "$d" && npm install && node scripts/validate.js --selftest)
done
```

## 能力边界

README 只描述当前已建成、过验证的部分，不把已知局限藏起来：

- `100x-video-reverse` 依赖外部二进制 ffmpeg/ffprobe 抽帧（agent 读不了 mp4，必须先跑 `scripts/extract-frames.mjs`）；`prompt_en` 的 21 词禁词扫描经多轮加固，但仍有三处如实披露的天花板：无分隔符融合词（`homestudio` 焊死 `studio`）绕过词边界、`text-to-speech`/`speech-to-text` 这类技术术语被误判为文字层禁词、`phrase`/`lettering` 等同义表达绕开名词词表——这三处是刻意不修或修了代价更大的已知局限，不宣称已完全解决

- `100x-search-query` 的敏感品类护栏（防止两性健康类文案无提示通过）：品类信号与权威宣称信号共享同一扫描范围（`category`/`product_name` 以及生成的 `queries.*.q`/`intent_cn`），信号词表覆盖常见近义词/委婉说法，但固定关键词表判据不是语义判据，表外的新说法依然能绕过——这条护栏不宣称"已完全解决"
- `100x-persona` 的证据子串判据防不住"字面是原文子串、但摘录后语义被反转"的滥用（`checkEvidenceQuotes` 只做逐字包含检查），另有一层闭集自我怀疑短语强制披露作为缓解（`checkAuthorityHedgeRisk`），但反讽/引用-驳斥框架类反转依然检测不到，这是 JSON Schema 和字符串匹配两层机制共同的天花板
- `100x-localize` 的 `tú`/`usted` 禁令 pattern 有 Unicode 组合标记天花板：加了 NFC 规范化和补充匹配后仍无法穷举全量 Unicode 不可见/组合字符空间
- `100x-prompt-compose` 的内容完整性判据（比如空洞占位内容 `persona: 'a person'`）没有可靠的启发式修复，长度/数字类判据无法可靠区分合法简短示例和偷懒填空
- `skills.json`/`.claude-plugin/plugin.json` 目前只是最小可用版本，没有做 marketplace 分发验证
- 原规划 7 个 skill 各自产出的知识原子草稿（28条）里，24条可跨项目复用的工程方法论已沉淀为可复用经验；另外 4 条涉及具体 校准阈值/真实语料统计，因开源合规红线不进这个公开仓，暂存状态尚未定妥

## 仓库约定

- `skills/` 全平级，无分类子目录、无编号；`100x-` 前缀是命名空间，避免装进 `~/.claude/skills/`（平铺目录）时撞名
- 每个 skill 内部固定七件套：`SKILL.md`（路由用，frontmatter 的 description 必须嵌中英文触发词原话）、`metadata.json`、`axioms.md`、`workflow.md`、`sources.md`、`schema.json`、`evals/`（只放合成样例）
- 结构层约束用 `ajv` 跑 `schema.json`；跨条目/跨字段类约束（JSON Schema 表达不了的部分）用 `scripts/validate.js` 里的手写代码补，两层职责在每个 skill 的 `metadata.json.validation` 字段里写清楚
- 客户名、真实账号名、真实产品名、飞书链接、API key、客户裁定的品类词典，一律不进仓；知识原子按类目+市场标注，不写客户标识

## 文档索引

| 内容 | 位置 |
|---|---|
| 单个 skill 的判据、流程、来源追溯 | 各 `skills/<name>/{axioms,workflow,sources}.md` |
| 单个 skill 的输出契约与校验方式 | 各 `skills/<name>/schema.json` + `scripts/validate.js` |
| 仓库根注册表 | [`skills.json`](./skills.json) |
| English version | [`README.en.md`](./README.en.md) |
