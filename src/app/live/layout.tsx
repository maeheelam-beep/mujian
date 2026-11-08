import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '直播',
  description: 'M3U 订阅、频道收藏与节目单。',
};

export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
