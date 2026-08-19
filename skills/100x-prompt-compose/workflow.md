# 100x-prompt-compose · 三阶段流程

> 本流程分为三阶段：Phase 1 接收 + 校验（选模板与变量） → Phase 2 生成 + 模型包装 + 自检 → Phase 3 校验输出与按需返工。三阶段保证提示词组装与目标模型包装严格合规。

---

## Phase 1 · 接收 + 校验

### 触发进入条件
- 用户直接调用 `/100x-prompt-compose`
- 或被入口路由（如未来的 `/100x-tiktok`）转来
- 或自然语言触发：给了产品/人设/场景描述，要求"出一条视频提示词" / "帮我填个模板" /
  "give me a Veo prompt" / "generate a UGC video prompt for this"

### 固定开场白（≤60 字）
> 我是提示词组装器。发模板ID或需求描述+变量，选模型(veo/seedance/即创)，出可直接喂模型的最终提示词。

### 接收后立即做（按顺序）

1. **确定 `template_id`**（类别 A，硬性必填，但接受两种给法）：
   - 用户直接报模板 id（如 `VID-D-talking-share`）或模板名（如"口播分享"）→ 直接用
   - 用户只给一段需求描述（如"这是清洁喷雾，想要一喷见效的效果"）→ 按
     `templates.json` 每个模板的 `category`/`use_when`/`applicable` 做匹配，命中
     唯一模板则确认后继续；命中多个候选→列出候选（id+name+use_when）请用户选一个，
     不代选；命中零个候选→按类别 A 失败处理
   - **类别 A 失败**（模板 id 无效 + 需求描述也匹配不到任何候选）→ 固定拒绝话术：
     "没识别出该用哪个模板，本 skill 目前有 14 个模板（5 图片/7 视频/2 通用件），
     可以直接报 id，或说清楚品类+想要的效果（比如'清洁喷雾的一喷见效效果'）"，
     追问一次

2. **确定 `variables_used`**（类别 A/B 混合，逐变量判断）：
   - 该模板 `variables[]` 里 `label` **不含**"(可选)"字样的变量 = 硬性必填（类别 A）：
     缺失时不得代猜/编造具体外观/台词内容，直接追问缺哪几个（一次性列全，不分多轮
     追问）
   - `label` **含**"(可选)"字样的变量 = 软性（类别 B）：缺失时按模板自身的
     `conditional`/正文语义处理（例如 IMG-02 的 `problem` 缺失时 `problem_clause`
     直接解析为空字符串，不追问、不编造）
   - `product_lock`/`persona_ref` 这类"引用锁"变量：若用户没有明确给"参考图N产品/
     人物"这种引用写法，且这是该产品/人物在本次会话里的第一次出现，允许用一段真实
     文字外观描述代替（`templates.json` `meta.hard_rules` 第 2/3 条），**不允许**
     编造用户没提供过的外观细节去凑一段描述——描述不够具体时追问，不脑补

3. **确定场景类变量不含光线词**（对应公理 3）：`scene`/`scenes`/`place`/`rooms`
   若用户原话里带了"柔光""暖光""下午阳光很好"这类光线描述，主动告知"光线交给
   `realism_suffix` 统一处理，场景变量只留地点+可选天气"，代为剥离光线词后确认，
   不因为这条硬规就拒绝生成（这是可以内联修复的降级，不是硬性拒绝项）

4. **确定 `model`（仅当模板 `category=="视频"` 时需要）**：
   - 模板 `model_hint` 列出的候选（如 `["veo","seedance","即创"]`）→ 用户报了就用；
     没报 → 追问一次"这条视频提示词给哪个模型用：{候选列表}？不选默认给
     {候选[0]}"；追问后仍未答复 → 默认取 `model_hint[0]`，
     `meta.model_choice_source="default_first_hint"` + `meta.warnings` 记一条
     "model 未指定，默认使用 {候选[0]}"
   - 模板 `category` 是"图片"/"通用件" → `model` 固定 `null`，不问

5. **确定引用锁编号上下文**（类别 C，上游可选，缺失静默跳过）：`existing_refs_input`
   ——如果用户/上游流程已经建立过产品或人物锁（比如先跑过一次 IMG-01），把已有编号
   带过来；没有就当作本次全部是 `first_lock`，不要求用户"先跑一次 IMG-01"

6. **冲突输入拒绝**：用户直接甩来一整段成片脚本要求"按 8 秒切好多段视频提示词"→
   提示"本 skill 每次只组装单条模板（单个生成单元），多镜头分镜请找负责分镜/GU 切分
   的 skill"（不点名尚未确认存在的具体 skill，避免硬依赖话术）

### 退出信号
`template_id` 确定 + 该模板全部硬性必填变量到位 + （视频模板）`model` 决定

### 失败处理
- 类别 A 缺失（模板选不出/硬性变量缺失）→ 拒绝+追问，追问后仍拿不到 → 终止，
  不代猜、不编造具体外观/台词内容

---

## Phase 2 · 渲染 + 模型包装 + 自检

### 2A · 逐字渲染（对应公理 1）

1. 从 `templates.json` 取出该 `template_id` 的 `body`/`suffix_key`/`conditional`/
   `effect_library`/`hook_library`（如有）。
2. 解析 `conditional_clauses`（若模板有 `conditional` 字段）：
   - IMG-02 的 `problem_clause`：`problem` 变量有值则代入原文模板句，否则解析为
     空字符串
   - IMG-05 的 `layout_desc`：`layout=="上下"` → "上图/下图"；`layout=="左右"` →
     "左图/右图"
   - PART-HOOK 的 `hook_clause`：按 `hook_type` 取 `hook_library` 对应模板句，
     再用 `subject`/`detail` 替换其中的 `[占位]`
3. 把 `variables_used` + 已解析的 `conditional_clauses` + `realism_suffix[suffix_key]`
   一次性代入 `body` 的所有 `{key}` 占位符——**逐字插值，不改写措辞、不删减、不新增
   模板正文没有的句子**。
4. **方括号占位展开**（VID-A/VID-F/PART-HOOK 专属，见 `templates.json`
   `meta.render_notes`）：把【效果公式：…】/【套效果公式：…】/【按 hook_type 选骨架】
   这类方括号连同其中的内容整体替换成 `effect_library`/`hook_library` 对应取值的
   完整描述句，**不把方括号本身或"按…展开"这类元指令文字带进最终输出**。
5. 得到 `rendered_body`。**已知局限（如实记录，不是自我表扬）**：PART-CTA 模板正文
   对 `{object}` 变量有重复拼接（"for {object}"和"your {object} will thank you"
   两处都会代入同一个值），如果 `object` 本身不含"your"，第二处会读成"your your
   {object}"——这是源模板 `templates.json` 正文自身的设计问题（模板给的示例值
   "your dog's teeth"同样会复现），不是本 skill 渲染逻辑的 bug，按公理 1"逐字替换"
   照实渲染，不擅自改写模板正文去"修"这个问题，只在 `meta.warnings` 如实标注。

### 2B · 引用锁记账（对应公理 2）

对该模板每一个"锁相关"变量（`templates.json` 里标了 `establishes_lock` 的模板对应
`product_desc`/`persona`；标了 `references_lock` 的模板对应 `product_lock`/
`persona_ref`）：

- 若这次是该产品/人物**首次**出现（`existing_refs_input` 里没有对应编号，或该变量的
  实际取值是一段真实描述而非"参考图N…"写法）→ 记一条 `reference_locks` 条目
  `status:"first_lock"`，分配一个**未被占用**的新编号（在 `existing_refs_input`
  和本次已分配编号之外取最小可用整数）
- 若这次是**引用**已建立的锁 → 记一条 `status:"reference_reuse"`，`value` 必须逐字
  写成"参考图N产品"或"参考图N人物"，N 取自 `existing_refs_input` 里真实存在的编号，
  不可虚指一个不存在的编号
- 组装 `meta.established_refs_after` = `existing_refs_input` 并上本次所有
  `first_lock` 新编号

没有锁相关变量的模板（如 VID-B/VID-E/VID-G/PART-HOOK/PART-CTA）→ `reference_locks`
留空数组，跳过本节。

### 2C · 场景光线词自检（对应公理 3）

逐个扫描 `variables_used` 里键名匹配 `scene`/`scenes`/`place`/`rooms` 的值，命中
闭集光线词表（见 `axioms.md` 公理 3）→ 回 Phase 1 步骤 3 重新剥离，不进入 Phase 3
才发现。

### 2D · 模型包装（仅视频模板，对应公理 4）

`category=="视频"` 且 `model` 已定：

| model | 包装规则 | 详见 |
|---|---|---|
| `veo` | 单条 `rendered_body` 转译成 Veo 3.1 五段式英文（定位/Visual/Dialogue/Timing/Style Lock），`duration_seconds` 固定 8.0 | `profiles/veo.md` |
| `seedance` | 转译成连贯英文散文（不显式分段标签），结尾硬加 `no text, no subtitles, no watermarks`，`duration_seconds` 固定 10.0 | `profiles/seedance.md` |
| `即创` | 保留 `rendered_body` 中文原文，标注 `narrative_shot_type`（情绪/痛点/产品/场景/对比/转折/CTA 七选一），不做时长/禁词硬校验（本 skill 无来源材料，已知局限） | `templates.json` `model_wrappers.即创` |

台词类变量（`line_en`/`line_open`/`line_rec`/`line`）若源自非英文语料，必须先改写
成美式口语化英文再进 `final_prompt_wrapped`（`templates.json` `meta.hard_rules`
第 5 条"面向美区 TikTok：口播台词用美式口语化英文"——这不是本 skill 新加的限制，
是模板库本身对台词的硬规，不因为源素材是西语/中文就破例保留原语言）；中文台词若
确需保留（如面向大陆用户的 seedance/即创产出），按 `profiles/seedance.md` 的
`In Mandarin Chinese: {台词}` 写法处理。

### 2E · 逐项自检（每次渲染完过一遍 4 条公理）
- [ ] 公理 1：`rendered_body` 与 `templates.json` 重建结果逐字一致，无残留占位符
- [ ] 公理 2：`reference_locks` 里 `reference_reuse` 条目指向的编号真实存在于
  `existing_refs_input`；`first_lock` 编号不与已有编号冲突
- [ ] 公理 3：场景类变量 0 命中光线词
- [ ] 公理 4（仅视频）：`video_unit.duration_seconds` 等于所选模型上限；
  `final_prompt_wrapped` 0 命中该模型禁词表（结尾固定句本身除外）；结尾固定句/
  Style Lock 句一字不差

任一未过 → 只重写该项对应的段落，不整份推倒重来。

### 退出信号
渲染 + （视频）模型包装全部通过 `scripts/validate.js` 判据 → 输出
`ComposedPromptBundle` JSON（+ 可选人类可读摘要：模板名/变量表/最终提示词）

### 失败处理
- 逐字渲染和模板对不上 → 回 2A 重渲染，不允许"意译一下更通顺"
- 引用编号指不上 → 回 Phase 1 步骤 5 补 `existing_refs_input`，或改成 `first_lock`
- 光线词命中 → 回 2C 剥离重写
- 模型禁词/时长不符 → 回 2D 重写该 `video_unit`（单条重写上限 3 次，仍不过 →
  保留最佳版 + `meta.warnings` 追加"未通过公理4，保留最佳版"）

---

## Phase 3 · 返工（用户触发，非必经）

| 用户说 | 返工粒度 |
|---|---|
| "这条台词不自然" | L1 单变量：只改对应 `variables_used` 键，重渲染 `rendered_body`（及视频模板的包装） |
| "锁引用错了/编号不对" | L1 单变量：只改 `reference_locks` 对应条目，其余不动 |
| "帮我换个模型试试" | L2 换模型：`rendered_body` 不变，回 2D 用新 `model` 重新包装 |
| "整条不对，重来" | L3 整体：回 Phase 1 重选模板或重填全部变量 |
| "帮我加一段西语台词" | **没有对应返工路径。** `templates.json` `meta.hard_rules` 第 5 条要求台词面向美区
  TikTok 用美式口语化英文，本 skill 不产出非英文台词版本；回复用户"本 skill 台词
  固定输出美式英文，如需西语版本需要新开 skill 或等模板库扩展语言支持" |

**返工上限**：L1 无上限；L2 无上限（换模型不消耗次数）；L3 整体重来 2 次，超限 →
"连续 2 轮整体重做仍不通，多半是模板选型不合适，建议换一个更贴合需求的模板 id
重新开始。"（不点名要求用户先跑某个具体 skill）

**禁用返工路径**：不为"看起来更专业"给 `rendered_body` 加模板正文没有的形容词；
不为凑 veo/seedance 的禁词检查而删掉必要的场景描述内容（应该换用等价的合规表达，
不是删信息）；不为图省事把 `reference_reuse` 改成随便编一个不存在的编号；不主动
建议用户去跑其他 skill。

---

## 流转图

```
[用户触发]
  ↓
Phase 1 接收+校验（选模板→变量到位→场景无光线词→[视频]选模型→引用编号上下文）
  ↓ 类别A过
Phase 2 渲染+模型包装（逐字插值→方括号展开→引用锁记账→[视频]模型包装→逐项自检）
  ↓ 全过
产出 ComposedPromptBundle JSON（+ 可选人类可读摘要）
  ↓
  ├→ 满意/无回复 → END
  ├→ 返工触发词 → Phase 3（L1单变量/L2换模型/L3整体，无"非英文台词"分支）
  └→ 返工 2 次不过 → 提示换模板重开，不指名路由
```
