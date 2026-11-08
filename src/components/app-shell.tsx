'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from './icon';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { ThemeSegment } from './theme';
import { useAuth } from './auth';

declare global {
  interface Window {
    mujian?: {
      platform: string;
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (cb: (value: boolean) => void) => () => void;
      version?: string;
    };
  }
}

/**
 * 全局应用壳：
 * - 顶部一条极窄的自定义标题栏（Electron 下可拖拽、带窗口控制）
 * - 左侧固定侧栏承载品牌、导航与「我的」
 * - /watch 进入沉浸模式，收起侧栏，把整块画布留给播放器
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const immersive = pathname.startsWith('/watch');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener('mujian:open-settings', openSettings);
    return () => window.removeEventListener('mujian:open-settings', openSettings);
  }, []);

  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-page">
      <TitleBar immersive={immersive} />
      <div className="flex min-h-0 flex-1">
        {!immersive && (
          <Sidebar
            pathname={pathname}
            onSettings={() => setSettingsOpen(true)}
            onHistory={() => setHistoryOpen(true)}
          />
        )}
        <main
          className={cn(
            'relative min-w-0 flex-1',
            immersive ? 'overflow-y-auto bg-black' : 'overflow-y-auto'
          )}
        >
          {children}
        </main>
      </div>
      {!immersive && (
        <MobileNav pathname={pathname} onHistory={() => setHistoryOpen(true)} />
      )}
      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 标题栏                                                              */
/* ------------------------------------------------------------------ */

function TitleBar({ immersive }: { immersive: boolean }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!window.mujian) return;
    setIsDesktop(true);
    document.documentElement.dataset.desktop = 'true';
    void window.mujian.isMaximized().then(setMaximized);
    return window.mujian.onMaximizedChange(setMaximized);
  }, []);

  return (
    <div
      className={cn(
        'app-drag relative z-50 flex h-9 shrink-0 items-center border-b border-line/60 px-3',
        immersive ? 'bg-black/80 text-white/50' : 'bg-page/60 text-faint'
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn('curtain-mark h-3.5 w-4 rounded-[2px]', immersive && 'opacity-80')} />
        <span className="text-[10px] font-medium tracking-[0.34em]">MUJIAN</span>
        <span className={cn('text-[10px]', immersive ? 'text-white/25' : 'text-faint/60')}>幕间放映室</span>
      </div>

      <div className="mx-auto hidden items-center gap-2 text-[10px] tracking-[0.18em] sm:flex">
        <span className={cn('h-1 w-1 rounded-full', immersive ? 'bg-white/30' : 'bg-accent/70')} />
        <span>私人影院 · 本地播放</span>
      </div>

      {isDesktop ? (
        <div className="app-no-drag ml-auto flex h-9 items-stretch">
          <WindowButton label="最小化" onClick={() => window.mujian?.minimize()}>
            <path d="M5 12h14" />
          </WindowButton>
          <WindowButton
            label={maximized ? '还原' : '最大化'}
            onClick={() => window.mujian?.toggleMaximize()}
          >
            {maximized ? (
              <>
                <rect x="7" y="7" width="11" height="11" rx="1.5" />
                <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H17" />
              </>
            ) : (
              <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
            )}
          </WindowButton>
          <WindowButton label="关闭" danger onClick={() => window.mujian?.close()}>
            <path d="M6 6l12 12M18 6L6 18" />
          </WindowButton>
        </div>
      ) : (
        <div className="ml-auto flex items-center gap-2 text-[10px] tracking-[0.16em]">
          <span className="hidden sm:inline">WEB EDITION</span>
          <span className="h-1 w-1 rounded-full bg-accent/60 sm:hidden" />
        </div>
      )}
    </div>
  );
}

function WindowButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex w-[46px] items-center justify-center text-current transition-colors',
        danger ? 'hover:bg-[#c42b1c] hover:text-white' : 'hover:bg-black/[0.06] dark:hover:bg-white/10'
      )}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 侧栏                                                                */
/* ------------------------------------------------------------------ */

function Sidebar({
  pathname,
  onSettings,
  onHistory,
}: {
  pathname: string;
  onSettings: () => void;
  onHistory: () => void;
}) {
  return (
    <aside className="hidden w-[236px] shrink-0 flex-col border-r border-line/70 bg-surface/40 lg:flex">
      <div className="px-5 pb-6 pt-7">
        <Link href="/" className="group flex items-center gap-3">
          <LogoMark />
          <span className="min-w-0">
            <span className="font-display block text-[23px] leading-none tracking-[0.12em] text-content">
              幕间
            </span>
            <span className="mt-1.5 block text-[8.5px] font-medium tracking-[0.42em] text-faint">
              MUJIAN CINEMA
            </span>
          </span>
        </Link>
      </div>

      <SidebarSearch />

      <nav aria-label="主导航" className="mt-4 space-y-0.5 px-3">
        <NavItem href="/" icon="film" label="发现" active={pathname === '/'} />
        <NavItem href="/anime" icon="anime" label="动漫" active={pathname.startsWith('/anime')} />
        <NavItem href="/live" icon="tv" label="直播" active={pathname.startsWith('/live')} />
      </nav>

      <div className="mt-7 px-3">
        <p className="eyebrow mb-2 px-3">我的</p>
        <div className="space-y-0.5">
          <NavAction icon="clock" label="观看历史" onClick={onHistory} />
          <NavAction icon="download" label="离线下载" onClick={requestShowDownloadManager} />
        </div>
      </div>

      <div className="mt-auto px-4 pb-4">
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="text-[11px] text-faint">外观</span>
          <button
            type="button"
            onClick={onSettings}
            className="rounded-md p-1.5 text-faint transition-colors hover:bg-hover hover:text-content"
            title="设置"
            aria-label="设置"
          >
            <Icon name="gear" className="h-4 w-4" />
          </button>
        </div>
        <ThemeSegment />
        <div className="mt-3 flex items-center justify-between px-1 text-[10px] text-faint">
          <Link href="/about" className="transition-colors hover:text-content">
            关于幕间
          </Link>
          <VersionLabel />
        </div>
      </div>
    </aside>
  );
}

function SidebarSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      className="px-3"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (!q) return;
        router.push(`/?s=${encodeURIComponent(q)}`);
        setValue('');
      }}
    >
      <div className="group flex h-9 items-center gap-2 rounded-lg border border-line/80 bg-chip/40 px-2.5 transition-colors focus-within:border-accent/60 focus-within:bg-surface-raised">
        <Icon name="search" className="h-3.5 w-3.5 shrink-0 text-faint" />
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="搜索片名"
          aria-label="搜索片名"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-content outline-none placeholder:text-faint"
        />
        <kbd className="hidden rounded border border-line bg-surface px-1 py-px text-[9px] text-faint xl:block">
          Ctrl K
        </kbd>
      </div>
    </form>
  );
}

function LogoMark() {
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[11px] border border-line bg-surface-raised shadow-[0_6px_20px_-12px_rgba(0,0,0,0.5)]">
      <svg viewBox="0 0 40 40" className="h-9 w-9" fill="none" aria-hidden>
        <path d="M7 32V17a13 13 0 0 1 26 0v15" stroke="rgb(var(--c-accent))" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M12 32V18a8 8 0 0 1 16 0v14" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1" strokeLinecap="round" />
        <path d="M20 10v22" stroke="currentColor" strokeOpacity="0.28" strokeWidth="0.8" />
        <circle cx="20" cy="20" r="1.6" fill="rgb(var(--c-accent))" />
      </svg>
    </span>
  );
}

function NavItem({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors',
        active ? 'bg-chip text-content' : 'text-muted hover:bg-chip/60 hover:text-content'
      )}
    >
      <span
        className={cn(
          'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent transition-opacity',
          active ? 'opacity-100' : 'opacity-0'
        )}
      />
      <Icon name={icon} className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-accent' : 'text-faint group-hover:text-muted')} />
      <span>{label}</span>
    </Link>
  );
}

function NavAction({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13.5px] text-muted transition-colors hover:bg-chip/60 hover:text-content"
    >
      <Icon name={icon} className="h-[18px] w-[18px] shrink-0 text-faint group-hover:text-muted" />
      <span>{label}</span>
    </button>
  );
}

function VersionLabel() {
  const { version } = useAuth();
  return <span className="tabular-nums">v{version || '2.22'}</span>;
}

/* ------------------------------------------------------------------ */
/* 移动端底栏                                                          */
/* ------------------------------------------------------------------ */

function MobileNav({ pathname, onHistory }: { pathname: string; onHistory: () => void }) {
  return (
    <nav
      aria-label="移动导航"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[58px] items-stretch border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <MobileItem href="/" icon="film" label="发现" active={pathname === '/'} />
      <MobileItem href="/anime" icon="anime" label="动漫" active={pathname.startsWith('/anime')} />
      <MobileItem href="/live" icon="tv" label="直播" active={pathname.startsWith('/live')} />
      <button
        type="button"
        onClick={onHistory}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-[10px] text-faint"
      >
        <Icon name="clock" className="h-5 w-5" />
        历史
      </button>
    </nav>
  );
}

function MobileItem({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn('flex flex-1 flex-col items-center justify-center gap-1 text-[10px]', active ? 'text-accent' : 'text-faint')}
    >
      <Icon name={icon} className="h-5 w-5" />
      {label}
    </Link>
  );
}
