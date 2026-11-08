import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { fetchUpstream } from './fetch-utils';
import type { SearchResultItem, SourceConfig, SourceSearchOutcome, VideoDetail } from './types';

/**
 * Internet Archive 公共领域片库适配器。
 *
 * 这不是 Apple CMS：Archive 的检索是 advancedsearch.php，详情是 metadata/<id>，
 * 播放地址是 download/<id>/<file>。只使用明确标注为 public domain / 档案的合集，
 * 不把任何商业采集站写进安装包。
 */

const SEARCH_ENDPOINT = 'https://archive.org/advancedsearch.php';
const METADATA_ENDPOINT = 'https://archive.org/metadata';
const IMAGE_ENDPOINT = 'https://archive.org/services/img';
const UA = 'Mujian/1.0 (desktop client; +https://github.com/LibreSpark/LibreTV)';

const ARCHIVE_HOSTS = new Set(['archive.org', 'www.archive.org']);

/**
 * archive.org 在部分网络下会被 DNS 污染；Chromium 走系统代理能打开，但 Node 的
 * fetch 不会。桌面主进程会把系统代理写进 HTTPS_PROXY，这里用它单独走一次 ProxyAgent。
 * 只用于固定的 archive.org 主机，不改变用户自定义 CMS 源的 SSRF 链路。
 */
const PROXY_URL =
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
let proxyAgent: ProxyAgent | undefined;

function archiveFetch(url: string, timeoutMs: number): Promise<Response> {
  if (!PROXY_URL) {
    return fetchUpstream(url, {
      timeoutMs,
      retries: 1,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
  }
  proxyAgent ??= new ProxyAgent(PROXY_URL);
  return undiciFetch(url, {
    dispatcher: proxyAgent,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  }) as unknown as Promise<Response>;
}

export function isArchiveSource(source: Pick<SourceConfig, 'provider' | 'url'>): boolean {
  if (source.provider !== 'archive') return false;
  try {
    return ARCHIVE_HOSTS.has(new URL(source.url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function collectionOf(source: SourceConfig): string {
  try {
    const value = new URL(source.url).searchParams.get('collection') || '';
    return /^[a-z0-9_]+$/i.test(value) ? value : 'feature_films';
  } catch {
    return 'feature_films';
  }
}

/** Lucene 查询里只保留普通词，避免用户输入把查询语法打断 */
function luceneTerm(input: string): string {
  const cleaned = input
    .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'film';
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string').join(' ');
  return '';
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ArchiveDoc {
  identifier?: unknown;
  title?: unknown;
  year?: unknown;
  description?: unknown;
}

interface ArchiveFile {
  name?: unknown;
  format?: unknown;
  size?: unknown;
  private?: unknown;
}

interface ArchiveMetadata {
  metadata?: Record<string, unknown>;
  files?: ArchiveFile[];
}

function toResult(doc: ArchiveDoc, source: SourceConfig): SearchResultItem | null {
  const identifier = textOf(doc.identifier).trim();
  const title = textOf(doc.title).trim();
  if (!identifier || !title || !/^[A-Za-z0-9._-]{1,200}$/.test(identifier)) return null;
  const year = textOf(doc.year).trim();
  return {
    sourceKey: source.key,
    sourceName: source.name,
    vodId: identifier,
    name: title,
    pic: `${IMAGE_ENDPOINT}/${encodeURIComponent(identifier)}`,
    typeName: '档案影片',
    year: year || undefined,
    remarks: 'Internet Archive',
    sourceUrl: source.url,
  };
}

export async function searchArchive(source: SourceConfig, wd: string): Promise<SourceSearchOutcome> {
  const start = Date.now();
  const collection = collectionOf(source);
  const query = `title:(${luceneTerm(wd)}) AND mediatype:movies AND collection:(${collection})`;
  const params = new URLSearchParams();
  params.set('q', query);
  params.append('fl[]', 'identifier');
  params.append('fl[]', 'title');
  params.append('fl[]', 'year');
  params.append('rows', '24');
  params.set('page', '1');
  params.set('output', 'json');

  try {
    const res = await archiveFetch(`${SEARCH_ENDPOINT}?${params.toString()}`, 9000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { response?: { docs?: ArchiveDoc[] } };
    const docs = Array.isArray(data.response?.docs) ? data.response.docs : [];
    const list = docs
      .map((doc) => toResult(doc, source))
      .filter((item): item is SearchResultItem => item !== null);
    return { sourceKey: source.key, ok: true, list, ms: Date.now() - start };
  } catch (err) {
    return {
      sourceKey: source.key,
      ok: false,
      list: [],
      error: err instanceof Error ? err.message : '档案检索失败',
      ms: Date.now() - start,
    };
  }
}

function pickVideoFiles(files: ArchiveFile[]): ArchiveFile[] {
  const playable = files.filter((file) => {
    if (!file || file.private === true) return false;
    const name = textOf(file.name);
    const format = textOf(file.format).toLowerCase();
    if (!name || !/\.(mp4|m4v|webm|ogv)$/i.test(name)) return false;
    if (format.includes('thumb') || format.includes('spectrogram')) return false;
    return true;
  });
  const unique = new Map<string, ArchiveFile>();
  for (const file of playable) unique.set(textOf(file.name), file);
  return [...unique.values()].sort((a, b) => {
    const aMp4 = /\.mp4$/i.test(textOf(a.name)) ? 0 : 1;
    const bMp4 = /\.mp4$/i.test(textOf(b.name)) ? 0 : 1;
    if (aMp4 !== bMp4) return aMp4 - bMp4;
    return (Number(b.size) || 0) - (Number(a.size) || 0);
  });
}

export async function archiveDetail(source: SourceConfig, id: string): Promise<VideoDetail> {
  const res = await archiveFetch(`${METADATA_ENDPOINT}/${encodeURIComponent(id)}`, 12000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as ArchiveMetadata;
  const metadata = data.metadata || {};
  const files = pickVideoFiles(Array.isArray(data.files) ? data.files : []);

  if (files.length === 0) {
    throw new Error('这份档案没有可播放的视频文件');
  }

  const episodes = files.slice(0, 24).map((file) => {
    const name = textOf(file.name);
    const direct = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
    // Chromium 直连 archive.org 在部分网络下会被 DNS 污染；走同源代理，
    // 由本地服务再以系统代理访问，Range 请求也能原样透传。
    return `/api/proxy?url=${encodeURIComponent(direct)}`;
  });

  const title = textOf(metadata.title).trim() || id;
  const description = stripHtml(textOf(metadata.description)).slice(0, 500);
  const year = textOf(metadata.year).trim();

  return {
    episodes,
    videoInfo: {
      title,
      cover: `${IMAGE_ENDPOINT}/${encodeURIComponent(id)}`,
      desc: description || '来自 Internet Archive 公共档案的影片。',
      typeName: '档案影片',
      year: year || undefined,
      remarks: 'Internet Archive · 公共档案',
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}
