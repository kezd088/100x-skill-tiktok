# 100x-localize · 核心约束（公理）

> 以下 4 条公理里，公理 2/3 的西语语域规则改写自 `07_西语口播风格规范.md`（该文件 §1 自我声明"不是从
> 库内西语爆款样本归纳出的实战结论"，本文件逐处如实标注这一点，不把它包装成"经过验证
> 的结论"）；公理 1（压缩）是基于参考语料长度分布校准的**工程判断**；公理 4 延续
> "证据必须可回指、不许臆造"的精神，针对跨语言改写场景设计了代理判据，具体见该条"出处"段。逐条出处、判据说明见 `sources.md`。

---

## 公理 1：本地化产出必须压缩，不得直译膨胀

**一句话（27 字）**：西语产出字符数超源文1.10倍即判超时长,须压缩改写。

**可验证**：
- `ratio = charLen(localized_script) / charLen(source_script)`，必须 `<=1.10` 且
  `>=0.5` —— **这条 `schema.json`（乃至 ajv）表达不出来**：JSON Schema draft-07 没有
  "计算某个字符串字段的长度并与另一个字段的长度做算术比较"这种跨字段能力，`minLength`/
  `maxLength` 只能拿一个字段的长度去比一个写死的数字，不能比另一个字段。这条由
  `scripts/validate.js` 的 `compressionCheck` 函数实际执行。
- 上限 1.10、下限 0.5 都是**工程判断，经过参考语料校准**——见下方
  "出处"段说明。

**出处**：
对西语与英语参考语料的转写文本长度分布统计显示，西语表达同等信息量天然比英语更长（在参考语料中转写字符数平均差距约 19%）。

**说明**：参考语料是两个独立的转写集合（不同视频、不同创作者），并非一一对应的翻译对照文本。统计结果反映的是：西语表达同等信息量天然需要更多字符（这是通用的语言学现象），对固定时长的口播广告（30秒/60秒稿）而言，逐字直译会导致西语版本系统性超长，要么被迫加快语速，要么超出片长预算。**1.10 这个具体执行阈值是经过校准的工程选择**（留出低于自然膨胀率的压缩空间，促使本地化过程主动精简非核心信息句，而不是被动直译）。0.5 下限则是防止"为了通过上限判据把内容过度删减"的退化保护，同样是工程判断。

**反例（作废）**：
- `source_script` 500 字符，`localized_script` 675 字符（ratio=1.35）→ 超出 1.10 上限，
  判 FAIL，对应 `--selftest` 检查"ratio-over-ceiling"
- `source_script` 500 字符，`localized_script` 150 字符（ratio=0.30）→ 低于 0.5 下限，
  判 FAIL，对应 `--selftest` 检查"ratio-under-floor"

---

## 公理 2：默认贴合真实语料强度，保守禁语只是可选降级档

**一句话（22 字）**：默认贴合真实语料强度,保守禁语为可选降级档。

**可验证**：
- `register_profile` 枚举 `default`/`compliance-conservative`（`schema.json`
  `properties.register_profile.enum` 锁死）
- **仅当** `register_profile == "compliance-conservative"` 时，`localized_script`
  不得命中 `07_西语口播风格规范.md` §5 的禁语清单——`schema.json` 用 `allOf[0].if/then`
  （`if` 判 `register_profile` 的 `const`，`then` 追加一条 `localized_script.pattern`
  负向前瞻正则）锁死，**ajv 直接执行，不是手写**：这是单字段 + 单个同级字段条件判断，
  JSON Schema draft-07 的 `if/then` 关键字本来就是为这种场景设计的，交给 ajv 天经地义。
- `register_profile == "default"` 时，这条 `pattern` 约束不生效，这些短语不受限制。
- `then` 分支正则里"está"/"aprobación"/"según"这三处唯一带重音的
  字母，各自补上了不带重音的两态字符类（如 á → `[aAáÁ]`）——真实西语 TikTok
  字幕/文案常见省略书面重音（无重音键盘、输入习惯等），去掉重音符号的写法同样会被匹配，
  对应 `--selftest` 检查见下方"反例"段。**已知局限**：这仍是逐字符正则，只覆盖"带重音的单个预组合字符 vs 去掉重音的裸
  字母"这一种情况，不覆盖用独立组合重音符号分开输入的西语文本（同一个视觉上的
  `á`，Unicode 里也可能由字母 `a` + 单独的组合重音符号两个码点表示，这种输入
  这条 `schema.json` 正则捕捉不到，因为 JSON Schema 的 `pattern` 没有先归一化
  再匹配的能力）——手写校验层在二次校验中补充了归一化处理，见本文件 TODO。

**出处**：
- 这份保守档禁语清单的**问题类型**（哪几类"无证据宣称"需要拦）参考对齐
  `07_西语口播风格规范.md` §5
  讨论的范畴（永久改变人生类绝对宣称 / 极短时间内彻底根治类宣称 / 无依据的
  大众已使用类宣称 / 冒充监管机构批准类宣称 / 冒充学术机构研究类宣称，共 5 类）——
  清单里 5 条具体示例短语（`profiles/compliance-conservative.md`、
  `schema.json` `allOf[0].then` 的 pattern）为独立整理措辞（如"彻底根治类"示例
  采用"erradica/suprime/sana en un abrir y cerrar de ojos, para siempre"）。
- **"默认不受这些禁语约束"这条判断的出处**：参考语料中绝大多数样本采用激进宣称风格，
  而非风格规范建议的保守风格。`07_西语口播风格规范.md` §1 明确交代了该规范属于语言适配建议，并非基于爆款样本统计归纳的实战验证结论。本 skill 因此**不把该
  文件的 §5 禁语清单当作默认必须遵守的结论**，改为将其设为用户可主动
  选择的 `compliance-conservative` 可选档位，默认走贴合真实语料分布的强度。

**反例（作废）**：
- `register_profile=="compliance-conservative"`，`localized_script` 含
  "Todo el mundo ya lo está usando ahorita" → ajv 的 `then` 分支 `pattern` 判
  FAIL，对应 `--selftest` 检查"compliance-conservative + banned phrase
  correctly FAILS via ajv"
- 同样的短语，`register_profile=="default"` → 不受此项约束，判 PASS，对应
  `--selftest` 检查"same phrase under default profile correctly PASSES"（证明这
  条约束是条件性的，不是对该短语的全局封禁）
- `register_profile=="compliance-conservative"`，把宣称改写成"这个产品配方浓缩，
  帮助你保持专注"这类不含清单短语的表述 → 判 PASS，对应 `--selftest` 检查
  "compliance-conservative with paraphrased claim correctly PASSES"（证明降级档
  有合法产出路径，不是无法通过的死锁）
- 全大写变体 "TODO EL MUNDO YA LO ESTÁ USANDO AHORITA" → 同样判 FAIL，对应
  `--selftest` 检查"compliance-conservative + ALL-CAPS banned phrase correctly
  FAILS via ajv"；词间插入多余空格的纯空白变体 → 同样判 FAIL，对应 `--selftest`
  检查"compliance-conservative + doubled-whitespace banned phrase correctly
  FAILS via ajv"——这两条是把原来"只兼容首字母大小写、逐字面单空格匹配"的 pattern
  改成每个字母都是 `[Xx]` 两态字符类、字面空格换成 `\s+` 之后新增的回归检查
- 同样的短语，去掉唯一的书面重音"Todo el mundo ya lo esta
  usando ahorita"（"está"→"esta"，其余字符逐字相同）→ 仍判 FAIL，对应
  `--selftest` 检查"compliance-conservative + accent-stripped \"esta\" (no á)
  banned phrase correctly FAILS via ajv"
- 带有逗号的禁用短语"...en un abrir y cerrar de ojos, para siempre." → 正则使用 `[,\s]*\s+` 允许可选逗号，同样判 FAIL，对应 `--selftest` 检查"documented banned phrase WITH its comma (\"...de ojos, para siempre\") correctly FAILS via ajv (not just the no-comma variant)"

---

## 公理 3：全篇统一 tú 称呼，不得混入 usted/vosotros

**一句话（28 字）**：全篇统一tú称呼,不得混入usted或vosotros。

**可验证**：
- `localized_script` 全文不得出现 `usted`/`ustedes` 或 `vosotros`/`vosotras`，
  **不区分大小写**（全大写/全小写/任意大小写混合均命中，不是只兼容句首大写这一种
  写法——`schema.json` 的 pattern 把这两个词的每个字母都写成 `[Xx]` 这种两态字符类，
  例如 `[Uu][Ss][Tt][Ee][Dd]`，而不是只有首字母 `[Uu]` 可变、其余字母写死小写）——
  `schema.json` `properties.localized_script.pattern` 用负向前瞻正则锁死，ajv 直接
  执行。
  `scripts/validate.js` 额外做一次二次校验（`secondaryPatternCheck`），**这条二次
  校验直接从 `schema.json` 读回同一个 pattern 字符串再编译一次正则，不是重新手写
  一份**（见该函数注释）。
- **已知局限**：在禁用词内部插入不可见字符（如零宽字符 U+200B）可能打断原始正则匹配。`scripts/validate.js` 的 `secondaryPatternCheck` 在比对前通过 `stripInvisibleChars` 先剔除常见不可见字符（U+200B/U+200C/U+200D/U+FEFF/U+2060/U+00AD）与组合重音符号，以防此类绕过手法。当前覆盖已列举码点，详见本文件 TODO。
- **已知局限（范围限制）**：当前 `target_region` 枚举为 `mx`/`generic-latam`，本 skill 不支持西班牙正式 `usted`/`vosotros` 地区 register 或阿根廷 `vos` 变位——本公理对当前支持的 `target_region` 均生效。

**出处**：
- `07_西语口播风格规范.md` §2/§7 讨论的判断范畴：默认用第二人称单数称呼、动词随之变位、不要混入特定地区变体；同一篇文案人称前后一致，不中途切换为正式称呼。

**关于参考语料的人称分布说明**：在参考语料中，`vosotros` 确实未出现，但 `usted` 存在少量出现且常与 `tú` 混用。这表明风格规范"全篇统一不混用"的要求在部分实际投放文案中未被严格执行。**本条公理的定位**：这是本 skill 对**自身交付成品**设立的质量底线，确保生成文案语法规范统一，而非声称真实语料完全不存在混用。

**反例（作废）**：
- `localized_script` 含 "Usted puede sentir la diferencia desde el primer día" →
  命中 `usted`，ajv 判 FAIL，对应 `--selftest` 检查'"usted" in localized_script
  correctly FAILS via ajv'
- `localized_script` 含 "Vosotros lo vais a notar desde la primera semana" →
  命中 `vosotros`，ajv 判 FAIL，对应 `--selftest` 检查'"vosotros" in
  localized_script correctly FAILS via ajv'
- 全大写变体（不只是句首大写）"...USTED YA HIZO EL CAMBIO ESTE MES." → 同样命中，
  ajv 判 FAIL，对应 `--selftest` 检查'ALL-CAPS "USTED" correctly FAILS via ajv
  (not just leading-capital "Usted")'；"...VOSOTROS YA HICISTEIS EL CAMBIO ESTE
  MES." → 同样命中，对应 `--selftest` 检查'ALL-CAPS "VOSOTROS" correctly FAILS
  via ajv'——TikTok 广告文案/字幕大量使用全大写强调，这两条不是刁钻边角案例
- 在"Usted"内部插入 U+200B 零宽空格（"Us"+U+200B+"ted"，视觉和朗读效果不变）→ `secondaryPatternCheck` 剔除不可见字符后重新匹配同一条 pattern，判定整体 FAIL，对应 `--selftest` 检查"zero-width-space-obfuscated \"Us\u200Bted\" correctly FAILS via hand-written invisible-character normalization (ajv alone cannot strip it)"

---

## 公理 4：不得引入源文案没有的权威/认证声称

**一句话（17 字）**：不得引入源文案没有的权威认证声称。

**可验证**：
- 闭集权威词族（`FDA`/`Harvard`/`OMS`或`WHO`/"clínicamente probado"等临床验证类
  表述）任一在 `localized_script` 里出现，但**该词族的任一变体在 `source_script`
  里完全没出现** → 判定"本地化过程中新增了源文案没有的权威声称"。这是**跨字段内容
  比对**（判断字段 A 里出现的东西是否也出现在字段 B 里），**`schema.json` 表达不
  出来**：`pattern` 只能拿一个字段去匹配一个写死的正则，不能拿它去匹配"另一个字段
  当前的实际取值"。由 `scripts/validate.js` 的 `fabricatedAuthorityCheck` 函数
  实际执行——匹配前先经过同文件的 `collapseSpacedAcronyms` 把逐字母加点/加空格
  拼写的英文缩写折叠回连续字母再做子串匹配，否则这类常见缩写书写变体会绕过纯
  字符串 `includes` 判断。
- 匹配前还会经过同文件的 `stripDiacritics`（Unicode NFD 分解 + 剔除组合重音符号区段）先去掉两侧字段的书面重音，再转小写比对，确保带重音与去重音形式（如 "clínicamente probado" 与 "clinicamente probado"）均能被正确识别。
- `collapseSpacedAcronyms` 支持大写与小写的逐字母加点/加空格缩写折叠（如 "F.D.A."、"F D A"、"f.d.a." 均折叠为连续字母），再进行子串比对。

**出处**：
- 判据设计延续"证据必须可回指、不许臆造"的原则：在跨语言改写场景下，无法直接做同语言逐字子串比对，因而设计了"权威词族是否只出现在译文侧、源文完全没有"的跨字段代理判据。
- 闭集权威词族的选择（`FDA`/`Harvard`/`OMS`/临床验证表述）覆盖口播风格规范中提到的典型机构及相关相邻类别。

**已知局限（如实说明，不是自我表扬）**：这条只能拦住"关键词层面"的权威声称新增
（比如凭空写出"FDA"、"Harvard"这类具体机构名/关键词，含常见的加点/加空格缩写书写
变体，见上方"可验证"段的 `collapseSpacedAcronyms` 归一化）。如果本地化时编了一个
**不在这个闭集词族里**的虚构机构名或虚构医生姓名（比如"Instituto Nacional de
Bienestar lo certifica"），这条检测完全看不到，会漏判——这是关键词闭集的固有局限，
不是"能挡住所有编造权威"，见 TODO。

**反例（作废）**：
- `source_script` 只写"many customers love this"（不含任何权威词族），
  `localized_script` 却写了"Aprobado por la FDA" → 判 FAIL，对应 `--selftest`
  检查"fabricated FDA claim (absent from source) correctly FAILS axiom4"
- `source_script` 本身就含"FDA"这个词（客户原始文案自带这条宣称），
  `localized_script` 里出现同一个词 → 判 PASS，因为词族在源文里已经存在，不算
  "新增"，对应 `--selftest` 检查"FDA mention present in BOTH source and output
  correctly PASSES axiom4 (not a blanket ban)"——证明这条检测的是"新增"而不是
  "存在"
- `source_script` 不含任何权威词族，`localized_script` 把"FDA"拆成带点缩写
  "F.D.A." → `fabricatedAuthorityCheck` 内部的 `collapseSpacedAcronyms` 先把
  逐字母加点/加空格拼写的缩写折叠回连续字母（"F.D.A."/"F D A" → "FDA"）再做
  子串匹配，同样判 FAIL，对应 `--selftest` 检查'dotted-abbreviation "F.D.A."
  correctly FAILS axiom4 (not just bare "FDA")' 和 'letter-spaced "F D A" (no
  dots) correctly FAILS axiom4'——这两种是常见的英文缩写书写变体，不属于"闭集
  之外的虚构机构"，如果不做这层归一化会被完全漏判
- `source_script` 不含"clínicamente probado"这类表述，`localized_script` 却写了去掉重音的"esta clinicamente probado que funciona" → `stripDiacritics` 归一化后仍命中该词族，判 FAIL，对应 `--selftest` 检查"accent-stripped \"clinicamente probado\" (no í) correctly FAILS axiom4"
- `source_script` 不含任何权威词族，`localized_script` 把"FDA"拆成全小写的加点缩写"f.d.a." → `collapseSpacedAcronyms` 折叠后同样识别为权威词族，判 FAIL，对应 `--selftest` 检查"lowercase dot-glued \"f.d.a.\" correctly FAILS axiom4 (not just ALL-CAPS spaced/dotted forms)"

---

## 为什么是这 4 条，不多不少

- 公理 1（压缩）是本 skill **最独特的贡献**：没有它，"本地化"会退化成纯翻译，对固定
  时长的口播广告会系统性超时长——这是实测数据直接驱动出来的核心工程问题，也是
  本 skill 设计的核心目标之一。
- 公理 2（语域默认）决定了"真实"和"07 号规范建议的保守"之间怎么选边——不做这条决定，
  每次本地化都要用户重新纠结一遍要不要保守化，而且 07 号规范自己都没有拿真实语料
  验证过它的保守建议，不应该被默认当作已验证结论。
- 公理 3（人称一致）是西语最基础的自然度底线，且完全可以正则化，是"防止最明显语法
  错误"这条最低门槛。
- 公理 4（防臆造权威）延续本仓一以贯之的"不编造效果/认证/见证"底线（`100x-search-
  query`/`100x-persona` 均有同类公理或禁用词条款），翻译场景下需要专门设计跨语言
  代理判据，不能直接套用同语言引用型 skill 的判据，值得单独成一条。

不采用"地道程度/自然度评分"作为第 5 条公理，理由和 `100x-search-query` 公理 4、
`100x-persona` TODO 同款：目前找不到能写成正则/阈值的判据，会退化成"人工/LLM 判读，
读着别扭就算不地道"——这正是先例 skill 被打回的模式，本次刻意不重犯，留 TODO。

## TODO（需人工复核）

- [ ] TODO：v1 只支持 `mx`/`generic-latam` 两个 `target_region`，07 号规范提到的
  西班牙（`vosotros`/正式 `usted` register）和阿根廷（`vos` 变位）地区特定人称需求
  未实现——当前这类请求应该被诚实告知"本 skill v1 暂不支持"并降级到
  `generic-latam`，不能悄悄套用 `mx` 的规则假装支持了。
- [ ] TODO：公理 1 的 1.10 上限 / 0.5 下限是工程判断，基于独立语料集合统计校准（支撑"直译会系统性偏长"的方向性结论），后续若获得大规模精准配对的翻译前后对照数据可做进一步微调。
- [ ] TODO：公理 4 的权威词族闭集（`FDA`/`Harvard`/`OMS`/临床验证类表述）覆盖典型机构及相邻类别，无法拦截闭集之外的虚构机构名/虚构人名，后续可根据样本扩充词族表。
- [ ] TODO：关于人称语域，若下游反馈某些特定正式语境（如金融/法律类产品）确实需要 `usted` 全篇一致的正式档位，可考虑新增 `person_form` 字段支持正式档。
- [ ] TODO（已知防御边界说明）：
  - 公理 2/3 的 `secondaryPatternCheck` 在匹配前调用 `stripInvisibleChars` + `stripDiacritics`，已覆盖组合重音符号插入（如 U+0301）和软连字符 SOFT HYPHEN（U+00AD）；公理 4 的 `fabricatedAuthorityCheck` 同样先调用 `stripInvisibleChars` 再做缩写折叠与重音剥离。
  - `schema.json` 纯 JSON Schema 校验层的 `pattern` 仅能对原始字符串逐字符比对，预处理归一化依赖手写层补充拦截。
  - 当前 `INVISIBLE_CODEPOINTS` 包含 6 个典型不可见码点，未穷举全部 Unicode 格式控制字符。
