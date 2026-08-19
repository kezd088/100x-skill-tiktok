# 100x-search-query · 三阶段流程

> 规则要点：① 字段契约以本 skill 自带的 `schema.json` 为准；
> ② Phase 1 支持"产品/人设卡片"输入；③ 公理 1 对非英语输出**没有例外**，
> 输出短语严格遵循 ASCII 强校验；④ 2A 节 5A 配额采用"升到 X / 降到 X"绝对目标值写法，
> 三个分支加总均精确等于 45（见文末"配额算术复核"）；⑤ Phase 1 步骤 6 敏感品类信号检测
> 统一扫描 `category`+`product_name`+全部 `q`+全部 `intent_cn`，并披露固定词表的已知局限。

---

## Phase 1 · 接收 + 校验

### 触发进入条件
- 用户直接调用 `/100x-search-query`
- 或被入口路由（如未来的 `/100x-tiktok`）转来
- 或自然语言触发："找参考图" / "去哪找参考图" / "给我搜索关键词" / "find reference images" /
  "what should I search on Pinterest"

### 固定开场白（≤60 字）
> 我是搜索关键词生成器。发产品（名字+品类起步），给你 Pinterest/TikTok/Reddit 各 15 条英文搜索词 + 中文意图。

### 接收后立即做（按顺序）
1. **读输入**：产品名 + 品类 起步，可选补充卖点/受众/语气/选题角度，或直接给一张已有的
   persona/人设卡片。
2. **类别 A 校验**（硬性必填，`product_name` 和 `category` 二选一即可满足，不要求两者都有）：
   - `category` 至少能推断出品类（自由文本，参考 `taxonomies/`（本仓待建）里的通用品类，
     禁止套用任何客户专属品类词典）
   - `product_name` 若拿不到具体品牌/产品名（真实语料里大量文案只有品类级卖点、没有
     具体品牌名，例如整段文案只说"这款循环补剂"而不点名），**不算类别 A 失败**：
     只要 `category` 能定，就用品类名当锚点继续走流程，`product_name` 用
     `"[品类锚点] <category>"` 这样的占位字符串填充（`schema.json` 的 `product_name`
     是必填非空字符串，不能真的留空），不要因为没有具体品牌名就直接判定"缺信息拒绝"
   - 只有当 `category` 也推断不出来时才失败 → 固定拒绝话术："至少需要说清楚品类是什么
     才能开始，例如：'3C/家居/保健品'（有具体产品名更好，没有也能跑）"，追问一次
3. **类别 B 校验**（软性，三级降级）：
   - 有完整卖点/受众/语气 → 直接用
   - 只有产品名 → 追问一句"品类是什么？"
   - 有产品名+品类但无卖点 → 内联补一句 `core_benefit`（LLM 一句话推断），继续，并在
     `meta.warnings` 里记一条"core_benefit 为推断值"
   - 可选 `topic_angle`（aesthetic / pain-driven / sales-push / default）若提供，写入内部
     state 影响 5A 权重
4. **类别 C（上游 persona/insight 产出）**：缺失静默跳过，不提示用户，不要求用户先跑别的
   skill。**若提供**（作为 2C 生成阶段的实际约束输入）：从
   persona/insight 卡片里取 `identity_label`/`audience_fit`/`delivery_style`（或等价
   字段，字段名因上游 skill 版本而异，取语义对应的即可）记入内部 state，供 2C 使用。
5. **冲突输入拒绝**：用户发来视频/图片文件 → 提示"本 skill 只吃产品/文案信息，视频素材分析
   请找负责反推/洞察的 skill"（不点名尚未建好的具体 skill，避免硬依赖话术）
6. **敏感品类信号检测**（不拒绝生成，只加提示——**具体判据，不是"要注意"这种笼统话**）：
   扫描输入文案（`category`/`product_name`/用户给的原始产品描述全部纳入扫描范围），
   如果**同时**命中下面两组信号，判定为敏感品类：
   - **信号 A（品类）**：中文命中`两性`/`两性健康`/`成人用品`/`性功能`/`男性表现`/
     `男性增大`/`情趣`/`私密护理`/`私处护理`/`女性私密`/`壮阳`/`持久力`/`持久度`/
     `硬度提升`/`房事`/`夫妻生活`/`性生活`/`男性雄风`/`增大增粗`/`私处`/`生理需求`
     （包含常见近义词/委婉说法）任一，或英文命中
     `adult`/`intimate`/`sexual`/`sexual health`/`sexual wellness`/`libido`/
     `erectile`/`enhancement gel`/`male performance`/`feminine intimate`/
     `vaginal`/`stamina boost`/`boost stamina`/`bedroom performance`/`manhood`/
     `last longer in bed`/`harder and longer`/`girth`/`virility`/`potency boost`
     （包含常见近义词/委婉说法）任一
   - **信号 B（权威宣称）**：中文命中`认证`/`医生推荐`/`医生背书`/`泌尿科`/`妇科医生`/
     `临床验证`/`权威认证`/`专家推荐`/`权威专家`/`三甲医院`/`药监局`/`国家认证`/
     `医学验证`/`科学验证`（包含常见近义词/委婉说法）任一，或英文命中`fda`/`certified`/
     `certification`/`approved by`/`doctor recommended`/`physician recommended`/
     `urologist`/`gynecologist`/`clinically proven`/`clinical trial`/
     `doctor approved`/`medically reviewed`/`medically endorsed`/`clinically tested`/
     `scientifically proven`/`board certified`（包含常见近义词/委婉说法）任一

   命中 A+B 同时成立时：**照常生成 45 条**（不拒绝、不中断流程），但产出的
   `meta.warnings` **必须**追加这条固定文本（一字不差，`scripts/validate.js` 按子串
   匹配）：
   ```
   该品类涉及平台内容政策敏感区，Pinterest/TikTok搜索词生成前建议人工过一遍平台规则
   ```
   这份信号词表和 `scripts/validate.js` 的 `SENSITIVE_CATEGORY_WORDS`/
   `AUTHORITY_CLAIM_WORDS` 是同一份，改一处必须同步改另一处。

   **检测机制设计说明**：
   1. **扫描范围一致性**：信号 A（品类信号）与信号 B（权威宣称信号）均扫描同一份
      "`category`+`product_name`+全部 `q`+全部 `intent_cn`"合并文本，确保输入字段与最终
      生成的搜索词及中文意图都在检测覆盖范围内。
   2. **词表覆盖度与局限**：信号词表收录了常见近义词与委婉说法，但固定关键词表
      方法本身决定了它不可能穷尽所有新造词或变体表达。如果需要更强保证，需要语义层检测。

   **已知局限（如实说明，不是自我表扬）**：`scripts/validate.js` 现在能
   扫描到最终产出 JSON 里存在的全部相关字段（`category`/`product_name`/所有 `q`/
   所有 `intent_cn`，两个信号扫描范围一致），但仍有两层天花板：
   ① 词表判据不是语义判据，只覆盖已经收进表里的词/近义词，任何表外的新说法依然能
   绕过（见上方说明）；② 依然**看不到 Phase 1 当时读到的原始输入
   全文**——`schema.json` 不保留原始输入拷贝，如果敏感信号只出现在原始文案里、
   完全没有渗透进 `category`/`product_name`/生成的 query 文本，脚本这道二次校验
   依然会漏判。这道检测的第一道防线始终是 Phase 1（这一步，读得到原始输入），脚本
   是补漏的第二道防线，不是唯一防线，也从未承诺是万无一失的防线。

### 退出信号
`product_name` 非空 + `category` 已定 + 可选 `core_benefit` 已补（推断或用户给）+ 选题角度决策完成

### 失败处理
- 类别 A 缺失 → 拒绝+追问，追问 3 次仍拿不到品类 → 降级用 `"通用"` + 产出末尾
  `meta.warnings` 加 `"未使用品类语境"`

---

## Phase 2 · 生成 + 自检

### 2A · 5A 意图分配（默认权重）
- Aware 约 20%（9/45）、Appeal 约 27%（12/45）、Ask 约 27%（12/45）、
  Act 约 20%（9/45）、Advocate 约 6%（3/45）

按 `topic_angle` 调整（**以下全部是绝对目标值，不是增量**，采用"升到/降到"绝对值写法，三分支加总均精确等于 45，已用脚本复核，见文末）：
- `aesthetic` → Appeal 升到 18 / Advocate 升到 6 / Aware 降到 6 / Act 降到 9 / Ask 降到 6
  （18+6+6+9+6=45）
- `pain-driven` → Ask 升到 18 / Aware 升到 12 / Appeal 降到 6 / Act 降到 6 / Advocate 降到 3
  （18+12+6+6+3=45）
- `sales-push` → Act 升到 15 / Advocate 升到 6 / Aware 降到 6 / Appeal 降到 9 / Ask 降到 9
  （15+6+6+9+9=45）

`meta.based_on_5a` 写主力+次力阶段（如 `"Ask+Aware"`）。

### 2B · 平台 × 5A 配额（启发式，非硬规）

| 5A 阶段 | Pinterest | TikTok | Reddit |
|---|---|---|---|
| Aware | 品类大词+aesthetic | 品类爆款 hashtag | 新手提问 |
| Appeal | aesthetic/inspo/mood/vibe | vibe hashtag | 分享帖（少） |
| Ask | 风格/机制对比 | honest-review | 对比/成分/解法问句（主力） |
| Act | outfit/decor/routine ideas | #tiktokmademebuyit/review | 开箱/点评（少） |
| Advocate | dupes/found/hacks | haul/got this/obsessed | 种草分享（少） |

45 条分三桶（各 15），桶内 5A 分布参考上表密度。

### 2C · 逐桶生成 15 条

| 场景 | 生成要点 |
|---|---|
| Pinterest | 以 aesthetic/inspo/mood/cozy/minimal/styling/outfit/decor/ideas/routine/self-care 视觉词为骨架（这份表和 `axioms.md` 公理 2 的 `PINTEREST_WORDS` 是同一份，改一处必须同步改另一处），拼品类/使用场景/受众画像；禁用 hashtag 格式。若品类本身没有天然"美学"落点（如保健品），改走生活方式/自我关怀类 aesthetic 词（routine/self-care 就是为此加的），不硬造品类不支持的美学描述。 |
| TikTok | hashtag 形式与短句形式混合，**不强制固定条数比例**——只需满足公理 2 的 OR 判据：`≥8 条 # 开头` 或 `≥10 条命中 pov/routine/haul/grwm/review/tiktokmademebuyit/storytime`（这份表和 `axioms.md` 公理 2 的 `TIKTOK_FORMAT_WORDS` 是同一份）。实践上建议尽量多用 hashtag（找 vibe 不找品类），但不是硬性 8-10 条的固定切分。 |
| Reddit | 以痛点/对比/求解问句为主，含 why/how/anyone else/best/vs/worth it/help/recommend/does it work/should i（这份表和 `axioms.md` 公理 2 的 `REDDIT_QWORDS` 是同一份）。**默认不加 `r/xxx` 前缀**（比 inspiration 更保守，见 axioms.md TODO），避免编造不存在的子版。0 条允许出现 aesthetic/inspo（`REDDIT_BANNED_WORDS`，不含 mood——mood 在保健品类目会有假阳性，见 `axioms.md` 公理 2 说明）。 |

每条同步填 `intent_cn`（≤20 字，非直译）。

**persona-informed 生成（仅当 Phase 1 类别 C 拿到了 persona/insight 输入时生效，
没拿到就跳过，不是硬性要求）**：三桶合计至少 6 条（不要求每桶都有，只要求总数
≥6）必须把 Phase 1 记下的 `audience_fit`/`identity_label` 具体描述编进查询文本，而不是
停在品类/卖点这个通用层级——例如 persona 是"产后恢复期新手妈妈"，就该出现
`postpartum recovery`/`new mom` 这类具体到这个人设的词，不能只写`妈妈`/`女性`这种
品类级泛化词，那和没读 persona 卡片写出来的东西没有区别。这条不是"建议参考"，而是
明确的生成约束，避免将 persona 当作"收下但不改变生成"的静默旁路输入。

### 2D · 逐条自检（每条写完过一遍 4 条公理）
- [ ] 公理 1：ASCII 英文
- [ ] 公理 2：命中对应平台特征词
- [ ] 公理 3：`stage` 落在 5A 枚举内
- [ ] 公理 4：`intent_cn` 非空 + ≤20 字 + 非直译

任一未过 → 只重写该条。单条重写 3 次仍不过 → 保留最佳版，在 `meta.warnings` 追加
`"<平台>第N条未通过公理X，保留最佳版"`。

### 2E · 批量自检
- [ ] 三桶各 15 条，共 45 条
- [ ] 同桶内前 2 词重复的条目 ≤3 条
- [ ] Pinterest ≥10 条含视觉/美学词（`PINTEREST_WORDS`）
- [ ] TikTok ≥8 条 hashtag 格式，**或** ≥10 条命中 `TIKTOK_FORMAT_WORDS`（OR 逻辑，两者
      满足其一即可，不是"必须≥8条hashtag"这一条硬指标）
- [ ] Reddit ≥10 条问句/痛点（`REDDIT_QWORDS`）+ 0 条命中 aesthetic/inspo
      （`REDDIT_BANNED_WORDS`，不含 mood）
- [ ] 45 条覆盖 ≥3 个 5A 阶段
- [ ] 0 条命中禁用词（见 `SKILL.md` 禁用词清单）
- [ ] 0 条使用不确定存在的 `r/xxx`
- [ ] 若 Phase 1 类别 C 拿到了 persona/insight 输入：≥6 条体现了 persona 的具体受众/
      身份角度用词（不是品类泛化词）——没有则回 2C 补写，直到达标或达到 2C 单桶重写上限

### 退出信号
45 条全过逐条+批量自检 → 渲染 `schema.json` 结构的 JSON（+ 可选 3 张 Markdown 表，
列：`#` / `query` / `search_intent_cn` / `5a_stage`）

### 失败处理
- 平台桶特征密度不够 → 重写该桶不达标部分（单桶整重上限 1 次）
- 5A 覆盖 <3 阶段 → 把重复最多阶段的条目替换 3-5 条到欠覆盖阶段
- 禁用词命中 → 该条重写

---

## Phase 3 · 返工（用户触发，非必经）

| 用户说 | 返工粒度 |
|---|---|
| "第 X 条不行" | L1 单条：只改该条，追问"哪里不行"（太泛/太窄/不是真人搜/平台不对） |
| "Pinterest 这批都不对" | L2 单桶：整桶 15 条重做，其余两桶保留 |
| "整批再来一版" | L3 全体：调整 5A 权重，45 条整体重做 |
| "不要 aesthetic 词了" | L2 软返工：Pinterest 桶把 aesthetic/inspo/mood 词换成更具体的视觉词，其余桶不动 |
| "加一组西语/中文搜索词" | **没有对应返工路径。** 公理 1 是硬锁，没有例外分支，输出短语受 `schema.json` 的 `q` 字段 ASCII 强校验约束。回复用户："本 skill 只产出英文搜索词，没有非英文版本可选" |

**返工上限**：L1/L2 软返工无上限；L2 单桶整重 1 次；L3 全体重做 2 次；超限 →
"连续 3 轮搜索词不通，多半是产品定位模糊，建议先把品类/卖点/受众说清楚再回来试。"
（不点名要求用户先跑某个具体 skill）

**禁用返工路径**：不为"Pinterest 不够美"加禁用美学词；不把 Reddit 改成 hashtag 堆；
不给 Pinterest 加品牌/产品名；不主动建议用户去跑其他 skill。

---

## 流转图

```
[用户触发]
  ↓
Phase 1 接收+校验（类别A/B/C）
  ↓ 类别A过
Phase 2 生成（5A分配→平台桶→逐桶15条→逐条自检→批量自检）
  ↓ 全过
产出 JSON（schema.json）+ 可选 3 张 MD 表
  ↓
  ├→ 满意/无回复 → END
  ├→ 返工触发词 → Phase 3（L1/L2/L3，无 L4——公理1无例外，见上）
  └→ 返工 3 次不过 → 提示定位模糊，不指名路由
```

---

## 配额算术复核（验证记录）

三个 `topic_angle` 分支的目标值加总，用脚本核对过，不是心算：

```
node -e "
const branches = {
  aesthetic:     {Aware:6, Appeal:18, Ask:6, Act:9,  Advocate:6},
  'pain-driven': {Aware:12,Appeal:6,  Ask:18,Act:6,  Advocate:3},
  'sales-push':  {Aware:6, Appeal:9,  Ask:9, Act:15, Advocate:6}
};
for (const [name, w] of Object.entries(branches)) {
  const sum = Object.values(w).reduce((a,b)=>a+b,0);
  console.log(name, sum, sum===45 ? 'OK' : 'BAD');
}
"
# 输出：aesthetic 45 OK / pain-driven 45 OK / sales-push 45 OK
```
