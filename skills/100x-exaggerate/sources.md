# 100x-exaggerate · 来源追溯

本 skill 建立了夸张轴与反差轴的枚举闭集。
本次是**从零构建**，下面逐份记录每份素材"参考了什么、用了什么、没用什么、为什么"，
以及哪些设计判断是本 skill 的原创设计（不是照搬现成规则）。

---

## 一、必读素材逐份记录

| # | 文件 | 读了什么 | 用了什么 | 没用什么 / 为什么 |
|---|---|---|---|---|
| 1 | 《创意画面桥段词典》（v3.3，1158 行） | 全文：Part 0 定位说明、Part 1 十五个 L1 创意桥段大类（含每个大类的定义/L2 示例/视觉特征/适用品类）、Part 2 十一个画面类型（A-K，含强度总览表）、Part 3 画面选择参考（含"帽度倾向"一节）、Part 4 桥段↔画面类型对照表、Part 5 Agent 调用规则、Part 6 防滥用规则 | **是本 skill 最重的素材**：`axioms.md` 公理 1 的 5 个夸张技法（`numeric_hyperbole`/`analogy_scale_hyperbole`/`emotion_reaction_hyperbole`/`authority_absolutism_hyperbole` 三个直接来自 L1 桥段，`time_compression_hyperbole` 部分佐证于此）+ 4 个反差类型（`state_before_after`/`value_price`/`warning_vs_promotion` 三个直接来自 L1 桥段）均逐条标注对应的 L1 大类名称与行号（见 `axioms.md` 公理 1 两张表）；公理 3 的市场帽度天花板直接来自本文件第 216 行（美区市场夸张强度需要收敛的定性提醒，具体措辞不逐字引用）+ 第 726 行（H2 子类给出的同一层意思——情绪类内容要保持真实感、不宜过度渲染）+ 第 903-915 行"帽度倾向"三档定性描述（黑帽/灰帽/白帽三档强度倾向，具体措辞不逐字引用）；公理 4 直接来自第 582 行 Type D 对"两端要有可感知落差"这一核心要求（具体措辞不逐字引用） | Part 2 画面类型的具体光线/构图规范（本 skill 不涉及镜头/画面层，那是服务下游生产侧/审核侧的部分，本 skill 只做"夸张/反差"这一个创意设计层，不涉及镜头语言）；Part 4 桥段↔画面类型对照表（本 skill 的技法/反差类型枚举和词典-06 的 L1/画面类型不是同一套分类体系，是本次基于 L1 桥段重新归纳出的、专门服务"夸张/反差"这一个维度的更细分类，见下方"二、为什么不直接沿用词典-06 的 15 个 L1 作为技法枚举"） |
| 2 | 《脚本结构公式库·A-G七型与效果公式》（95 行） | 全文：7 套脚本结构公式（A-G）+ 5 套效果定量公式 | `contrast_type` 里 `tone_register` 的出处之一：B 型（双轨叙事结构，第 35 行定义 + 第 44 行骨架要点，人物口播与冲击性/悬疑画面交替剪辑，具体措辞不逐字引用）+ F 型（第 39 行定义 + 第 47 行骨架要点，悬疑式开场、后段揭示真实场景形成基调反转，具体措辞不逐字引用）——两者共同的机制是"叙事基调的骤然切换/反转"，本 skill 把这个机制抽象成不限定于"恐怖"这一种具体呈现的通用反差类型 `tone_register` | 5 套效果定量公式（像素橡皮擦/泡沫爆发等，第 50-70 行）——那是"功效分镜怎么写画面描述"的具体拍摄规范，属于生产侧的画面呈现层，不是本 skill"夸张技法怎么分类/怎么标注强度"的创意设计层，两者服务不同任务 |
| 3 | 《实战案例精解·四套标杆脚本》（99 行） | 全文：四套标杆脚本（抗皱精华/蟑螂药/去渍喷雾/美白狗牙）逐套拆解 + 叙事母题表 | 佐证 `tone_register` 反差类型：叙事母题对照表中一行与悬疑恐怖式基调反转相关的母题（第 33 行，具体措辞不逐字引用）+ 标杆二"蟑螂药"案例（第 51-57 行，A-roll 素人口播 vs B-roll 悬疑/冲击画面的具体案例描述，机位即情绪切换器）——用真实案例复核了脚本结构公式库 B/F 型的"双轨/反转"机制在实战中确实是"基调骤变制造反差"，不是纯理论 | 该文件里"帧结构公式"（首尾/首中尾/数日见效）+ 具体机位类型——那是画面呈现层和拍摄执行层，本 skill 不涉及；四套标杆的具体台词/口播范本原文（本文件"金句摘录"一节）未摘抄进本 skill 任何文件，只借鉴案例描述的**结构性判断**（"同一产品可由不同叙事母题各拍一套"这类工程结论），不复制具体台词 |
| 4 | 参考语料 | 统计了 `matched_scenes` 字段（信号类别）的分布频次，并挑选 6 条文案走一遍 `workflow.md` Phase 1→2 流程 | `matched_scenes` 频次统计直接支撑 `axioms.md` 公理 1 的技法/类型推导（"时间承诺"、"前后对比"、"权威背书"等独立信号类别）；`blackhat_intensity` 字段取值（`aggressive`/`moderate`/空白三档）直接被公理 3 的 `intensity` 三档枚举命名借用（`mild` 是为空白档补的命名）；6 条文案过流程记录见下方"四、参考语料验证记录" | 语料原始 `transcript` 全文**不进本仓任何文件**，只在临时环境构造验证用 JSON bundle，跑完 `scripts/validate.js` 后只记录样例编号+结果，原始文本不写回本仓 |

---

## 二、为什么不直接沿用词典-06 的 15 个 L1 大类作为技法/反差类型枚举（工程说明）

词典-06 的 15 个 L1 桥段（`before_after_comparison`/`authority_endorsement`/
`urgency_scarcity`/`analogy_metaphor`/`3d_anatomy_visualization`/
`extreme_emotion_reaction`/`money_value_seduction`/`social_proof_quantitative`/
`product_reveal`/`testimonial_user_demo`/`pain_point_visualization`/
`social_lifestyle_aspiration`/`instructional_warning`/`cta_conversion_push`/
`other_creative_beat`）覆盖的是**整条脚本"在玩什么营销创意"**这个更大的范畴，服务
拆解已有视频（词典-06 Part 0 场景 A）和生成新脚本时的**全量创意骨架**
（词典-06 Part 0 场景 B）。本 skill 的任务范围更窄——只负责"夸张"和"反差"这两个
特定维度的设计，不是给整条脚本的每个 shot 打完整的 L1 标签。

因此本 skill 没有原样照搬 15 个 L1，而是：
1. **筛选**出 15 个 L1 里明显和"夸张"或"反差"相关的子集（`before_after_comparison`
   / `authority_endorsement` / `analogy_metaphor` / `extreme_emotion_reaction` /
   `money_value_seduction` / `social_proof_quantitative` / `instructional_warning`
   共 7 个，其余 8 个如 `product_reveal`/`testimonial_user_demo`/
   `social_lifestyle_aspiration`/`cta_conversion_push`/`pain_point_visualization`/
   `3d_anatomy_visualization`/`urgency_scarcity`/`other_creative_beat` 与夸张/反差
   无直接对应关系，不纳入）
2. **合并**掉功能重叠的（`money_value_seduction` + `social_proof_quantitative` →
   合并进 `numeric_hyperbole`，因为两者共同的机制都是"用具体数字制造效果感知"，
   分开会造成技法枚举里出现两个几乎无法区分的近义类别）
3. **补充**词典-06本身没有独立成类、但真实语料标注体系里已经存在的一类（时间承诺
   →`time_compression_hyperbole`，见上表"没用什么"栏之外的推导来源）
4. **拆分**成"技法"（夸张轴，回答"怎么让这句话听起来更夸张"）和"类型"（反差轴，
   回答"两个东西怎么对照出落差"）两个独立维度，而不是词典-06 一个混合的 L1 桥段
   列表——因为一条脚本里的"夸张"和"反差"是可以独立出现、也可以同时出现的两件事
   （例如一句纯粹的数字夸张宣称可能完全不构成任何反差），强行塞进同一个枚举会丢失
   这个区分

这套筛选/合并/补充/拆分的具体判断是本次原创（如实披露，见下方"三、原创判断披露"），
不是词典-06 文档本身给出的现成分类。

---

## 三、原创判断披露（如实标注，不假装有出处）

以下设计判断是本 skill 的**原创设计**，逐条列出避免"声称有依据实际没有"：

1. **5 个夸张技法 + 4 个反差类型的枚举本身**（具体的筛选/合并/拆分决定，见上方"二"）
   ——每个技法/类型各自对应的词典-06 L1 桥段/画面类型/语料信号有明确出处（见
   `axioms.md` 公理 1 两张表），但"选哪几个、怎么合并、怎么拆成两个维度"这套归纳
   方法本身是本次原创判断，参考了 `100x-search-query`/`100x-persona` 处理"全新部分"
   时"先看真实语料/素材反例，再定判据"的方法论，但具体归纳结果是本 skill 独有的。
2. **公理 3 的三档天花板数值化**（`mild=1/moderate=2/aggressive=3` + hat_level 三档
   基线映射表）——词典-06 只按黑帽/灰帽/白帽三档给出定性的强度倾向描述（具体措辞不
   逐字引用，见 `axioms.md` 公理 3），没有给出任何数字化的强度上限表，本 skill 把
   定性描述转成机器可执行的查表函数是本次原创判断，已在 `axioms.md` 公理 3 如实标注。
3. **`emotion_reaction_hyperbole` 技法专属的美区市场特例**——词典-06 的校准注记
   （第 216/726 行）明确针对美区市场与情绪表达这两个维度（而非泛指所有夸张手法），本 skill 判断这条限制**只**
   对应 `emotion_reaction_hyperbole` 一个技法、不应扩大到其余 4 个技法，这个"不扩大
   适用范围"的判断是本次原创（词典-06 没有明说"其他技法不受此限"，是本 skill 选择
   不做无证据的扩大解释）。
4. **`meta.market` 缺失时按保守分支处理**（等同命中美区，收紧 `emotion_reaction_
   hyperbole` 天花板）——本次原创的风险不对称判断（"误伤"代价小于"误放"代价），
   在 `axioms.md` 公理 3 如实标注为原创判断，并类比了 `100x-search-query` 敏感品类
   检测"宁可多提示不可漏提示"的同类工程直觉（只借精神，不是同一条具体规则）。
5. **公理 4"两端非同一句"的归一化比较规则**（trim + 小写 + 空白归一化后比较相等）
   ——词典-06 只说"两端必须有明显视觉落差"（定性），没有给出任何字符串层面的判据，
   本次把它降低成一个最低限度、完全机器可判的门槛（能拦"完全相同"，拦不住"语义
   重复但字面不同"），是本次原创判断，已在 `axioms.md` 公理 4 如实标注局限。
6. **`label_cn` 字段长度上限定为 10，比词典-06 给出的建议长度上限更宽松**——词典-06
   Part 1 对 L2 命名给出的长度建议是 2-6 个字为佳（第 86 行，具体措辞不逐字引用），但本 skill 把它当作 schema
   里的软性上限（`maxLength:10`，留出余量避免过严拒绝合法但稍长的标签），不是把
   "2-6 字"直接编码成硬性正则约束，是本次为避免"过度机械套用建议数字"做的工程折中，
   如实披露不是逐字照搬词典-06 的数字。

---

## 四、参考语料验证记录（人工过流程用，不摘录原文）

按规范"每个 skill 至少跑 6 条真实文案（英西各 3）"执行。人工挑选 6 条参考样本，
走一遍 `workflow.md` Phase 1→2 流程手工标注 `exaggeration_beats`/`contrast_beats`，
并在临时环境中用 `scripts/validate.js` 实际跑通校验（验证数据不写入本仓任何文件），
6/6 通过。验证记录如下，不摘录原文：

| # | 引用 | 品类（脱敏） | 帽度 | 本次标注的技法/反差类型 | 备注 |
|---|---|---|---|---|---|
| 1 | 英语参考样本 1 | 保健品(男性健康) | blackhat | `numeric_hyperbole` + `emotion_reaction_hyperbole`（market 未指定，按保守默认收紧到 moderate）+ `warning_vs_promotion` | 该样本原文是"表面警告实则促购"的典型范例，直接对应词典-06 `instructional_warning` 桥段"警告即反向证明"这一核心机制（具体措辞不逐字引用） |
| 2 | 英语参考样本 2 | 保健品(塑形/臀部) | blackhat | `analogy_scale_hyperbole`（篮球类比）+ `numeric_hyperbole`（$10,000 赔付）+ `authority_absolutism_hyperbole` + `state_before_after` | market 明确标为"美区"测试；本条未使用 emotion_reaction_hyperbole 技法，故美区特例未被实际触发，仅验证其余技法在美区市场下天花板不受影响 |
| 3 | 英语参考样本 3 | 保健品(细胞健康) | grayhat | `numeric_hyperbole` + `value_price` | 验证 grayhat 基线天花板（moderate）+ 价格前后反差的真实范例 |
| 4 | 西语参考样本 1 | 保健品(塑形/臀部) | blackhat | `analogy_scale_hyperbole`（篮球类比，与英语样本 2 同一类比手法跨语言复现）+ `numeric_hyperbole` + `authority_absolutism_hyperbole` + `state_before_after` | market 标为"西语区"，验证美区特例不适用于非美区市场时天花板恢复到 blackhat 基线 aggressive |
| 5 | 西语参考样本 2 | 保健品(肠道/排毒) | blackhat | `numeric_hyperbole`（十万次购买）+ `warning_vs_promotion` | 该样本原文先提及排毒副作用需要注意，紧接着转向销量数字促购，是警示转促购反差的西语实例 |
| 6 | 西语参考样本 3 | 美妆个护(胶原蛋白) | whitehat | `numeric_hyperbole`（mild）+ `value_price` | 唯一的 whitehat 样本，验证白帽基线天花板（mild）在真实语料上的实际表现 |

**6/6 真实通过（`node scripts/validate.js` 对 6 个 bundle 全部输出 PASS）。** 覆盖了 5 个技法中的 4 个（`time_compression_hyperbole`
未在这 6 条里被选为主标注技法，但 6 条里多条原文本身含有"当天/几天见效"表述，理论上
可标，因挑选样本时优先覆盖不同技法/类型的多样性而未重复标注，`evals/` 的 3 个
合成样例里已补全 `time_compression_hyperbole` 的实际标注示例，见下方"五、evals/ 与
真实材料的关系"）+ 4 个反差类型全部覆盖 + 3 个 hat_level 档位全部覆盖（blackhat 4 条 /
grayhat 1 条 / whitehat 1 条）+ 美区市场特例的"触发"（第 1 条 market 未指定按保守
默认）和"不触发"（第 2 条明确市场但未用该技法、第 4 条明确西语区）两种路径都有
实测。

---

## 五、`evals/` 与真实材料的关系（重要披露）

`evals/` 三个文件的 `source_script` 全部是**本次原创合成文案**（美容精华 / 关节保健品
/ 助眠软糖），**不是**上表 6 条真实文案的改写版，也不是任何语料库的逐句复述。
三个合成样例分别覆盖：
- `example-01-glow-serum-blackhat-us.json`：blackhat + 美区市场，四条 `exaggeration_
  beats`（`time_compression_hyperbole`/`authority_absolutism_hyperbole`/
  `numeric_hyperbole`/`emotion_reaction_hyperbole`）+ 两条 `contrast_beats`
  （`state_before_after`/`warning_vs_promotion`）。核心演示：`emotion_reaction_
  hyperbole` 因美区市场特例被收紧到 `moderate`（即使 blackhat 基线允许 `aggressive`，
  其余三个技法不受此限）——这是公理 3 最核心的机制，6 条真实语料里没有一条直接命中
  这个具体分支（第 2 条虽标了美区但未用该技法），故补这条合成样例专门演示这条路径
- `example-02-joint-formula-grayhat-generic.json`：grayhat + market 未提供，两条
  `exaggeration_beats`（`time_compression_hyperbole`/`authority_absolutism_
  hyperbole`）+ 两条 `contrast_beats`（`tone_register`/`value_price`）。演示
  `tone_register` 反差类型（真实语料 6 条里未覆盖到，因为怀疑转笃定这类基调反差在
  保健品口播语料里不如"警告转促购"/"前后对比"常见，本样例补齐这条覆盖）
- `example-03-sleep-gummies-whitehat.json`：whitehat，市场"通用"，三条
  `exaggeration_beats`（`time_compression_hyperbole`/`analogy_scale_hyperbole`/
  `authority_absolutism_hyperbole`）+ 两条 `contrast_beats`
  （`state_before_after`/`value_price`）。演示 whitehat 基线天花板（`mild`）在三个
  技法上的实际表现，含 `analogy_scale_hyperbole` 的克制版本（开关灯类比，非"秒睡"
  式极端类比）

三个样例合计覆盖了全部 5 个夸张技法 + 全部 4 个反差类型（`numeric_hyperbole`/`analogy_scale_hyperbole`
最初的草稿版本遗漏在 evals/ 里，复核时发现后补回，不是一次就凑齐的）。三个样例的 `meta.warnings` 均标注"synthetic example, not a real product
(evals/ only)"，人物/产品设定均为虚构，未使用任何真实机构、认证名称或客户品类词典。

## TODO（人工复核）

- [ ] TODO：后续如有更细的夸张/反差判据，可以在后续版本补充对照。
- [ ] TODO：`tone_register` 反差类型目前只有脚本结构公式库 B/F 型的描述性佐证 + 1 条
  合成样例演示，未在 6 条参考样本里找到直接实例（保健品类目口播语料天然更偏"前后对比"
  "警示转促购"，缺少悬疑恐怖式基调反转这类桥段——那类桥段更常见于虫害/清洁类目，
  样本全部来自保健品/美妆个护，未覆盖到），需要跨品类真实语料验证。
- [ ] TODO：`requires_data` 声明的 `taxonomy.creative_beat_dictionary_v3_3` /
  `taxonomy.script_structure_formula_library` 尚未在本仓 `taxonomies/` 落地（只是
  声明引用），实体文件由后续集成阶段补。

