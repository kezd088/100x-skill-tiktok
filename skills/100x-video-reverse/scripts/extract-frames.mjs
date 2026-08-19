#!/usr/bin/env node
/**
 * 100x-video-reverse · extract-frames
 *
 * WHY THIS FILE EXISTS:
 * Claude / Codex 这类 agent 读不了 mp4，只能读图片。整条 100x-video-reverse 链路能不能
 * 成立，取决于这一步能不能把「视频」可靠地转成「关键帧 PNG + 结构化元数据」——这是整个
 * skill 的地基，不是普通的辅助脚本。下游 agent（做反推）和 scripts/validate.js（管产物
 * 一致性，见 axioms.md 公理 1）都直接依赖这里产出的 meta.json 形状。
 *
 * PIPELINE（三个独立的 ffmpeg/ffprobe 调用阶段，故意不合并成一次调用）：
 *   1. probeVideo()      -- ffprobe 读 duration/width/height/fps/has_audio，做时长硬闸。
 *   2. detectSceneCuts() -- ffmpeg 单次线性解码，用 `select='gt(scene,T)'` 配合
 *                           `metadata=mode=print:file=-` 把每个切点的 pts_time 和
 *                           scene_score 打到 stdout（输出至 stdout，见下方 parseSceneMetadataOutput 的注释）。
 *   3. extractFrameAt()  -- 对第 2 步 + 本地补帧/裁剪算法算出的每个最终时间戳，各起一次
 *                           `-ss <t> -i <video> -frames:v 1` 精确单帧抽取。
 * 3 是故意跟 2 分开的：2 只解码一遍拿时间戳/分数（便宜），3 只对「最终真正要保留」的时间戳
 * 精确抽帧（帧数上限 30，起 30 次 ffmpeg 子进程完全负担得起）。如果把选帧规则也塞进一次
 * ffmpeg 调用（靠 select 直接吐 PNG），就得让 JS 里的 min-frames 补帧 / max-frames 裁剪
 * 逻辑去猜 ffmpeg 内部输出文件序号和我们时间戳排序的对应关系，脆弱且难调试。

 * KEY DESIGN DECISIONS:
 *   - 选帧算法（selectFrames）是纯函数，不碰文件系统、不调 ffmpeg——所以 --selftest 里
 *     一部分回归用例可以直接喂假的候选时间戳数组，不用真的合成视频就把边界条件测干净。
 *   - 时长上限判断（checkDurationLimit）也是纯函数，同样为了不用真的去合成一段 >180s
 *     的视频就能单测这条硬闸（axioms.md 公理 1 明确点名的第一道闸）。
 *   - 所有时间戳落盘前先四舍五入到 2 位小数（roundTo），再从这个已经四舍五入过的值分别
 *     派生文件名字符串和 JSON 数值字段——保证两者永远打印出同一个数，不会出现文件名写
 *     t2.00 但 meta.json 里是 1.9999999 这种漂移。
 *   - dedupeByTime 用 0.1s 容差合并"事实上是同一帧"的候选时间戳：0.1s 比 2 位小数的四舍
 *     五入粒度(0.01s)大一个数量级，所以顺带也从根上保证了四舍五入后不会撞文件名。
 *
 * USAGE:
 *   node scripts/extract-frames.mjs <video-path-or-url> [--out <dir>] [--threshold 0.3]
 *                                    [--max-frames 30] [--min-frames 3] [--force]
 *   node scripts/extract-frames.mjs --selftest
 *
 * EXIT CODES（axioms.md 公理 1 钉死的部分不能改）：
 *   0 = 成功
 *   1 = 视频不存在 / ffprobe 读不出时长 / 输出目录已存在且未加 --force / 抽帧失败 / 参数不合法
 *   2 = 时长 > 180.0 秒（公理 1 的硬性上限，独立 exit code，方便调用方精确区分"到底是哪类失败"）
 *
 * DEPENDENCIES: 零第三方依赖，只用 node 内置模块 + 系统里的 ffmpeg / ffprobe 可执行文件。
 * 本脚本只使用基础能力（-print_format json / select scene 检测 / -ss 精确单帧抽取），保持高兼容性。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- 常量 --------------------------------------------------------------------
const MAX_DURATION_SEC = 180; // axioms.md 公理 1：超过这个数直接拒绝，不降级
// 两个时间戳之间小于这个秒数就视为"事实上是同一帧"，见文件头 KEY DESIGN DECISIONS。
const DEDUPE_EPS_SEC = 0.1;

class ExtractionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

// ---- 纯函数：不碰文件系统、不调 ffmpeg，方便 --selftest 直接单测 --------------

// axioms.md 公理 1 的判断本体。独立成纯函数是为了 selftest 不用真的合成一段
// 超过 180 秒的视频（那样既慢又没有额外把握——判断逻辑本身跟"怎么拿到这个数字"无关）。
function checkDurationLimit(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { ok: false, code: 1, message: `视频时长无效或读取失败（duration_sec=${durationSec}）` };
  }
  if (durationSec > MAX_DURATION_SEC) {
    return {
      ok: false,
      code: 2,
      message: `视频总时长 ${durationSec.toFixed(1)}s 超过 100x-video-reverse 的硬性上限 `
        + `${MAX_DURATION_SEC}s（axioms.md 公理 1：超过 ${MAX_DURATION_SEC} 秒的视频直接拒绝，`
        + `不降级处理）。请先剪短或截取片段后重试。`,
    };
  }
  return { ok: true, code: 0, message: '' };
}

function roundTo(x, decimals) {
  return Number(x.toFixed(decimals));
}

// ffprobe 的 r_frame_rate / avg_frame_rate 是 "N/D" 形式的字符串（例如 "30000/1001"），
// D 为 0 时代表 ffprobe 自己也没能确定帧率（常见于非视频流），此时返回 null 而不是 Infinity/NaN。
function parseFrameRateString(s) {
  if (!s || typeof s !== 'string') return null;
  const parts = s.split('/');
  if (parts.length !== 2) return null;
  const n = Number(parts[0]);
  const d = Number(parts[1]);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

// 宽高比归一到常见预设值。用浮点容差比较而不是 gcd 化简分数，是因为真实视频经常因为
// 编码器的 16 像素对齐（例如 1088x1920）导致像素级宽高比不是整数简化比，但创作意图明显
// 就是 9:16——容差匹配能兼顾这种情况；死磕 gcd 简化分数反而会把 1088:1920 算成 17:30 这种
// 谁都认不出来的比例。算不出常见预设时，按需求给出 "WxH" 原始像素尺寸字符串兜底。
function computeAspectRatio(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return `${width}x${height}`;
  }
  const ratio = width / height;
  const KNOWN_RATIOS = [
    ['9:16', 9 / 16],
    ['16:9', 16 / 9],
    ['1:1', 1],
    ['4:5', 4 / 5],
  ];
  const TOLERANCE = 0.02; // 2% 相对误差，足够吃掉编码对齐造成的像素级偏差，又不会跨界误判
  for (const [label, target] of KNOWN_RATIOS) {
    if (Math.abs(ratio - target) / target <= TOLERANCE) return label;
  }
  return `${width}x${height}`;
}

// 把时间戳靠得太近（< eps 秒）的候选帧合并成一个，保留 scene_score 更高的那个。
// 双重目的：(1) 避免视觉上几乎相同的两帧都占用抽帧配额；(2) 从根源上保证时间戳四舍五入
// 到 2 位小数后不会撞文件名——eps 比舍入粒度(0.01s)大一个数量级，两两之间留出的安全余量
// 足以吸收舍入误差。
function dedupeByTime(frames, eps) {
  const sorted = frames.slice().sort((a, b) => a.timestamp_sec - b.timestamp_sec);
  const out = [];
  for (const f of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(f.timestamp_sec - last.timestamp_sec) < eps) {
      if ((f.scene_score ?? 0) > (last.scene_score ?? 0)) out[out.length - 1] = f;
      continue;
    }
    out.push(f);
  }
  return out;
}

// 核心选帧规则。纯函数：candidates 是场景检测已经找到的
// 候选切点（可能是空数组——一段没有硬切镜的视频完全合法），不包含强制首帧。
function selectFrames(candidates, durationSec, minFrames, maxFrames) {
  // 场景检测算法本身不会把开头当切点（没有"上一帧"可比较），所以候选里理论上不会出现
  // t≈0 的条目；这里的过滤是防御性的——万一某个 ffmpeg 版本行为不同，也不会跟下面强制
  // 写入的首帧重复。
  const cleanedCandidates = dedupeByTime(
    candidates.filter((c) => c.timestamp_sec > DEDUPE_EPS_SEC),
    DEDUPE_EPS_SEC
  );
  const detectedCuts = cleanedCandidates.length;

  // 第 1 帧永远强制抽 t=0.0——场景检测不会把开头当切点，但反推任务离不开开场画面。
  let frames = [{ timestamp_sec: 0, scene_score: null }, ...cleanedCandidates];
  let method = 'scene-detect';

  if (frames.length < minFrames) {
    // 兜底 A：切点（含强制首帧）不够，按等间隔补抽到 min-frames。
    method = 'scene-detect+interval-fill';
    for (let i = 0; i < minFrames && frames.length < minFrames; i++) {
      const t = (durationSec * i) / minFrames;
      const tooClose = frames.some((f) => Math.abs(f.timestamp_sec - t) < DEDUPE_EPS_SEC);
      if (!tooClose) frames.push({ timestamp_sec: t, scene_score: null });
    }
    // 极短视频 + 很大的 min-frames 组合下，等间隔候选可能彼此之间也小于 eps，上面的
    // tooClose 检查已经在循环内实时防住了这种情况（frames 是共享引用，每轮都看得到前面
    // 新加的点）；这里再跑一次纯粹是保险，不会改变结果。
    frames = dedupeByTime(frames, DEDUPE_EPS_SEC);
  } else if (frames.length > maxFrames) {
    // 兜底 B：切点太多，强制首帧必须保留，剩余名额按 scene_score 降序取，取完再按时间戳
    // 重新升序排列。detected_cuts 见下方 return，如实记录原始检测数，不静默丢帧。
    method = 'scene-detect+top-n';
    const forced = frames[0];
    const rest = frames.slice(1);
    const keepCount = maxFrames - 1;
    const topByScore = rest
      .slice()
      .sort((a, b) => (b.scene_score ?? 0) - (a.scene_score ?? 0))
      .slice(0, keepCount);
    frames = dedupeByTime([forced, ...topByScore], DEDUPE_EPS_SEC);
  } else {
    frames = dedupeByTime(frames, DEDUPE_EPS_SEC);
  }

  frames = frames
    .map((f) => ({ ...f, timestamp_sec: roundTo(f.timestamp_sec, 2) }))
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec)
    .map((f, i) => ({ ...f, index: i + 1 }));

  return { frames, method, detectedCuts, finalFrameCount: frames.length };
}

function frameFileName(index, timestampSec) {
  // timestampSec 进来之前已经在 selectFrames 里 roundTo(2) 过，这里的 toFixed(2) 是
  // 幂等操作——保证文件名字符串和 meta.json 里的数值字段永远打印同一个数。
  return `frame_${String(index).padStart(3, '0')}_t${timestampSec.toFixed(2)}.png`;
}

// 从视频路径/URL 推导默认输出目录名（frames-<stem>/）。URL 场景没有本地文件名可用，
// 从 pathname 的最后一段拿；实在解析不出来就退到通用的 "video"，不让脚本因为一个古怪
// URL 直接崩掉。
function stemOf(videoArg) {
  if (/^https?:\/\//i.test(videoArg)) {
    try {
      const u = new URL(videoArg);
      const base = path.posix.basename(u.pathname || '');
      const stem = base.replace(/\.[a-zA-Z0-9]+$/, '');
      return stem || 'video';
    } catch {
      return 'video';
    }
  }
  const stem = path.parse(videoArg).name;
  return stem || 'video';
}

// ---- I/O：实际调 ffprobe / ffmpeg 的部分 --------------------------------------

function probeVideo(videoPath) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', videoPath],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 32 * 1024 * 1024 }
  );
  if (r.error) {
    // r.error 多半是 ENOENT——系统里根本找不到 ffprobe 可执行文件，这跟"视频文件本身
    // 有问题"是两类完全不同的故障，分开说明方便定位到底该修 PATH 还是该换视频。
    throw new ExtractionError(1, `无法启动 ffprobe（${r.error.code || r.error.message}）：请确认 ffprobe 已安装并在 PATH 中`);
  }
  if (r.status !== 0) {
    throw new ExtractionError(1, `ffprobe 读取视频失败（exit ${r.status}）：${(r.stderr || '').trim() || '(无 stderr 输出)'}`);
  }
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch (e) {
    throw new ExtractionError(1, `ffprobe 输出不是合法 JSON：${e.message}`);
  }

  // -print_format json 下 format.duration 是字符串
  // （如 "34.600000"），不是 JSON 数字，必须 parseFloat；width/height 一般已经是数字，
  // 但这里仍统一走 Number() 显式转换，不假设上游类型。
  const durationSec = parseFloat(data.format && data.format.duration);
  if (!Number.isFinite(durationSec)) {
    throw new ExtractionError(1, `ffprobe 未能读出视频时长（format.duration=${data.format && data.format.duration}）`);
  }

  const streams = data.streams || [];
  // 优先排除封面缩略图轨（disposition.attached_pic === 1）：有些容器格式会把封面图
  // 也编码成一条极短的"视频流"，直接拿 streams 里第一条 video 类型的话可能会拿到封面图
  // 而不是正片。
  const videoStream =
    streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic === 1)) ||
    streams.find((s) => s.codec_type === 'video');
  if (!videoStream) {
    throw new ExtractionError(1, '未检测到视频轨（streams 中没有 codec_type=video），这可能不是有效的视频文件');
  }

  const width = Number(videoStream.width);
  const height = Number(videoStream.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ExtractionError(1, `无法读取视频宽高（width=${videoStream.width}, height=${videoStream.height}）`);
  }

  const fpsRaw = parseFrameRateString(videoStream.avg_frame_rate) ?? parseFrameRateString(videoStream.r_frame_rate);
  const fps = fpsRaw === null ? null : roundTo(fpsRaw, 3);
  const hasAudio = streams.some((s) => s.codec_type === 'audio');

  return { durationSec, width, height, fps, hasAudio };
}

// 用 select+metadata 一次线性解码拿到所有场景切点的 pts_time 和 scene_score。
//
// `showinfo` 过滤器本身不会打印 lavfi.scene_score——select 过滤器算出的场景分数确实以帧
// metadata 形式挂在了 lavfi.scene_score 键上，但 showinfo 不打印任意 metadata 键，
// 只打印它自己固定的那些字段。换成 `metadata=mode=print:file=-` 后行为确认：
//   - 该组合把结果打到 **stdout**，不是 stderr（这点容易搞错，因为 ffmpeg 几乎所有别的
//     日志都在 stderr）。
//   - 每个被 select 选中的帧固定打印两行：
//       frame:0    pts:20480   pts_time:2
//       lavfi.scene_score=0.400000
//   - 视频开头那一帧永远不会被 select 选中（没有"上一帧"可比较场景差异）。
// 以上行为用一段自制的红/蓝/绿硬切测试视频验证过：检测到的两个切点 pts_time 分别
// 精确落在颜色分段的边界上，且用逐像素抽帧核对过颜色确实对应正确的分段。
function detectSceneCuts(videoPath, threshold) {
  const filter = `select='gt(scene,${threshold})',metadata=mode=print:file=-`;
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', videoPath, '-vf', filter, '-an', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 32 * 1024 * 1024 }
  );
  if (r.error) {
    throw new ExtractionError(1, `无法启动 ffmpeg（${r.error.code || r.error.message}）：请确认 ffmpeg 已安装并在 PATH 中`);
  }
  if (r.status !== 0) {
    throw new ExtractionError(1, `ffmpeg 场景检测失败（exit ${r.status}）：${(r.stderr || '').trim() || '(无 stderr 输出)'}`);
  }
  return parseSceneMetadataOutput(r.stdout);
}

// 只挑 "frame:N ... pts_time:T" 和紧随其后的 "lavfi.scene_score=S" 这两类行，
// 其余潜在的 metadata key（未来 ffmpeg 版本可能多打印别的字段）一律忽略，避免解析报错。
function parseSceneMetadataOutput(stdout) {
  const lines = stdout.split(/\r?\n/);
  const results = [];
  let pending = null;
  for (const line of lines) {
    const frameMatch = /^frame:\d+\s+pts:-?\d+\s+pts_time:(-?[\d.]+)/.exec(line);
    if (frameMatch) {
      if (pending) results.push(pending); // 极端情况下没等到 scene_score 就来了下一帧，保底不丢时间戳
      pending = { timestamp_sec: parseFloat(frameMatch[1]), scene_score: null };
      continue;
    }
    const scoreMatch = /^lavfi\.scene_score=([\d.]+)/.exec(line);
    if (scoreMatch && pending) {
      pending.scene_score = parseFloat(scoreMatch[1]);
      results.push(pending);
      pending = null;
    }
  }
  if (pending) results.push(pending);
  return results;
}

// 对单个时间戳做精确单帧抽取。用 -ss 放在 -i 之前做输入侧快速寻址（既快又帧级精确，
// 内部会先跳到最近关键帧再解码到目标帧）。
function extractFrameAt(videoPath, timestampSec, outPath) {
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(timestampSec), '-i', videoPath, '-frames:v', '1', '-an', outPath],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 32 * 1024 * 1024 }
  );
  if (r.error) {
    throw new ExtractionError(1, `无法启动 ffmpeg 抽帧（${r.error.code || r.error.message}）`);
  }
  if (r.status !== 0 || !fs.existsSync(outPath)) {
    throw new ExtractionError(1, `抽帧失败 t=${timestampSec}s -> ${outPath}（exit ${r.status}）：${(r.stderr || '').trim() || '(无 stderr 输出)'}`);
  }
}

// ---- 主流程：串起上面所有部分，main() 和 selftest() 都直接调这个函数 ------------
// 之所以单独成一个不碰 console/process.exit 的函数：selftest 需要在同一进程里反复调用
// 它并检查返回值/捕获异常，不想每个用例都真的 fork 一个子进程去跑 CLI。
function runExtraction(opts) {
  const { video, out, threshold, maxFrames, minFrames, force } = opts;

  const isUrl = /^https?:\/\//i.test(video);
  if (!isUrl && !fs.existsSync(video)) {
    throw new ExtractionError(1, `视频文件不存在：${video}`);
  }

  const probe = probeVideo(video);

  // axioms.md 公理 1 的硬闸：必须在创建任何输出、抽任何帧之前判断，超限时"不产出任何帧"。
  const durationCheck = checkDurationLimit(probe.durationSec);
  if (!durationCheck.ok) {
    throw new ExtractionError(durationCheck.code, durationCheck.message);
  }

  const outDir = out ? path.resolve(process.cwd(), out) : path.resolve(process.cwd(), `frames-${stemOf(video)}`);
  if (fs.existsSync(outDir) && !force) {
    throw new ExtractionError(1, `输出目录已存在：${outDir}（不会静默覆盖，加 --force 允许写入已存在目录）`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const candidates = detectSceneCuts(video, threshold);
  const selection = selectFrames(candidates, probe.durationSec, minFrames, maxFrames);

  selection.frames.forEach((f) => {
    f.file = frameFileName(f.index, f.timestamp_sec);
    extractFrameAt(video, f.timestamp_sec, path.join(outDir, f.file));
  });

  const meta = {
    source: video,
    duration_sec: roundTo(probe.durationSec, 2),
    fps: probe.fps,
    width: probe.width,
    height: probe.height,
    aspect_ratio: computeAspectRatio(probe.width, probe.height),
    has_audio: probe.hasAudio,
    frames: selection.frames.map((f) => ({
      index: f.index,
      timestamp_sec: f.timestamp_sec,
      file: f.file,
      scene_score: f.scene_score === null ? null : roundTo(f.scene_score, 3),
    })),
    extraction: {
      method: selection.method,
      threshold,
      detected_cuts: selection.detectedCuts,
      final_frame_count: selection.finalFrameCount,
    },
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  return { outDir, finalFrameCount: selection.finalFrameCount, durationSec: meta.duration_sec, meta };
}

// ---- CLI 参数解析 --------------------------------------------------------------
function parseCliArgs(argv) {
  const positional = [];
  const opts = { out: null, threshold: 0.3, maxFrames: 30, minFrames: 3, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      opts.out = argv[++i];
    } else if (a === '--threshold') {
      opts.threshold = Number(argv[++i]);
    } else if (a === '--max-frames') {
      opts.maxFrames = Number(argv[++i]);
    } else if (a === '--min-frames') {
      opts.minFrames = Number(argv[++i]);
    } else if (a === '--force') {
      opts.force = true;
    } else if (a.startsWith('--')) {
      throw new ExtractionError(1, `未知参数：${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) {
    throw new ExtractionError(1, '缺少视频路径/URL 参数');
  }
  opts.video = positional[0];

  if (!Number.isFinite(opts.threshold) || opts.threshold < 0) {
    throw new ExtractionError(1, `--threshold 必须是 >=0 的数字`);
  }
  if (!Number.isInteger(opts.maxFrames) || opts.maxFrames < 1) {
    throw new ExtractionError(1, `--max-frames 必须是 >=1 的整数`);
  }
  if (!Number.isInteger(opts.minFrames) || opts.minFrames < 1) {
    throw new ExtractionError(1, `--min-frames 必须是 >=1 的整数`);
  }
  if (opts.minFrames > opts.maxFrames) {
    throw new ExtractionError(1, `--min-frames (${opts.minFrames}) 不能大于 --max-frames (${opts.maxFrames})`);
  }
  return opts;
}

// ---- --selftest ----------------------------------------------------------------
// 不需要真实素材：用 ffmpeg lavfi 合成测试视频。分三种夹具，分别撞开三条不同的代码路径：
//   - cuts   ：8 段纯色硬切（7 个真实切点）——验证真实场景检测 + max-frames 裁剪路径。
//   - solid  ：全程纯色、零切点——验证 min-frames 补帧路径（必然触发，不依赖 ffmpeg 版本行为）。
//   - testsrc：标准测试源命令——冒烟测一遍调用流程。
// 时长超限（公理 1 的 exit 2）通过直接单测判断函数验证（见下方 checkDurationLimit
// 的独立测例），保证测试高效稳定。
function selftest() {
  let allOk = true;
  let n = 0;

  function check(label, ok, detail) {
    n++;
    if (ok) {
      console.log(`SELFTEST PASS (${n} ${label})`);
    } else {
      console.log(`SELFTEST FAIL (${n} ${label})`);
      if (detail) console.log('  - ' + String(detail));
      allOk = false;
    }
  }

  function isAscending(arr) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < arr[i - 1]) return false;
    }
    return true;
  }

  // ---- 纯函数单测：checkDurationLimit（公理 1，不合成超限视频，直接测判断函数本体）----
  {
    const r = checkDurationLimit(181);
    check('checkDurationLimit(181) 超过 180s 上限 -> exit 2', r.ok === false && r.code === 2, JSON.stringify(r));
  }
  {
    const r = checkDurationLimit(180);
    check('checkDurationLimit(180) 恰好等于上限 -> 允许（公理是"超过"不是"达到"）', r.ok === true, JSON.stringify(r));
  }
  {
    const r = checkDurationLimit(34.6);
    check('checkDurationLimit(34.6) 正常时长 -> 允许', r.ok === true, JSON.stringify(r));
  }
  {
    const r = checkDurationLimit(0);
    check('checkDurationLimit(0) 零时长 -> exit 1', r.ok === false && r.code === 1, JSON.stringify(r));
  }
  {
    const r = checkDurationLimit(-5);
    check('checkDurationLimit(-5) 负时长 -> exit 1', r.ok === false && r.code === 1, JSON.stringify(r));
  }
  {
    const r = checkDurationLimit(NaN);
    check('checkDurationLimit(NaN) 无法读取时长 -> exit 1', r.ok === false && r.code === 1, JSON.stringify(r));
  }

  // ---- 纯函数单测：computeAspectRatio ----
  {
    const cases = [
      [1080, 1920, '9:16'],
      [1920, 1080, '16:9'],
      [1000, 1000, '1:1'],
      [864, 1080, '4:5'],
      [320, 240, '320x240'], // 4:3 不在常见预设集合里，应当退回原始像素尺寸字符串
    ];
    cases.forEach(([w, h, expected]) => {
      const got = computeAspectRatio(w, h);
      check(`computeAspectRatio(${w},${h}) -> ${expected}`, got === expected, `got=${got}`);
    });
  }

  // ---- 纯函数单测：parseFrameRateString ----
  {
    check('parseFrameRateString("30/1") -> 30', parseFrameRateString('30/1') === 30);
    const ntsc = parseFrameRateString('30000/1001');
    check('parseFrameRateString("30000/1001") 约等于 29.97', Math.abs(ntsc - 29.9700) < 0.001, `got=${ntsc}`);
    check('parseFrameRateString("0/0") -> null（无法确定帧率）', parseFrameRateString('0/0') === null);
    check('parseFrameRateString(undefined) -> null', parseFrameRateString(undefined) === null);
  }

  // ---- 纯函数单测：selectFrames（不调 ffmpeg，直接喂假的候选时间戳数组）----
  {
    // 0 个候选切点 + min-frames=3 -> 必须触发 interval-fill，最终凑够 3 帧且首帧强制 t=0。
    const r = selectFrames([], 9.0, 3, 30);
    check(
      'selectFrames: 0 候选 + min=3 -> scene-detect+interval-fill 且凑满 3 帧',
      r.method === 'scene-detect+interval-fill' && r.frames.length === 3 && r.frames[0].timestamp_sec === 0,
      JSON.stringify(r)
    );
  }
  {
    // 40 个人工候选（分数依次递减）+ max-frames=10 -> 必须触发 top-n，且保留的是分数最高的
    // 9 个（另 1 个名额留给强制首帧），裁剪后必须重新按时间戳升序排列。
    const candidates = Array.from({ length: 40 }, (_, i) => ({
      timestamp_sec: 1 + i * 0.5,
      scene_score: 1 - i * 0.01, // 时间越靠后分数越低，方便断言"保留的确实是分数最高的那批"
    }));
    const r = selectFrames(candidates, 25, 3, 10);
    // selectFrames 本身不四舍五入 scene_score（那是 runExtraction 写 meta.json 前才做的事），
    // 这里用 roundTo 只是为了让比较不被 `1 - 7*0.01` 这类二进制浮点数表示误差干扰
    // （例如算出 0.9299999999999999 而不是数学上的 0.93）——算法本身选中的候选是对的，
    // 只是原始 JS 浮点数精度不适合直接做字符串级相等比较。
    const scoresKept = r.frames.filter((f) => f.scene_score !== null).map((f) => roundTo(f.scene_score, 3));
    const expectedTopScores = candidates.slice(0, 9).map((c) => roundTo(c.scene_score, 3)).sort((a, b) => b - a);
    check(
      'selectFrames: 40 候选 + max=10 -> scene-detect+top-n 且总数=10',
      r.method === 'scene-detect+top-n' && r.frames.length === 10,
      JSON.stringify({ method: r.method, count: r.frames.length })
    );
    check(
      'selectFrames: top-n 裁剪后 frames 按 timestamp_sec 严格升序',
      isAscending(r.frames.map((f) => f.timestamp_sec)),
      JSON.stringify(r.frames.map((f) => f.timestamp_sec))
    );
    check(
      'selectFrames: top-n 保留的确实是分数最高的候选（不是随便丢的）',
      JSON.stringify(scoresKept.sort((a, b) => b - a)) === JSON.stringify(expectedTopScores),
      `kept=${JSON.stringify(scoresKept)} expected=${JSON.stringify(expectedTopScores)}`
    );
    check('selectFrames: detected_cuts 如实记录原始候选数（不因为裁剪就改写）', r.detectedCuts === 40, `detectedCuts=${r.detectedCuts}`);
  }
  {
    // 候选数刚好落在 [min,max] 区间内 -> 不补不裁，方法标记为纯 scene-detect。
    const candidates = [{ timestamp_sec: 3, scene_score: 0.5 }, { timestamp_sec: 6, scene_score: 0.6 }];
    const r = selectFrames(candidates, 9, 2, 10);
    check(
      'selectFrames: 候选数在 [min,max] 区间内 -> 纯 scene-detect，不补不裁',
      r.method === 'scene-detect' && r.frames.length === 3,
      JSON.stringify(r)
    );
  }

  // ---- CLI 参数校验单测 ----
  {
    let threw = false;
    try {
      parseCliArgs(['--min-frames', '10', '--max-frames', '5', 'somefile.mp4']);
    } catch (e) {
      threw = e instanceof ExtractionError && e.code === 1;
    }
    check('parseCliArgs: --min-frames > --max-frames 时报错', threw);
  }
  {
    let threw = false;
    try {
      parseCliArgs(['--out', 'x']);
    } catch (e) {
      threw = e instanceof ExtractionError && e.code === 1;
    }
    check('parseCliArgs: 缺少视频位置参数时报错', threw);
  }

  // ---- 端到端：真的合成视频、真的调 ffmpeg/ffprobe、真的抽帧落盘 ----
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-frames-selftest-'));
  try {
    function ffmpegBuildFixture(filterArgs, outPath) {
      const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...filterArgs, outPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000,
      });
      if (r.error || r.status !== 0) {
        throw new Error(`构造 selftest 测试视频失败：${outPath}：${r.error ? r.error.message : (r.stderr || '').trim()}`);
      }
    }

    // 8 段纯色硬切，每段 1.2s，共 9.6s，制造 7 个真实场景切点。
    function buildCutsFixture(outPath) {
      const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan', 'orange', 'white'];
      const inputs = [];
      colors.forEach((c) => inputs.push('-f', 'lavfi', '-i', `color=c=${c}:size=320x240:duration=1.2:rate=10`));
      const filter = `${colors.map((_, i) => `[${i}:v]`).join('')}concat=n=${colors.length}:v=1:a=0[outv]`;
      ffmpegBuildFixture([...inputs, '-filter_complex', filter, '-map', '[outv]', '-pix_fmt', 'yuv420p'], outPath);
    }

    function buildSolidFixture(outPath) {
      ffmpegBuildFixture(['-f', 'lavfi', '-i', 'color=c=gray:size=320x240:duration=6:rate=10'], outPath);
    }

    // 标准 testsrc 测试夹具。
    function buildTestsrcFixture(outPath) {
      ffmpegBuildFixture(['-f', 'lavfi', '-i', 'testsrc=duration=5:size=320x240:rate=10'], outPath);
    }

    // -- 夹具 1：多硬切视频 -> 验证真实场景检测 + max-frames 裁剪路径 --
    {
      const cutsVideo = path.join(workDir, 'cuts.mp4');
      buildCutsFixture(cutsVideo);
      const result = runExtraction({
        video: cutsVideo,
        out: path.join(workDir, 'out-cuts'),
        threshold: 0.3,
        maxFrames: 4,
        minFrames: 3,
        force: false,
      });
      const meta = result.meta;
      check('端到端·多硬切：方法标记为 scene-detect+top-n', meta.extraction.method === 'scene-detect+top-n', `method=${meta.extraction.method}`);
      check('端到端·多硬切：输出帧数等于 max-frames', meta.frames.length === 4, `frames.length=${meta.frames.length}`);
      check(
        '端到端·多硬切：detected_cuts 如实记录且不小于裁剪后名额',
        meta.extraction.detected_cuts >= meta.frames.length - 1,
        `detected_cuts=${meta.extraction.detected_cuts}`
      );
      check(
        '端到端·多硬切：frames 按 timestamp_sec 升序',
        isAscending(meta.frames.map((f) => f.timestamp_sec)),
        JSON.stringify(meta.frames.map((f) => f.timestamp_sec))
      );
      check('端到端·多硬切：第 1 帧强制是 t=0.0', meta.frames[0].timestamp_sec === 0, `frames[0]=${JSON.stringify(meta.frames[0])}`);
      const allFilesExist = meta.frames.every((f) => {
        const p = path.join(result.outDir, f.file);
        return fs.existsSync(p) && fs.statSync(p).size > 0;
      });
      check('端到端·多硬切：每个帧文件都真实生成且非空', allFilesExist);
      const namesMatchPattern = meta.frames.every((f) => /^frame_\d{3}_t\d+\.\d{2}\.png$/.test(f.file));
      check('端到端·多硬切：文件名格式符合 frame_<3位序号>_t<2位小数>.png', namesMatchPattern, JSON.stringify(meta.frames.map((f) => f.file)));
      let metaReparsed = null;
      try {
        metaReparsed = JSON.parse(fs.readFileSync(path.join(result.outDir, 'meta.json'), 'utf8'));
      } catch { /* metaReparsed 保持 null，下面的断言会失败 */ }
      check('端到端·多硬切：meta.json 落盘且能重新解析', metaReparsed !== null && metaReparsed.frames.length === meta.frames.length);
    }

    // -- 夹具 2：全程纯色、零切点 -> 验证 min-frames 补帧路径 --
    {
      const solidVideo = path.join(workDir, 'solid.mp4');
      buildSolidFixture(solidVideo);
      const result = runExtraction({
        video: solidVideo,
        out: path.join(workDir, 'out-solid'),
        threshold: 0.3,
        maxFrames: 30,
        minFrames: 3,
        force: false,
      });
      const meta = result.meta;
      check('端到端·纯色无切点：方法标记为 scene-detect+interval-fill', meta.extraction.method === 'scene-detect+interval-fill', `method=${meta.extraction.method}`);
      check('端到端·纯色无切点：detected_cuts 为 0', meta.extraction.detected_cuts === 0, `detected_cuts=${meta.extraction.detected_cuts}`);
      check('端到端·纯色无切点：补帧后达到 min-frames', meta.frames.length === 3, `frames.length=${meta.frames.length}`);
    }

    // -- 夹具 3：标准 testsrc 命令 -> 冒烟测整条链路 + 目录已存在/--force 行为 --
    {
      const testsrcVideo = path.join(workDir, 'testsrc.mp4');
      buildTestsrcFixture(testsrcVideo);
      const outDir = path.join(workDir, 'out-testsrc');
      const result = runExtraction({ video: testsrcVideo, out: outDir, threshold: 0.3, maxFrames: 30, minFrames: 3, force: false });
      check('端到端·testsrc 冒烟：能完整跑通并产出 >=1 帧', result.meta.frames.length >= 1, `frames.length=${result.meta.frames.length}`);
      const meta = result.meta;
      const fieldsOk =
        typeof meta.duration_sec === 'number' &&
        typeof meta.width === 'number' &&
        typeof meta.height === 'number' &&
        typeof meta.has_audio === 'boolean' &&
        typeof meta.aspect_ratio === 'string' &&
        Array.isArray(meta.frames);
      check('端到端·testsrc 冒烟：meta.json 关键字段类型正确', fieldsOk, JSON.stringify(meta));

      let rejected = false;
      try {
        runExtraction({ video: testsrcVideo, out: outDir, threshold: 0.3, maxFrames: 30, minFrames: 3, force: false });
      } catch (e) {
        rejected = e instanceof ExtractionError && e.code === 1;
      }
      check('端到端：输出目录已存在且未加 --force 时拒绝执行', rejected);

      let forcedOk = false;
      try {
        const r2 = runExtraction({ video: testsrcVideo, out: outDir, threshold: 0.3, maxFrames: 30, minFrames: 3, force: true });
        forcedOk = r2.finalFrameCount >= 1;
      } catch {
        forcedOk = false;
      }
      check('端到端：加 --force 后允许写入已存在目录', forcedOk);
    }

    // -- 视频文件不存在 --
    {
      let rejected = false;
      try {
        runExtraction({
          video: path.join(workDir, 'does-not-exist.mp4'),
          out: path.join(workDir, 'out-missing'),
          threshold: 0.3,
          maxFrames: 30,
          minFrames: 3,
          force: false,
        });
      } catch (e) {
        rejected = e instanceof ExtractionError && e.code === 1;
      }
      check('端到端：视频文件不存在时报错 exit 1', rejected);
    }
  } catch (e) {
    check('端到端 selftest 流程未抛出预期外的异常', false, e.stack || String(e));
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响 selftest 的通过/失败判定，只是残留了一个临时目录。
    }
  }

  return allOk;
}

// ---- CLI 入口 -------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: node scripts/extract-frames.mjs <video-path-or-url> [--out <dir>] [--threshold 0.3] [--max-frames 30] [--min-frames 3] [--force]');
    console.error('       node scripts/extract-frames.mjs --selftest');
    process.exit(1);
  }
  if (argv[0] === '--selftest') {
    const ok = selftest();
    console.log(ok ? '\nSELFTEST: ALL CHECKS BEHAVED AS EXPECTED' : '\nSELFTEST: AT LEAST ONE CHECK FAILED');
    process.exitCode = ok ? 0 : 1;
    return;
  }

  try {
    const opts = parseCliArgs(argv);
    const result = runExtraction(opts);
    // 成功路径上 stdout 只有这一行——人类可读的诊断信息一律走 stderr（见下方 catch
    // 分支），保证调用方"取 stdout 最后一行当 JSON 解析"这个约定永远成立。
    console.log(JSON.stringify({ ok: true, out_dir: result.outDir, frame_count: result.finalFrameCount, duration_sec: result.durationSec }));
    process.exitCode = 0;
  } catch (err) {
    // 失败时同样只在 stdout 留一行 JSON（{"ok":false,...}），供调用方统一解析；
    // 完整堆栈/ffmpeg stderr 这类人类调试信息单独走 stderr，不混进 stdout 的那一行里。
    const code = err instanceof ExtractionError ? err.code : 1;
    console.error(err.stack || String(err));
    console.log(JSON.stringify({ ok: false, error: err.message || String(err) }));
    process.exitCode = code;
  }
}

main();
