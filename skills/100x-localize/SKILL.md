---
name: 100x-localize
description: Localize an ad script/copy into a Mexican-Spanish-default target
  market version, forcing compression so it doesn't run long the way a literal
  translation would, and defaulting to the real corpus's actual register
  intensity rather than an unvalidated conservative style guide. Use when the
  user asks to "投放语本地化", "本地化成西语", "翻译成西语文案", "改写成墨西哥西语",
  "这条文案怎么本地化", "localize this ad copy", "translate this script into Spanish",
  "adapt this for the Spanish market", "Mexican Spanish localization", or gives an
  ad script/copy and wants a Spanish-market localized version.
metadata:
  author: 100x
  version: "1.3.0"
---

# 100x-localize

## 一句话定位
输入一段源文案（任意源语言），输出墨西哥西语默认本地化版本——不是逐字翻译，而是主动
压缩长度、贴合真实语料的实际强度分布。属于 100x 体系 L2 创意生成层，对应"2c 投放语
本地化"这一步。

## 何时触发
用户说：
- "投放语本地化" / "本地化成西语" / "翻译成西语文案" / "改写成墨西哥西语" /
  "这条文案怎么本地化"
- "localize this ad copy" / "translate this script into Spanish" / "adapt this
  for the Spanish market" / "Mexican Spanish localization"
- 或直接给一段源文案（源语言任意，通常是英语或中文文案），要求出西语本地化版本

## 输入
最小输入（类别 A，硬性必填）：`source_script`——完整源文案纯文本（源语言任意）。
本 skill **不接视频/音频文件**，只吃文本。

软性补充（类别 B，均有明确默认值，见 `workflow.md` Phase 1）：`target_region`
（默认 `"mx"`，仅接受 `mx`/`generic-latam`，其余值降级为 `generic-latam` 并在
`meta.warnings` 记录）、`register_profile`（默认 `"default"`，贴合真实语料强度，
不是保守档，见"核心约束"公理 2）。

上游可选产出（类别 C，缺失静默跳过，不阻塞，也绝不要求用户先跑别的 skill）：
`100x-persona` 的人物/场景卡片、`100x-search-query` 的搜索词结果。

## 输出
结构见 `schema.json`：`source_script`（原文回显）+ `target_region` + `register_
profile` + `localized_script`（西语本地化产出）+ `meta`（必填：`generated_by`、
`warnings`；可选信息字段：`compression_ratio`）。

## 核心约束（4 条公理，详见 `axioms.md`）
1. **压缩公理**：西语产出字符数不得超过源文案字符数的 1.10 倍（也不得低于 0.5
   倍）——基于参考语料的转写长度分布校准，西语表达同等信息量天然较长，逐字直译会系统性超出口播时长
   预算，必须主动压缩改写，不是逐字翻译（1.10/0.5 这两个具体数字是工程判断，
   详见 `axioms.md` 公理 1）
2. **语域强度默认公理**：默认贴合真实语料实际强度分布，07 号规范文件（`07_西语口播风格规范.md`）§5 的保守禁语清单降级为
   可选档 `profiles/compliance-conservative.md`，不是默认（该文件 §1 自己声明"不是
   从库内西语爆款样本归纳出的实战结论"，本 skill 因此不把它的保守建议当作默认必须
   遵守的验证结论）
3. **人称一致公理**：全篇统一 `tú` 称呼，不得混入 `usted`/`vosotros`（已知局限：
   当前只支持 `mx`/`generic-latam` 两个 `target_region`，不支持西班牙正式
   `usted`/`vosotros` register 或阿根廷 `vos` 变位——这是范围限制，请求这类地区会
   被降级到 `generic-latam` 并提示，不会假装支持。另外参考语料存在实际出现 `usted` 且与 `tú` 混用的情况——这条公理是本 skill 对
   自己产出设的质量线，不是对真实语料现状的描述，见 `axioms.md` 公理 3。当前机制已覆盖
   全大写/去重音/零宽不可见字符插入/组合重音符号插入这四类绕过手法（手写校验层
   对公理 2/3 做不可见字符 + 组合重音符号双重归一化，公理 4 的权威词族检测同样
   做不可见字符剥离），仍有的已知残留缺口：
   `schema.json` 层面的 ajv `pattern` 仍然没有预处理能力（JSON Schema 规范
   结构限制），且手写层的不可见字符码点列表（6 个）不是 Unicode 格式字符类别
   的穷举，见 `axioms.md` 公理 2/3/4 的 TODO）
4. **防臆造权威声称公理**：不得引入源文案没有的权威/认证类声称（闭集词族：FDA/
   Harvard/OMS/临床验证类表述）——已知局限：这只能拦住闭集词族内的关键词层面新增
   （已对去重音、大小写混合、逐字母加点缩写等书写变体做归一化，仍无法拦住
   编造一个不在闭集里的虚构机构名/人名），见 `axioms.md` 公理 4

## 三阶段流程
详见 `workflow.md`：Phase 1 接收+校验（类别 A/B/C，`target_region`/
`register_profile` 降级填充） → Phase 2（语域强度决策 → 语言自然化改写 → 长度压缩
→ 逐句自检 → 批量自检） → Phase 3 用户触发的返工（L1 单轮压缩 / L2 档位或地区切换 /
L3 全体重做；**人称语域没有对应返工路径**——v1 只支持 `tú`，见"核心约束"公理 3）。

## 独立调用保证
类别 A（`source_script`）缺失或用户发来视频/音频文件 → 固定拒绝话术追问，不代猜、
不代写脚本。类别 B（`target_region`/`register_profile`）缺失 → 直接用文档化的默认值
继续跑，不追问、不阻塞。类别 C（上游 `100x-persona`/`100x-search-query` 产出）缺失
→ 静默跳过，**绝不要求用户先跑其他 skill**。

## 禁用词
让我 / 希望 / 或许 / 大概 / 可能 / 也许 / 让我们；AI 客服味（as an AI / I'd be happy
to / feel free to）；`register_profile=="compliance-conservative"` 档下的具体
禁语清单见 `profiles/compliance-conservative.md`；不编造源文案没有的效果/认证/用户
见证（见公理 4，已知局限见上）；不写死任何客户品类词典；不假装支持 v1 未实现的地区/
人称 register（见公理 3 已知局限）。

## 路由（推荐，非强依赖）
- 已有人物/场景设定、想让本地化语气贴合特定人设 → 人物场景类 skill（若已建，
  产出可作为类别 C 参考）
- 还没定搜索关键词、想先找参考素材再本地化 → 搜索关键词类 skill（若已建）
- 本地化后想生成配音/字幕时间轴 → 配音/字幕类 skill（若已建）
- 想回入口重新分诊 → 100x 体系总入口（若已建）

以上均为"产出后按需推荐"，不是前置依赖；对应 skill 尚未建好时不影响本 skill 独立
工作。

## 出厂自检
运行 `node scripts/validate.js --selftest` 验证。`schema.json` 声明的结构层约束
（`required`/`additionalProperties`/`enum`/`pattern`，含 axiom 2/3 两条可条件化的
`if/then`+`pattern` 检查）由 `scripts/validate.js` 内的 **ajv**（真实 JSON Schema
draft-07 验证器，`package.json` 声明的 devDependency，先 `npm install` 再跑）实际
执行。公理 1（压缩比）和公理 4（防臆造权威）是两类跨字段比较规则，vanilla JSON
Schema 结构上表达不出来（无法比较两个字符串字段的长度或内容），由
`scripts/validate.js` 里的手写代码补上：
```
npm install                                                   # 首次使用先装 ajv
node scripts/validate.js <bundle.json> [bundle2.json ...]   # 校验产出
node scripts/validate.js --selftest                          # 跑内置回归用例
```

## 来源
本 skill 是基于以下原料构建：`07_西语口播风格规范.md`（语域/自然化规则的直接来源，其"不是实证结论"的
自我声明被原样保留）+ 参考语料（提供压缩公理和语域默认公理的数据支撑）
+ T7 模块库 CSV（提供模块骨架的结构性参考）。逐文件改写点与判据说明，见
`sources.md`。
