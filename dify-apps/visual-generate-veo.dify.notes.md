# visual-generate-veo.dify.yml — 设计笔记

范围：接在 `100x-prompt-compose`（`category == "视频"`, `model == "veo"`）产出的
`ComposedPromptBundle` 之后，实际调用 Google Veo 把 `video_unit.final_prompt_wrapped`
渲染成视频文件。不负责 prompt 打包逻辑本身（那是 `100x-prompt-compose` 应用的职责范围）。

研究时间：2026-08-05。Veo/Dify 都在快速变化，下方每条技术结论都标了出处和抓取方式，
过期请以当时的实时文档 / marketplace API 为准，不要直接信任本文件的具体版本号/哈希值。

## 1. 研究结论与出处（每条都可核实）

### 1.1 Veo 现在怎么调（Gemini API，不是 Vertex AI）

**结论：本设计选择走 Gemini API（`generativelanguage.googleapis.com`），不是 Vertex AI。**
原因：官方 Dify 插件（见 §1.2）本身就是走 Gemini API + API Key，认证最简单，且已经是
"已验证存在、已在 marketplace 活跃"的路径，不需要我们自己再实现一遍。

- 端点：`POST https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning`
- 鉴权：HTTP header `x-goog-api-key: <API Key>`（不是 OAuth/service account）
- 请求体（text-to-video）：
  ```json
  {
    "instances": [{ "prompt": "..." }],
    "parameters": { "aspectRatio": "16:9", "resolution": "720p", "durationSeconds": "8" }
  }
  ```
- `durationSeconds` 只接受 `"4"` / `"6"` / `"8"`（字符串），1080p/4k 或使用扩展/参考图时必须是 `"8"`。
- 异步：返回一个 operation 对象，字段 `name` 是 operation ID；轮询
  `GET https://generativelanguage.googleapis.com/v1beta/{operation.name}`，`done` 为
  `true` 时 `response.generateVideoResponse.generatedSamples[0].video.uri` 是最终视频地址。
  生成延迟 11 秒到 6 分钟不等（高峰期），视频在 Google 侧只保留 2 天。
- 出处：
  - [Generate videos with Veo 3.1 in Gemini API](https://ai.google.dev/gemini-api/docs/veo) ——
    通过 WebFetch 抓取，返回了完整端点/请求体/轮询字段（见上）。
  - [Video generation in the Gemini API](https://ai.google.dev/gemini-api/docs/video) ——
    只有导览性文字，没有实现细节，仅作交叉印证用。
  - WebSearch "`predictLongRunning` veo generativelanguage.googleapis.com curl example
    operations.get" 命中的聚合结果，给出与上面一致的 curl 示例和 `operations.get` 轮询模式。
  - **最强交叉验证**：官方 Dify 插件的真实 Python 源码（见 §1.2）内部就是调用
    `google-genai` SDK 的 `genai_client.models.generate_videos()` /
    `genai_client.operations.get()`，轮询逻辑（`operation.done` 布尔量、`operation.error`）
    与上面文档描述的字段完全吻合——这不是文档，是生产代码，可信度高于纯文档摘要。
  - Vertex AI 变体（`docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation`）
    也抓取过，但页面内容对 WebFetch 摘要模型不可读（返回的是别的端点列表），**未能独立确认
    Vertex AI 侧的具体端点形状**——不过这不影响本设计，因为我们走的是 Gemini API 路径。

### 1.2 Dify marketplace 有没有现成 Veo 插件——有，而且是官方的

**结论：有。`langgenius/gemini_video`，官方仓库 `langgenius/dify-official-plugins`
下的 `tools/gemini_video/`，marketplace 上状态 `active`，安装量 1171，最近更新
2026-08-01（即抓取前 4 天）。**

- 插件源码（GitHub，直接读取，非摘要）：
  - manifest: <https://github.com/langgenius/dify-official-plugins/blob/main/tools/gemini_video/manifest.yaml>
  - provider 定义: <https://github.com/langgenius/dify-official-plugins/blob/main/tools/gemini_video/provider/gemini_video.yaml>
  - tool 定义（参数 schema）: <https://github.com/langgenius/dify-official-plugins/blob/main/tools/gemini_video/tools/gemini_video.yaml>
  - tool 实现（真实调用逻辑）: <https://github.com/langgenius/dify-official-plugins/blob/main/tools/gemini_video/tools/gemini_video.py>
  - README: <https://github.com/langgenius/dify-official-plugins/blob/main/tools/gemini_video/README.md>
- Marketplace 活跃状态（直接调用其公开 JSON API 确认，不是猜测）：
  `curl https://marketplace.dify.ai/api/v1/plugins/langgenius/gemini_video`
  返回 `"status":"active"`、`"install_count":1171`、
  `"latest_version":"0.0.15"`、
  `"latest_package_identifier":"langgenius/gemini_video:0.0.15@79506f51ced07347e29fcb068fd1540ddaf756cb4ac815a37224816e0507c476"`。
  这个 identifier 已直接写进本 DSL 的 `dependencies` 和 tool 节点的 `plugin_unique_identifier`。
  完整响应存了一份在 `../research/gemini_video_marketplace.json`（临时文件，仅供复核，
  不是仓库的一部分）。
- 支持模型：`veo-3.1-generate-preview`（标准）、`veo-3.1-fast-generate-preview`（快）。
- 鉴权：provider 级别单一凭证 `gemini_api_key`（`secret-input`），在 Dify Console 里
  "Tools → Gemini Video → Authorize" 配置，**不出现在 DSL 里**——这是 Dify 插件鉴权的标准做法
  （`dsl-structure.md` 原话："Do not hardcode real plugin credentials. Exported plugin
  authorization generally lives in Dify, not in DSL."）。
- 关键实现细节（读 `tools/gemini_video.py` 源码得到，不是猜测）：
  1. 插件内部自己做了完整的 submit → 轮询 → 下载：`genai_client.models.generate_videos(...)`
     提交，然后 `while not operation.done` 循环 `time.sleep(10)`，最多 60 次（**10 分钟硬超时**），
     超时或 `operation.error` 都会抛 `InvokeError`。
  2. 生成结果是**直接下载好的 mp4 二进制**，通过 `create_blob_message()` 返回，**不是**一个
     指向 Google 侧的外部 URL（跟裸调用 REST API 拿到的 `video.uri` 不同——插件已经把文件转存成
     Dify 自己的 File）。
  3. `duration_seconds` 参数是 `select`，只有 `"4"` / `"6"` / `"8"` 三个选项——不是自由数字。
  4. 有 `proxy_url` 可选参数（格式 `http(s)://user:pass@ip:port`），本设计默认不接，见 §3。

## 2. 这份 DSL 的设计决策

因为找到了真实官方插件，Step 3 的分支走的是"使用 `tool` 节点 + 其真实 schema"，**没有**走
`http-request` + 手搓轮询 `loop` 节点那条路。这是关键设计取舍，解释一下为什么：

- **不需要自己实现 submit→poll→retrieve 的 loop 节点**——插件的 Python 实现（见 §1.2 第 1 点）
  已经把整个异步轮询封装在 tool 节点内部：从 Dify 图的视角看，这个 `tool` 节点就是一次
  "调用会阻塞到完成或抛错"的同步调用（最长约 10 分钟），不是一个需要 Dify 图自己感知中间状态的
  异步任务。所以本设计是线性的 5 节点直线图，没有 `loop`/`if-else` 分支。这不是偷懒，是
  证据支持的更优解——如果没找到真实插件、要手搓 `http-request`，那时候才需要 `loop` 节点。

- **图结构**：`开始(start)` → `准备 Veo 参数(code)` → `调用 Gemini Video（Veo 3.1）(tool)` →
  `解析生成结果(code)` → `结束(end)`。5 个节点，4 条边，纯线性无分支。

- **`开始` 节点变量**对齐上游输出字段名：`model`（text-input）、`duration_seconds`
  （number）、`final_prompt_wrapped`（paragraph），方便以后直接接在 `100x-prompt-compose`
  对应 Dify app 后面。

- **"准备 Veo 参数" code 节点存在的理由**：上游 `duration_seconds` 是连续数字（cap 8.0s，见
  `skills/100x-prompt-compose/profiles/veo.md`），但插件的真实参数是离散 `{4,6,8}` 三选一
  字符串——这是一个真实的 schema 不匹配，不是我编出来的步骤。读过 `veo.md` 后发现：这个
  skill 本身不做多 GU 切分，`duration_seconds` 在正常情况下**几乎总是精确等于 8.0**，所以这个
  "就近取整"逻辑在实际运行中几乎不会真正改变数值（8.0 本来就在 `{4,6,8}` 里，精确命中），
  只是给未来/边界情况留的防御性兜底。**额外风险点**：`veo.md` 的五段式结构里，Timing 段和
  定位段的文案是把 "8.0s" 硬编码进 prompt 正文的（例如 "generated duration: 8.0s"、"From
  {tail}s to 8.0s..."）。如果这个兜底逻辑真的触发（把非 8 的值 snap 成 4 或 6），
  `final_prompt_wrapped` 文本里的时间叙述和实际请求的 `duration_seconds` 就会对不上——本节点
  不会去改写 prompt 正文，这种不一致需要在上游（`100x-prompt-compose`）解决，不是这一层能兜住的。

- **`aspect_ratio` 硬编码为 `"9:16"`**：插件默认是 `"16:9"`（横屏），但面向 TikTok/UGC 竖屏视频场景，因此设定为 `"9:16"`。如果需要横屏可直接改这一个 `constant` 值。

- **`resolution` 保持插件默认 `"720p"`**：裸 REST 文档提到 "1080p/4k 时 durationSeconds 必须是
  `'8'`"，但插件自己的 Python 校验代码（`_valid_parameters`）**没有**在本地强制这条规则——如果
  真的传 `resolution=1080p` 且 `duration_seconds` 不是 8，很可能是 Google 后端直接拒绝，
  不是插件提前挡掉。保持 `720p` 是刻意绕开这个交互风险，不是随手选的。

- **`model` 常量选了 `"veo-3.1-generate-preview"`（标准版，不是 `-fast-`）**：上游输入仅传递通用值 `"veo"`，不区分标准/快速。标准版质量更高但更慢/更贵，快速版相反。这是我的默认判断，
  一行改 `tool_parameters.model.value` 就能切换。

- **没有加 `model != "veo"` 的校验分支**：上游契约已经保证只有 `category=="视频" &&
  model=="veo"` 时才会进到这个 app，本 app 直接对齐上游字段名以便串联，
  所以没有为一个理论上不会出现的输入加 `if-else` 校验分支——这属于没被要求的范围，加了反而
  是不必要的图复杂度。`model` 变量原样保留在 `开始` 节点里，只是为了接口对齐，节点内部不消费它。

## 3. Import 后用户需要做的事

1. **安装插件**：Dify Console → Plugins → Marketplace，搜索 "Gemini Video"（或直接用
   `langgenius/gemini_video`），安装。本 DSL 的顶层 `dependencies` 已经声明了
   `marketplace_plugin_unique_identifier`，正常情况下 Dify import 时会提示安装/复用，但如果
   目标工作区已有不同版本，可能需要手动重新选择插件版本。
2. **配置凭证**：Dify Console → Tools → Gemini Video → Authorize，填入一个 Gemini API Key
   （从 <https://aistudio.google.com/app/apikey> 获取）。这个 key **不在 DSL 文件里**，
   必须在目标工作区手动配置。
3. **如果 Dify 部署环境访问不了 Google API**（比如国内网络直连 Gemini API 不通）：插件本身
   支持一个可选 `proxy_url` 参数（见 §1.2 第 4 点），本 DSL 默认没有接这个参数。如果需要，
   在 `tool_parameters` 里加一项
   `proxy_url: {type: mixed, value: "{{#env.VEO_PROXY_URL#}}"}`，
   并在 `workflow.environment_variables` 里声明 `VEO_PROXY_URL`。未默认加上，因为网络代理需求属于按需开启的环境选项，不是默认假设。
4. **导入后打开 "调用 Gemini Video" 节点核对一次参数面板**：见 §4 第 1 条，
   `tool_configurations` vs `tool_parameters` 的归属没有拿到这个插件的真实导出文件做最终确认。

## 4. 没能在没有真实凭证/真实工作区的情况下验证的部分（如实列出，按风险从高到低）

1. **`tool_parameters` vs `tool_configurations` 的归属**——这是本设计里唯一的结构性不确定项。
   本仓库自己的参考资料里有两条互相打架的指引：`plugin-marketplace-tools.md` 给的"从源码推断"
   启发式说 `form: form` 的参数应该进 `tool_configurations`；但 `real-world-yml-study.md`
   基于真实导出文件研究后写的"Rule Corrections"明确说 "Do require ... `tool_parameters` ...
   for executable workflow tool nodes"。`gemini_video_general` 这个 tool 的 11 个参数**全部**
   是 `form: form`（没有一个 `form: llm`），两条指引在这个插件身上会给出不同答案。本设计选择
   遵循后者（真实导出证据）和 `node-schemas.md` 给出的标准 tool 节点模板，把所有绑定值放进
   `tool_parameters`。**如果导入 Dify 后节点参数显示为空或报错，最先检查的就是这里**——把
   `tool_parameters` 里的键值对整体挪到 `tool_configurations` 是最可能的修复方式。
   置信度：中等（有两份本地参考资料支持当前选择，但都不是这个插件本身的真实导出文件）。

2. **`tool` 节点 `files` 输出的具体字段名**——`解析生成结果` code 节点假设 Dify 把插件
   `create_blob_message()` 产出的文件包装成一个带 `url`（或 `remote_url`）键的 dict。这是按
   Dify 通用 File 变量约定推断的，**不是针对这个插件真实跑过一次拿到的实际 JSON**。如果字段名
   不对，`video_url` 会走到 "failed" 分支，`error_detail` 会提示去看原始 file 对象——这个降级
   路径是特意设计的，不会静默产出一个错的 URL。
   置信度：中等偏低。

3. **节点级错误处理（`error_strategy`/`default_value`）没有手写**——`official-0.6-target.md`
   证实 Dify 的节点通用元数据里确实存在 `error_strategy`、`retry_config`、`default_value`
   这几个字段名，但本地参考资料**没有给出它们的取值枚举或结构**（比如 `error_strategy` 到底
   填什么字符串）。没有真实导出样例的情况下手写这类字段风险很高，所以本设计**没有**加。
   **直接后果**：如果 "调用 Gemini Video" 节点抛错（比如插件的 `InvokeError`："prompt is
   required"、"video generation timeout after 10 minutes"、不支持的 model 等），**整个
   workflow run 会在 Dify 平台层面直接标记为失败**，不会优雅地流到 `解析生成结果` /
   `结束` 节点、也不会让 `结束` 节点的 `status` 字段显示 `"failed"`——错误信息只会出现在
   Dify 的运行日志/API 里，不会出现在本 app 的 `end` 输出里。在 "status: success/failed/pending + error detail" 接口契约中：`success` 路径和"工具节点
   执行成功但返回内容异常"这种"软失败"路径已经覆盖，但"工具节点本身抛异常"这种"硬失败"目前
   会绕过本 app 的错误输出契约。建议后续在真实工作区里对着这个节点用可视化编辑器配置一次
   "出错时"行为，让 Dify 自己生成正确的 `error_strategy` 语法，而不是我在这里手猜。

4. **`status` 的 `"pending"` 取值实际上不会出现**——因为异步轮询被插件完全封装在节点内部
   （§2），从 Dify 图的角度这个调用是"阻塞直到完成或抛错"，没有中间的"进行中"状态可以对外暴露。
   Schema 里保留了 `pending` 作为字段取值主要是为了契约完整性，并为将来可能改成
   fire-and-forget 模式留空间，正常运行不会走到这个值。

5. **Dify 平台自身的 workflow 执行超时上限**——没有验证 Dify（尤其是 Dify Cloud）对单次
   workflow run 的最长执行时间限制，是否小于插件自己的 10 分钟硬超时。如果平台超时更短
   （常见做法是几分钟），长尾的 Veo 生成请求可能被 Dify 自己先杀掉，比插件内部的
   "video generation timeout after 10 minutes" 更早触发一个不同形状的失败。这一点需要在目标
   Dify 实例上实际验证，本设计没有（也无法在没有真实工作区的情况下）确认。

6. **`tool_node_version: "2"`**——照抄了参考资料里其他插件真实导出的取值模式，没有专门确认过
   `gemini_video_general` 这个具体 tool 导出时是不是也是 `"2"`。风险低：
   `real-world-yml-study.md` 明确说这个字段"useful but not always present"，属于非关键字段。

7. **Vertex AI 路径完全没有独立验证**（见 §1.1 最后一条）——本设计没有用 Vertex AI，这一条
   不影响当前 DSL，只是如实记录"两条路径我只确认了一条"。

## 5. Validator 结果

```
python dify-workflow-dsl-skill/scripts/validate_dsl.py --strict --target-version 0.7.0 dify-apps/visual-generate-veo.dify.yml

== dify-apps\visual-generate-veo.dify.yml
OK
```

JSON 模式复核（`--format json`）：

```json
{
  "path": "dify-apps\\visual-generate-veo.dify.yml",
  "status": "valid",
  "summary": { "errors": 0, "warnings": 0 },
  "diagnostics": []
}
```

`--strict` 下 0 error / 0 warning，没有需要额外辩解的告警项。**但 §4 列的 7 条是验证器管不到的
语义/运行时风险**——validator 只能确认 YAML 结构合法、图连通、字段类型对，不能确认
"这个具体插件的这个具体参数真的会被 Dify 这样解析"，这部分只能靠真实 import 一次来最终坐实。
