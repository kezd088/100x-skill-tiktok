# profiles/compliance-conservative（可选降级档，非默认）

> **这不是默认档。** `100x-localize` 默认（`register_profile=="default"`）走贴合
> 真实语料强度分布的路径（参考语料分布以 blackhat 为主，见
> `axioms.md` 公理 2）。本文件只在用户显式要求 `register_profile=="compliance-
> conservative"` 时生效。
>
> 本文件下面禁语清单要拦的"问题类型"（哪几类无证据宣称）参考了
> 西语口播风格规范讨论的同一个范畴，但下面的 5 条具体示例短语是为这份可交付文档独立整理、重新
> 措辞写出的。该规范本身也说明过：它
> 是把销售结构适配到墨西哥西语的语言规范，不代表已经过真实投放验证或母语
> 语料统计验证——本文件同样不把下面的示例包装成"已验证的最佳实践"。

## 禁用（无证据支撑时不要用）的措辞

以下措辞 `register_profile=="compliance-conservative"` 时禁止出现在
`localized_script` 里（`schema.json` 用 `allOf[0].if/then` + 负向前瞻正则强制，见
`axioms.md` 公理 2）：

- `Te transforma la vida por completo y para siempre.`
- `Erradica / suprime / sana en un abrir y cerrar de ojos, para siempre.`
- `Todo el mundo ya lo está usando ahorita.`
- `Cuenta con aprobación oficial de la FDA.`
- `Según especialistas de Harvard lo aseguran.`

除非用户输入（`source_script`）本身就明确提供了对应事实支撑，否则不要在改写时补上
这类措辞——即使源文提供了，也应该在 `meta.warnings` 里标为"待核实/风险项"，不是
`100x-localize` 自己去核实这类宣称的真实性（本 skill 没有核实能力，只做语言/结构
本地化）。

## 六个"只能填入真实事实"的钩子模板（替代方案，不是禁止表达强度）

`compliance-conservative` 档不等于"改写成没有卖点的平淡文案"，而是把宣称句换成
下面这六类模板，模板本身只是句式结构，填入的内容必须是 `source_script` 里实际存在
的事实，不能编（这六条模板句式为这份可交付文档独立撰写，只保留"只能填入真实事实"这条框架性要求，见
`sources.md`）：

- 日常场景：`¿Cuántas veces te has topado con [una situación puntual] sin
  hallar una salida clara?`
- 好奇心切入：`Hay un detalle que casi nadie menciona sobre [este asunto], y
  cambia cómo lo ves.`
- 真实原因：`Antes de culpar a [idea que todos repiten], vale la pena revisar
  [lo que pasa de fondo].`
- 更短的路径：`Existe una manera de llegar a [ese objetivo] sin pasar por
  [el rodeo de siempre].`
- 前后对照：`Lo que antes costaba [tanto esfuerzo] ahora se logra con
  [un solo paso distinto].`
- 具体数据：`Este es el dato detrás de [este asunto]: [lo que de verdad
  pasó].`

## 语气强度参考（供改写时把握"保守但不平淡"的尺度）

以下例句供改写时参考，已独立撰写：

- 中性教育：`Puede que no haga falta sumar más pasos. Lo primero es
  entender qué origina...`
- 默认销售口吻：`Cuando buscas algo más directo para resolverlo, aquí hay
  una ruta distinta.`
- 高强度（仍不虚构紧迫/绝对疗效/侮辱受众）：保持利益前置和明确的下一步，但不越
  过已验证的证据边界。

## 与 axioms.md 的关系

- 公理 2 决定"什么时候用这份文件"（仅 `register_profile=="compliance-
  conservative"` 时）。
- 公理 3（tú-only）、公理 1（压缩比）、公理 4（防臆造权威）在 `compliance-
  conservative` 档下**同样生效**，本文件不替代那三条，只叠加禁语清单这一层。
