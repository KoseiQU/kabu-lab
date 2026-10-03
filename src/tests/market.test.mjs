// 市場の収集拡張（P3a）: spark 応答の解析・series・digest-market（ネットに出ない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sparkPoints, parseSpark, parseMarket, parseSeries, sparkUrl, SYMBOLS, marketPaths, marketIsFresh, seriesJsonText } from '../collect/market.mjs';
import { shiftDate, changeOver, seriesStats, buildMarketDigest, MARKET_DIGEST_LIMIT } from '../collect/lib/digest-market.mjs';

// 実際の応答（2026-10-03 取得、range=2y）の末尾6点だけを残したもの
const SPARK = JSON.parse(readFileSync(new URL('./fixtures/yahoo-spark-2y-tail.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-03T06:00:00Z');
const T0 = Date.UTC(2026, 8, 30, 0, 0) / 1000; // 2026-09-30 09:00 JST

/** 暦日で連続した日付の系列（d0 から n 日） */
function daily(n, f, d0 = '2025-01-01') {
  const t0 = new Date(d0 + 'T00:00:00Z').getTime();
  return Array.from({ length: n }, (_, i) => ({ d: new Date(t0 + i * 86400000).toISOString().slice(0, 10), c: f(i) }));
}

test('sparkUrl: 6銘柄を range=2y の1リクエストで取る', () => {
  const u = sparkUrl(SYMBOLS.map((s) => s.symbol));
  assert.match(u, /range=2y&interval=1d/);
  assert.equal(decodeURIComponent(u.split('symbols=')[1].split('&')[0]).split(',').length, 6);
  assert.deepEqual(SYMBOLS.filter((s) => s.series).map((s) => s.symbol), ['^N225', 'JPY=X', '^TNX']);
});

test('sparkPoints: null を除き、同じ日本時間の日付は後の点を残し、最終点の null は fulldayPrice で補う', () => {
  const pts = sparkPoints({ timestamp: [T0, T0 + 3600, T0 + 86400, T0 + 2 * 86400], close: [100, 101, null, null], fulldayPrice: 99 });
  assert.deepEqual(pts.map((p) => [p.d, p.c]), [['2026-09-30', 101], ['2026-10-02', 99]]);
  assert.deepEqual(sparkPoints(null), []);
  // 同日2点のとき前日比は前の日付と比べる
  assert.deepEqual(parseSpark({ timestamp: [T0 - 86400, T0, T0 + 7200], close: [200, 210, 220] }), {
    value: 220, prev: 200, change: 20, changePct: 10, asOf: '2026-09-30',
  });
});

test('parseMarket: 保存した応答から6指標の直近値と前日比', () => {
  const m = parseMarket(SPARK, NOW);
  assert.equal(m.date, '2026-10-03');
  assert.deepEqual(m.missing, []);
  assert.deepEqual(m.items.nikkei225, { symbol: '^N225', name: '日経平均', unit: '円', value: 68309.46, prev: 68956.72, change: -647.26, changePct: -0.94, asOf: '2026-10-02' });
  assert.equal(m.items.usdjpy.value, 157.83);
  assert.equal(m.items.usdjpy.prev, 157.927);
  assert.equal(m.items.usdjpy.asOf, '2026-10-03');
  assert.equal(m.items.us10y.value, 5.277);
  assert.ok(m.items.topixEtf.note.includes('ETF'));
});

test('parseSeries: 3銘柄の終値列（日本時間の日付・昇順）、欠けた銘柄は missing', () => {
  const s = parseSeries(SPARK, NOW);
  assert.deepEqual(Object.keys(s.series), ['^N225', 'JPY=X', '^TNX']);
  const nk = s.series['^N225'];
  assert.equal(nk.key, 'nikkei225');
  assert.equal(nk.unit, '円');
  assert.equal(nk.rows.length, 6);
  assert.deepEqual(nk.rows.at(-1), { d: '2026-10-02', c: 68309.46 });
  assert.deepEqual(nk.rows.map((r) => r.d), [...nk.rows.map((r) => r.d)].sort());
  assert.ok(s.series['^TNX'].rows.every((r) => Object.keys(r).join() === 'd,c'));
  const part = parseSeries({ '^N225': SPARK['^N225'] }, NOW);
  assert.deepEqual(Object.keys(part.series), ['^N225']);
  assert.deepEqual(part.missing, ['ドル円(JPY=X)', '米10年金利(^TNX)']);
});

test('seriesJsonText: 1行=1日足で書き、読み戻すと同じ中身', () => {
  const s = parseSeries(SPARK, NOW);
  const t = seriesJsonText(s);
  assert.deepEqual(JSON.parse(t), s);
  assert.match(t, /\n   \{"d":"2026-10-02","c":68309\.46\}/);
  assert.equal(t.split('\n').filter((l) => l.includes('"d":')).length, 18);
});

test('shiftDate: 月末は丸める・年をまたぐ', () => {
  assert.equal(shiftDate('2026-03-31', { months: 1 }), '2026-02-28');
  assert.equal(shiftDate('2026-01-15', { months: 3 }), '2025-10-15');
  assert.equal(shiftDate('2024-02-29', { years: 1 }), '2023-02-28');
  assert.equal(shiftDate('2026-10-02', { months: 12 }), '2025-10-02');
});

test('changeOver: 期間前の日以前で最後の終値と比べる。データが足りなければ null', () => {
  const rows = [{ d: '2026-08-31', c: 100 }, { d: '2026-09-01', c: 105 }, { d: '2026-09-30', c: 110 }, { d: '2026-10-02', c: 120 }];
  // 1か月前 = 2026-09-02 → それ以前の最後は 09-01 の 105
  assert.deepEqual(changeOver(rows, { months: 1 }), { from: '2026-09-01', fromValue: 105, diff: 15, pct: 14.29 });
  assert.equal(changeOver(rows, { months: 3 }), null);
  assert.equal(changeOver([], { months: 1 }), null);
});

test('seriesStats: 一直線に上がる系列（答えが手計算できる）', () => {
  const rows = daily(300, (i) => i + 1); // 1..300、2025-01-01〜2025-10-27
  const s = seriesStats(rows);
  const m25 = s.ma.find((m) => m.n === 25);
  assert.equal(m25.value, 288); // 276..300 の平均
  assert.equal(m25.deviationPct, 4.17); // (300-288)/288
  assert.equal(m25.slope, 'up');
  assert.equal(s.ma.find((m) => m.n === 200).value, 200.5);
  assert.equal(s.rsi14, 100);
  assert.deepEqual(s.week52, { high: 300, highDate: '2025-10-27', low: 1, lowDate: '2025-01-01', position: 1 });
  // 52週より前の安値は数えない・位置は (終値-安値)/(高値-安値)
  const v = daily(400, (i) => (i < 30 ? 1 : i === 200 ? 500 : 100));
  const w = seriesStats(v).week52;
  assert.equal(w.low, 100);
  assert.equal(w.high, 500);
  assert.equal(w.position, 0);
  assert.equal(seriesStats(daily(10, () => 5)).ma[0].value, null); // 25日に足りない
  assert.equal(seriesStats(daily(10, () => 5)).week52.position, null); // 全同値
});

test('buildMarketDigest: 保存した応答から作れて、4KB以内・必要な節がそろう', () => {
  const t = buildMarketDigest({ raw: parseMarket(SPARK, NOW), series: parseSeries(SPARK, NOW), generatedAt: NOW.toISOString() });
  assert.ok(Buffer.byteLength(t) <= MARKET_DIGEST_LIMIT);
  for (const h of ['各指標の直近値と前日比', '変化（', '日経平均のテクニカル', 'ドル円の移動平均', '直近']) assert.ok(t.includes(h), h);
  assert.match(t, /\| 日経平均 \| 68,309\.46円 \| -647\.26 \| -0\.94% \| 2026-10-02 \|/);
  assert.ok(!/NaN|undefined/.test(t));
});

test('buildMarketDigest: 2年分の長い系列でも4KB以内（直近の終値の日数を減らして収める）・1か月/3か月/1年と25/75/200日線', () => {
  const big = (key, name, unit, f) => ({ key, name, unit, rows: daily(730, f, '2024-10-03') });
  const series = { series: {
    '^N225': big('nikkei225', '日経平均', '円', (i) => 40000 + i * 37.123456),
    'JPY=X': big('usdjpy', 'ドル円', '円', (i) => 140 + (i % 50) * 0.333333),
    '^TNX': big('us10y', '米10年金利', '%', (i) => 3.5 + i * 0.002345),
  } };
  const raw = parseMarket(SPARK, NOW);
  const t = buildMarketDigest({ raw, series, generatedAt: NOW.toISOString() });
  assert.ok(Buffer.byteLength(t) <= MARKET_DIGEST_LIMIT, `${Buffer.byteLength(t)} bytes`);
  assert.match(t, /\| 日経平均 \| 2026-10-02 \| .* \| \+[\d.]+% \| \+[\d.]+% \| \+[\d.]+% \|/);
  assert.match(t, /\| 米10年金利 .*pt（/);
  for (const n of [25, 75, 200]) assert.match(t, new RegExp(`\\| ${n}日 \\| [\\d,]+ \\| \\+[\\d.]+% \\| 上向き \\|`));
  assert.match(t, /RSI\(14\) 100/);
  assert.match(t, /レンジ内の位置 1（0=安値・1=高値）/);
  assert.match(t, /25日線 .*75日線/s);
});

test('buildMarketDigest: 時系列が無くても落ちずに「未取得」', () => {
  const t = buildMarketDigest({ raw: parseMarket({}, NOW), series: { series: {} } });
  assert.match(t, /日経平均のテクニカル\n未取得/);
  assert.match(t, /未取得: 日経平均/);
  assert.ok(Buffer.byteLength(t) <= MARKET_DIGEST_LIMIT);
});

test('--if-stale: 今日の raw・series・digest がそろい digest が最新なら省く', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-mkt-'));
  try {
    const now = new Date('2026-10-02T09:00:00Z'); // 18:00 JST（引け後）
    const p = marketPaths(dir, now);
    assert.equal(p.raw, join(dir, 'market', '2026-10-02-raw.json'));
    mkdirSync(join(dir, 'market'));
    assert.equal(marketIsFresh(p, now), false);
    for (const f of [p.raw, p.series, p.digest]) writeFileSync(f, 'x');
    const at = (iso) => utimesSync(p.digest, new Date(iso), new Date(iso));
    at('2026-10-02T07:00:00Z'); // 16:00 JST に作成 → 最新
    assert.equal(marketIsFresh(p, now), true);
    at('2026-10-01T09:00:00Z'); // 前日 → 古い
    assert.equal(marketIsFresh(p, now), false);
    at('2026-10-02T07:00:00Z');
    rmSync(p.series);
    assert.equal(marketIsFresh(p, now), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
