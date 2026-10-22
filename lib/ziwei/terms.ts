/**
 * 命理术语表 —— 检索倒排索引的词表来源。
 *
 * 背景：v4.0 全量 877 万段解读（204 亿字）上做任意子串检索无法走索引
 * （实测 6 年范围要 65 秒）。但命理术语是**有限集合**，
 * 把「哪张盘提到哪个术语」预计算成倒排表，检索就能做到秒级。
 *
 * 词表构成（与 lib/ziwei/constants.ts 的引擎常量保持一致）：
 *   - 14 主星
 *   - 12 宫位（含「XX宫」与简称两种写法）
 *   - 四化（禄权科忌）
 *   - 辅星常见者
 *   - 五行 / 天干 / 地支
 *   - 格局与断法关键词
 */

export type TermType =
  | 'major_star'   // 十四主星
  | 'palace'       // 十二宫位
  | 'sihua'        // 四化
  | 'minor_star'   // 辅星
  | 'element'      // 五行
  | 'stem'         // 天干
  | 'branch'       // 地支
  | 'pattern'      // 格局
  | 'method';      // 断法 / 法则

export interface TermDef {
  term: string;
  type: TermType;
}

/** 十四主星 */
const MAJOR_STARS = [
  '紫微', '天机', '太阳', '武曲', '天同', '廉贞', '天府', '太阴',
  '贪狼', '巨门', '天相', '天梁', '七杀', '破军',
];

/** 十二宫位（简称 + 全称两种写法都收录） */
const PALACES: [string, string[]][] = [
  ['命宫', ['命宫', '命宮']],
  ['兄弟宫', ['兄弟宫', '兄弟宮']],
  ['夫妻宫', ['夫妻宫', '夫妻宮']],
  ['子女宫', ['子女宫', '子女宮']],
  ['财帛宫', ['财帛宫', '財帛宮']],
  ['疾厄宫', ['疾厄宫', '疾厄宮']],
  ['迁移宫', ['迁移宫', '遷移宮']],
  ['交友宫', ['交友宫', '交友宮', '仆役宫']],
  ['官禄宫', ['官禄宫', '官祿宮', '事业宫']],
  ['田宅宫', ['田宅宫', '田宅宮']],
  ['福德宫', ['福德宫', '福德宮']],
  ['父母宫', ['父母宫', '父母宮']],
];

/** 四化 */
const SIHUA = ['化禄', '化权', '化科', '化忌'];

/** 常见辅星 */
const MINOR_STARS = [
  '左辅', '右弼', '文昌', '文曲', '天魁', '天钺', '禄存', '擎羊', '陀罗',
  '火星', '铃星', '地空', '地劫', '天马', '红鸾', '天喜', '孤辰', '寡宿',
  '天姚', '天刑', '天伤', '天虚', '龙池', '凤阁', '三台', '八座', '恩光',
  '天官', '天贵', '台辅', '封诰', '旬空', '截空', '解神', '天巫', '天月',
  '解神', '天德', '月德', '天福', '天才', '天哭', '天虚', '华盖', '咸池',
];

/**
 * 五行 / 天干 / 地支：正文里是**单字**，作为独立术语噪声太大
 * （「子」匹配 67 万张盘全部，「不」「得」这类更是命中所有盘）。
 * 这里只保留有辨识度的多字组合：
 *   - 五行：木性/火性/土性/金性/水性
 *   - 天干：甲木/乙木/丙火/丁火/戊土/己土/庚金/辛金/壬水/癸水
 *   - 地支：子年/丑年/寅年…（年柱语境）、子时/丑时…（时辰语境）
 */
const ELEMENTS = ['木性', '火性', '土性', '金性', '水性'];

const STEMS = [
  '甲木', '乙木', '丙火', '丁火', '戊土', '己土',
  '庚金', '辛金', '壬水', '癸水',
];

const BRANCHES = [
  '子年', '丑年', '寅年', '卯年', '辰年', '巳年',
  '午年', '未年', '申年', '酉年', '戌年', '亥年',
  '子时', '丑时', '寅时', '卯时', '辰时', '巳时',
  '午时', '未时', '申时', '酉时', '戌时', '亥时',
];

/** 常见格局与组合 */
const PATTERNS = [
  '紫府同宫', '日月并明', '七杀朝斗', '火贪格', '火贪', '铃贪',
  '君臣庆会', '三奇', '三台', '八座', '文昌', '文曲',
  '机月同梁', '阳梁昌禄', '太阳天梁', '天府', '太阴', '禄存', '擎羊', '陀罗',
  '桃花', '红鸾天喜', '天姚', '孤辰寡宿', '空亡', '旬空',
  '化禄', '化权', '化科', '化忌', '自化', '飞星', '四化',
];

/** 断法 / 法则关键词 */
const METHODS = [
  '身宫', '命主', '身主', '三方四正', '大限', '流年', '小限',
  '流月', '流日', '流时', '童限',
  '十二宫', '十四主星', '辅星', '煞星', '吉星',
  '入庙', '落陷', '旺地', '得地', '庙旺', '陷地', '庙旺地', '不得地',
  '本命盘', '大限盘', '流年盘', '三方', '对宫', '会照', '夹宫',
  '子午流注', '十二宫论', '格局', '用神', '喜忌', '忌神',
];

/** 汇总成去重后的术语表 */
function buildTerms(): TermDef[] {
  const seen = new Map<string, TermType>();
  const add = (term: string, type: TermType) => {
    if (!term) return;
    if (!seen.has(term)) seen.set(term, type);
  };

  // 单字术语在正文里噪声太大（实测「不」「得」「子」会命中全部 67 万张盘），
  // 这里统一要求至少 2 个字。
  for (const s of MAJOR_STARS) add(s, 'major_star');
  for (const [, variants] of PALACES) for (const v of variants) add(v, 'palace');
  for (const s of SIHUA) add(s, 'sihua');
  for (const s of MINOR_STARS) add(s, 'minor_star');
  for (const s of ELEMENTS) add(s, 'element');
  for (const s of STEMS) add(s, 'stem');
  for (const s of BRANCHES) add(s, 'branch');
  for (const s of PATTERNS) add(s, 'pattern');
  for (const s of METHODS) add(s, 'method');

  return [...seen.entries()]
    .filter(([term]) => term.length >= 2)
    .map(([term, type]) => ({ term, type }));
}

export const TERMS: TermDef[] = buildTerms();

/** 术语 → 类型 的快速查找 */
export const TERM_TYPES: Record<string, TermType> = Object.fromEntries(
  TERMS.map((t) => [t.term, t.type]),
);

/** 术语类型的中文名（用于展示） */
export const TERM_TYPE_LABELS: Record<TermType, string> = {
  major_star: '主星',
  palace: '宫位',
  sihua: '四化',
  minor_star: '辅星',
  element: '五行',
  stem: '天干',
  branch: '地支',
  pattern: '格局',
  method: '断法',
};
