# 100x-visual-fission · 来源追溯

本 skill 的方法论骨架基于 VTP（Visual Template Proliferator）七步流水线——
本次是将 VTP 七步改写成一个独立 skill，并叠加"媒介裂变"这一原创扩展层。下面逐份记录参考了什么、
用了什么、没用什么、为什么，以及原创判断披露、语料使用记录。

---

## 一、必读素材逐份记录

| # | 文件 | 读了什么 | 用了什么 | 没用什么 / 为什么 |
|---|---|---|---|---|
| 1 | 《反推方法论·四类反推与VTP七步》 | 全文（四类反推表、VTP 七步全枚举、定量/变量二分说明、双轨输出 VideoStruct/VisionStruct、四条防崩坏硬规、Anti-Studio Bias、negative prompt 六类排除词固定常量原文） | Phase 2 的 VTP 七步骨架直接采用该文档"二、VTP 七步流水线"一节；`schema.json`/`axioms.md` 的 `negative_prompt` 常量逐字取自该文档"六、negative prompt 怎么写"一节；公理 4 的"不可视化宣称禁止"精神呼应该文档"四、图片反推（VisionStruct）"一节的 Anti-Studio Bias/Raw Skin Precision | VideoStruct（视频反推双轨输出、四条防崩坏硬规）与本 skill 无直接对应关系——本 skill 消费的是"已反推的人物/场景 JSON"或文字降级描述，不做视频反推本身，这部分只作为方法论背景理解，未落地成具体判据 |
| 2 | VTP 人物反推 schema | 全文（人物反推 schema：`subject_detection`/`visibility_map`/`face`/`skin`/`body_parts_detail`/`clothing`/`interactions` 等字段，"先判断看得见什么，只描述看得见的"原则） | Phase 1 类别 A"参考材料"的形式定义之一（"已完成的反推 JSON"）直接指向这份 schema；workflow.md Phase 2A 的"不脑补参考材料没提到的细节"原则直接复用该文档"先判断看得见什么"精神 | 完整字段列表未原样复制进本 skill 的 `schema.json`（本 skill 的 `constants.person_identity_anchor` 是从反推 JSON 提炼出的**一句锚点描述**，不是完整转发反推 JSON 本身，两者是不同层级的产物，见下方"原创判断披露"） |
| 3 | VTP 场景反推 schema | 全文（场景反推 schema：`objects[]`/`spatial_relations`/`person_placeholder` 等字段） | 同上，`constants.scene_identity_anchor` 的提炼来源 | 同上，完整字段列表未原样复制 |
| 4 | VTP 提取共性提示词 | 全文（RULES 5 条：常量/变量判据、叶字段粒度、null 处理、`template_prompt` 合成规则；两套维度填充：人物 8 维/场景 7 维） | workflow.md Phase 2B 直接复用该文档 RULES 第 1/4 条（常量判据、叶字段粒度）；`schema.json` 的 `variables[]` 结构（`dimension`/`name`/`observed_values`/`range_description`）字段名直接对应该文档 OUTPUT FORMAT 里的 `variables` 数组结构 | 该文档区分"人物 8 维"/"场景 7 维"两套详细分析维度未逐条搬进本 skill 的 `variables[].dimension` 枚举——本 skill 把 `dimension` 收窄为 `camera`/`pose`/`composition` 三类（见下方"原创判断披露"第 2 条），原文更细的维度（如 skin.tone/hair.texture）留给 Phase 2B 的自由描述文本，不升级成枚举字段 |
| 5 | VTP 生成变体提示词 | 全文（"至少 2 个轴不同"规则、`character_prompt`/`scene_prompt`/`action_prompt`/`combined_prompt` 四字段结构、自检清单"不编造 charData/sceneData 里没有的事实"） | `schema.json` 的 `prompt_set_item` 四字段（`character_prompt`/`scene_prompt`/`action_prompt`/`combined_prompt`）+ `axis_tags`（对应"至少 2 个轴不同"规则）逐字对应该文档结构；workflow.md Phase 2D 直接引用该文档自检清单原文"not fabricate facts not present in charData/sceneData" | `variant_label` 未强制格式（该文档只要求"Short label"），本 skill 同样只要求非空字符串，未加额外判据 |
| 6 | VTP 翻译提示词 | 全文（EN→CN 翻译规则、5 种 instruction 变体、短语字典贪婪匹配策略） | workflow.md Phase 3 返工表"帮我出西语/中文版视觉描述"一行明确指向这份文档作为可选辅助步骤 | 未落地成本 skill 产出契约的一部分（`schema.json` 不含中文译文字段）——该文档本身也说明是"任意阶段的辅助功能"，不是产出契约的必经步骤，本 skill 遵循同样定位：可选、不强制、不影响独立调用 |
| 7 | VTP meta-prompt | 全文（A/B/C 三档机位/灯光/调色固定预设表、Resolution Map、`prompt_json` 固定 schema 含真实感兜底后缀、"三变体只在 camera/lighting/color grading 三处不同"铁律） | `schema.json` 的 `fission_variant_item` 直接采用该文档的 Variant Definitions 表（camera_variant A/B/C → lens/angle/framing/height/lighting/color_grading）+ Resolution Map（aspect_ratio → resolution）+ `prompt` 字段固定真实感兜底后缀（`shot on iPhone`等 5 个子串）；`axioms.md` 公理 2 的"没有新增第 4 档机位"直接引用该文档 Rules 第 1/2 条原文 | 该文档 `lens`/`angle`/`framing`/`height` 四个独立机位子字段未在 `schema.json` 里拆成结构化字段——本 skill 把这四项折叠进 `prompt_json.prompt` 的自由文本里（只用 `pattern` 前瞻校验灯光/调色关键词是否存在），是本次为控制 schema 复杂度做的简化，见下方"原创判断披露"第 3 条 |
| 8 | 《功效堆叠与多帧结构》 | 全文（首尾/首中尾/数日见效 3 种帧结构模板、"尾图务必写使用首图作为参考…其余保持不变"铁律、8 宫格出问题可降到 6 宫格的实操注释） | `schema.json` 的 `media_structure_enum`（`head_tail`/`head_mid_tail`/`multi_day` 三项直接对应该文档三种结构）+ `frame_item.uses_first_frame_as_reference` 字段（直接落地"使用首图作为参考"铁律）+ `media_plan.frame_count` 的 `multi_day` 分支上限 8（默认先出 8 宫格，出问题才降到 6，不是"建议 6-8 的范围"，该文档原话"8 宫格出问题可降到 6 宫格"） | 该文档给出的具体产品案例（祛痘膏红肿消退、除锈喷雾泡沫、水杨酸 7 天见效、牙贴变白）未直接照搬成本 skill 的 `evals/` 内容——`evals/` 改用参考语料（保健品类目）衍生的合成示例，不借用该文档自带的案例文案 |
| 9 | 《出片SOP·从产品到成片》 | 全文（6 步标准工作流路由地图、按品类/内容阶段/镜头三张检索路由表、冲突优先级"用户明确要求>规则手册>本SOP>案例库>模型默认习惯"） | `SKILL.md`"路由"一节的措辞风格参照该文档"想抄爆款先走反推方法论，再回到第 3 步"这类"产出后按需推荐"写法；确认了本 skill 在 6 步工作流里对应"3 选模版"+"5 锁一致性"两步之间的位置（先选帧结构模版，再锁人物/场景/产品一致性） | 该文档给出的完整品类检索路由表（清洁/护肤/宠物/家纺/服饰/鼠害/节日 7 类）未搬进本 skill——本 skill 是通用生成器，不维护任何客户专属品类词典，`category` 字段保持自由文本 |

---

## 二、原创判断披露（如实标注，不假装有出处）

以下设计判断是本 skill 的**原创设计**，逐条列出避免"声称有依据实际没有"：

1. **"媒介裂变"整个第二层轴（`media_plan.structure` 四选一 × VTP 原版机位裂变）**——
   `axioms.md` 开篇与公理 2 已详细说明，这是本 skill 的核心原创扩展，VTP 原设计
   （`vtp_prompts_06-meta-prompt.md`）只有机位/灯光/调色一层轴，没有媒介结构这一层。
2. **`variables[].dimension` 收窄为 `camera`/`pose`/`composition` 三类闭集枚举**——
   `vtp_prompts_03-extract-common.md`/`04-generate-variants.md` 原文的"轴"概念更细
   （八维人物分析/七维场景分析，`04` 步的"2+ axes"举例是"Camera angle/framing, Pose/
   Action, Composition"三类），本 skill 直接采用 `04` 步举例的三分类作为闭集枚举（这点
   有直接出处，不算完全原创），但把 `03` 步更细的八/七维分析**收窄**成这三类顶层
   `dimension` 标签（更细的差异描述放进 `name`/`range_description` 自由文本），这个
   "收窄成三类枚举"的具体判断是本次原创简化，不是两份原文档任何一份直接给出的。
3. **`fission_variant_item.prompt_json` 不单独结构化 `lens`/`angle`/`framing`/
   `height`/`style`/`focus` 等子字段，只保留 `prompt`（自由文本）+ `resolution`**——
   `vtp_prompts_06-meta-prompt.md` 原版 `settings.camera` 是一个含 5 个子字段的嵌套
   对象。本次判断：与其把 VTP 固定 A/B/C 预设表的每个子值都变成独立 schema 字段（这样
   `camera_variant=A/B/C` 和这些子字段之间会形成 6+ 组需要 if/then 维护的一一对应关系，
   容易漂移），不如把这些具体值折叠进 `prompt` 的自由文本本身，只用 `pattern` 前瞻校验
   "该出现的关键词确实出现了"——这是本次为控制 schema 复杂度、避免同一份固定表在
   schema.json 里被拆成过多字段而多处重复的简化决策，`axioms.md` 公理 2 TODO 段未展开
   这条，这里补充说明。
4. **`single_frame` 作为 `media_structure_enum` 的第 4 个值**——`功效堆叠与多帧结构.md`
   原文只列了 3 种带堆叠效果的结构，`single_frame`（无堆叠、单帧直出）是本次新增，
   `axioms.md` 公理 2 已披露。
5. **`UNVISUALIZABLE_CLAIM_WORDS` 关键词表**——`axioms.md` 公理 4 已披露这是本次为
   "媒介裂变"任务在真实语料实测中发现的新问题而补的判据，词表本身是本次从参考语料
   （保健品类目为主）里读到的宣称类型抽象归纳出的，不是从任何外部文档提取的现成表。
6. **`constants` 三锚点必须逐字出现在每个裂变分支里（`identityLockCheck`）**——VTP 原
   设计确实要求"person/scene/action 逐字复用不变"（见 `vtp_prompts_06-meta-prompt.md`
   Rules 第 1 条），但原文只是一句"照抄源行不要改写"的操作指令，没有给出"如何机器验证
   这条被真的遵守了"的具体判据；把这条操作指令升级为"逐字子串检查"这个具体机制是本次的
   工程转译，不是原文档就有的验证方法。
7. **插值补帧的诚实披露机制（`meta.warnings` 记录插值帧）**——`功效堆叠与多帧结构.md`
   没有讨论"源素材时间点数量不够 `multi_day` 结构下限时怎么办"这种情况，本次遇到真实
   语料只有 3 个时间点（`evals/example-04`）时选择插值补第 4 帧并在 `meta.warnings`
   诚实标注，是本次原创的工程决策，不是照搬现成规则。

---

## 三、语料使用记录（人工过流程用，脱敏后进 evals/）

> **语料使用与脱敏说明**：真实语料仅用于验证流程，原始真实文案不进仓。跑通的样例脱敏后（标记为 synthetic）存进 `evals/`。下表记录验证覆盖情况：`evals/` 里的 6 个文件是吸收了参考语料的**叙事结构**（帧节奏、时间线信号、品类）之后独立编写的合成内容，不是真实转写文本的简单替换——已逐一核对 `evals/*.json` 与参考语料之间无逐字重合。

| # | 引用 | 品类（脱敏） | 帽度 | 媒介结构 | 对应 evals 文件 |
|---|---|---|---|---|---|
| 1 | 英语参考语料样本 1 | 肠道消化保健品 | blackhat | multi_day（源文案有 7 个显式时间点，本 skill 合并为 6 帧） | `example-01-digestive-comfort-multiday.json` |
| 2 | 英语参考语料样本 2 | 塑形/减脂保健品 | blackhat | head_tail（源文案是"第一天/第十五天"两点式对比） | `example-02-waistline-headtail.json` |
| 3 | 英语参考语料样本 3 | 抗衰老/精力保健品 | blackhat | head_mid_tail（源文案是单次连续开箱-饮用-当日回馈的演示，非跨天叙事） | `example-03-energy-vial-headmidtail.json` |
| 4 | 西语参考语料样本 1 | 循环/腿部保健品 | blackhat | multi_day（源文案只显式提到约 24 小时/一周/第 14 天 3 个时间点，本 skill 插值补第 4 帧，见 `meta.warnings`） | `example-04-circulacion-multiday-es.json` |
| 5 | 西语参考语料样本 2 | 循环保健品(粉剂) | grayhat | head_tail（源文案是症状-缓解式简单对比，无显式时间点） | `example-05-piernas-headtail-es.json` |
| 6 | 西语参考语料样本 3 | 睡眠保健品(软糖) | blackhat | head_mid_tail（源文案是单次连续晚间服用-次日回馈演示，非跨天叙事） | `example-06-dormir-headmidtail-es.json` |

**筛选原则（如实说明）**：语料整体以保健品/健康类目文案为主，其中相当比例涉及
男性/女性私密增大类宣称（明显的成人向内容，规范要求公开仓库不得出现此类
描述）。本次筛选时主动跳过了这类行，只选取不涉及成人向内容的子类目（肠道/塑形/精力/循环/
睡眠），6 条里跨了 3 个语言无关的具体品类子方向、3 种媒介结构都至少覆盖 2 条，
`single_frame` 结构本次真实语料未覆盖到，见 `axioms.md` TODO。

**语料实测发现（供 atom 使用，完整 JSONL 见对话最终回复）**：
1. 保健品类目黑帽文案高频使用"细胞/线粒体健康""临床验证""第三方检测""金额折扣/保证退款"
   这类无法被镜头直接拍到的宣称——这正是公理 4"不可视化宣称禁止"判据的直接触发来源，
   不是凭空设计的。
2. 多帧时间线叙事（`multi_day`）在真实文案里经常只显式断言 3-4 个时间点（"24 小时/一周/
   14 天"这种稀疏采样），而非天天都有断言——`media_plan` 需要"允许插值但必须披露"这条
   设计（见"原创判断披露"第 7 条），就是从这个实测现象里发现必须要有的。
3. 其余 3 条来自 6 条真实语料人工过流程的观察，已整理为 atom，未写入本文件正文（避免和
   最终回复里的 JSONL 内容不同步），完整文本见对话最终回复。

---

## 四、`evals/` 与真实语料的关系（重要披露，呼应第三节说明）

`evals/` 6 个文件的 `product_name`/`constants`/`prompt_sets`/`fission_variants` 里的
具体人物外观、场景细节、产品包装描述**全部是本次原创合成内容**，不是任何真实语料转写
文本的同义替换。6 个文件保留的只是源语料的**叙事结构**（媒介结构判定用的时间线信号形状、
品类大类），且每个文件的 `source_material_note` 字段如实标注"文字降级路径 + 脱敏依据
真实语料叙事结构"。已对 6 个文件与对应语料行做过 `grep` 逐词核对，确认真实语料里的具体
账号名、产品名、逐字宣称语句均未出现在本 skill 任何文件里。

## TODO（人工复核）

- [ ] TODO：后续如有更细的机位/灯光判据或好/坏案例，
  本 skill 的 `workflow.md` 2E 节可能需要二次补充。
- [ ] TODO：`taxonomies/category_generic` 尚未在本仓落地（只有目录没有文件），
  `metadata.json` 的 `requires_data` 先按占位声明，实体文件由后续集成阶段补。
- [ ] TODO：6 条真实语料全部来自保健品大类（两份语料表本身就是该品类语料为主），跨品类
  （3C/家居/美妆/清洁）没有真实语料可跑，`功效堆叠与多帧结构.md` 提到的祛痘膏/除锈喷雾/
  牙贴案例本次未用真实语料验证，只能靠该文档自带案例做结构性理解，语义质量未经真实语料
  检验。
