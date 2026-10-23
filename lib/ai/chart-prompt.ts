import type { ZiweiChart, Palace, Star } from '@/lib/ziwei/types';
import { TOPIC_LABELS, type Topic } from '@/lib/db/readings';

/**
 * 命盘 → 提示词。
 *
 * 三层信息，缺一不可：
 *   1. **命盘结构**：12 宫、主星、四化、大限 —— 让模型知道这张盘长什么样
 *   2. **断语库**：数据集 v4.0 里这张盘已定稿的 13 维解读 —— 让模型有据可依，
 *      而不是自由发挥（这是「倪师体系」和「网络玄学」的分界线）
 *   3. **回答纪律**：明确要求引用依据、不编造、不越界
 *
 * 之所以把断语库当 grounding：数据集本身就是按倪海厦体系逐句校正过的，
 * 直接让模型复述+组织，比让它从零推理可靠得多。
 */

const BRANCH_NAMES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const STEM_NAMES = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];

/** 星曜按重要性排序：主星在前，煞星其次，吉星最后 */
function starWeight(s: Star): number {
  if (s.type === 'major') return 0;
  if (s.type === 'sha') return 1;
  if (s.type === 'minor') return 2;
  return 3;
}

function formatStar(s: Star): string {
  const bits = [s.name];
  if (s.brightnessRaw) bits.push(s.brightnessRaw);
  if (s.siHua) bits.push(`化${s.siHua}`);
  return bits.join('');
}

function formatPalace(p: Palace): string {
  const header = [
    `${p.name}${p.isMingGong ? '（命宫）' : ''}${p.isShenGong ? '（身宫）' : ''}`,
    `${STEM_NAMES[p.stem] ?? '?'}${BRANCH_NAMES[p.branch] ?? '?'}`,
    p.daXianAge ? `大限${p.daXianAge[0]}–${p.daXianAge[1]}` : '',
  ].filter(Boolean).join(' ');

  const stars = [...p.stars].sort((a, b) => starWeight(a) - starWeight(b));
  let starText = stars.map(formatStar).join('、');
  if (p.isEmpty) {
    const borrowed = p.borrowedStars?.length ? p.borrowedStars.join('、') : '对宫主星';
    starText = `空宫（借${p.borrowedFromName ?? '对宫'}的${borrowed}）`;
  }

  const selfHua = p.selfSihua?.length
    ? `；自化：${p.selfSihua.map((h) => `${h.starName}化${h.siHua}`).join('、')}`
    : '';

  return `· ${header}：${starText}${selfHua}`;
}

/** 把命盘序列化成一段结构化的中文描述 */
export function serializeChart(chart: ZiweiChart): string {
  const b = chart.birthInfo;
  const genderLabel = b.gender === 'male' ? '男' : '女';

  const lines: string[] = [];
  lines.push('【出生信息】');
  lines.push(
    `公历 ${b.year}年${b.month}月${b.day}日，时辰序号 ${b.hour}（${BRANCH_NAMES[b.hour]}时），${genderLabel}命` +
    (b.province || b.city ? `，出生地 ${b.province ?? ''}${b.city ?? ''}` : ''),
  );

  const lunar = chart.lunarInfo;
  if (lunar) {
    const leap = lunar.isLeapMonth ? '闰' : '';
    const pillars = lunar.fourPillars?.length ? `，四柱 ${lunar.fourPillars.join(' ')}` : '';
    lines.push(
      `农历 ${lunar.lunarYear}年${leap}${Math.abs(lunar.lunarMonth)}月${lunar.lunarDay}日${pillars}`,
    );
  }

  lines.push('');
  lines.push('【基本盘】');
  lines.push(`五行局：${chart.wuxingJuName}`);
  lines.push(`命宫：${BRANCH_NAMES[chart.mingGongBranch]}宫；身宫：${BRANCH_NAMES[chart.shenGongBranch]}宫`);
  if (chart.mingZhu) lines.push(`命主：${chart.mingZhu}${chart.shenZhu ? `；身主：${chart.shenZhu}` : ''}`);
  if (chart.yinYangGender) lines.push(`阴阳性别：${chart.yinYangGender}`);

  lines.push('');
  lines.push('【十二宫】');
  // 从命宫开始顺时针列出，符合读盘习惯
  const ordered = [...chart.palaces].sort(
    (a, b2) => ((a.branch - chart.mingGongBranch + 12) % 12) - ((b2.branch - chart.mingGongBranch + 12) % 12),
  );
  for (const p of ordered) lines.push(formatPalace(p));

  if (chart.daXians?.length) {
    lines.push('');
    lines.push('【大限】');
    const current = chart.daXians[chart.currentDaXianIndex];
    lines.push(
      `当前虚岁 ${chart.currentAge} 岁` +
      (current ? `，走 ${current.startAge}–${current.endAge} 岁大限（${current.palaceName}宫）` : ''),
    );
    for (const d of chart.daXians) {
      const siHua = d.siHua
        ? `　四化：${d.siHua.lu}禄 ${d.siHua.quan}权 ${d.siHua.ke}科 ${d.siHua.ji}忌`
        : '';
      lines.push(`· ${d.startAge}–${d.endAge} 岁 ${d.palaceName}宫${siHua}`);
    }
  }

  return lines.join('\n');
}

/** 用户问题 → 相关维度（用于挑选 grounding 片段） */
const TOPIC_KEYWORDS: [Topic, RegExp][] = [
  ['love', /感情|婚姻|恋爱|桃花|配偶|老公|老婆|对象|结婚|离婚|分手|姻缘/],
  ['career', /事业|工作|职业|升职|创业|老板|跳槽|面试|职场|生意/],
  ['wealth', /财|钱|收入|投资|理财|破财|赚钱|工资|股|基金|负债/],
  ['health', /健康|病|身体|养生|医|脏腑|睡眠|疲劳/],
  ['personality', /性格|个性|脾气|心态|习惯/],
  ['parents', /父母|长辈|爸爸|妈妈|父亲|母亲/],
  ['children', /子女|孩子|生育|怀孕|儿女/],
  ['family', /兄弟|姐妹|合伙|手足/],
  ['friends', /朋友|人际|贵人|小人|同事|社交/],
  ['move', /搬家|出国|迁移|外地|留学|移民|旅行/],
  ['home', /房子|房产|田宅|不动产|置业/],
  ['spirit', /精神|心理|情绪|福德|压力|焦虑|抑郁/],
];

/** 按问题挑选需要注入的维度：永远带 overview，再按关键词补 */
export function pickGroundingTopics(question: string): Topic[] {
  const picked = new Set<Topic>(['overview']);

  for (const [topic, re] of TOPIC_KEYWORDS) {
    if (re.test(question)) picked.add(topic);
  }
  // 问大限/流年时，命格总览之外再补性格（论运先论人）
  if (/大限|流年|运势|今年|明年|未来/.test(question)) {
    picked.add('personality');
  }

  return [...picked];
}

export interface GroundingReading {
  topic: string;
  content: string;
}

/**
 * 组装送给模型的消息。
 *
 * 结构：
 *   system  = 角色 + 回答纪律 + 完整命盘 + 断语库片段
 *   user/assistant = 对话历史（最近 N 轮）
 */
export function buildMessages(
  chart: ZiweiChart,
  readings: GroundingReading[],
  history: { role: 'user' | 'assistant'; content: string }[],
  opts: { maxGroundingChars?: number; maxHistoryTurns?: number } = {},
) {
  const maxGrounding = opts.maxGroundingChars ?? 9000;
  const maxHistory = opts.maxHistoryTurns ?? 8;

  // ── 断语库片段（按预算截断，优先保留靠前的维度）──
  const groundingParts: string[] = [];
  let used = 0;
  for (const r of readings) {
    if (!r.content) continue;
    const label = TOPIC_LABELS[r.topic as Topic] ?? r.topic;
    const remain = maxGrounding - used;
    if (remain < 200) break;
    const body = r.content.length > remain
      ? `${r.content.slice(0, remain)}…（已截断）`
      : r.content;
    groundingParts.push(`〔${label}〕\n${body}`);
    used += body.length;
  }

  const system = [
    '你是一位精通倪海厦《天纪》体系紫微斗数的命理师，正在为一位来访者解读他的命盘。',
    '',
    '## 回答纪律（必须遵守）',
    '1. 只依据下面提供的**这张命盘**和**断语库**作答，不要套用其他命盘的结论。',
    '2. 断语库里已有的判断，优先采用它的口径和用词；需要展开时基于它推理，不要另起炉灶。',
    '3. 每条关键结论后面尽量注明依据（哪个宫、哪颗星、什么四化），让来访者能对照盘面。',
    '4. 不做医疗、投资、法律、婚姻等重大决策的替代建议；涉及风险时明确提示「仅供参考」。',
    '5. 如果断语库没有覆盖，坦率说明「这一点资料没有覆盖」，不要编造。',
    '6. 用简体中文，语气平实、具体，避免玄虚和恐吓性表述。',
    '',
    '## 命盘',
    serializeChart(chart),
    '',
    '## 断语库（该盘已定稿的解读，按维组织）',
    groundingParts.length ? groundingParts.join('\n\n') : '（无）',
  ].join('\n');

  // 只保留最近 N 轮，且保证开头是 user（避免以 assistant 开头）
  const recent = history.slice(-maxHistory * 2);
  const firstUser = recent.findIndex((m) => m.role === 'user');
  const trimmed = firstUser >= 0 ? recent.slice(firstUser) : recent;

  return [
    { role: 'system' as const, content: system },
    ...trimmed.map((m) => ({ role: m.role, content: m.content })),
  ];
}
