import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '动漫',
  description: '每日新番放送表、豆瓣动画电影与日本动画，加入自己的追番清单。',
};

export default function AnimeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
