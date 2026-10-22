'use client';
import { useI18n } from '@/lib/i18n/provider';
import { LOCALES, LOCALE_META } from '@/lib/i18n/dict';

/** 语言切换器 —— 基础盘的国际化的入口 */
export default function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <div className={`inline-flex items-center gap-1 rounded-full border border-current/20 px-1 py-0.5 ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={
            locale === l
              ? 'rounded-full bg-current/10 px-2 py-0.5 text-xs font-medium'
              : 'rounded-full px-2 py-0.5 text-xs opacity-60 hover:opacity-100'
          }
        >
          {LOCALE_META[l].label}
        </button>
      ))}
    </div>
  );
}
