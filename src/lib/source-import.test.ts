import { describe, expect, it } from 'vitest';
import { parseSourcePaste } from './source-import';

describe('parseSourcePaste', () => {
  it('解析「名称,地址」并去掉末尾斜杠', () => {
    const result = parseSourcePaste('红牛资源,https://example.com/api.php/provide/vod/\n');
    expect(result.sources).toEqual([
      { name: '红牛资源', url: 'https://example.com/api.php/provide/vod' },
    ]);
    expect(result.duplicates).toBe(0);
    expect(result.invalid).toBe(0);
  });

  it('支持只有地址的行，名称回退到域名', () => {
    const result = parseSourcePaste('https://www.example.com/api.php/provide/vod');
    expect(result.sources[0]).toEqual({
      name: 'example.com',
      url: 'https://www.example.com/api.php/provide/vod',
    });
  });

  it('支持中文逗号、制表符、竖线与名称在前地址在后', () => {
    const result = parseSourcePaste(
      ['A，https://a.example/api', 'B\thttps://b.example/api', 'C | https://c.example/api'].join('\n')
    );
    expect(result.sources.map((s) => s.name)).toEqual(['A', 'B', 'C']);
    expect(result.sources.map((s) => s.url)).toHaveLength(3);
  });

  it('忽略注释与空行，统计无法识别的行', () => {
    const result = parseSourcePaste('# 注释\n\n这不是地址\nhttps://ok.example/api');
    expect(result.sources).toHaveLength(1);
    expect(result.invalid).toBe(1);
  });

  it('对已有源与输入内重复的地址去重', () => {
    const result = parseSourcePaste(
      'A,https://a.example/api\nA again,https://a.example/api/\nB,https://b.example/api',
      ['https://a.example/api/']
    );
    expect(result.sources.map((s) => s.url)).toEqual(['https://b.example/api']);
    expect(result.duplicates).toBe(2);
  });

  it('支持 JSON 数组、对象与 {sources}', () => {
    const array = parseSourcePaste(
      JSON.stringify([
        { name: 'A', url: 'https://a.example/api' },
        { title: 'B', api: 'https://b.example/api' },
        'C,https://c.example/api',
      ])
    );
    expect(array.sources.map((s) => s.name)).toEqual(['A', 'B', 'C']);

    const wrapped = parseSourcePaste(
      JSON.stringify({ sources: [{ name: 'D', url: 'https://d.example/api' }] })
    );
    expect(wrapped.sources).toEqual([{ name: 'D', url: 'https://d.example/api' }]);
  });

  it('拒绝非 http(s) 地址', () => {
    const result = parseSourcePaste('bad,ftp://example.com/file\njs,javascript:alert(1)');
    expect(result.sources).toHaveLength(0);
    expect(result.invalid).toBe(2);
  });
});
