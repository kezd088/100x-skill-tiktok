---
name: 100x-prompt-compose
description: Fill a UGC ad-generation template with product/persona/scene variables
  and package the result for a target image or video model (Veo / Seedance / 即创).
  Use when the user asks to "帮我组装提示词", "填个模板出提示词", "这条视频用什么模型",
  "生成视频提示词", "选个模板配变量", "compose a video prompt", "fill in this template",
  "which model should I use for this", "generate an AI video prompt", or gives a
  product/persona/scene description and wants a ready-to-use image/video generation
  prompt.
metadata:
  author: 100x
  version: "1.2.0"
---

# 100x-prompt-compose

## 一句话定位
输入一个提示词模板 id（或需求描述）+ 变量，输出逐字渲染、按目标模型（Veo/Seedance/
即创）包装好的最终生成提示词。属于 100x 体系"提示词+模型"这一步，衔接上游人物/场景/
搜索关键词类 skill 与下游 AI 生成模型。

## 何时触发
用户说：
- "帮我组装提示词" / "填个模板出提示词" / "这条视频用什么模型" / "生成视频提示词" /
  "选个模板配变量"
- "compose a video prompt" / "fill in this template" / "which model should I use
  for this" / "generate an AI video prompt"
- 或直接给一段产品/人设/场景描述，要求出一条能直接喂给图片/视频生成模型的提示词

## 输入
最小输入（类别 A，硬性必填）：`template_id`（14 个模板之一，见 `templates.json`）
**或**一段足以唯一匹配到某个模板的需求描述（品类+`use_when`场景，见 `workflow.md`
Phase 1 步骤 1）；该模板 `variables[]` 里 `label` 不含"(可选)"的变量必须全部给出
（不代猜、不编造具体外观/台词内容）。

软性补充（类别 B，缺失走降级，见 `workflow.md` Phase 1 步骤 2/4）：`label` 含
"(可选)"的变量；视频模板的 `model` 选择（缺失时问一次，仍未答复则默认
`model_hint[0]`）。

上游可选产出（类别 C，缺失静默跳过，不阻塞，也绝不要求用户先跑别的 skill）：
`existing_refs_input`（此前调用已建立的产品/人物锁编号，见公理 2）。

## 输出
结构见 `schema.json`：`ComposedPromptBundle` = `template_id`/`category` +
`variables_used` + `rendered_body`（逐字插值后的中文正文，已含 `realism_suffix`）+
`reference_locks`（产品/人物锁的建立或引用记录）+（视频模板）`model` + `video_unit`
（按模型包装后的最终提示词 + 时长）+ `meta`。可选再渲染一段人类可读摘要（模板名/
变量表/最终提示词）。

## 核心约束（4 条公理，详见 `axioms.md`）
1. 最终提示词须逐字替换模板正文，不得意译删减——`rendered_body` 必须是
   `templates.json` 对应模板 body 的逐字插值结果（含方括号占位展开），不是"意思对
   就行"的自由改写
2. 参考图编号引用须指向已声明的锁，不可虚指——产品/人物首次出现锁外观，后续必须写
   "参考图N产品/人物"，N 必须真实存在于已建立的编号集合（**已知局限：这里能验证的
   只是"格式对不对"和"编号是否真实存在"，验证不了"首次锁定描述本身是否真的具体
   （产品外观要素齐全 / 人物年龄+种族+性别+穿着+外貌五要素齐全）"——`persona:
   "a person"`、`product_lock: "a thing"` 这类空洞占位文字目前能通过校验，因为
   `schema.json`/`scripts/validate.js` 都只查字符串非空+格式+编号存在性，不做语义
   内容判断；评估过用最短长度等启发式去堵，但会同时误杀模板自身的合法短示例，故未
   实现，如实记录在 `axioms.md` 公理 2"已知边界"段，仍完全依赖调用者按 `workflow.md`
   Phase 1 步骤 2"缺失时追问、不脑补"的纪律执行）**
3. 场景变量禁止写光线词，光线由后缀统一控制——`scene`/`scenes`/`place`/`rooms`
   类变量命中闭集光线词表即拒绝，天气词允许
4. 视频按所选模型执行时长上限与禁词表，零容忍——veo 8.0s/seedance 10.0s + 各自
   禁词表 + 结尾固定句；**即创无专用来源材料，只校验叙事镜头分类，不做时长/禁词硬校验
   （已知局限：当前暂未包含即创模型的专用公理材料，详见
   `sources.md`）**；**已知局限（真实语料实测确认，非纸面假设）：veo/seedance
   禁词表是纯词法的词边界匹配，分不清"作为 AI 套路形容词使用的
   professional"（禁词表本意拦的对象，如"professional lighting"）和"作为说话人
   真实职业身份如实描述的 professional"（比如把说话人真实职业如实翻译成英文后
   含这个词）——如实描述真实身份也会被判 FAIL，只能换一个不撞词的同义词改写，
   详见 `axioms.md` 公理 4"已知边界"段**

## 三阶段流程
详见 `workflow.md`：Phase 1 接收+校验（选模板 → 变量到位 → 场景无光线词 →
[视频]选模型 → 引用编号上下文） → Phase 2（逐字渲染 → 方括号展开 → 引用锁记账 →
[视频]模型包装 → 逐项自检） → Phase 3 用户触发的返工（L1 单变量 / L2 换模型 / L3
整体；**没有"非英文台词"分支**——模板库硬规要求台词面向美区 TikTok 用美式英文，无
例外，见 `workflow.md` Phase 3 表格最后一行）。

## 独立调用保证
类别 A 缺失（模板选不出 + 硬性变量缺失）→ 固定拒绝话术追问，不代猜、不编造具体
外观/台词内容。类别 B 缺失走降级（可选变量按模板自身语义处理；`model` 缺失问一次
后默认）。类别 C（`existing_refs_input`）缺失静默跳过——本 skill 不要求用户"先跑一次
IMG-01 建产品锁"才能开始，首次出现直接允许用文字描述代替参考图。

## 禁用词
让我 / 希望 / 或许 / 大概 / 可能 / 也许 / 让我们；AI 客服味（as an AI / I'd be happy
to / feel free to）；不编造脚本/文案里没有的功效认证/用户见证；不编造用户没给过的
产品外观/人物细节去凑变量；veo/seedance 视频包装禁用词见 `profiles/veo.md`/
`profiles/seedance.md`（AI 套路词 cinematic/stunning/flawless 等 + 双引号 + markdown
围栏，具体清单见对应文件，不在此重复列出以免和脚本常量表脱节）。

## 路由（推荐，非强依赖）
- 还没有产品/人设/场景素材，只有一份文案 → 人物/场景类 skill（若已建）
- 想先找视觉参考图再决定怎么填模板 → 搜索关键词类 skill（若已建）
- 提示词已经出好，想批量做多个变体 → 提示词裂变类 skill（若已建）
- 想回入口重新分诊 → 100x 体系总入口（若已建）

以上均为"产出后按需推荐"，不是前置依赖；对应 skill 尚未建好时不影响本 skill 独立
工作。

## 出厂自检
运行 `node scripts/validate.js --selftest` 验证。公理 1（模板重建）、公理 2（引用锁
完整性）、公理 4（模型专属时长/禁词/结尾句）是跨文件/跨条目/大词表判据，
`schema.json`（vanilla JSON Schema）表达不出来，真正执行判定的是
`scripts/validate.js`：
```
npm install                                                    # 首次使用先装 ajv
node scripts/validate.js <bundle.json> [bundle2.json ...]    # 校验产出
node scripts/validate.js --selftest                           # 跑内置回归用例
```

## 来源
本 skill 结合提示词模板库与各主流模型（Veo / Seedance）的适配规则构建：
`templates.json` 提供 14 组标准化提示词模板；`profiles/veo.md` 与 `profiles/seedance.md`
提供目标模型的包装规范。判据体系包含引用完整性、闭集词表检测与模型时长及禁词校验。
详细设计决策与来源说明见 `sources.md`。
