'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { MediaCard, type MediaCardItem } from '@/components/media-card';
import { MediaRail } from '@/components/media-rail';
import { SmartImage } from '@/components/smart-image';
import { Icon } from '@/components/icon';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import type { DoubanItem } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * 动漫专区：
 * - 顶部是本周放送表（Bangumi 每日放送），默认定位到今天；
 * - 追番清单存在本地，不上传、不登录；
 * - 下方接豆瓣「动画 / 日本动画」两条片单，点击即跨源搜索。
 */

const WEEKDAYS = [
  { value: 1, label: '周一', short: '一' },
  { value: 2, label: '周二', short: '二' },
  { value: 3, label: '周三', short: '三' },
  { value: 4, label: '周四', short: '四' },
  { value: 5, label: '周五', short: '五' },
  { value: 6, label: '周六', short: '六' },
  { value: 7, label: '周日', short: '日' },
];

const FOLLOW_KEY = 'mujian-anime-follow';

type FollowItem = { id: string; title: string; cover: string; rating?: string };

export default function AnimePage() {
  const router = useRouter();
  const { toast } = useToast();
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);

  const today = new Date().getDay() || 7;
  const [day, setDay] = useState<number>(today);
  const [follows, setFollows] = useState<FollowItem[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FOLLOW_KEY);
      if (raw) setFollows(JSON.parse(raw) as FollowItem[]);
    } catch {
      /* 本地清单损坏时静默重来 */
    }
  }, []);

  const calendar = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const animeMovies = useQuery({
    queryKey: ['douban', 'movie', '动画', 0, 18],
    queryFn: ({ signal }) => api.douban('movie', '动画', 0, 18, signal),
    staleTime: 10 * 60_000,
  });
  const animeSeries = useQuery({
    queryKey: ['douban', 'tv', '日本动画', 0, 18],
    queryFn: ({ signal }) => api.douban('tv', '日本动画', 0, 18, signal),
    staleTime: 10 * 60_000,
  });

  const days = useMemo(() => calendar.data?.days ?? [], [calendar.data]);
  const todayItems = useMemo(
    () => days.find((d) => d.weekday === today)?.items ?? [],
    [days, today]
  );
  const dayItems = useMemo(() => days.find((d) => d.weekday === day)?.items ?? [], [days, day]);
  const weekTotal = useMemo(() => {
    const seen = new Set<string>();
    for (const d of days) for (const item of d.items) seen.add(item.id);
    return seen.size;
  }, [days]);

  // Bangumi 在部分网络下不可达：自动切到豆瓣「日本动画」，页面不空着。
  const calendarFailed = calendar.isError;
  const fallbackItems = animeSeries.data?.items ?? [];
  const displayItems = calendarFailed ? fallbackItems : dayItems;
  const previewItems = calendarFailed
    ? fallbackItems
    : todayItems.length
      ? todayItems
      : days.flatMap((d) => d.items);
  const fallbackLoading = calendarFailed && animeSeries.isLoading;

  const followIds = useMemo(() => new Set(follows.map((f) => f.id)), [follows]);

  const toggleFollow = (item: DoubanItem) => {
    const exists = followIds.has(item.id);
    const next = exists
      ? follows.filter((f) => f.id !== item.id)
      : [...follows, { id: item.id, title: item.title, cover: item.cover, rating: item.rating }];
    setFollows(next);
    try {
      localStorage.setItem(FOLLOW_KEY, JSON.stringify(next));
    } catch {
      /* 隐私模式等写入失败时不影响本次会话 */
    }
    toast(exists ? `已从追番移除「${item.title}」` : `已加入追番「${item.title}」`, exists ? 'info' : 'success');
  };

  const search = (title: string) => router.push(`/?s=${encodeURIComponent(title)}`);

  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      {/* 头部 */}
      <section className="relative overflow-hidden rounded-[26px] border border-line/70 bg-[#14100e] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(80%_120%_at_88%_-10%,#5a2418_0%,#241310_38%,#14100e_72%)]" />
        <div className="grain absolute inset-0 opacity-[0.22] mix-blend-overlay" />
        <span
          aria-hidden
          className="font-display pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 select-none text-[150px] leading-none tracking-[0.2em] text-white/[0.04] sm:text-[200px]"
        >
          アニメ
        </span>

        <div className="relative flex flex-col gap-8 p-6 sm:p-9 lg:min-h-[290px] lg:flex-row lg:items-center lg:justify-between lg:p-11">
          <div className="max-w-[520px]">
            <p className="text-[10px] font-medium tracking-[0.4em] text-white/45">ANIME / 动漫放送</p>
            <h1 className="font-display mt-3 text-[40px] leading-none tracking-[0.04em] sm:text-[52px]">
              每周追番
            </h1>
            <p className="mt-4 max-w-[420px] text-[12.5px] leading-6 text-white/50">
              新番表按日本时间每日更新。挑一部加入追番，等它更新，再回到幕间把它看完。
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-white/55">
              {calendarFailed ? (
                <>
                  <span>
                    <span className="font-display mr-1.5 text-[22px] tabular-nums text-white">
                      {fallbackItems.length || '—'}
                    </span>
                    部本周新番
                  </span>
                  <span className="h-4 w-px bg-white/15" />
                  <span>豆瓣日本动画</span>
                </>
              ) : (
                <>
                  <span>
                    <span className="font-display mr-1.5 text-[22px] tabular-nums text-white">{weekTotal || '—'}</span>
                    部本周在播
                  </span>
                  <span className="h-4 w-px bg-white/15" />
                  <span>
                    <span className="font-display mr-1.5 text-[22px] tabular-nums text-white">{todayItems.length || '—'}</span>
                    部今日更新
                  </span>
                </>
              )}
              <span className="h-4 w-px bg-white/15" />
              <span>{follows.length} 部在追</span>
            </div>
          </div>

          <div className="relative hidden h-[190px] w-[330px] shrink-0 lg:block">
            {previewItems.slice(0, 3).map((item, i) => (
              <div
                key={item.id}
                className={cn(
                  'absolute w-[118px] overflow-hidden rounded-lg border border-white/15 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]',
                  i === 0 && 'left-1 top-8 -rotate-6',
                  i === 1 && 'left-[104px] top-1 rotate-2',
                  i === 2 && 'left-[214px] top-12 rotate-6'
                )}
                style={{ zIndex: 3 - i }}
              >
                <div className="aspect-[2/3] bg-white/5">
                  {item.cover ? (
                    <SmartImage
                      url={item.cover}
                      mode={imageProxyMode}
                      customProxy={customImageProxy}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/20">
                      <Icon name="anime" className="h-7 w-7" />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <span className="absolute bottom-0 left-2 text-[10px] tracking-[0.24em] text-white/30">ON AIR</span>
          </div>
        </div>
      </section>

      {/* 放送表 */}
      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-1.5">{calendarFailed ? 'WEEKLY PICKS' : 'SIMULCAST CALENDAR'}</p>
            <h2 className="font-display text-[25px] tracking-[0.04em] text-content">
              {calendarFailed ? '本周新番' : '每日放送表'}
            </h2>
          </div>
          {!calendarFailed && (
            <div className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-line bg-surface/70 p-1">
              {WEEKDAYS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => setDay(w.value)}
                  className={cn(
                    'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] transition-colors',
                    day === w.value
                      ? 'bg-chip text-content shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                      : 'text-faint hover:text-content'
                  )}
                >
                  {w.label}
                  {w.value === today && <span className="h-1 w-1 rounded-full bg-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="mt-3 text-[11.5px] text-faint">
          {calendarFailed ? (
            <>Bangumi 放送表当前不可达，先看看豆瓣的日本动画 · {fallbackItems.length} 部</>
          ) : (
            <>
              {day === today ? '今天的放送' : `周${WEEKDAYS.find((w) => w.value === day)?.short}的放送`}
              {' · '}
              {dayItems.length} 部
            </>
          )}
        </p>

        <div className="mt-5">
          {calendar.isLoading || fallbackLoading ? (
            <AnimeGridSkeleton />
          ) : displayItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-[12.5px] text-faint">
              {calendarFailed ? '豆瓣片单也暂时不可用，请稍后刷新。' : '这一天暂时没有收录的放送。'}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
              {displayItems.map((item) => (
                <div key={item.id} className="group relative">
                  <MediaCard
                    item={{ id: item.id, title: item.title, cover: item.cover, rating: item.rating }}
                    onClick={() => search(item.title)}
                  />
                  <FollowButton
                    followed={followIds.has(item.id)}
                    title={item.title}
                    onClick={() => toggleFollow(item)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 追番 */}
      {follows.length > 0 && (
        <section className="mt-12">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="eyebrow mb-1.5">MY LIST</p>
              <h2 className="font-display text-[23px] tracking-[0.04em] text-content">我的追番</h2>
            </div>
            <span className="text-[11px] text-faint">{follows.length} 部 · 仅保存在本机</span>
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {follows.map((item) => (
              <div key={item.id} className="group relative">
                <MediaCard
                  item={{ id: item.id, title: item.title, cover: item.cover, rating: item.rating }}
                  onClick={() => search(item.title)}
                />
                <FollowButton followed title={item.title} onClick={() => toggleFollow(item as DoubanItem)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 豆瓣片单 */}
      <div className="mt-14 space-y-11">
        <MediaRail
          eyebrow="ANIME FILMS"
          title="动画电影"
          items={(animeMovies.data?.items ?? []).map(toCard)}
          loading={animeMovies.isLoading}
          onPick={(item) => search(item.title)}
        />
        <MediaRail
          eyebrow="JAPANESE SERIES"
          title="日本动画"
          items={(animeSeries.data?.items ?? []).map(toCard)}
          loading={animeSeries.isLoading}
          onPick={(item) => search(item.title)}
        />
      </div>

      <footer className="mt-16 flex flex-col items-center gap-2 border-t border-line/70 pt-6 text-[10.5px] text-faint sm:flex-row sm:justify-between">
        <span>
          {calendarFailed ? '本周新番来自豆瓣 · 放送表暂不可用' : '放送数据来自 Bangumi 番组计划 · 片单来自豆瓣'}
        </span>
        <span>幕间仅提供检索与播放整理，不存储任何视频文件</span>
      </footer>
    </div>
  );
}

function FollowButton({ followed, title, onClick }: { followed: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={followed ? `取消追番 ${title}` : `加入追番 ${title}`}
      title={followed ? '取消追番' : '加入追番'}
      className={cn(
        'absolute left-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur-sm transition-all',
        followed
          ? 'border-accent/60 bg-accent text-on-accent'
          : 'border-white/20 bg-black/35 text-white/80 opacity-100 hover:bg-black/60 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100'
      )}
    >
      <Icon name="bookmark" className={cn('h-3.5 w-3.5', followed && 'fill-current')} />
    </button>
  );
}

function AnimeGridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] animate-pulse rounded-xl bg-chip" />
          <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-chip" />
        </div>
      ))}
    </div>
  );
}

function toCard(item: DoubanItem): MediaCardItem {
  return { id: item.id, title: item.title, cover: item.cover, rating: item.rating };
}
