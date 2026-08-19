# 100x-prompt-compose · 核心约束（公理）

> 本 skill 包含两部分核心机制：
> ① `templates.json`（包含 14 个标准化模板）——"填表单出提示词"的机制来源；
> ② `profiles/veo.md` 与 `profiles/seedance.md`——"包装成目标模型可用格式"的规范来源。
> 下面 4 条公理是基于这两部分机制建立的核心约束。

---

## 公理 1：最终提示词须逐字替换模板正文，不得意译删减

**一句话**：最终提示词须逐字替换模板正文，不得意译删减。（22 字）

**可验证**：
- `rendered_body` 非空——`schema.json` `minLength:1` 能管这部分
- **但"`rendered_body` 是不是 `templates.json` 对应模板 `body` 字段做 `{key}` 占位替换
  后逐字节应得的结果，还是被改写/删减/新增过"——这是"拿一个字符串字段去对照另一个
  文件里的模板 + 本条目的 `variables_used` 重新算出来的期望值"，`schema.json` 完全没有
  这种能力（JSON Schema 无法读取同仓库另一个文件、也无法把多个字段函数式地拼成一个
  期望字符串再比较）**。这条由 `scripts/validate.js` 的 `axiom1Check`/
  `reconstructExpectedBody` 实际执行：加载 `templates.json`，用
  `variables_used` + 已解析的 `conditional_clauses` + `realism_suffix[suffix_key]`
  重建期望字符串，和 `rendered_body` 做严格 `===` 比较
- 附带检查：`rendered_body` 不得残留任何未替换的 `{占位符}`（正则 `/\{[a-zA-Z0-9_]+\}/`）
- 附带检查：`rendered_body` 不得包含 `resolveConditionalClauses`/
  `expandBracketInstructions` 在 `hook_type`/`effect_formula`/`layout` 缺失或取值不在
  `templates.json` 对应 library 里时产出的内部哨兵字符串（`__UNRESOLVED_HOOK_TYPE__`/
  `__UNRESOLVED_EFFECT_FORMULA__`/`__UNRESOLVED_LAYOUT__`）。这条附带检查存在的原因：
  这些哨兵不含花括号，上一条"未替换占位符"正则抓不到它们；而且
  `reconstructExpectedBody` 会把同样的哨兵字符串当成"重建出的期望值"，导致一个
  手写、原样抄了哨兵串的 `rendered_body` 能和"期望值"逐字节相等，从而绕过
  `axiom1Check` 的严格 `===` 比较
  （见 `--selftest` 检查 13/16、14/16，`scripts/validate.js` 里
  `UNRESOLVED_SENTINELS` 常量与 `axiom1Check` 内的独立扫描）

**出处**：
- `templates.json` `meta.how_to_integrate` 原文："body 用 {key} 做字符串插值；末尾自动拼 realism_suffix"——这是机械插值而非自由改写的直接依据。
- 判据设计原则：结论必须能倒查回原始模板进行逐字校验，保证生成结果与模板定义精确一致。
- VID-A/VID-F/PART-HOOK 的方括号占位（【效果公式：…】【按 hook_type 选骨架】）属于作者态占位，渲染时应整体替换为对应描述句，避免指令性文字进入最终提示词。详见 `templates.json` `meta.render_notes`。
  喂给 AI 模型的最终提示词里），详见 `templates.json` `meta.render_notes` 和
  `sources.md`"原创判断披露"

**反例（作废）**：
- `rendered_body` 写成"A clean white studio product photo of a spray bottle."
  这种意译改写（哪怕语义上"差不多"）→ 和模板 `body` 逐字重建结果不一致，`axiom1Check`
  判 FAIL（`--selftest` 检查 4/16）
- `rendered_body` 里还留着"{product_desc}"这种未替换的占位符 → 判 FAIL
- 用了正确的 `template_id`，但 `category` 字段和 `templates.json` 里该模板真实
  `category` 不一致（比如把一个"视频"模板标成"图片"）→ `axiom1Check` 判 FAIL
- `PART-HOOK` 不给 `hook_type`（类别 A 硬性必填变量），`rendered_body` 手写成
  `__UNRESOLVED_HOOK_TYPE__` 打头的字符串 → 判 FAIL（`--selftest` 检查 13/16）
- `VID-A-efficacy-stack`/`VID-F-dark-humor` 不给 `effect_formula` → 判 FAIL
  （`--selftest` 检查 14/16；同一条 `expandBracketInstructions` 代码路径，
  VID-F 未另外单测，见 axioms.md 末尾 TODO）

---

## 公理 2：参考图编号引用须指向已声明的锁，不可虚指

**一句话**：参考图编号引用须指向已声明的锁，不可虚指。（21 字）

**可验证**：
- `reference_locks[].value` 若 `status` 是 `reference_reuse`，必须逐字匹配
  `^参考图\d+(产品|人物)$`；若 `status` 是 `first_lock`，必须**不**匹配这个格式——
  这两条格式判据是 `schema.json` 用 `if/then/else` 直接锁死的（JSON Schema draft-07
  的 if/then 组合可以做到"某字段等于某常量时，另一字段必须/不得匹配某正则"，这部分
  schema 管得住）
- **但"这条 `reference_reuse` 指向的编号 N，是不是真的在本次调用之前已经建立过"——
  这需要拿 `value` 里正则捕获出来的数字，去和 `meta.existing_refs_input`（上游传入的
  已建立编号集合）或同一 bundle 里更早的 `first_lock` 条目做集合成员判断，JSON Schema
  没有"捕获组数值 vs 文档其他位置的数组"这种跨字段比较能力**。这条由
  `scripts/validate.js` 的 `checkReferenceLockIntegrity` 实际执行，逻辑上和
  `100x-persona/axioms.md` 公理 1 的"`persona_ref`/`scene_ref` 必须真实存在于
  `personas`/`scenes` 里"是同一类referential integrity检查，只是这里引用目标是
  "已建立的编号集合"而不是"另一个 map 的 key 集合"
- 每次调用结束后 `meta.established_refs_after` 必须等于
  `existing_refs_input ∪ 本次新建立的 first_lock 编号`——同样是集合运算，`schema.json`
  管不了，`checkReferenceLockIntegrity` 一并核对
- **变量内引用与台账一致性检查**：除检查 `reference_locks[]` 数组自身外，
  `checkReferenceLockIntegrity` 无论 `reference_locks` 是否为空，都会扫描
  `variables_used` 的**全部**字符串值键，只要值里嵌有"参考图N产品/人物"格式字样，
  就核对 N 是否真实存在于 `meta.existing_refs_input`，并核对 `reference_locks[]`
  里是否有对应的 `status:"reference_reuse"` 条目记录了同一个 N——两个数据来源
  （渲染正文引用的编号 vs 结构化锁台账）不允许互相漂移。`LOCK_REF_VARIABLE_ENTITY`
  用于校验已知键名（如 `product_lock`/`persona_ref`）对应的实体是否和文本自称的
  实体一致。这依然是 `checkReferenceLockIntegrity` 职责范围内的跨字段/跨数组比较，不是新公理，
  `schema.json` 依旧管不了（见 `scripts/validate.js` `scanVariablesUsedForRefClaims`
  的 banner 注释、`--selftest` 检查 16/16）

**已知边界（如实披露，不是"反例"——这类输入目前仍然会通过，未被拒绝）**：
`templates.json` `meta.hard_rules` 第 2/3 条要求的其实是"外观描述本身内容具体、
完整"（产品需含颜色/形状/材质等要素，人物需含年龄+种族+性别+穿着+外貌五要素），
这是自然语言语义完整性判断。本条公理验证的只是"格式"和
"编号引用是否真实存在"，完全不验证"这段文字内容是不是真的具体描述了产品外观/人物
五要素"。用一段空洞占位文字（如 `persona: "a person"`、`product_lock: "a thing"`）
一样能通过 `ajv` 和 `checkReferenceLockIntegrity`——因为判据只看"字符串非空+格式对不对
+编号存不存在"，不看语义内容；本次评估过用最短长度/是否含数字等启发式去堵这个口子，
但 `templates.json` 自己的 `persona` 示例值（如"约45岁白人男性"，7 个字符）和这次
反例文本（如"a person"，8 个字符）长度量级相近、跨中英文字符信息密度又不可比，找不到
一个不会同时误杀合法短示例、又能拦住这次反例的可靠长度/含数字阈值，属于"发明一个
不可靠的启发式反而制造虚假安全感"，故本次选择不做（不代笔编方法论：宁可如实披露
缺口，不假装已经堵住）。这条内容完整性检查目前完全依赖调用者纪律（`workflow.md`
Phase 1 步骤 2"缺失时追问、不脑补"），已如实写进 `SKILL.md` 核心约束第 2 条括号里，
不藏在内部 TODO 里带过。

**出处**：
- `templates.json` `meta.hard_rules` 第 2/3 条原文："产品首次出现必须锁外观（参考图
  或 文字描述）；后续写「参考图X产品」""人物首次出现必须锁 年龄+种族+性别+穿着+外貌；
  后续写「参考图X人物」"——这是"首次描述 vs 后续引用必须用固定写法"这条规则本身的
  直接依据
- 判据设计采用引用完整性检查思路，确保引用的参考图编号真实有效。
- "首次锁 vs 后续引用"的编号追踪机制（`existing_refs_input`/`established_refs_after`
  跨调用传递）用于机器自动化验证参考图引用完整性。

**反例（作废）**：
- `reference_locks[]` 里一条 `value` 写"参考图3产品"、`status:"reference_reuse"`，
  但 `meta.existing_refs_input.产品` 里没有 `3`（从未建立过）→
  `checkReferenceLockIntegrity` 判 FAIL（`--selftest` 检查 5/16；这条检查对象是
  `reference_locks[]` 数组条目本身，不是 `variables_used.product_lock`——下一条
  才是直接检查 `variables_used.product_lock` 本身的反例）
- `variables_used.product_lock` 直接写"参考图99产品"，但 `reference_locks` 留空
  数组、且 `meta.existing_refs_input.产品` 里没有 `99` → `checkReferenceLockIntegrity`
  判 FAIL（`--selftest` 检查 12/16）
- `first_lock` 条目的 `ref_number` 和 `existing_refs_input` 里已有的编号冲突（比如
  编号 1 已经建立过产品锁，又建一个新的 `first_lock` 编号也是 1）→ 判 FAIL
  （`--selftest` 检查 6/16）
- `reference_locks[].value` 写"参考图1人物"但 `entity` 字段填的是"产品"（数值和实体
  对不上）→ 判 FAIL
- `IMG-04-cover-hook`（无 `establishes_lock`/`references_lock`声明的模板）的
  `variables_used.persona` 写"参考图77人物，与之前完全一致"，`meta.
  existing_refs_input.人物` 里没有 `77`，`reference_locks` 留空数组 →
  `checkReferenceLockIntegrity`/`scanVariablesUsedForRefClaims` 判 FAIL
  （`--selftest` 检查 16/16）

---

## 公理 3：场景变量禁止写光线词，光线由后缀统一控制

**一句话**：场景变量禁止写光线词，光线由后缀统一控制。（21 字）

**可验证**：
- `variables_used` 里键名匹配 `scene`/`scenes`/`place`/`rooms`（`templates.json`
  `variable_glossary` 里出现的全部场景类变量键名）的值，必须匹配 `schema.json`
  `patternProperties` 里的负向前瞻正则（闭集光线词表：明亮阳光/柔和灯光/柔光/暖光/
  冷光/逆光/顶光/侧光/自然光/摄影棚灯光/补光灯 + 英文对应词）——这条纯正则，
  `schema.json` 自己就能拦住（`ajv` 编译执行），`scripts/validate.js` 不需要额外
  重复这条检查（本条是 4 条公理里唯一完全交给 `schema.json`/`ajv` 执行、脚本零介入
  的一条，因为它本质是单字段格式校验，不涉及跨文件/跨条目）
- 天气词（下雨/阴天/rainy 等）不在闭集词表内，允许
- **中英文双语覆盖**：闭集词表包含中英文对应词（如中文"自然光"与英文"natural light"）。
  `schema.json` 在 `patternProperties` 正则里覆盖中英文光线词（见 `--selftest` 检查 15/16）。
  词表只在 `schema.json` 一处维护（`scripts/validate.js` 不重复维护，见本节第一条）

**出处**：
- `templates.json` `meta.hard_rules` 第 4 条原文："场景禁止写光线（明亮阳光/柔和灯光）；
  光线由后缀统一控制；可写天气。"——这条公理是这条硬规的直接机器化，闭集词表就是
  该条硬规举的例词 + 合理扩展的同义词（"暖光/冷光/逆光/顶光/侧光/自然光/摄影棚灯光"
  是本次为了让判据可执行而补充的同义扩展，不是原文逐字列出的，如实披露）
- 判据设计风格借鉴 `100x-persona/axioms.md` 公理 3（"`micro_coordinate` 不得含闭集
  泛化词，负向前瞻正则"）——同属"闭集词表 + 负向前瞻正则"这一具体判据形态，
  `100x-persona` 挡的是"地点写得太空泛"，本条挡的是"场景写了不该写的光线描述"，
  判据形态借用，具体词表内容是本次新写

**反例（作废）**：
- `scene: "home living room with soft warm lighting"` → 命中"soft lighting"/
  "warm light" → 正则拒绝（`--selftest` 检查 7/16 用的正是这个反例）
- `scene: "厨房，柔和灯光"` → 命中"柔和灯光" → 正则拒绝
- `scene: "厨房，阴天"` → "阴天"是天气词，不在闭集词表内，允许通过
- `scene: "home garage with natural light"` → 命中"natural light" → 正则拒绝（`--selftest` 检查 15/16）

---

## 公理 4：视频按所选模型执行时长上限与禁词表，零容忍

**一句话**：视频按所选模型执行时长上限与禁词表，零容忍。（22 字）

**可验证**：
- `category=="视频"` 时 `model` 必须非空、`video_unit` 必须存在；否则两者都必须为
  `null`——这条 if/then 条件判断 `schema.json` 直接管得住（`allOf`/`if`/`then`/`else`）
- **但"`video_unit.duration_seconds` 是否等于该 `model` 的硬上限（veo=8.0/
  seedance=10.0）、`final_prompt_wrapped` 是否命中该 `model` 专属的禁词表、是否带有
  该 `model` 要求的结尾固定句"——这些判据需要按 `model` 字段的取值去查一张"每个
  model 一份不同内容"的常量表（`profiles/veo.md`/`profiles/seedance.md` 里各自的
  时长/禁词/结尾句），不是三个分支各写一条 if/then 就能优雅表达的固定规则，而是
  数据量较大、需要按条目逐一扫描的列表匹配。参照 `100x-search-query` 对"平台关键词
  密度表只在 axioms.md 表格 + scripts/validate.js 里维护，不塞进 schema.json"的既有
  处理方式，本条同样把这几张 model 专属常量表放在 `scripts/validate.js`
  （`MODEL_DURATION_CAP`/`MODEL_BANNED_WORDS`/`MODEL_REQUIRED_TRAILING`），不重复
  写进 `schema.json`（避免"同一份词表两处维护、迟早失同步"）**。这条由
  `scripts/validate.js` 的 `modelWrapperCheck` 实际执行
- 即创（`即创`）：本 skill 未持有该模型的时长上限/禁词表来源材料（已知局限，见
  `SKILL.md`），只校验 `video_unit.narrative_shot_type` 落在 7 个叙事镜头闭集枚举内
  （情绪/痛点/产品/场景/对比/转折/CTA），不做时长/禁词硬校验

**出处**：
- veo 分支：依据 `profiles/veo.md`（8 秒硬上限、五段结构/Style Lock 固定句、AI 套路词/引号/markdown 禁用）。
- seedance 分支：依据 `profiles/seedance.md`（10 秒硬上限、纯英文+21禁词+结尾硬规）。
- **必要的适配说明**：Seedance 模型规范同时要求"0 命中 21 禁词"和"结尾必须含 no text, no subtitles, no watermarks"——结尾固定句本身包含 3 个禁词表里的词（text/subtitle/watermark）。自洽的处理解法是：禁词扫描时先排除结尾固定句这段文本本身（作为约定俗成的否定式收尾用语），再扫描剩余正文，详见 `scripts/validate.js` `modelWrapperCheck` 注释和 `profiles/seedance.md`。
- 本 skill 每次包装单条模板 body，不做多 shot 的分段编排。

**反例（作废）**：
- `model="veo"` 但 `video_unit.duration_seconds=12.0` → 判 FAIL（`--selftest`
  检查 9/16）
- `model="veo"` 的 `final_prompt_wrapped` 里出现"cinematic"/"flawless"等 → 判 FAIL
  （`--selftest` 检查 8/16）
- `model="seedance"` 的 `final_prompt_wrapped` 在结尾固定句**之外**的正文里出现
  "logo"（禁词） → 判 FAIL（`--selftest` 检查 11/16，专门验证"排除结尾固定句"这条
  适配没有变成"整段禁词检查形同虚设"）
- `model="即创"` 但 `video_unit.narrative_shot_type` 不是 7 个枚举之一（或缺失）→
  判 FAIL

**已知边界（如实披露，不是"反例"——这类输入目前仍然会通过 `ajv`/`modelWrapperCheck`，
只是需要换个不撞词的如实说法才能过，不是被永久拒绝）**：`MODEL_BANNED_WORDS.veo`/
`MODEL_BANNED_WORDS.seedance` 禁词表
设计初衷是拦截 AI 生成套路化的美化形容词（例如"professional lighting"这类摄影棚感
措辞），不是拦真实职业身份名词。但扫描本身是纯词法的（`\bword\b` 词边界正则，见本条
公理"可验证"段），分不清"作为 AI 套路形容词使用的 professional"和"作为说话人真实
职业身份如实描述的 professional"（比如"a health professional"这类如实翻译职业身份
后含这个词的说法）——只要 `persona`/口播台词按真实身份如实翻译成英文后撞上这个词，
同样会被 veo 禁词表判 FAIL，即使这段描述完全真实、不是 AI 套路化的美化措辞。
实测确认这是真实英语语料中的假阳性类别，不是纸面假设——语料原文如实给出的说话人职业身份翻译成英文后含
"professional"一词，若照实填入 `persona`，会被判 FAIL，只能换一个不撞词的同义词
（如"researcher"/"specialist"）改写后才能通过；这个改写是换词避开误伤，不是编造新
身份。`scripts/validate.js` 注释中关于禁词拦截的说明（见 `modelWrapperCheck` 注释、
`sources.md`"原创判断披露"第 4 条），也指出"professional"这类真实职业身份词存在整词命中风险。本次评估过给禁词表做语义
消歧（区分"作为形容词修饰画面美感"和"作为名词描述身份职业"两种用法），判断这需要
词性/句法层面的语义判断，超出词边界正则能表达的范围，且禁词表本身保持既有词表定义、不擅自改动其语义范围，故本次不做消歧代码，
如实披露为已知边界，依赖调用者在真实身份撞词时手动换同义词改写。已如实写进 `SKILL.md`
核心约束第 4 条括号，不藏在内部 TODO 里带过。

---

## 为什么是这 4 条，不多不少

- 公理 1 是**结构基础**：确保提示词模板插值准确可验证，防止模型随意改写正文
- 公理 2 是**防串场**：产品/人物锁是这批模板设计里唯一贯穿"图片→视频→多条视频"的
  跨调用状态，锁乱了会导致同一支视频里产品/模特换脸换形，是本 skill 除渲染本身外
  最高风险的环节
- 公理 3 是**防返工**：光线交给后缀统一控制是模板库自己反复强调的硬规（六条
  `hard_rules` 里唯二给了具体反例的一条），场景变量夹带光线描述是最常见、最容易被
  忽视的违规写法
- 公理 4 是**模型可用性**：提示词渲染对了，若不符合目标模型的硬约束（时长/禁词/
  结尾句），产出在 Veo/Seedance 那边依然会报错或被截断，这条公理是"渲染正确"和
  "模型能用"之间的最后一道闸门

不采用"台词内容真实性核对"（口播台词是否夸大功效/编造认证）作为第 5 条公理：这属于
上游 100x-persona/100x-search-query 或人工审核该管的内容合规范畴，不是"模板渲染是否
忠实、模型包装是否合规"这一层的职责，重复设置会和上游 skill 的公理边界打架，留在
`workflow.md` 的禁用词/内容纪律段处理，不升公理。

## TODO（需人工复核）

- [ ] TODO：即创（`即创`）的时长上限/禁词表目前无公开材料，`SKILL.md`/
  `schema.json`/`scripts/validate.js` 均已如实标注"不做硬校验，只校验叙事镜头分类"，
  需要后续跑通真实即创案例后补齐。
- [ ] TODO：公理 4 里"结尾固定句排除法解决 seedance 21 禁词与结尾硬规字面冲突"为自洽设计的解法规则，后续可进一步结合运行情况复核。
- [ ] TODO：公理 2 的"编号追踪"机制假设调用方（用户/上游 agent）会如实传入
  `existing_refs_input`——如果调用方跳过这个字段又谎称某个编号是"reference_reuse"，
  本 skill 能且只能判定"没找到这个编号"（判 FAIL），但无法验证"调用方是否伪造了
  `existing_refs_input` 本身"（比如谎称编号 1 已建立，其实从未建立过）——这和
  `100x-persona` 公理 1 的引用完整性检查有相同的信任边界，不是本 skill 独有的缺口，
  但仍如实记录。
- [ ] TODO：公理 2"已知边界"段披露的内容完整性缺口（`persona`/`product_desc`/
  `product_lock` 只查格式和编号存在性，不查语义内容是否真的具体）目前没有可靠的
  轻量启发式方案（评估过 minLength/是否含数字，均因中英文信息密度差异会误杀合法
  短示例或漏放反例，见公理 2"已知边界"段），如果后续要补，需要先想清楚一个不靠
  字符串长度的判据（比如按变量语言/脚本检测），不是简单调个阈值。
- [ ] TODO：`--selftest` 检查 14/16 只覆盖了 `VID-A-efficacy-stack` 的
  `effect_formula` 缺失场景；`VID-F-dark-humor` 走的是完全相同的
  `expandBracketInstructions` 代码路径（同一个 `effectKey`/`lib[effectKey]` 逻辑），
  理论上有相同的机制表现，但本次未对 VID-F 单独起一条 `--selftest`
  用例验证，属于"结构相同、未逐一实测"的已知空白。
- [ ] TODO：公理 4"已知边界"段披露的"professional 等真实职业身份词与
  veo/seedance 禁词表字面撞词"目前没有代码层面的解法（评估过语义消歧，判断超出
  词边界正则能表达的范围，见该段），完全依赖调用者手动换同义词改写。如果后续要补，
  可维护一份独立于禁词表之外的"已知真实职业名词换词对照表"，而不是直接从
  禁词表里删掉这些词。
- [ ] TODO：`templates.json` 14 个模板里把 `persona` 列为硬性必填的
  （IMG-02/VID-A/VID-B/VID-D），在"纯口播转录、不含说话人视觉外观信息"这类语料上，
  要不编造年龄/种族/性别/穿着这四要素就走不完 Phase 1→2→`validate.js` 全流程——
  唯一能在不违反"不编造具体外观"红线的前提下走完全流程并 PASS 的模板是 `PART-CTA`。这是模板库与该批语料的适配边界，依赖调用者在选语料/选模板时参考。
