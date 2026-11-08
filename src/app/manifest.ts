import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '幕间 MUJIAN · 私人影院',
    short_name: '幕间',
    description: '把散落的好电影收进同一块银幕。聚合搜索、直播与追番的桌面放映室。',
    start_url: '/',
    display: 'standalone',
    background_color: '#0c0c0d',
    theme_color: '#0c0c0d',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
