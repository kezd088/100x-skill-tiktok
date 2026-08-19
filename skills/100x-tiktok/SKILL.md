---
name: 100x-tiktok
description: TikTok/UGC 创意生产流水线总入口。双模式：任务前路由（你的问题该用哪个
  skill）+ 任务后导航（刚做完这一步，下一步该干什么）。触发方式：/100x-tiktok、
  /tiktok、「帮我看看这条 TikTok 怎么弄」、「做一条 TikTok 广告」、
  「TikTok 视频创意流水线」、「这条口播脚本下一步怎么改」。每个 skill
  独立可调用，本路由只是帮你选对入口。
metadata:
  author: 100x
  version: "1.0.0"
---

# 100x-tiktok · TikTok/UGC 创意流水线路由

## 一句话定位
TikTok/UGC 广告创意生产流水线的总路由。不代替任何 skill 的独立调用能力，只帮你
根据当前任务选对入口，或在拿到某个 skill 的产出后指出"下一步通常怎么做"。

## 模式一：任务前路由（先诊断再指路）

你说"我要做一条 TikTok 广告"→ 路由会诊断你当前手里有什么、缺什么，然后建议从
哪个 skill 开始。每个 skill 独立可调用，不需要按顺序——但如果你不知道从何下手，
路由帮你定位。

以下 8 个 skill 均已通过独立验证，注册于 `skills.json`：

| Skill | 步骤 | 一句话说明 | 典型触发场景 |
|---|---|---|---|
| `100x-video-reverse` | 0 视频反推 | 视频→（ffmpeg 抽帧）→复刻提示词（分镜时间轴+画面形态轴双轴）+变量化模板，中英双语 | "反推这条视频""这个视频怎么复刻""reverse this video" |
| `100x-segment` | 1 分段 | 口播脚本切三段：段落逻辑+镜头目的+气口标记 | "帮我分段""这段哪里该喘气""拆一下这条口播文案" |
| `100x-localize` | 2c 投放语本地化 | 源文案→墨西哥西语本地化，主动压缩防直译膨胀 | "本地化成西语""翻译成西语文案""localize this ad copy" |
| `100x-persona` | 3.1 人物×场景 | 脚本→"谁来讲"+"在哪拍"，逐字回指原文 | "给这条脚本配个人设""这条广告适合什么场景拍""who should deliver this script" |
| `100x-exaggerate` | 3.3 夸张/反差 | 脚本→夸张技法+反差对，强度按市场/帽度天花板校准 | "帮这条脚本加点夸张""怎么更抓人""add a before/after contrast" |
| `100x-search-query` | 3.4 搜索关键词 | 产品/人设→Pinterest/TikTok/Reddit 各 15 条英文搜索词 | "去哪找参考图""给我搜索关键词""find reference images" |
| `100x-visual-fission` | 5 视觉裂变 | 锁定人物/场景/产品参考→媒介裂变提示词矩阵（单帧/首尾/首中尾/数日×ABC机位） | "帮我裂变这条视觉参考""生成裂变提示词矩阵""fission this reference" |
| `100x-prompt-compose` | 6 提示词+模型 | 模板+变量→逐字渲染、按目标模型包装的最终生成提示词 | "帮我组装提示词""填个模板出提示词""选个模板配变量""compose a video prompt" |

## 模式二：任务后导航（刚做完 X，下一步做什么）

你刚跑完一个 skill，拿到了产出 → 路由告诉你典型的下一步。注意：这只是"推荐路线"，
不是强依赖——每个 skill 都独立可调，你随时可以从任意一个入口开始。

| 刚做完 | 典型下一步 | 说明 |
|---|---|---|
| `100x-video-reverse` | → `100x-visual-fission` 或 `100x-prompt-compose` | 反推出复刻提示词和变量化模板了，要么做视觉裂变出多版，要么直接组装提示词喂模型 |
| `100x-segment` | → `100x-persona` 或 `100x-localize` | 分好段了，要么配人物场景，要么直接本地化 |
| `100x-localize` | → `100x-exaggerate` | 西语文案有了，加夸张和反差让它不"平" |
| `100x-persona` | → `100x-search-query` 或 `100x-exaggerate` | 人设场景定了，可以搜视觉参考或设计夸张点 |
| `100x-exaggerate` | → `100x-visual-fission` 或 `100x-prompt-compose` | 夸张反差设计了，要么做视觉裂变出多版，要么直接组装提示词 |
| `100x-search-query` | → `100x-visual-fission` | 搜到参考图了，锁住身份做媒介裂变 |
| `100x-visual-fission` | → `100x-prompt-compose` | 裂变提示词矩阵有了，选模板+变量组装最终提示词喂模型 |
| `100x-prompt-compose` | （终点） | 提示词已组装好，可以直接喂 Veo/Seedance/即创 |

## 独立调用保证
以上 8 个 skill **每个都完全独立可调用**，不要求先跑别的。唯一例外是 `100x-video-reverse`
需要先跑本 skill 自己的 `scripts/extract-frames.mjs`（依赖 ffmpeg/ffprobe 把视频抽成帧图，
因为 agent 读不了 mp4）——这是它内部的两步流水线，不是要求先跑另一个 skill。路由只是帮你
选入口和指方向，不是前置条件。"先跑路由"不是必选项——你直接叫任何一个 skill 的名字或说
触发词，它都会被自动激活。

## 未建成 / 未通过验证的 skill 一律不在此列出
本路由只列真实存在、已通过独立验证的 skill。路线图里剩余的规划名额，建成后才会加到这里。

## 来源
本文件为流水线路由入口文件。skill 列表和触发词提取自各 skill
的 `SKILL.md` 和 `metadata.json`，均在本仓内。
