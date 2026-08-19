---
name: 100x-search-query
description: Generate platform-native search phrases for sourcing TikTok/UGC visual
  references. Use when the user asks to "find reference images", "what should I search
  on Pinterest", "给我搜索关键词", "去哪找参考图", or needs Pinterest/TikTok/Reddit query
  sets for a product or persona card.
metadata:
  author: 100x
  version: "1.5.0"
---

# 100x-search-query

## 一句话定位
输入产品/人设卡片，输出 Pinterest / TikTok / Reddit 三平台各 15 条英文搜索短语，用于找
视觉参考素材、灵感图和对标内容。属于 100x 体系 L2 创意生成层，对应"搜索关键词"这一步。

## 何时触发
用户说：
- "帮我找参考图" / "找灵感图" / "去哪找参考图" / "给我搜索关键词"
- "what should I search on Pinterest" / "find reference images"
- "need TikTok/Reddit search terms for this product"
- 或直接给一个产品卡片 / persona 卡片，要求出一套搜索词

## 输入
最小输入（类别 A，硬性必填）：`category`（品类，自由文本，例如"保健品""家居""美妆个护"；
参考未来 `taxonomies/`，**禁止套用任何客户专属品类词典**）。**`product_name` 不是用户
必须提供的输入**——拿不到具体品牌/产品名时用 `"[品类锚点] <category>"` 占位继续跑
（`schema.json` 要求输出里的 `product_name` 必须非空字符串，那是"输出契约的必填"，
不是"用户输入的必填"，两者不是一回事）。详见 `workflow.md` Phase 1 类别 A 校验。

软性补充（类别 B，缺失走三级降级，见 `workflow.md` Phase 1）：`core_benefit`、
`target_audience`、`brand_tone`、`topic_angle`（`default`/`aesthetic`/`pain-driven`/
`sales-push` 之一）。

上游可选产出（类别 C，缺失静默跳过，不阻塞，也绝不要求用户先跑别的 skill）：persona
卡片、insight 结果、爆点结果。**若提供，则必须真正影响生成**——2C 阶段至少 6 条
要体现 persona 的具体受众/身份角度，不能只是收下卡片但产出跟没给一样，详见
`workflow.md` Phase 1 步骤 4 / Phase 2 相应段落。

## 输出
结构见 `schema.json`：`queries.pinterest/tiktok/reddit` 各 15 条 `{q, intent_cn, stage}`，
`meta.based_on_5a` 声明本次 5A 覆盖。拿到类别 C（persona/insight）输入时，
`meta.persona_informed` 须为 `true` 且 `meta.persona_descriptor_terms` 须列出从卡片摘取
的具体受众/身份用词，否则不算合规产出（公理 5）；没拿到类别 C 输入时两个字段都可以
省略。可选再渲染 3 张 Markdown 表（每平台一张，列：`#` / `query` / `search_intent_cn` /
`5a_stage`）。

## 核心约束（5 条公理，详见 `axioms.md`）
1. 每平台正好 15 条，全英文 ASCII，少 1 条或混中文 = 作废
2. 平台差异化锁死：Pinterest 美学词 / TikTok hashtag+梗词 / Reddit 痛点问句，串台作废
3. 基于 5A 意图分层生成，`meta.based_on_5a` 必填非空，45 条覆盖 ≥3 个阶段
4. 每条必带 ≤20 字中文搜索意图注释，格式必须是"闭集类别标签+纯中文说明"（已知限制：
   这是**格式校验**，能挡住"整句照抄英文翻译"，但挡不住"贴合法标签壳、内容仍是逐字
   直译"这种更隐蔽的情况，例如给直译内容随手配一个"质疑:"前缀就能通过——这是已知
   语义缺口，不是"保证零直译"，见 `axioms.md` 公理 4 TODO）
5. 拿到 persona/insight 输入就必须真的体现在产出里：
   `persona_informed=true` 时，45 条里至少 6 条要命中 `persona_descriptor_terms`
   声明的具体受众/身份用词，否则作废（已知限制：词表判据挡不住"敷衍地摘几个过宽泛的
   词凑数"，只能挡"完全没用"，见 `axioms.md` 公理 5）

**边界（无例外）**：无论产品文案源语言是什么（支持英文与西语等多语种输入），
输出搜索词**始终是英文**——这是公理 1 的直接推论，不是额外限制。**没有非英文版本这个
选项**：输出短语严格受 `schema.json` 的 ASCII 强校验约束，无非英文产出分支。

## 三阶段流程
详见 `workflow.md`：Phase 1 接收+校验（类别 A/B/C） → Phase 2（5A 分配 → 平台桶生成 →
逐条自检 → 批量自检） → Phase 3 用户触发的返工（L1 单条 / L2 单桶 / L3 全体；**没有
L4**——公理 1 对非英文输出无例外，见上方"边界"）。

## 独立调用保证
类别 A 缺失（即 `category` 缺失——`product_name` 拿不到具体品牌名不算类别 A 失败，
见上方"输入"一节）→ 固定拒绝话术追问，不代猜、不编造。绝不要求用户"先跑其他 skill"。
类别 B 缺失走三级降级（完整→追问一句→内联推断+`meta.warnings`提示）。类别 C 缺失
静默跳过。

## 禁用词
让我 / 希望 / 或许 / 大概 / 可能 / 也许 / 让我们；AI 客服味（as an AI / I'd be happy to /
feel free to）；无效美学词 attractive/beautiful/stunning/serene/pristine/elegant/
cinematic/professional/studio/flawless；不编造 subreddit（本 skill 默认不加 `r/xxx`
前缀，见 `axioms.md` TODO）；不编造效果/认证/用户见证。

## 敏感品类信号检测（内容政策护栏，已知有局限，不是公理）
本 skill 会扫描 `category`/`product_name` 以及生成出的全部 `q`/`intent_cn`，如果**同时**
命中"敏感品类信号"（如两性健康/私密护理类词及其近义词/委婉说法）和"权威宣称信号"（如
虚构 FDA/医生/专家认证类词及其近义词），**不会拒绝生成**，但会在产出的 `meta.warnings`
里强制追加固定提示，判据见 `workflow.md` Phase1 步骤6，信号词表见 `scripts/validate.js`。

**已知局限（如实说明，不是"已完全解决"）**：这是固定关键词表判据，不是语义判据，
天然有两层天花板：① 词表只覆盖常见近义词/委婉说法，任何没被收进表里的
新造词/换一种说法仍能绕过；② 只能扫描到最终产出 JSON 里存在的字段（`category`/
`product_name`/所有 `q`/所有 `intent_cn`），看不到 Phase1 当时读到的、且完全没有渗透进
这些字段的原始输入全文。**设计说明**：两个信号的扫描范围统一为全文字段扫描
（`category`/`product_name` 及最终生成的 query 和 `intent_cn` 文本），词表也补充了常见近义词
（这只是缩小口子，不是堵死）。不能宣称"扩表就能堵死"——如果需要更强保证，需要语义层检测，
这和公理4 TODO 的"格式锁 vs 语义锁"天花板是同一类问题。

## 路由（推荐，非强依赖）
- 已有产品但缺品类/卖点画像 → 人设/画像类 skill（若已建）
- 想把搜索到的素材转成生成提示词 → 提示词组装类 skill（若已建）
- 想做媒介裂变而不是找参考图 → 视觉裂变类 skill（若已建）
- 想回入口重新分诊 → 100x 体系总入口（若已建）

以上均为"产出后按需推荐"，不是前置依赖；对应 skill 尚未建好时不影响本 skill 独立工作。

## 出厂自检
运行 `node scripts/validate.js --selftest` 验证。公理 2/3 是跨条目聚合规则，`schema.json`
（vanilla JSON Schema）表达不出来，真正执行判定的是 `scripts/validate.js`：
```
node scripts/validate.js <bundle.json> [bundle2.json ...]   # 校验产出
node scripts/validate.js --selftest                          # 跑内置回归用例
```

## 来源
本 skill 方法论基于灵感搜索方法论体系，采用自包含设计（包含 `axioms.md`、`workflow.md`、`sources.md`、`schema.json` 与校验脚本），不依赖外部私有路径，不含私有数据。逐项演进说明见 `sources.md`。
