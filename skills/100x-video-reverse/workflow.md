# 100x-video-reverse · 三阶段流程

> 本流程采用三段式规范（Phase 1 接收与抽帧入口校验 → Phase 2 反推生成与变量化 → Phase 3 校验与按需返工）。
>
> 全流程贯穿一条不可绕过的工程约束：**agent 读不了 mp4，只能读图片**（`SKILL.md` 已知
> 局限 1）。"视频"到"反推产物"之间必须经过 `scripts/extract-frames.mjs` 的实体抽帧，
> 没有任何阶段可以跳过这一步直接"看视频然后…"——下面每个步骤都会明确标出输入是"帧图"
> 还是别的。
>
> 类别 C（上游可选产出）在本 skill 是**无**：这是流水线里最靠前的反推环节（`metadata.json`
> 的 `layer: L1-source-reversal` / `step: 0-video-reverse`），不消费本仓任何其他 skill
> 的产出作为输入，反过来下游 skill 也不会因为用户没跑过本 skill 而拒绝或降级（`SKILL.md`
> "独立调用保证"）。这一点和 `100x-visual-fission`（类别 C 消费 `100x-persona`/
> `100x-search-query` 产出）不同，不要套用那份先例的类别 C 写法。

---

## Phase 1 · 接收 + 抽帧入口校验

### 触发进入条件
- 用户直接调用 `/100x-video-reverse`
- 或被入口路由（如未来的 `100x-tiktok`）转来
- 或自然语言触发："反推这条视频" / "这个视频怎么复刻" / "把视频拆成提示词" / "视频反推" /
  "反推提示词" / "这条视频的画面怎么做出来的" / "帮我拆解这条爆款" / "reverse this video" /
  "video to prompt" / "how was this video made" / "extract prompts from this video"
- 或直接给一条视频文件路径/URL，或已经跑过 `scripts/extract-frames.mjs` 的帧图 +
  `meta.json`，要求拆出能直接复刻的生成提示词

### 固定开场白（≤60 字，实测 45 字）
> 我是视频反推生成器。发一条视频，我抽帧后拆分镜和画面形态，产出双轴复刻提示词与变量化模板。

**说话锁定**：不加"你好"/"欢迎使用"/"请问"；不主动列本 skill 能做什么/不能做什么；
不提其他 skill。

### 输入分类

**类别 A（硬性必填，二选一，缺了就固定话术拒绝、不代猜）**：
1. **视频文件路径/URL**——`scripts/extract-frames.mjs` 同时接受本地文件路径和
   `http(s)://` URL（脚本内部按 `isUrl` 分支处理，二者走同一套抽帧逻辑）。**没有视频不做
   文字降级**——这一点和 `100x-visual-fission` Phase 1 允许"文字描述参考外观"的降级路径
   不同，本 skill 没有对应的逃生舱：反推的前提是真的看到画面，没有视频就没有画面可看，
   任何文字描述都只是转述而不是反推（公理 1）。
2. **或者已经跑过 `scripts/extract-frames.mjs` 产出的帧图 + 该次运行生成的 `meta.json`**——
   如果之前的会话已经抽过帧，不需要重新抽一遍，直接把现成的帧图和 `meta.json` 交给本
   skill 即可（见下方 Phase 2 步骤 2A 的两条分支）。

两种形式二选一即可满足类别 A。视频不存在、ffprobe 读不出时长、或时长 > 180 秒 →
固定拒绝，不降级、不截断硬跑（公理 1）：

```
100x-video-reverse 需要一条视频文件路径/URL，或者已经跑过 scripts/extract-frames.mjs
产出的帧图 + meta.json。没有视频无法反推，也不能用文字描述替代——请提供视频，或提供
已抽好的帧。
```

**类别 B（软性，缺失走默认值）**：
- `target_model`（`veo`/`seedance`/`即创`/`generic`，决定单段时长上限，见公理 2）。
  `schema.json` 把这个字段列为必填（`required`），不能真的留空——用户没指定时不追问，
  直接在产物里填 `target_model: "generic"`（`generic` 本来就是 schema 为"未指名引擎"
  设计的枚举值），对应**最严档 8.0 秒**上限，并在 `meta.warnings` 追加一条
  "`target_model` 未指定，已按 `generic`/最严档 8.0s 上限处理"。

**类别 C（上游可选产出）**：无。见本文件开篇说明，不在这里重复。

### 接收后立即做（按顺序）

1. **读输入**：视频文件路径/URL，或已抽好的帧图 + `meta.json`。
2. **类别 A 校验**：两种形式都没有 → 输出上方固定拒绝话术，追问"请提供视频，或提供
   已抽好的帧"；追问后仍拿不到 → 终止，不代猜、不用文字描述顶替继续往下走。
3. **类别 B 校验**：`target_model` 缺失 → 按最严档 8.0s 默认值继续，`meta.warnings`
   追加提示（见上）。
4. **时长 180 秒硬闸的判定时机**：**不在 Phase 1 单独重复判断**——如果给的是原始视频，
   这条判断在 Phase 2 步骤 2A 调用 `scripts/extract-frames.mjs` 时由脚本内部的 `ffprobe`
   探测完成（脚本会在抽任何帧之前先判断，超限直接 `exit 2`，不产出任何帧）；如果给的是
   已经跑过抽帧的 `meta.json`，说明这条视频在被抽帧的那一刻就已经通过了同一道闸（脚本
   不可能对一条 > 180 秒的视频产出 `meta.json`），不需要在本 skill 这一层重新验一遍。
5. **冲突输入拒绝**：用户给的是别的 skill 产出的反推 JSON（例如手写伪造的
   `VideoReverseBundle`，不是真的经过抽帧流程得到的）而不是视频本身或真实的抽帧产出 →
   提示"本 skill 需要真实的视频或抽帧产出作为输入，不接受手写/伪造的反推结果替代"。

### 退出信号
视频文件路径/URL，或已抽好的帧图 + `meta.json`，二选一已提供 → 进入 Phase 2。

### 失败处理
- 类别 A 两种形式都缺失 → 固定拒绝 + 追问，追问后仍拿不到 → 终止，不代猜、不接受文字
  描述当替代方案（公理 1，没有对应的降级路径）。

---

## Phase 2 · 抽帧 + 双轴反推 + 变量化

> 七个子步骤，1:1 对应本 skill"复刻提示词（双轴）+ 变量化（双块）"的产出结构：
> **2A 抽帧 → 2B 分镜边界（轴 A 骨架）→ 2C 轴 A 逐镜提示词 → 2D 轴 B 画面形态归类 →
> 2E 变量化块 1（slot_template）→ 2F 变量化块 2（cross_shot_analysis）→ 2G 逐条自检**。

### 2A · 抽帧（或复用已有抽帧产出）

**分支 1：给的是原始视频文件路径/URL**——运行：

```
node scripts/extract-frames.mjs <video-path-or-url> [--out <dir>] [--threshold 0.3] [--max-frames 30] [--min-frames 3] [--force]
```

`--threshold`/`--max-frames`/`--min-frames` 三个都有缺省值（0.3/30/3），一般不需要手动
指定；只有明确需要调整场景切换灵敏度或关键帧数量上限时才显式传（这是脚本自己的实现
细节，不是本 skill Phase 1 类别 B 要求用户填的字段）。

- `exit 0`：成功。脚本在输出目录（默认 `frames-<视频文件名>/`，或 `--out` 指定的目录）
  写入若干 `frame_<3位序号>_t<2位小数时间戳>.png` 关键帧文件 + 一份 `meta.json`。
- `exit 1`：视频不存在 / `ffprobe` 读不出时长 / 输出目录已存在且未加 `--force` / 抽帧
  失败 / 参数不合法。多数情况按类别 A 缺失处理；"输出目录已存在"这一种可以换个 `--out`
  目录或加 `--force` 重试。
- `exit 2`：时长 > 180.0 秒（公理 1 的硬闸）→ **不产出任何帧**，把脚本给出的拒绝信息
  原样转达给用户，终止整个流程，不重新组织措辞、不尝试只处理前 180 秒。

**分支 2：给的已经是帧图 + 现成的 `meta.json`**——跳过运行脚本，直接读取该 `meta.json`。

无论走哪个分支，从 `meta.json` 里取出以下字段，**原样抄写，不重新计算或估计**（这是
`schema.json` 对 `source.aspect_ratio`/`source.extraction_method` 的明确要求——"Copied
...not re-derived by the model"）：

| `meta.json` 字段 | 填入 `VideoReverseBundle` 的位置 |
|---|---|
| `duration_sec` | `source.duration_sec` |
| `aspect_ratio` | `source.aspect_ratio` |
| `frames.length` | `source.frames_analyzed` |
| `extraction.method` | `source.extraction_method` |
| （该 `meta.json` 文件自身的路径） | `meta.frames_source` |

**`extraction.method` 三值的含义，决定要不要额外披露**：
- `scene-detect`：干净——场景检测天然给出的候选切点数量落在 `[min-frames, max-frames]`
  区间内，不补不裁。
- `scene-detect+interval-fill`：场景检测找到的候选切点太少（含强制的 `t=0` 首帧），按
  等间隔补到 `min-frames`——补出来的边界**不代表真实场景切换**，只是均匀采样点。
- `scene-detect+top-n`：候选切点太多，只保留了按 `scene_score` 排序后分数最高的一批，
  真实检测到的候选数记在 `extraction.detected_cuts` 里，**原始候选里被丢弃的部分可能
  包含未被看到的画面变化**。

后两种情况都要在 `meta.warnings` 追加一条披露，例如：

```
"extraction_method=scene-detect+top-n：ffmpeg 检测到 12 个候选切点，只保留了 6 个
（按 scene_score 排序），中间可能有画面细节未被看到"
```

### 2B · 读帧图，判定分镜边界（`shots[]`，轴 A 骨架）

**先明确时间戳怎么换算成镜头边界。** 抽帧脚本给的是**离散时间戳**，而
`shots[].time_bucket` 要的是**首尾相接、覆盖全片的区间**，两者之间的映射规则是：

> **每个场景切点时间戳 = 一个新镜头的起点**，不是该镜头的中点、也不是代表性取样点。
> 相邻两个切点之间构成一镜；**最后一镜的终点用 `source.duration_sec`（视频真实总时长），
> 不是最后一个关键帧的时间戳**——后者几乎总是小于前者，直接拿来收尾会违反 C2。

例：`meta.json` 给出 `[0.00, 4.00, 13.00, 20.00]`、`duration_sec: 28.0`
→ 基础切法是 `0.0-4.0` / `4.0-13.0` / `13.0-20.0` / `20.0-28.0`。

这是 ffmpeg 场景检测的语义（检测到的时间戳是新场景的第一帧）。该语义此前只存在于
`scripts/extract-frames.mjs` 的代码注释里，本节补明——**不要求使用者读源码才能推出
这条规则**。不写明的话，完全可能有人把关键帧时间戳理解成"这一镜的
中点"，从而得出一套自洽但完全不同的切法。

在此基础上按时间顺序**通读全部关键帧**（不是只看首尾两张），建立对整条视频画面内容的
完整认知。基础切法只是起点，**不是机械地"每个关键帧各自独立成一镜"**：

- 连续几个关键帧其实是同一个连续镜头内的不同瞬间（抽帧算法把轻微画面变化误判成场景
  切换）→ 合并成一镜。
- 一段画面即使视觉上连续，但跨度超过 `target_model` 对应的单段时长上限 → 必须再拆分成
  多镜（公理 2 原文"宁可切碎也不产出喂不进去的段"），哪怕这样切开会让同一个连续镜头
  被拆成两条 `shots[]` 记录。

**拆出来的子镜头没有独立关键帧覆盖时怎么写**：
超时长拆分会产生一种情况——比如 `4.0-13.0` 这段 9 秒因超过 8.0s 上限被拆成
`4.0-8.5` 和 `8.5-13.0`，但抽帧只在 `t=4.0` 给了一张图，`8.5-13.0` 这个子镜头
**你从未独立观测过**。约定如下：

1. 该子镜头的 `prompt_en`/`prompt_zh` 基于它所属的原始镜头画面来写，措辞上体现"延续"
   （例如描述同一场景、同一主体的持续状态），**不得凭空发明该时段特有的新画面细节**——
   你没看见的东西不能写进去（`SKILL.md` 禁用词一节的硬性要求）。
2. 在 `meta.warnings` 里如实记一条，说明哪几个 `shot_id` 是纯时长拆分产物、没有独立
   关键帧证据。这样下游读者知道这几条的可信度低于有帧图支撑的镜头。
3. 如果这段时间里画面其实变化很大（只是场景检测没切出来），正确做法是回到 2A
   **降低 `--threshold` 重新抽帧**拿到更密的帧，而不是靠想象补写。

最终结果必须满足公理 2 的 C1-C5（`scripts/validate.js` 的 `axiom2TimelineCheck` 实际
校验，`schema.json` 只锁 `time_bucket` 的字符串形状）：

| 判据 | 要求 |
|---|---|
| C1 | 首镜 `start == 0.0`（对应强制抽取的 `t=0` 首帧） |
| C2 | 末镜 `end` 与 `source.duration_sec` 相差 ≤ 0.2 秒——**是视频真实总时长，不是最后
      一个关键帧的时间戳**，两者不一致时以 `duration_sec` 为准收尾 |
| C3 | 相邻镜头首尾相接：`shots[i].end == shots[i+1].start`，不留缝也不重叠 |
| C4 | 每镜 `end > start`（禁零时长） |
| C5 | `shot_id` 从 1 起连续递增，不跳号 |
| 上限 | 单段 `end - start` 不超过 `target_model` 对应上限：`veo` 8.0s / `seedance` 10.0s /
       `即创`、`generic` 落最严档 8.0s |

**精度提醒**：`meta.json` 里的时间戳是 2 位小数，`time_bucket` 字段格式是"恰好 1 位
小数"的字符串（`schema.json` 的 `pattern` 锁死），把关键帧时间戳写入 `time_bucket` 前
要先四舍五入到 1 位小数。

每镜额外写：
- `shot_purpose`（7 值闭集，逐字复用 `100x-segment/schema.json` 的枚举：`hook`/`build`/
  `reveal`/`demo`/`social_proof`/`cta`/`transition`）——本 skill **没有类别 C 的文本
  信号可用**（不像 `100x-segment` 能从脚本文字判断意图），必须纯靠看画面判断。可参考的
  视觉线索（启发式，不是硬规）：开场强吸睛构图/悬念画面倾向 `hook`；权威背书/痛点铺垫
  画面倾向 `build`；成分/机制展示倾向 `reveal`；实际使用演示倾向 `demo`；评价/前后对比
  展示倾向 `social_proof`；产品+购买信息/价格卡出现倾向 `cta`；纯过渡镜头倾向
  `transition`。
- `camera_note`（可选，客观机位事实单行字符串，如"手持，中景，微俯角"）——故意保持
  自由文本、不拆成 `{shot_size, angle, motion}` 对象（分镜字段规范的硬性
  要求，见 `sources.md`）。

### 2C · 轴 A 逐镜写复刻提示词（`prompt_en` + `prompt_zh`）

只描述关键帧里**真实看得见**的内容，不脑补抽帧没覆盖到的细节——两个关键帧之间发生了
什么，本 skill 的 agent 同样看不见，不能凭空补全。

**`prompt_en`（公理 3，`schema.json` 的 pattern + `scripts/validate.js` 的
`axiom3BannedWordScan` 共同校验）**：
- 纯可打印 ASCII（拒绝非 ASCII 字符，包括中文和带重音符的西语字母如 é/ñ；**已知
  局限**：会放行不带重音符的全 ASCII 西语句子，"是不是英语"机器判不了，这条只挡非
  ASCII 字符）。
- 结尾必须逐字挂 `, no text, no subtitles, no watermarks`。
- 正文（**剥掉这段固定后缀之后**）不得命中 21 个禁词中任何一个：
  - AI 美化词 11 个：`cinematic` `professional` `studio` `beautiful` `stunning`
    `smooth skin` `perfect` `flawless` `polished` `editorial` `glamour`
  - 文字层词 10 个：`text` `subtitle` `caption` `watermark` `logo` `title` `font`
    `letter` `word` `overlay`
  - 检查用词边界匹配，不能用裸子串——"unpolished"是正向真实感锚点，不应被"polished"
    误伤（`--selftest` 有专门的回归用例验证这条）。
- `minLength` 20，`maxLength` 2000。

**`prompt_zh`**：中文对照，给运营团队读改用，不喂模型，因此不受 ASCII/禁词/后缀约束，
但要与 `prompt_en` 结构对齐——两者都非空；如果 `prompt_zh` 里意外出现 `{SLOT}` 形态的
花括号 token（正常情况下 `shots[]`/`visual_forms[]` 的提示词不应该带槽位，那是
`slot_template` 的领地），必须和同条 `prompt_en` 的槽位集合完全一致——这是
`scripts/validate.js` 的 `bilingualStructuralAlignmentCheck`（标记 `[bilingual]`，
作为非公理编号内的独立检查项，见 `axioms.md` 公理 5 及 `validate.js`
文件头说明）。`minLength` 8，`maxLength` 2000。

### 2D · 轴 B 画面形态归类（`visual_forms[]`，公理 4）

**通读完整体 `shots[]` 之后再做这一步**，不是边写 `shots[]` 边归类——需要看完全局才知道
哪些画面形态在不连续的镜头里反复出现。

- 把画面形态收敛成闭集 9 值之一：`talking_head` / `selfie_ugc` / `product_closeup` /
  `hands_demo` / `before_after_split` / `b_roll_lifestyle` / `text_card` /
  `screen_recording` / `animation_graphic`。**`text_card`/`screen_recording` 是本次
  原创扩展，未经真实语料验证**（`SKILL.md` 已知局限 3）——用到这两个值时多留意一下
  判断依据是否真的站得住脚。
- 同一形态在不同镜头反复出现时**收敛成一条**，不要每次出现都新开一条
  `visual_forms` 条目（公理 4"形态唯一"；`scripts/validate.js` 的
  `axiom4CrossAxisIntegrityCheck` 会拒绝数组内 `form_type` 重复）。
- `appears_in_shots` 填入所有出现该形态的 `shot_id`（必须是 `shots[]` 里真实存在的
  编号——正向引用完整性；同时每个 `shot_id` 必须至少被一条 `visual_forms` 覆盖——
  反向零孤儿，不能有镜头"形态轴假装它不存在"，两个方向都由
  `axiom4CrossAxisIntegrityCheck` 校验）。
- 这条形态的 `prompt_en`/`prompt_zh` 要写成能代表"这一类形态"的**通用**描述，不是照搬
  某一个具体 `shot` 的专属细节——如果一个形态覆盖多镜，直接复制其中一镜的 prompt 会带
  入只在那一镜成立的细节（比如具体动作瞬间），应该抽象成"这一形态长什么样"，不是
  "这一镜发生了什么"。
- 同样要满足公理 3 的 ASCII + 后缀 + 禁词三项（和 `shots[]` 的提示词同一套规则，见 2C）。

#### `text_card` 形态的专门写法（必读，不照做会产出自相矛盾的提示词）

`text_card` 和强制后缀 `no text, no subtitles, no watermarks` 表面上直接打架：一个说
"这一镜的主体就是文字"，一个说"不要文字"。**解法不是给它开后缀例外，而是理解方法论立场——文字层由后期叠加，不由生成模型渲染。** 这条在多项规范中明确确立为硬公理。

所以：

> **`text_card` 镜头的 `prompt_en` 只描述底板视觉，不写文字内容本身。**

- ✅ 该写：底色／材质／光影／构图留白（例：`a plain matte dark navy card fills the
  frame, soft even lighting, generous empty space in the middle, shot on a phone`
  + 后缀）
- ❌ 不该写：具体文字内容、字体、排版、"显示着某句话"——**哪怕换个说法绕开禁词也不行**。
  例如 `displays the bold white capital phrase NEW ARRIVAL centered…` 这类写法
  干净通过了校验（`phrase` 不在 21 词表内），但送进 Veo/Seedance 时前半句要模型画字、
  后半句命令不许有字，模型大概率压制这段内容，**恰好废掉这一镜存在的意义**。
- 文字内容本身属于后期字幕层，记在 `prompt_zh` 的中文说明里给运营看即可，或者放进
  `meta.warnings`，不要进 `prompt_en`。

**机器不管这条**：禁词表挡的是 `text`/`title`/`word`/`caption` 这些名词，同义表达
（`phrase`/`lettering`/`typography`…）无穷无尽，扩表治不了。这是流程纪律，
`SKILL.md` 已知局限第 7 条如实标注了它不是机器判据。

### 2E · 变量化块 1：`slot_template`（公理 5）

从轴 A/轴 B 已写好的提示词里选一条作为变量化基础。**推荐优先从轴 B（`visual_forms`）里
选**，通常是承载人物/产品身份的那条（如 `talking_head` 或 `product_closeup`）——轴 B
本身就是"可复用"设计意图所在；轴 A 的镜头提示词是时间轴绑定的，不是不能选，但通常不是
变量化的最佳起点。选哪一条是生成期的判断，`schema.json`/`slot_template` 本身没有字段
记录"这个模板是从哪条 shot/visual_form 改写来的"，选定后不需要额外声明来源。

- 识别提示词里"批量复制时可能会变的具体值"：人物种族/年龄/服装/场景细节/产品颜色等，
  替换成 `{ALL_CAPS}` 槽位 token（`slot_item.name` 的 pattern 要求全大写 `^[A-Z][A-Z0-9_]*$`，
  不能小写）。
- 每个槽位写三个字段：
  - `name`：全大写 token 名（不带花括号，如 `ETHNICITY`）。
  - `observed_value`：这条视频里实际是什么，原样如实记录——不是候选值之一。
  - `candidates`：**至少 2 个**候选替代值。
- **关键的诚实要求**：`candidates` 是生成期**提出的合理替代方案**，不是从视频里
  "观察到的"——本 skill 一次只反推**一条**视频，天然不具备 `100x-visual-fission` 那种
  "对比 ≥2 条参考材料、从差异里提炼候选值"的条件。提出候选值不能脱离产品/市场合理性
  （例如种族候选值要落在这条视频目标市场里说得通的范围内），不能为了凑够 2 个而瞎编
  无关选项。
- `template_en`/`template_zh`：把选中的源提示词改写成带 `{SLOT}` 的模板，同样要满足
  ASCII + 固定后缀 + **至少一个槽位**（`schema.json` 的 pattern 前瞻
  `(?=.*\{[A-Z][A-Z0-9_]*\})` 强制这一点——没有槽位的字符串是提示词，不是模板）。
- 闭合要求（`scripts/validate.js` 的 `axiom5SlotClosureCheck`，需要把 `{VAR}` 从字符串
  里分词做集合比较，`schema.json` 做不到）：
  - 正向：`template_en` 里出现的每个 `{SLOT}`，`slots[]` 里必须有同名条目。
  - 反向：`slots[]` 里的每个 `name`，必须在 `template_en` 里真的出现（否则是死变量）。
  - 中英一致：`template_zh` 的槽位集合必须与 `template_en` **完全相同**。

### 2F · 变量化块 2：`cross_shot_analysis`（公理 5，同视频内跨镜头对比）

**注意这不是 `100x-visual-fission` 的 `constants`/`variables`**——那两个字段做的是
**跨 ≥2 条不同参考材料**的共性提取；这里比较的是**同一条视频内部、不同 `shots` 之间**
的对比，比较单元不同，所以字段名故意不同（`invariants`/`varying_axes`），不要把两边
的判据或写法搬过来套用。

- `invariants[]`：观察 **≥2 个镜头**里都成立的不变量，按 5 值闭集 `aspect` 分类
  （`person`/`scene`/`product`/`wardrobe`/`lighting`），每条写 `description`
  （≥3 字符）+ `holds_in_shots`（**≥2 个**真实存在的 `shot_id`——单个镜头里观察到的
  东西还谈不上"不变"）。
- `varying_axes[]`：观察到镜头间确实发生变化的维度，5 值闭集 `axis`（`camera`/`pose`/
  `composition`/`location`/`action`；前 3 个与 `100x-visual-fission` 的 `dimension`
  枚举逐字相同，是严格超集，下游可以只取前 3 个不需要映射表），每条写
  `observed_values`（**≥2 个**真实观察到的不同取值）。
- **单镜头视频的特殊情况**：如果 `shots[]` 只有 1 条（视频短到不需要切镜），
  `invariants` 和 `varying_axes` **都可以是空数组**——单镜头视频天然没有跨镜头维度
  可比较（`schema.json` 顶层 `allOf`/`if-then` 把"`invariants` 至少 1 条"这条要求
  条件化在"`shots` 有 ≥2 条"时才生效，这是本次建造中途发现并修掉的一处设计缺陷：
  `invariant_item.holds_in_shots` 按定义要求 ≥2 个 `shot_id`，而单镜视频天然凑不出
  这个数，若不条件化会导致任何单镜视频都无法产出合法 bundle）。**但只要 `shots[]`
  有 ≥2 条，`invariants` 就不能是空的**——任何真实的多镜头视频总能找到至少一个跨镜头
  共享的锚点（哪怕只是"同一个人"或"同一个场景"）。

### 2G · 逐条自检（交付前）

过一遍 5 条公理 + `[bilingual]` 结构对齐检查：

- [ ] 公理 1：`source.frames_analyzed` ≥ 1，`meta.frames_source` 非空且指向这次真实
      的抽帧运行
- [ ] 公理 2：C1-C5 全部满足 + 每镜时长不超过 `target_model` 对应上限
- [ ] 公理 3：每条 `prompt_en`（`shots[]`/`visual_forms[]`/`slot_template.template_en`）
      纯 ASCII + 正确后缀 + 剥后缀后不含 21 禁词
- [ ] 公理 4：`visual_forms[].appears_in_shots` 双向引用完整性 + 零孤儿 + `form_type`
      数组内不重复 + `invariants[].holds_in_shots` 引用真实存在
- [ ] 公理 5：`slot_template` 槽位双向闭合 + 中英槽位集合一致
- [ ] `[bilingual]`：`shots[]`/`visual_forms[]` 的 `prompt_zh` 若含 `{SLOT}` token，
      与 `prompt_en` 的 token 集合一致

任一没过 → **只重写对应的那一条**（该 `shot`/该 `visual_form`/该 `slot`/该
`invariant`），不整体推倒重来。全部通过 → 按 `schema.json` 的 `VideoReverseBundle`
结构渲染最终 JSON。

### 退出信号
`schema.json` 的 `required` 字段全部齐全 + 2G 逐条自检全部通过 → 交付 JSON（可能触发
Phase 3 返工）。

### 失败处理

| 失败类型 | 行为 |
|---|---|
| C1-C5 任一未过（公理 2） | 定位到具体两镜之间重新划边界，不推翻整条 `shots[]` |
| 单段超过 `target_model` 上限 | 把该段再拆分成多镜，不允许"就超一点点"放行 |
| 禁词命中（公理 3） | 改写该条提示词的措辞，不删真实画面信息去凑合规 |
| 引用/覆盖缺口（公理 4） | 补齐引用或新增缺失的 `visual_forms` 条目，不删已写好的 `shots` |
| 槽位闭合失败（公理 5） | 修正 `template_en`/`slots[]`/`template_zh` 三者中不一致的一方 |

---

## Phase 3 · 用户触发的返工（非必经）

| 用户说 | 返工粒度 | 动作 |
|---|---|---|
| "这条镜头的提示词不对" / "这条形态的提示词写错了" | **L1** 单条提示词重写 | 只重写该条
  `shots[]`/`visual_forms[]` 的 `prompt_en`/`prompt_zh`，重新过一遍公理 3（是
  `visual_forms` 的话再顺带确认没有破坏公理 4 的引用） |
| "这一镜的时间/目的判断错了" | **L2** 单镜重做 | 重做该 `shots[]` 条目
  （`time_bucket`/`shot_purpose`/`camera_note`/提示词）——`time_bucket` 变了会级联
  影响相邻镜头的边界（C1-C5 首尾相接）以及引用它的 `visual_forms.appears_in_shots`，
  一并核对 |
| "这个画面形态分类错了" / "这两条形态应该合并成一条" | **L2** 单形态重做 | 重做该
  `visual_forms[]` 条目（`form_type`/`appears_in_shots`/提示词），重新过一遍公理 4
  双向检查 |
| "模板槽位不对" / "候选值不合理" | **L2** 变量化块 1 重做 | 只重做 `slot_template`，
  不动 `shots[]`/`visual_forms[]` |
| "跨镜头这个不变量/变化轴不对" | **L2** 变量化块 2 重做 | 只重做
  `cross_shot_analysis` 对应条目 |
| "换个目标模型" / "这个模型的时长上限不对" | **L3** 整体重切 | `target_model` 变了会
  改变单段时长上限（公理 2），所有 `shots[]` 的 `time_bucket` 必须回 2B 整体重切，
  级联重做 2C-2G（`visual_forms.appears_in_shots` 大概率要跟着重新挂钩，
  `slot_template` 的源提示词若来自被重切的镜头也要一并核对是否还成立） |
| "不用视频了，帮我用文字描述代替" | **没有对应返工路径。** | 直接回应："没有视频不做
  反推，也不能用文字描述替代——这是本 skill 的硬边界（公理 1），不是可协商的返工选项。
  如果没有视频原文件，请提供已抽好的帧图 + `meta.json`" |

**返工上限**：L1 无上限；L2（单镜/单形态/变量化单块）同一条目 3 次未过 → 保留最佳
版本 + `meta.warnings` 追加"该条返工 3 次未过，建议人工判断"；L3 整体重切 1 次未过 →
提示"整体重切仍未通过，常见原因是抽帧质量不够（关键帧没覆盖到真正的转场/信息点）或
视频本身画面切换过于琐碎，建议先确认抽帧结果是否完整"，不点名要求用户先跑其他 skill。

**禁用返工路径**：
- 不为了绕开某个禁词而删掉真实存在的画面描述细节，应换一种如实的措辞表达，不是删减
  真实信息
- 不为了凑够形态轴覆盖率而把明显不同的镜头硬塞进同一个 `form_type`
- 不为了让模板"看起来更完整"而编造视频里没有出现过的候选值——`candidates` 允许是
  生成期提出的合理方案，但不能脱离产品/市场常识瞎编（见 2E）
- `target_model` 收紧导致上限变化时，不能悄悄跳过必须的切分只为少写几条 `shots[]`
- 不主动建议用户去跑其他 skill

---

## 流转图

```
[用户触发]
  ↓
Phase 1 接收+抽帧入口校验（类别A：视频或已抽帧产出，二选一；类别B：target_model 默认值）
  ↓ 类别A过
Phase 2：
  2A 抽帧（跑 extract-frames.mjs，或直接读现成 meta.json）
  → 2B 分镜边界判定（shots[] 骨架，满足C1-C5+模型时长上限）
  → 2C 轴A逐镜写复刻提示词（prompt_en 纯ASCII+禁21词+三否定后缀 / prompt_zh）
  → 2D 轴B画面形态归类（visual_forms[]，9值闭集，appears_in_shots双向挂钩shots[]）
  → 2E 变量化块1：slot_template（{SLOT}模板+候选值，双向闭合）
  → 2F 变量化块2：cross_shot_analysis（invariants/varying_axes，同视频内跨镜头对比）
  → 2G 逐条自检（5条公理+[bilingual]）
  ↓ 全过
产出 JSON（schema.json 定义的 VideoReverseBundle）
  ↓
  ├→ 满意/无回复 → END
  ├→ 返工触发词 → Phase 3（L1/L2/L3，对应触发词表）
  └→ L3 整体重切 1 次不过 → 提示抽帧质量/画面切换过于琐碎，不点名路由
```
