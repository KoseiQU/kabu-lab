import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKabutan } from '../collect/kabutan.mjs';
import { computeAll } from '../collect/lib/indicators.mjs';
import { buildDigest, fitToLimit, DIGEST_LIMIT } from '../collect/lib/digest.mjs';

const html = readFileSync(new URL('./fixtures/kabutan-6501.html', import.meta.url), 'utf8');
const day = (i) => new Date(Date.UTC(2024, 9, 1) + i * 86400000).toISOString().slice(0, 10);
const rows = Array.from({ length: 490 }, (_, i) => {
  const c = 5000 + 400 * Math.sin(i / 9) + 150 * Math.sin(i / 2.3);
  return { d: day(i), o: c - 20, h: c + 60, l: c - 60, c: Math.round(c), v: 1e7 + (i % 11) * 1e6 };
});

test('digest: 実形式の入力で8KB以内・主要見出しを含む', () => {
  const profile = parseKabutan(html, '6501');
  const d = buildDigest({ code: '6501', profile, ind: computeAll(rows), missing: profile.missing });
  assert.ok(Buffer.byteLength(d) <= DIGEST_LIMIT, `${Buffer.byteLength(d)} bytes`);
  for (const h of ['基本情報', 'テクニカル指標', 'スイング', '価格帯別出来高', '窓', 'クロス', '信用残', '業績推移', '直近20日', '取得できなかった項目']) {
    assert.ok(d.includes(h), h);
  }
  assert.ok(d.includes('PER 27.3倍'));
  assert.ok(d.includes('利回り 未取得'));
  assert.ok(!d.includes('NaN') && !d.includes('undefined'));
});

test('digest: 入力が膨大でも古い情報から削って8KB以内', () => {
  const profile = parseKabutan(html, '6501');
  profile.themes = Array.from({ length: 10 }, (_, i) => `とても長いテーマ名${i}`.repeat(5));
  const ind = computeAll(rows);
  ind.gaps = Array.from({ length: 200 }, (_, i) => ({ d: day(i), dir: 'up', from: 1000, to: 1100, pct: 10, filled: false }));
  ind.swings.highs = Array.from({ length: 200 }, (_, i) => ({ d: day(i), price: 1000 + i }));
  const missing = Array.from({ length: 100 }, (_, i) => `未取得の項目その${i}`);
  const d = buildDigest({ code: '6501', profile, ind, missing });
  assert.ok(Buffer.byteLength(d) <= DIGEST_LIMIT, `${Buffer.byteLength(d)} bytes`);
  assert.match(d, /古い\d+行を省略/);
  // 最新の窓（day(199)）は残り、最古（day(0)）は消える
  assert.ok(d.includes(day(199)));
  assert.ok(!d.includes(`- ${day(0)} 上窓`));
});

test('fitToLimit: 削れない巨大テキストもバイト境界で切る', () => {
  const t = fitToLimit('#\n', [{ title: 'x', head: ['あ'.repeat(5000)], items: [] }]);
  assert.ok(Buffer.byteLength(t) <= DIGEST_LIMIT);
  assert.ok(!t.includes('�'));
});

test('digest: 株探・株価が欠けても書ける', () => {
  const d1 = buildDigest({ code: '6501', profile: null, ind: computeAll(rows), missing: ['株探の基本情報一式'] });
  assert.match(d1, /株探の取得に失敗/);
  const d2 = buildDigest({ code: '6501', profile: parseKabutan(html, '6501'), ind: null });
  assert.match(d2, /株価の取得に失敗/);
});
