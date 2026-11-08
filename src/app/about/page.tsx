'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';

const FACTS = [
  ['空格', '播放 / 暂停'],
  ['← / →', '快退 / 快进 5 秒'],
  ['↑ / ↓', '音量调节'],
  ['F', '切换全屏'],
  ['Alt + ← / →', '上一集 / 下一集'],
  ['Ctrl + K', '聚焦搜索'],
  ['移动端长按', '3 倍速播放'],
];

export default function AboutPage() {
  const { version } = useAuth();

  return (
    <div className="mx-auto w-full max-w-[980px] px-5 pb-20 pt-10 sm:px-8 lg:px-12">
      <header className="relative overflow-hidden rounded-[26px] border border-line/70 bg-surface/60 px-7 py-10 sm:px-11 sm:py-12">
        <div className="grain pointer-events-none absolute inset-0 opacity-[0.18]" />
        <p className="eyebrow">COLOPHON / 关于</p>
        <h1 className="font-display mt-4 text-[46px] leading-none tracking-[0.08em] text-content sm:text-[62px]">
          幕间
        </h1>
        <p className="mt-3 text-[10px] font-medium tracking-[0.42em] text-faint">MUJIAN CINEMA</p>
        <p className="mt-6 max-w-[560px] text-[13px] leading-7 text-muted">
          一间开在电脑里的私人放映室。把散落在各处的好电影、剧集与直播频道，收进同一块银幕；
          不注册、不追踪、不存储视频文件。
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-faint">
          <span>版本 v{version || '2.22'}</span>
          <span className="h-3 w-px bg-line" />
          <span>桌面客户端 · Windows</span>
          <span className="h-3 w-px bg-line" />
          <Link href="/" className="text-accent transition-opacity hover:opacity-80">
            回到放映厅
          </Link>
        </div>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-9">
          <section>
            <h2 className="font-display text-[22px] tracking-[0.04em] text-content">它是什么</h2>
            <div className="mt-3 space-y-3 text-[13px] leading-7 text-muted">
              <p>
                幕间是一个视频聚合客户端：输入片名，它会同时询问多个公开点播源，把同名结果合并成一张卡片；
                选中后由内置播放器直接播放。直播页支持 M3U 订阅、节目单与频道收藏。
              </p>
              <p>
                所有搜索历史、观看进度、追番清单与偏好设置都只保存在本机（IndexedDB / localStorage），
                不会上传到任何服务器。聚合请求由本地服务代理转发，第三方数据源看不到你的真实 IP。
              </p>
            </div>
          </section>

          <section>
            <h2 className="font-display text-[22px] tracking-[0.04em] text-content">快捷键</h2>
            <div className="mt-4 overflow-hidden rounded-xl border border-line">
              {FACTS.map(([key, label], i) => (
                <div
                  key={key}
                  className={`flex items-center justify-between px-4 py-2.5 text-[12.5px] ${
                    i % 2 === 0 ? 'bg-surface/50' : 'bg-transparent'
                  }`}
                >
                  <span className="text-faint">{label}</span>
                  <kbd className="rounded border border-line bg-chip/70 px-2 py-0.5 font-mono text-[11px] text-content">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-display text-[22px] tracking-[0.04em] text-content">免责声明</h2>
            <p className="mt-3 text-[13px] leading-7 text-muted">
              本项目不存储、不制作、不分发任何视频内容，仅提供第三方公开接口的聚合与播放能力。
              所有内容的版权与合法性由对应数据源负责。请尊重版权，仅将本工具用于个人学习与合法内容的观看。
            </p>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-accent/25 bg-accent/[0.05] p-5">
            <p className="eyebrow text-accent">LICENSE</p>
            <h2 className="font-display mt-2 text-[19px] tracking-[0.04em] text-content">AGPL-3.0-or-later</h2>
            <p className="mt-2.5 text-[12px] leading-6 text-muted">
              幕间是
              <a
                href="https://github.com/LibreSpark/LibreTV"
                target="_blank"
                rel="noreferrer"
                className="mx-1 text-accent underline decoration-accent/30 underline-offset-2"
              >
                LibreTV
              </a>
              的衍生作品，遵循 GNU Affero 通用公共许可证第 3 版（或更新版本）发布。
              你可以自由使用、修改与再分发，但须保留同样的许可证与原作者署名。
            </p>
            <p className="mt-3 text-[11px] leading-5 text-faint">
              本项目与 LibreTV 原作者无隶属关系，名称与界面仅为衍生客户端的独立品牌。
            </p>
          </section>

          <section className="rounded-xl border border-line bg-surface/50 p-5">
            <p className="eyebrow">DATA</p>
            <ul className="mt-3 space-y-2 text-[12px] leading-5 text-muted">
              <li className="flex justify-between gap-3">
                <span>影片资料</span>
                <span className="text-faint">豆瓣 / Bangumi</span>
              </li>
              <li className="flex justify-between gap-3">
                <span>点播与直播</span>
                <span className="text-faint">第三方公开接口</span>
              </li>
              <li className="flex justify-between gap-3">
                <span>字体</span>
                <span className="text-faint">系统衬线 / 无衬线</span>
              </li>
            </ul>
          </section>

          <section className="px-1 text-[11px] leading-6 text-faint">
            <p>Made for the quiet hour between two films.</p>
            <p className="mt-1">愿每次熄灯，都值得。</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
