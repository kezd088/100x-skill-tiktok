---
name: 100x-video-reverse
description: Reverse-engineer a source video (or its already-extracted frames) into
  two sections -- replication prompts on two orthogonal axes (shots[], the per-cut
  timeline axis, and visual_forms[], the per-visual-form axis linked back to shots[]
  via appears_in_shots) plus a variabilization layer (slot_template with {VAR}
  placeholders + candidates, and cross_shot_analysis of what stays invariant vs.
  what varies across cuts within one video). Every prompt ships bilingual --
  prompt_en for Veo/Seedance, prompt_zh for the ops team to read and edit. Use when
  the user asks to "反推这条视频", "这个视频怎么复刻", "把视频拆成提示词", "视频反推",
  "反推提示词", "这条视频的画面怎么做出来的", "帮我拆解这条爆款", "reverse this video",
  "video to prompt", "how was this video made", "extract prompts from this video",
  or gives a source video file (or its pre-extracted frames) and wants generation
  ready prompts that replicate it.
metadata:
  author: 100x
  version: "1.0.0"
---

# 100x-video-reverse

## 一句话定位
输入一条视频（或已抽好的帧图）→ 输出两段：复刻提示词（`shots[]` 时间轴 + `visual_forms[]`
形态轴双轴正交叠加）+ 变量化（`slot_template` 插槽模板 + `cross_shot_analysis` 同视频内
跨镜头对比），每条提示词都是 `prompt_en`（喂 Veo/Seedance）+ `prompt_zh`（给运营团队读改）
双语并列。属于 100x 体系 L1 源头反推层，对应"0 视频反推"这一步，是流水线里最靠前、专门
补"从已有爆款视频反推复刻提示词"这一环的入口。

## 何时触发
用户说：
- "反推这条视频" / "这个视频怎么复刻" / "把视频拆成提示词" / "视频反推" / "反推提示词" /
  "这条视频的画面怎么做出来的" / "帮我拆解这条爆款"
- "reverse this video" / "video to prompt" / "how was this video made" /
  "extract prompts from this video"
- 或直接给一条视频文件（或已经跑过 `scripts/extract-frames.mjs` 的帧图 + `meta.json`），
  要求拆出能直接复刻的生成提示词

## 输入
最小输入（类别 A，硬性必填）：一条视频文件路径，或已抽好的帧图 + `scripts/extract-frames.mjs`
产出的 `meta.json`。视频不存在、读不出时长、或时长 > 180 秒 → 固定拒绝，不降级、不截断硬跑
（公理 1）。

软性补充（类别 B，缺失走默认值）：`target_model`（目标生成模型 veo/seedance/即创/generic）。
**缺失时字段填 `generic`**，其单段时长上限按最严档 8.0 秒处理（公理 2）。注意不要误填成
`veo`——两者的时长上限数值相同，但语义不同：`generic` 表示"用户没指定引擎"，填 `veo`
会让产物声称自己是给 Veo 准备的，与用户实际输入不符。

上游可选产出（类别 C）：无。本 skill 是流水线里最靠前的反推环节，不消费本仓任何其他 skill
的产出作为输入，也不会因为用户没跑过别的 skill 而拒绝或降级。

## 输出
结构见 `schema.json`：`source`（时长/画幅/抽帧方法元信息，回指一次真实的 `extract-frames.mjs`
运行）+ `target_model` + `shots[]`（AXIS A，按分镜切的时间轴）+ `visual_forms[]`（AXIS B，
按画面形态归类、通过 `appears_in_shots` 挂回 `shots[]`）+ `slot_template`（`{VAR}` 插槽模板 +
候选值）+ `cross_shot_analysis`（`invariants`/`varying_axes`，同一条视频内跨镜头的不变量与
变化轴）+ `meta`。每条提示词均为 `prompt_en` + `prompt_zh` 双语并列。

## 核心约束（5 条公理，详见 `axioms.md`）
1. **没有视频不做反推，超 180 秒直接拒绝，不降级**——视频不存在/读不出时长/超 180 秒，
   `scripts/extract-frames.mjs` 按 exit code 在入口处拒绝，`schema.json` 的
   `source.duration_sec` 硬上限在后堵住手写伪造产物（已知局限：挡不住"路径是编的"这类
   字段自洽但事实造假，见 `axioms.md` 公理 1）
2. **每段不超模型上限，时间轴首尾相接不留缝**——C1-C5 连续性（首镜起点 0.0 / 末镜对齐
   总时长±0.2 / 相邻不留缝不重叠 / 禁零时长 / 编号连续）+ 按 `target_model` 校验单段
   时长上限（`veo` 8.0s / `seedance` 10.0s，`即创`/`generic` 落最严档 8.0s）——都要把
   字符串解析成数字再跨条目比较，`schema.json` 管不到，`scripts/validate.js` 实质执行
3. **英文提示词禁 21 个套路词，末尾必挂三否定后缀**——ASCII 锁定 + 后缀锚点由
   `schema.json` 的 pattern 管，21 词的大小写不敏感词边界扫描由 `scripts/validate.js`
   管，且必须先剥掉固定后缀再扫（否则任何合法提示词都会自己撞上后缀里的
   `text`/`subtitle`/`watermark`）（已知局限：ASCII 检查放行全 ASCII 西语，见文末
   "已知局限"第 2 条）
4. **每种画面形式引真镜头，每个镜头必被覆盖**——`visual_forms[].appears_in_shots` 与
   `shots[].shot_id` 双向引用完整性 + 零孤儿覆盖 + 同一形态在数组内不得重复，均为
   跨数组判据，`schema.json` 管不到，`scripts/validate.js` 执行
5. **模板槽位与变量表双向闭合，中英槽位一致**——ALL-CAPS 命名 + 模板至少一个槽位由
   `schema.json` 管，`{VAR}` 分词后的正向/反向闭合 + 中英模板槽位集合一致由
   `scripts/validate.js` 管（已知局限：只校验槽位集合对齐，不判断翻译忠实度，见文末
   "已知局限"第 5 条）

## 三阶段流程
详见 `workflow.md`：Phase 1 接收 + 抽帧（跑 `scripts/extract-frames.mjs`，产出帧图 +
`meta.json`；无视频/时长 > 180s 直接拒绝，见公理 1）→ Phase 2 反推生成（读帧 → 按分镜切
时间轴 `shots[]`，首尾相接不留缝、单段不超目标模型时长上限，见公理 2 → 按画面形态归类
`visual_forms[]`，双向挂回 `shots[]`，见公理 4 → 变量化：抽取 `slot_template` +
`cross_shot_analysis`，见公理 5 → 逐条自检禁词表 + 后缀锁，见公理 3）→ Phase 3 用户触发
的返工（单镜头 / 单形态 / 整段重新反推）。

## 独立调用保证
唯一硬性输入是视频本身（或已抽好的帧）——不要求用户先跑本仓任何其他 skill。反过来，
本仓下游 skill（`100x-visual-fission`/`100x-prompt-compose`）也不要求用户先跑本 skill：
本 skill 产出的 `prompt_en`/`slot_template` 可以作为它们的输入之一，但不是调用它们的
前提条件。

## 禁用词
让我 / 希望 / 或许 / 大概 / 可能 / 也许 / 让我们；AI 客服味（as an AI / I'd be happy to /
feel free to）；不编造帧图里没有出现过的画面细节去凑镜头描述或形态归类；不发明具体
品牌/客户名称；`prompt_en`/`template_en` 的 21 个禁词清单见 `axioms.md` 公理 3，不在此
重复列出以免和脚本词表脱节。

## 路由（推荐，非强依赖）
- 反推出的提示词想批量做多个人物/场景/机位变体 → `100x-visual-fission`（本 skill 反推出
  的同系列视频/帧可作为它的 `references[]` 输入之一，仍需凑够 ≥2 条）
- 反推出的 `slot_template` 想直接渲染成最终喂模型的提示词 → `100x-prompt-compose`
- 想回入口重新分诊 → 100x 体系总入口 `100x-tiktok`

以上均为"产出后按需推荐"，不是前置依赖；`100x-visual-fission`/`100x-prompt-compose` 都
不要求先跑本 skill 才能调用，本 skill 也不要求先跑它们。

## 出厂自检
运行 `node scripts/validate.js --selftest` 验证。公理 2（时间轴连续性 + 模型时长上限）、
公理 3（21 词禁词扫描）、公理 4（双轴引用完整性 + 零孤儿 + 形态唯一）、公理 5（槽位
双向闭合 + 中英一致）都是
跨条目/跨字段判据，`schema.json`（vanilla JSON Schema）表达不出来，真正执行判定的是
`scripts/validate.js`：
```
npm install                                                   # 首次使用先装 ajv
node scripts/extract-frames.mjs <video_path>                 # 先抽帧（依赖 ffmpeg），产出帧图 + meta.json
node scripts/validate.js <bundle.json> [bundle2.json ...]    # 校验产出
node scripts/validate.js --selftest                           # 跑内置回归用例
```

## 来源
本 skill 规范了视频反推的生成约束体系（180 秒阈值、模型分段上限、21 禁词 + 三否定后缀、分镜字段结构）。双轴结构（时间轴 + 形态轴正交叠加）、双语输出、变量化分析（`slot_template` + `cross_shot_analysis`）为核心架构。`shot_purpose` 七值枚举复用分段标准，模型分段时长上限复用 `MODEL_DURATION_CAP` 常量。详细设计决策记录见 `sources.md`。

## 已知局限
以下十点是本 skill 如实披露的已知局限与设计权衡——五条公理管的全是格式合规，
不代表反推准确。其中第 7-10 条属于明确的设计权衡边界，在此如实声明。

1. **agent 读不了视频文件本身**：必须先跑 `scripts/extract-frames.mjs`（依赖 ffmpeg）
   把视频抽成帧图，agent 实际看到的是抽出来的帧，不是原始 mp4。抽帧质量（关键帧选取
   是否覆盖了真正的转场/信息点）直接决定反推质量——抽漏的画面反推不出来。
2. **`prompt_en` 的"纯英文"校验实际是 ASCII 校验，会放行全 ASCII 的西语**：已实测确认
   `"Una mujer en la cocina sostiene una botella, no text, no subtitles, no
   watermarks"` 这类不带重音符的西语句子能通过 ajv 校验，只有带重音符（如 é/ñ）的才会
   被拒。"这段话是不是英语"本身无法用规则机器判定，这条只挡非 ASCII 字符。
3. **`form_type` 九个枚举值里 `text_card`（文字卡）和 `screen_recording`（录屏）为扩展枚举**：
   用于覆盖真实 TikTok UGC 常见画面形态（文字底板与录屏演示）。
4. **21 词禁词扫描用词边界匹配，会漏掉派生词**：`perfection`、`professionally` 这类
   由禁词派生但拼写更长的词，词边界匹配不到。21 词表本身来自保健品/家居类目的真实
   语料归纳，换到别的品类大概率需要扩表。
5. **中英对照只校验结构对齐，不判断翻译忠实度**：`scripts/validate.js` 检查的是
   `prompt_zh`/`prompt_en`（以及 `template_zh`/`template_en`）是否同时存在、`{VAR}`
   槽位集合是否一致，不检查中文是不是英文的忠实翻译——运营团队改中文时若改出语义
   偏差，机器发现不了。
6. **"复刻得像不像"完全无法机器验证**：五条公理管的全是格式合规。`node
   scripts/validate.js` 全绿只代表产物结构合法、没有明显自相矛盾，不代表反推准确、
   更不代表画面真的能复刻出来。唯一真正的验收方式是把 `prompt_en` 丢进 Veo/Seedance
   实际生成一次，人眼比对是否像原视频。
7. **`text_card` 形态与强制三否定后缀之间有语义张力，靠流程纪律而非机器约束**：
   每条 `prompt_en` 都以 `no text, no subtitles, no watermarks` 结尾，而 `text_card`
   恰恰是"画面主体就是文字"的形态。**文字层由后期叠加，不由生成模型渲染**（方法论立场：生成模型专注画面本身，文字层交由后期处理）。所以遇到字幕卡镜头时，`prompt_en` 只描述
   **底板视觉**（纯色背景／虚化背景／卡片质感），不写文字内容本身，具体写法见
   `workflow.md` 2D。**机器完全不管这条**：禁词表挡的是 `text`/`title`/`word` 这些
   名词，用 `phrase`/`lettering` 之类同义表达去描述文字内容照样通过校验。扩表治不了同义词无穷的问题，这条只能靠流程纪律。
8. **禁词扫描挡不住"完全没有分隔符"的融合词**：`homestudio` 把 `studio` 直接焊进一个
   更长的词，中间没有连字符也没有空格，词边界的前置条件不成立。要抓它必须
   放弃词边界改回子串匹配，那会引入 `secure`/`manicure` 误伤等假阳性，
   代价大于收益，因此当前设计维持词边界匹配。
   **带分隔符的那几类由双重归一化覆盖**：拆词（`beauti-ful`）、复合词夹带
   （`professional-grade`）、词组内多空格（`smooth  skin`）；`logo-free`/`watermark-free`
   这类正当表达由 `-free`/`-less` 豁免保护、不会被误伤。**`text-to-speech` 不在受保护
   之列，见下面第 10 条**——`-to-` 豁免分支已整体删除。
9. **中英模板槽位是集合比较，不比出现次数**：同一个 `{AGE}` 在中文侧写两次、英文侧
   写一次，仍判为一致。这是有意设计（中文表达重复引用同一变量是合理的，渲染时两处填
   同一个值），但运营复制粘贴误增一处也同样发现不了。
10. **`X-to-Y` 形式里含文字层禁词的技术术语会被拦截**：`text-to-speech`、
   `speech-to-text`、`voice-to-text` 这类写进 `prompt_en` 会判 FAIL。这是**已知设计权衡**：
   若对 `<文字层禁词>-to-<任意词>` 开放豁免，第二个词不受约束，可能导致禁词逃逸。
   因此本设计不对 `-to-` 形式开放豁免，保持防线完整。遇到时改写描述即可（例如 `an app screen showing
   spoken-word transcription`）；而且按公理 3 的立场，画面描述里本来就不该出现文字层
   术语。`--selftest` 用两条用例锁住这个行为。
