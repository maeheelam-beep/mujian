'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 主题上下文：light / dark / system，持久化到 localStorage，默认跟随系统。
 * html 上的 .dark 类由 layout 中的内联脚本先行设置（避免首屏闪烁），此处负责后续切换。
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'mujian-theme';

interface ThemeContextValue {
  theme: ThemeChoice;
  resolved: 'light' | 'dark';
  setTheme: (t: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolved: 'dark',
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(choice: ThemeChoice): 'light' | 'dark' {
  const resolved = choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) || 'system';
    setThemeState(stored);
    setResolved(apply(stored));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const current = (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) || 'system';
      if (current === 'system') setResolved(apply('system'));
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((t: ThemeChoice) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
    setResolved(apply(t));
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

/** 侧栏底部的三态主题切换：跟随系统 / 浅色 / 深色 */
export function ThemeSegment({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const options: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
    {
      value: 'system',
      label: '跟随系统',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 17.25v1.5A1.25 1.25 0 0 0 10.25 20h3.5A1.25 1.25 0 0 0 15 18.75v-1.5M3.75 15.75h16.5A1.5 1.5 0 0 0 21.75 14.25V5.25a1.5 1.5 0 0 0-1.5-1.5H3.75a1.5 1.5 0 0 0-1.5 1.5v9a1.5 1.5 0 0 0 1.5 1.5Z" />
        </svg>
      ),
    },
    {
      value: 'light',
      label: '浅色',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 3v1.5m0 15V21m9-9h-1.5m-15 0H3m15.364 6.364-1.06-1.06M6.696 6.696l-1.06-1.06m12.728 0-1.06 1.06M6.696 17.304l-1.06 1.06M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
        </svg>
      ),
    },
    {
      value: 'dark',
      label: '深色',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      ),
    },
  ];

  return (
    <div className={cn('grid grid-cols-3 gap-0.5 rounded-xl border border-line bg-chip/60 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setTheme(o.value)}
          title={o.label}
          aria-label={`主题：${o.label}`}
          aria-pressed={theme === o.value}
          className={cn(
            'flex h-10 flex-col items-center justify-center gap-1 rounded-[9px] transition-colors',
            theme === o.value
              ? 'bg-surface-raised text-content shadow-[0_1px_4px_rgba(0,0,0,0.10)]'
              : 'text-faint hover:text-content'
          )}
        >
          {o.icon}
          <span className="text-[9px] leading-none tracking-[0.06em]">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** 单按钮主题切换（保留给紧凑场景）：light → dark → system 三态循环 */
export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const next: ThemeChoice = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const label = theme === 'system' ? `跟随系统（当前${resolved === 'dark' ? '深色' : '浅色'}）` : theme === 'dark' ? '深色' : '浅色';
  const nextLabel = next === 'light' ? '浅色' : next === 'dark' ? '深色' : '跟随系统';

  return (
    <button
      className="rounded-lg p-2 text-muted transition-colors hover:bg-hover hover:text-content"
      title={`主题：${label}，点击切换为${nextLabel}`}
      aria-label={`切换主题，当前 ${label}`}
      onClick={() => setTheme(next)}
    >
      {theme === 'system' ? (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ) : resolved === 'dark' ? (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ) : (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
    </button>
  );
}
