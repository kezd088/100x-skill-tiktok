---
name: 100x-persona
description: Assign a delivering persona and an independent physical scene to a
  TikTok/UGC script draft, each traceable back to a literal quote in the script.
  Use when the user asks to "给这条脚本配个人设", "这个场景怎么设定", "这条脚本谁来讲比较合适",
  "这条广告适合什么场景拍", "who should deliver this script", "what setting fits this ad",
  "what persona fits this product", or gives a script and wants character + setting
  assignments for shooting/casting.
metadata:
  author: 100x
  version: "1.2.0"
---

# 100x-persona

## 一句话定位
输入一段脚本/文案纯文本，输出"谁来讲"（人物）+ "在哪讲"（场景，独立实体，非人物附属
字段）+ 两者如何与脚本原句绑定，三者都能逐字回指原文。属于 100x 体系 L2 创意生成层，
对应"3.1 人物×场景"这一步。

## 何时触发
用户说：
- "给这条脚本配个人设" / "这条脚本谁来讲比较合适" / "这个人设怎么定"
- "这个场景怎么设定" / "这条广告适合什么场景拍" / "这条脚本在哪拍合适"
- "who should deliver this script" / "what persona fits this product"
- "what setting fits this ad" / "where should this be filmed"
- 或直接给一段脚本文案，要求"配人物和场景" / "assign a character and setting"

## 输入
最小输入（类别 A，必填）：`source_script`——完整脚本/文案纯文本。本 skill **不接视频
文件**，只吃文本。

上游可选产出（类别 C，缺失静默跳过，不阻塞，也绝不要求用户先跑别的 skill）：
`100x-segment` 产出的 `segments[]`（若存在，`pairings[].segment_ref` 可回填，缺失时
整个字段省略，靠 `script_span_quote` 独立定位）。

## 输出
结构见 `schema.json`：`PersonaSceneBundle` = `source_script`（原文回显，供证据核对）+
`personas`（人物 map，独立实体）+ `scenes`（场景 map，**独立实体，与 personas 平级，
不是人物的字符串字段**）+ `pairings`（人物×场景×脚本原句的绑定表）+ `meta`。可选再渲染
一张人类可读的 Markdown 摘要（人物列表 / 场景列表 / pairing 对照表）。

## 核心约束（4 条公理，详见 `axioms.md`）
1. 场景是独立实体，靠 ID 引用，不是人物的内嵌字段——`personas`/`scenes` 是两个平级 map，
   `pairings[]` 里的 `persona_ref`/`scene_ref` 必须真实存在于对应 map（引用完整性）
2. 人物的权威/受众依据必须是原文逐字子串，不许臆造——`authority_evidence_quote` /
   `audience_pain_quote` / `script_span_quote` 都要能在 `source_script` 里逐字找到。
   **已知局限（不是隐藏缺陷）**：逐字子串只能证明"这句话原文有"，证明不了"这句话在
   人物字段里的语义方向没被反着用"——比如摘一句自我怀疑的话（"如果你不信我"）反着当
   权威锚点，也是合法子串。当前机制包含一层闭集自我怀疑短语检测（命中即要求人工披露，
   见 `axioms.md` 公理2），但**反讽/引用-驳斥框架类反转仍检测不到，这是字符串匹配的
   天花板**，详见 `axioms.md` 公理2"机制天花板与缓解措施"段
3. 场景须具体到微观坐标，不许写泛地点——闭集泛化词表拒收 + 至少 2 件具体道具
4. 人物与场景零孤儿，建了必须被至少一个 pairing 引用——不为了"看起来矩阵齐全"堆砌

## 三阶段流程
详见 `workflow.md`：Phase 1 人物反推（扫描脚本里的 Authority/Pain 信号，逐字摘取证据句）
→ Phase 2 场景建模（每个场景线索独立建实体 + 与人物/脚本原句绑定 + 零孤儿自检）→
Phase 3 输出（组装 JSON，公理 1-4 全过）。

## 独立调用保证
类别 A（`source_script`）缺失 → 固定拒绝话术追问，不代猜、不接视频文件替代。类别 C
（上游 `100x-segment` 产出）缺失 → 静默跳过，**绝不要求用户先跑其他 skill**。

## 禁用词
让我 / 希望 / 或许 / 大概 / 可能 / 也许 / 让我们；AI 客服味（as an AI / I'd be happy to /
feel free to）；不编造脚本原文没有的资质/认证/见证/效果数据；不写死任何客户品类词典；
`micro_coordinate` 不使用闭集泛化词（见 `axioms.md` 公理 3：某处/随便/某个地方/TBD/
somewhere/anywhere 等）。

## 路由（推荐，非强依赖）
- 已有分好段的脚本、想按段而不是整篇配人物场景 → 分段类 skill（若已建，`segment_ref`
  可回填）
- 想把人物/场景描述转成 AI 视频生成提示词 → 提示词组装类 skill（若已建）
- 想先做搜索关键词找参考图再定人物场景 → 搜索关键词类 skill（若已建）
- 想回入口重新分诊 → 100x 体系总入口（若已建）

以上均为"产出后按需推荐"，不是前置依赖；对应 skill 尚未建好时不影响本 skill 独立工作。

## 出厂自检
运行 `node scripts/validate.js --selftest` 验证。`schema.json` 声明的结构层约束（
`required`/`additionalProperties`/`enum`/`pattern`/`minItems` 等）由 `scripts/validate.js`
内的 **ajv**（真实 JSON Schema draft-07 验证器，`package.json` 声明的 devDependency，
先 `npm install` 再跑）实际执行，不是手写字段枚举。公理 1（引用完整性）、公理 2（证据
子串）、公理 4（零孤儿）是三类跨对象/跨字段聚合规则，vanilla JSON Schema 结构上表达
不出来，这三项由 `scripts/validate.js` 里的手写代码补上。此外还包含
`checkAuthorityHedgeRisk`（公理2的部分缓解，闭集自我怀疑短语命中即要求 `meta.warnings`
披露，否则 FAIL）——**这条只是缓解，不是完整修复**，反讽/引用-驳斥框架类的证据句语义
反转仍检测不到，`--selftest` 第 10 项如实留了一个"当前会放行"的真实回归用例证明这个
边界，不是声称已经堵死：
```
npm install                                                   # 首次使用先装 ajv
node scripts/validate.js <bundle.json> [bundle2.json ...]   # 校验产出
node scripts/validate.js --selftest                          # 跑内置回归用例
```

## 来源
本 skill 是基于判据风格参考与字段结构规范的独立构建。逐条判据出处、字段设计出处与设计决策，详见 `sources.md`。
