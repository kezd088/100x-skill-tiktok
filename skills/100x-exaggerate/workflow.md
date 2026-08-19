# 100x-exaggerate · 三阶段流程

> 三阶段骨架参照标准生成流程结构（Phase 1 接收校验 / Phase 2 生成自检 / Phase 3 输出返工），
> 具体判据依据 `axioms.md` 4 条公理独立设计。

---

## Phase 1 · 接收 + 校验

### 触发进入条件
- 用户直接调用 `/100x-exaggerate`
- 或被入口路由（如未来的 `/100x-tiktok`）转来
- 或自然语言触发："帮这条脚本加点夸张" / "这里怎么做反差" / "这段有点平，怎么更抓人" /
  "加个前后对比" / "make this script more dramatic" / "add a before/after contrast" /
  "how do I exaggerate this without it looking fake"

### 固定开场白（≤60 字）
> 我是夸张/反差设计器。发脚本文本，给你夸张手法+反差点，每条锚定原句并按市场帽度校准强度。

### 输入分类

- **类别 A（硬性必填）**：`source_script`——完整脚本/文案纯文本。本 skill **不接视频
  文件**，只吃文本（与 `100x-persona` 同一约束）。缺失 → 固定拒绝话术"至少需要脚本
  文本才能开始，本 skill 不接视频文件——分析视频请找负责反推/洞察的 skill"（不点名
  尚未确认存在的具体 skill 名，避免硬依赖话术），追问一次。

- **类别 B（软性，三级降级）**：`hat_level`（`blackhat`/`grayhat`/`whitehat`）+
  `market`（自由文本，如"美区"/"US"/"西语区"/"通用"）。这两个字段直接决定公理 3 的
  校准天花板，缺失时的降级规则：
  1. 两者都提供 → 直接用，`meta.calibration_note` 记录实际生效的天花板
  2. 只提供 `hat_level`，缺 `market` → 不追问用户，按 `axioms.md` 公理 3"`meta.market`
     缺失时的默认值"处理：`emotion_reaction_hyperbole` 技法按保守分支收紧到
     `moderate`（即使 `hat_level` 是 `blackhat`），其余技法仍按 `hat_level` 基线走；
     `meta.warnings` 追加一条"market 未提供，emotion_reaction_hyperbole 已按保守
     默认收紧"
  3. 两者都缺 → 不追问、不拒绝：`hat_level` 内联推断为 `grayhat`（词典-06"帽度倾向"
     一节对灰帽方向的定性描述是以低强度或中性呈现为主，具体措辞不逐字引用，见
     `axioms.md` 公理 3 出处），`market` 走上面第 2 点的
     保守默认；`meta.warnings` 追加"hat_level/market 均未提供，已按 grayhat +
     保守市场默认推断"

  **不追问 `hat_level`/`market` 的理由**：和 `100x-search-query` 的 `core_benefit`
  内联推断同一逻辑——这两个字段有可机器验证、有出处依据的合理默认值（见 `axioms.md`
  公理 3），追问会打断独立调用体验；如果用户后续明确指出市场/帽度不对，走 Phase 3
  返工即可。

- **类别 C（上游可选，缺失静默跳过，不阻塞，不要求用户先跑别的 skill）**：如果用户
  已经跑过 `100x-persona`/`100x-search-query` 之类的上游 skill 并把产出一起发过来，
  可以在 `rationale` 文本里顺带引用（例如"这条反差点也适合用于 SCENE_BATHROOM 场景"），
  但本 skill **不声明任何依赖这些产出的必填字段**——`schema.json` 完全不含
  `persona_ref`/`scene_ref` 一类的跨 skill 引用字段，避免制造隐性耦合（`100x-persona`
  的 `pairings[].segment_ref` 是"有上游产出时选填一个 id"的轻耦合模式，本 skill 选择
  更彻底的解耦——因为夸张/反差本身是纯文本层面的设计决策，不依赖场景/人物是否已经定案）。

### 接收后立即做（按顺序）
1. 通读 `source_script`，标出候选"可夸张的断言/宣称句"（效果宣称、时间承诺、数字/金额、
   权威引用）和候选"可反差的对照句对"（状态描述转折、警告语转促购语、价格/参照物提及、
   基调突变处）。
2. 按 Phase 1 类别 B 规则确定 `hat_level`/`market`，据此算出本次的技法级强度天花板
   （`axioms.md` 公理 3 的表）。
3. **敏感内容边界**（沿用 `100x-search-query` Phase 1 步骤 6 的精神，但本 skill 不
   独立重复实现该检测——如果脚本本身已经含有虚构的医疗认证/权威宣称，本 skill 的工作
   是**如实标注这些句子属于 `authority_absolutism_hyperbole` 技法**，而不是替脚本
   验证这些宣称是否合规；合规判断不是本 skill 的职责范围，一如词典-06 反复强调的同一
   边界——桥段只做客观事实描述，合规审核留给编导发布前人工把关（具体措辞不逐字引用，
   该表述在词典-06 第 134/154/257/317 行同一位置反复出现），本 skill 沿用同一边界）。

### 退出信号
`source_script` 非空 + `hat_level`/`market` 已定（用户给定或按上述规则推断）→ 进 Phase 2。

### 失败处理
- 类别 A 缺失 → 拒绝 + 追问，追问后仍拿不到 → 终止，不猜测、不代写脚本。
- 通读后连一句可用的夸张/反差候选句都找不到（极端情况，如脚本只有中性产品参数罗列，
  完全没有效果宣称、没有状态转折）→ 停止，回复"这份脚本没有可识别的夸张/反差落点，
  不适合做本步设计，需要先补一版含效果宣称或状态转折的脚本"（不代笔改写脚本本身，
  那是上游/其他 skill 的工作）。

---

## Phase 2 · 生成 + 自检

### 目标
把 Phase 1 标出的候选句，转成 `exaggeration_beats[]`（技法 + 强度）+ `contrast_beats[]`
（反差类型 + 两端锚点），逐条锚定原文，逐条不超过公理 3 的天花板。

### 2A · 夸张点生成
对每个候选断言句：
1. 判定属于 5 个技法中的哪一个（`axioms.md` 公理 1 表格），不确定时优先选择"字面上
   最贴近"的一个，不强行凑齐 5 种都出现
2. 逐字摘录 `script_span_quote`（不改写、不概括、不翻译）
3. 按 `hat_level`（+ `emotion_reaction_hyperbole` 的市场特例）算出天花板，`intensity`
   在天花板之内选择合适档位——**不是天花板允许多高就一定拉多高**，天花板是上限不是
   目标值；一条平实的效果宣称即使 `hat_level=blackhat` 允许 `aggressive`，如果脚本
   原文本身语气克制，也可以标 `moderate`，忠于原文语气优先于"用满配额"
4. 写 `label_cn`（2-6 字中文短标签，词典-06 "L2"层惯例，见 `axioms.md` 公理 1）+
   `rationale`（一句话说明技法+强度选择理由）

### 2B · 反差点生成
对每个候选对照句对：
1. 判定属于 4 个反差类型中的哪一个（`axioms.md` 公理 1 表格）
2. 逐字摘录 `anchor_quote_a` / `anchor_quote_b`，**两端必须来自脚本里真实不同的两处
   表述**，不能为了凑出"反差"而把同一句话抄两遍或稍微改几个字充数（公理 4）
3. 写 `label_cn` + `rationale`

### 2C · 逐条自检（每条写完过一遍公理）
- [ ] 公理 1：`technique`/`contrast_type` 落在闭集枚举内
- [ ] 公理 2：所有 `*_quote` 字段是 `source_script` 的逐字子串
- [ ] 公理 3：`exaggeration_beats[].intensity` 不超过 `hat_level`/`market` 决定的天花板
- [ ] 公理 4：`contrast_beats[].anchor_quote_a` 与 `anchor_quote_b` 不是同一句话

任一未过 → 只重写该条（该 beat），不推倒重来整份文档。单条重写 3 次仍不过 → 保留最佳
版本，在 `meta.warnings` 追加 `"<beat_id> 三次重写仍未通过公理X，保留最佳版"`。

### 2D · 批量自检
- [ ] `exaggeration_beats` 与 `contrast_beats` 各至少 1 条（`schema.json` `minItems:1`
  已锁，这里是生成阶段的自我提醒，不是重复校验）
- [ ] 5 个技法/4 个反差类型没有被强行凑满，只标脚本里真实支持的那几种
- [ ] `meta.warnings` 如实保留 Phase 1/2 产生的所有降级提示（market 默认、hat_level
  推断、beat 重写保留等），不因为"要产出干净结果"而隐藏

### 退出信号
全部 beat 通过逐条自检 → 组装 `schema.json` 结构的 JSON，进 Phase 3。

### 失败处理
- 天花板超限 → 该条 `intensity` 降档，不改 `technique`（降档不能解决问题时才考虑换技法）
- 公理 4 不过 → 重新在脚本里找另一处真正不同的表述作为 `anchor_quote_b`（或 `_a`），
  不允许"稍微改写一下措辞"这种表面差异化处理（那正是公理 4"已知局限"段点名拦不住的
  退化，Agent 生成时应主动避免，不能指望脚本事后帮忙拦截）

---

## Phase 3 · 输出 + 返工

### 必做动作
1. 组装 `ExaggerationContrastBundle` JSON，严格按 `schema.json` 结构（`source_script` +
   `meta` + `exaggeration_beats` + `contrast_beats`）。
2. 运行（或等效人工执行）`node scripts/validate.js <文件>` 逻辑：ajv 结构校验 +
   公理 2（逐字子串）+ 公理 3（天花板）+ 公理 4（非退化反差）全部通过，才可以把 JSON
   作为终稿返回。
3. 可选渲染一张人类可读的 Markdown 摘要（夸张点列表 + 反差点列表），JSON 是唯一的
   机器可读契约，Markdown 是给用户读的附加产物。

### 退出信号
JSON 通过全部 4 条公理判据 → 输出，结束（或等待用户返工触发）。

### 失败处理（返工，用户触发，非必经）
| 用户说 | 返工粒度 |
|---|---|
| "第 X 条夸张点不对" / "这个反差点不对" | L1 单条：只重做该 beat，追问"哪里不对"（技法选错/强度过高或过低/锚点不准） |
| "整体太温和了" / "这平台其实能放开一点" | L2 校准调整：用户明确给出新的 `hat_level`/`market`（例如从"未指定"改成"blackhat + 通用市场"），按新天花板重算所有 `intensity`，`technique`/`label_cn`/锚点不变；**不允许用户单纯说"再夸张点"就无视天花板拉高 `intensity`**——除非用户同时明确了新的 `hat_level`/`market` 组合，否则天花板不变，只是在现有天花板内把偏低的档位调到天花板上限 |
| "这两句反差不够" | L1 单条：换一对锚点，仍需通过公理 4 |
| "整批重来" | 全部重跑 Phase 1→2→3 |

**禁用返工路径**：不为了"更抓人"编造脚本里没有的效果宣称/数字/权威背书；不为了凑数量
硬造 `exaggeration_beats`/`contrast_beats` 条目；不因为用户说"再夸张点"就绕过公理 3
的市场特例（`emotion_reaction_hyperbole` 在美区市场的 `moderate` 上限不因用户口头
要求而松动，除非用户明确改变 `market` 本身——本质是"设计强度"和"目标市场事实"是两件事，
用户可以要求换个更能放开的市场，但不能要求"同一个市场下允许更失真的效果"）。

---

## 流转图

```
[用户触发]
  ↓
Phase 1 接收+校验（类别A/B/C，hat_level/market三级降级）
  ↓ 类别A过 + 天花板已确定
Phase 2 生成（候选句标注 → 技法/反差类型分配 → 逐条自检 → 批量自检）
  ↓ 全过
Phase 3 输出（组装JSON → 公理1-4全过 → 可选Markdown摘要）
  ↓
  ├→ 满意/无回复 → END
  ├→ 返工触发词 → 局部返工（L1/L2，见上表）
  └→ 脚本无夸张/反差可用落点 → Phase 1 失败处理话术，不代笔编造
```
