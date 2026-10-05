// P5a の画面部品（app/charts.js の headlineItems・ageBadge・jstParts）の機械テスト。XSS の検査を含む
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../app/charts.js';

const K = globalThis.KABU_CHARTS;
const fx = JSON.parse(readFileSync(new URL('./fixtures/p5a-sample.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-05T01:00:00Z'); // 日本時間 10:00
const items = fx.headlines.items.map((x) => ({ title: x.title, url: x.url, source: x.source, publishedAt: x.agoMin == null ? null : new Date(NOW - x.agoMin * 60e3).toISOString() }));

test('XSS: 題名の <img onerror> は要素にならず、javascript: の URL はリンクにならない', () => {
  const html = K.headlineItems([
    { title: '<img src=x onerror="alert(1)">危険な題名<script>alert(2)</script>', url: 'https://example.com/a', source: '<b>出典</b>', publishedAt: null },
    { title: 'リンクにしない', url: 'javascript:alert(1)', source: 'S', publishedAt: null },
    { title: '大文字・前の空白', url: '  JavaScript:alert(1)', source: 'S', publishedAt: null },
    { title: 'data URL', url: 'data:text/html,<script>alert(1)</script>', source: 'S', publishedAt: null },
    { title: '属性を閉じる URL', url: 'https://e.com/"onmouseover="alert(1)', source: 'S', publishedAt: '"><img src=x onerror=alert(3)>' },
  ], { today: '2026-10-05' });
  assert.ok(!/<img|<script|<b>/i.test(html), html);
  assert.ok(!/<[^>]+\son\w+\s*=/i.test(html), 'イベント属性を持つタグが作られた');
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['https://example.com/a', 'https://e.com/&quot;onmouseover=&quot;alert(1)']);
  assert.equal((html.match(/<a /g) || []).length, 2);
  assert.match(html, /<span class="hlt">リンクにしない<\/span>/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;危険な題名/);
  assert.ok(html.includes('target="_blank" rel="noopener"'));
});

test('headlineItems: 時刻は今日なら時:分・それ以外は月/日・無ければ —。最初の12件より後は hidden', () => {
  const html = K.headlineItems(items, { today: '2026-10-05', first: 12 });
  const lis = html.split('<li ').slice(1);
  assert.equal(lis.length, 30);
  assert.equal(lis.filter((l) => l.includes(' hidden')).length, 18);
  const times = lis.map((l) => /<time[^>]*>([^<]*)<\/time>/.exec(l)[1]);
  assert.equal(times[0], '09:40'); // 20分前
  assert.equal(times[12], '10/04'); // 1500分前＝前日
  assert.equal(times[29], '—');
  assert.ok(lis.every((l) => /class="hls"/.test(l)));
  assert.equal(K.headlineItems(null), '');
  assert.equal(K.headlineItems([{ title: '  ', url: 'https://e.com' }, { title: 3 }]), '');
});

test('ageBadge: 0・null は出さない、1〜4 は控えめ、5以上は注意色。jstParts は日本時間', () => {
  assert.equal(K.ageBadge(0), '');
  assert.equal(K.ageBadge(null), '');
  assert.equal(K.ageBadge(undefined), '');
  assert.equal(K.ageBadge(NaN), '');
  const b3 = K.ageBadge(3), b12 = K.ageBadge(12, 'blk');
  assert.match(b3, /class="age" data-age="3"/);
  assert.match(b3.replace(/<[^>]+>/g, ''), /^3営業日前の分析$/);
  assert.match(b12, /class="age old blk" data-age="12"/);
  assert.match(K.ageBadge(5), /age old/);
  assert.match(K.ageBadge(4), /class="age"/);
  assert.deepEqual(K.jstParts('2026-10-04T22:21:00.000Z'), { day: '2026-10-05', md: '10/05', hm: '07:21' });
  assert.equal(K.jstParts('bad'), null);
  assert.equal(K.jstParts(null), null);
  assert.equal(K.safeHref('http://e.com'), 'http://e.com');
  assert.equal(K.safeHref('ftp://e.com'), null);
});
