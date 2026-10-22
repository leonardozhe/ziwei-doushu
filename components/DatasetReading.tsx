'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18n } from '@/lib/i18n/provider';

interface Topic {
  topic: string;
  label: string;
  charCount: number;
  content: string;
}

interface DatasetReadingProps {
  year: number;
  month: number;
  day: number;
  hour: number;
  gender: 'male' | 'female';
}

const TOPIC_ORDER = [
  'overview', 'personality', 'love', 'career', 'wealth', 'health',
  'family', 'children', 'move', 'friends', 'home', 'spirit', 'parents',
];

/**
 * 解读数据集面板 —— 直接展示 v4.0 数据集里这一张盘的 13 维解读。
 *
 * 与 InsightPanel（AI 流式解读，需要自行实现 /api/interpret）的区别：
 *   这里返回的是**确定性**的断语文本，同一盘永远同一结果，不需要 API Key。
 */
export default function DatasetReading({ year, month, day, hour, gender }: DatasetReadingProps) {
  const { t, topicLabel } = useI18n();
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [active, setActive] = useState<string>('overview');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams({
      year: String(year), month: String(month), day: String(day),
      hour: String(hour), gender,
    });

    fetch(`/api/reading?${qs}`)
      .then((r) => r.json().then((body) => ({ status: r.status, body })))
      .then(({ status, body }) => {
        if (cancelled) return;
        if (!body.ok) {
          setError(body.error ?? 'failed to load reading');
          setTopics([]);
        } else {
          const list = (body.topics ?? []) as Topic[];
          setTopics(list);
          setActive((prev) => (list.some((x) => x.topic === prev) ? prev : 'overview'));
        }
      })
      .catch((e) => { if (!cancelled) { setError(String(e)); setTopics([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [year, month, day, hour, gender]);

  if (loading) {
    return (
      <div className="rounded-xl border border-current/10 p-6 text-sm opacity-70">
        {t('reading.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 p-6 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (!topics || topics.length === 0) {
    return (
      <div className="rounded-xl border border-current/10 p-6 text-sm opacity-70">
        {t('reading.empty')}
      </div>
    );
  }

  const ordered = TOPIC_ORDER
    .map((k) => topics.find((x) => x.topic === k))
    .filter((x): x is Topic => !!x);
  const current = ordered.find((x) => x.topic === active) ?? ordered[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {ordered.map((tp) => (
          <button
            key={tp.topic}
            type="button"
            onClick={() => setActive(tp.topic)}
            className={
              tp.topic === active
                ? 'rounded-full bg-current/10 px-3 py-1 text-xs font-medium'
                : 'rounded-full border border-current/15 px-3 py-1 text-xs opacity-70 hover:opacity-100'
            }
          >
            {topicLabel(tp.topic)}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {current && (
          <motion.article
            key={current.topic}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="rounded-xl border border-current/10 p-5 text-sm leading-7"
          >
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold">{topicLabel(current.topic)}</h3>
              <span className="text-xs opacity-50">{current.charCount.toLocaleString()} chars</span>
            </div>
            <div className="whitespace-pre-wrap">{current.content}</div>
          </motion.article>
        )}
      </AnimatePresence>

      <p className="text-xs opacity-45">{t('reading.source')}</p>
    </div>
  );
}
