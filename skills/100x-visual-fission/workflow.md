# 100x-visual-fission · 三阶段流程

> Phase 划分直接抄 VTP 七步流水线的骨架（真源见 `axioms.md` 顶部指针），改动点：
> ① Phase 1 新增"参考材料降级路径"——VTP 原设计的 01/02 反推吃的是真实图片，本仓当前
> 任务没有真实参考图可用，Phase 1 允许"已完成的反推 JSON" 或"文字描述参考外观"两种输入
> 形式，并要求 `source_material_note` 如实标注走的是哪条路径；② Phase 2 在 VTP 原有
> 03→04→06→07 四步之间插入一个"媒介结构判定"子步骤（本 skill 与 VTP 原设计的核心差异，
> 见 `axioms.md` 公理 2），05（EN→CN 翻译）作为可选辅助步骤，不进入产出契约本身；
> ③ Phase 1 新增"不可视化宣称预检测"（呼应 `100x-search-query` Phase 1 步骤 6 的敏感
> 品类检测机制，但检测对象不同：这里检测的是"文案里有没有无法拍出来的营销宣称"，不是
> "品类是否敏感"）。

---

## Phase 1 · 接收 + 校验

### 触发进入条件
- 用户直接调用 `/100x-visual-fission`
- 或被入口路由（如未来的 `/100x-tiktok`）转来
- 或自然语言触发："帮我裂变这条视觉参考" / "这个产品出几个变体" / "生成裂变提示词矩阵" /
  "fission this reference" / "generate prompt variants for this product"

### 固定开场白（≤60 字，51 字）
> 我是媒介裂变生成器。发参考图/反推JSON+产品文案，选定媒介结构，产出锁定人物场景的裂变提示词矩阵。

### 输入分类

**类别 A（硬性必填，两项都要）**：
1. `references[]`——至少 2 条同系列的人物/场景参考材料，每条可以是以下两种形式之一：
   - **(a) 已完成的反推 JSON**：`vtp_prompts_01-person-reverse.md`/`02-scene-reverse.md`
     schema 产出的结构化 JSON（吃真实参考图得到的）；
   - **(b) 文字描述降级**：没有真实参考图可用时，用自由文本描述该参考的具体外观特征
     （不少于"人物+场景各若干具体细节"的颗粒度，不能是一句"随便一个女生"这种泛化描述）。
   两种形式都可以，但走 (b) 时必须在产出的 `source_material_note` 里如实标注
   "text-only degraded path"（`schema.json` 不强制这个字段的具体取值，是诚实披露，不是
   机器可验证的判据）。少于 2 条参考 → 03 提取共性无法做"多张对比"，直接拒绝。
2. `product_brief`——产品名 + 品类 + 效果/卖点叙事文本（哪怕只有一段口播文案也够，只要
   包含"这个产品做什么、期望看到什么变化"）。这段文案是 Phase 2 判定 `media_plan.structure`
   和做"不可视化宣称预检测"（步骤 5）的依据。

**类别 B（软性，三级降级）**：
- `aspect_ratios_wanted`（默认 `["9:16"]`，TikTok 竖版原生比例）
- `variant_count`（04 步"生成几组 prompt_sets"的目标值，默认 2，VTP 原设计里这是用户
  自由指定的参数，不是本 skill 的结构性判据，见 `axioms.md` 文末"为什么不设第 5 条公理"）
- 缺失时：直接用默认值继续跑，`meta.warnings` 追加一条"aspect_ratios/variant_count 未
  指定，已用默认值"

**类别 C（上游可选产出，缺失静默跳过，不阻塞，不要求用户先跑别的 skill）**：
- `100x-persona` 产出的 `PersonaSceneBundle`（若已存在）——若给了，直接把其中
  `personas.<id>` 的外观/风格字段映射成 `constants.person_identity_anchor`、
  `scenes.<id>` 的场景字段映射成 `constants.scene_identity_anchor`，**跳过 Phase 1
  第 1 步的人工反推/文字降级**，效率更高、也更贴近上游已核实过的原文证据；缺失时不影响
  本 skill 独立工作
- `100x-search-query` 产出的搜索词 bundle——本 skill 不消费它，只在"路由"里提及"想先找
  参考图再来裂变，可以先跑搜索关键词类 skill"

### 接收后立即做（按顺序）

1. **读输入**：`references[]`（≥2 条）+ `product_brief`，可选 `aspect_ratios_wanted`/
   `variant_count`，或直接吃 `100x-persona` 的 `PersonaSceneBundle`。
2. **类别 A 校验**：`references[]` 少于 2 条 → 固定拒绝话术追问："媒介裂变至少需要 2 条
   同系列参考材料（反推 JSON 或文字描述都可以）才能分离定量和变量，只有 1 条没法比较哪些
   在变、哪些不变"；`product_brief` 缺失 → 追问"产品是什么、期望看到什么变化"。
3. **类别 B 校验**：缺失走默认值 + `meta.warnings` 提示（见上）。
4. **类别 C（上游 persona/scene 产出）**：若提供，直接复用其身份锚点跳过反推；缺失静默
   跳过，不提示用户去跑 `100x-persona`。
5. **不可视化宣称预检测**（不拒绝生成，只影响 Phase 2 怎么写画面描述——**具体判据，不是
   "注意措辞"这种笼统话**）：扫描 `product_brief` 原始文案，如果命中
   `scripts/validate.js` 的 `UNVISUALIZABLE_CLAIM_WORDS` 表任一词（"clinically
   proven"/"cellular health"/"guarantee"/"% off"/"clínicamente probado"等，完整表见
   该文件），Phase 2 生成画面描述时**必须把这类宣称改写成一个具体的、可拍摄的动作/质地
   变化**（例如把"melts stubborn fat overnight"这类宣称改写成"waistline looking
   visibly more toned"），不能把宣称原句直接抄进 `visual_action`/
   `combined_prompt`/`prompt`。`scripts/validate.js` 的 `unvisualizableClaimCheck`
   是这条规则的第二道防线（**已知局限**：脚本只能扫描最终产出 JSON 里的文本字段，看不到
   Phase 1 读到的 `product_brief` 原文——如果宣称词只留在原始输入、完全没有渗透进产出
   文本，脚本这道二次校验会漏判，第一道防线始终是这一步的人工/LLM 改写判断）。
6. **冲突输入拒绝**：用户直接发来成片视频文件要求"裂变这条视频" → 提示"本 skill 只吃
   已反推的 JSON/文字描述参考，视频本身的反推请先用负责视频反推（VideoStruct）的能力
   处理"（不点名尚未确认存在的具体 skill）。

### 退出信号
`references[]`（≥2 条，反推 JSON 或文字降级）+ `product_brief` 齐全 + 不可视化宣称预检测
已跑一遍 → 进 Phase 2。

### 失败处理
- 类别 A 缺失 → 拒绝 + 追问，追问后仍拿不到 → 终止，不代猜、不拿一张参考硬凑成"2 条"。

---

## Phase 2 · VTP 七步生成 + 媒介结构判定 + 自检

> 骨架对应 VTP 七步中的 01/02（若走 Phase 1 的反推降级路径，在这一步补做）→ 03 →
> **媒介结构判定（本 skill 新增）** → 04 → 06 → 07，05（EN→CN 翻译）是可选辅助，不在
> 产出契约里。

### 2A · 01/02 反推（仅当 Phase 1 走"文字描述降级"路径时需要在这里补做）
若 `references[]` 里的条目是文字描述而非现成反推 JSON，按 `vtp_prompts_01-person-
reverse.md`/`02-scene-reverse.md` 的"先判断看得见什么，只描述看得见的"原则，把每条文字
描述整理成结构化的身份特征草稿（不需要真的产出该 schema 的完整 JSON，只需要提取出足够
写 `constants` 三锚点的具体细节）。**不脑补参考材料没提到的细节**。

### 2B · 03 extract-common（提取共性）
对比 `references[]` 里 ≥2 条参考，在叶字段级别分离：
- **`constants`**：所有参考都相同/语义等价的字段 → 写成 `constants.person_identity_
  anchor`/`scene_identity_anchor`（人物+场景各至少一条具体、非泛化的描述句）+
  `constants.product_identity_anchor`（从 `product_brief` 提取的产品外观描述）
- **`variables`**：有差异的字段 → 按 `dimension`（`camera`/`pose`/`composition`）
  归类，列出 `observed_values`（≥2 个）+ `range_description`
- 铁律（VTP 03 步 RULES 第 4 条）：**叶字段粒度**——不写"衣着不同"，要写"上衣款式不同
  （连帽衫 vs T恤）而下装恒定（黑色运动裤）"

### 2C · 媒介结构判定（本 skill 新增子步骤，对应 `axioms.md` 公理 2）
扫描 `product_brief` 的效果叙事，按下表判定 `media_plan.structure`：

| 叙事特征 | 判定结构 | frame_count |
|---|---|---|
| 无任何前后对比或堆叠效果，纯卖点/产品展示 | `single_frame` | 1 |
| 只有"之前 vs 之后"两个点，无中间过渡动作，无日期标记 | `head_tail` | 2 |
| 有明确的"做动作 → 中间态 → 结果"单一连续过程（不是跨天），如"涂抹→吸收→变化" | `head_mid_tail` | 3 |
| 出现 ≥3 个明确的时间点标记（"day 1"/"第 3 天"/"一周后"/"24 小时内"等） | `multi_day` | 4-8（源文档原话是"先生成 8 宫格图……8 宫格出问题可降到 6 宫格"——默认 8、遇到问题才降到 6，不是"建议 6-8 的范围"，见`功效堆叠与多帧结构.md`） |

- 若叙事里能数出的时间点少于 `multi_day` 结构要求的 4 帧下限（如只有 3 个时间点），
  允许**插值**补一帧过渡态凑够 4 帧，但必须在 `meta.warnings` 里如实注明"第 N 帧为
  插值补充，源文案未直接断言"（`axioms.md` 公理 2 TODO 段已记录这是已知局限：schema
  只能强制"引用一个数字"，验证不了这个数字是否忠实反映源叙事）。
- `structure_justification` 字段写清楚判定依据（引用叙事里的具体时间线信号；`multi_day`
  分支必须引用至少一个数字，`schema.json` 的 `pattern` 会强制这一点）。
- 每一帧按 `功效堆叠与多帧结构.md`"尾图务必写（使用首图作为参考）…其余保持不变"的规则
  写 `visual_action`：第一帧（`head`，或 `multi_day` 的 `day_index` 最小那一帧）
  `uses_first_frame_as_reference:false`，其余每一帧都要写"以第 1 帧为参考，其余不变"
  这句话并把 `uses_first_frame_as_reference` 设为 `true`（`schema.json` 用 `if/then`
  强制这个映射，见 `frame_item` 定义）。
- **不可视化宣称改写落地点**：每一帧的 `visual_action` 是 Phase 1 步骤 5"不可视化宣称
  预检测"要求改写的具体位置——把"melts stubborn fat overnight"这类无法拍出来的宣称，改写
  成"waistline looking visibly more toned"这类具体可拍的动作/质地变化。

### 2D · 04 generate-variants（生成 N 组 prompt_sets）
基于 2B 的 `constants`+`variables` + `product_brief`，产出 `variant_count`（默认 2）组
`prompt_sets`，每组：
- 至少在 2 个轴（`camera`/`pose`/`composition`）上与其他组不同（`axis_tags` 自报）
- 包含 `character_prompt`/`scene_prompt`/`action_prompt`/`combined_prompt` 四个字段
- `combined_prompt` **必须**逐字包含 `constants` 三锚点的原文（这是公理 1 的落地点，不是
  可选项——写完之后要回头核对，不是"大概率包含"）
- 不编造 `constants`/`variables` 里没有的事实（VTP 04 步自检清单原文："not fabricate
  facts not present in `charData`/`sceneData`"）

### 2E · 06 meta-prompt 裂变（媒介结构 × 机位预设 × 画幅）
对 2C 规划出的**每一帧**，从 2D 的 `prompt_sets` 里选一组作为来源（`source_prompt_set_
id`），按 VTP 原版 A/B/C 三档机位/灯光/调色固定表（见 `axioms.md` 公理 2）之一渲染成一条
`fission_variants`：
- `prompt_json.prompt` = 该 `prompt_set` 的内容 + 该帧的 `visual_action` + 该
  `camera_variant` 对应的固定灯光/调色关键词 + VTP 06 步固定真实感兜底后缀（`shot on
  iPhone, visible pores, natural skin texture, minor imperfections, photorealistic`）
- `resolution` 按 `aspect_ratios_wanted` 查 VTP 06 步的 Resolution Map（`9:16→
  1080x1920`/`4:5→1080x1350`/`1:1→1080x1080`）
- **每一帧至少要有一条 `fission_variants` 覆盖**（零孤儿要求，公理 3）；不要求每帧都
  凑满 A/B/C 三档全出，够用即可（`variant_count`/`aspect_ratios_wanted` 越多，可以选择
  多渲染几档，但不是强制义务）

### 2F · 07 negative-prompt（固定常量拼入）
每条 `fission_variants[].prompt_json.negative_prompt` 原样拼入 VTP 固定六类排除词常量
（见 `axioms.md` 公理 4 出处），逐字不可改，且必须和顶层 `negative_prompt` 完全一致。

### 逐条自检（每帧/每组写完过一遍 4 条公理）
- [ ] 公理 1：`combined_prompt`/`prompt` 都逐字包含 `constants` 三锚点
- [ ] 公理 2：`structure`/`frame_count` 匹配，帧顺序正确，`camera_variant` 对应关键词
      都写对了
- [ ] 公理 3：`source_prompt_set_id`/`frame_role`+`day_index` 都指向真实存在的条目
- [ ] 公理 4：`negative_prompt` 一致、真实感缀齐全、`visual_action`/`prompt` 里没有
      抄入不可视化宣称原句

任一未过 → 只重写该条（该帧或该 prompt_set），不推倒重来整份文档。

### 退出信号
`constants`+`variables`+`media_plan`+`prompt_sets`+`fission_variants` 全部通过逐条
自检 → 渲染 `schema.json` 结构的 JSON（+ 可选一张人类可读 Markdown 摘要：媒介结构 + 帧
列表 + 每帧对应的裂变条目）。

### 失败处理
- 帧覆盖不全（零孤儿）→ 补渲染缺失帧对应的 `fission_variants`，不删掉已规划的帧
- `combined_prompt`/`prompt` 漏写身份锚点 → 该条重写，不允许"下次注意"这种口头承诺
- 不可视化宣称混入 → 该帧 `visual_action` 重写成可拍摄的具体变化

---

## Phase 3 · 返工（用户触发，非必经）

| 用户说 | 返工粒度 |
|---|---|
| "这条 prompt 不对" | L1 单条：只改该 `fission_variant` 或其来源 `prompt_set`，追问
  "哪里不对"（人物/场景漂了、动作不对、机位不对） |
| "这一帧规划得不对" | L2 单帧：回 Phase 2 2C 重新规划该帧的 `visual_action`，其余帧不动 |
| "整个结构选错了"（如"这个应该是首中尾不是数日见效"） | L2 结构级：回 2C 重新判定
  `media_plan.structure`，2D/2E 按新结构重做，`constants` 不动 |
| "人物/场景变了" | L3 全体：回 2B 重新提取 `constants`/`variables`，2C-2F 全部重做 |
| "帮我出西语/中文版视觉描述" | **没有对应返工路径。** 本 skill 产出的是英文生成提示词
  （VTP 全套方法论固定用英文喂生图/生视频模型，见方法论文档"六、negative prompt 怎么写"
  段末"关键认知"一节），`constants`/`prompt_sets`/`fission_variants` 的文本字段设计上
  就是英文。回复用户："本 skill 产出的提示词固定是英文（生成模型的输入语言），如果需要
  中文版本供人工阅读，可以另外跑一遍 05 EN→CN 翻译（`vtp_prompts_05-translate-to-cn.md`），
  但那是人工复核用的辅助产物，不会替换英文版" |

**返工上限**：L1 无上限；L2 单帧/结构级重做 2 次；L3 全体重做 1 次；超限 → "连续多轮裂变
不通过，多半是参考材料或产品叙事本身不够清楚，建议先把参考图/文案说清楚再回来试。"（不点名
要求用户先跑某个具体 skill）

**禁用返工路径**：不为了"看起来更专业"给身份锚点加编造细节；不为了凑够媒介结构的帧数而
编造源文案没有的时间点（插值帧必须诚实标注，见 2C）；不为了让某一帧"更好看"而改动
`negative_prompt` 常量；不主动建议用户去跑其他 skill。

---

## 流转图

```
[用户触发]
  ↓
Phase 1 接收+校验（类别A/B/C + 不可视化宣称预检测）
  ↓ 类别A过
Phase 2：
  2A 反推/文字降级（若需要）
  → 2B 03提取共性（constants/variables）
  → 2C 媒介结构判定（single_frame/head_tail/head_mid_tail/multi_day，本skill新增）
  → 2D 04生成N组prompt_sets
  → 2E 06裂变（每帧×机位预设×画幅）
  → 2F 07固定negative_prompt拼入
  → 逐条自检
  ↓ 全过
产出 JSON（schema.json）+ 可选 Markdown 摘要
  ↓
  ├→ 满意/无回复 → END
  ├→ 返工触发词 → Phase 3（L1/L2/L3）
  └→ 返工超限 → 提示素材/叙事不够清楚，不指名路由
```
