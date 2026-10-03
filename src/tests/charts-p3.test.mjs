// P3b：市場ページ・ニュース型・反省型の描画部品（app/charts.js）の機械テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import '../app/charts.js';
import { buildViewerHtml, dataJsText } from '../build.mjs';

const K = globalThis.KABU_CHARTS;
const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, '..', 'data');
const BAD = /NaN|undefined|Infinity/;
const clean = (s, what) => assert.ok(!BAD.test(s), `${what} に NaN/undefined/Infinity: …${String(s).slice(Math.max(0, String(s).search(BAD) - 60), String(s).search(BAD) + 20)}…`);
const fx = (n) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${n}.json`), 'utf8'));
const prices = JSON.parse(readFileSync(join(DATA, 'stocks/6501/prices.json'), 'utf8')).rows;
const seriesPath = join(DATA, 'market/series.json');
const series = existsSync(seriesPath) ? JSON.parse(readFileSync(seriesPath, 'utf8')).series : null;
const svgSize = (s) => { const m = /width="([\d.]+)" height="([\d.]+)"/.exec(s); return m ? [+m[1], +m[2]] : null; };
const nums = (s, re) => [...s.matchAll(re)].map((m) => +m[1]);
// 合成の日足（約2年、営業日だけ）
function synth(n, start = 30000, step = 37) {
  const out = [];
  const t = new Date('2024-10-01T00:00:00Z');
  while (out.length < n) {
    t.setUTCDate(t.getUTCDate() + 1);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    out.push({ d: t.toISOString().slice(0, 10), c: Math.round((start + out.length * step + Math.sin(out.length / 7) * 900) * 100) / 100 });
  }
  return out;
}

test('P3 charts: 新しい部品が globalThis.KABU_CHARTS に出ている', () => {
  for (const k of ['pinLayer', 'seriesWindow', 'marketChart', 'refGaugeModel', 'refGauge', 'durationBar', 'caseScale', 'monthBar']) assert.equal(typeof K[k], 'function', k);
  assert.deepEqual(Object.keys(K.RANGES), ['3m', '1y', '2y']);
  assert.deepEqual(K.DURATION.map((d) => d[0]), ['short', 'mid', 'long']);
});

test('seriesWindow: 基準日で切り、期間の窓を返す。移動平均は窓より前の足も使い、窓と同じ長さ', () => {
  const rows = synth(500);
  const asOf = rows[490].d;
  const w = K.seriesWindow(rows, asOf, 12, [25, 75, 200]);
  assert.equal(w.rows[w.rows.length - 1].d, asOf, '基準日より後の足を含まない');
  const first = new Date(w.rows[0].d + 'T00:00:00Z'), last = new Date(asOf + 'T00:00:00Z');
  const months = (last - first) / (30.44 * 864e5);
  assert.ok(months > 11.5 && months <= 12.05, `1年の窓（${months.toFixed(2)}か月）`);
  for (const k of ['ma25', 'ma75', 'ma200']) assert.equal(w.ma[k].length, w.rows.length, k);
  assert.ok(typeof w.ma.ma200[0] === 'number', '窓の最初の足でも、前の足があれば200日線を計算する');
  const i = rows.findIndex((r) => r.d === w.rows[0].d);
  const want = rows.slice(i - 24, i + 1).reduce((t, r) => t + r.c, 0) / 25;
  assert.ok(Math.abs(w.ma.ma25[0] - want) < 1e-6, '25日線の値');
  assert.ok(K.seriesWindow(rows, null, 3, []).rows.length < 70, '3か月');
  assert.ok(K.seriesWindow(rows, null, 24, []).rows.length >= 499, '2年（データのある範囲まで）');
  assert.deepEqual(K.seriesWindow([], null, 12, [25]), { rows: [], ma: {} });
  assert.equal(K.seriesWindow([{ d: 'x', c: NaN }, null], null, 12, [25]).rows.length, 0, '壊れた行は捨てる');
});

test('marketChart（日経平均＋ドル円）: 3つの期間・実データと合成データで NaN を出さず、文字は枠内、空は案内', () => {
  const sets = [];
  if (series) sets.push([series['^N225'].rows, series['JPY=X'].rows, '実データ']);
  sets.push([synth(500, 98765.43, 51), synth(520, 150.123, 0.01), '5桁・小数']);
  for (const [nk, fxr, what] of sets) {
    for (const r of Object.keys(K.RANGES)) {
      const m = K.RANGES[r][0];
      const a = K.seriesWindow(nk, null, m, [25, 75, 200]), b = K.seriesWindow(fxr, null, m, []);
      for (const [W, H] of [[760, 460], [1180, 560]]) {
        const s = K.marketChart({ main: { name: '日経平均', unit: '円', rows: a.rows, ma: a.ma }, sub: { name: 'ドル円', unit: '円', rows: b.rows }, W, H, label: `期間 ${K.RANGES[r][1]}` });
        clean(s, `marketChart ${what} ${r}`);
        assert.deepEqual(svgSize(s), [W, H]);
        assert.match(s, /class="mk-line"/);
        assert.match(s, /class="mk-sub"/);
        assert.match(s, /class="ma mk-ma25"/);
        for (const x of nums(s, /<text x="([\d.-]+)"/g)) assert.ok(x >= 0 && x <= W, `${what} ${r}: 文字の x=${x} が枠外`);
        for (const y of nums(s, /<text x="[\d.-]+" y="([\d.-]+)"/g)) assert.ok(y >= 0 && y <= H, `${what} ${r}: 文字の y=${y} が枠外`);
      }
    }
  }
  const one = K.marketChart({ main: { rows: [{ d: '2026-10-01', c: 1 }] }, sub: null, W: 600, H: 400 });
  assert.match(one, /指数の日足データがありません/);
  const noSub = K.marketChart({ main: { rows: synth(60) }, sub: { rows: [] }, W: 600, H: 400 });
  clean(noSub, 'ドル円なし');
  assert.doesNotMatch(noSub, /mk-sub/, 'ドル円が無ければ下段を描かない');
  assert.equal(K.marketChart({ main: { rows: synth(60) }, W: 100, H: 100 }), '', '小さすぎる枠では描かない');
});

test('refGauge（市場の物差し）: 負の値・基準は −max〜max、上限超え・未取得、印の位置', () => {
  const m = K.refGaugeModel({ value: -35.67, ref: -10, max: 20 });
  assert.equal(m.min, -20); assert.equal(m.max, 20); assert.equal(m.over, -1);
  assert.equal(m.pos(0), 50);
  const g = K.refGauge({ value: -35.67, ref: -10, max: 20 });
  clean(g, 'refGauge');
  assert.match(g, /未満/); assert.match(g, /class="zr"/, '0 の線');
  const p = K.refGaugeModel({ value: 17.8, ref: 15.5, max: 25 });
  assert.equal(p.min, 0);
  assert.ok(Math.abs(p.pos(17.8) - 71.2) < 1e-9);
  assert.match(K.refGauge({ value: 123.45, ref: null, max: 100 }), /超/);
  const nil = K.refGauge({ value: null, ref: null, max: 25 });
  assert.match(nil, /gt nil/); assert.doesNotMatch(nil, /gmk/, '値が無ければ印を描かない');
  clean(K.refGauge({ value: 0.81, ref: 0.5, max: 1 }), '0〜1');
  clean(K.refGauge({}), '空');
});

test('durationBar（期間の3段階）と過去事例の物差し: 該当の段だけ強調、null は棒を描かない', () => {
  for (const [k, i] of [['short', 0], ['mid', 1], ['long', 2]]) {
    const s = K.durationBar(k);
    assert.equal((s.match(/class="du( [a-z]+)?"/g) || []).length, 3);
    assert.equal((s.match(/class="du on"/g) || []).length, 1);
    assert.match(s, new RegExp(`class="du on" data-du="${k}"`));
    assert.equal((s.match(/class="du past"/g) || []).length, i, '手前の段は「経過」');
  }
  assert.doesNotMatch(K.durationBar('x'), /du on/);
  const sc = K.caseScale(fx('news-extreme').sections.cases);
  assert.ok(sc.drop >= 65.43 && sc.rec >= 120.25, '最大の値が物差しに入る');
  assert.deepEqual(K.caseScale(fx('news-sparse').sections.cases), { drop: 10, rec: 6 }, 'null だらけでも物差しは有限');
  assert.match(K.monthBar(null, 6), /mb nil/); assert.doesNotMatch(K.monthBar(null, 6), /<u/);
  assert.match(K.monthBar(3, 6), /width:50%/);
  assert.match(K.yoyBar(null, 10), /yb nil/);
});

test('ピン（pinLayer）: 価格の位置 at・上下の指定・data-date。表示範囲外の日付は描かない', () => {
  const rows = prices.slice(-122);
  const d = rows[60].d;
  const s = K.priceChart({ rows, pins: [{ date: d, label: '購入 5,600円', at: 5600, low: false, color: '#ffb340', cls: 'pin-entry' }, { date: '2001-01-01', label: '範囲外' }], W: 800, H: 460 });
  clean(s, 'priceChart pins');
  assert.equal((s.match(/class="a-fade pin/g) || []).length, 1, '範囲外は描かない');
  assert.match(s, new RegExp(`class="a-fade pin pin-entry" data-date="${d}"`));
  assert.match(s, /stroke="#ffb340"/, '色の指定');
});

test('levelChart の購入価格: 範囲内は線と札、遠ければ端の▲▼札だけ。ピンは価格帯別出来高の手前に収まる', () => {
  const rows = prices.slice(-122);
  const mid = rows[70];
  const opts = { rows, ma: {}, levels: [{ kind: 'support', low: 5040, high: 5166, strength: 3 }], vp: null, W: 860, H: 520 };
  const s = K.levelChart({ ...opts, entry: { price: mid.c, date: mid.d, label: '買' }, pins: [{ date: mid.d, label: '購入', at: mid.c, cls: 'pin-entry' }, { date: rows[100].d, label: '最大含み損', low: true, cls: 'pin-dn' }] });
  clean(s, 'levelChart entry');
  assert.match(s, /class="entryline"/);
  assert.match(s, /<g class="entry">/);
  assert.match(s, /class="a-fade pin pin-entry"/);
  assert.match(s, /class="a-fade pin pin-dn"/);
  const far = K.levelChart({ ...opts, entry: { price: 22730.5, date: '2024-10-07', label: '買' } });
  clean(far, 'levelChart far entry');
  assert.doesNotMatch(far, /entryline/, '遠い購入価格は線を引かない');
  assert.match(far, /買 22,730.5 ▲/);
  // 札（pinbox）の右端は価格軸（右端のタグ）より左
  const ax = Math.max(...nums(s, /<line x1="([\d.]+)" x2="\1" y1="28"/g));
  for (const m of s.matchAll(/<path d="M[\d.-]+ [\d.-]+ H([\d.-]+) V[\d.-]+ H[\d.-]+ V[\d.-]+ Z"[^>]*class="pinbox"/g)) assert.ok(+m[1] <= ax, `ピンの札が右端のタグ側にはみ出す ${m[1]} > ${ax}`);
  assert.equal(K.levelChart({ ...opts, rows: [], entry: { price: 1, date: 'x' } }).includes('株価データがありません'), true);
});

test('ビューア: 市場ページ・ニュース型・反省型の描画コードを含み、test-hooks は含まない', () => {
  const html = buildViewerHtml({ dataJs: dataJsText({ generatedAt: '2026-10-03T00:00:00.000Z', stocks: {}, market: null, glossary: [], notes: [], checklistItems: [] }) });
  for (const w of ['function renderMarket', 'function newsView', 'function hanseiView', 'function marketChart', 'data-gnav', '#/glossary', '#/notes']) assert.ok(html.includes(w), w);
  assert.ok(!html.includes('function checkP3'), 'test-hooks が埋め込まれている');
});
