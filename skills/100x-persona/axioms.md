# 100x-persona · 核心约束（公理）

> 以下 4 条公理是基于判据风格参考与字段结构规范独立制定的核心约束。
> 逐条出处见下方"出处"段，完整披露见 `sources.md`。

---

## 公理 1：场景是独立实体，靠 ID 引用，不是人物的内嵌字段

**一句话（25 字，脚本量过）**：场景独立建实体，用ID关联人物，不当人物内嵌字段。

**可验证**：
- `schema.json` 顶层 `personas` 和 `scenes` 是两个**平级**的 map（都是 `PersonaSceneBundle`
  的直接属性），`scenes` 不出现在任何 `persona_item` 的 `properties` 里——这条 schema 本身
  就能拦住"把场景写成人物的字符串字段"这种退化写法（`additionalProperties: false` 在
  `persona_item` 上锁死，人物对象里放不进 `scene` 字段）
- `pairings[].persona_ref` 匹配 `^PERSONA_[A-Za-z0-9_]+$`，`pairings[].scene_ref` 匹配
  `^SCENE_[A-Za-z0-9_]+$`——这条格式校验 `schema.json` 能管
- **但"这个 ref 字符串实际指向的 key 真的存在于 `personas`/`scenes` 里"——这条
  `schema.json` 管不住**：JSON Schema draft-07 没有"这个字符串必须等于文档里另一个
  对象的某个 key"这种跨对象引用完整性校验能力。一份 `persona_ref:"PERSONA_GHOST"`
  格式完全合法但从未在 `personas` 里出现的文档能通过 `schema.json`。这条由
  `scripts/validate.js` 的 `checkReferentialIntegrity` 实际执行

**出处**：
- 场景与人设在数据模型中属于两个独立实体，分别具备独立的标识体系（如 `SCENE_xx` / `PERSONA_xx`）。本公理将两实体结构化为 schema 里的两个平级 map + ID 引用，保证场景独立建模，避免将场景退化为人物设定的内嵌附属字段。

**反例（作废）**：
- `persona_item` 里出现 `"scene": "浴室"` 这种内嵌字符串字段 → `schema.json`
  `additionalProperties:false` 直接拒绝，结构上不可能落地
- `pairings[0].persona_ref: "PERSONA_GHOST"` 但 `personas` 里没有这个 key → 格式合法，
  `schema.json` 会放行，`scripts/validate.js` 判 FAIL（`--selftest` 检查 2/10 是这个反例
  的回归用例）
- `pairings[0].scene_ref: "SCENE_GHOST"` 同上，`--selftest` 检查 3/10

---

## 公理 2：人物的权威/受众依据必须是原文逐字子串，不许臆造

**一句话（21 字）**：人物权威与人群证据须是原文子串，不许臆造。

**可验证**：
- `personas.<id>.authority_evidence_quote` 和 `personas.<id>.audience_pain_quote`
  非空——`schema.json` `minLength:1` 能管这部分
- **但"这段引文是不是真的一字不差地出现在 `source_script` 里，还是被改写/翻译/概括
  过"——这是跨字段比对（拿一个字符串字段去匹配文档里另一个字段的内容），`schema.json`
  完全没有这种能力（JSON Schema draft-07 无法让一个属性的取值依赖另一个属性的内容）**。
  这条由 `scripts/validate.js` 的 `checkEvidenceQuotes` 用
  `source_script.includes(quote)` 实际执行（大小写敏感、逐字符匹配，不做同义改写容忍）
- `pairings[].script_span_quote` 同样要求是 `source_script` 的字面子串，同一函数校验

**出处**：
- 判据设计原则：结论必须能倒查回原始材料的具体位置，不能脱离原文。本 skill 将这一要求落实为可自动校验的规则——引文必须是源文本的字面子串（`authority_evidence_quote` 和 `audience_pain_quote` 分别对应身份背书与受众痛点原句），确保证据链真实可追溯。
- 身份背书与痛点圈定：`authority_evidence_quote`/`audience_pain_quote` 两个字段直接对应自我身份宣称与人群点名原句。

**关于"权威"不要求正式资质**（工程说明，不是逃生舱）：真实 UGC/DR 脚本经常没有正式资质
宣称（口播文案蓝图模块 2 本身也列了"没有资质、只是长期经验"的用法空间），`authority_basis`
允许是"同理型信任"（如"产后亲身经历"）而非"专业资质"，但 `authority_evidence_quote`
**必须仍然是原文里这个人物说过的具体一句话**——不能因为"没有正式资质"就把这个字段
留空或编一句原文没有的话。`evals/` 两个例子刻意各放了 1-2 条"经历型"而非"资质型"权威
证据，验证这条路径成立。

**机制天花板与缓解措施**：
`checkEvidenceQuotes` 证明的只是"这段引文逐字出现在原文里"，证明不了"这段引文在人物字段
里的语义方向，和它在原文里的语义方向一致"——一句自我怀疑/让步转折的话（比如"如果你不信我"）
完全可能是原文逐字子串，同时被反着用当权威锚点，`source_script.includes(quote)` 对这种
滥用是瞎的。**这是字符串匹配和 JSON Schema 两层机制共同的天花板，不是加更多正则/schema
约束能修好的**——判断"这段话的真实语义方向"需要理解上下文，不是匹配子串。

`scripts/validate.js` 中的 `checkAuthorityHedgeRisk` 包含一份闭集的自我怀疑/让步式
短语表（"如果你不信我"/"if you don't believe me"/"我不确定"/"who knows" 等，仅扫
`authority_evidence_quote`，不扫 `audience_pain_quote`/`script_span_quote`，因为那两个
字段里出现否定词往往是合法内容，如"I can't sleep"）。命中不直接判 FAIL，而是要求
`meta.warnings` 里出现一条同时提到该 persona id 和"hedge"/"自我怀疑"的披露——命中且
未披露才 FAIL。这不是"检测出了反转"，是**把这一类已知滥用模式从"沉默通过"改成"必须
人工过一遍"**，`scripts/validate.js --selftest` 检查 8/10、9/10 是这条机制本身的回归
用例（分别验证"未披露判 FAIL"和"已披露判 PASS"）。

**这条缓解明确堵不住的（如实列出，不是留白）**：
- 反转不靠自我怀疑词、靠上下文框架（反讽、"有人说 X 但 X 证明不了什么"这种引用-驳斥
  结构）——闭集短语表扫不到任何自我怀疑词，照样通过。`--selftest` 检查 10/10 是这条
  盲区的真实回归用例：一份"trust me, I am a doctor"被从"某些广告为了卖货才这么说，
  但一个头衔证明不了什么"这种驳斥语境里摘出来单独当权威锚点的例子，逐字通过公理2、
  也不含任何闭集词，实测结果是 **0 errors，完全放行**
- 翻译/转写造成的反转（原文用另一种修辞表达怀疑，摘录时"恰好"避开了闭集词表里的具体
  措辞）
- 闭集词表本身未经真实语料验证覆盖率——跟公理3的泛化词表、`relationship_to_camera`
  枚举同类问题，是本次凭经验列出的，不是从真实反例统计出来的，见 `sources.md`
  "原创判断披露"

**一句话总结这次做了什么，不做什么**：没有解决"证据句语义反转"这个问题本身，把其中
一个具体、可枚举的滥用模式（自我怀疑短语反用）从"检测不到"改成"检测到了但只能强制要求
披露"，非闭集模式的反转（反讽/驳斥框架/翻译反转）依旧检测不到——这是字符串匹配能达到的
真实上限，不是本次假装修好了。

**反例（作废）**：
- `authority_evidence_quote: "I have been using this product daily for about twelve
  months"`，但 `source_script` 原文写的是"I've been a night-shift ICU nurse for eleven
  years"（改写/替换成了别的句子，不是原文子串）→ `scripts/validate.js` 判 FAIL
  （`--selftest` 检查 4/10 是这个反例的回归用例，用的正是"看起来像证据但被复述过"这种
  最容易蒙混过关的错误形态）
- `audience_pain_quote` 写成对原文的中文翻译或概括（如"熬夜倒班很痛苦"）而不是英文原句
  → 不是字面子串，同一检查判 FAIL
- `authority_evidence_quote: "If you don't believe me, that is fine"`（逐字子串，但本身
  是自我怀疑/让步式短语，未在 `meta.warnings` 披露）→ `checkAuthorityHedgeRisk` 判 FAIL
  （`--selftest` 检查 8/10）；同一引文若 `meta.warnings` 里补一条提到该 persona id 和
  "hedge"的披露，则判 PASS（`--selftest` 检查 9/10）
- `authority_evidence_quote: "trust me, I am a doctor"`，原文实为驳斥语境（"某些广告为了
  卖货才这么说，但头衔证明不了什么"）→ **当前无法检测，判 PASS**（`--selftest` 检查
  10/10 如实记录这个已知盲区，不是声称已堵住）

---

## 公理 3：场景须具体到微观坐标，不许写泛地点

**一句话（18 字）**：场景须具体到微观坐标，不许写泛地点。

**可验证**：
- `scenes.<id>.trigger_moment` / `location` / `micro_coordinate` 三个字段
  `minLength:3` 且必须匹配 `schema.json` 里的负向前瞻正则：
  ```
  ^(?!.*(某处|随便|某个地方|某场景|某个场景|某个地点|某地|某时|待定|TBD|tbd|somewhere|Somewhere|anywhere|Anywhere)).+$
  ```
  即"不含闭集泛化词表任一词"——这条纯正则，`schema.json` 自己就能拦住，
  `scripts/validate.js` 从 `schema.json` 读取同一个正则复查一遍（防止绕过 schema
  校验直接产出），不是两处各写一份可能失同步的规则
- `scenes.<id>.visual_props` 数组 `minItems:2`——至少两件具体可见道具，防止用一句
  抽象氛围词代替具体场景，这条也是 `schema.json` 直接能管

**出处**：
- 场景建模要求将"微观坐标"与"地点环境"拆分为两个独立维度，确保场景精确到具体机位与动作坐标，而非笼统地点。
- 结合真实拍摄场景的时间与地点特征，要求证据必须具象，通过泛化词表拒绝占位词，并通过至少 2 件具体道具保证画面信息充足。

**反例（作废）**：
- `trigger_moment: "某个场景下"` → 命中泛化词表"某场景"，正则拒绝
- `location: "TBD"` → 命中泛化词表，正则拒绝
- `micro_coordinate: "浴室"` 且和 `location` 内容完全重复、无具体机位信息 → 未命中正则
  （因为不在闭集词表里）但 `minLength:3` 若不够仍会被挡；即使凑够长度，这类"只是把
  location 换个说法重复一遍"的退化写法留 TODO，见文末（当前无法用正则彻底堵死"同义
  重复"这种更微妙的退化，只能堵闭集泛化词）
- `visual_props: ["道具"]`（只有 1 件）→ `minItems:2` 直接拒绝

---

## 公理 4：人物与场景零孤儿，建了必须被至少一个 pairing 引用

**一句话（16 字）**：人物场景零孤儿，建了必须被引用。

**可验证**：
- 遍历 `pairings[]` 收集所有被用到的 `persona_ref`/`scene_ref`，与 `personas`/`scenes`
  的完整 key 集合做差集，差集非空 = 存在"定义了但没人用"的孤儿实体——**这是对整份文档
  做集合运算的跨对象聚合检查，`schema.json` 完全表达不出来**（JSON Schema 没有"某个
  对象里的每个 key 都必须在另一个数组的某个字段里出现过"这种反向遍历能力）。由
  `scripts/validate.js` 的 `checkNoOrphans` 实际执行

**出处**：本条为保证输出完整性与工程严密性的设计约束。理由：100x-persona 产出供下游（拍摄/生成）使用的人物+场景清单，若存在未被引用的冗余实体，会造成执行困惑与歧义。零孤儿约束确保每个定义的人设与场景实体均有明确的脚本片段对应。

**反例（作废）**：
- `scenes` 里多定义了一个 `SCENE_ORPHAN`（内容合法、格式合法），但 `pairings[]`
  没有任何一条引用它 → `scripts/validate.js` 判 FAIL（`--selftest` 检查 5/10 是这个
  反例的回归用例）
- 同理，`personas` 里定义了一个从未被 `pairings[].persona_ref` 引用的人物 → 同一检查
  逻辑覆盖（脚本里 `checkNoOrphans` 对 personas 和 scenes 各扫一遍）

---

## 为什么是这 4 条，不多不少

- 公理 1 是**结构基础**：确立场景与人物平级的独立实体地位，避免场景被退化为附属字段
- 公理 2 是**防臆造**：人物设定最容易退化成"凭印象编一个人设"，逼着每个关键判断都能
  倒查回脚本原文，是本 skill 的诚实底线
- 公理 3 是**防空泛**：场景最容易退化成"卧室""厨房"这种没有画面感的词，逼着写到具体
  机位和至少 2 件道具，才有落地拍摄/生成的价值
- 公理 4 是**防注水**：防止为了显得"矩阵完整"而堆砌没人用的人物/场景条目，保证所有定义实体均有真实用途

不采用"人物场景必须风格匹配"（如"专家人设不能配随意场景"）作为第 5 条公理，因为
"风格是否匹配"目前尚无客观可机检的量化判据（容易退化为模糊的主观判读），故留作后续探索。

---

## TODO（需人工复核）

- [ ] TODO：公理 2 证据句语义反转目前只缓解到
  "闭集自我怀疑短语强制披露"（`checkAuthorityHedgeRisk`）——反讽/引用-驳斥框架类反转、
  翻译造成的反转仍完全检测不到，`--selftest` 检查 10/10 是这个盲区的实测证明，不是
  声称已修好。闭集短语表本身也未经真实语料验证覆盖率。如果下游反馈这是高频问题，
  下一步大概率需要引入语义层判断（人工/LLM 复核，而非纯字符串规则），但那样就要接受
  "机器可验证"这条硬约束在这一项上让步，需要用户拍板是否值得。
- [ ] TODO：公理 3 的"同义重复退化"（`micro_coordinate` 只是把 `location` 换个说法
  重复一遍，未使用闭集泛化词但同样没有信息增量）目前无法用正则拦截，需要人工抽检或
  未来补一条"`micro_coordinate` 与 `location` 编辑距离过近"的相似度判据（同样需要先
  确认阈值可靠再落地，避免重犯"重合度过高"这种没有实测阈值的模糊判据）。
- [ ] TODO："人物与场景风格是否匹配"未升公理（见上方说明），如果下游反馈这是高频问题，
  需要先找到可正则化/可阈值化的判据再补公理，不能直接上"人工/LLM 判读"。
- [ ] TODO：本次 `evals/` 只验证了"整条脚本 1-2 个人物、1-2 个场景"的规模，`personas`/
  `scenes`/`pairings` 数量变大（比如阶梯时间线型 7 段脚本对应 5+ 场景）时零孤儿检查和
  引用完整性检查的性能/可读性未实测，逻辑上是线性遍历不应有性能问题，但错误信息堆叠
  可读性未验证。
