#!/usr/bin/env node
/**
 * 100x-video-reverse real validator.
 *
 * 为什么需要这个文件（与本仓 100x-visual-fission / 100x-search-query 同一套分层）：
 * schema.json（draft-07，ajv 编译）能管住所有"形状/闭集/单字段格式"层面的规则
 * （required / additionalProperties / enum / pattern / minimum / minLength 等）。
 * 它结构上管不到、必须靠这份脚本补的，逐条对应 axioms.md：
 *
 *   1. 【公理1】source.frames_analyzed>=1 与 meta.frames_source 非空——严格说这两条
 *      schema.json 已经用 minimum:1 / minLength:1 结构化管住了（ajv 会先于本脚本拒绝），
 *      这里仍然实现一遍作为防御性兜底，不是因为存在"过 ajv 但过不了这里"的输入。
 *      见文件末尾的实现说明。
 *   2. 【公理2】time_bucket 是字符串（"start-end"），必须解析成两个浮点数再跨条目
 *      比较：首镜 start==0.0、末镜 end 与 source.duration_sec 容差 0.2、相邻镜头首尾
 *      相接不留缝不重叠、每镜 end>start、shot_id 从 1 连续递增、每段时长不超
 *      target_model 对应上限。JSON Schema 的 pattern 只能锁字符串形状，锁不了这些算术
 *      和跨条目关系。
 *   3. 【公理3】21 个禁词的大小写不敏感、词边界匹配扫描，覆盖 shots/visual_forms 的
 *      prompt_en、slot_template.template_en，以及会被字面代入渲染的
 *      slot_template.slots[].observed_value/candidates[]（这两个字段也必须扫描）。匹配前生成两个归一化变体、命中任一即判定：collapsed（删
 *      连字符+折叠空白，抓 "beauti-ful" 这类拆词攻击）和 spacedExempt（连字符换空格+
 *      折叠空白，抓 "professional-grade" 这类复合词攻击——只做 collapsed 会拆掉连字符
 *      本来就能触发的词边界、反而漏抓复合词；生成
 *      spacedExempt 前先豁免 logo-free/watermark-free 这类基于文字层禁词的
 *      "<词>-free"/"<词>-less" 正当表达，豁免范围刻意不含 AI 美化词，否则
 *      professional-free 这类刻意绕过也会被放过。不设 "-to-" 豁免分支（否则第二个词
 *      不受约束，全部 21 个禁词都能套 "<词>-to-<禁词>" 这张皮逃逸）——text-to-speech/
 *      speech-to-text 现在会被判 FAIL，是权衡后认下的已知代价，不是 bug，见
 *      TEXT_LAYER_EXEMPTION_RE 注释）。词尾另外允许可选复数 s/es（防止强制后缀的复数
 *      形式 subtitles/watermarks 绕过单数禁词表，必修2）——draft-07 的 pattern 没有
 *      大小写不敏感标志，21 个词每种大小写写成正则不可读也不可维护，只能交给代码。
 *   4. 【公理4】visual_forms[].appears_in_shots 与 shots[].shot_id 的双向引用完整性
 *      （正向：引用的 shot_id 必须真实存在；反向：每个 shot 必须至少被引用一次，零孤儿）、
 *      form_type 在数组内不得重复、cross_shot_analysis.invariants[].holds_in_shots 同样
 *      必须指向真实 shot_id——这些都是"某数组里的值必须能在另一个数组里找到/覆盖"，ajv
 *      的 enum/pattern 只能检查格式，检查不了跨数组的存在性。
 *   5. 【公理5】{SLOT} token 与 slots[] 的双向闭合、template_zh 与 template_en 的槽位
 *      集合一致，以及 template_en/template_zh 自身的花括号规整性（不允许 {{ 或 }} 相邻
 *      双花括号、不允许挖掉合法 token 后仍残留孤立花括号——嵌套
 *      花括号会让分词器只认出内层 token，外层花括号原样残留进渲染结果）——需要把 {VAR}
 *      从字符串里分词出来做集合比较，JSON Schema 做不到。
 *   6. 【双语结构对齐】（非五条公理编号内，标 [bilingual]）：每条
 *      shot/visual_form 的 prompt_en 与 prompt_zh，{SLOT} token 集合必须无条件相同
 *      （两边都没有槽位时视为相等，照常 PASS；只"在 zh 侧出现 token 时才比较"的条件式
 *      写法会漏掉"en 有 zh 无"的漂移，因此必须无条件比较）——这是
 *      axiom5 已知局限段落提到的"结构对齐但不判断语义忠实度"原则的延伸应用，axioms.md
 *      公理5的"可验证"清单本身并未把它列为公理5的一条，因此单独标签，不假装是公理5的
 *      一部分。
 *
 * 校验顺序：先跑 ajv。ajv 不过直接报 ajv 的错，不跑下面这些手写聚合检查（对一份连结构都
 * 不合法的文档做跨条目检查没有意义）。ajv 过了才跑聚合层。
 *
 * 用法：
 *   node scripts/validate.js <file1.json> [file2.json ...]
 *     校验给定的 VideoReverseBundle JSON 文件，全部通过 exit 0，任一失败 exit 1
 *     （每个失败文件打印具体的失败规则）。
 *
 *   node scripts/validate.js --selftest
 *     跑内置回归套件并打印每条 PASS/FAIL，任一条不符合预期则整体以非零退出。
 *
 * 依赖：ajv（见 package.json）。使用前先在本目录跑 `npm install`。其余全部是 Node 内置能力。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const SCHEMA_PATH = path.join(__dirname, '..', 'schema.json');

function loadAjvValidator() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  // strict:false —— schema.json 的 meta 对象用了 additionalProperties:true（有意的可扩展
  // 元数据，不是封闭集合），ajv strict 模式会对这类合法但"不够严格"的写法报风格警告。
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

function formatAjvErrors(ajvErrors) {
  return (ajvErrors || []).map((e) => {
    const loc = e.instancePath && e.instancePath.length ? e.instancePath : '(root)';
    const extra = e.params ? ` ${JSON.stringify(e.params)}` : '';
    return `[schema:ajv] ${loc} ${e.message}${extra}`;
  });
}

// 浮点比较容差。time_bucket 里的数字只保证"恰好一位小数"，多数测试值在二进制浮点下能
// 精确表示（如 6.0/4.5/9.5），但不能假设所有一位小数都精确（如 0.1 不精确），跨条目相等
// 判断一律走容差比较，不用 ===。
const EPS = 1e-9;

// ---- 公理2：把 "start-end" 字符串解析成两个数字 ------------------------------------
function parseTimeBucket(str) {
  // schema.json 的 pattern ^[0-9]+\.[0-9]-[0-9]+\.[0-9]$ 在本函数被调用前已经由 ajv
  // 验过一轮（聚合检查只在 ajv 通过后才跑，见 validate()），这里只管把两个数字取出来，
  // 不重复做形状校验。
  const [startStr, endStr] = str.split('-');
  return { start: parseFloat(startStr), end: parseFloat(endStr) };
}

// target_model -> 每段时长上限（秒）。数值取自 axioms.md 公理2：veo/seedance 复用本仓
// 100x-prompt-compose/scripts/validate.js 的 MODEL_DURATION_CAP 取值（veo:8.0,
// seedance:10.0）；但"即创"在那份表里是 null（表示"没有公开上限数据"，不是"上限8秒"），
// 语义和本处需要的"必须有一个可比较的具体上限"不同，不能直接复用那个值——本 skill 对
// 即创/generic 落最严档 8.0 是 axioms.md 公理2 记录的本次原创判断，所以在这里单独定义
// 一份自己的表，不跨 skill 目录 require 别的 validate.js（本仓其它 skill 也都不这样做，
// 每个 skill 的校验脚本各自独立成立）。
const MODEL_DURATION_CAP = {
  veo: 8.0,
  seedance: 10.0,
  即创: 8.0,
  generic: 8.0,
};

// [axiom1] 见文件头说明：这两条在当前 schema.json 下已经被 ajv 的 minimum:1 /
// minLength:1 结构化管住，聚合层不可能收到"过了 ajv 但这里会 FAIL"的输入。仍然实现是
// 作为防御性兜底（如实保留可读的判据落点），不是因为发现了 ajv 管不到的
// 空隙。
function axiom1Check(bundle, errors) {
  if (!(bundle.source.frames_analyzed >= 1)) {
    errors.push(`[axiom1] source.frames_analyzed=${bundle.source.frames_analyzed} 不满足 >= 1`);
  }
  if (!bundle.meta.frames_source || bundle.meta.frames_source.trim().length === 0) {
    errors.push('[axiom1] meta.frames_source 为空，无法钉回一次真实的抽帧运行');
  }
}

// [axiom2] C1-C5 + 每段时长上限。数组书写顺序不代表时间顺序（模型可能乱序产出 shots[]），
// 必须先按 shot_id 排序再比较相邻项——同时保留原始数组下标 idx，报错时能直接定位回源
// 文件里的具体条目，而不是排序后的位置。
function axiom2TimelineCheck(bundle, errors) {
  const cap = MODEL_DURATION_CAP[bundle.target_model];

  const parsed = bundle.shots
    .map((s, idx) => {
      const tb = parseTimeBucket(s.time_bucket);
      return { idx, shot_id: s.shot_id, start: tb.start, end: tb.end, raw: s.time_bucket };
    })
    .sort((a, b) => a.shot_id - b.shot_id);

  // C1：排序后的首镜必须从 0.0 秒开始。
  const first = parsed[0];
  if (Math.abs(first.start - 0) > EPS) {
    errors.push(`[axiom2] shots[${first.idx}].time_bucket="${first.raw}" (shot_id=${first.shot_id}，排序后首镜) 起点是 ${first.start}，应为 0.0 (C1)`);
  }

  // C2：排序后的末镜 end 与 source.duration_sec 容差 0.2 秒内。
  const last = parsed[parsed.length - 1];
  const c2diff = Math.abs(last.end - bundle.source.duration_sec);
  if (c2diff > 0.2) {
    errors.push(`[axiom2] shots[${last.idx}].time_bucket="${last.raw}" (shot_id=${last.shot_id}，排序后末镜) 终点是 ${last.end}，source.duration_sec=${bundle.source.duration_sec}，误差 ${c2diff.toFixed(3)} 秒超过 0.2 容差 (C2)`);
  }

  parsed.forEach((p, i) => {
    // C4：禁止零时长或负时长分段。
    if (!(p.end > p.start)) {
      errors.push(`[axiom2] shots[${p.idx}].time_bucket="${p.raw}" (shot_id=${p.shot_id}) end(${p.end}) 不大于 start(${p.start}) (C4)`);
    }

    // C5：按 shot_id 排序后，序号必须从 1 连续递增，不允许跳号或重复。
    const expectedId = i + 1;
    if (p.shot_id !== expectedId) {
      errors.push(`[axiom2] shots[${p.idx}] shot_id=${p.shot_id}，按 shot_id 排序后处于第 ${i} 位应为 shot_id=${expectedId}（shot_id 必须从 1 连续递增不跳号）(C5)`);
    }

    // 每段时长不能超过 target_model 对应的上限（含等于，见 MODEL_DURATION_CAP 注释）。
    const span = p.end - p.start;
    if (span - cap > EPS) {
      errors.push(`[axiom2] shots[${p.idx}].time_bucket="${p.raw}" (shot_id=${p.shot_id}) 时长 ${span.toFixed(1)}s 超过 target_model="${bundle.target_model}" 的上限 ${cap}s (cap)`);
    }

    // C3：相邻镜头（排序后）必须首尾相接，既不留缝也不重叠。
    if (i < parsed.length - 1) {
      const next = parsed[i + 1];
      if (Math.abs(p.end - next.start) > EPS) {
        errors.push(`[axiom2] shots[${p.idx}].end(${p.end}) 与 shots[${next.idx}].start(${next.start}) 不相等（shot_id ${p.shot_id}→${next.shot_id} 之间留缝或重叠）(C3)`);
      }
    }
  });
}

// ---- 公理3：禁词表 ---------------------------------------------------------------
// 逐字抄自 axioms.md 公理3的"绝对禁词清单"，分两组只是为了追溯来源，扫描时当成一份表用。
const AI_BEAUTIFICATION_WORDS = [
  'cinematic', 'professional', 'studio', 'beautiful', 'stunning',
  'smooth skin', 'perfect', 'flawless', 'polished', 'editorial', 'glamour',
];
const TEXT_LAYER_WORDS = [
  'text', 'subtitle', 'caption', 'watermark', 'logo', 'title', 'font', 'letter', 'word', 'overlay',
];
const BANNED_WORDS = [...AI_BEAUTIFICATION_WORDS, ...TEXT_LAYER_WORDS];

// 强制后缀本身就含 text/subtitle/watermark 三个禁词——不先剥掉这段固定后缀就扫，
// 每一条合法 prompt 都会永远 FAIL（axioms.md 公理3 坑1）。
const MANDATORY_SUFFIX = ', no text, no subtitles, no watermarks';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 归一化仅用于"匹配"，绝不改动原始字段值或报错信息里引用的原文。
//
// 单一归一化策略做不到：删连字符能抓拆词攻击，但会破坏复合词的词边界——
// "professional-grade" 删掉连字符变成 "professionalgrade"，"professional" 后面本该由
// 连字符（非词字符）天然触发的 \b 消失了，命中反而失败；换空格能抓复合词攻击，却会破坏
// 拆词攻击——"beauti-ful" 换成空格变成 "beauti ful"，两半都不再是完整的 "beautiful"。
// 两种策略互斥，必须都做，命中任一变体就判定（并集）。
//
//   collapsed     —— 删连字符 + 折叠空白，抓拆词攻击（"beauti-ful" -> "beautiful"）
//   spacedExempt  —— 连字符换空格 + 折叠空白，抓复合词攻击
//                     （"professional-grade" -> "professional grade"）
//
// spacedExempt 会误伤两类正当表达：logo-free / watermark-free——
// 这些词里的 logo/watermark 是文字层禁词，换成空格后单独成词会被误判。做法：生成
// spacedExempt 前，先把形如 "<文字层禁词>(s)?-free" / "<文字层禁词>(s)?-less" 的复合词
// 整体抹掉，不让它参与这个变体的匹配；collapsed 变体不受豁免影响，仍按原样扫描（拆词
// 攻击照抓不误）。
//
// 豁免范围刻意只对 TEXT_LAYER_WORDS（10 词）生效，不对 AI_BEAUTIFICATION_WORDS（11 词）
// 生效——更宽泛的豁免（对全部 21 词生效）同样能过全部正常用例，但
// "professional-free"/"studio-less" 这两个刻意构造的绕过会逃逸。限定在文字层禁词后，
// 两个绕过都被正确抓住。语义上也站得住：logo-free 是真实常见的正当表达，而
// professional-free/studio-less 在英语里根本无意义，只可能是刻意构造。
//
// "-to-" 形式不豁免：`<文字层禁词>(s)?-to-<任意词>` 的第二个词不受约束，
// spacedExempt 会把整段一起抹掉、collapsedVariant 又会让第二个词焊进相邻字母，21 个
// 禁词随便哪个都能套这张皮逃逸，candidates[]/observed_value 路径同样中招。
// text-to-speech/speech-to-text 因此会被判 FAIL——这是认下的已知代价，不是 bug，已如实
// 写入 SKILL.md 已知局限；--selftest 用例 43/49 把这个权衡钉死成"预期 FAIL"，想放宽
// 豁免前必须先改掉那两条用例。用户需要描述这类 App 功能时，应改写成不含字面禁词的说法
// （如把 "text-to-speech" 改写成 "spoken-word transcription"）。
//
// 注意边界：前缀/后缀字母融合词（如 "homestudio" 吞掉 "studio"，中间没有任何连字符或
// 空白可归一化）不在这条范围内——若放弃词边界改成子串匹配，会引入 'secure'/'manicure' 等误伤假阳性，如实留作已知局限。
const TEXT_LAYER_WORDS_ALTERNATION = TEXT_LAYER_WORDS.map(escapeRegExp).join('|');
const TEXT_LAYER_EXEMPTION_RE = new RegExp(`\\b(?:${TEXT_LAYER_WORDS_ALTERNATION})s?-(?:free|less)\\b`, 'gi');

function collapsedVariant(str) {
  return str.replace(/-/g, '').replace(/\s+/g, ' ');
}

function spacedExemptVariant(str) {
  return str.replace(TEXT_LAYER_EXEMPTION_RE, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ');
}

// \b 词边界匹配，禁止裸 includes() 子串匹配——裸子串匹配会误伤 'secure'/'manicure'（含 'cure' 子串）或 'unpolished'（含 'polished' 子串）。'smooth skin' 在 BANNED_WORDS 里就是一个整词组条目（含字面空格），\b 只锚定在
// 词组两端，不会被拆成 'smooth' 和 'skin' 分别扫描。
//
// 词尾允许可选复数 s/es，只加在词组的最后一个词上（"smooth skin" 只在 "skin" 后面允许，
// 不改动 "smooth"）。词尾复数支持：强制后缀写的是
// 复数 "no subtitles, no watermarks"，但禁词表原本只有单数 subtitle/watermark，
// `\bwatermark\b` 命中不了 "watermarks"——把整句"伪后缀"在正文里重复一遍
// （"...no subtitles, no watermarks, no text, no subtitles, no watermarks"），
// stripMandatorySuffix 只切掉最后那一份真后缀，前面重复的复数形式禁词就能整句免检。
// 可选复数后缀写在 \b 之前，仍然要求词尾之后是真正的词边界，"watermarked"/"wordsmith"
// 这类紧跟着别的字母的情况不会被误认成"词+可选复数"。
function wordMatch(haystackLower, phraseLower) {
  const words = phraseLower.split(' ');
  const lastIdx = words.length - 1;
  const pattern = words
    .map((w, i) => (i === lastIdx ? `${escapeRegExp(w)}(?:es|s)?` : escapeRegExp(w)))
    .join(' ');
  const re = new RegExp('\\b' + pattern + '\\b');
  return re.test(haystackLower);
}

function stripMandatorySuffix(str) {
  if (str.endsWith(MANDATORY_SUFFIX)) {
    return str.slice(0, str.length - MANDATORY_SUFFIX.length);
  }
  // 防御性分支：ajv 的 pattern 已经强制要求这段后缀存在，正常流程走不到这里。
  return str;
}

// 两个归一化变体各自转小写后分别扫一遍，命中任一变体就算命中（并集）。两条扫描入口
// （scanBannedWords / scanBannedWordsRaw）共用这一份判定逻辑，唯一差异是要不要先剥
// 强制后缀。
function bannedWordHits(rawText) {
  const variants = [collapsedVariant(rawText).toLowerCase(), spacedExemptVariant(rawText).toLowerCase()];
  return BANNED_WORDS.filter((w) => variants.some((v) => wordMatch(v, w)));
}

function pushBannedWordError(hits, fieldLabel, errors) {
  if (hits.length > 0) {
    errors.push(`[axiom3] ${fieldLabel} 命中禁词：${hits.join(', ')}`);
  }
}

// 用于自带强制后缀的"完整生成 prompt"字段（shots/visual_forms 的 prompt_en、
// slot_template.template_en）：先剥后缀，剩下的正文再归一化+扫描。
function scanBannedWords(str, fieldLabel, errors) {
  if (!str) return;
  const body = stripMandatorySuffix(str);
  pushBannedWordError(bannedWordHits(body), fieldLabel, errors);
}

// 用于不带强制后缀的字段（slot_template.slots[] 的 observed_value/candidates[]）：
// 直接归一化+扫描全串，不做剥后缀——这些值本来就不该带后缀，剥后缀反而会误伤内容。
function scanBannedWordsRaw(str, fieldLabel, errors) {
  if (!str) return;
  pushBannedWordError(bannedWordHits(str), fieldLabel, errors);
}

function axiom3BannedWordScan(bundle, errors) {
  bundle.shots.forEach((s, i) => {
    scanBannedWords(s.prompt_en, `shots[${i}](shot_id=${s.shot_id}).prompt_en`, errors);
  });
  bundle.visual_forms.forEach((vf, i) => {
    scanBannedWords(vf.prompt_en, `visual_forms[${i}](form_type=${vf.form_type}).prompt_en`, errors);
  });
  scanBannedWords(bundle.slot_template.template_en, 'slot_template.template_en', errors);

  // 必修1：observed_value/candidates[] 会被
  // 字面代入 template_en 渲染成最终 prompt，之前完全没纳入禁词扫描范围——21 个禁词等于
  // 有一扇敞开的正门（实测样本：observed_value:"stunning studio-lit outfit"，
  // candidates:["flawless glowing skin","perfect glamour makeup"]）。
  bundle.slot_template.slots.forEach((slot, i) => {
    scanBannedWordsRaw(slot.observed_value, `slot_template.slots[${i}](name=${slot.name}).observed_value`, errors);
    slot.candidates.forEach((cand, ci) => {
      scanBannedWordsRaw(cand, `slot_template.slots[${i}](name=${slot.name}).candidates[${ci}]`, errors);
    });
  });
}

// [axiom4] 双轴引用完整性（正向+反向）+ form_type 唯一 + invariants 引用完整性。
// schema.json 的 uniqueItems 只能挡住同一条 appears_in_shots 数组内部的重复值，管不到
// "这个整数是否真的是 shots[] 里存在的 shot_id"这种跨数组的存在性问题。
function axiom4CrossAxisIntegrityCheck(bundle, errors) {
  const shotIds = new Set(bundle.shots.map((s) => s.shot_id));

  // 正向：appears_in_shots 里的每个整数必须是真实的 shot_id。
  const referencedShotIds = new Set();
  bundle.visual_forms.forEach((vf, i) => {
    vf.appears_in_shots.forEach((sid) => {
      if (!shotIds.has(sid)) {
        errors.push(`[axiom4] visual_forms[${i}](form_type=${vf.form_type}).appears_in_shots 引用了不存在的 shot_id=${sid}`);
      }
      referencedShotIds.add(sid);
    });
  });

  // 反向：每个 shots[].shot_id 必须至少被一条 visual_form 引用，零孤儿。
  bundle.shots.forEach((s, i) => {
    if (!referencedShotIds.has(s.shot_id)) {
      errors.push(`[axiom4] shots[${i}] shot_id=${s.shot_id} 没有被任何 visual_forms[].appears_in_shots 引用（孤儿镜头，形态轴假装它不存在）`);
    }
  });

  // form_type 在数组内不得重复。
  const seenFormTypes = new Map();
  bundle.visual_forms.forEach((vf, i) => {
    if (seenFormTypes.has(vf.form_type)) {
      errors.push(`[axiom4] visual_forms[${i}].form_type="${vf.form_type}" 与 visual_forms[${seenFormTypes.get(vf.form_type)}] 重复（同一形态应收敛成一条，不应出现两条）`);
    } else {
      seenFormTypes.set(vf.form_type, i);
    }
  });

  // cross_shot_analysis.invariants[].holds_in_shots 同样必须指向真实 shot_id。
  bundle.cross_shot_analysis.invariants.forEach((inv, i) => {
    inv.holds_in_shots.forEach((sid) => {
      if (!shotIds.has(sid)) {
        errors.push(`[axiom4] cross_shot_analysis.invariants[${i}](aspect=${inv.aspect}).holds_in_shots 引用了不存在的 shot_id=${sid}`);
      }
    });
  });
}

// ---- 公理5 与双语结构对齐共用的 {SLOT} 分词工具 -------------------------------------
// 只认 {ALL_CAPS} 形状（与 schema.json 里 slot_item.name 的 pattern 一致），避免把普通
// 英文散文里偶然出现的花括号误当槽位。
const SLOT_TOKEN_RE = /\{[A-Z][A-Z0-9_]*\}/g;

function extractSlotTokens(str) {
  const matches = (str || '').match(SLOT_TOKEN_RE) || [];
  return new Set(matches.map((m) => m.slice(1, -1)));
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

// 必修4：{{AGE}} 这种相邻双花括号，SLOT_TOKEN_RE
// 只会认出内层 {AGE}（正则从左往右扫，"{{" 处第一个 "{" 后面跟的是 "{" 而不是
// [A-Z]，匹配失败；从第二个 "{" 起再匹配到 "{AGE}"），外层多出来的 "{" 和残留的 "}"
// 不构成任何 token，会作为字面字符原样残留在渲染后的最终 prompt 里，分词器完全没有
// 察觉。做法：先挡相邻的 "{{"/"}}"；再把字符串里所有合法 {SLOT} token 挖掉，如果挖完
// 还剩下孤立的 "{" 或 "}"，说明存在没有构成合法 token 的花括号（小写 {age}、数字开头
// {1BC}，或者根本没配对的单个花括号）。
function checkBraceWellFormedness(str, fieldLabel, errors) {
  if (!str) return;
  if (str.includes('{{') || str.includes('}}')) {
    errors.push(`[axiom5] ${fieldLabel} 含有相邻的双重花括号 "{{"/"}}"——分词器只会认出内层 {SLOT} token，多出来的花括号会作为字面字符残留在渲染后的最终 prompt 里`);
    return;
  }
  const residual = str.replace(SLOT_TOKEN_RE, '');
  if (/[{}]/.test(residual)) {
    errors.push(`[axiom5] ${fieldLabel} 含有不构成合法 {SLOT} token 的孤立花括号（挖掉所有合法 {SLOT} token 后字符串里仍残留 "{" 或 "}"）`);
  }
}

// [axiom5] 模板槽位与变量表双向闭合 + 中英模板槽位集合一致。都需要把 {VAR} 从字符串里
// 分词出来做集合比较，JSON Schema 没有对应能力。
function axiom5SlotClosureCheck(bundle, errors) {
  const st = bundle.slot_template;
  checkBraceWellFormedness(st.template_en, 'slot_template.template_en', errors);
  checkBraceWellFormedness(st.template_zh, 'slot_template.template_zh', errors);
  const templateEnTokens = extractSlotTokens(st.template_en);
  const templateZhTokens = extractSlotTokens(st.template_zh);
  const slotNames = new Set(st.slots.map((s) => s.name));

  // 正向：template_en 里出现的每个 {SLOT}，slots[] 里必须有同名条目。
  templateEnTokens.forEach((tok) => {
    if (!slotNames.has(tok)) {
      errors.push(`[axiom5] slot_template.template_en 引用了 {${tok}}，但 slot_template.slots 里没有名为 "${tok}" 的条目（正向闭合失败，渲染时这个位置会留下填不上的洞）`);
    }
  });

  // 反向：slots[] 里的每个 name，必须在 template_en 里真的出现。
  slotNames.forEach((name) => {
    if (!templateEnTokens.has(name)) {
      errors.push(`[axiom5] slot_template.slots 定义了 "${name}"，但 slot_template.template_en 里没有出现 {${name}}（反向闭合失败，死变量）`);
    }
  });

  // 中英一致：template_zh 的槽位集合必须与 template_en 完全相同。
  if (!setsEqual(templateEnTokens, templateZhTokens)) {
    const onlyEn = [...templateEnTokens].filter((t) => !templateZhTokens.has(t));
    const onlyZh = [...templateZhTokens].filter((t) => !templateEnTokens.has(t));
    errors.push(`[axiom5] slot_template.template_zh 的槽位集合与 template_en 不一致（仅 template_en 有：[${onlyEn.join(',')}]；仅 template_zh 有：[${onlyZh.join(',')}]）`);
  }
}

// [bilingual] 双语结构对齐——不属于 axioms.md 公理5"可验证"清单字面列出的
// 范围（该清单只讲 slot_template 自己的 template_en/template_zh），标 [bilingual] 而不是
// [axiom5]，避免误导成"公理5本身就这样写"。schema.json 已经用 minLength 管住了
// prompt_en/prompt_zh 非空，这里的非空检查是防御性兜底，不是补 ajv 的漏洞。
//
// 集合比较是无条件的：公理5对 template_zh/template_en 的要求本来就是
// "token 集合完全相同"，prompt 级没有理由用更松的标准。最初"只在 zh 侧出现槽位 token
// 时才比较"的条件式写法漏掉了真实故障模式——运营把中文里的 {COLOR} 整个删掉（不是改名
// 成别的 token，是删得一个不剩），en 有 zh 没有，旧写法测不出来。两边都没有槽位 token 时
// 集合都是空集，setsEqual 判定相等，照常 PASS——绝大多数反推产物 shots/visual_forms 的
// prompt 两侧都不带模板槽位（槽位只该出现在 slot_template 里），这是最常见的合法情况，
// 不会被无条件比较误伤。
function bilingualStructuralAlignmentCheck(bundle, errors) {
  function checkPair(en, zh, label) {
    if (!en || !en.trim()) errors.push(`[bilingual] ${label}.prompt_en 为空`);
    if (!zh || !zh.trim()) errors.push(`[bilingual] ${label}.prompt_zh 为空`);
    if (!en || !zh) return;
    const enTokens = extractSlotTokens(en);
    const zhTokens = extractSlotTokens(zh);
    if (!setsEqual(enTokens, zhTokens)) {
      errors.push(`[bilingual] ${label} 的 prompt_en/prompt_zh {SLOT} token 集合不一致（en: [${[...enTokens].join(',')}], zh: [${[...zhTokens].join(',')}]）`);
    }
  }
  bundle.shots.forEach((s, i) => checkPair(s.prompt_en, s.prompt_zh, `shots[${i}](shot_id=${s.shot_id})`));
  bundle.visual_forms.forEach((vf, i) => checkPair(vf.prompt_en, vf.prompt_zh, `visual_forms[${i}](form_type=${vf.form_type})`));
}

// schema.json（因此 ajv）结构上管不到的聚合检查。只在 ajv 已确认文档结构合法之后才会被
// 调用，所以这里可以放心假设各字段的形状已经对。
function aggregateChecks(bundle) {
  const errors = [];
  axiom1Check(bundle, errors);
  axiom2TimelineCheck(bundle, errors);
  axiom3BannedWordScan(bundle, errors);
  axiom4CrossAxisIntegrityCheck(bundle, errors);
  axiom5SlotClosureCheck(bundle, errors);
  bilingualStructuralAlignmentCheck(bundle, errors);
  return errors;
}

// 完整流水线：ajv 结构层先跑，只有通过了才跑聚合层。
function validate(bundle, ajvValidateFn) {
  const structurallyValid = ajvValidateFn(bundle);
  if (!structurallyValid) {
    return formatAjvErrors(ajvValidateFn.errors);
  }
  return aggregateChecks(bundle);
}

function runOne(file, ajvValidateFn) {
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validate(bundle, ajvValidateFn);
  if (errors.length === 0) {
    console.log(`PASS: ${file}`);
  } else {
    console.log(`FAIL: ${file}`);
    errors.forEach((e) => console.log('  - ' + e));
  }
  return errors.length === 0;
}

// ---- Self-test：把 axioms.md 里的反例固化成回归用例 ---------------------------------
// 不依赖 evals/ 目录：建这个 skill 时 evals/ 由另一个 agent 并行编写，本脚本的验收不应该
// 依赖一份不受自己控制、写作时间线也不确定的外部目录，所有正反例都用内联 fixture 自给自足。

// 构造已验证能过 ajv 的基准正例，每次调用返回全新对象（无共享引用），
// 后续用例在此基础上做最小化单点突变，尽量只触发一条待测规则。
function buildBaseBundle() {
  return {
    source: { duration_sec: 12.0, aspect_ratio: '9:16', frames_analyzed: 4, extraction_method: 'scene-detect' },
    target_model: 'veo',
    shots: [
      {
        shot_id: 1, time_bucket: '0.0-6.0', shot_purpose: 'hook',
        prompt_en: 'A woman looks into the phone camera in a kitchen, no text, no subtitles, no watermarks',
        prompt_zh: '女人在厨房里对着手机镜头说话',
      },
      {
        shot_id: 2, time_bucket: '6.0-12.0', shot_purpose: 'cta',
        prompt_en: 'Close-up of a white bottle on a wooden counter, no text, no subtitles, no watermarks',
        prompt_zh: '木质台面上白色瓶子的特写',
      },
    ],
    visual_forms: [
      {
        form_type: 'talking_head', appears_in_shots: [1],
        prompt_en: 'A woman speaking directly to a handheld phone camera indoors, no text, no subtitles, no watermarks',
        prompt_zh: '女人在室内对着手持手机镜头说话',
      },
      {
        form_type: 'product_closeup', appears_in_shots: [2],
        prompt_en: 'Tight product shot of a white supplement bottle, no text, no subtitles, no watermarks',
        prompt_zh: '白色补剂瓶的紧凑产品特写',
      },
    ],
    slot_template: {
      template_en: 'A {AGE} {ETHNICITY} woman in a {OUTFIT} speaks to the camera, no text, no subtitles, no watermarks',
      template_zh: '一位 {AGE} 的 {ETHNICITY} 女性穿着 {OUTFIT} 对镜头说话',
      slots: [
        { name: 'AGE', observed_value: '28-year-old', candidates: ['35-year-old', '45-year-old'] },
        { name: 'ETHNICITY', observed_value: 'Latina', candidates: ['Black', 'Asian'] },
        { name: 'OUTFIT', observed_value: 'beige hoodie', candidates: ['grey tee', 'denim jacket'] },
      ],
    },
    cross_shot_analysis: {
      invariants: [{ aspect: 'scene', description: 'same kitchen counter throughout', holds_in_shots: [1, 2] }],
      varying_axes: [{ axis: 'camera', observed_values: ['medium front', 'tight close-up'] }],
    },
    meta: { generated_by: '100x-video-reverse', frames_source: './frames-demo/meta.json' },
  };
}

function selftest() {
  const ajvValidateFn = loadAjvValidator();
  let allOk = true;
  let n = 0;
  const TOTAL = 54;

  function check(label, errors, expectFail) {
    n++;
    const failed = errors.length > 0;
    const ok = expectFail ? failed : !failed;
    if (ok) {
      console.log(`SELFTEST PASS (${n}/${TOTAL} ${label})`);
    } else {
      console.log(`SELFTEST FAIL (${n}/${TOTAL} ${label})`);
      errors.forEach((e) => console.log('  - ' + e));
      allOk = false;
    }
    return errors;
  }

  // 只看某个公理前缀的错误，用于把"这次突变只应该触发这一条规则"断言清楚，不被同一个
  // fixture 上其它规则的误报/漏报掩盖。
  function only(errors, marker) {
    return errors.filter((e) => e.includes(marker));
  }

  // 1: 完整合法样例（基准正例）必须整体 PASS，同时验证公理1/2/3/4/5全部满足。
  {
    const b = buildBaseBundle();
    const errors = validate(b, ajvValidateFn);
    check('完整合法基准样例整体 PASS', errors, false);
  }

  // 2 (ajv maximum, 公理1): duration_sec=200 结构层直接拒绝。
  {
    const b = buildBaseBundle();
    b.source.duration_sec = 200;
    const errors = validate(b, ajvValidateFn);
    check('duration_sec=200 正确经 ajv maximum 拒绝 (axiom1)', errors.filter((e) => e.includes('schema:ajv')), true);
  }

  // 3 (ajv minimum, 公理1): frames_analyzed=0，证明 axiom1Check 在 validate.js 里的
  // "frames_analyzed>=1"分支目前不可达——ajv 的 minimum:1 更早拒绝。
  {
    const b = buildBaseBundle();
    b.source.frames_analyzed = 0;
    const errors = validate(b, ajvValidateFn);
    check('frames_analyzed=0 正确经 ajv minimum 拒绝，证明该分支在 validate.js 层不可达 (axiom1)', errors.filter((e) => e.includes('schema:ajv')), true);
  }

  // 4 (ajv minLength, 公理1): frames_source=""，同上，证明另一个分支也不可达。
  {
    const b = buildBaseBundle();
    b.meta.frames_source = '';
    const errors = validate(b, ajvValidateFn);
    check('meta.frames_source="" 正确经 ajv minLength 拒绝，证明该分支在 validate.js 层不可达 (axiom1)', errors.filter((e) => e.includes('schema:ajv')), true);
  }

  // 5: veo 上限 8.0s，某段 9.0s 必须 FAIL cap 检查。
  {
    const b = buildBaseBundle();
    b.shots[0].time_bucket = '0.0-9.0';
    b.shots[1].time_bucket = '9.0-12.0';
    const errors = validate(b, ajvValidateFn);
    check('veo 单段 9.0s 超过 8.0 上限正确 FAIL (axiom2 cap)', only(errors, '(cap)'), true);
  }

  // 6: 相邻镜头留缝 0.5s。
  {
    const b = buildBaseBundle();
    b.source.duration_sec = 10.0;
    b.shots[0].time_bucket = '0.0-5.0';
    b.shots[1].time_bucket = '5.5-10.0';
    const errors = validate(b, ajvValidateFn);
    check('相邻镜头留缝 0.5s 正确 FAIL (axiom2 C3)', only(errors, '(C3)'), true);
  }

  // 7: 相邻镜头重叠 1.0s。
  {
    const b = buildBaseBundle();
    b.source.duration_sec = 10.0;
    b.shots[0].time_bucket = '0.0-5.0';
    b.shots[1].time_bucket = '4.0-10.0';
    const errors = validate(b, ajvValidateFn);
    check('相邻镜头重叠 1.0s 正确 FAIL (axiom2 C3)', only(errors, '(C3)'), true);
  }

  // 8: 首镜不从 0.0 开始。
  {
    const b = buildBaseBundle();
    b.shots[0].time_bucket = '1.0-7.0';
    b.shots[1].time_bucket = '7.0-12.0';
    const errors = validate(b, ajvValidateFn);
    check('首镜不从 0.0 开始正确 FAIL (axiom2 C1)', only(errors, '(C1)'), true);
  }

  // 9: 末镜 end 与 duration_sec 差距过大（差 1.0s > 0.2 容差）。
  {
    const b = buildBaseBundle();
    b.shots[1].time_bucket = '6.0-11.0';
    // source.duration_sec 保持 12.0 不变。
    const errors = validate(b, ajvValidateFn);
    check('末镜 end 与 duration_sec 差 1.0s 正确 FAIL (axiom2 C2)', only(errors, '(C2)'), true);
  }

  // 10: shot_id 跳号 [1,3]。
  {
    const b = buildBaseBundle();
    b.shots[1].shot_id = 3;
    const errors = validate(b, ajvValidateFn);
    check('shot_id 跳号 [1,3] 正确 FAIL (axiom2 C5)', only(errors, '(C5)'), true);
  }

  // 11: 即创落最严档 8.0s 上限——8.5s 必须 FAIL（axioms.md 公理2记录的原创判断的
  // 可运行证据，不是 100x-prompt-compose 那份 null 语义）。
  {
    const b = buildBaseBundle();
    b.target_model = '即创';
    b.shots[0].time_bucket = '0.0-8.5';
    b.shots[1].time_bucket = '8.5-12.0';
    const errors = validate(b, ajvValidateFn);
    check('即创 单段 8.5s 超过最严档 8.0 上限正确 FAIL (axiom2 cap)', only(errors, '(cap)'), true);
  }

  // 12: seedance 上限 10.0s，某段恰好 10.0s（边界相等）必须整体 PASS——验证 cap 比较是
  // "不超过"（含等于）而不是严格小于。
  {
    const b = buildBaseBundle();
    b.target_model = 'seedance';
    b.shots[0].time_bucket = '0.0-10.0';
    b.shots[1].time_bucket = '10.0-12.0';
    const errors = validate(b, ajvValidateFn);
    check('seedance 单段恰好 10.0s（等于上限）正确整体 PASS (axiom2 cap 边界)', errors, false);
  }

  // 13: prompt_en 命中 beautiful/flawless/cinematic 三个 AI 美化词。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A beautiful woman with flawless skin in cinematic lighting, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('prompt_en 命中 beautiful/flawless/cinematic 正确 FAIL (axiom3)', only(errors, '[axiom3]'), true);
  }

  // 14（关键用例）: "unpolished" 是正向真实感锚点，词边界不应误命中 "polished"，必须整体 PASS。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'An unpolished, bare kitchen counter, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check("'unpolished' 不应误命中 'polished'，正确整体 PASS (axiom3 词边界验证)", errors, false);
  }

  // 15（关键用例）: 剥掉强制后缀之后，正文里的真禁词 "subtitle" 仍必须被扫到——验证
  // "剥后缀"没有把正文真禁词一起放过。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A woman reads the subtitle on screen, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check("剥后缀后正文仍含真禁词 'subtitle' 正确 FAIL (axiom3 剥后缀验证)", only(errors, '[axiom3]'), true);
  }

  // 16: 文字层禁词 "logo"（单独验证文字层半张表，不止 AI 美化词半张表）。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A hand places a small logo sticker on the box, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check("文字层禁词 'logo' 正确 FAIL (axiom3)", only(errors, '[axiom3]'), true);
  }

  // 17: appears_in_shots 引用不存在的 shot_id=99（正向引用完整性）。
  {
    const b = buildBaseBundle();
    b.visual_forms[0].appears_in_shots = [1, 99];
    const errors = validate(b, ajvValidateFn);
    check('appears_in_shots 引用不存在的 shot_id=99 正确 FAIL (axiom4 正向)', only(errors, '[axiom4]'), true);
  }

  // 18: shot 2 没有被任何 visual_form 覆盖（反向零孤儿）。
  {
    const b = buildBaseBundle();
    b.visual_forms[1].appears_in_shots = [1];
    const errors = validate(b, ajvValidateFn);
    check('shot_id=2 未被任何 visual_form 覆盖正确 FAIL (axiom4 反向零孤儿)', only(errors, '孤儿镜头'), true);
  }

  // 19: 两条 visual_forms 的 form_type 重复。
  {
    const b = buildBaseBundle();
    b.visual_forms[1].form_type = 'talking_head';
    const errors = validate(b, ajvValidateFn);
    check('两条 visual_forms.form_type 重复正确 FAIL (axiom4 唯一性)', only(errors, '重复'), true);
  }

  // 20: cross_shot_analysis.invariants[].holds_in_shots 引用不存在的 shot_id=99。
  {
    const b = buildBaseBundle();
    b.cross_shot_analysis.invariants[0].holds_in_shots = [1, 99];
    const errors = validate(b, ajvValidateFn);
    check('invariants[].holds_in_shots 引用不存在的 shot_id=99 正确 FAIL (axiom4 invariants)', only(errors, 'invariants'), true);
  }

  // 21: template_en 含 {OUTFIT}，slots 里删掉 OUTFIT 条目（正向闭合失败）。
  {
    const b = buildBaseBundle();
    b.slot_template.slots = b.slot_template.slots.filter((s) => s.name !== 'OUTFIT');
    const errors = validate(b, ajvValidateFn);
    check('template_en 含 {OUTFIT} 但 slots 缺失该条目正确 FAIL (axiom5 正向)', only(errors, '正向闭合'), true);
  }

  // 22: slots 定义了 GENDER，template_en 里没有 {GENDER}（反向闭合失败，死变量）。
  {
    const b = buildBaseBundle();
    b.slot_template.slots.push({ name: 'GENDER', observed_value: 'female', candidates: ['male', 'nonbinary'] });
    const errors = validate(b, ajvValidateFn);
    check('slots 定义 GENDER 但 template_en 未使用 {GENDER} 正确 FAIL (axiom5 反向)', only(errors, '反向闭合'), true);
  }

  // 23: template_zh 少一个槽位（删掉 {OUTFIT} 对应的中文部分）。
  {
    const b = buildBaseBundle();
    b.slot_template.template_zh = '一位 {AGE} 的 {ETHNICITY} 女性对镜头说话';
    const errors = validate(b, ajvValidateFn);
    check('template_zh 缺少 {OUTFIT} 正确 FAIL (axiom5 中英一致)', only(errors, '槽位集合与'), true);
  }

  // 24 (ajv additionalProperties): 顶层塞一个 schema 未声明的字段。
  {
    const b = buildBaseBundle();
    b.unexpected_field = 'should be rejected';
    const errors = validate(b, ajvValidateFn);
    check('顶层未知字段正确经 ajv additionalProperties 拒绝', errors.filter((e) => e.includes('additionalProperties') || e.includes('additional properties')), true);
  }

  // 25 (ajv enum): target_model 取值超出 4 值枚举。
  {
    const b = buildBaseBundle();
    b.target_model = 'kling';
    const errors = validate(b, ajvValidateFn);
    check('target_model="kling" 不在枚举内正确经 ajv enum 拒绝', errors.filter((e) => e.includes('allowed values')), true);
  }

  // 26 [bilingual]: shot 的 prompt_zh 混入了与 prompt_en 不一致的 {SLOT} token
  // （en 侧是 {COLOR}，zh 侧误写成 {TONE}）。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A woman looks into the phone camera in a {COLOR} kitchen, no text, no subtitles, no watermarks';
    b.shots[0].prompt_zh = '女人在厨房里对着手机镜头说话，背景是{TONE}色调';
    const errors = validate(b, ajvValidateFn);
    check('shot prompt_zh 的 {SLOT} token 与 prompt_en 不一致正确 FAIL ([bilingual])', only(errors, '[bilingual]'), true);
  }

  // 27 [bilingual]: shot 的 prompt_en/prompt_zh 携带同一个 {COLOR} token（集合相同），
  // 必须整体 PASS——验证这条检查真正执行了集合比较的匹配路径，不是靠"两边都没有槽位"
  // 空集合相等的平凡情况通过。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A woman looks into the phone camera in a {COLOR} kitchen, no text, no subtitles, no watermarks';
    b.shots[0].prompt_zh = '女人在{COLOR}色的厨房里对着手机镜头说话';
    const errors = validate(b, ajvValidateFn);
    check('shot prompt_en/prompt_zh 携带一致的 {COLOR} token 正确整体 PASS ([bilingual] 非平凡匹配路径)', errors, false);
  }

  // 28 [bilingual]（补缺口）: shot 的 prompt_en 有 {COLOR}，prompt_zh 把槽位整个删掉
  // （不是改名成别的 token，是一个 token 都不剩）——旧的"只在 zh 侧出现 token 时才比较"
  // 写法测不出这种漂移，改成无条件集合比较之后必须 FAIL。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A woman looks into the phone camera in a {COLOR} kitchen, no text, no subtitles, no watermarks';
    // prompt_zh 保持基准样例原文，不含任何 {SLOT} token。
    const errors = validate(b, ajvValidateFn);
    check('shot prompt_en 有 {COLOR} 但 prompt_zh 未携带任何槽位 token 正确 FAIL ([bilingual] 无条件比较补的缺口)', only(errors, '[bilingual]'), true);
  }

  // 29 [bilingual]（防误伤）: shots 和 visual_forms 的 prompt_en/prompt_zh 两侧都不含
  // 槽位 token——这是绝大多数反推产物的正常形态（模板槽位只该出现在 slot_template 里）。
  // 改成无条件集合比较后，空集合与空集合仍须判相等、照常 PASS，不能被这次改动误伤。
  {
    const b = buildBaseBundle();
    // 不做任何修改：基准样例的 shots/visual_forms prompt 本来就两侧都不带 {SLOT} token。
    const errors = validate(b, ajvValidateFn);
    check('shots/visual_forms 的 prompt_en/prompt_zh 两侧都不含槽位 token（最常见情况）正确整体 PASS ([bilingual] 无条件比较防误伤回归)', errors, false);
  }

  // ---- 4 处必修：每条至少一条堵绕过（FAIL）+ 一条防误伤（PASS） ----

  // 30（必修1，堵绕过）: slots[].observed_value/candidates[] 里塞满禁词——OUTFIT 槽的
  // observed_value/candidates 塞 AI 美化禁词，这些值会被
  // 字面代入 template_en 渲染成最终 prompt，之前完全没扫描，原样 PASS 零报错。
  {
    const b = buildBaseBundle();
    b.slot_template.slots[2] = {
      name: 'OUTFIT',
      observed_value: 'stunning studio-lit outfit',
      candidates: ['flawless glowing skin', 'perfect glamour makeup'],
    };
    const errors = validate(b, ajvValidateFn);
    check('slot_template.slots[].observed_value/candidates[] 塞禁词正确 FAIL ([axiom3] 必修1 补的扫描缺口)', only(errors, '[axiom3]'), true);
  }

  // 31（必修1，防误伤）: 基准样例的 slots[].observed_value/candidates 全是合法值
  // （28-year-old / Latina / beige hoodie 等），新增的扫描面不能把这些正常值误判成禁词。
  {
    const b = buildBaseBundle();
    const errors = validate(b, ajvValidateFn);
    check('基准样例 slots[].observed_value/candidates 均为合法值，新扫描面正确不误伤（axiom3 无报错）', only(errors, '[axiom3]'), false);
  }

  // 32（必修2，堵绕过）: 复数形式的真禁词被包在一段"伪后缀"里、后面再跟一份真正的
  // 强制后缀——stripMandatorySuffix 只切掉最后那一份真后缀，
  // 前面重复的 "no subtitles, no watermarks"（复数）因为禁词表只有单数 subtitle/
  // watermark 而整句免检，原样 PASS 零报错。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A woman holds a bottle, no subtitles, no watermarks, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('伪后缀重复藏复数真禁词正确 FAIL ([axiom3] 必修2 复数容错堵住的绕过)', only(errors, '[axiom3]'), true);
  }

  // 33（必修2，防误伤）: 与 32 同构，但去掉注入的那一份"伪后缀"重复，只留一份合法的
  // 强制后缀——必须整体 PASS，证明是"注入的重复片段"触发 FAIL，不是复数容错本身
  // 变得过度敏感。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A woman holds a bottle, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('去掉注入的伪后缀重复后、干净的单一合法后缀正确整体 PASS (axiom3 必修2 防误伤)', errors, false);
  }

  // 34（必修3，堵绕过 A）: 用连字符把禁词从中间拆开——
  // "beauti-ful"/"flaw-less"/"cine-matic" 归一化之前原样 PASS。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A beauti-ful woman with flaw-less skin under cine-matic light, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('连字符拆开的 beauti-ful/flaw-less/cine-matic 正确 FAIL ([axiom3] 必修3 去连字符归一化)', only(errors, '[axiom3]'), true);
  }

  // 35（必修3，堵绕过 B）: 词组类禁词用双空格拆开两个词——
  // "smooth  skin"（两个空格）归一化之前原样 PASS。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'Her  smooth  skin catches the light, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('双空格拆开的词组 "smooth  skin" 正确 FAIL ([axiom3] 必修3 折叠空白归一化)', only(errors, '[axiom3]'), true);
  }

  // 36（必修3，防误伤）: 正常书写的连字符复合词（well-lit / close-up）去掉连字符后不会
  // 拼出任何禁词，正常单空格间距也不该被误伤——必须整体 PASS。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A close-up, well-lit shot of the product on a counter, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('正常连字符复合词 close-up/well-lit 归一化后不误拼出禁词，正确整体 PASS (axiom3 必修3 防误伤)', errors, false);
  }

  // 37（必修4，堵绕过）: 相邻双花括号——分词器只认出内层
  // {AGE}，外层多出来的 "{" 和残留的 "}" 完全没被察觉，原样 PASS。
  {
    const b = buildBaseBundle();
    b.slot_template.template_en = 'A {{AGE}} {ETHNICITY} woman in a {OUTFIT} speaks to the camera, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('template_en 含相邻双花括号 {{AGE}} 正确 FAIL ([axiom5] 必修4 花括号规整性)', only(errors, '[axiom5]'), true);
  }

  // 38（必修4，防误伤）: 基准样例的 template_en/template_zh 都只有规整的单层 {SLOT}
  // token，没有嵌套或孤立花括号，新增的规整性检查不能把这种正常模板误判成 FAIL。
  {
    const b = buildBaseBundle();
    const errors = validate(b, ajvValidateFn);
    check('基准样例 template_en/template_zh 花括号规整，新检查正确不误伤（axiom5 无报错）', only(errors, '[axiom5]'), false);
  }

  // ---- 必修3 的回归：只做 collapsed 归一化会拆掉连字符复合词
  // 本来就管用的词边界防线。补 dual-variant（collapsed + spacedExempt）+ 文字层禁词专属
  // 豁免的回归覆盖：复合词攻击 FAIL、豁免相关 PASS、豁免反向利用 FAIL 三组。----

  // 39（复合词攻击，防漏抓）: "professional-grade" 若只做连字符删除会被拼成
  // "professionalgrade"、丢失词边界从而漏抓。此处验证 spacedExempt 变体能保留词边界并正确拦截。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A professional-grade camera captures the scene, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('复合词攻击 "professional-grade" 正确 FAIL ([axiom3] spacedExempt 变体堵住的回归)', only(errors, '[axiom3]'), true);
  }

  // 40（复合词攻击，堵回归）: 禁词处在复合词后半——"ultra-professional" 验证连字符
  // 换空格后 "professional" 前面也能正确触发词边界，不止后面。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'An ultra-professional setup fills the frame, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('复合词后半禁词 "ultra-professional" 正确 FAIL ([axiom3] spacedExempt 变体)', only(errors, '[axiom3]'), true);
  }

  // 41（复合词攻击，堵回归）: 换一个禁词（studio）+ 大写开头，验证不止 professional 一个
  // 词受益、且大小写不敏感在 spacedExempt 变体上依然成立。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'Studio-quality lighting fills the room, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('复合词攻击 "Studio-quality"（大写+不同禁词）正确 FAIL ([axiom3] spacedExempt 变体)', only(errors, '[axiom3]'), true);
  }

  // 42（复合词攻击，堵回归）: 两个禁词互相融合在同一个复合词里，两个都必须被抓到。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A flawless-perfect complexion glows, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('两禁词互相融合 "flawless-perfect" 正确 FAIL ([axiom3] spacedExempt 变体，两个都要抓到)', only(errors, '[axiom3]'), true);
  }

  // 43（已知代价，故意判 FAIL——不是 bug，这条测试变红先别"修好"它）: "text-to-speech"
  // 是真实常见的正当技术表达，但 "-to-" 豁免分支
  // 证实有洞——不校验第二个词是不是禁词，21 个禁词随便哪个都能套
  // "<文字层禁词>-to-<禁词>" 这张皮逃逸（见 TEXT_LAYER_EXEMPTION_RE 上方注释的完整
  // 说明）。"-to-" 分支不设，text-to-speech 不再豁免，会被 spacedExempt
  // 变体当成正文里的 "text" 命中。权衡后的决定：宁可多误伤这一个技术术语
  // （连同下面第 49 条的 speech-to-text），换回堵住那条逃逸通道——这条用例把这个权衡
  // 钉死，以后有人想放宽豁免会先在这里撞见、被迫重新评估，而不是顺手改掉。用户如果
  // 确实需要描述这类 App 功能，应改写成不含字面禁词的说法（如 "spoken-word
  // transcription"）。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'An app screen shows text-to-speech narration, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('已知代价（故意）: "text-to-speech" 不再豁免，正确 FAIL ([axiom3] "-to-" 豁免分支已删除)', only(errors, '[axiom3]'), true);
  }

  // 44（豁免相关，防误伤）: "logo-free" 是真实常见的正当表达（不带 logo）——同样需要豁免。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A logo-free plain white box on the table, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('正当表达 "logo-free" 正确整体 PASS (axiom3 文字层禁词豁免)', errors, false);
  }

  // 45（豁免相关，防误伤）: "watermark-free" 同上，另一个豁免用例。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A watermark-free archival print, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('正当表达 "watermark-free" 正确整体 PASS (axiom3 文字层禁词豁免)', errors, false);
  }

  // 46（豁免反向利用，防豁免被滥用）: "professional-free" 里 professional 是 AI 美化词，
  // 不在豁免范围内——英语里这个词组本身没有实际意义，只可能是刻意构造来利用豁免规则，
  // 必须仍被抓到。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A professional-free camera captures the scene, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('豁免反向利用 "professional-free"（AI美化词伪装否定构词）正确 FAIL ([axiom3] 豁免范围不含 AI 美化词)', only(errors, '[axiom3]'), true);
  }

  // 47（豁免反向利用）: "studio-less" 同上，studio 是 AI 美化词，不豁免。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A studio-less setup in the kitchen, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('豁免反向利用 "studio-less"（AI美化词+"-less"）正确 FAIL ([axiom3] 豁免范围不含 AI 美化词)', only(errors, '[axiom3]'), true);
  }

  // 48（豁免反向利用）: "glamour-to-plain"——glamour 是 AI 美化词，不在"文字层禁词
  // 专属"豁免范围内（豁免只对 TEXT_LAYER_WORDS 生效，见 TEXT_LAYER_EXEMPTION_RE 注释；
  // 且 "-to-" 分支不设豁免），换空格后照常被抓到。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A glamour-to-plain transition, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('豁免反向利用 "glamour-to-plain"（AI美化词+"-to-"）正确 FAIL ([axiom3] 豁免范围不含 AI 美化词)', only(errors, '[axiom3]'), true);
  }

  // ---- "-to-" 豁免分支本身有洞，不设；补已知代价锁定用例 +
  // 补堵住的 "-to-" 皮套攻击回归 ----

  // 49（已知代价，故意判 FAIL，与 43 同一条权衡，方向相反）: "speech-to-text" 是
  // "text-to-speech" 的反向说法，同样常见、同样正当，但 "text" 在后半——旧版 "-to-"
  // 豁免分支只认"文字层禁词在前"，这条从来就没被豁免到（方向性
  // 缺口）。删掉 "-to-" 分支后，它和 text-to-speech 待遇一致，两个都是已知代价，
  // 不是不对称的 bug。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'This device offers real-time speech-to-text transcription, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('已知代价（故意，与 43 对称）: "speech-to-text" 正确 FAIL ([axiom3] "-to-" 豁免分支已删除)', only(errors, '[axiom3]'), true);
  }

  // 50-54（堵回归，"-to-" 皮套攻击）: 不设 "-to-" 分支——其不校验
  // 第二个词是不是禁词，spacedExempt 把整段"文字层禁词-to-任意词"一起抹掉，第二个词
  // （哪怕本身就是禁词）跟着一起消失；collapsedVariant 删连字符后又把它焊进相邻字母、
  // 丢失词边界——两个变体同时失手，21 个禁词随便哪个都能套这张皮。删掉 "-to-" 分支后，
  // 这类字符串不再被豁免，直接走 hyphen->space，两个词都会被扫到。
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'The kiosk shows a text-to-professional upgrade prompt, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('"-to-" 皮套攻击 "text-to-professional" 正确 FAIL ([axiom3] "-to-" 豁免分支已删除堵住的绕过)', only(errors, '[axiom3]'), true);
  }
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'The screen fades from a logo-to-glamour transition, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('"-to-" 皮套攻击 "logo-to-glamour" 正确 FAIL ([axiom3] "-to-" 豁免分支已删除堵住的绕过)', only(errors, '[axiom3]'), true);
  }
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A font-to-watermark rendering pass runs in the background, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('"-to-" 皮套攻击 "font-to-watermark" 正确 FAIL ([axiom3] "-to-" 豁免分支已删除堵住的绕过)', only(errors, '[axiom3]'), true);
  }
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'The app performs a word-to-cinematic style transfer, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('"-to-" 皮套攻击 "word-to-cinematic" 正确 FAIL ([axiom3] "-to-" 豁免分支已删除堵住的绕过)', only(errors, '[axiom3]'), true);
  }
  {
    const b = buildBaseBundle();
    b.shots[0].prompt_en = 'A caption-to-beautiful auto-enhance toggle appears on screen, no text, no subtitles, no watermarks';
    const errors = validate(b, ajvValidateFn);
    check('"-to-" 皮套攻击 "caption-to-beautiful" 正确 FAIL ([axiom3] "-to-" 豁免分支已删除堵住的绕过)', only(errors, '[axiom3]'), true);
  }

  return allOk;
}

// ---- CLI 入口 ---------------------------------------------------------------
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node scripts/validate.js <file1.json> [file2.json ...]');
  console.log('       node scripts/validate.js --selftest');
  process.exit(1);
} else if (args[0] === '--selftest') {
  const ok = selftest();
  console.log(ok ? `\nSELFTEST: ALL 54 CHECKS BEHAVED AS EXPECTED` : '\nSELFTEST: AT LEAST ONE CHECK FAILED');
  process.exitCode = ok ? 0 : 1;
} else {
  const ajvValidateFn = loadAjvValidator();
  let allPass = true;
  args.forEach((f) => {
    const ok = runOne(f, ajvValidateFn);
    if (!ok) allPass = false;
  });
  process.exitCode = allPass ? 0 : 1;
}
