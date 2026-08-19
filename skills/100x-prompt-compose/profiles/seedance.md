# model_wrapper 档位 · seedance

> 本档位定义 Seedance 模型的生成包装规范。本 skill 每次包装单条模板
> body，不做多 shot/多段落的拼接编排。

## 时长上限

- **10.0 秒**（Seedance 2.0 硬上限，比 Veo 3.1 宽 2 秒）。`video_unit.duration_seconds`
  固定为 `10.0`。

## 结构（散文式，不显式分节标签）

按"景别+机位 → 主体外观+动作+场景+光线UGC感+真实感锚点 → 台词（可选）→ 节拍描述 →
设备质感+结尾硬规"的顺序组织成连贯英文段落（不像 veo 那样标"① ② ③"标签）：

- 台词：中文台词写 `In Mandarin Chinese: {台词}`；英文台词直接给出（Seedance 对双引号
  没有"触发字幕"的已知问题，可用双引号或冒号）。
- **每段末尾必须硬性追加**（一字不差）：
  ```
  no text, no subtitles, no watermarks
  ```
  这条不是可选项，也不接受 `(no subtitles)` 这种缩写替代——那是 veo 的可选变体写法，
  seedance 这边是固定短语。

## 禁用词（21 个，命中即该 `video_unit` 作废重写）

**AI 美化词（11）**：`cinematic` / `professional` / `studio` / `beautiful` / `stunning` /
`smooth skin` / `perfect` / `flawless` / `polished` / `editorial` / `glamour`

**文字层词（10）**：`text` / `subtitle` / `caption` / `watermark` / `logo` / `title` /
`font` / `letter` / `word` / `overlay`

## 与 veo.md 的关键差异

见 `profiles/veo.md` 文末对照表。核心结论：段长上限 8s→10s 放宽、结尾固定句从
"Style Lock 光影一致句"换成"no text/subtitles/watermarks 硬规"、禁词表从"11+5+6"
换成"11+10"（且两张表内容不完全重叠——veo 禁 `quietly`/`delve` 这类抽象副词，
seedance 不禁；seedance 禁 `text`/`subtitle`/`logo` 这类文字层词，veo 没有把这些列进
公理 4 的清单），这是本 skill 判断"不合并两个档位"的主要依据（详见 `sources.md`）。
