// app/charts.js（DOM非依存の描画部品）と app/ の約束事の機械テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateAnalysis, BANNED_WORDS } from '../tools/validate.mjs';
import '../app/charts.js';

const K = globalThis.KABU_CHARTS;
const ROOT = new URL('..', import.meta.url).pathname;
const BAD = /NaN|undefined|Infinity/;
const clean = (s, what) => assert.ok(!BAD.test(s), `${what} に NaN/undefined/Infinity: …${String(s).match(BAD) && s.slice(Math.max(0, s.search(BAD) - 60), s.search(BAD) + 20)}…`);
const sample = JSON.parse(readFileSync(join(ROOT, 'data/stocks/6501/analyses/2026-10-01-quick.json'), 'utf8'));
const prices6501 = JSON.parse(readFileSync(join(ROOT, 'data/stocks/6501/prices.json'), 'utf8')).rows;
const fixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/sparse-quick.json'), 'utf8'));
const bar = (d, c, v = 1000) => ({ d, o: c, h: c, l: c, c, v });

test('charts: ブラウザと Node の両方で読める（globalThis.KABU_CHARTS）', () => {
  assert.equal(typeof K, 'object');
  for (const k of ['priceChart', 'perf3d', 'supply3d', 'fan', 'donut', 'spark', 'meter', 'gauge', 'devCell', 'checklist', 'niceTicks', 'sma']) assert.equal(typeof K[k], 'function', k);
});

test('niceTicks: 通常・空・単一値・全同値・逆順・負数・巨大値でも有限で昇順', () => {
  const cases = [[4350, 5950], [0, 0], [5, 5], [NaN, 3], [undefined, undefined], [10, -10], [-0.3, 0.2], [1, 1e12], [285.5, 285.5], [0.001, 0.002]];
  for (const [a, b] of cases) {
    const t = K.niceTicks(a, b, 5);
    assert.ok(t.ticks.length >= 2 && t.ticks.length < 50, `${a},${b}: 本数 ${t.ticks.length}`);
    assert.ok(t.ticks.every(Number.isFinite), `${a},${b}: 非有限`);
    for (let i = 1; i < t.ticks.length; i++) assert.ok(t.ticks[i] > t.ticks[i - 1], `${a},${b}: 昇順でない`);
    if (Number.isFinite(a) && Number.isFinite(b)) assert.ok(t.lo <= Math.min(a, b) && t.hi >= Math.max(a, b), `${a},${b}: 範囲を覆わない`);
  }
  assert.deepEqual(K.niceTicks(0, 40, 4).ticks, [0, 10, 20, 30, 40]);
});

test('sma / deviation: 足りない・欠損は null、日立 10/01 はモックの乖離率と一致', () => {
  assert.deepEqual(K.sma([], 5), []);
  assert.deepEqual(K.sma([1, 2], 5), [null, null]);
  assert.deepEqual(K.sma([1, null, 3, 4], 2), [null, null, null, 3.5]);
  assert.equal(K.deviation([1, 2], 5), null);
  assert.equal(K.deviation([0, 0, 0], 3), null);
  const closes = prices6501.filter((r) => r.d <= '2026-10-01').map((r) => r.c);
  const got = [5, 25, 75, 200].map((n) => K.deviation(closes, n).toFixed(2));
  assert.deepEqual(got, ['0.12', '2.29', '7.68', '9.13']);
});

test('書式: 負号・符号・万円・兆億・出来高', () => {
  assert.equal(K.fmt(-647.26, 2), '−647.26');
  assert.equal(K.fmtS(21), '+21');
  assert.equal(K.fmtS(-0.23, 2), '−0.23');
  assert.equal(K.fmtS(0, 2), '0.00');
  assert.equal(K.fmt(NaN), '—');
  assert.equal(K.fmt(undefined), '—');
  assert.deepEqual(K.yenParts(551000), [['55', '万'], ['1,000', '円']]);
  assert.deepEqual(K.yenParts(28550), [['2', '万'], ['8,550', '円']]);
  assert.deepEqual(K.yenParts(3845000), [['384', '万'], ['5,000', '円']]);
  assert.deepEqual(K.yenParts(100000), [['10', '万円']]);
  assert.deepEqual(K.jpAmountParts('25兆454億円'), [['25', '兆'], ['454', '億円']]);
  assert.equal(K.jpAmountParts(null), null);
  assert.equal(K.fmtVol(29820000), '2,982万');
  assert.equal(K.niceCeil(29820000), 30000000);
});

test('spread: 重なりを押し広げ、順序と範囲を保つ', () => {
  const ys = K.spread([100, 102, 104, 300], 20, 0, 400);
  assert.deepEqual(ys, [100, 120, 140, 300]);
  const edge = K.spread([395, 398], 20, 0, 400);
  assert.ok(edge[1] <= 400 && edge[1] - edge[0] >= 20);
  assert.deepEqual(K.spread([], 10, 0, 10), []);
});

test('priceChart: 実データ・空・1本・全同値・欠損値で NaN を出さない', () => {
  const rows = prices6501.filter((r) => r.d > '2026-04-01' && r.d <= '2026-10-01');
  const c = sample.sections.chart;
  const svg = K.priceChart({ rows, ma25: [], ma75: [], res: c.resistance, sup: c.support, pins: c.pins, W: 700, H: 420 });
  clean(svg, '日立');
  assert.match(svg, /RES 5,830/);
  assert.match(svg, /SUP 5,040/);
  assert.match(svg, /8\/14 高値 5,830/);
  assert.equal((svg.match(/class="a-fade pin"/g) || []).length, 3);
  for (const [name, r] of [['空', []], ['1本', [bar('2026-10-01', 100)]], ['全同値', Array.from({ length: 30 }, (_, i) => bar(`2026-09-${String(i + 1).padStart(2, '0')}`, 500, 0))], ['欠損', [bar('2026-10-01', 100), { d: '2026-10-02', o: null, h: 1, l: 1, c: NaN }]]]) {
    clean(K.priceChart({ rows: r, ma25: [null], ma75: [], res: [{ price: NaN }], sup: [{ price: 1e9, label: '遠い' }], pins: [{ date: 'x', label: 'y' }], W: 600, H: 380 }), name);
  }
  assert.equal(K.priceChart({ rows, W: 0, H: 0 }), '');
});

test('perf3d / supply3d / fan / donut / spark / meter / gauge / devCell: 空・単一・全同値・null', () => {
  clean(K.perf3d(sample.sections.performance, 340, 200), '業績 日立');
  const perfCases = [[], [{ period: '2026.3', sales: 100, profit: 10, eps: 1, dividend: null, forecast: false }],
    [{ period: '2025.3', sales: 100, profit: 10 }, { period: '2026.3', sales: 100, profit: 10 }],
    [{ period: '2025.3', sales: 200, profit: -50, eps: null, dividend: '未定', forecast: false }, { period: '2026.3', sales: null, profit: null, eps: null, dividend: null, forecast: true }],
    [{ period: '2025.3', sales: 100, profit: 900 }, { period: '2026.3', sales: 300, profit: 100 }]];
  perfCases.forEach((p, i) => clean(K.perf3d(p, 340, 200), `業績${i}`));
  clean(K.supply3d(sample.sections.margin, 300, 90), '需給 日立');
  [[], [{ date: '2026-09-25', sell: 1, buy: 1, ratio: 1 }], [{ date: 'a', sell: null, buy: null, ratio: null }], [{ date: 'a', sell: 0, buy: 0, ratio: 0 }, { date: 'b', sell: 0, buy: 0, ratio: 0 }]]
    .forEach((m, i) => clean(K.supply3d(m, 300, 90), `需給${i}`));
  const T = (k) => sample.sections.scenarios.find((s) => s.kind === k).target;
  clean(K.fan({ hist: prices6501.slice(-20).map((r) => r.c), now: 5510, bull: T('bull'), base: T('base'), bear: T('bear'), W: 200, H: 180 }), 'シナリオ 日立');
  [{ hist: [], now: 100 }, { hist: [100], now: 100, bull: { price: 100 }, bear: { price: 100 } }, { hist: [1, 1, 1], now: null }, { hist: [5, 5], now: 5, base: { low: 5, high: 5 } }]
    .forEach((o, i) => clean(K.fan({ ...o, W: 200, H: 180 }), `シナリオ${i}`));
  [[], [{ v: 0 }], [{ v: 5 }], [{ v: 1 }, { v: 1 }, { v: -3 }], [{ v: NaN }]].forEach((d, i) => clean(K.donut(d), `ドーナツ${i}`));
  [[], [1], [3, 3, 3], [1, NaN, 2]].forEach((v, i) => clean(K.spark(v, i % 2 === 0), `折れ線${i}`));
  [0, 1, 0.5, NaN, -1, 2, undefined].forEach((v) => clean(K.meter(v), `メーター${v}`));
  [{ value: 27.3, ref: 16.95, max: 40 }, { value: 52.1, ref: 16.95, max: 40 }, { value: 0, ref: null, max: 0 }, { value: null, ref: null, max: null }]
    .forEach((g, i) => clean(K.gauge(g), `ゲージ${i}`));
  [0.12, -3.1, 15, -20, null, NaN].forEach((v) => clean(K.devCell('乖離率', v), `乖離${v}`));
  assert.ok(K.meterLabelX(0, 0, 0) === 0 && Number.isFinite(K.meterLabelX(160, 50, 1)));
});

test('checklist: 10件の集計と未知の状態', () => {
  const items = sample.sections.checklist.map((c, i) => ({ ...c, name: `項目${i + 1}` }));
  const ck = K.checklist(items);
  assert.deepEqual(ck.count, { d: 5, p: 2, x: 3, u: 0 });
  assert.equal((ck.cells.match(/class="ck /g) || []).length, 10);
  const odd = K.checklist([{ id: 'C01', status: 'weird' }, null]);
  assert.equal(odd.count.u, 2);
  clean(odd.cells + odd.summary, 'チェックリスト');
});

test('esc: データ由来の文字は SVG/HTML に生で入らない', () => {
  const svg = K.priceChart({ rows: [bar('2026-10-01', 100), bar('2026-10-02', 101)], pins: [{ date: '2026-10-02', label: '<script>x</script>' }], W: 600, H: 380 });
  assert.ok(!svg.includes('<script>') && svg.includes('&lt;script&gt;'));
});

test('欠損フィクスチャ: スキーマ検証に通り、条件（segmentsなし・1〜2期・PERのみ・信用2件・利回りnull・桁違い）を満たす', () => {
  assert.equal(fixture.cases.length, 2);
  for (const c of fixture.cases) {
    assert.deepEqual(validateAnalysis(c.analysis), [], c.code);
    const s = c.analysis.sections;
    assert.ok(!('segments' in s));
    assert.ok(s.performance.length <= 2);
    assert.deepEqual(s.valuation.map((v) => v.key), ['PER']);
    assert.equal(s.margin.length, 2);
    assert.equal(c.profile.yield, null);
    assert.equal(c.prices.rows.at(-1).c, c.analysis.price.close);
  }
  assert.equal(fixture.cases[0].profile.name, '三菱ＵＦＪフィナンシャル・グループ');
  assert.deepEqual(fixture.cases.map((c) => c.analysis.price.close), [285.5, 38450]);
});

test('app: fetch を使わない・読み込み順・固定文言に売買の断定がない', () => {
  const dir = join(ROOT, 'app');
  const files = readdirSync(dir).filter((f) => /\.(js|html|css)$/.test(f) && f !== 'data.js');
  for (const f of files) {
    const t = readFileSync(join(dir, f), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(t), `${f} が fetch を使っている`);
    // test-hooks.js は禁止語の検出リストを持つ側（画面には出さない）
    if (f !== 'test-hooks.js') for (const w of BANNED_WORDS) assert.ok(!t.includes(w), `${f} に禁止語「${w}」`);
  }
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const order = ['styles.css', 'data.js', 'charts.js', 'app.js', 'test-hooks.js'].map((x) => html.indexOf(x));
  assert.ok(order.every((i) => i > 0) && order.every((v, i) => !i || v > order[i - 1]), `読み込み順: ${order}`);
  assert.match(html, /<link rel="icon" href="data:,">/);
  const ext = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.ok(ext.every((u) => /^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u)), `外部読み込み: ${ext}`);
});

/* ---------- 差し戻し（伊藤忠 8001 の通し運転）で追加 ---------- */
const realistic = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/realistic-quick.json'), 'utf8'));
const num = (s) => Number(s);
function pinBoxes(svg) {
  return [...svg.matchAll(/<path d="M([\d.-]+) ([\d.-]+) H([\d.-]+) V([\d.-]+) H([\d.-]+) V[\d.-]+ Z"[^>]*class="pinbox"/g)].map((m) => [num(m[5]), num(m[2]), num(m[3]), num(m[4])]);
}
function candleBoxes(svg) {
  const g = svg.slice(svg.indexOf('class="a-rv candles"'), svg.indexOf('</g>', svg.indexOf('class="a-rv candles"')));
  const out = [];
  for (const m of g.matchAll(/<line x1="([\d.-]+)" x2="[\d.-]+" y1="([\d.-]+)" y2="([\d.-]+)"/g)) out.push([num(m[1]) - 0.5, Math.min(num(m[2]), num(m[3])), num(m[1]) + 0.5, Math.max(num(m[2]), num(m[3]))]);
  for (const m of g.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)) out.push([num(m[1]), num(m[2]), num(m[1]) + num(m[3]), num(m[2]) + num(m[4])]);
  return out;
}
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

test('価格の表記: 小数部が0なら整数、そうでなければ小数1桁（全画面共通の fmtP）', () => {
  assert.equal(K.fmtP(2227), '2,227');
  assert.equal(K.fmtP(2227.0), '2,227');
  assert.equal(K.fmtP(2175.5), '2,175.5');
  assert.equal(K.fmtP(2226.66), '2,226.7');
  assert.equal(K.fmtP(5510), '5,510');
  assert.equal(K.fmtP(285.5), '285.5');
  assert.equal(K.fmtP(38450), '38,450');
  assert.equal(K.fmtP(2040.96), '2,041');
  assert.equal(K.fmtP(NaN), '—');
  // 株価チャート・シナリオ図に「.0」の価格が出ない
  const rows = realistic.cases[0].prices.rows.slice(-122), a = realistic.cases[0].analysis, c = a.sections.chart;
  const svg = K.priceChart({ rows, res: c.resistance, sup: c.support, pins: c.pins, W: 700, H: 460 });
  assert.match(svg, /RES 2,227</);
  assert.match(svg, /2,175\.5</);
  assert.ok(!/\d,\d{3}\.0</.test(svg), '株価チャートに .0 の価格');
  const T = (k) => a.sections.scenarios.find((s) => s.kind === k).target;
  const fanSvg = K.fan({ hist: rows.slice(-20).map((r) => r.c), now: 2175.5, bull: T('bull'), base: T('base'), bear: T('bear'), W: 200, H: 200 });
  assert.ok(!/\d,\d{3}\.0</.test(fanSvg), 'シナリオ図に .0 の価格');
  assert.match(fanSvg, />2,175\.5</);
});

test('実データ型フィクスチャ: スキーマ合格で、差し戻しの条件をすべて含む', () => {
  const { analysis: a, prices } = realistic.cases[0];
  assert.deepEqual(validateAnalysis(a), []);
  const s = a.sections;
  assert.ok(s.margin.some((m) => m.buy >= 10000), '5桁の信用残');
  assert.ok(prices.rows.some((r) => !Number.isInteger(r.c)) && prices.rows.every((r) => Number.isInteger(r.c * 2)), '0.5円刻み');
  assert.equal(s.segments.length, 7);
  assert.ok(s.segments.every((x) => x.margin === null), '利益率 null');
  assert.equal(s.chart.pins.length, 5);
  assert.equal(s.chart.resistance.length, 2);
  assert.equal(s.chart.support.length, 2);
  assert.equal(s.performance.find((p) => p.forecast).sales, null);
  const len = (x) => [...x].length;
  assert.ok(s.scenarios.every((x) => len(x.text) === 80), 'シナリオ文80字');
  assert.ok(s.checklist.every((x) => len(x.reason) === 80), 'チェックリスト80字');
  assert.ok(s.diagnosis.every((x) => len(x.reason) === 80), '診断80字');
});

test('チャートのピン: 5個でも札どうし・ローソク足・右端のタグ領域に重ならない（幅を変えても）', () => {
  const a8001 = JSON.parse(readFileSync(join(ROOT, 'data/stocks/8001/analyses/2026-10-02-quick.json'), 'utf8'));
  const p8001 = JSON.parse(readFileSync(join(ROOT, 'data/stocks/8001/prices.json'), 'utf8')).rows.filter((r) => r.d > '2026-04-02' && r.d <= '2026-10-02');
  for (const tc of [realistic.cases[0], { prices: { rows: prices6501.filter((r) => r.d > '2026-04-01' && r.d <= '2026-10-01') }, analysis: sample }, { prices: { rows: p8001 }, analysis: a8001 }]) {
    const rows = tc.prices.rows.slice(-122), c = tc.analysis.sections.chart;
    for (const [W, H] of [[520, 400], [560, 420], [640, 440], [700, 460], [800, 520], [940, 600]]) {
      const svg = K.priceChart({ rows, res: c.resistance, sup: c.support, pins: c.pins, W, H });
      const pins = pinBoxes(svg), cdl = candleBoxes(svg);
      assert.equal(pins.length, c.pins.length, `${W}: ピンの数`);
      const ax = W - Math.max(84, 0);
      pins.forEach((p, i) => {
        assert.ok(!cdl.some((q) => hit(p, q)), `${W}: ピン${i + 1}がローソク足に重なる`);
        pins.forEach((q, j) => { if (j > i) assert.ok(!hit(p, q), `${W}: ピン${i + 1}と${j + 1}が重なる`); });
        assert.ok(p[2] <= ax - 4 + 0.5, `${W}: ピン${i + 1}がタグ領域に入る`);
      });
    }
  }
});

test('需給: 5桁の買い残でも売り残の棒が最低3pxで見え、NaN を出さない', () => {
  const m = realistic.cases[0].analysis.sections.margin;
  for (const [W, H] of [[260, 110], [330, 190]]) {
    const svg = K.supply3d(m, W, H);
    clean(svg, '需給 5桁');
    const fronts = [...svg.matchAll(/<rect x="[\d.-]+" y="[\d.-]+" width="[\d.-]+" height="([\d.-]+)" fill="(url\(#kl-sh\)|rgba\(62,230,255,\.[58]\))"/g)].map((x) => num(x[1]));
    assert.equal(fronts.length, 10);
    assert.ok(fronts.every((h) => h >= 3), `棒の高さ ${fronts}`);
    assert.equal((svg.match(/rlab/g) || []).length, 5);
  }
});

/* ---------- P1d：稼ぎ頭の展開・チェックリストの理由 ---------- */
const seg = (name, profit, margin = null, note = '') => ({ name, profit, margin, note });
test('segModel: 0/1/3/4/5/8件・利益率すべて null・負の利益', () => {
  const m0 = K.segModel([]);
  assert.equal(m0.count, 0); assert.equal(m0.expandable, false); assert.deepEqual(m0.collapsed, []); assert.equal(m0.total, 0);
  const m1 = K.segModel([seg('A', 100, 10)]);
  assert.equal(m1.collapsed.length, 1); assert.equal(m1.expandable, false); assert.equal(m1.all[0].barW, 100);
  const m3 = K.segModel([seg('A', 1), seg('B', 3), seg('C', 2)]);
  assert.deepEqual(m3.collapsed.map((x) => x.name), ['B', 'C', 'A']); assert.ok(!m3.collapsed.some((x) => x.other));
  const m4 = K.segModel([seg('A', 4), seg('B', 3), seg('C', 2), seg('D', 1)]);
  assert.equal(m4.collapsed.length, 4); assert.equal(m4.expandable, false); assert.ok(!m4.collapsed.some((x) => x.other));
  const m5 = K.segModel([seg('A', 5), seg('B', 4), seg('C', 3), seg('D', 2), seg('E', 1)]);
  assert.equal(m5.expandable, true);
  assert.deepEqual(m5.collapsed.map((x) => x.name), ['A', 'B', 'C', 'その他 2事業']);
  assert.equal(m5.collapsed[3].profit, 3);
  const eight = Array.from({ length: 8 }, (_, i) => seg(`S${i + 1}`, (i + 1) * 100, i % 2 ? null : 5 + i, i === 2 ? '前年比 +12億円' : i === 3 ? '前年比 −7億円' : ''));
  const m8 = K.segModel(eight);
  assert.equal(m8.all.length, 8);
  assert.deepEqual(m8.all.map((x) => x.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(m8.all[0].name, 'S8'); assert.equal(m8.all[0].barW, 100);
  assert.equal(m8.collapsed[3].name, 'その他 5事業'); assert.equal(m8.collapsed[3].profit, 100 + 200 + 300 + 400 + 500);
  assert.equal(m8.total, 3600); assert.equal(m8.hasMargin, true);
  assert.equal(new Set(m8.all.map((x) => x.color)).size, 8, '8色すべて別');
  assert.deepEqual(m8.all.filter((x) => x.sign).map((x) => [x.name, x.sign]), [['S4', 'dn'], ['S3', 'up']]);
  // 利益率すべて null（商社型）
  const r = realistic.cases[0].analysis.sections.segments;
  const mr = K.segModel(r);
  assert.equal(mr.hasMargin, false); assert.equal(mr.count, 7);
  assert.equal(mr.collapsed[3].profit, 921 + 693 + 450 + 433);
  assert.ok(!/class="mg"/.test(K.segListHtml(mr)), '利益率が無いのに利益率の列');
  // 負の利益を含む
  const mn = K.segModel([seg('A', 500, 12), seg('B', -120, -3.1, '前年比 −80億円'), seg('C', 300), seg('D', 50), seg('E', 10)]);
  assert.equal(mn.all.at(-1).name, 'B'); assert.equal(mn.all.at(-1).barW, 0); assert.equal(mn.all.at(-1).share, null);
  assert.equal(mn.total, 740); assert.equal(mn.collapsed[3].profit, 10 - 120); // 上位3＝A・C・D、その他＝E＋B
  for (const m of [m0, m1, m3, m4, m5, m8, mr, mn]) clean(K.segListHtml(m) + JSON.stringify(m.collapsed), '稼ぎ頭');
  const html = K.segListHtml(mn);
  assert.equal((html.match(/class="sp-r"/g) || []).length, 5);
  assert.match(html, /class="pf dn">−120/);
  assert.match(html, /class="nt dn">前年比 −80億円/);
});

test('チェックリストの理由: 既定は進行中すべて、0件なら完成済みを後ろから2件、選択時はその1件', () => {
  const items = sample.sections.checklist.map((c, i) => ({ ...c, name: `項目${i + 1}` }));
  const ids = (h) => [...h.matchAll(/data-why="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids(K.ckReasons(items, null)), ['C01', 'C06']);
  assert.deepEqual(ids(K.ckReasons(items.map((x) => ({ ...x, status: x.status === 'progress' ? 'none' : x.status })), null)), ['C10', 'C09']);
  assert.deepEqual(ids(K.ckReasons(items, 'C08')), ['C08']);
  assert.match(K.ckReasons(items, 'C08'), new RegExp(items[7].reason));
  assert.match(K.ckReasons([], null), /表示できる理由がありません/);
  const ck = K.checklist(items);
  assert.equal((ck.cells.match(/<button type="button" class="ck /g) || []).length, 10);
  assert.equal((ck.cells.match(/aria-pressed="false"/g) || []).length, 10);
});
