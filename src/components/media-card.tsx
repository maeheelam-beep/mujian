'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SmartImage } from './smart-image';
import { Icon } from './icon';

export interface MediaCardItem {
  id?: string;
  title: string;
  cover?: string;
  rating?: string;
  subtitle?: string;
  badge?: string;
  /** 0–1 观看进度，显示在封面底部 */
  progress?: number;
}

/**
 * 通用海报卡片：发现页、动漫页、搜索结果共用同一套视觉。
 * 悬停时只有图片缩放与一层暗角，文字保持不动——列表才不会「跳」。
 */
export function MediaCard({
  item,
  onClick,
  className,
  rank,
}: {
  item: MediaCardItem;
  onClick: () => void;
  className?: string;
  /** 榜单序号：传 1-9 时在左上角显示大号数字 */
  rank?: number;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [item.cover]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('group block w-full text-left focus-visible:outline-none', className)}
      aria-label={item.title}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-line/80 bg-chip shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-300 group-hover:border-line group-hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] group-focus-visible:ring-2 group-focus-visible:ring-accent/50">
        {item.cover && !failed ? (
          <SmartImage
            url={item.cover}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.045]"
            onExhausted={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-chip">
            <Icon name="film" className="h-7 w-7 text-faint/70" />
          </div>
        )}

        {/* 底部暗角：为角标与悬停按钮提供可读性，不改变封面本身 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/65 via-black/5 to-transparent opacity-80" />

        {typeof rank === 'number' && (
          <span className="font-display absolute left-1.5 top-0.5 text-[30px] font-semibold leading-none text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
            {rank}
          </span>
        )}

        {item.rating && (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-rating backdrop-blur-sm">
            ★ {item.rating}
          </span>
        )}

        {item.badge && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-accent px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-on-accent">
            {item.badge}
          </span>
        )}

        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/35 text-white backdrop-blur-md">
            <Icon name="play" className="ml-0.5 h-4 w-4" />
          </span>
        </span>

        {typeof item.progress === 'number' && item.progress > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
            <span
              className="block h-full bg-accent"
              style={{ width: `${Math.round(Math.min(1, item.progress) * 100)}%` }}
            />
          </span>
        )}
      </div>

      <div className="mt-2 px-0.5">
        <p className="truncate text-[13px] font-medium leading-5 text-content" title={item.title}>
          {item.title}
        </p>
        {item.subtitle && <p className="mt-0.5 truncate text-[11px] text-faint">{item.subtitle}</p>}
      </div>
    </button>
  );
}
