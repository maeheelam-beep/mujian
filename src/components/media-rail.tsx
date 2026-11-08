'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';
import { MediaCard, type MediaCardItem } from './media-card';

/**
 * 横向推荐轨道。
 * 卡片宽度固定、轨道可拖拽滚动，翻页按钮只在有溢出的一侧出现。
 */
export function MediaRail({
  eyebrow,
  title,
  items,
  loading,
  onPick,
  action,
  ranked,
}: {
  eyebrow?: string;
  title: string;
  items: MediaCardItem[];
  loading?: boolean;
  onPick: (item: MediaCardItem) => void;
  action?: ReactNode;
  ranked?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const sync = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 8,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
    });
  }, []);

  useEffect(() => {
    sync();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sync, items.length, loading]);

  const page = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.82, behavior: 'smooth' });
  };

  if (!loading && items.length === 0) return null;

  return (
    <section className="relative">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h2 className="font-display text-[23px] leading-none tracking-[0.04em] text-content sm:text-[25px]">
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <div className="hidden items-center gap-1 sm:flex">
            <RailButton label="向左" disabled={!edges.left} onClick={() => page(-1)}>
              <Icon name="chevronLeft" className="h-4 w-4" />
            </RailButton>
            <RailButton label="向右" disabled={!edges.right} onClick={() => page(1)}>
              <Icon name="chevronRight" className="h-4 w-4" />
            </RailButton>
          </div>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={sync}
        className={cn(
          'no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-1 pb-2 pt-0.5 sm:gap-4'
        )}
      >
        {loading
          ? Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="w-[142px] shrink-0 sm:w-[156px] lg:w-[166px] xl:w-[174px]">
                <div className="aspect-[2/3] animate-pulse rounded-xl bg-chip" />
                <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-chip" />
              </div>
            ))
          : items.map((item, i) => (
              <div
                key={`${item.id ?? item.title}-${i}`}
                className="w-[142px] shrink-0 snap-start sm:w-[156px] lg:w-[166px] xl:w-[174px]"
              >
                <MediaCard item={item} onClick={() => onPick(item)} rank={ranked && i < 9 ? i + 1 : undefined} />
              </div>
            ))}
      </div>
    </section>
  );
}

function RailButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted transition-all',
        disabled
          ? 'cursor-default opacity-30'
          : 'hover:border-accent/40 hover:bg-surface-raised hover:text-content'
      )}
    >
      {children}
    </button>
  );
}
