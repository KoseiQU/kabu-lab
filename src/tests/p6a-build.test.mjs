// P6a（§5.10）の build: market.sectors・market.movers・market.picks（注目候補の答え合わせ）と集計。手計算で答えが分かる小さな系列で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildData, buildPicks, picksSummary, closeOnOrBefore, pickRows, sanitizeSectors, sanitizeMovers } from '../build.mjs';
import { parseSectors, buildMovers } from '../collect/lib/market-extra.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const rows = (list) => list.map(([d, c]) => ({ d, c }));
// 日経平均（平日だけ）
const NK = rows([['2026-09-01', 1000], ['2026-09-02', 1000], ['2026-09-03', 1010], ['2026-09-04', 1020], ['2026-09-07', 1030], ['2026-09-08', 1040], ['2026-09-09', 1050], ['2026-09-10', 1060], ['2026-09-11', 1070]]);
const A = rows([['2026-09-01', 100], ['2026-09-02', 102], ['2026-09-03', 104], ['2026-09-04', 106], ['2026-09-07', 108], ['2026-09-08', 110], ['2026-09-09', 110]]);
const B = rows([['2026-09-04', 200], ['2026-09-07', 190], ['2026-09-08', 180], ['2026-09-09', 170], ['2026-09-10', 160], ['2026-09-11', 150]]);
const C = rows([['2026-09-10', 50], ['2026-09-11', 51], ['2026-09-14', 52]]);
const theme = (name, dir, codes) => ({ name, dir, horizon: 'short', sectorKey: null, reason: 'r', stocks: codes.map((c) => ({ code: c, name: `社${c}`, why: 'w' })), breakIf: 'b' });
const an = (date, asOf, themes) => ({ type: 'market', date, price: { close: 1, asOf }, sections: { themes }, _file: `data/market/${date}.json` });

test('closeOnOrBefore: その日以前で最後の終値（休場日は直前の取引日に寄せる）', () => {
  assert.deepEqual(closeOnOrBefore(NK, '2026-09-05'), { d: '2026-09-04', c: 1020 });
  assert.deepEqual(closeOnOrBefore(NK, '2026-09-02'), { d: '2026-09-02', c: 1000 });
  assert.equal(closeOnOrBefore(NK, '2026-08-31'), null);
  assert.equal(closeOnOrBefore(null, '2026-09-01'), null);
});

test('pickRows: 登録済み銘柄の株価を優先。登録済みのほうが古ければ picks-prices の新しいほう', () => {
  const pricesByCode = new Map([['1111', A], ['2222', A.slice(0, 3)]]);
  const picksPrices = { prices: { 1111: { rows: B }, 2222: { rows: A }, 3333: { rows: C } } };
  assert.equal(pickRows('1111', { pricesByCode, picksPrices }).from, 'picks'); // B の最終日 09-11 > A の 09-09
  assert.equal(pickRows('1111', { pricesByCode, picksPrices: { prices: { 1111: { rows: A } } } }).from, 'stock'); // 同じ日なら登録済み
  assert.equal(pickRows('2222', { pricesByCode, picksPrices }).from, 'picks');
  assert.equal(pickRows('3333', { pricesByCode, picksPrices }).from, 'picks');
  assert.deepEqual(pickRows('9999', { pricesByCode, picksPrices }), { rows: [], from: null });
});

test('buildPicks: 基準日の寄せ・騰落率・同期間の日経平均・差・経過営業日数・young・株価なしは null', () => {
  const analyses = [
    an('2026-09-02', '2026-09-02', [theme('追い風A', 'tailwind', ['1111', '9999']), theme('追い風C', 'tailwind', ['3333']), theme('向かい風B', 'headwind', ['2222'])]),
    an('2026-09-06', '2026-09-05', [theme('向かい風B2', 'headwind', ['2222']), theme('追い風A2', 'tailwind', [])]),
    { type: 'market', date: '2026-09-03', price: { asOf: '2026-09-03' }, sections: {} }, // themes なし
  ];
  const pricesByCode = new Map([['1111', A]]);
  const picksPrices = { prices: { 2222: { rows: B }, 3333: { rows: C } } };
  const { items, summary } = buildPicks(analyses, { pricesByCode, picksPrices, nikkei: NK });
  assert.deepEqual(items.map((x) => `${x.date}:${x.code}`), ['2026-09-06:2222', '2026-09-02:1111', '2026-09-02:9999', '2026-09-02:3333', '2026-09-02:2222'], '新しい分析から');
  const by = (d, c) => items.find((x) => x.date === d && x.code === c);
  // A: 基準 09-02 の 102 → 直近 09-09 の 110 = +7.84%、日経平均 1000→1050 = +5%、差 +2.84、5営業日
  const a = by('2026-09-02', '1111');
  assert.deepEqual([a.base, a.baseDate, a.latest, a.latestDate, a.pct, a.nikkeiPct, a.diff, a.days, a.young, a.priceFrom], [102, '2026-09-02', 110, '2026-09-09', 7.84, 5, 2.84, 5, false, 'stock']);
  assert.deepEqual([a.theme, a.dir, a.name, a.why, a.asOf, a.file], ['追い風A', 'tailwind', '社1111', 'w', '2026-09-02', 'data/market/2026-09-02.json']);
  // B（基準日 09-05＝土曜 → 直前の取引日 09-04 の 200）→ 09-11 の 150 = -25%、日経平均 1020→1070 = +4.9%、差 -29.9、5営業日
  const b = by('2026-09-06', '2222');
  assert.deepEqual([b.base, b.baseDate, b.latest, b.pct, b.nikkeiPct, b.diff, b.days, b.young, b.dir], [200, '2026-09-04', 150, -25, 4.9, -29.9, 5, false, 'headwind']);
  // 9/2 の分析の B: 9/2 以前の株価が無い（B は 9/4 から）→ 数値は null で残す
  const b0 = by('2026-09-02', '2222');
  assert.deepEqual([b0.base, b0.pct, b0.nikkeiPct, b0.days, b0.young], [null, null, null, null, false]);
  // C: 9/2 以前が無い → null。株価の無いコードも null で残す
  assert.equal(by('2026-09-02', '3333').pct, null);
  const d = by('2026-09-02', '9999');
  assert.deepEqual([d.base, d.latest, d.pct, d.nikkeiPct, d.diff, d.days, d.priceFrom], [null, null, null, null, null, null, null]);
  // 集計: 追い風の対象は A だけ（1件中1件が上回る）、向かい風は B（1件中1件が下回る）
  assert.deepEqual(summary, { all: 5, tailwind: { above: 1, total: 1 }, headwind: { below: 1, total: 1 }, young: 0, noPrice: 3 });
});

test('buildPicks: young（5営業日未満）は集計から除く。経過0日（基準日＝最新日）は 0% で young', () => {
  const analyses = [an('2026-09-10', '2026-09-10', [theme('t1', 'tailwind', ['3333']), theme('t2', 'tailwind', ['4444']), theme('h', 'headwind', ['5555'])])];
  const picksPrices = { prices: { 3333: { rows: C }, 4444: { rows: rows([['2026-09-10', 10]]) }, 5555: { rows: B } } };
  const nk = [...NK, { d: '2026-09-14', c: 1080 }];
  const { items, summary } = buildPicks(analyses, { picksPrices, nikkei: nk });
  const c = items.find((x) => x.code === '3333');
  assert.deepEqual([c.base, c.latest, c.pct, c.days, c.young], [50, 52, 4, 2, true]);
  assert.equal(c.nikkeiPct, round(((1080 - 1060) / 1060) * 100));
  const z = items.find((x) => x.code === '4444');
  assert.deepEqual([z.pct, z.days, z.young], [0, 0, true]);
  const h = items.find((x) => x.code === '5555'); // 160 → 150 は1営業日
  assert.deepEqual([h.pct, h.days, h.young], [-6.25, 1, true]);
  assert.deepEqual(summary, { all: 3, tailwind: { above: 0, total: 0 }, headwind: { below: 0, total: 0 }, young: 3, noPrice: 0 });
});
const round = (x) => Math.round(x * 100) / 100;

test('picksSummary: 同じ値は上回った・下回ったに数えない。日経平均が無い候補は除く', () => {
  const it = (dir, pct, nikkeiPct, young = false) => ({ dir, pct, nikkeiPct, young });
  const s = picksSummary([it('tailwind', 3, 3), it('tailwind', 4, 3), it('tailwind', 1, 3), it('tailwind', 5, null), it('headwind', 2, 2), it('headwind', -1, 2), it('headwind', 9, 2), it('headwind', -9, 2, true)]);
  assert.deepEqual(s, { all: 8, tailwind: { above: 1, total: 3 }, headwind: { below: 1, total: 3 }, young: 1, noPrice: 1 });
  assert.deepEqual(picksSummary(null), { all: 0, tailwind: { above: 0, total: 0 }, headwind: { below: 0, total: 0 }, young: 0, noPrice: 0 });
});

test('sanitizeSectors/sanitizeMovers: 実データの形を通し、壊れた行・不正なコードは落とす', () => {
  const SPARK = JSON.parse(fx('yahoo-spark-sectors-tail.json'));
  const s = sanitizeSectors(parseSectors(SPARK, new Date('2026-10-05T03:00:00Z')));
  assert.equal(s.items.length, 17);
  assert.equal(s.asOf, '2026-10-05');
  assert.equal(sanitizeSectors({ items: [{ code: 'x' }] }), null);
  assert.equal(sanitizeSectors(null), null);
  const m = sanitizeMovers(buildMovers(fx('kabutan-warning-up.html'), fx('kabutan-warning-down.html'), new Date('2026-10-05T03:00:00Z')));
  assert.deepEqual([m.up.length, m.down.length, m.asOf, m.time], [10, 10, '2026-10-05', '11:53']);
  const bad = sanitizeMovers({ up: [{ code: '<b>', name: 'x', pct: 1 }, { code: '6501', name: '<img src=x onerror=1>', pct: 'NaN' }, { code: '6501', name: 'ok', pct: 1.5 }], down: [] });
  assert.deepEqual(bad.up, [{ code: '6501', name: 'ok', pct: 1.5, close: null }]);
  assert.equal(sanitizeMovers({ up: [], down: [] }), null);
});

test('buildData: data/market の sectors・movers・picks-prices と分析の themes から market.sectors・movers・picks・picksSummary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-p6a-build-'));
  const w = (p, o) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), typeof o === 'string' ? o : JSON.stringify(o)); };
  try {
    const sample = JSON.parse(fx('market-sample.json'));
    w('market/2026-09-02.json', { ...sample, date: '2026-09-02', price: { ...sample.price, asOf: '2026-09-02' } });
    w('market/series.json', { series: { '^N225': { key: 'nikkei225', name: '日経平均', unit: '円', rows: NK } } });
    w('market/sectors.json', parseSectors(JSON.parse(fx('yahoo-spark-sectors-tail.json'))));
    w('market/movers.json', buildMovers(fx('kabutan-warning-up.html'), fx('kabutan-warning-down.html')));
    const codes = sample.sections.themes.flatMap((t) => t.stocks.map((s) => s.code));
    w('market/picks-prices.json', { prices: Object.fromEntries(codes.slice(0, -1).map((c, i) => [c, { rows: A.map((r) => ({ d: r.d, c: r.c + i })) }])) });
    // 7013 は登録済み（prices.json）。こちらを優先
    w('stocks/7013/prices.json', { meta: { code: '7013' }, rows: A.map((r) => ({ ...r, o: r.c, h: r.c, l: r.c, v: 1 })) });
    const k = buildData({ dataDir: dir, schemasDir: join(ROOT, 'schemas') });
    assert.equal(k.market.sectors.items.length, 17);
    assert.equal(k.market.movers.up.length, 10);
    assert.equal(k.market.picks.length, codes.length);
    const ihi = k.market.picks.find((p) => p.code === '7013');
    assert.deepEqual([ihi.priceFrom, ihi.base, ihi.latest, ihi.pct], ['stock', 102, 110, 7.84]);
    const last = k.market.picks.find((p) => p.code === codes.at(-1));
    assert.equal(last.pct, null, '株価の無い候補は null');
    assert.equal(k.market.picksSummary.all, codes.length);
    assert.equal(k.market.picksSummary.noPrice, 1);
    // ファイルが無い・壊れていても止めない
    w('market/movers.json', '{broken');
    const warns = [];
    const k2 = buildData({ dataDir: dir, schemasDir: join(ROOT, 'schemas'), warn: (m) => warns.push(m) });
    assert.equal(k2.market.movers, null);
    assert.ok(warns.some((m) => m.includes('movers.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
