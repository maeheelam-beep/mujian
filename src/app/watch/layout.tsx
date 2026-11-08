import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '播放',
};

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
