# 100x-search-query · 核心约束（公理）

> 4 条公理的骨架（数量+语言 / 平台差异化 / 5A 分层 / 中文意图）对齐灵感搜索方法论公理 1-4，出处指向本 skill 自带的 `schema.json` + `scripts/validate.js`（四件套自包含）。

---

## 公理 1：每平台正好 15 条，全英文

**一句话**：三平台各15条纯英文，少条或混中文作废。（20 字）

**可验证**：
- `len(queries.pinterest)==15 && len(queries.tiktok)==15 && len(queries.reddit)==15`
  —— `schema.json` 用 `bucket15.minItems/maxItems=15` 硬锁
- 每条 `q` 匹配 `^[\x00-\x7F]+$`（ASCII，含 # 和数字）—— `schema.json#/definitions/query_item/properties/q` 硬锁
- 以上两条 `schema.json` 本身就能拦住，`scripts/validate.js` 复读一遍做二次保险（防止有人绕过 schema 校验直接产出）

**出处**：
- 灵感搜索规范公理 1（基于 `queries.{pinterest,tiktok,reddit}` 各 15 条纯英文、可直接搜索的规则）
- 关键规范：全英文（搜索引擎用）+ 带搜索意图说明

**反例（作废）**：
- pinterest 13 条 → 数量不足，废
- 出现中文搜索词（如混入品类中文词）→ 混入中文，废
- reddit 加 2 条凑 17 → 数量溢出，废

**边界（无例外）**：源产品文案是西语/中文时，输出搜索词
**依然全英文**，不做语种平移；`meta.source_language_note` 只做记录，不改变本条判据。
**公理 1 没有例外**——不管用户怎么要求，本 skill 不产出非英文版本。真要支持非英文搜索词，
需要新开一个 skill 或等 schema.json 升级版本，不在本 skill 范围内。

---

## 公理 2：平台差异化锁死

**一句话**：三平台词库互斥，串台作废。（13 字）

**可验证**（关键词表见下方"关键词表披露"）：
- Pinterest 15 条 ≥10 条含 `PINTEREST_WORDS` 任一关键词
- TikTok 15 条 ≥8 条 `#` 开头，或 ≥10 条含 `TIKTOK_FORMAT_WORDS` 任一关键词
- Reddit 15 条 ≥10 条含 `REDDIT_QWORDS` 任一关键词，**且 0 条含 `REDDIT_BANNED_WORDS`**
- 上面三条**不是** `schema.json` 能表达的（vanilla JSON Schema draft-07 无法对同一数组内
  "≥N 条命中某关键词集合"做跨条目聚合统计），由 `scripts/validate.js` 实际执行，
  见该脚本头部注释

**出处**：
- 灵感搜索规范公理 2（平台搜索习惯与人设/场景/Hashtag 搜索词平台分工）
- 平台分工原则：Pinterest 重美学/视觉 aesthetic，TikTok 重梗/hashtag，Reddit 重痛点/讨论

**反例（作废）**：
- Pinterest 列 `#cozy #vibes #softlife` → Pinterest 不靠 hashtag 驱动，这是 TikTok 写法
- TikTok 列 `vintage cozy bedroom aesthetic` → 这是 Pinterest 写法
- Reddit 列 `mint rat repellent aesthetic inspo` → Reddit 不靠美学词
- 用不确定是否存在的 `r/xxx` 具体子版 → 编造风险，改用不带 r/ 前缀的泛指问句（见 `workflow.md` 批量自检）

### 关键词表披露

`inspiration/axioms.md` 原版公理 2 的三个关键词表和本 skill 实际使用情况有调整。
以下是逐项对照与设定理由，本版保留这些调整，因为实测发现原版判据在特定类目下有具体问题：

| 平台 | 原版 inspiration | 实际使用 | 差异 | 理由 |
|---|---|---|---|---|
| `PINTEREST_WORDS` | aesthetic/inspo/mood/cozy/minimal/styling/outfit/decor/ideas | 原版 9 个 + **routine、self-care** | +2 | 在保健品类目测试中，天然没有 decor/outfit 能用的家居美学落点；不补 routine/self-care，健康类目 Pinterest 桶密度经常卡在 8-9/15（差 1-2 条不达标），逼近阈值要频繁重写。routine/self-care 是该类目唯一天然可用的"生活方式美学"落点 |
| `TIKTOK_FORMAT_WORDS` | pov/routine/haul/grwm/viral/"tiktok made me buy"/"tiktok shop" | pov/routine/haul/grwm/**review/tiktokmademebuyit/storytime** | 删 viral、"tiktok made me buy"（三词短语）、"tiktok shop"；加 review、tiktokmademebuyit、storytime | "viral"过于泛化，几乎任何带感情色彩的内容词都可能命中，稀释判据；"tiktok made me buy"是三词短语，改成贴近真实 hashtag 写法的单 token `tiktokmademebuyit`；review/storytime 是 `workflow.md` 2C 段本身已经在描述的 TikTok 内容格式词，判据表已同步收录 |
| `REDDIT_QWORDS` | why/how/anyone else/best/vs/worth it/help/recommend | 原版 8 个 + **does it work、should i** | +2 | `workflow.md` 2C 段包含"does it work"；should i 是本 skill Ask 阶段 query 的高频真实句式（"should i try X"），收录以确保真实产出的 Reddit 桶密度合理达标 |
| `REDDIT_BANNED_WORDS` | aesthetic/inspo/mood | aesthetic/inspo（**删 mood**） | -1 | 见公理 2 反例段下方"mood 假阳性"专项说明 |

**mood 假阳性说明**：保健品类目的正常 Reddit 问句会合法使用
"mood"这个词，例如 `does magnesium help with mood swings` 是完全正常的健康类 Ask
阶段问句，不是"Reddit 桶混入美学词"。若判据设为"0 条含 aesthetic/inspo/mood"会把这条
误杀。因此 `REDDIT_BANNED_WORDS` 只保留 `aesthetic`/`inspo`（这两个词在
Reddit 语境里确实罕见且基本只出现在误用 Pinterest 写法时），不检测 `mood` 单词命中。

---

## 公理 3：基于 5A 意图分层，meta 必填

**一句话**：每条标5A阶段，汇总字段必填非空。（17 字）

**可验证**：
- 每条 query 的 `stage` 字段落在 `Aware/Appeal/Ask/Act/Advocate` 枚举内——`schema.json`
  用 `enum` 硬锁，这部分 schema 能管
- `meta.based_on_5a` 字符串非空，格式如 `"Aware+Ask"` / `"Act"`——`schema.json` 用
  `required` + `minLength:1` 硬锁，这部分 schema 也能管
- **45 条覆盖至少 3 个 5A 阶段（不允许 45 条全部同一阶段）——这条 `schema.json`
  管不住**：JSON Schema draft-07 没有"统计三个数组里所有 `stage` 值的并集基数 ≥3"
  这种跨条目聚合能力，逐条校验 `stage ∈ enum` 并不能阻止"45 条全部合法地等于
  `Advocate`"这种文档通过 schema 校验。这条由 `scripts/validate.js` 实际统计三桶 `stage` 值的
  去重集合大小并断言 ≥3，脚本里有对应这个具体反例的回归用例（`--selftest` 模式）

**出处**：
- 灵感搜索规范公理 3（基于 `meta.based_on_5a` 字段定义、市场阶段辨认与 5A 映射机制）
- 5A 定义继承自工作流子步骤 2A（见下）

**5A 映射（沿用 inspiration 骨架）**：
- **Aware**（觉察）：品类大词，用户还不知道有解法。`best warm blanket` / `why am i always tired`
- **Appeal**（感兴趣）：aesthetic/vibe/mood 驱动。`cozy morning routine aesthetic`
- **Ask**（咨询）：对比/评价/机制/是否有效。`magnesium vs melatonin sleep`
- **Act**（行动）：购买意图/点评/开箱。`honest review tiktok shop`
- **Advocate**（分享）：UGC/晒单/推荐链。`haul tiktok made me buy`

**反例（作废）**：
- `meta.based_on_5a: ""` → 空值，废
- 45 条全部标 `stage: "Advocate"`（清一色一个阶段）→ 单一阶段，废——**这条 `schema.json` 拦不住，`scripts/validate.js --selftest`
  已复现并确认脚本能正确判它 FAIL**
- `stage: "成熟期"` → 非枚举值，`schema.json` 会直接拒绝（这条 schema 本身就能拦）

---

## 公理 4：每条 query 带中文搜索意图注释

**一句话**：每条配≤20字中文类别意图，禁直译。（18 字）

**可验证**：
- `intent_cn` 非空，长度 ≤20——`schema.json` `maxLength` 已锁
- `intent_cn` 必须匹配正则：
  ```
  ^(共鸣|决策前|决策|叙事|场景灵感|场景|对比|情绪认同|情绪|方法求解|求助|求推荐|
  泛用|生活方式|痛点|种草|视觉参考|购买前|购买后|身份认同|陈列|预期管理|风险确认|
  验证|质疑):[一-龥，、/0-9]+$
  ```
  即：**闭集"意图类别标签"（25 个，来自本 skill 实际产出内容归纳，不是凭空定义——
  见下方"标签来源"）+ 冒号 + 纯中文说明（不含 ASCII 字母）**。这条正则已经写进
  `schema.json` 的 `intent_cn.pattern`，`scripts/validate.js` 直接读取同一个
  `intent_cn.pattern` 编译使用（不是复制一份，是同一份，不会两处失同步）

**标签来源（诚实记录，不是拍脑袋定的）**：这 25 个标签是从实际产出的
`intent_cn` 内容里跑脚本提取前缀得到的，不是先定义枚举再套内容。在样本提取时得到高频分类：
如 `质疑`（骂点/伪造认证类 Reddit 反例 query 的天然分类）、`购买后`（"购买前"的自然对称词）。
对重复度较高的一次性写法，做法是把内容改写成已有标签而不是让枚举无限膨胀
（例如"求经验"改写成"共鸣"，"身份梗"改写成"身份认同"）。

**格式锁设计说明**：
为了保证判据是确定且机器可验证的，采用**闭集类别标签格式锁**：
1. 纯正则可判，不需要任何翻译词典，机器可验证性是完整的、不是近似的；
2. 格式锁能排除"整句照抄 q 字面翻译"这种最粗暴的直译（`q` 的字面翻译不会自然长成
   "决策前:···"这种格式）。**但格式锁排除不了"贴合法标签壳、冒号后内容仍是逐字直译"
   这种更隐蔽的退化情况**——例如 `q="does this supplement actually work"` 配
   `intent_cn="质疑:这个补剂真的有效吗"`，标签在闭集里、长度合法、纯中文，正则会判
   PASS，但冒号后的内容本质上还是 `q` 的逐字翻译，没有做真正的"意图归类"。这是已知
   语义缺口，不是"格式锁=语义锁"，`SKILL.md` 对用户的措辞同步加了诚实限定（不能承诺
   "禁直译"这个结果，只能承诺"格式必须是类别标签"这个过程）；
3. 冒号后禁止 ASCII 字母，杜绝把英文原词整段抄进 `intent_cn` 的退化情况（`scripts/validate.js
   --selftest` 里有这个反例的回归用例）。
4. 这些标签不是拍脑袋定的枚举，是从真实写出的 query 里跑脚本提取出的真实前缀集合。

**TODO（可选二级增强）**：如果未来要在"格式锁"之外再叠加一层"语义重合度"
判据，需要先建一份英中关键词对照表，再加"`q` 命中词的中文直译在
`intent_cn` 中出现比例 >0.6 判定为直译"的规则。当前格式锁零维护成本且
100% 机器可验证，先不做额外词典层。

**出处**：
- 灵感搜索规范公理 4（要求每条搜索短语附带搜索意图说明）
- 范式来源于"类别:说明"的标准写作格式（如"痛点:···"），将其闭集标签化以支持确定性验证

**反例（作废）**：
- 只吐英文 query 无注释 → 整份作废
- `intent_cn` 写成英文 → 违反"中文注释"，也会被新正则直接拒绝
- `intent_cn` 超过 20 字 → 超长，重写
- `intent_cn` 不以 23 个闭集标签之一开头（例如自造一个"为什么不行:···"）→ 格式不符，
  正则直接拒绝，重写为闭集标签之一
- `intent_cn` 冒号后混入英文（例如"生活方式:日常活力vlog"）→ 正则拒绝；已改写为纯中文

---

## 公理 5：给了 persona/insight 输入，就必须真的体现在产出里

**一句话（19 字）**：拿到人设卡片却不影响产出=没读，判失败。

**可验证**：
- `meta.persona_informed`（boolean）+ `meta.persona_descriptor_terms`（string[]）——
  `schema.json` 声明了这两个字段的类型，ajv 能管"类型对不对"
- **但"`persona_informed=true` 时 `persona_descriptor_terms` 是否非空、以及 45 条里是否
  真的有 ≥6 条命中这些词"——这是跨字段+跨条目的聚合判断，schema.json 结构上表达不
  出来**，由 `scripts/validate.js` 的 `personaInformedCheck` 实际执行：
  1. `persona_informed === true` 但 `persona_descriptor_terms` 为空或缺失 → 直接判
     失败（声称"用了人设"却不给出用了什么词，无法核实，视为不合格）
  2. 统计 45 条 `q`+`intent_cn` 合并文本里，命中 `persona_descriptor_terms` 任一词
     （大小写不敏感子串匹配）的条目数，`<6` → 判失败
  3. `persona_informed` 为 `false` 或字段整体缺失 → 跳过这条检查（没给人设卡片时，
     这条公理不适用，不能拿"没材料"倒扣分）

**出处**：架构设计规则。若上游给出 persona/insight 输入，如果只把 persona 当纯标签而不真正驱动生成，会导致输入与生成脱节。在引入人设卡片后，必须设计生成逻辑去真正消费这张卡片。

**已知局限（如实披露，不是自我表扬）**：
- 词表判据不是语义判据——`persona_descriptor_terms` 由执行 skill 的 agent 自报（从
  persona 卡片里现场摘取），如果摘取了过于宽泛的词（例如把"女性"当作 descriptor
  term），词表命中会很容易凑够 6 条，但内容实际上没有真的做到"具体到这个人设"——这
  条检查能拦"完全没用"，拦不住"敷衍地用"，跟公理 4 TODO 里"格式锁挡不住贴标签壳的
  直译"是同一类天花板。
- `persona_descriptor_terms` 该填什么词、该填几个词，本 skill 自己不做强制——上游
  卡片给的字段名/内容详略程度不一，交给 agent 在 Phase 1 步骤 4 现场摘取，没有一个
  跨 skill 共享的字段名约定。

**反例（作废，对应 `--selftest` 第 12/13 项）**：
- `persona_informed: true` + `persona_descriptor_terms: ["postpartum recovery",
  "new mom"]`，但 45 条 `q`/`intent_cn` 全部是通用品类词、一条都没命中 →
  `scripts/validate.js` 判 FAIL（第 12 项）
- 同一份 bundle，把其中 6 条 `q` 换成含 "postpartum"/"new mom" 的表述 → 命中数达到
  6，判 PASS（第 13 项，证明这条检查是真的按命中数算，不是"这个字段一律判不过"）

---

## 为什么是这 5 条，不多不少

公理设计说明：数量+语言是结构基础、平台差异化是核心生成逻辑、5A 分层保证非随机枚举、中文意图是给人用的实际价值。"不重复"和"禁用词"降级为 `workflow.md`/`SKILL.md` 的自检项而非公理，"来源追溯"因输入信息量可能很薄（只有产品名+品类）而不升公理，见 `sources.md`。第 5 条确保输入的 persona 产生实际影响——避免 `persona_informed`/`persona_descriptor_terms` 沦为未经验证的装饰字段，保持与公理 1-4 一致的严格可验证性。

## TODO（需人工复核）

- [ ] TODO：Reddit subreddit 存在性目前仍靠 LLM 内生知识判断，本 skill 建议在
  query 里不加 `r/xxx` 前缀，需要下游确认这个保守化是否可接受。
- [ ] TODO：公理 4 的格式锁只保证`intent_cn`的**格式**合法（闭集标签+冒号+纯中文），
  不保证冒号后的中文不是"贴标签壳的逐字直译"——例如`q="does this supplement actually
  work"`配`intent_cn="质疑:这个补剂真的有效吗"`能合法通过正则，但语义上仍是直译。
  要堵住这个漏洞需要"英中语义重合度"二级判据（见上方公理4 TODO段），需要先有一份
  英中词典才能做，暂不实现，`SKILL.md`已加对应的诚实限定。
- [ ] TODO：`PINTEREST_WORDS`/`TIKTOK_FORMAT_WORDS`/`REDDIT_QWORDS`/`REDDIT_BANNED_WORDS`
  四张表目前主要在保健品与家居类目样本上验证过，跨更多类目（3C/美妆/服饰）后这些词表可能需要再调，调整时必须同步改
  `axioms.md`（本文件）+ `scripts/validate.js` 两处，不能只改一处。
- [ ] TODO（跨文件指针，不在本文件展开）：敏感品类信号检测
  （`workflow.md` Phase1 步骤6 + `scripts/validate.js` `sensitiveCategoryCheck`）不是
  本文件的公理之一（不是数量+语言/平台差异化/5A分层/中文意图这4条骨架里的任何一条），
  是独立的内容政策护栏，出于职责边界考虑不在本文件展开正文。信号 A、信号 B 均扫描
  `category`/`product_name` 及最终生成的 `queries.*.q`/`intent_cn`，且信号词表覆盖了常见
  近义词/委婉说法，但固定关键词表判据天然挡不住表外的新造词/换一种说法——**这条护栏不能宣称"扩表就能堵死"**，
  详细能力边界见 `SKILL.md`"敏感品类信号检测"一节和 `workflow.md` Phase1 步骤6。
