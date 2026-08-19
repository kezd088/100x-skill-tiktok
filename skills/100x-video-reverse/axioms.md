# 100x-video-reverse · 核心约束（公理）

> **本 skill 的核心架构与设计特点**
>
> 本 skill 确立了视频反推与变量化生成的核心规范，包含分镜轴、形态轴、双语输出与变量化模板体系。
>
> **本 skill 的架构特点**：
>
> 1. **双轴正交结构**：除了按分镜切的 `shots[]`（时间轴，回答"第几秒发生什么"），还有按画面形态归类的 `visual_forms[]`（形态轴，回答"这条视频一共出现了哪几种画面，每种怎么复刻"）。同一种画面形态会在不连续的多个镜头里反复出现，形态轴把它们收敛成可复用的提示词。两轴通过 `visual_forms[].appears_in_shots` 挂接，公理 4 保证两轴不脱钩。
> 2. **双语并列输出**：每条提示词由 `prompt_en` + `prompt_zh` 双语并列——英文用于模型生成与禁词校验，中文用于运营与制作团队查阅。
> 3. **变量化分析**：通过 `slot_template` + `cross_shot_analysis` 实现镜头内与跨镜头的变量化提炼，公理 5 提供双向闭合与槽位一致性保障。
>
> **与体系内已有规范的对齐**：`shot_purpose` 七值枚举复用分段标准；每段时长上限复用 `MODEL_DURATION_CAP`（`{veo:8.0, seedance:10.0, 即创:null}`）。

---

## 公理 1：没有视频不做反推，超 180 秒直接拒绝

**一句话**：没视频不反推，超 180 秒直接拒绝，不降级。（23 字）

> 五条公理的「N 字」口径统一为**含标点与空格的字符数**（JS `.length`），这样脚本量得过、
> 不用先约定分词规则。`AGENTS.md` §4 的上限是 30 字，五条实测为 23/20/23/23/22，全部达标。

**可验证**：
- **`scripts/extract-frames.mjs` 管入口**：视频不存在 / ffprobe 读不出时长 → `exit 1`；
  时长 > 180.0 秒 → `exit 2` 并给出固定拒绝信息。这是第一道闸，正常流程走不到后面。
- **`schema.json` 管产物**：`source.duration_sec` 上 `exclusiveMinimum: 0` +
  `maximum: 180`。这条不是重复劳动——它堵的是另一个入口：一份**手写或模型凭空编造**的
  bundle 可以完全不经过抽帧脚本，直接声称自己反推了一条 400 秒的视频。ajv 在结构层就
  拒掉，不需要 `validate.js` 出手。（已实测：`duration_sec: 200` 被 ajv 拒绝。）
- **溯源字段同样由 `schema.json` 管**：`source.frames_analyzed` 的 `minimum: 1` +
  `meta.frames_source` 的 `minLength: 1`，把产物钉回一次真实的抽帧运行。
  注意：`schema.json` 中 `minimum: 1` 与 `minLength: 1` 已经由 ajv 结构化拦截，
  `scripts/validate.js` 中的同名校验作为防御性兜底存在。
- **两层都管不到的**：校验器不会去读 `frames_source` 指向的文件、核对帧数是否真的对得上
  （那要求校验时刻文件仍在原地）。所以这条只挡"字段缺失"，挡不住"路径是编的"。

**出处**：视频缺失或时长超过 180s 时前置拒绝并终止。180 秒为硬性上限阈值，本 skill 把拒绝动作前移到抽帧脚本的 exit code（更早、更硬），schema 里的 `maximum: 180` 作为结构层第二道闸。

**反例（作废）**：
- `source.duration_sec = 200` → ajv 拒绝（`--selftest` 回归用例，已实测通过）
- `source.duration_sec = 0` 或负数 → ajv 拒绝（`exclusiveMinimum`）
- `meta.frames_source` 为空串 → `validate.js` 判 FAIL
- 对一条 200 秒视频跑 `extract-frames.mjs` → `exit 2`，不产出任何帧

---

## 公理 2：每段不超模型上限，时间轴首尾相接不留缝

**一句话**：每段不超模型上限，时间轴首尾相接不留缝。（20 字）

**可验证**：
- **`schema.json` 只管形状**：`time_bucket` 的 `pattern`
  `^[0-9]+\.[0-9]-[0-9]+\.[0-9]$` 锁死"秒后恰好一位小数"的书写格式。它**只能管到这里**。
- **`scripts/validate.js` 管全部实质约束**（都需要把两个数字从字符串里解析出来再跨条目
  比较，JSON Schema 没有任何关键字能做到）：
  - **C1** 首镜 `start == 0.0`
  - **C2** 末镜 `end` 与 `source.duration_sec` 相差 ≤ 0.2 秒（容差照搬私有源技能）
  - **C3** 相邻镜头首尾相接：`shots[i].end == shots[i+1].start`，不留缝也不重叠
  - **C4** 每镜 `end > start`（禁零时长）
  - **C5** `shot_id` 从 1 起连续递增，不跳号
  - **时长上限**：`end - start` ≤ `target_model` 对应的上限。`veo` = 8.0、
    `seedance` = 10.0；`即创` 在本仓 `MODEL_DURATION_CAP` 里是 `null`（无公开上限数据）、
    `generic` 不指名引擎，两者一律落到**最严档 8.0**——宁可切碎也不产出喂不进去的段。

**出处**：生成公理与分段上限规范（veo ≤8s / seedance ≤10s 等分档，以及 C1-C5 连续性断言）。上限数值复用 `MODEL_DURATION_CAP` 常量，`即创`/`generic` 落最严档 8.0 秒。

**反例（作废）**：
- `target_model: "veo"`，某段 `"0.0-9.0"`（9 秒 > 8.0 上限）→ FAIL
- `shots[0].time_bucket` 从 `"1.0-..."` 起（首镜不从 0.0 开始）→ C1 FAIL
- `["0.0-5.0", "5.5-10.0"]`（中间少了 0.5 秒）→ C3 FAIL
- `["0.0-5.0", "4.0-10.0"]`（重叠）→ C3 FAIL
- `"4.5-4.5"`（零时长）→ C4 FAIL
- `shot_id` 序列 `[1, 3]`（跳号）→ C5 FAIL
- 末镜 `end = 30.0` 但 `source.duration_sec = 34.6` → C2 FAIL

---

## 公理 3：英文提示词禁 21 个套路词，末尾必挂三否定

**一句话**：英文提示词禁 21 个套路词，末尾必挂三否定。（23 字）

**可验证**：
- **`schema.json` 管两件事**，靠 `prompt_en` 的单条 pattern
  `^(?=[\x20-\x7E]+$).*, no text, no subtitles, no watermarks$`：
  - 前瞻把整串钉死在**可打印 ASCII** 范围内。这是"纯英文"这条要求在正则里唯一能落地的
    形式——"这段话是不是英语"无法用正则表达，但"有没有混进非 ASCII 码位"可以，而后者
    正是真实故障模式（中文分析标签、西语重音字符漏进本该纯英文的字段）。顺带也排除了
    换行符，提示词被约束成单行。
  - 尾锚强制 `, no text, no subtitles, no watermarks` 结尾。
  （均已实测：缺后缀、混中文、带重音符的西语、含换行、后缀后有尾随空格，全部被拒。）
- **`scripts/validate.js` 管禁词扫描**（draft-07 的 `pattern` 没有大小写不敏感标志，
  21 个词 × 每种大小写写成正则不可读，只能交给代码）：
  - **AI 美化词 11 个**：`cinematic` `professional` `studio` `beautiful` `stunning`
    `smooth skin` `perfect` `flawless` `polished` `editorial` `glamour`
  - **文字层 10 个**：`text` `subtitle` `caption` `watermark` `logo` `title` `font`
    `letter` `word` `overlay`

**扫描范围**（覆盖以下全部字段）：
`shots[].prompt_en`、`visual_forms[].prompt_en`、`slot_template.template_en`，
**以及 `slot_template.slots[].observed_value` 和 `slots[].candidates[]` 的每一项**。
后两处同样纳入扫描范围——否则 21 个禁词可以整词塞进变量表、渲染时被代入
`template_en`、全程零报错。
注意变量表两个字段**不带**强制后缀，扫描它们时不做剥后缀处理，直接扫全串。

**⚠️ 实现上的四个硬性要求，写死在这里，因为每一条都是真被绕过过的**：

1. **扫描前必须先剥掉末尾的固定后缀**。文字层禁词里的 `text` / `subtitle` /
   `watermark` 恰好就是强制后缀 `no text, no subtitles, no watermarks` 里的三个词——
   不剥后缀就扫，**每一条合法提示词都会永远 FAIL**。正确顺序是：先从尾部切掉那段固定
   后缀，再对剩余部分扫禁词。这不是优化，是这条公理能不能跑的前提。
2. **必须用 `\b` 词边界匹配，禁止裸 `.includes()` 子串匹配**——裸子串匹配会
   误伤 `secure` / `manicure`（含 `cure` 子串）或真实感锚点 `unpolished`（含 `polished` 子串）
   造成假阳性，所以必须用词边界从根上解决。`smooth skin` 是**词组**，要按词组
   匹配，不能拆成两个单词各扫一遍。
3. **必须覆盖复数形式**（词尾可选 `s`/`es`）。词表收的是单数 `subtitle`/`watermark`，
   而**强制后缀自己用的是复数** `no subtitles, no watermarks`——表与后缀之间存在字面
   矛盾。不覆盖复数会被一个干净的攻击整条打穿：正文里原样重复一遍伪后缀
   `"…a bottle, no subtitles, no watermarks, no text, no subtitles, no watermarks"`，
   `stripMandatorySuffix` 只切掉**最后一份**，前面那句因为全是复数形式而整句免检，
   实测零报错通过。
4. **扫描前必须做双重归一化，命中任一变体即判定**。归一化只用于匹配，不改动原始字段值。
   两个变体缺一不可，因为**两种攻击方向互相排斥、单一策略必然顾此失彼**：

   | 变体 | 构造 | 挡住的攻击 |
   |---|---|---|
   | `collapsed` | 删连字符 + 连续空白折叠成单空格 | 拆词：`beauti-ful`／`cine-matic`；词组多空格：`smooth  skin` |
   | `spaced` | 连字符换成空格 + 连续空白折叠 | 复合词夹带：`professional-grade`／`studio-quality`／`editorial-style` |

   **`spaced` 变体的豁免规则，范围被刻意压到最小**：只豁免形如
   `<文字层禁词>(s)?-free` / `<文字层禁词>(s)?-less` 的复合词，因为 `logo-free`／
   `watermark-free` 是真实常见的正当表达、语义上甚至与禁词意图相反。两条边界必须守死：

   - **豁免绝不放宽到 AI 美化词**。`logo-free` 等属于文字层正当表达，而 `professional-free` 等属于刻意构造，因此豁免范围限定在文字层 10 词。
   - **豁免绝不扩展到 `-to-` 这类"第二个词不受约束"的形式**。`<文字层禁词>-to-<任意词>`
     形式的第二个词不受约束，可能导致禁词逃逸。因此 `-to-` 形式不开放豁免——设计权衡
     （`text-to-speech`／`speech-to-text` 会被判定 FAIL）已在 `SKILL.md`
     已知局限第 10 条中声明，并在 `--selftest` 里通过用例锁定。

**出处**：21 个禁词清单（11 个 AI 美化词 + 10 个文字层词）与末尾三否定后缀锁。词边界匹配要求避免了 `polished`/`unpolished` 假阳性。扫描前剥离末尾固定后缀的执行顺序确保了自洽校验。

**反例（作废）**：
- `"A beautiful woman with flawless skin in cinematic lighting, no text, no subtitles, no watermarks"`
  → 命中 `beautiful` / `flawless` / `cinematic` 三个，FAIL
- `"A woman holding a bottle"`（无后缀）→ ajv 拒绝
- `"厨房里的女人, no text, no subtitles, no watermarks"`（非 ASCII）→ ajv 拒绝
- `"A woman reads the subtitle on screen, no text, no subtitles, no watermarks"`
  → 剥掉后缀后仍含 `subtitle`，FAIL（这条专门验证"剥后缀"没有把正文里的真禁词一起放过）
- `"An unpolished, bare kitchen counter, no text, no subtitles, no watermarks"`
  → **必须 PASS**（`unpolished` 是正向真实感锚点，词边界不应命中 `polished`）

**已知局限（如实声明，不假装管住了）**：
- ASCII 检查**放行全 ASCII 的西语**——`"Una mujer en la cocina sostiene una botella,
  no text, no subtitles, no watermarks"` 会通过（已实测确认）。只有带重音符的西语才会被
  拒。"是不是英语"机器判不了，这条只挡非 ASCII 字符。
- 词边界匹配**漏派生词**：`perfection`、`professionally` 这类由禁词派生但拼写更长的词，
  `\b` 匹配不到。扩表能缓解，但每扩一个词都要重新评估假阳性风险，暂不做。
- **无连字符的前缀／后缀融合词绕得过，当前设计维持词边界**：`homestudio` 把 `studio` 直接
  焊进一个更长的词，中间没有任何分隔符，`\b` 的前置边界不成立。要抓它必须
  放弃词边界改回子串匹配——那会引入 `secure`/`manicure` 误伤等假阳性，
  代价比收益大。
  **注意跟 `professional-grade` 区分开**：后者**带**连字符，已由要求 4 的 `spaced`
  变体覆盖，不属于这条局限。只有"完全没有分隔符的焊接"才在此列。
- **词表管的是"别用这些词"，管不住"别描述文字内容"**：文字层十个词都是名词，
  但 `phrase`、`lettering`、`typography` 这类同义表达不在表内，例如
  `"displays the bold white capital phrase NEW ARRIVAL centered…"` 会干净通过——字面
  没碰禁词，实质就是在让模型画文字。**扩表治不了这个**（同义词无穷），真正的约束在
  `workflow.md` 2D 对 `text_card` 形态的写法规定：只描述底板，不写文字内容本身。
  那是流程纪律，不是机器判据，如实标注为机器管不住的部分。
- 21 词表来自保健品/家居类目的真实语料归纳，跨到别的品类大概率需要扩表。

---

## 公理 4：每种画面形式引真镜头，每个镜头必被覆盖

**一句话**：形态轴引真镜头，每个镜头都被至少一种形态覆盖。（23 字）

**可验证**：
- **`schema.json` 能管两件事**：
  - `appears_in_shots` 上的 `uniqueItems: true` 挡住同一个 `shot_id` 在一条
    `visual_form` 里被列两遍。**跨数组的引用关系它完全看不见**。
  - 顶层 `allOf` 里的一条 `if/then`：**当 `shots` 有 ≥2 条时**，
    `cross_shot_analysis.invariants` 才强制 `minItems: 1`。单镜视频没有跨镜头维度，
    `invariants` 和 `varying_axes` 允许为空数组；当 `shots` 有 ≥2 条时，`invariants`
    必须满足 `minItems: 1`。数组长度的 if/then 属于 draft-07 可表达的跨分支规则，留在 schema 层。
- **`scripts/validate.js` 管双向**（这是本公理的实质）：
  - **正向·引用完整性**：每个 `visual_forms[].appears_in_shots[]` 里的整数，必须是
    `shots[]` 里真实存在的 `shot_id`。指向不存在的镜头 = 形态轴在描述一段不存在的画面。
  - **反向·零孤儿覆盖**：每个 `shots[].shot_id` 必须至少被一条 `visual_forms` 引用。
    有镜头没被任何形态覆盖 = 这条视频里有一段画面，形态轴假装它不存在。
  - **形态唯一**：`visual_forms[].form_type` 在数组内不得重复。同一种画面形态出现两条，
    说明该收敛的没收敛——形态轴存在的全部理由就是把分散的同类镜头合并成一条。
  - `cross_shot_analysis.invariants[].holds_in_shots[]` 同样必须指向真实 `shot_id`。

**出处**：双轴结构（时间轴 + 形态轴）设计决策，采用双向引用完整性与零孤儿覆盖机制保证两轴严格挂接。

**反例（作废）**：
- `shots` 有 1/2/3，某 `visual_form.appears_in_shots = [4]` → 引用完整性 FAIL
- `shots` 有 1/2/3，所有 `visual_forms` 加起来只引用了 1/2 → 镜头 3 是孤儿，FAIL
- 两条 `visual_forms` 的 `form_type` 都是 `talking_head` → 形态唯一 FAIL
- `invariants[0].holds_in_shots = [1, 99]` → 引用完整性 FAIL

---

## 公理 5：模板槽位与变量表双向闭合，中英槽位一致

**一句话**：模板槽位与变量表双向闭合，中英模板槽位一致。（22 字）

**可验证**：
- **`schema.json` 管命名与存在性**：`slot_item.name` 的 `pattern` `^[A-Z][A-Z0-9_]*$`
  锁死 ALL-CAPS 命名（让 `validate.js` 的分词器有个无歧义的目标，不会把普通花括号散文
  误当槽位）；`template_en` 的 pattern 里带一条前瞻 `(?=.*\{[A-Z][A-Z0-9_]*\})`，
  保证"模板"至少含一个槽位——一个槽位都没有的字符串不是模板，是提示词。
  `candidates` 的 `minItems: 2` 是定义级要求：只有一个候选值的槽位什么都没变，本来就该
  留成模板里的字面文本。（已实测：无槽位模板、小写槽位名、只有 1 个 candidate，均被拒。）
- **`observed_value` 与 `candidates[]` 同样锁纯 ASCII**（`pattern` `^[\x20-\x7E]+$`）：
  防止代入 `template_en` 的槽位值夹带非 ASCII 字符导致生成的英文提示词不合规。
  公理 3 的保证同时覆盖 schema 直接检查的字符串与代入模板的值。
- **`scripts/validate.js` 管闭合**（要把 `{VAR}` 从字符串里分词出来做集合比较，
  JSON Schema 做不到）：
  - **正向**：`template_en` 里出现的每一个 `{SLOT}`，在 `slots[]` 里必须有同名条目。
    模板里有槽位却没定义 = 渲染时这个位置会留下一个填不上的洞。
  - **反向**：`slots[]` 里的每一个 `name`，必须在 `template_en` 里真的出现。
    定义了却没用 = 死变量，批量生产时会产生一个不起作用的维度。
  - **中英一致**：`template_zh` 的槽位集合必须与 `template_en` **完全相同**。这是双语
    扩展带来的新风险——运营改中文模板时删掉或改名一个 `{VAR}`，中英两条就会渲染出结构
    不同的结果，而且这种漂移不看集合比对根本发现不了。
  - **花括号规整性**：`template_en`/`template_zh` 里不得出现 `{{`
    或 `}}`，也不得出现构不成合法 `{SLOT}` token 的孤立花括号。分词正则
    `\{[A-Z][A-Z0-9_]*\}` 只认里层，`{{AGE}}` 实测能过双向闭合检查，但字面替换渲染完
    外层花括号会原样留在提示词里——喂给模型的"生成就绪提示词"带着 `{` `}` 杂质，
    与 `schema.json` 自己写的目标"渲染后的模板本身必须是一条合法生成提示词"直接矛盾。

**出处**：变量化与双向闭合校验设计。设计上与跨素材对比区分开：本 skill 的 `cross_shot_analysis` 做的是**同一条视频内部跨镜头**的对比（`invariants`/`varying_axes`）。`varying_axis_item.axis` 的前三个值（`camera`/`pose`/`composition`）保持通用。

**反例（作废）**：
- `template_en` 含 `{OUTFIT}`，`slots` 里没有 `OUTFIT` 条目 → 正向闭合 FAIL
- `slots` 定义了 `GENDER`，`template_en` 里没有 `{GENDER}` → 反向闭合 FAIL
- `template_en` 有 `{AGE}{ETHNICITY}{OUTFIT}` 三槽，`template_zh` 只有前两个
  → 中英一致 FAIL
- `slots[0].candidates = ["only-one"]` → ajv 拒绝（`minItems: 2`）
- `slots[0].name = "age"`（小写）→ ajv 拒绝（`pattern`）

**已知局限（补充）**：中英一致比的是**集合**，不比出现次数——同一个 `{AGE}` 在中文侧
出现两次、英文侧一次，集合仍相等，实测通过。这是有意的设计而非疏漏：中文表达重复引用
同一个变量（"一位 {AGE} 的…看起来 {AGE} 岁上下"）是合理的，渲染时两处都会填入同一个值。
但运营复制粘贴时误增一处也同样发现不了，如实记在这里。

**已知局限**：中英一致只比对**槽位集合**，不判断 `template_zh` 的中文是不是
`template_en` 的忠实翻译。语义忠实度机器验证不了，同样地，`prompt_zh` 与 `prompt_en`
之间也只做结构对齐（两者都存在、槽位数一致），不做语义比对。

---

## 这五条公理管不到的（写在这里，也写进 `SKILL.md`）

全部五条公理管的都是**格式合规**，没有一条能回答这个 skill 唯一真正重要的问题——
**照着反推出来的提示词生成，画面到底像不像原视频**。这件事只有把 `prompt_en` 真的丢进
Veo / Seedance 跑一遍、人眼比对才知道。`node scripts/validate.js` 全绿只说明"这份产物
结构合法、没有明显自相矛盾"，不代表反推准确。

同理，`shot_purpose` 选得对不对、`form_type` 归类得准不准、`invariants` 是不是真的在那
几个镜头里都成立——这些都是看着画面做的判断，schema 只能保证它们取值落在闭集内，保证
不了取值选得对。
