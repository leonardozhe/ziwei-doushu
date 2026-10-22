/**
 * 国际化字典 —— 基础盘的第一块砖。
 *
 * 现状：站点本体是中文的（`lang="zh-CN"`），这里先把「界面文案」抽成可切换的字典，
 * 让后续加英文站 / 其他语种时不用再翻遍组件。
 *
 * 约定：
 *   - key 用语义名，不用中文原文
 *   - 英文文案是给海外用户看的，不用中文直译腔
 *   - 命理术语保留中文音译 + 英文通行叫法，见 TERMS
 */

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh';

export const LOCALE_META: Record<Locale, { label: string; htmlLang: string; flag: string }> = {
  zh: { label: '中文', htmlLang: 'zh-CN', flag: '🇨🇳' },
  en: { label: 'English', htmlLang: 'en', flag: '🇺🇸' },
};

export const dict = {
  zh: {
    'site.title': '紫微命盘',
    'site.tagline': '按出生时辰起盘，看清一生格局',
    'site.subtitle': '基于倪海厦正宗紫微斗数体系',

    'form.title': '生辰资料',
    'form.name': '称呼',
    'form.namePlaceholder': '选填',
    'form.year': '出生年',
    'form.month': '月',
    'form.day': '日',
    'form.clock': '出生时刻',
    'form.unknownTime': '不知道时辰',
    'form.province': '出生地',
    'form.gender': '性别',
    'form.gender.male': '男',
    'form.gender.female': '女',
    'form.submit': '立即起盘',
    'form.needDate': '请填写完整的出生日期',
    'form.needTime': '请选择出生时刻，或勾选「不知道时辰」',
    'form.needGender': '请选择性别',

    'chart.mingpan': '本命',
    'chart.daxian': '大限',
    'chart.liunian': '流年',
    'chart.reset': '重新起盘',
    'chart.age': '虚岁',

    'palace.ming': '命宫',
    'palace.shen': '身宫',
    'palace.empty': '空宫',

    'reading.title': '命盘解读',
    'reading.loading': '解读生成中…',
    'reading.empty': '暂无解读',
    'reading.source': '解读数据来源：紫微斗数开源解读数据集 v4.0',

    'footer.about': '关于',
    'footer.terms': '服务条款',
    'footer.privacy': '隐私政策',
    'footer.dataCredit': '本项目使用了紫微斗数开源解读数据集 v4.0',
    'footer.dataCreditLink': 'https://github.com/Renhuai123/ziwei-doushu',
    'topic.overview': '命格总览',
    'topic.personality': '性格特质',
    'topic.love': '感情婚姻',
    'topic.career': '事业职业',
    'topic.wealth': '财富运势',
    'topic.health': '健康状况',
    'topic.family': '兄弟合伙',
    'topic.children': '子女缘分',
    'topic.move': '迁移外出',
    'topic.friends': '人际贵人',
    'topic.home': '田宅不动产',
    'topic.spirit': '精神福德',
    'topic.parents': '父母长辈',
  },
  en: {
    'site.title': 'Zi Wei Dou Shu',
    'site.tagline': 'Read your destiny from the stars',
    'site.subtitle': 'Classical Chinese astrology, computed for your birth moment',

    'form.title': 'Birth details',
    'form.name': 'Name',
    'form.namePlaceholder': 'Optional',
    'form.year': 'Year',
    'form.month': 'Month',
    'form.day': 'Day',
    'form.clock': 'Time of birth',
    'form.unknownTime': 'Unknown time',
    'form.province': 'Birthplace',
    'form.gender': 'Gender',
    'form.gender.male': 'Male',
    'form.gender.female': 'Female',
    'form.submit': 'Generate my chart',
    'form.needDate': 'Please enter a complete birth date',
    'form.needTime': 'Please pick a birth time, or tick "Unknown time"',
    'form.needGender': 'Please select a gender',

    'chart.mingpan': 'Natal',
    'chart.daxian': 'Decade',
    'chart.liunian': 'Annual',
    'chart.reset': 'Start over',
    'chart.age': 'Age',

    'palace.ming': 'Life Palace',
    'palace.shen': 'Body Palace',
    'palace.empty': 'Empty',

    'reading.title': 'Chart reading',
    'reading.loading': 'Preparing your reading…',
    'reading.empty': 'No reading available',
    'reading.source': 'Reading data: Ziwei Doushu Open Interpretation Dataset v4.0',

    'footer.about': 'About',
    'footer.terms': 'Terms',
    'footer.privacy': 'Privacy',
    'footer.dataCredit': 'Uses the Ziwei Doushu Open Interpretation Dataset v4.0',
    'footer.dataCreditLink': 'https://github.com/Renhuai123/ziwei-doushu',
    'topic.overview': 'Overall Chart',
    'topic.personality': 'Personality',
    'topic.love': 'Love & Marriage',
    'topic.career': 'Career',
    'topic.wealth': 'Wealth',
    'topic.health': 'Health',
    'topic.family': 'Siblings & Partners',
    'topic.children': 'Children',
    'topic.move': 'Travel & Migration',
    'topic.friends': 'Friends & Support',
    'topic.home': 'Home & Property',
    'topic.spirit': 'Mind & Spirit',
    'topic.parents': 'Parents',
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type DictKey = keyof (typeof dict)['zh'];

/** 13 维解读的英文名 */
export const TOPIC_LABELS_EN: Record<string, string> = {
  overview: 'Overall Chart',
  personality: 'Personality',
  love: 'Love & Marriage',
  career: 'Career',
  wealth: 'Wealth',
  health: 'Health',
  family: 'Siblings & Partners',
  children: 'Children',
  move: 'Travel & Migration',
  friends: 'Friends & Support',
  home: 'Home & Property',
  spirit: 'Mind & Spirit',
  parents: 'Parents',
};

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
