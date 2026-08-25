# 100x-video-reverse · 来源与替换记录

## 当前方法

公开包 v2.0 使用本地 `100x-video-reverse` v0.1 方法契约，替代仓库初始提交中的旧版双轴提示词实现。当前方法由四部分组成：

1. FFmpeg／FFprobe 本地只读证据提取。
2. 完整视频、稠密帧和音轨联合的多模态语义校正。
3. 稳定资产 ID、一致性锚点和生成提示词包。
4. JSON Schema、媒体物化、源哈希和 provenance 严格验证。

## 候选方法与许可证边界

| 来源 | 固定版本 | 许可证／状态 | 采用内容 | 未采用内容 |
|---|---|---|---|---|
| `eternityspring/shuohao-skills` | `0e5eb688` | Apache-2.0 | 分镜 Schema、资产一致性和质量门思想 | 不复制整仓，不声称原仓能读取参考视频 |
| `dundunhan/dsh-video-lens` | `73c30` | MIT | 场景信号的诊断经验 | 不复制候选实现 |
| `MartinDelophy/ai-video-editor` | `5ab39` | MIT | 时间轴诊断经验 | 不以单样本结果替代跨视频稳定性 |
| `Jingyi-Wu-Richael/replicate-video-ad` | `e143d2a7` | 未声明 License | Hook、产品桥接、证明和 CTA 字段经验 | 不复制代码，低频采样不作默认方案 |
| `video-aroll-auto-editor` | `v1.0.3` | 许可证声明冲突 | 静音与转写可作为外围信号 | 不复制实现，不采用删减择优目标 |

候选仓库只提供抽象方法和失败经验。当前公开脚本为本项目实现，不复制许可证不明或目标相反的代码。

## 黄金基线边界

固定实验快照和升级门槛见 `references/golden-baseline.md`。其中的模型 ID、供应商能力和价格是历史证据，不代表当前可用性；每次外部调用前必须查官方模型列表和文档。

## 旧版退役

- 退役版本：`100x-video-reverse@1.0.0`
- 可恢复提交：`572acb755ea6868f9c9971809deafd09e72c8a37`
- 退役原因：旧版主要验证双语双轴提示词格式，没有建立当前必需的源文件指纹、完整证据包、交付媒体 provenance 和严格文件级验证。
- 兼容性：v2.0 输出契约与旧版不兼容。下游应读取 `references/output-contract.md`，不能继续依赖旧版 `visual_forms`、`slot_template` 或双语字段。

## 开源合规

本目录不包含真实视频、帧图、客户语料、账号名、产品名、飞书链接、API Key 或 `.env`。`evals/` 仅包含虚构结构样例。
