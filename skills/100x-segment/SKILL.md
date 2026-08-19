---
name: 100x-segment
description: Split a TikTok/UGC voiceover script (English or Spanish plain text)
  into three independent cut layers -- paragraph-logic modules + script archetype,
  predicted shot purpose, and inline breath-mark annotations. Use when the user
  asks to "帮我分段", "这条脚本怎么分段", "拆一下这条口播文案", "这段哪里该喘气",
  "segment this script", "break this voiceover into beats", or gives a spoken-word
  ad script and wants it split into modules/beats with breathing marks.
metadata:
  author: 100x
  version: "1.0.0"
---

# 100x-segment

## 一句话定位
输入一段 TikTok/UGC 口播脚本纯文本（英语或西语），输出三层独立叠加的切分结果：
L1 段落逻辑（10 模块 + 7 原型）、L2 镜头目的预判、L3 行内气口标记。属于 100x 体系
"1 分段"这一步。

## 何时触发
用户说：
- "帮我分段" / "这条脚本怎么分段" / "拆一下这条口播文案" / "这段哪里该喘气"
- "segment this script" / "break this voiceover into beats"
- 或直接给一段口播脚本纯文本，要求"按模块拆" / "标一下气口" / "这段应该怎么切"

## 输入
最小输入（类别 A，硬性必填）：`source_text`——一段口播脚本/文案纯文本。**本
skill 不接视频文件/视频帧**，只吃文本（详见 `workflow.md` Phase 1）。

类别 B（软性输入）：无——`source_text` 本身已包含分段所需的全部信号，不需要
额外补卖点/受众/语气才能开始工作（和 `100x-persona` 结构一致，和
`100x-search-query` 不同，详见 `workflow.md`"类别 B 说明"）。

语言范围（v1 明确边界，非降级）：`language` 从 `source_text` 自动判定，只接受
英语或西语；判定为其他语言或英西混排到无法判定主语言时直接拒绝，不猜、不代做。

上游可选产出（类别 C，缺失静默跳过，不阻塞，也绝不要求用户先跑别的 skill）：
本仓目前没有可作为上游的产品画像/选题材料类 skill 产出。

## 输出
结构见 `schema.json`：`source_text`/`language`/`archetype`（7 原型 A-G，单一或
"主+辅"复合如 `"G+E"`）/`segments[]`（每项含 `segment_id`/`module`[10 枚举]/
`raw_text`/`text_annotated`[压了 `‖`强气口`·`弱气口的行内标记版本]）/`shots[]`
（每项含 `shot_id`/`segment_refs`[]/`shot_purpose`[7 枚举标准定义]）/`meta`。可选再渲染一张人类可读的 Markdown 段落表。

## 核心约束（4 条公理，详见 `axioms.md`）
1. `segments[].module` 锁 10 枚举（11 模块去掉贯穿全文的 Localization）+
   `archetype` 锁 7 原型格式（单一或"主+辅"两个不同字母）
2. 气口是行内标记，只加不减——`text_annotated` 去掉 `‖`/`·` 后必须与 `raw_text`
   逐字相同，不许删词/加词/改词
3. 气口强弱判据已锁死（转折连词开头>句末标点/破折号>逗号分号，一口气 EN 14 词/
   ES 16 音节强制切分），按固定优先级判定，不可自由发挥（已知局限：EN `so`
   同时有"转折/因果连词"和"程度副词/强调词"（`so much`/`so many`）两种用法，
   纯关键词匹配区分不了，只排除了"so much"/"so many"这个最常见搭配，其他
   强调用法仍可能被误判成转折连词、强制要求强气口——这条是**硬性 fail 判据**
   而不是软性 warning，误判代价比下面这条更高；填充词后接、价格数字前不标
   气口这两条是启发式关键词匹配，不是真语义判断，`like` 的介词/填充词歧义
   会造成一定误报率，只做 warning 不 fail，见 `axioms.md` 公理3 TODO；句末
   标点判据用固定、非穷举的缩写词典（`a.m.`/`p.m.`/`Mr.` 等）排除常见缩写
   句点，已在真实英语语料上确认修好这几个具体缩写，但词典之外的缩写仍会
   误判为句末；另外，句末标点与下一词零空格粘连（漏打空格）目前只对 `!`/`?`
   判定为缺失气口，`.` 出于避免和缩写/小数点冲突的考虑仍要求真实空白字符，
   零空格粘连的 `.` 暂不触发判据，均见 `axioms.md` 公理3 TODO）
4. `shots[].shot_purpose` 锁 7 枚举标准定义，且必须完整
   覆盖 `segments[]`（引用完整性 + 零孤儿，已知局限：本 skill 纯文本输入，
   `shots[]` 只预判镜头目的，不含 `time_bucket`/`visual_description`/
   `camera_language`/`audio_plan`——这些字段依赖实际视频画面，不在本 skill
   范围内）

**适用边界**：11 模块/7 原型骨架取自 TikTok 美区 DR 保健品口播蓝图，
对其他文案结构（剧情向/访谈向等非 DR 私域带货类脚本）的适用性未经验证。

## 三阶段流程
详见 `workflow.md`：Phase 1 接收+校验（类别 A + 语言范围校验，无类别 B，类别 C
静默跳过） → Phase 2（2A 段落切分 → 2B 镜头目的预判 → 2C 气口标注 → 2D 自检
S1-S8+渲染） → Phase 3 用户触发的返工（L1 段落层/L2 镜头层/L3 气口层三级
粒度，直接对应三层切点）。

## 独立调用保证
类别 A（`source_text`）缺失 → 固定拒绝话术追问，不代猜、不接受视频文件替代。
语言判定超出英西范围 → 固定拒绝话术，不猜、不路由。类别 C（上游产出）缺失 →
静默跳过，**绝不要求用户先跑其他 skill**。

## 禁用词
让我 / 希望 / 或许 / 大概 / 可能 / 也许 / 让我们；AI 客服味（as an AI / I'd be
happy to / feel free to）；不编造脚本原文没有的模块内容/效果/认证/见证；不写死
任何客户品类词典；`text_annotated` 不允许删改 `raw_text` 的任何字词（见公理2）。

## 路由（推荐，非强依赖）
- 已分好段，想给每段配人物/场景 → `100x-persona`（`pairings[].segment_ref` 可
  回填本 skill 产出的 `segments[].segment_id`）
- 想把分好的段落配上真实镜头画面/运镜/音频（需要视频输入）→ 未来公开仓化的
  分镜类 skill（若已建）
- 想先找视觉参考图/搜索关键词 → `100x-search-query`
- 想回入口重新分诊 → 100x 体系总入口（若已建）

以上均为"产出后按需推荐"，不是前置依赖；对应 skill 尚未建好时不影响本 skill
独立工作。

## 出厂自检
运行 `node scripts/validate.js --selftest` 验证。`schema.json` 声明的结构层约束
（`enum`/`pattern`/`additionalProperties`/`minItems`/`uniqueItems` 等）由
`scripts/validate.js` 内的 **ajv**（真实 JSON Schema draft-07 验证器，
`package.json` 声明的 devDependency，先 `npm install` 再跑）实际执行，不是手写
字段枚举。公理2（`text_annotated`/`raw_text` 跨字段比对）、公理3（气口强弱
优先级 + 一口气上限，需要把字符串解析成片段逐段推理）、公理4（`shots`/
`segments` 跨数组引用完整性 + 零孤儿 + 顺序编号）是四类 vanilla JSON Schema
结构上表达不出来的判据，由 `scripts/validate.js` 里的手写代码补上：
```
npm install                                                   # 首次使用先装 ajv
node scripts/validate.js <bundle.json> [bundle2.json ...]   # 校验产出
node scripts/validate.js --selftest                          # 跑内置回归用例
```

## 来源
本 skill 针对"纯文本口播脚本切分与气口标注"场景构建，包含段落逻辑（10 模块 + 7 原型体系）、镜头目的预判（7 类标准目的）以及行内气口规则体系（公理 2/3）。各判据规范与字段设计详见 `sources.md`。
