# 100x-visual-fission · 核心约束（公理）

> 本 skill 的方法论骨架是 VTP（Visual Template Proliferator）七步流水线的方法论改写，
> 核心方法论参考《反推方法论·四类反推与VTP七步》
> （下称"方法论文档"）以及 VTP 系列 schema 与提示词设计（人物/场景反推、提取共性、
> 生成变体、翻译、meta-prompt）。负面词常量内容完整对应方法论文档
> "六、negative prompt 怎么写"一节。
>
> **"媒介裂变"与 VTP 原设计的关系（先把差在哪讲清楚，不是空口说"这次不一样"）**：VTP 原设计
> （`vtp_prompts_06-meta-prompt.md`）的裂变只有**一层**——同一份 person/scene/action 种子，
> 逐字不变，只在机位（lens/angle/framing/height）+ 灯光（natural-window/ring-light/
> overcast-natural）+ 调色（warm/neutral/muted）三处按 A/B/C 固定预设表变化，产出恰好
> 3 个变体（原文："The differences are ONLY in camera, lighting, and color grading"）。
> 本 skill 的"媒介裂变"是原创扩展：在同一套锁定的人物/场景/产品常量之上，
> **再叠加一层媒介结构轴**——同一套常量，除了 A/B/C 机位裂变外，还要在"单帧 / 首尾 / 首中尾 /
> 数日见效"（参考《功效堆叠与多帧结构》）四种帧结构之间裂变，即"发几帧、每帧演
> 什么、帧间怎么过渡"本身也成为一个裂变维度。两层轴是**正交叠加**（media_structure ×
> camera_variant），不是"用媒介轴替换掉机位轴"：任何一个媒介分支内部，仍然要按 VTP 原版
> A/B/C 三预设表继续裂变机位/灯光/调色（公理 2 详述，也是为什么 `camera_variant` 没有新增
> 第 4 档——媒介裂变加的是一个新维度，不是给旧维度加档位）。

---

## 公理 1：人物/场景/产品三锚点是定量，裂变分支里逐字不变

**一句话**：人物场景产品三锚点，裂变分支逐字不变，变量才能变。（25 字）

**可验证**：
- `constants.person_identity_anchor`/`scene_identity_anchor`/`product_identity_anchor` 非空
  且不含闭集泛化占位词——`schema.json` `definitions.identity_anchor` 的 `pattern`（负向前瞻）
  + `minLength:3` 硬锁（JSON Schema draft-07 的 `pattern` 没有大小写不敏感标志位，封禁词表
  显式包含小写、Title-Case 和全大写形式）
- **但这三个锚点的具体文字，是否真的逐字（大小写不敏感）出现在每一个
  `prompt_sets[].combined_prompt` 和每一个 `fission_variants[].prompt_json.prompt`
  里——这是跨条目/跨字段的子串包含检查，`schema.json` 完全没有这种能力**（JSON Schema
  无法让一个数组里所有条目的某个字段都必须包含另一处字段的字面值）。由
  `scripts/validate.js` 的 `identityLockCheck` 函数实际执行
- `prompt_sets[]` 之间不可两两字面雷同（VTP 04 步"每组至少在 2 个轴上不同"规则的操作化
  代理指标：至少要求 `combined_prompt` 不能逐字复制粘贴）——由 `promptSetsDistinctCheck`
  函数执行

**出处**：
- `vtp_prompts_03-extract-common.md` RULES 第 1 条："Constants = values that are
  identical, near-identical, or semantically equivalent across ALL images. If even
  ONE image differs significantly, it is NOT a constant"
- `vtp_prompts_06-meta-prompt.md` "Rules" 第 1 条："Do NOT invent new person/scene/
  action details -- use source row verbatim"——VTP 原设计本来就要求常量在所有裂变输出里
  保持字面不变，本条把这个原则从"人工检查"升级为"逐字子串机器校验"
- 反推方法论·四类反推与VTP七步.md"「定量 / 变量」二分是 VTP 的灵魂"一节："定量 = 一致性锁
  （同一个人、同一场景跨图不变），变量 = 裂变维度"

**反例（作废）**：
- `prompt_sets[1].combined_prompt` 把产品描述换成另一件产品（其余不变）→
  `identityLockCheck` 判 FAIL（`--selftest` 检查 2/16）
- 两个 `prompt_sets[]` 的 `combined_prompt` 逐字相同、只换了个 `variant_label` →
  `promptSetsDistinctCheck` 判 FAIL（`--selftest` 检查 3/16）
- `constants.person_identity_anchor` 写成 `"GENERIC woman standing near a window"`
  （全大写泛化占位词）→ `schema.json` `pattern` 直接拒绝
  （`--selftest` 检查 15/16）

---

## 公理 2：媒介裂变——媒介结构轴叠加在机位轴之上（本 skill 与 VTP 原设计的具体差异点）

**一句话**：裂变轴新增媒介结构，叠加在机位光调之上，非替代。（24 字）

**可验证**：
- `media_plan.structure` 只能是 `single_frame`/`head_tail`/`head_mid_tail`/`multi_day`
  四选一——`schema.json` `enum` 硬锁
- `media_plan.frame_count` 必须匹配 `structure`（1/2/3/4-8）——`schema.json`
  `media_plan` 定义里 4 条 `if/then` 硬锁（"结构→数值"是固定确定性映射，schema 管得住，
  不留给脚本）
- `fission_variants[].camera_variant` 仍然只能是 VTP 原版 3 档 `A/B/C`——`schema.json`
  `enum` 硬锁，媒介裂变**没有**新增第 4 档机位
- 每个 `fission_variants[].prompt_json.prompt` 必须包含其 `camera_variant` 对应的固定
  灯光/调色关键词（A→natural-window+warm，B→ring-light+neutral，C→overcast-natural+
  muted，来自 `vtp_prompts_06-meta-prompt.md` "Variant Definitions"表）——这也是一个
  固定确定性映射，`schema.json` 用 `if/then` + `pattern` 词边界前瞻（`\b`）硬锁，
  要求关键词以完整词/短语形式出现（避免 `natural-windowsill`/`warmth` 这类包含子串的无关词），
  同样不留给脚本
- **但 `media_plan.frames` 数组的实际长度是否等于 `frame_count`——这条 `schema.json`
  管不住**（JSON Schema 没有"数组长度必须等于兄弟字段的数值"这种能力），由
  `scripts/validate.js` 的 `frameCountMatchesArrayLength` 函数执行
- **`media_plan.frames` 各帧 `role` 出现顺序是否符合该 `structure` 要求的固定顺序
  （如 `head_mid_tail` 必须严格是 head→mid→tail，不能乱序），以及 `multi_day` 的
  `day_index` 是否严格递增且不重复——这两条都是跨条目顺序/序列判断，`schema.json`
  逐条独立校验数组元素，没有"第 N 项必须排在第 N+1 项之前"的能力**，由
  `frameSequenceCheck` 函数执行
- **`multi_day` 结构下，哪一帧是"第一帧"（`uses_first_frame_as_reference:false`）——
  这条不是"`day_index` 字面值等于 1"，而是"该 `role:"day"` 帧的 `day_index` 是全体
  `day` 帧里最小的那个"，因为 `day_index` 存的是源文案真实的天数（比如源文案只提
  day 3/7/14/30，从未提过 day 1，`day_index` 就必须原样写 3/7/14/30，不能为了凑
  "第 1 帧"改写成 1/2/3/4 这种重新编号的占位序号）。判断"哪一项的某字段是全体里的
  最小值"是跨条目比较，`schema.json` 没有这种能力**——由 `scripts/validate.js` 的
  `dayFrameFirstReferenceCheck` 函数执行（先算出全体 `day` 帧里最小的 `day_index`，
  再检查这一帧是 `false`、其余是 `true`）

**出处**：
- VTP 原设计机位裂变表：`vtp_prompts_06-meta-prompt.md` "Variant Definitions"——
  "All three MUST keep the same person, scene, and action from the source row. The
  differences are ONLY in camera, lighting, and color grading"（原文明确限定"只在这三处
  不同"，这是本公理"没有新增第 4 档机位"的直接出处）
- 媒介结构四选一来源：`功效堆叠与多帧结构.md` "框架（3 种结构）"表（首尾/首中尾/数日见效）
- **与 VTP 原设计差异点（如实说明，不是原文就有）**：见文件顶部"媒介裂变与 VTP 原设计的关系"
  一节，这里补充一点：四选一枚举里的 `single_frame` 是本次**原创新增**的第 4 个值——
  `功效堆叠与多帧结构.md` 原文只列了"首尾/首中尾/数日见效"3 种**带堆叠效果**的结构，
  没有"不堆叠、单帧直出"这个选项；本 skill 加它是为了让"是否要堆叠"本身可枚举、可判定
  （不加的话，"不适合堆叠的卖点展示类素材"就没有合法分支可落），如实披露这是本次新增，
  不是方法论文档现成就有的第 4 类

**反例（作废）**：
- `structure: "head_tail"` 但 `frame_count: 3`（结构与目标帧数不匹配）→ `schema.json`
  `if/then` 直接拒绝
- `structure: "head_tail"`、`frame_count: 2`，但 `frames` 数组实际塞了 3 项（每个字段
  单独看都合法）→ `frameCountMatchesArrayLength` 判 FAIL（`--selftest` 检查 4/16）
- `head_mid_tail` 三帧顺序写成 `[tail, head, mid]`（每帧内容独立看都合法）→
  `frameSequenceCheck` 判 FAIL（`--selftest` 检查 5/16）
- `camera_variant: "D"`（试图新增第 4 档机位）→ `schema.json` `enum` 直接拒绝
  （`--selftest` 检查 11/16）
- `multi_day` 叙事全程只提 day 3/7/14/30（从未提 day 1），4 帧按最小 `day_index`
  （3）标 `uses_first_frame_as_reference:false`、其余 3 帧标 `true`——应正确 PASS（`--selftest`
  检查 12/16，复现的正是真实语料英语第 612 行·id V001527 那种从不提 day 1 的叙事
  结构，不摘录原文）
- 同一份 `day_index:[3,7,14,30]` 的 `multi_day` 输出，把最小 `day_index`（3）那一帧
  错误标成 `uses_first_frame_as_reference:true`——`schema.json` 早已不管这条（判定
  规则不再是字面值），由 `dayFrameFirstReferenceCheck` 判 FAIL
  （`--selftest` 检查 13/16）
- `camera_variant:"A"` 但 `prompt_json.prompt` 只写了 `natural-windowsill`/`warmth`
  （分别包含 `natural-window`/`warm` 子串，但都不是那个关键词本身）→ `\b` 词边界前瞻
  应正确拒绝（`--selftest` 检查 16/16）

---

## 公理 3：帧计划零孤儿 + 裂变产物引用完整性

**一句话**：每帧必被裂变引用，引用必须指向真实存在的帧。（22 字）

**可验证**：
- `fission_variants[].source_prompt_set_id` 的类型是整数——`schema.json`
  `type:integer` 管得住格式
- **但这个 id 是否真的等于某个 `prompt_sets[].id`——这是跨数组的引用完整性检查，
  `schema.json` 没有这种能力**（和 `100x-persona` 公理 1 同一类问题：格式合法不等于
  真实存在）。由 `scripts/validate.js` 的 `fissionReferentialIntegrityCheck` 执行；
  同一函数同时检查 `frame_role`+`day_index` 这个组合是否真的对应
  `media_plan.frames[]` 里定义过的某一帧
- **`media_plan.frames[]` 里定义的每一帧，是否至少被一个 `fission_variants[]`
  引用（零孤儿）——这是"每个定义了的东西是否都被用到"的反向遍历，`schema.json`
  同样管不了**（和 `100x-persona` 公理 4 同一类问题），由 `frameCoverageCheck` 执行

**出处**：
- 引用完整性判据设计思路直接借鉴 `100x-persona/axioms.md` 公理 1（"这个 ref 字符串
  实际指向的 key 真的存在于 personas/scenes 里——这条 schema.json 管不住"），本 skill
  把同一类工程问题从"人物/场景 ref"迁移到"prompt_set/frame ref"
- 零孤儿判据同样借鉴 `100x-persona/axioms.md` 公理 4（"人物场景零孤儿，建了必须被
  引用"），理由类比：`media_plan` 规划了一帧却没有任何 `fission_variant` 真的把它渲染
  出来，下游要么困惑"这帧要不要出"，要么误以为是渲染遗漏

**反例（作废）**：
- `fission_variants[0].source_prompt_set_id: 999`（`prompt_sets[]` 里没有这个 id）→
  `fissionReferentialIntegrityCheck` 判 FAIL（`--selftest` 检查 6/16）
- `media_plan.frames` 规划了 `mid` 帧，但 `fission_variants[]` 只覆盖了 `head`/`tail`，
  从未渲染 `mid` → `frameCoverageCheck` 判 FAIL（`--selftest` 检查 7/16）

---

## 公理 4：负面词常量 + 真实感兜底缀锁死，不可视化宣称禁止逐字入画

**一句话**：落地帧锁负面词与真实感缀，不可视宣称禁止写死。（23 字）

**可验证**：
- 顶层 `negative_prompt` 必须逐字等于 VTP 固定常量（六类排除词，见方法论文档"negative
  prompt 怎么写"一节）——`schema.json` `const` 硬锁，用户不可改
- 每个 `fission_variants[].prompt_json.prompt` 必须包含 VTP 06 步固定的真实感兜底后缀
  （`shot on iPhone`/`visible pores`/`natural skin texture`/`minor imperfections`/
  `photorealistic` 五个子串，任意顺序）——`schema.json` 的 `pattern`（多重前瞻）硬锁
- **但每个 `fission_variants[].prompt_json.negative_prompt` 是否真的和顶层
  `negative_prompt` 逐字相等——这是跨分支的字段相等比较，`schema.json` 的 `const`
  只能把一个字段锁定成字面值，锁不住"嵌套在数组里的字段必须等于另一个顶层字段的值"**，
  由 `negativePromptConsistencyCheck` 执行
- **"不可视化/夸大宣称是否被逐字抄进画面描述里"——这是对一份关键词表做大小写不敏感的
  内容扫描。这条理论上可以用 vanilla regex 的逐字母大小写交替组写法在 `schema.json`
  里表达（如 `[fF][dD][aA]`），但对 ~25 个中英文多词短语这样写会变成不可维护的天书
  正则，和"两处各写一份、容易漂移"的风险比，不值得**，由 `scripts/validate.js` 的
  `unvisualizableClaimCheck` 函数执行（关键词表 `UNVISUALIZABLE_CLAIM_WORDS` 定义
  在该文件，是唯一定义处；来源见下方"出处"与 `sources.md` 语料实测记录；采用 `\b` 词边界匹配
  `wordMatch`，要求词表条目以完整词/短语形式出现，避免 `cure` 这类短英文词命中 `secure`/`manicure`
  等无关词内部子串）

**出处**：
- 负面词常量：方法论文档"六、negative prompt 怎么写"一节给出的
  固定单行常量原文。
- 真实感兜底后缀：`vtp_prompts_06-meta-prompt.md` "JSON Schema (per prompt)"里
  `prompt` 字段模板的固定后缀部分
- 不可视化宣称禁止：**本条判据是本次原创判断，不是照搬某份文档的现成规则**（如实披露，
  不假装有出处）。精神上呼应反推方法论·四类反推与VTP七步.md"四、图片反推
  （VisionStruct）"一节的 Anti-Studio Bias/Raw Skin Precision（"只描述看得见的东西，
  不脑补、不美化"），但那条讲的是"不脑补不可见部位"，本条讲的是"不把营销宣称当成可视化
  指令抄进画面"，是本次为"媒介裂变"任务在真实语料实测（见 `sources.md`）中发现的新
  问题而补的判据：真实语料（保健品类目黑帽文案密度极高）里大量出现细胞/线粒体健康、
  临床验证一类无法被镜头拍到的机制/权威宣称，如果不设专门判据，裂变流水线会把这些话
  原样当成画面描述抄进 `prompt`

**反例（作废）**：
- `negative_prompt` 被改写成缩短版 → `schema.json` `const` 直接拒绝
- 某个 `fission_variants[].prompt_json.negative_prompt` 被单独截断/改写（其余不变）→
  `negativePromptConsistencyCheck` 判 FAIL（`--selftest` 检查 8/16）
- 帧描述里出现"clinically proven anti-aging results visible"这类不可视化宣称原文 →
  `unvisualizableClaimCheck` 判 FAIL（`--selftest` 检查 9/16）
- `prompt_json.prompt` 漏写 `photorealistic` 等任一固定后缀子串 → `schema.json`
  `pattern` 直接拒绝
- 帧描述里写"gentle manicure-style finishing touch"（`manicure` 里含 `cure` 子串，
  但这句话本身完全是可拍摄的具体动作，不是不可视化宣称）→ 词边界匹配应正确判定不命中
  （`--selftest` 检查 14/16）

---

## 为什么是这 4 条，不多不少

- 公理 1 是**媒介裂变的地基**：没有"常量锁死"，"裂变"就无从谈起——裂变的前提是"变量在变，
  常量不变"，这是 VTP 全套方法论的灵魂（"定量锁一致、变量做裂变"），必须机器可验证，
  不能只是口头要求
- 公理 2 是**本 skill 与 VTP 原设计的核心差异点**：不写这条，"媒介裂变"就只是一句空话——
  必须把"多了哪一层轴、这层轴怎么和原有机位轴共存"讲清楚并且可判定，这是本 skill
  的核心设计目标，理应升为公理而不是塞进 workflow 的一句话描述
- 公理 3 是**产物完整性**：裂变的价值在于"每一帧都真的被渲染出来给人用"，规划了却没渲染、
  或渲染了却指向不存在的规划，都会让下游对"到底该拍/生成哪几张"产生误解，`100x-persona`
  已经证明这类问题必须写成脚本而不是指望人工看一眼
- 公理 4 是**兜底与诚实的底线**：负面词/真实感缀是 VTP 长期验证过的真实感兜底，不能被
  裂变过程悄悄弄丢；不可视化宣称禁止则是本次真实语料实测暴露出的新风险——裂变得越快、
  越自动化，就越容易把"营销话术"当成"画面指令"直接抄进 prompt，必须专门堵住

不采用"裂变产出条数必须刚好等于用户要求的 N"作为第 5 条公理：VTP 原始设计里
`04-generate-variants` 的 `count` 本来就是用户自由指定的目标值（"Generate {{count}}
DISTINCT prompt sets"），04 步自己的自检清单也是"生成了恰好 `{{count}}` 条"——这是**执行时
的输入参数校验**，不是本 skill 产出契约需要断言的结构性规则，`schema.json` 只锁
`prompt_sets` 最少 2 条（裂变至少要有东西可比较），不锁死一个具体数字，锁死会和"用户指定
生成组数"的设计冲突。

## TODO（需人工复核）

- [ ] TODO：`media_plan.structure_justification` 在 `multi_day` 分支下，`schema.json`
  只能强制"必须引用一个数字"（`pattern:.*[0-9].*`），无法验证这个数字是否真的对应输入
  素材里的时间线断言，还是随手编的——例如 `evals/example-04-circulacion-multiday-es.json`
  里 `day_index:10` 这一帧就是本次为了满足"至少 4 帧"的结构下限而插值补的，源语料只提到
  3 个时间点（约 24 小时/一周/第 14 天），这个插值决策目前只能靠人工判断合理性，
  `meta.warnings` 只是诚实披露，不是机器验证。
- [ ] TODO：`UNVISUALIZABLE_CLAIM_WORDS` 关键词表目前只在本次读到的两份真实语料（保健品
  类目为主，英语+西语）上验证过，跨更多类目（清洁/宠物/服饰等，`出片SOP·从产品到成片.md`
  检索路由表列出的其他品类）后大概率需要扩表，扩表时必须同步改 `scripts/validate.js`
  （唯一定义处）与本文件的出处说明，不能只改一处。
- [ ] TODO：`camera_variant` 的 A/B/C 固定预设表完全照抄 VTP 原版 `06-meta-prompt.md`，
  未验证这三档在"媒介裂变"新增的 `multi_day`/`head_mid_tail` 场景下是否仍是最优机位/灯光/
  调色分配——原表是为"同一张静态图裂变 3 变体"设计的，用在"跨天渐进序列"场景下是否需要
  按帧调整（比如 Day 1 用更暗淡的灯光、Day 14 用更明亮的灯光）目前完全没有判据，纯靠人工
  审阅，标记待补。
- [ ] TODO：`single_frame` 这个媒介结构分支目前 `evals/` 里没有一份真实语料衍生的示例
  覆盖（本次 6 条真实语料天然全部落在 head_tail/head_mid_tail/multi_day 三种），只在
  `axioms.md`/`schema.json` 的定义和 `--selftest` 的基础 fixture（`head_tail`，非
  `single_frame`）里间接验证过结构合法性，需要补一条真实的"无堆叠效果、直接卖点展示"
  类目语料跑一遍。
