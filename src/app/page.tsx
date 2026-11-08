'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { DetailModal } from '@/components/detail-modal';
import { MediaRail } from '@/components/media-rail';
import { type MediaCardItem } from '@/components/media-card';
import { AggregatedCard, aggregateResults } from '@/components/video-card';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';
import { SmartImage } from '@/components/smart-image';
import { EmptyState } from '@/components/states';
import { Icon } from '@/components/icon';
import { useToast } from '@/components/toast';
import { useAppStore, resolveSource, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { api } from '@/lib/client-api';
import { db } from '@/lib/db';
import type { DoubanItem, SearchResultItem, SourceSearchOutcome } from '@/lib/types';
import { buildWatchUrl, cn, formatDisableTtl, validateSourceUrl } from '@/lib/utils';

/**
 * 发现页：
 * - 有 ?s= 时进入搜索结果视图；
 * - 无搜索时是一张电影感海报（本期推荐）+ 搜索 + 几条横向片单。
 * 搜索仍由 URL 驱动，可后退/分享；流式结果边到边渲染。
 */

const RESULT_PAGE_SIZE = 60;

export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const urlQuery = searchParams.get('s') || '';

  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);

  const [input, setInput] = useState(urlQuery);
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);
  const [streamedOutcomes, setStreamedOutcomes] = useState<SourceSearchOutcome[]>([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (urlQuery) setInput(urlQuery);
  }, [urlQuery]);

  const sourceName = (key: string) =>
    customAPIs.find((a) => a.key === key)?.name ?? envSources.find((a) => a.key === key)?.name ?? key;

  const selectedSources = useMemo(() => {
    const seen = new Set<string>();
    return selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is NonNullable<typeof s> => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      })
      .filter((s) => !isSourceDisabled({ sourceHealth }, s.key))
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);

  const disabledSources = useMemo(
    () => selectedKeys.filter((key) => isSourceDisabled({ sourceHealth }, key)),
    [selectedKeys, sourceHealth]
  );
  const offSubscriptionSources = useMemo(
    () =>
      selectedKeys.filter(
        (key) => !isSourceDisabled({ sourceHealth }, key) && isInDisabledSubscription({ subscriptions }, key)
      ),
    [selectedKeys, sourceHealth, subscriptions]
  );

  const searchQuery = useQuery({
    queryKey: ['search', urlQuery, selectedKeys, yellowFilter],
    queryFn: ({ signal }) => {
      setStreamedOutcomes([]);
      return api.search(urlQuery.slice(0, 100), selectedSources, yellowFilter, {
        signal,
        onSource: (outcome) => {
          setStreamedOutcomes((prev) => [...prev, outcome]);
          for (const ev of useAppStore.getState().recordSourceHealth([outcome])) {
            toast(
              ev.permanent
                ? `「${sourceName(ev.key)}」多次失败，已停止参与搜索，可在设置中恢复`
                : `「${sourceName(ev.key)}」连续超时/失败，已停用 ${formatDisableTtl(ev.ttlMs ?? 0)}`,
              'warning'
            );
          }
        },
      });
    },
    enabled: Boolean(urlQuery) && selectedSources.length > 0,
    staleTime: 300_000,
  });

  const searchHistory = useSearchHistory(input);

  const runSearch = (q: string) => {
    const query = q.trim().slice(0, 100);
    if (!query) {
      toast('请输入搜索内容', 'info');
      inputRef.current?.focus();
      return;
    }
    router.push(`/?s=${encodeURIComponent(query)}`, { scroll: false });
    searchHistory.record(query);
  };

  const pickHistory = (text: string) => {
    setInput(text);
    searchHistory.close();
    runSearch(text);
  };

  const isSearching = Boolean(urlQuery) && searchQuery.isFetching && !searchQuery.data;
  const streamedList = useMemo(() => streamedOutcomes.flatMap((o) => o.list), [streamedOutcomes]);
  const list = useMemo(
    () => searchQuery.data?.list ?? (isSearching ? streamedList : []),
    [searchQuery.data, isSearching, streamedList]
  );
  const failures =
    searchQuery.data?.failures ??
    streamedOutcomes
      .filter((o) => !o.ok)
      .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败', timedOut: o.timedOut }));
  const groups = useMemo(() => aggregateResults(list), [list]);

  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE);
  const visibleGroups = useMemo(() => groups.slice(0, visibleCount), [groups, visibleCount]);
  useEffect(() => setVisibleCount(RESULT_PAGE_SIZE), [groups]);

  /* ---------------------------------------------------------------- */
  /* 首页片单数据                                                       */
  /* ---------------------------------------------------------------- */

  const moviesQuery = useQuery({
    queryKey: ['douban', 'movie', '热门', 0, 18],
    queryFn: ({ signal }) => api.douban('movie', '热门', 0, 18, signal),
    enabled: doubanEnabled,
    staleTime: 10 * 60_000,
  });
  const tvQuery = useQuery({
    queryKey: ['douban', 'tv', '热门', 0, 18],
    queryFn: ({ signal }) => api.douban('tv', '热门', 0, 18, signal),
    enabled: doubanEnabled,
    staleTime: 10 * 60_000,
  });
  const bangumiQuery = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
    enabled: doubanEnabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
  // Bangumi 不可达时，用豆瓣「日本动画」补上动漫片单，避免首页缺一条轨道。
  const animeFallbackQuery = useQuery({
    queryKey: ['douban', 'tv', '日本动画', 0, 18],
    queryFn: ({ signal }) => api.douban('tv', '日本动画', 0, 18, signal),
    enabled: doubanEnabled,
    staleTime: 10 * 60_000,
  });
  const hotQuery = useQuery({
    queryKey: ['hot-list', 'douban_movie_weekly'],
    queryFn: ({ signal }) => api.hotList('douban_movie_weekly', signal),
    enabled: doubanEnabled,
    staleTime: 10 * 60_000,
  });

  const movieItems = moviesQuery.data?.items ?? [];
  const tvItems = tvQuery.data?.items ?? [];
  const animeFallbackItems = animeFallbackQuery.data?.items ?? [];

  useEffect(() => {
    if (heroIndex >= movieItems.length) setHeroIndex(0);
  }, [heroIndex, movieItems.length]);

  const featured = movieItems[heroIndex] ?? movieItems[0];

  const bangumiItems = useMemo(() => {
    const days = bangumiQuery.data?.days ?? [];
    const today = new Date().getDay() || 7;
    const ordered = [...days].sort(
      (a, b) => ((a.weekday - today + 7) % 7) - ((b.weekday - today + 7) % 7)
    );
    const seen = new Set<string>();
    return ordered.flatMap((day) =>
      day.items
        .filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })
        .map((item) => ({ item, today: day.weekday === today }))
    );
  }, [bangumiQuery.data]);

  const history = useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(10).toArray(), []);

  const continueItems: MediaCardItem[] =
    history?.map((h) => {
      const source = resolveSource({ customAPIs, envSources }, h.sourceKey);
      return {
        id: h.id,
        title: h.title,
        cover: h.pic,
        subtitle: `看到第 ${h.episodeIndex + 1} 集`,
        progress: h.duration > 0 ? Math.min(1, h.playbackPosition / h.duration) : undefined,
        href: buildWatchUrl({
          sourceKey: h.sourceKey,
          vodId: h.vodId,
          index: h.episodeIndex,
          title: h.title,
          sourceUrl: source?.url,
          detail: source?.detail,
        }),
      } as MediaCardItem & { href: string };
    }) ?? [];

  const toCard = (item: DoubanItem, subtitle?: string): MediaCardItem => ({
    id: item.id,
    title: item.title,
    cover: item.cover,
    rating: item.rating,
    subtitle,
  });

  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      {urlQuery ? (
        <SearchView
          urlQuery={urlQuery}
          input={input}
          setInput={setInput}
          inputRef={inputRef}
          onSubmit={() => runSearch(input)}
          searchHistory={searchHistory}
          pickHistory={pickHistory}
          isSearching={isSearching}
          groups={groups}
          visibleGroups={visibleGroups}
          listLength={list.length}
          failures={failures}
          disabledSources={disabledSources}
          offSubscriptionSources={offSubscriptionSources}
          selectedSourcesCount={selectedSources.length}
          hasAnySources={customAPIs.length > 0 || envSources.length > 0}
          totalGroups={groups.length}
          visibleCount={visibleCount}
          onLoadMore={() => setVisibleCount((v) => v + RESULT_PAGE_SIZE)}
          onOpen={(item) => setDetailItem(item)}
          sourceName={sourceName}
        />
      ) : (
        <>
          <section className="relative overflow-hidden rounded-[26px] border border-line/70 bg-[#0b0b0c] text-white shadow-[0_30px_80px_-50px_rgba(0,0,0,0.8)]">
            <div className="absolute inset-0">
              {featured?.cover ? (
                <SmartImage
                  url={featured.cover}
                  mode={imageProxyMode}
                  customProxy={customImageProxy}
                  alt={featured.title}
                  loading="eager"
                  className="h-full w-full object-cover object-[62%_18%] opacity-75 saturate-[0.9]"
                />
              ) : (
                <div className="h-full w-full bg-[radial-gradient(90%_90%_at_75%_10%,#3a1c14_0%,#140d0b_48%,#0b0b0c_100%)]" />
              )}
              <div className="absolute inset-0 bg-[linear-gradient(90deg,#0b0b0c_0%,rgba(11,11,12,0.94)_34%,rgba(11,11,12,0.52)_62%,rgba(11,11,12,0.18)_100%)]" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0c] via-transparent to-[#0b0b0c]/30" />
              <div className="grain absolute inset-0 opacity-[0.18] mix-blend-overlay" />
            </div>

            <div className="relative flex min-h-[430px] flex-col justify-between p-6 sm:p-9 lg:min-h-[470px] lg:p-12">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[10px] tracking-[0.22em] text-white/70 backdrop-blur">
                  <span className="h-1 w-1 rounded-full bg-accent" />
                  幕间 · 本期放映
                </span>
                <span className="hidden font-display text-[11px] tracking-[0.3em] text-white/35 sm:block">
                  NO. {String(heroIndex + 1).padStart(2, '0')}
                </span>
              </div>

              <div className="max-w-[580px]">
                <p className="text-[10px] font-medium tracking-[0.38em] text-white/45">FEATURED FILM</p>
                <h1 className="font-display mt-3 line-clamp-2 text-[40px] leading-[1.08] tracking-[0.03em] sm:text-[54px]">
                  {featured?.title ?? '今晚，留给一部好电影'}
                </h1>

                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11.5px] text-white/60">
                  {featured?.rating && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 font-medium tabular-nums text-[#e8bd72]">
                      ★ {featured.rating}
                    </span>
                  )}
                  <span className="tracking-[0.14em]">豆瓣热门</span>
                  <span className="h-3 w-px bg-white/20" />
                  <span>剧情 · 精选</span>
                  <span className="h-3 w-px bg-white/20" />
                  <span>片源由你配置</span>
                </div>

                <p className="mt-4 max-w-[440px] text-[12.5px] leading-6 text-white/50">
                  幕间不提供片源，只负责把灯关掉。选一部想看的，按下搜索，剩下的交给你的片单。
                </p>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => featured && runSearch(featured.title)}
                    className="btn-primary h-10 gap-2 px-5 text-[13px]"
                  >
                    搜索片源
                    <Icon name="arrowUpRight" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHeroIndex((i) => (movieItems.length ? (i + 1) % movieItems.length : 0))}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-4 text-[12.5px] text-white/70 backdrop-blur transition-colors hover:border-white/30 hover:bg-white/[0.09] hover:text-white"
                  >
                    <Icon name="refresh" className="h-3.5 w-3.5" />
                    换一部
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* 搜索条压在海报下沿：浮起来，而不是嵌进图里 */}
          <div className="relative z-10 -mt-7 px-3 sm:px-6 lg:px-10">
            <div className="rounded-2xl border border-line bg-surface/95 p-2 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.5)] backdrop-blur-xl">
              <SearchBox
                input={input}
                setInput={setInput}
                inputRef={inputRef}
                onSubmit={() => runSearch(input)}
                searchHistory={searchHistory}
                onPick={pickHistory}
              />
            </div>
            {searchHistory.matches.length > 0 && !input.trim() && (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1 text-[11px] text-faint">
                <span className="tracking-[0.16em]">最近</span>
                {searchHistory.matches.slice(0, 5).map((h) => (
                  <button
                    key={h.text}
                    type="button"
                    onClick={() => pickHistory(h.text)}
                    className="rounded-full border border-line/80 bg-surface px-2.5 py-1 text-muted transition-colors hover:border-accent/40 hover:text-content"
                  >
                    {h.text}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-12 space-y-11">
            {continueItems.length > 0 && (
              <MediaRail
                eyebrow="CONTINUE WATCHING"
                title="继续观看"
                items={continueItems}
                onPick={(item) => {
                  const href = (item as MediaCardItem & { href?: string }).href;
                  if (href) router.push(href);
                }}
              />
            )}

            {doubanEnabled && (
              <>
                <MediaRail
                  eyebrow="NOW SHOWING"
                  title="正在热映"
                  items={movieItems.map((i) => toCard(i, '豆瓣热门'))}
                  loading={moviesQuery.isLoading}
                  onPick={(item) => runSearch(item.title)}
                  action={
                    <Link href="/anime" className="hidden text-[11px] text-faint transition-colors hover:text-content sm:block">
                      动漫专区 →
                    </Link>
                  }
                />

                <MediaRail
                  eyebrow="ACCLAIMED SERIES"
                  title="口碑剧集"
                  items={tvItems.map((i) => toCard(i, '剧集'))}
                  loading={tvQuery.isLoading}
                  onPick={(item) => runSearch(item.title)}
                />
              </>
            )}

            {doubanEnabled && (bangumiItems.length > 0 || animeFallbackItems.length > 0) && (
              <MediaRail
                eyebrow={bangumiItems.length > 0 ? 'SIMULCAST · 每日放送' : 'ANIME · 豆瓣日本动画'}
                title={bangumiItems.length > 0 ? '新番放送' : '动画精选'}
                items={
                  bangumiItems.length > 0
                    ? bangumiItems.map(({ item, today }) => ({
                        ...toCard(item, today ? '今日更新' : '连载中'),
                        badge: today ? '今日' : undefined,
                      }))
                    : animeFallbackItems.map((i) => toCard(i, '日本动画'))
                }
                onPick={(item) => runSearch(item.title)}
                action={
                  <Link href="/anime" className="hidden text-[11px] text-faint transition-colors hover:text-content sm:block">
                    {bangumiItems.length > 0 ? '全部新番 →' : '动漫专区 →'}
                  </Link>
                }
              />
            )}

            {doubanEnabled && (hotQuery.data?.items?.length ?? 0) > 0 && (
              <MediaRail
                eyebrow="WEEKLY CHART · 豆瓣周榜"
                title="本周榜单"
                items={(hotQuery.data?.items ?? []).map((i) => toCard(i, '周榜'))}
                onPick={(item) => runSearch(item.title)}
                ranked
              />
            )}
          </div>

          <footer className="mt-16 flex flex-col items-center gap-2 border-t border-line/70 pt-6 text-[10.5px] text-faint sm:flex-row sm:justify-between">
            <span>幕间 MUJIAN · 本地优先的私人放映室</span>
            <span>仅聚合用户自行配置的片源 · 请遵守当地法律与版权规定</span>
          </footer>
        </>
      )}

      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 搜索框                                                              */
/* ------------------------------------------------------------------ */

function SearchBox({
  input,
  setInput,
  inputRef,
  onSubmit,
  searchHistory,
  onPick,
}: {
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  searchHistory: ReturnType<typeof useSearchHistory>;
  onPick: (text: string) => void;
}) {
  return (
    <div ref={searchHistory.containerRef} className="relative w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div
          className={cn(
            'flex min-h-[52px] items-stretch border pl-4 transition-[background-color,border-color,border-radius] duration-200',
            searchHistory.visible
              ? 'rounded-t-xl rounded-b-none border-accent border-b-line bg-surface-raised'
              : 'rounded-xl border-line bg-chip/70 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30'
          )}
        >
          <Icon name="search" className="my-auto mr-2.5 h-4 w-4 shrink-0 text-faint" />
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent pr-2 text-[14px] text-content placeholder:text-faint focus:outline-none"
            placeholder="搜索电影、剧集、动漫…"
            value={input}
            maxLength={100}
            onChange={(e) => {
              setInput(e.target.value);
              searchHistory.resetActive();
            }}
            onFocus={searchHistory.onFocus}
            onKeyDown={(e) => searchHistory.onKeyDown(e, onPick)}
            role="combobox"
            aria-label="搜索影片"
            aria-expanded={searchHistory.visible}
            aria-controls="home-search-history"
            aria-autocomplete="list"
            aria-activedescendant={
              searchHistory.visible && searchHistory.activeIndex >= 0
                ? `home-search-history-${searchHistory.activeIndex}`
                : undefined
            }
          />
          {input && (
            <button
              type="button"
              className="my-auto mr-1 shrink-0 rounded-full p-1.5 text-faint transition-colors hover:bg-hover hover:text-content"
              onClick={() => {
                setInput('');
                searchHistory.resetActive();
                inputRef.current?.focus();
              }}
              aria-label="清空"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            className={cn(
              'btn-primary h-auto shrink-0 gap-2 rounded-l-none px-5 text-[13px] transition-[background-color,filter] active:brightness-90',
              searchHistory.visible ? '!rounded-tr-xl !rounded-br-none' : '!rounded-r-xl'
            )}
          >
            <Icon name="search" className="h-4 w-4" />
            <span className="hidden sm:inline">搜索</span>
          </button>
        </div>
      </form>

      {searchHistory.visible && (
        <SearchHistoryDropdown
          id="home-search-history"
          matches={searchHistory.matches}
          activeIndex={searchHistory.activeIndex}
          onPick={onPick}
          onRemove={searchHistory.remove}
          onClearAll={searchHistory.clearAll}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 搜索结果                                                            */
/* ------------------------------------------------------------------ */

function SearchView({
  urlQuery,
  input,
  setInput,
  inputRef,
  onSubmit,
  searchHistory,
  pickHistory,
  isSearching,
  groups,
  visibleGroups,
  listLength,
  failures,
  disabledSources,
  offSubscriptionSources,
  selectedSourcesCount,
  hasAnySources,
  totalGroups,
  visibleCount,
  onLoadMore,
  onOpen,
  sourceName,
}: {
  urlQuery: string;
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  searchHistory: ReturnType<typeof useSearchHistory>;
  pickHistory: (text: string) => void;
  isSearching: boolean;
  groups: ReturnType<typeof aggregateResults>;
  visibleGroups: ReturnType<typeof aggregateResults>;
  listLength: number;
  failures: { sourceKey: string; error: string; timedOut?: boolean }[];
  disabledSources: string[];
  offSubscriptionSources: string[];
  selectedSourcesCount: number;
  hasAnySources: boolean;
  totalGroups: number;
  visibleCount: number;
  onLoadMore: () => void;
  onOpen: (item: SearchResultItem) => void;
  sourceName: (key: string) => string;
}) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-2">SEARCH / 检索</p>
          <h1 className="font-display truncate text-[30px] leading-tight tracking-[0.03em] text-content sm:text-[36px]">
            “{urlQuery}”
          </h1>
          <p className="mt-2 text-[12px] text-faint">
            {isSearching ? (
              <>正在逐源检索… 已就绪 {groups.length} 组结果</>
            ) : (
              <>
                {totalGroups} 部影片 · {listLength} 条结果
                {failures.length > 0 && ` · ${failures.length} 个源未响应`}
              </>
            )}
          </p>
        </div>
        <Link
          href="/"
          className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] text-muted transition-colors hover:border-accent/40 hover:text-content"
        >
          <Icon name="chevronLeft" className="h-3.5 w-3.5" />
          返回发现
        </Link>
      </div>

      <div className="mt-6 max-w-3xl">
        <SearchBox
          input={input}
          setInput={setInput}
          inputRef={inputRef}
          onSubmit={onSubmit}
          searchHistory={searchHistory}
          onPick={pickHistory}
        />
      </div>

      <div className="mt-6 space-y-2">
        {failures.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-chip/70 px-3 py-2 text-[11px]">
            <span className="text-faint">{isSearching ? '以下源暂时无响应：' : '部分点播源请求失败：'}</span>
            {failures.map((f) => (
              <span key={f.sourceKey} className={f.timedOut ? 'text-warning' : 'text-faint'}>
                {f.timedOut ? '⏱' : '✗'} {sourceName(f.sourceKey)}
                {f.timedOut ? ' 超时' : ''}
              </span>
            ))}
          </div>
        )}
        {disabledSources.length > 0 && (
          <div className="rounded-lg bg-chip/70 px-3 py-2 text-[11px] leading-5 text-faint">
            {disabledSources.length} 个源因连续超时/失败已暂停参与搜索：
            {disabledSources.map((key) => sourceName(key)).join('、')}
          </div>
        )}
        {offSubscriptionSources.length > 0 && (
          <div className="rounded-lg bg-chip/70 px-3 py-2 text-[11px] leading-5 text-faint">
            {offSubscriptionSources.length} 个源所属订阅已停用，未参与本次搜索：
            {offSubscriptionSources.map((key) => sourceName(key)).join('、')}
          </div>
        )}
      </div>

      <section aria-label="搜索结果" className="mt-6">
        {selectedSourcesCount === 0 ? (
          <NoSourceGuide hasSources={hasAnySources} />
        ) : listLength > 0 ? (
          <>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleGroups.map((group) => (
                <AggregatedCard key={group.key} group={group} sources={undefined} onOpen={onOpen} />
              ))}
            </div>
            {groups.length > visibleCount && (
              <div className="mt-5 flex justify-center">
                <button className="btn-ghost btn-sm" onClick={onLoadMore}>
                  加载更多（还有 {groups.length - visibleCount} 部）
                </button>
              </div>
            )}
          </>
        ) : isSearching ? (
          <ResultsSkeleton />
        ) : (
          <EmptyState
            icon="search"
            title="没有找到匹配的结果"
            description="换一个关键词，或到设置里添加更多点播源"
            className="!py-16"
          />
        )}
      </section>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card flex h-28 overflow-hidden">
          <div className="w-[105px] shrink-0 animate-pulse bg-chip sm:w-[120px]" />
          <div className="flex-1 space-y-2 p-2.5">
            <div className="h-4 w-3/4 animate-pulse rounded bg-chip" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-chip" />
            <div className="h-3 w-full animate-pulse rounded bg-chip" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NoSourceGuide({ hasSources = false }: { hasSources?: boolean }) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-line px-8 py-12 text-center">
      <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-chip text-faint">
        <Icon name="link" className="h-5 w-5" />
      </span>
      <h3 className="mb-2 text-[15px] font-medium text-content">
        {hasSources ? '还没有启用点播源' : '先添加一个点播源'}
      </h3>
      <p className="text-[12.5px] leading-6 text-muted">
        {hasSources ? (
          <>到「设置 → 点播源」勾选要参与搜索的源，然后重新搜索。</>
        ) : (
          <>幕间不内置任何采集站。添加一个 Apple CMS 采集站地址，勾选后即可开始搜索。</>
        )}
      </p>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('mujian:open-settings'))}
        className="btn-primary mt-5 h-9 px-4 text-[12.5px]"
      >
        打开源管理
      </button>
    </div>
  );
}
