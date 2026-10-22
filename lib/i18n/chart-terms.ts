/**
 * 命盘专用术语英译表 —— 盘面元素（宫位 / 星曜 / 四化 / 干支 / 五行局）的英文名。
 *
 * 为什么单独一张表，不塞进 dict.ts：
 *   dict.ts 是「界面文案字典」（一句一句的 UI 文本），这里是「专有名词对照表」
 *   （一个中文词 → 一个固定英文名），性质不同、数量也不同。
 *
 * 口径（与 lib/ziwei/shier-shen.ts 的 SHIER_SHEN_EN 保持一致）：
 *   1. 十四主星用「通行英文叫法 + 拼音」，海外用户能认出来：
 *      太阳 → Sun、太阴 → Moon、紫微 → Zi Wei、天府 → Tian Fu …
 *      通行叫法本身没有歧义时就不再重复中文。
 *   2. 其余星曜（辅星 / 杂曜 / 煞星）一律用拼音，因为没有公认的英文译名，
 *      硬译反而会让用户对不上盘面。拼音能帮用户在中文盘图上反查。
 *   3. 宫位名用「通行英文名」（Life Palace / Wealth Palace …），
 *      这是海外用户唯一真正需要读懂的盘面信息。
 *
 * 拼音撞名处理：主星与杂曜共用同一音节时（天府 / 天福、天钺 / 天月），
 * 杂曜一侧加括号限定词，避免盘面上两颗不同的星显示成同一个名字。
 */

/** 十四主星：中文 → 英文（通行叫法优先，能用英文的就用英文） */
export const MAJOR_STAR_EN: Record<string, string> = {
  紫微: 'Zi Wei',
  天机: 'Tian Ji',
  太阳: 'Sun',
  武曲: 'Wu Qu',
  天同: 'Tian Tong',
  廉贞: 'Lian Zhen',
  天府: 'Tian Fu',
  太阴: 'Moon',
  贪狼: 'Tan Lang',
  巨门: 'Ju Men',
  天相: 'Tian Xiang',
  天梁: 'Tian Liang',
  七杀: 'Qi Sha',
  破军: 'Po Jun',
};

/** 辅星 / 杂曜 / 煞星：中文 → 拼音 */
export const MINOR_STAR_EN: Record<string, string> = {
  // 辅星
  左辅: 'Zuo Fu', 右弼: 'You Bi', 文昌: 'Wen Chang', 文曲: 'Wen Qu',
  天魁: 'Tian Kui', 天钺: 'Tian Yue', 禄存: 'Lu Cun', 天马: 'Tian Ma',
  // 煞星
  擎羊: 'Qing Yang', 陀罗: 'Tuo Luo', 火星: 'Huo Xing', 铃星: 'Ling Xing',
  地空: 'Di Kong', 地劫: 'Di Jie', 天空: 'Tian Kong', 旬空: 'Xun Kong',
  副旬: 'Fu Xun', 截路: 'Jie Lu', 截空: 'Jie Kong', 副截: 'Fu Jie',
  大耗: 'Da Hao', 天使: 'Tian Shi', 天伤: 'Tian Shang', 天刑: 'Tian Xing',
  天哭: 'Tian Ku', 天虚: 'Tian Xu', 天月: 'Tian Yue (Moon)', 阴煞: 'Yin Sha',
  蜚廉: 'Fei Lian', 空亡: 'Kong Wang', 孤辰: 'Gu Chen', 寡宿: 'Gua Su',
  劫煞: 'Jie Sha',
  // 吉杂曜
  天官: 'Tian Guan', 天福: 'Tian Fu (Blessing)', 天才: 'Tian Cai', 天寿: 'Tian Shou',
  三台: 'San Tai', 八座: 'Ba Zuo', 恩光: 'En Guang', 天贵: 'Tian Gui',
  台辅: 'Tai Fu', 龙池: 'Long Chi', 凤阁: 'Feng Ge', 红鸾: 'Hong Luan',
  天喜: 'Tian Xi', 解神: 'Jie Shen', 天德: 'Tian De', 月德: 'Yue De',
  年解: 'Nian Jie', 天巫: 'Tian Wu', 华盖: 'Hua Gai', 封诰: 'Feng Gao',
  咸池: 'Xian Chi', 破碎: 'Po Sui', 天厨: 'Tian Chu', 天姚: 'Tian Yao',
  龙德: 'Long De',
};

/** 十二宫名：中文 → 英文（通行叫法） */
export const PALACE_EN: Record<string, string> = {
  命宫: 'Life Palace',
  兄弟: 'Siblings Palace',
  夫妻: 'Spouse Palace',
  子女: 'Children Palace',
  财帛: 'Wealth Palace',
  疾厄: 'Health Palace',
  迁移: 'Travel Palace',
  仆役: 'Friends Palace',
  交友: 'Friends Palace',
  官禄: 'Career Palace',
  田宅: 'Property Palace',
  福德: 'Spirit Palace',
  父母: 'Parents Palace',
};

/** 十二宫名（带「宫」后缀的写法）→ 英文 */
export const PALACE_EN_FULL: Record<string, string> = {
  命宫: 'Life Palace',
  兄弟宫: 'Siblings Palace',
  夫妻宫: 'Spouse Palace',
  子女宫: 'Children Palace',
  财帛宫: 'Wealth Palace',
  疾厄宫: 'Health Palace',
  迁移宫: 'Travel Palace',
  仆役宫: 'Friends Palace',
  交友宫: 'Friends Palace',
  官禄宫: 'Career Palace',
  田宅宫: 'Property Palace',
  福德宫: 'Spirit Palace',
  父母宫: 'Parents Palace',
};

/** 四化：中文 → 英文 */
export const SIHUA_EN: Record<string, string> = {
  禄: 'Lu',
  权: 'Quan',
  科: 'Ke',
  忌: 'Ji',
};

/** 四化全称：中文 → 英文（星曜名 + 化X 的组合） */
export const SIHUA_NAME_EN: Record<string, string> = {
  化禄: 'Hua Lu', 化权: 'Hua Quan', 化科: 'Hua Ke', 化忌: 'Hua Ji',
};

/** 地支 → 英文（天干地支是排盘的坐标轴，用国际通行的中国生肖/拼音） */
export const BRANCH_EN: Record<string, string> = {
  子: 'Zi', 丑: 'Chou', 寅: 'Yin', 卯: 'Mao', 辰: 'Chen', 巳: 'Si',
  午: 'Wu', 未: 'Wei', 申: 'Shen', 酉: 'You', 戌: 'Xu', 亥: 'Hai',
};

/** 天干 → 英文 */
export const STEM_EN: Record<string, string> = {
  甲: 'Jia', 乙: 'Yi', 丙: 'Bing', 丁: 'Ding', 戊: 'Wu',
  己: 'Ji', 庚: 'Geng', 辛: 'Xin', 壬: 'Ren', 癸: 'Gui',
};

/** 五行 → 英文 */
export const ELEMENT_EN: Record<string, string> = {
  金: 'Metal', 木: 'Wood', 水: 'Water', 火: 'Fire', 土: 'Earth',
};

/** 五行局：'水二局' 这类整串 → 英文 */
export function wuxingJuEn(name: string): string {
  const m = name.match(/^([金木水火土])(\d)局$/);
  if (!m) return name;
  const el = ELEMENT_EN[m[1]] ?? m[1];
  const ord = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][Number(m[2])] ?? m[2];
  return `${el} ${ord}`;
}

/** 星曜名 → 英文（主星优先，其次辅星；查不到返回原名） */
export function starEn(name: string): string {
  return MAJOR_STAR_EN[name] ?? MINOR_STAR_EN[name] ?? name;
}

/** 宫位名 → 英文（同时兼容带「宫」与不带的写法） */
export function palaceEn(name: string): string {
  return PALACE_EN_FULL[name] ?? PALACE_EN[name] ?? name;
}

/**
 * 宫位名的「短标签」——盘格里地方不够，英文全称太长。
 * 返回短名（Life / Siblings / Spouse …），用于大限列表、格局标签这类紧凑位置。
 */
export const PALACE_EN_SHORT: Record<string, string> = {
  命宫: 'Life', 兄弟: 'Siblings', 兄弟宫: 'Siblings',
  夫妻: 'Spouse', 夫妻宫: 'Spouse',
  子女: 'Children', 子女宫: 'Children',
  财帛: 'Wealth', 财帛宫: 'Wealth',
  疾厄: 'Health', 疾厄宫: 'Health',
  迁移: 'Travel', 迁移宫: 'Travel',
  仆役: 'Friends', 仆役宫: 'Friends',
  交友: 'Friends', 交友宫: 'Friends',
  官禄: 'Career', 官禄宫: 'Career',
  田宅: 'Property', 田宅宫: 'Property',
  福德: 'Spirit', 福德宫: 'Spirit',
  父母: 'Parents', 父母宫: 'Parents',
};

/** 宫位短标签 */
export function palaceShortEn(name: string): string {
  return PALACE_EN_SHORT[name] ?? name.replace(/宫$/, '');
}
