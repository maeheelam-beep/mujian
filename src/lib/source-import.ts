/**
 * 点播源批量粘贴解析。
 *
 * 只做「把用户粘贴的文本变成本地源」这一件事，不联网、不上传。
 * 支持：
 * - 每行 `名称,地址` / `名称<TAB>地址` / `名称 地址`
 * - 每行只有地址，名称取域名
 * - JSON 数组、单个对象，或 `{ sources: [...] }`
 * - 以 # 或 // 开头的注释行
 */

export type ParsedSource = {
  name: string;
  url: string;
};

export type ParseSourcePasteResult = {
  /** 去重、校验后的新源 */
  sources: ParsedSource[];
  /** 与已有源重复的条数 */
  duplicates: number;
  /** 无法识别的行数 */
  invalid: number;
  /** 总有效行数（不含空行/注释） */
  total: number;
};

const URL_PATTERN = /https?:\/\/[^\s,，;；|"'<>]+/i;
const MAX_SOURCES = 300;

function normalizeUrl(value: string): string {
  return value
    .trim()
    .replace(/^[<("'“”]+|[>)"'“”]+$/g, '')
    .replace(/\/+$/, '');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function nameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

function cleanName(value: string, url: string): string {
  const name = value
    .replace(URL_PATTERN, '')
    .replace(/^[\s,，;；|\-–—:：]+|[\s,，;；|\-–—:：]+$/g, '')
    .replace(/^[("'“”]+|[)"'“”]+$/g, '')
    .trim();
  return name || nameFromUrl(url);
}

function parseLine(line: string): ParsedSource | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return null;

  // JSON 对象单行（部分论坛/工具会一条一条贴）
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      return fromObject(obj);
    } catch {
      /* 落回普通行解析 */
    }
  }

  const match = trimmed.match(URL_PATTERN);
  if (!match) return null;
  const url = normalizeUrl(match[0]);
  if (!isHttpUrl(url)) return null;

  // 把地址从行里摘掉，剩下的当名称；分隔符/引号在 cleanName 里处理
  return { name: cleanName(trimmed.replace(match[0], ''), url), url };
}

function fromObject(obj: Record<string, unknown>): ParsedSource | null {
  const urlValue = obj.url ?? obj.api ?? obj.address ?? obj.URL;
  if (typeof urlValue !== 'string') return null;
  const url = normalizeUrl(urlValue);
  if (!isHttpUrl(url)) return null;
  const nameValue = obj.name ?? obj.title ?? obj.label;
  return {
    name: typeof nameValue === 'string' && nameValue.trim() ? cleanName(nameValue, url) : nameFromUrl(url),
    url,
  };
}

function collectJson(text: string): ParsedSource[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { sources?: unknown }).sources)
      ? (data as { sources: unknown[] }).sources
      : [data];

  const out: ParsedSource[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const parsed = parseLine(item);
      if (parsed) out.push(parsed);
    } else if (item && typeof item === 'object') {
      const parsed = fromObject(item as Record<string, unknown>);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

export function parseSourcePaste(text: string, existingUrls: Iterable<string> = []): ParseSourcePasteResult {
  const existing = new Set(Array.from(existingUrls, normalizeUrl));
  const seen = new Set<string>();
  const sources: ParsedSource[] = [];
  let duplicates = 0;
  let invalid = 0;
  let total = 0;

  const push = (source: ParsedSource | null) => {
    if (!source) {
      invalid += 1;
      return;
    }
    total += 1;
    if (existing.has(source.url) || seen.has(source.url)) {
      duplicates += 1;
      return;
    }
    if (sources.length >= MAX_SOURCES) {
      invalid += 1;
      return;
    }
    seen.add(source.url);
    sources.push(source);
  };

  const jsonSources = collectJson(text);
  if (jsonSources) {
    // JSON 里解析失败的条目也计入 invalid，便于界面给出真实反馈
    for (const source of jsonSources) push(source);
    return { sources, duplicates, invalid: Math.max(invalid, 0), total };
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || line.trim().startsWith('//')) continue;
    push(parseLine(line));
  }

  return { sources, duplicates, invalid, total };
}
