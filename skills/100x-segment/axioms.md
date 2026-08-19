# 100x-segment · 核心约束（公理）

> 本 skill 对应 100x 体系"1 分段"这一步：纯文本口播脚本进，三层独立切点出——
> L1 段落逻辑 `segments[]`（11 模块骨架里的 10 个位置模块 + 顶层 7 原型）、
> L2 镜头目的 `shots[]`（预判镜头意图，不含画面/运镜/音频，因为本 skill 不吃视频帧）、
> L3 气口（行内呼吸标记，压在 `segments[].text_annotated` 里，不是第四个数组）。
> 三层是三种**独立叠加的视角**，不是三条互相竞争的切分规则——同一份文本可以同时有
> 9 个 L1 段落、5 个 L2 镜头（合并/拆分不必与段落对齐）、和贯穿全篇的 L3 气口标记。

---

## 公理 1｜segments[].module 锁 10 枚举，archetype 锁 7 原型格式

**一句话**：段落模块锁10类，原型锁7类，不接受自由标签。（23 字）

**可验证**：
- `segments[].module` 必须是 10 值之一（`hook`/`authority`/`pain`/`mechanism`/
  `staged_timeline`/`dosage`/`risk_reversal`/`scarcity`/`price_anchor`/`cta`）——
  `schema.json#/definitions/segment_item/properties/module/enum` 硬锁，ajv 执行
- 顶层 `archetype` 必须匹配 `^([A-G])(\+(?!\1)[A-G])?$`——单字母，或"主+辅"两个
  **不同**字母（用正则反向引用 `\1` 排除 `"A+A"` 这种同字母复合）——
  `schema.json#/properties/archetype/pattern` 硬锁，ajv 执行；backreference 排除
  逻辑已用 `node -e` 实测验证过，不是"应该能行"的猜测
- 以上两条 vanilla JSON Schema 能完全表达，`scripts/validate.js` 不重新实现，
  只在 `--selftest` 里各留一条回归用例防止 schema.json 改坏后没人发现

**为什么 11 模块只留 10 个进 `module` 枚举**：口播文案蓝图的模块 11"Localization
本土化表达"明确标注"*(贯穿全文)*"——它是一种贴在每个模块身上的**风格维度**（美式俚语/
`link in bio`/具体品牌本地化措辞），不是一段独立的、有开头结尾的**位置段落**。如果把
它塞进 `module` 枚举，会出现"这一整段全是 localization"这种没有意义的分类（本土化
措辞理应散布在 hook/pain/cta 等段落内部，不会自己单独成段）。因此将其排除在
`segments[].module` 之外，10 个位置模块（1-10）保留。

**为什么不是"照抄两套判据合并成一个大公理"**：`module` 枚举和 `archetype` 格式是
两个不同粒度的分类（段落级 vs 全篇级），但都是"L1 段落逻辑层用闭集词表锁死分类，
不接受自由标签"这同一条纪律的两个落点，参照 `storyboard/axioms.md` 公理1把
"shot_purpose 锁 7 枚举"和"复合情况取主导优先级"合并为一条公理的先例，本条也把
两个同层判据合并，避免为了凑数拆成两条空判据。

**出处**：
- 10 个位置模块 + module 11 是"贯穿全文"风格维度：
  口播文案蓝图规范 §2"11 模块语法"表格第 11 行"Localization 本土化表达 *(贯穿全文)*"
- 7 原型 A-G + 混合原型规则（主原型在前，辅手法在后，见下方公理正文）：同规范
  §3"7 原型骨架"+"混合原型规则：原型可标为单一（A-G）或主+辅混合（如 `G+E`）"
- "枚举锁死、不扩、复合情况取优先级"这条纪律用于统一结构约束，确保分类确定性。

**反推反例（作废）**：
- `module: "localization"` ❌（第 11 个模块不进枚举，见上方理由）
- `module: "closure"` / `module: "P9"` ❌（不在 10 值枚举内，且是从别的九阶段词典
  里抄来的标签，未映射）——对应 `--selftest` 第 6 项
- `archetype: "H"` ❌（不在 A-G 内）
- `archetype: "A+A"` ❌（复合但两字母相同，无意义）——对应 `--selftest` 第 7 项
- `archetype: "E+G"` ❌ **不是**"作废"，但违反"主在前辅在后"的书写惯例（正则本身
  不检查语义上"谁是主骨架"，只检查两字母不同——这是本条的已知局限，见文末 TODO）

**合格正例（本次原创合成语料，evals/example-02 的实际取值）**：
- `module: "hook"` → `module: "authority"` → `module: "mechanism"` →
  `module: "dosage"` → `module: "staged_timeline"` → `module: "risk_reversal"` →
  `module: "scarcity"` → `module: "cta"`，共 8 段，10 值枚举里用了 8 个 ✅
- `archetype: "G+E"`（G 悬念实验揭秘型为主骨架，叠加 E 反转逆向心理型的"不要喝太多"
  警告式措辞）✅

---

## 公理 2｜气口是行内标记，只加不减，text_annotated 必须与 raw_text 逐字可还原

**一句话**：气口是行内标记，只加不减，不改原文。（18 字）

**可验证**：
- `segments[].text_annotated` 把其中所有 `‖`（强气口）/`·`（弱气口）字符去掉、
  空白归一化后，必须与同一 segment 的 `raw_text` 逐字相等——这是**同一个对象内部
  两个字段的跨字段比较**，vanilla JSON Schema 没有"比较本对象另一个字段"的能力，
  由 `scripts/validate.js` 的 `checkIntegrity()` 函数执行
- `text_annotated` 不许以气口字符开头/结尾、不许两个气口字符中间没有字连着出现、
  也不许单个气口字符前后没有空格紧贴着文字（`workflow.md` 2C"必须单独用空格
  前后隔开"这条格式规则）——`checkBreathPlacement()` 里的结构形状检查段（这条
  本可以写成一条变长 lookbehind 的 schema 正则，但会变成难读难维护的怪物正则，
  `schema.json` 顶部 description 已说明为什么改放到脚本的同一次字符串解析里，
  不另起一份正则）

**为什么升公理而不是留在 workflow 的软性提醒里**：这是"L3 是行内标记不切行"这个
设计决定的**结构完整性底线**——如果生成时不小心把某个词漏了、抄错了、顺序换了，
`text_annotated` 表面上看起来仍然是"合法字符串"（`schema.json` 的
`minLength:1` 会通过），但已经违反了"标记只叠加、不改写原文"这个 L3 存在的
全部意义。不是质量问题，是结构性作废判据。

**出处**：本条判据（"气口是行内标记，不切行"）为分段与气口体系的核心结构决策，确保标记只叠加、不破坏原文结构，如实按规范要求记录并配上可验证判据。

**反推反例（作废）**：
- `raw_text: "This stuff works fast."` 配 `text_annotated: "This stuff works. ‖ ..."`
  ❌（"fast"被静默删掉）——对应 `--selftest` 第 11 项
- `text_annotated` 开头就是 `‖ This is the hook.` ❌（气口标在最前面，前面没有
  任何字可以"呼吸完再继续"，语义上不成立）
- `text_annotated` 里出现 `done. ‖· next` 这种气口字符紧挨在一起 ❌（两个气口
  中间没有真实词语，是重复/误标）
- `"...fast. ‖It changes..."`（气口后面直接贴着 `It`，零空格）❌ 违反空格
  前后隔开的格式规则（`workflow.md` 2C 用"必须"写明，`checkBreathPlacement()`
  检查单个气口前后是否紧贴非空白字符）——对应 `--selftest` 第 17 项

**合格正例（evals/example-01 segment 1）**：
- `raw_text`: "You know what your afternoon slump is actually scared of? Not
  coffee, not a nap, not another snack."
- `text_annotated`: "You know what your afternoon slump is actually scared
  of? ‖ Not coffee, · not a nap, · not another snack."
- 去掉 `‖`/`·` 并归一化空白后与 `raw_text` 逐字相同 ✅

---

## 公理 3｜气口强弱判据已锁死，按固定优先级判定，不可自由发挥

**一句话**：强弱判据已锁死：转折>句读>逗号，不可另定。（22 字）

**可验证（判据本身，`scripts/validate.js` 的 `checkBreathPlacement()` 执行）**：
按**优先级从高到低**依次判定每个已存在气口标记该是强还是弱（同一个断点只可能
命中一条规则，命中即定，不再往下比）：

1. **转折连词开头 = 强**：断点之后的下一个词是转折连词（EN: `but`/`so`/`and
   then`；ES: `pero`/`entonces`/`y`）→ 必须是 `‖`。这条优先级最高——即使断点前面
   是逗号，只要后面接的是转折连词，也按强处理，不按逗号的默认弱处理（已知局限：
   EN 的 `so` 同时有"转折/因果连词"（"..., so we stayed inside"=因此）和
   "程度副词/强调词"（"so much"/"so many"=到那种程度）两种用法，纯关键词匹配
   区分不了，和规则5 `like` 的介词/填充词歧义是同一类问题——但这条是**硬性
   fail 判据**而不是规则5那种软性 warning，误判代价更高。`scripts/
   validate.js` 用一条排除"so much"/"so many"这个最常见强调搭配的启发式
   （`SO_INTENSIFIER_RE`）做了部分缓解，不是完整消歧，其他强调用法（如
   "so tired that..."）仍未排除，详见文末 TODO）
2. **句末标点 / 破折号 = 强**：断点前面是 `.`/`!`/`?`（可重复，如 `??`）或破折号
   `—` → 必须是 `‖`。**同一 segment 内只要句子没走到最后一个字，句末标点后面就
   必须有气口标记**（这条是强制存在，不是"有标才判强弱"，见下方"强制出现"段）；
   破折号按句末标点同等处理，源自口播文案蓝图 §5 风格 DNA"破折号制造停顿"
3. **逗号/分号 = 弱**：断点前面是 `,`/`;` 且未命中上面两条更高优先级规则 → 必须
   是 `·`
4. **一口气上限（强制切分）**：两个气口标记之间（或从段首到第一个标记、最后一个
   标记到段尾）的字数/音节数超过上限——**EN 14 词 / ES 16 音节（估算）为硬上限**，
   超过且中间一个标记都没有 = 作废，必须补气口。"8-14 词/10-16 音节"是推荐建议区间，
   只有**上限**这一头被当成硬判据，下限只是风格建议不强制
5. **填充词后接 = 气口（软性）**：EN `like`/`okay so`/`wait`；ES `o sea`/`bueno`
   后面应该接一个气口标记——这条是**软性**（warning，不 fail），因为"填充词后面
   一定要有气口"比前 4 条更接近风格建议而非结构判据，且 `like` 在英语里同时是
   "像……一样"的介词/连词用法（不是每次都是话赶话的填充词），纯关键词匹配区分不了
   这两种用法，误报率比其他判据高，详见文末 TODO

以上 5 条无法用 schema.json 一条正则表达——需要先把 `text_annotated` 按气口字符
切成一段段"气口区间"（run），再看每个区间前后紧挨的词/标点是什么，这是"把一个
字符串解析成若干片段、逐片段推理"的聚合分析，`schema.json` 顶部 description 里
写明了为什么不硬塞成一条变长 lookbehind 正则（不可读、难维护）。规则 1-4 是硬
判据（fail），规则 5 是软判据（warning）。另有一条**软性**判据："价格/数字前的
强调停顿 ≠ 呼吸停顿，不应标气口"——用 `PRICE_OR_NUMBER_RE` 启发式识别，同样是
warning 不 fail（已知局限：这是代理模式匹配，不是真语义理解，可能漏判/误判，
详见文末 TODO）。

**为什么不拆成 5 条公理**：这 5 条共享同一个"存在理由"——它们都是回答同一个问题
"这个气口标记该多强、该不该存在"，检测机制也共享同一次字符串解析（`splitRuns()`
产出的 run/mark 数组）。参照 `hook/axioms.md` 公理3把"8 主类+3 可复合次维度"
合并为一条公理的先例，本条把优先级判据当作一条公理的内部结构，不是强行拆条凑数。

**出处**：本条全部 5 条判据 + 优先级顺序 + 强制/软性的划分，均来自气口判定标准规范
（句末标点=强；逗号分号=弱；转折连词开头=强；一口气上限 EN 8-14词/ES 10-16音节；
填充词后接=气口；强调停顿≠呼吸停顿，价格数字前标强调不标气口）。
破折号视为句末标点同等处理这一条延伸，来源是口播文案蓝图规范
§5"风格 DNA"里的"破折号制造停顿"这一条风格技巧本身（采用"阶段性天数+破折号+效果陈述"
结构的示例说明这个技巧）——把风格 DNA 里已有的破折号停顿现象，
纳入既定气口规则的"句末标点"一档。

**反推反例（作废）**：
- `"Tired of waiting, ‖ hoping for a fix..."`（逗号后接强气口，且下一词不是
  转折连词）❌ 应为弱 `·`——对应 `--selftest` 第 12 项
- `"You have tried everything, · but nothing worked..."`（逗号后接的是转折词
  `but`，优先级规则 1 应覆盖逗号的默认弱，此处却标了弱）❌ 应为强 `‖`——对应
  `--selftest` 第 13 项
- 一段 17 个英文单词中间不放任何气口标记直接连到句尾 ❌ 超过 14 词硬上限——
  对应 `--selftest` 第 15 项
- `She said "it changed everything." Then she smiled.`（句末句点后紧贴一个
  右引号，再往后一个词都没有气口标记）❌ 应在句点后补强气口（`SENTENCE_CLOSING_WRAP`
  允许右引号/右括号夹在标点和空白之间再判定）——对应 `--selftest` 第 16 项
- `"nine a.m. is enough"` 这种缩写句点（`a.m.`）由固定词典
  `ABBREVIATIONS` 排除（`a.m.`/`p.m.`/`Mr.` 等常见缩写不按句末标点处理）✅——
  对应 `--selftest` 第 21 项；词典之外的缩写仍会误判，见文末 TODO
- `"Really?Wait until you see this work."`（句末问号与下一词零空格粘连，
  整段零气口标记）❌ 应判定为缺失强制气口（`checkBreathPlacement()` 的"强制出现"
  判据中 `!`/`?` 采用零或多个空白判定，对应 `--selftest` 第 20 项；`.` 的零空格
  粘连场景仍未覆盖，是已知局限，见文末 TODO）

**合格正例（evals/example-01 segment 5，阶梯时间线段落）**：
```
Day one, · you will feel a small spark, like ‖ something just turned back on. ‖
Day seven, · you will notice you stop reaching for a second coffee before lunch. ‖
Day fourteen, · people will ask why you suddenly seem so alive again.
```
逗号后全部弱气口、句末句点后全部强气口、每个气口区间都在 14 词上限内 ✅

**合格正例（"so" 强调用法不应被误判为转折连词）**：
- `"This routine changed my mornings, · so much that I can't imagine going
  back."`——逗号后接的是"so much"程度副词强调搭配，不是"因此"义的转折连词，
  弱气口 ✅ 正确通过、不强制升级为强——曾经是一条误判（规则1的纯关键词匹配
  把每个"so"都当转折连词），现已用 `SO_INTENSIFIER_RE` 部分缓解，对应
  `--selftest` 第 14 项

---

## 公理 4｜shots[].shot_purpose 锁 7 枚举，且必须完整覆盖 segments[]（零孤儿）

**一句话**：镜头目的锁7值，每段必须被引用。（16 字）

**可验证**：
- `shots[].shot_purpose` 必须是 `hook`/`build`/`reveal`/`demo`/`social_proof`/
  `cta`/`transition` 之一——`schema.json#/definitions/shot_item/properties/
  shot_purpose/enum` 硬锁，ajv 执行
- `shots[].segment_refs` 里的每个数字必须真实存在于 `segments[].segment_id`
  （引用完整性，跨数组比较，schema 管不了）+ 每个 `segments[].segment_id` 必须
  被至少一个 `shots[].segment_refs` 引用（零孤儿覆盖率，同样是跨数组聚合）——
  两条都由 `scripts/validate.js` 的 `checkShotSegmentLinkage()` 执行
- `segment_id`/`shot_id` 必须从 1 开始、按数组顺序连续递增——schema 无法访问
  "这一项在数组里排第几"这个信息，由 `checkSequentialIds()` 执行

**为什么本 skill 的 shot 字段精简**：本 skill 只吃纯文本，
没有画面信号，所以 `shots[]` 只保留"预判这段该是什么镜头目的"这一件事，
其余依赖视频画面的字段留给后续处理视频的环节。这不是偷懒精简，是输入模态决定的
硬边界——已知局限，写进 `SKILL.md` 核心约束。

**为什么 segment 和 shot 允许不是 1:1**：一个 L1 段落（比如阶梯时间线一段讲
Day1/Day7/Day14）可能在真实拍摄里对应好几个镜头；反过来几个短段落（比如
risk_reversal + scarcity）可能被安排成同一个镜头一次带过。`segment_refs` 用
数组（可以放多个 segment_id）而不是单个 `segment_ref`，就是为了明确"三层切点不是同一套切分"的原则。

**出处**：
- 7 值枚举本身：标准 7 枚举（`hook`/`build`/`reveal`/`demo`/`social_proof`/
  `cta`/`transition`）
- "纯文本输入，不含画面字段"的边界：文本分段阶段只处理纯文本信号
- "引用完整性 + 零孤儿覆盖率"这条判据模式确保每个段落都有镜头目的归属，避免出现孤儿段落

**反推反例（作废）**：
- `shot_purpose: "Demo 颜值"` ❌（中文自由标签，未映射到 7 枚举，同
  `storyboard` 公理1的反例范式）
- `segment_refs: [99]`（99 不存在于任何 `segments[].segment_id`）❌——对应
  `--selftest` 第 9 项
- 定义了 `segment_id: 2` 的段落，但没有任何 `shots[].segment_refs` 提到 2 ❌
  （孤儿段落）——对应 `--selftest` 第 10 项
- `segment_id` 顺序是 `[1, 3, 2]`（跳号/乱序）❌——对应 `--selftest` 第 8 项

**合格正例（evals/example-01）**：`shots[]` 共 7 个镜头覆盖 9 个段落——
`shot 2` 的 `segment_refs: [2, 3]` 把"authority"和"pain"两段合并成一个镜头，
`shot 6` 的 `segment_refs: [7, 8]` 把"risk_reversal"和"scarcity"合并成一个镜头，
其余镜头各自对应单一段落；9 个 `segment_id` 全部被覆盖，无孤儿 ✅

---

## 公理总览（最终 4 条）

| # | 公理 | 一句话（≤ 30 字） |
|---|---|---|
| 1 | L1 分类锁死 | 段落模块锁10类，原型锁7类，不接受自由标签 |
| 2 | L3 标记只加不减 | 气口是行内标记，只加不减，不改原文 |
| 3 | L3 强弱判据锁死 | 强弱判据已锁死：转折>句读>逗号，不可另定 |
| 4 | L2 枚举+零孤儿 | 镜头目的锁7值，每段必须被引用 |

**4 条都满足公理原则**：
- 都是"输出什么算合格"的强制要求（不是心法，不是建议）
- 都点名了具体执行者：公理1/4 的枚举+格式部分是 `schema.json` 的具体
  keyword（`enum`/`pattern`），公理2/3/4 的跨字段/跨数组/字符串解析部分是
  `scripts/validate.js` 的具体函数名（`checkIntegrity`/`checkBreathPlacement`/
  `checkSequentialIds`/`checkShotSegmentLinkage`）
- 都能反推反例，且每条反例都对应 `--selftest` 的具体编号（见上）
- 都能一句话说清，≤ 30 字（逐条用 `node -e` 精确统计 `.length`）

---

## 为什么是这 4 条，不多不少

三层切点（L1/L2/L3）天然对应"分类锁死"（公理1覆盖 L1）+"结构完整性"
（公理2覆盖 L3 的"标记怎么存"）+"内容正确性"（公理3覆盖 L3 的"标记该多强"）+
"跨层引用完整"（公理4覆盖 L2 如何回指 L1）。四条覆盖了 L1/L2/L3 三层里
**每一层至少一条硬判据**，且没有两条公理在检查同一件事：
- 公理1 只管"分类值合不合法"，不管气口
- 公理2 只管"标记有没有破坏原文"，不管标记该强还是该弱
- 公理3 只管"已存在的标记强弱对不对、该不该强制出现"，不管标记本身有没有
  改动原文（那是公理2的地盘）
- 公理4 只管"L2 和 L1 之间的引用关系"，不管 L1 内部分类、不管气口

候选但没有升公理的规则：
| 候选 | 为什么不升公理 | 落地去哪 |
|---|---|---|
| "填充词后接 = 气口" | `like` 的介词/填充词歧义让纯关键词匹配误报率偏高，属于**质量提醒**而非**结构性作废判据**（即便漏标一个填充词后的气口，`text_annotated` 仍然是结构合法的） | 折进公理3正文当第 5 条软性子判据，`scripts/validate.js` 里是 warning 不是 error |
| "价格/数字前不标气口" | 同上，是启发式代理模式匹配，不是真语义判断，且
  "价格"本身没有跨语言统一的字符串特征 | 同上，公理3正文 + 软性 warning |
| "archetype 主原型必须是叙事上真正的主骨架" | 正则只能检查"两个字母不同"，
  无法验证"哪个字母才是真正主导"这种语义判断，缺一个可字符串化的判据 | 留在
  workflow.md 生成指引里当创作建议，不升公理 |
| "module 分布不能一边倒（比如全是 demo）" | 参照 `storyboard` selfcheck
  自己承认"至少 1 hook / 至少 1 cta"是"爆款模板建议不是生成约束"，本 skill
  同理不锁 module 分布 | workflow.md 软性自检项 |

---

## TODO（需人工复核）

- [ ] TODO：公理3 规则5（填充词软判据）和"价格/数字前不标气口"软判据，两者
  都是关键词/正则代理模式匹配，不是真语义理解。`like` 作为"填充词 vs 普通介词"
  的歧义已经在 `evals/example-03` 构建时真实触发过一次误报（详见
  `sources.md`），当时选择改写语料avoid 触发，而不是升级判据本身——如果未来
  真实语料里"填充词误报率"过高，需要考虑是否要一份更精细的上下文判据（比如
  "like"前后是否有停顿感叹词），但目前没有足够真实语料支撑重新设计，先记录
  为已知局限。
- [ ] TODO：公理3 规则1（转折连词开头=强，硬性 fail 判据）里的 EN `so` 和
  规则5的 `like` 是同一类"关键词身兼两种用法"歧义（"so"=转折/因果连词 vs
  程度副词强调词），但规则1是硬性 fail 而规则5只是软性 warning，误判代价
  更高。`scripts/validate.js` 目前只排除了"so much"/"so many"这个最常见的
  强调搭配（`SO_INTENSIFIER_RE`），其他强调用法（如"so tired that..."/
  "so happy that..."）仍未排除，纯关键词匹配无法完整消歧，需要更多真实语料
  验证误报率后再决定是否要更精细的上下文判据。
- [ ] TODO：公理3 规则4 的"EN 14 词 / ES 16 音节"上限是硬数字，
  但 ES 音节数是 `estimateEsSyllableCount()` 用元音字母组朴素估算的（不是真正
  的西语音节切分器，不处理双元音/连韵等语言学细节），可能与语言学家的真实
  音节切分有出入。**实测说明**：在真实西语语料测试中，若只按原文标点
  标注可能出现超过 16 音节上限的情况，需要在从句中间插入额外气口才能通过。
  估算算法本身目前暂按此执行，待跨更多真实西语语料验证。
- [ ] TODO：公理3 的"句末标点=强"判据用扫描 `.`/`!`/`?` 判定。
  **缩写词典与边界处理说明**：针对真实英语语料中出现的 `a.m.`/`p.m.` 等缩写，
  `scripts/validate.js` 内置了一份固定、非穷举的 `ABBREVIATIONS` 词典（EN:
  `a.m.`/`p.m.`/`Mr.`/`Mrs.`/`Ms.`/`Dr.`/`vs.`/`etc.`/`e.g.`/`i.e.`/`U.S.`/
  `U.K.`；ES: `Sr.`/`Sra.`/`Srta.`/`Dr.`/`Dra.`/`Ud.`/`Uds.`/`etc.`），
  `isAbbreviationPeriod()` 把落在这份词典里的缩写句点从"强制出现气口"判据里排除
  （回归用例见 `--selftest` 第 21 项）。**已知局限**：(1) 词典之外的缩写依然可能
  被误判，这不是通用句子边界检测；(2) 针对句末标点与下一词零空格粘连，目前
  **只对 `!`/`?` 生效，`.` 仍然要求真实空白字符才判定**——因为句点零空格粘贴
  下一个字母在真实文本里多为缩写/小数点/域名，`.` 的零空格粘连场景暂不纳入检测，
  属已知局限。
- [ ] TODO：`checkBreathPlacement()` 的"强制出现"判据对 `!`/`?` 句末标点与
  下一词零空格粘连（例如打字疏漏漏了空格，`"Really?Wait until..."`）已改用
  `\s*`（零或多个空白）与破折号判据看齐，`.` 因为要顾及缩写/小数点维持
  `\s+`（见上一条）——`.` 的零空格粘连场景仍未覆盖。回归用例见
  `--selftest` 第 20 项。
- [ ] TODO：公理3 全部 5 条判据 + 强制出现规则都锚定在
  真实标点字符（逗号/分号/句末标点/破折号）上，对"`source_text` 本身就没有
  标点"这种真实 ASR 转写噪声（在部分真实口播语料中可能遇到）
  没有任何机器可验证的覆盖——这段文本不会触发任何"强制补气口"判据，哪怕
  完全不标气口，只要音节上限满足依然会通过校验。`workflow.md` 2C 节已补一条
  生成期指引（人工按语气边界判断），但这只是建议，不是可验证判据，也没有
  可字符串化的"这里该不该是句子边界"规则可以升级成公理，先记录为已知局限。
- [ ] TODO：公理1 的 archetype 正则只检查"两个字母不同"，不检查"排在前面的
  字母是不是真正的主骨架"（这是语义判断，没有可字符串化的判据），如果后续
  发现大量"辅在前主在后"写反的情况，需要在 workflow.md 加更强的生成期检查
  清单，但不适合升级成 schema 层的硬判据。
- [ ] TODO：本 skill 的 11 模块 / 7 原型骨架取自 TikTok 美区 DR 保健品口播蓝图，
  对其他文案结构（非 DR 私域带货类脚本，例如剧情向 / 访谈向内容）的适用性
  未经验证，是明确的适用边界，已同步写进 `SKILL.md` 核心约束。
