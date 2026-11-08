import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '关于',
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
