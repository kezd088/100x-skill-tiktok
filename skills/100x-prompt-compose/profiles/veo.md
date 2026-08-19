# model_wrapper 档位 · veo

> 本档位定义 Veo 3.1 模型的生成包装规范。每次调用渲染单条模板
> body，并将其包装为符合 Veo 3.1 五段式的单个生成单元。

## 时长上限

- **8.0 秒**（Veo 3.1 硬上限）。`video_unit.duration_seconds` 固定为 `8.0`（本 skill 不做
  多 GU 切分，每次渲染 = 一个生成单元）。

## 结构（五段式，套在 rendered_body 外层）

1. **定位段**：`GU1 (reference range: 0.0-8.0s, generated duration: 8.0s).`
2. **Visual 段**：把 `rendered_body`（已完成 {key} 替换、含 realism_suffix 的中文内容）
   转译成 4-6 句英文叙事——主体+场景+动作+镜头+氛围，连贯散文，非清单。
3. **Dialogue 段**（若模板变量含 `line_en`/`line_open`/`line_rec` 等台词字段）：
   ```
   Spoken dialogue (say EXACTLY, word-for-word): {line}
   Mouth clearly visible when speaking, lip-sync aligned with the spoken dialogue.
   ```
   台词若源自非英文语料，必须先改写成美式口语化英文（模板库 `meta.hard_rules` 第 5 条），
   不保留原语言；若台词是中文台词本身要保留（如 model=veo 但内容明确要求中文口播），
   前置 `in Mandarin Chinese`。无台词模板写 `No spoken dialogue. Keep motion active,
   natural, and editable.`
4. **Timing 段**：`Spoken content happens within {x.x-y.y}s. From {tail}s to 8.0s,
   continue the current motion at the same pace—do not slow down or freeze.`
5. **Style Lock 段**（固定句，一字不改）：
   ```
   Keep lighting, color grade, and overall visual feel consistent with the reference frame.
   ```

## 禁用词（命中即该 `video_unit` 作废重写）

**AI 套路词**：`cinematic` / `professional` / `studio` / `stunning` / `flawless` /
`perfect` / `smooth skin` / `polished` / `editorial` / `glamour` / `pristine`

**AI magic adverbs**：`quietly` / `deeply` / `fundamentally` / `remarkably` / `arguably`

**AI delve 家族**：`delve` / `utilize` / `leverage`（动词）/ `robust` / `streamline` /
`harness`

**格式非法项**：双引号 `"`（引号触发 Veo 字幕，Dialogue 段用冒号+裸文本代替）、
markdown 围栏 ` ``` `、emoji。

**例外放行**：运镜术语（`medium close-up` / `tracking shot` / `dolly in`）即使含
`medium` 也合法；单引号 `'` 不触发字幕，允许。

## 与 seedance.md 的关键差异

| 维度 | veo | seedance |
|---|---|---|
| 时长上限 | 8.0s | 10.0s |
| 结尾固定句 | `Keep lighting, color grade, and overall visual feel consistent with the reference frame.` | `no text, no subtitles, no watermarks` |
| 禁词表 | 11 AI 套路词 + 5 magic adverbs + 6 delve 家族 + 双引号/围栏 | 21 词（11 AI 美化 + 10 文字层）|
| 台词格式 | 冒号+裸文本（禁双引号）| 通用英文双引号可用（Seedance 无"引号触发字幕"已知问题） |

两套禁词表和结构规则来源不同、内容不完全重叠，本 skill 判断**不合并**，理由见
`sources.md`"veo/seedance 是否合并"一节。
