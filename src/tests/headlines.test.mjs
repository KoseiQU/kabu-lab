// 見出しの収集（collect/headlines.mjs）の機械テスト。保存した小さな XML だけを使い、ネットには出ない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFeed, decodeEntities, textOf, safeUrl, parseDate, decodeXml, mergeHeadlines, collectHeadlines, runHeadlines, FEEDS, headlinesPath } from '../collect/headlines.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/rss/${f}`, import.meta.url));
const str = (f) => fx(f).toString('utf8');

test('RSS 2.0: CDATA・実体参照（&amp; &#x3042; &#12354; &quot;）を戻し、リンクの無い項目は除く', () => {
  const items = parseFeed(str('rss2.xml'));
  assert.deepEqual(items.map((x) => x.title), ['日経平均 一時500円超値上がり <速報>', '円相場 & 長期金利 ああ "動向"', '同じ題名の検査', '日付の無い項目']);
  assert.equal(items[1].url, 'https://www3.nhk.or.jp/news/html/20261005/k1002.html?a=1&b=2');
  assert.equal(items[0].publishedAt, '2026-10-05T00:15:00.000Z'); // pubDate（+0900）
  assert.equal(items[3].publishedAt, null);
  assert.ok(items.every((x) => !('description' in x)), '本文・要約は持たない');
});

test('RDF（RSS 1.0）: dc:date を読む。channel の title・link は項目にしない', () => {
  const items = parseFeed(str('rdf.xml'));
  assert.deepEqual(items, [
    { title: '企業物価指数（2026年9月速報）', url: 'https://www.boj.or.jp/statistics/a.htm', publishedAt: '2026-10-04T23:50:00.000Z' },
    { title: '同じ題名の検査', url: 'https://www.boj.or.jp/b.htm', publishedAt: '2026-10-05T01:00:00.000Z' },
  ]);
});

test('Atom: rel="alternate"（または rel なし）の href、published / updated を読む', () => {
  const items = parseFeed(str('atom.xml'));
  assert.deepEqual(items.map((x) => [x.title, x.url, x.publishedAt]), [
    ['決算発表 & 業績修正', 'https://example.com/news/1?x=1&y=2', '2026-10-04T23:30:00.000Z'],
    ['rel の無いリンク', 'https://example.com/news/2', '2026-10-03T01:00:00.000Z'],
  ]);
});

test('Shift_JIS の XML 宣言なら Shift_JIS として読む', () => {
  const items = parseFeed(decodeXml(fx('sjis.xml'), 'text/xml'));
  assert.deepEqual(items.map((x) => x.title), ['株価の見出し']);
  assert.equal(decodeXml(Buffer.from('<rss>あ</rss>'), 'text/xml; charset=UTF-8'), '<rss>あ</rss>');
});

test('XSS の材料: 題名のタグは取り除き、javascript: / data: のリンクは項目にしない', () => {
  const items = parseFeed(str('evil.xml'));
  assert.equal(items.length, 1, JSON.stringify(items));
  assert.equal(items[0].url, 'https://example.com/ok-but-evil-title');
  assert.ok(!/[<>]/.test(items[0].title), items[0].title);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('  JavaScript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.equal(safeUrl('//example.com/x'), null);
  assert.equal(safeUrl('https://example.com/a b'), 'https://example.com/a%20b');
});

test('部品: 実体参照・CDATA・日付', () => {
  assert.equal(decodeEntities('&amp;lt; &lt;&gt; &#0; &unknown;'), '&lt; <>  &unknown;');
  assert.equal(textOf('<![CDATA[a &amp; b]]> &amp; c'), 'a &amp; b & c'); // CDATA の中は戻さない
  assert.equal(parseDate('Sun, 04 Oct 2026 20:00:00 GMT'), '2026-10-04T20:00:00.000Z');
  assert.equal(parseDate('きのう'), null);
  assert.equal(parseDate(null), null);
});

test('mergeHeadlines: 新しい順・同じ題名は1つ（新しいほう）・日付なしは最後・最大30件・出典名つき', () => {
  const a = { name: 'A', items: parseFeed(str('rss2.xml')) };
  const b = { name: 'B', items: parseFeed(str('rdf.xml')) };
  const m = mergeHeadlines([a, b]);
  assert.deepEqual(m.map((x) => [x.source, x.title]), [
    ['B', '同じ題名の検査'],
    ['A', '日経平均 一時500円超値上がり <速報>'],
    ['B', '企業物価指数（2026年9月速報）'],
    ['A', '円相場 & 長期金利 ああ "動向"'],
    ['A', '日付の無い項目'],
  ]);
  const many = { name: 'M', items: Array.from({ length: 50 }, (_, i) => ({ title: `見出し${i}`, url: `https://e.com/${i}`, publishedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() })) };
  const m2 = mergeHeadlines([many]);
  assert.equal(m2.length, 30);
  assert.equal(m2[0].title, '見出し49');
  // 全角・半角や空白の違いだけの題名も同じとみなす。URL が http(s) 以外の項目は捨てる
  const m3 = mergeHeadlines([{ name: 'X', items: [{ title: 'ＡＢＣ 決算', url: 'https://e.com/1', publishedAt: '2026-10-01T00:00:00Z' }, { title: 'ABC決算', url: 'https://e.com/2', publishedAt: '2026-10-02T00:00:00Z' }, { title: '悪い', url: 'javascript:x', publishedAt: null }] }]);
  assert.deepEqual(m3.map((x) => x.url), ['https://e.com/2']);
});

/** テスト用の fetcher（URL → XML。Error を入れるとその URL は失敗） */
function fakeFetcher(map) {
  const calls = [];
  return {
    calls,
    async binary(url) {
      calls.push(url);
      const v = map[url];
      if (v instanceof Error) throw v;
      if (v == null) throw new Error(`HTTP 404: ${url}`);
      return { buffer: Buffer.isBuffer(v) ? v : Buffer.from(v), contentType: 'application/rss+xml', url };
    },
  };
}

test('collectHeadlines: 3本を各1回・間は1秒以上待つ・1本失敗しても他は載せる', async () => {
  const f = fakeFetcher({ [FEEDS[0].url]: fx('rss2.xml'), [FEEDS[1].url]: new Error('通信失敗: タイムアウト'), [FEEDS[2].url]: fx('rdf.xml') });
  const waits = [];
  const { data, okCount } = await collectHeadlines({ fetcher: f, wait: async (ms) => waits.push(ms), now: () => new Date('2026-10-05T01:00:00Z') });
  assert.deepEqual(f.calls, FEEDS.map((x) => x.url));
  assert.deepEqual(waits, [1000, 1000]);
  assert.equal(okCount, 2);
  assert.equal(data.fetchedAt, '2026-10-05T01:00:00.000Z');
  assert.deepEqual(data.sources.map((s) => [s.name, s.ok, s.count]), [['NHK 経済', true, 4], ['Yahoo!ニュース 経済', false, 0], ['日本銀行 新着', true, 2]]);
  assert.match(data.sources[1].message, /タイムアウト/);
  assert.deepEqual(new Set(data.items.map((x) => x.source)), new Set(['NHK 経済', '日本銀行 新着']));
  assert.deepEqual(Object.keys(data.items[0]).sort(), ['publishedAt', 'source', 'title', 'url']);
});

test('collectHeadlines: 項目が0件の RSS は失敗扱い（形式の変化に気づけるように）', async () => {
  const f = fakeFetcher({ [FEEDS[0].url]: '<html>メンテナンス中</html>', [FEEDS[1].url]: fx('atom.xml'), [FEEDS[2].url]: fx('rdf.xml') });
  const { data } = await collectHeadlines({ fetcher: f, wait: async () => {} });
  assert.equal(data.sources[0].ok, false);
  assert.match(data.sources[0].message, /1件も/);
});

test('runHeadlines: 全部失敗なら既存の headlines.json を消さずに残し ok=false。成功なら書く', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-hl-'));
  try {
    const p = headlinesPath(dir);
    mkdirSync(join(dir, 'market'), { recursive: true });
    writeFileSync(p, '{"fetchedAt":"old","sources":[],"items":[]}');
    const r = await runHeadlines({ dataDir: dir, fetcher: fakeFetcher({}), wait: async () => {} });
    assert.equal(r.ok, false);
    assert.match(r.message, /前回の headlines\.json を残しました/);
    assert.equal(readFileSync(p, 'utf8'), '{"fetchedAt":"old","sources":[],"items":[]}');
    const ok = await runHeadlines({ dataDir: dir, fetcher: fakeFetcher({ [FEEDS[2].url]: fx('rdf.xml') }), wait: async () => {} });
    assert.equal(ok.ok, true);
    assert.equal(ok.count, 2);
    const saved = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(saved.items.length, 2);
    assert.equal(saved.sources.filter((s) => !s.ok).length, 2);
    // まだ無いときに全部失敗しても、ファイルは作らない
    const dir2 = mkdtempSync(join(tmpdir(), 'kabu-hl-'));
    const r2 = await runHeadlines({ dataDir: dir2, fetcher: fakeFetcher({}), wait: async () => {} });
    assert.equal(r2.ok, false);
    assert.equal(existsSync(headlinesPath(dir2)), false);
    rmSync(dir2, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
