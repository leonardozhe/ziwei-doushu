'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, dict, isLocale, LOCALE_META, TOPIC_LABELS_EN, type DictKey, type Locale } from './dict';
import {
  BRANCH_EN, ELEMENT_EN, MINOR_STAR_EN, MAJOR_STAR_EN, PALACE_EN_FULL, PALACE_EN,
  SIHUA_EN, SIHUA_NAME_EN, STEM_EN, palaceShortEn, wuxingJuEn,
} from './chart-terms';
import {
  PATTERN_COND_TPL_EN, PATTERN_DESC_TPL_EN, PATTERN_NAME_EN, patternTemplateKey,
} from './pattern-terms';

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey) => string;
  /** 13 维标签按当前语言返回 */
  topicLabel: (topic: string) => string;
  /** 带占位符的翻译，如 tf('chart.board.ageRange', { start: 3, end: 12 }) */
  tf: (key: DictKey, vars: Record<string, string | number>) => string;
  /** 宫位名 → 当前语言的盘面用名（英文界面返回 "Life Palace"） */
  palaceName: (name: string) => string;
  /** 宫位名 → 紧凑短名（英文界面返回 "Life"） */
  palaceShort: (name: string) => string;
  /** 星曜名 → 当前语言的盘面用名 */
  starName: (name: string) => string;
  /** 四化单字（禄/权/科/忌）→ 当前语言 */
  siHuaName: (siHua: string) => string;
  /** 四化全称（化禄/化权/…）→ 当前语言 */
  siHuaFull: (siHua: string) => string;
  /** 地支 → 当前语言 */
  branchName: (branch: string) => string;
  /** 天干 → 当前语言 */
  stemName: (stem: string) => string;
  /** 五行局整串（'水二局'）→ 当前语言 */
  juName: (name: string) => string;
  /** 格局名 → 当前语言 */
  patternName: (name: string) => string;
  /** 格局释义（中文原文）→ 当前语言 */
  patternDesc: (desc: string) => string;
  /** 格局成立条件（中文原文）→ 当前语言 */
  patternCond: (cond: string) => string;
}

/**
 * 把英文模板里的 {star} / {palace} / {branch} 占位符填成英文星名 / 宫名。
 *
 * 做法：从中文原文里按同样的归一化顺序取出占位符对应的中文词，
 * 再逐个换成英文。模板与原文的占位符顺序一一对应（生成时已校验），
 * 所以按下标顺序替换即可。
 */
function fillPatternTemplate(tpl: string, zh: string): string {
  const tokens = patternPlaceholders(zh);
  let i = 0;
  return tpl.replace(/\{(star|palace|branch)\}/g, (_m, kind: 'star' | 'palace' | 'branch') => {
    const tok = tokens[i++];
    if (!tok) return '';
    return kind === 'star' ? starEn(tok) : kind === 'palace' ? palaceEn(tok) : branchEn(tok);
  });
}

/** 从中文原文里按归一化顺序取出占位符对应的中文词 */
function patternPlaceholders(zh: string): string[] {
  const out: string[] = [];
  let s = zh;
  let i = 0;
  while (i < s.length) {
    let hit: string | null = null;
    for (const b of BRANCH_LIST) {
      if (s.startsWith(b + '宫', i)) { hit = b; break; }
    }
    if (hit === null) {
      for (const st of STAR_LIST) {
        if (s.startsWith(st, i)) { hit = st; break; }
      }
    }
    if (hit === null) {
      for (const pl of PALACE_LIST) {
        if (s.startsWith(pl, i)) { hit = pl; break; }
      }
    }
    if (hit !== null) { out.push(hit); i += hit.length; }
    else i += 1;
  }
  return out;
}

/** 归一化用的词表（与 pattern-terms.ts 的模板生成口径一致） */
const STAR_LIST = [
  '紫微','天机','太阳','武曲','天同','廉贞','天府','太阴','贪狼','巨门','天相','天梁','七杀','破军',
  '禄存','天马','天魁','天钺','左辅','右弼','文昌','文曲','擎羊','陀罗','火星','铃星','地空','地劫',
];
const PALACE_LIST = [
  '命宫','身宫','兄弟','夫妻','子女','财帛','疾厄','迁移','仆役','官禄','田宅','福德','父母','迁宫',
];
const BRANCH_LIST = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

/** 英文星名 */
function starEn(name: string): string {
  return MAJOR_STAR_EN[name] ?? MINOR_STAR_EN[name] ?? name;
}

/** 英文宫名 */
function palaceEn(name: string): string {
  return PALACE_EN_FULL[name] ?? PALACE_EN[name] ?? name;
}

/** 英文地支 */
function branchEn(name: string): string {
  return BRANCH_EN[name] ?? name;
}

const I18nContext = createContext<I18nValue | null>(null);
const STORAGE_KEY = 'ziwei-locale';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) {
      setLocaleState(saved);
      return;
    }
    // 没手动选过语言时，跟随浏览器
    const browser = window.navigator.language.slice(0, 2).toLowerCase();
    if (isLocale(browser)) setLocaleState(browser);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = LOCALE_META[locale].htmlLang;
  }, [locale]);

  const value = useMemo<I18nValue>(() => {
    const en = locale === 'en';
    // 中文界面全部回落到中文原名；英文界面才查对照表
    const pick = <T,>(table: Record<string, T>, key: string, fallback: T): T =>
      (en ? table[key] : undefined) ?? fallback;

    return {
      locale,
      setLocale,
      t: (key) => dict[locale][key] ?? dict.zh[key] ?? key,
      topicLabel: (topic) =>
        locale === 'zh'
          ? (dict.zh as Record<string, string>)[`topic.${topic}`] ?? topic
          : TOPIC_LABELS_EN[topic] ?? topic,
      tf: (key, vars) => {
        const raw = dict[locale][key] ?? dict.zh[key] ?? key;
        return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
          Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`,
        );
      },
      palaceName: (name) => pick(PALACE_EN_FULL, name, pick(PALACE_EN, name, name)),
      palaceShort: (name) => (en ? palaceShortEn(name) : name.replace(/宫$/, '')),
      starName: (name) =>
        en ? MAJOR_STAR_EN[name] ?? MINOR_STAR_EN[name] ?? name : name,
      siHuaName: (s) => pick(SIHUA_EN, s, s),
      siHuaFull: (s) => pick(SIHUA_NAME_EN, s, s),
      branchName: (b) => pick(BRANCH_EN, b, b),
      stemName: (s) => pick(STEM_EN, s, s),
      juName: (name) => (en ? wuxingJuEn(name) : name),
      patternName: (name) => (en ? PATTERN_NAME_EN[name] ?? name : name),
      patternDesc: (desc) => {
        if (!en) return desc;
        const tpl = PATTERN_DESC_TPL_EN[patternTemplateKey(desc)];
        if (!tpl) return desc;
        // 把模板里的占位符填回中文原文里对应的星名 / 宫名
        return fillPatternTemplate(tpl, desc);
      },
      patternCond: (cond) => {
        if (!en) return cond;
        const tpl = PATTERN_COND_TPL_EN[patternTemplateKey(cond)];
        if (!tpl) return cond;
        return fillPatternTemplate(tpl, cond);
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
