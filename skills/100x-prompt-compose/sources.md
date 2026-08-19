# 100x-prompt-compose · 来源追溯

本 skill 由两部分机制组装而成：
① 包含 14 个模板的提示词模板库（`templates.json`）；
② 针对目标视频生成模型（Veo / Seedance）的包装与校验规范（`profiles/veo.md`、`profiles/seedance.md`）。
本文件记录逐文件对照、原创判断披露、模型 profile 设计决策与测试记录。

## 一、设计依据与模块组成

1. 提示词模板库（14 组标准化模板，涵盖图片与视频生成场景）
2. 目标模型包装规范（Veo 3.1 五段式结构、Seedance 散文式结构、时长限制与禁词表）
3. 提示词组装公理与自动化校验体系

## 二、逐文件对照表

| 本 skill 文件 | 机制说明 | 设计与改写要点 |
|---|---|---|
| `templates.json` | 14 组标准化提示词模板 | 包含模板 ID（IMG-01~05、VID-A~G、PART-HOOK、PART-CTA）、正文、变量定义与 `meta.render_notes` 说明。 |
| `profiles/veo.md` | Veo 3.1 模型包装规范 | 规范 8 秒时长上限、五段式结构（GU/Visual/Dialogue/Timing/Style Lock）、禁词表与无双引号规则。 |
| `profiles/seedance.md` | Seedance 模型包装规范 | 规范 10 秒时长上限、纯英文散文结构、21 词禁词表与结尾固定三否定后缀（`no text, no subtitles, no watermarks`）。 |
| `axioms.md` | 4 条核心公理 | 包含逐字插值、引用锁完整性、场景光线控制、模型时长及禁词约束。 |
| `workflow.md` | 三阶段工作流 | Phase 1 接收校验 → Phase 2 生成与模型包装 → Phase 3 校验与按需返工。 |
| `SKILL.md` | 技能主说明 | 触发词、输入输出契约、核心约束与已知局限说明。 |
| `schema.json` | 输出契约定义 | JSON Schema draft-07 格式定义。 |
| `metadata.json` | 技能元数据 | 元数据与自检规范定义。 |
| `evals/*.json` | 测试样例 | 覆盖图片、Veo、Seedance 与通用 CTA 模板的端到端测试。 |

## 三、veo / seedance 独立维护的说明

**设计决策：保持 `profiles/veo.md` 与 `profiles/seedance.md` 两个独立规范文件。**

原因对照：
- **时长上限**：Veo（8.0s）与 Seedance（10.0s）数值不同。
- **结构范式**：Veo 采用显式五段标签结构，Seedance 采用连贯英文散文结构。
- **禁词表**：Veo 重点拦截 AI 套路词与双引号；Seedance 重点拦截 11 个 AI 美化词 + 10 个文字层词。
- **结尾固定句**：Veo 为 Style Lock 固定句，Seedance 为三否定后缀。

独立维护保证各自规范清晰完整，避免条件分支混淆。

## 四、原创判断披露

1. **方括号占位的处理方式**（`templates.json` `meta.render_notes`）：模板正文中的作者态占位（如【效果公式：...】、【按 hook_type 选骨架】）在渲染时整体替换为对应描述句，避免指令性文字残留。
2. **Seedance 禁词与结尾固定句的处理逻辑**：禁词扫描前先剥离结尾固定三否定后缀本身，再扫描正文，保证规则自洽执行。
3. **产品/人物锁编号追踪机制**（`existing_refs_input`/`established_refs_after`/`reference_locks[]`）：实现跨调用自动化追踪参考图编号引用完整性。
4. **词边界（word-boundary）匹配**：对禁词与光线词采用 `\bword\b` 词边界正则匹配，避免对普通单词（如 `texture` 误触 `text`）造成误报。

## 五、测试与样例说明

`evals/` 目录包含 4 个标准合成样例，分别覆盖玻璃药瓶产品锁建立、真人口播 Veo 引用、清洁喷雾 Seedance 包装以及折扣 CTA 组装，均通过全流程自动化验证。

## 六、后续优化规划 (TODO)

- [ ] TODO：结合更多模型运行实际情况补充即创模型的具体校验规则。
- [ ] TODO：持续扩充真实职业名词与禁词防误触对照。
