'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import BirthForm from '@/components/BirthForm';
import ChartBoard from '@/components/ChartBoard';
import InsightPanel from '@/components/InsightPanel';
import DatasetReading from '@/components/DatasetReading';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import TimeNav, { type TimeView } from '@/components/TimeNav';
import { generateChart } from '@/lib/ziwei/algorithm';
import { useI18n } from '@/lib/i18n/provider';
import type { BirthInfo, ZiweiChart, Palace } from '@/lib/ziwei/types';
import { parseBirthFromSearch, birthToSearch } from '@/lib/ziwei/birth-url';

/**
 * 命盘页 —— 开源版「排盘引擎 Demo」
 *
 * 这是一个最小可运行示例：用本仓库的排盘引擎 generateChart() 配合基础 UI
 * 组件，渲染一张完整紫微命盘 + 基础解读，并支持本命 / 大限 / 流年切换。
 *
 * 说明：线上商业版的完整交互界面（重设计的新 UI、AI 流式解读、合盘、分享
 * 卡片等）不在开源范围内；但排盘内核——安星算法、四化、格局识别、古籍库——
 * 完全开放（见 lib/ziwei/*），可自由二次开发出你自己的界面。
 */
export default function ChartPage() {
  // useSearchParams 需要 Suspense 边界（App Router 静态化要求）
  return (
    <Suspense fallback={<ChartPageFallback />}>
      <ChartPageInner />
    </Suspense>
  );
}

function ChartPageFallback() {
  const { t } = useI18n();
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px' }}>
      {t('chart.loading')}
    </main>
  );
}

function ChartPageInner() {
  const { t } = useI18n();
  const [chart, setChart] = useState<ZiweiChart | null>(null);
  const [selectedPalace, setSelectedPalace] = useState<Palace | null>(null);
  const [view, setView] = useState<TimeView>('mingpan');
  const [liunianYear, setLiunianYear] = useState(() => new Date().getFullYear());
  const searchParams = useSearchParams();

  // ── URL 直达：/chart?y=1990&m=1&d=1&h=4&g=male 直接起盘 ──
  // 依赖 searchParams.toString()（字符串）而不是 searchParams 对象本身 ——
  // 每次渲染 searchParams 都是新对象，直接依赖它会让 effect 反复触发。
  const searchKey = searchParams.toString();

  useEffect(() => {
    const birth = parseBirthFromSearch(searchKey);
    if (!birth) return;
    try {
      setChart(generateChart(birth));
    } catch {
      // 日期不存在等非法参数：留在表单页让用户改
      setChart(null);
    }
  }, [searchKey]);

  // ── 未起盘：展示出生信息表单 ──
  if (!chart) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{t('chart.page.title')}</h1>
        <p style={{ color: '#888', marginBottom: 32, fontSize: 14, lineHeight: 1.7 }}>
          {t('chart.page.desc')}
          <br />
          {t('chart.page.desc2')}
        </p>
        <BirthForm
          onSubmit={(info: BirthInfo) => {
            setChart(generateChart(info));
            if (typeof window !== 'undefined') {
              window.history.replaceState(null, '', `/chart?${birthToSearch(info)}`);
            }
          }}
        />
      </main>
    );
  }

  // ── 已起盘：命盘 + 解读 ──
  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <LocaleSwitcher />
      </div>
      <button
        type="button"
        onClick={() => {
          setChart(null);
          setSelectedPalace(null);
          if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', window.location.pathname);
          }
        }}
        style={{
          marginBottom: 16, padding: '6px 14px', cursor: 'pointer',
          border: '1px solid #ccc', borderRadius: 8, background: 'transparent',
        }}
      >
        ← {t('chart.reset')}
      </button>

      <TimeNav
        chart={chart}
        view={view}
        liunianYear={liunianYear}
        onViewChange={setView}
        onYearChange={setLiunianYear}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 380px)',
          gap: 20, marginTop: 16, alignItems: 'start',
        }}
      >
        <ChartBoard chart={chart} onPalaceSelect={setSelectedPalace} />
        <InsightPanel chart={chart} selectedPalace={selectedPalace} />
      </div>

      {/* 解读数据集 v4.0：这一张盘在数据集里的 13 维解读（确定性，无需 API Key） */}
      <section style={{ maxWidth: 1280, margin: '40px auto 0', padding: '0 16px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>{t('chart.dataset.title')}</h2>
        <p style={{ color: '#888', fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          {t('chart.dataset.desc')}
        </p>
        <DatasetReading
          year={chart.birthInfo.year}
          month={chart.birthInfo.month}
          day={chart.birthInfo.day}
          hour={chart.birthInfo.hour}
          gender={chart.birthInfo.gender}
        />
      </section>
    </main>
  );
}
