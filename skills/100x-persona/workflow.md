# 100x-persona · 三阶段流程

> 本流程分为三阶段：Phase 1 从脚本反推人物 → Phase 2 场景独立实体建模并与人物关联 → Phase 3 校验与输出。Phase 划分和判据依据 `axioms.md` 4 条公理独立设计。

---

## Phase 1 · 人物反推（从脚本反推人物）

### 触发进入条件
- 用户直接调用 `/100x-persona`
- 或被入口路由（如未来的 `/100x-tiktok`）转来
- 或自然语言触发："给这条脚本配个人设" / "这条脚本谁来讲比较合适" / "give this script a
  persona" / "who should deliver this script"

### 固定开场白（≤60 字）
> 我是人物场景设定生成器。发脚本文案（纯文本），给你谁来讲 + 在哪拍，各自带原文证据。

### 输入分类
- **类别 A（硬性必填）**：`source_script`——完整脚本/文案纯文本。缺失 → 固定拒绝话术
  "至少需要脚本文本才能开始，本 skill 不接视频文件——分析视频请找负责反推/洞察的
  skill"（不点名尚未确认存在的具体 skill 名，避免硬依赖话术），追问一次。
- **类别 B（软性，无三级降级，因为本 skill 只有一个硬输入）**：无。
- **类别 C（上游可选，缺失静默跳过，不阻塞，不要求用户先跑别的 skill）**：
  `100x-segment` 产出的 `segments[]`（若已存在，`pairings[].segment_ref` 可回填对应
  segment id；缺失时 `segment_ref` 字段整体省略，`pairings` 仍靠 `script_span_quote`
  自行定位，不受影响——这是本 skill 独立调用保证的关键：**从不要求先跑 100x-segment**）。

### 接收后立即做（按顺序）
1. **通读 `source_script`**，标出候选"说话人切换点"（口播文案蓝图原型 F"第三方见证
   混剪型"这类脚本可能有 ≥2 个说话人；大多数单人口播脚本只有 1 个）。
2. **对每个候选说话人，按口播文案蓝图模块 2（Authority）+ 模块 3（Pain）两类信号扫描
   原文**：
   - 模块 2 信号：自我身份宣称句（"I've been a ... for N years" / "As a ..." /
     "I'm a ..." 这类第一人称身份/经历宣称，资质型或经历型均可，见 `axioms.md` 公理 2
     "关于'权威'不要求正式资质"说明）
   - 模块 3 信号：人群点名句（"If you're a ..." / "For anyone who ..." /具体痛点
     描述句，标出这个人物在跟谁说话）
3. **逐字复制**命中的原句（不改写、不概括、不翻译）分别填入
   `authority_evidence_quote` / `audience_pain_quote`，据此写一句话总结填
   `authority_basis` / `audience_fit`（总结可以是中文，引文必须是原文逐字）。
4. **推断 `delivery_style`**（语气/人称/口语程度，一句话）和
   `relationship_to_camera`（闭集枚举：`direct-to-camera` / `confessional` /
   `testimonial-witness` / `voice-over` / `duo-dialogue`，见 `schema.json`）。
5. 若脚本**完全没有**任何自我身份/人群点名句（纯功能演示口播，无第一人称叙述）→
   降级：`authority_evidence_quote`/`audience_pain_quote` 改为脚本里语气最强的一句话
   （仍必须是逐字原文），`meta.warnings` 追加一条 `"<persona_id> 权威/人群证据信号弱，
   已用替代锚点句，建议人工复核"`——**不是留空，不是编一句原文没有的话**，是诚实标注
   信号弱 + 仍然满足"必须是原文子串"的硬底线。

### 退出信号
每个候选说话人都产出一个 `persona_item` 草稿（7 个必填字段全非空，`authority_evidence_
quote`/`audience_pain_quote` 已用原文逐字核对） → 进 Phase 2。

### 失败处理
- `source_script` 为空/缺失 → 拒绝 + 追问，追问后仍拿不到 → 终止，不猜测、不代写脚本。
- 通读后连一句可用的语气强句都找不到（极端情况，如脚本只有产品参数罗列无任何人称视角）
  → 停止，回复"这份脚本没有第一人称口播视角，不适合做人物设定，需要先补一版有说话人
  视角的脚本"（不代笔改写脚本本身，那是上游/其他 skill 的工作）。

---

## Phase 2 · 场景建模（独立实体）+ 与人物关联

### 目标
把脚本里的每个"发生地点"独立建模成 `scene_item`（不是人物的附属描述），再用
`pairings[]` 把人物、场景、脚本原句三者绑定。

### 必做动作
1. **扫描脚本里的场景线索**：地点词（bathroom / bedroom / break room / gym 等）、
   动作词暗示的位置（"toss a few in my bag" 暗示携带场景、"couch"暗示休息室）、
   时间/节点词（"before bed" / "right after I get home" / "between shifts"）。
2. **每个不同的场景线索簇独立建一个 `scene_item`**（不与其他场景合并，即使同一个人物
   贯穿全程——公理 1 要求场景是独立实体，一个人物在脚本里出现在 2 个地点就应该对应
   2 个 `scene_item`，不是 1 个场景塞 2 段描述）：
   - `trigger_moment`：这个场景在人物一天/一生里的什么触发时刻发生（不是"随时"，
     要具体到"下班回家换鞋前"这种颗粒度）
   - `location`：物理地点环境
   - `micro_coordinate`：地点内的具体机位/具体动作坐标（不是重复 `location`，要更细
     一级，如"衣柜门把手"而不是"衣柜"）
   - `visual_props`：至少 2 件画面里会出现的具体物件（不写死任何客户品类词典，用
     通用品类词，不发明具体品牌/产品名）
   - `atmosphere`：一句话光线/情绪基调
3. **建 `pairings[]`**：每条 pairing 把「一段脚本原句（`script_span_quote`，逐字子串）」
   绑定到「一个 `persona_ref`」+「一个 `scene_ref`」，并写 `rationale`（为什么这个人物
   +场景组合适合这段原句，一句话）。
4. **自检零孤儿**（公理 4 落地）：`personas`/`scenes` 里定义的每一个条目，检查是否至少
   被一条 `pairings[]` 引用；没有被引用的条目要么删掉、要么补一条 pairing，不允许"建了
   不用"。
5. **自检泛化词/道具数量**（公理 3 落地）：`trigger_moment`/`location`/`micro_coordinate`
   逐条过一遍 `axioms.md` 公理 3 的闭集泛化词表；`visual_props` 数量 ≥2。

### 逐条自检（每个 scene/pairing 写完过一遍）
- [ ] 公理 1：`scene_ref` 指向的 key 真的存在于 `scenes`
- [ ] 公理 2：`script_span_quote` 是 `source_script` 的逐字子串
- [ ] 公理 3：`trigger_moment`/`location`/`micro_coordinate` 不含泛化词，`visual_props`
  ≥2 件
- [ ] 公理 4：这个 `scene_id`/`persona_id` 至少被一条 pairing 引用

任一未过 → 只重写该条（该场景或该 pairing），不推倒重来整份文档。

### 退出信号
`personas`/`scenes`/`pairings` 全部通过逐条自检 → 进 Phase 3。

### 失败处理
- 脚本里找不到任何具体场景线索（纯棚拍无场景暗示的口播，如对着白墙念参数）→ 停止，
  回复"这份脚本没有可辨识的场景线索，无法独立建场景实体，需要人工补充拍摄场景设定"
  （不编造脚本里不存在的场景细节）。
- 零孤儿自检不过 → 删掉未引用条目或为其补一条有依据的 pairing，二选一，不允许绕过。

---

## Phase 3 · 输出

### 必做动作
1. 组装 `PersonaSceneBundle` JSON，严格按 `schema.json` 结构（`source_script` +
   `personas` + `scenes` + `pairings` + `meta`）。
2. 运行（或等效人工执行）`node scripts/validate.js <文件>` 逻辑：referential integrity
   （公理1）+ evidence quote 子串检查（公理2）+ 泛化词/道具数量（公理3，`schema.json`
   已锁一部分）+ 零孤儿（公理4）全部通过，才可以把 JSON 作为终稿返回。
3. 可选渲染一张人类可读的 Markdown 摘要（人物列表 + 场景列表 + pairing 对照表），
   JSON 是唯一的机器可读契约，Markdown 是给用户读的附加产物。
4. `meta.warnings` 如实保留 Phase 1/2 里产生的降级提示（权威/人群证据信号弱等），
   不因为"要产出干净结果"而隐藏。

### 退出信号
JSON 通过全部 4 条公理判据 → 输出，结束（或等待用户返工触发）。

### 失败处理（返工，用户触发，非必经）
| 用户说 | 返工粒度 |
|---|---|
| "这个人设不太对" | 只重做该 `persona_item`，回 Phase 1 对应人物重新扫描，其余不动 |
| "这个场景不像会发生这事的地方" | 只重做该 `scene_item`，回 Phase 2 对应场景重新扫描，其余不动 |
| "这两个不该配一起" | 只改对应 `pairings[]` 条目的 `persona_ref`/`scene_ref`/`rationale`，
  人物场景定义本身不动 |
| "整批重来" | 全部重跑 Phase 1→2→3 |

**禁用返工路径**：不为了"看起来更专业"给人物编造脚本里没有的资质；不为了"看起来更
精致"给场景加脚本里没有暗示过的道具；不为了凑数量刻意拆出脚本里其实同一个场景的
细节冒充多个独立场景（这会反过来制造零孤儿检查测不出来的"假独立"，公理 4 挡不住这种
滥造，只能挡"定义了不用"，这条留给 Phase 2 人工纪律自律，不是机器判据能完全覆盖的，
见 `axioms.md` TODO）。

---

## 流转图

```
[用户触发]
  ↓
Phase 1 人物反推（扫描Authority/Pain信号 → 逐字引文 → persona_item 草稿）
  ↓ 每个人物字段齐全
Phase 2 场景建模+关联（扫描场景线索 → scene_item 独立建 → pairings 绑定 → 零孤儿自检）
  ↓ 全部通过逐条自检
Phase 3 输出（组装 JSON → 公理1-4 全过 → 可选 Markdown 摘要）
  ↓
  ├→ 满意/无回复 → END
  ├→ 返工触发词 → 局部返工（见上表）
  └→ 脚本无法建人物/场景 → Phase 1/2 各自的失败处理话术，不代笔编造
```
