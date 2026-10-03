// P2b：チャート型・決算型の描画部品（app/charts.js）の機械テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../app/charts.js';

const K = globalThis.KABU_CHARTS;
const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, '..', 'data');
const BAD = /NaN|undefined|Infinity/;
const clean = (s, what) => assert.ok(!BAD.test(s), `${what} に NaN/undefined/Infinity: …${String(s).slice(Math.max(0, String(s).search(BAD) - 60), String(s).search(BAD) + 20)}…`);
const fx = (n) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${n}.json`), 'utf8'));
const prices = JSON.parse(readFileSync(join(DATA, 'stocks/6501/prices.json'), 'utf8')).rows;
const bar = (d, c, v = 1000) => ({ d, o: c, h: c, l: c, c, v });
const svgSize = (s) => { const m = /width="([\d.]+)" height="([\d.]+)"/.exec(s); return m ? [+m[1], +m[2]] : null; };
const nums = (s, re) => [...s.matchAll(re)].map((m) => +m[1]);

test('P2 charts: 新しい部品が globalThis.KABU_CHARTS に出ている', () => {
  for (const k of ['miniCandles', 'vpLayout', 'levelChart', 'heatGauge', 'plansChart', 'planLanes', 'prevFromYoy', 'pairBars3d', 'ringGeom', 'ring', 'bulletModel', 'bullet', 'returns3d', 'marginLine', 'changeOf', 'yoyBar', 'cmpPair', 'paceBar']) assert.equal(typeof K[k], 'function', k);
});

test('miniCandles（週足・月足・日足の小チャート）: 実データ・空・1本・全同値・欠損で NaN を出さず、高値と安値の札は枠内', () => {
  const weekly = [];
  for (let i = 0; i < prices.length; i += 5) { const w = prices.slice(i, i + 5); weekly.push({ d: w[0].d, o: w[0].o, h: Math.max(...w.map((r) => r.h)), l: Math.min(...w.map((r) => r.l)), c: w[w.length - 1].c, v: 1 }); }
  const monthly = weekly.filter((_, i) => i % 4 === 0);
  const cases = [weekly.slice(-52), monthly, prices.slice(-60), [], [bar('2026-10-01', 100)], [bar('2026-09-01', 50), bar('2026-10-01', 50)], [null, { d: 'x', o: NaN, h: 1, l: 1, c: 1 }, bar('2026-10-01', 7)]];
  for (const bars of cases) {
    const s = K.miniCandles({ bars, ma: bars.map(() => null), W: 380, H: 130 });
    clean(s, 'miniCandles');
    assert.deepEqual(svgSize(s), [380, 130]);
    for (const x of nums(s, /<text x="([\d.-]+)"/g)) assert.ok(x >= 0 && x <= 380, `文字の x=${x} が枠外`);
  }
  const s = K.miniCandles({ bars: weekly.slice(-52), W: 380, H: 130 });
  assert.match(s, /高 /); assert.match(s, /安 /);
  assert.equal((s.match(/<g class="cdl">/g) || []).length, 1);
  assert.equal(K.miniCandles({ bars: [], W: 30, H: 30 }), '', '小さすぎる枠では描かない');
  assert.match(K.miniCandles({ bars: [], W: 300, H: 120, empty: '週足のデータがありません' }), /週足のデータがありません/);
});

test('vpLayout（価格帯別出来高）: 帯の上下はチャートと同じ価格軸の式、範囲外は除き、はみ出す帯は切る', () => {
  const bins = [{ from: 4000, to: 4500, volume: 10, share: 10 }, { from: 4500, to: 5000, volume: 40, share: 40 }, { from: 5000, to: 5500, volume: 30, share: 30 }, { from: 5500, to: 6000, volume: 20, share: 20 }, { from: 9000, to: 9500, volume: 99, share: 99 }];
  const P0 = 4600, P1 = 5800, top = 28, h = 400;
  const Y = (p) => top + (P1 - p) / (P1 - P0) * h;
  const out = K.vpLayout(bins, P0, P1, top, h);
  assert.equal(out.length, 3, '4000-4500 と 9000- は範囲外');
  for (const b of out) {
    assert.ok(Math.abs(b.y0 - Y(Math.min(b.to, P1))) < 1e-9 && Math.abs(b.y1 - Y(Math.max(b.from, P0))) < 1e-9, `${b.from}-${b.to} の位置`);
    assert.ok(b.y0 >= top - 1e-9 && b.y1 <= top + h + 1e-9);
  }
  assert.equal(out.find((b) => b.max).from, 4500, '最多の帯（範囲内で最大）');
  assert.equal(out.find((b) => b.from === 4500).w, 1);
  assert.deepEqual(K.vpLayout([], P0, P1, top, h), []);
  assert.deepEqual(K.vpLayout([{ from: 1, to: 2, volume: NaN }], 0, 3, 0, 10), []);
  const z = K.vpLayout([{ from: 1, to: 2, volume: 0 }], 0, 3, 0, 10);
  assert.equal(z[0].w, 0, '出来高0でも NaN にしない');
});

test('levelChart（メインチャート）: 各レベルは data-lv の組、帯と線、範囲外は▲▼の札、価格帯別出来高はチャートの価格軸と一致', () => {
  const rows = prices.slice(-122);
  const ma = { ma25: rows.map((r) => r.c), ma75: rows.map(() => null), ma200: rows.map((r) => r.c * 0.95) };
  const levels = [{ kind: 'resistance', low: 5830, high: 5830, strength: 4 }, { kind: 'support', low: 5040, high: 5166, strength: 5 }, { kind: 'resistance', low: 9000, high: 9100, strength: 1 }, { kind: 'support', low: 'x', high: 1, strength: 2 }];
  const vp = { step: 100, bins: Array.from({ length: 30 }, (_, i) => ({ from: 3800 + i * 100, to: 3900 + i * 100, volume: (i % 7) * 1e6, share: 1 })) };
  const s = K.levelChart({ rows, ma, levels, vp, W: 820, H: 520 });
  clean(s, 'levelChart');
  assert.deepEqual(svgSize(s), [820, 520]);
  assert.match(s, /class="lvchart"/);
  for (const i of [0, 1, 2]) assert.match(s, new RegExp(`class="lvg [rs]" data-lv="${i}"`), `level ${i}`);
  assert.doesNotMatch(s, /data-lv="3"/, '数値でないレベルは描かない');
  assert.match(s, /RES 9,000–9,100 ▲/, '範囲外の上は▲の札');
  assert.match(s, /class="lvband"/, '帯');
  assert.match(s, /SUP 5,040–5,166/);
  assert.ok((s.match(/class="vpbar"/g) || []).length > 5, '価格帯別出来高の棒');
  // 価格帯別出来高の棒の y は、同じ SVG のレベル線の y と同じ価格軸：5,830 の線は 5800-5900 の棒の中にある
  const lineY = +/data-lv="0"><line x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)"/.exec(s)[1];
  const m = /<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"[^>]*data-from="5800" data-to="5900"/.exec(s);
  assert.ok(m, '5800-5900 の帯');
  assert.ok(lineY >= +m[1] - 1 && lineY <= +m[1] + +m[2] + 1, `5,830 の線 y=${lineY} が 5800-5900 の帯 ${m[1]}+${m[2]} に入る`);
  for (const c of [[], [bar('2026-10-01', 100)], [bar('2026-09-30', 100), bar('2026-10-01', 100)]]) {
    const t = K.levelChart({ rows: c, ma: {}, levels: [{ kind: 'support', low: 100, high: 100, strength: 3 }], vp: null, W: 600, H: 400 });
    clean(t, 'levelChart 空・単一・全同値');
  }
  assert.equal(K.levelChart({ rows, W: 100, H: 100 }), '');
});

test('heatGauge（過熱の物差し）: 閾値の帯・目盛り・値の位置、範囲外は超過表示、null は印なし', () => {
  const g = K.heatGauge('rsi', 70, 'hot');
  clean(g, 'heat');
  assert.match(g, /class="hm hot" style="left:70%"/);
  assert.match(g, /class="hz" style="left:0%;width:30%"/);
  assert.match(g, /class="hz" style="left:70%;width:30%"/);
  assert.equal(K.heatPos('ma25dev', 10).pos, 75);
  assert.equal(K.heatPos('ma25dev', -25).over, -1);
  assert.equal(K.heatPos('volume', 9).over, 1);
  assert.equal(K.heatPos('volume', 9).pos, 100);
  assert.match(K.heatGauge('change3d', -15.2, 'warm'), /hb a-gx warm" style="left:12%;width:38%"/, '0 から左へ伸びる');
  assert.match(K.heatGauge('volume', 9, 'hot'), /上限を超過/);
  const n = K.heatGauge('volume', null);
  assert.doesNotMatch(n, /class="hm/); assert.match(n, /hgt nil/);
  assert.equal(K.heatGauge('unknown', 1), '');
  assert.equal(K.heatValue('ma25dev', 2.35), '+2.35');
  assert.equal(K.heatValue('rsi', null), '—');
});

test('plansChart（3レーン）: レーンの横位置は CSS の grid と同じ式、zone/stop/target/現在値が枠内、価格なしのレーンは「価格の指定なし」', () => {
  const lanes = K.planLanes(1000, 76, 10);
  const lw = (1000 - 76 - 30) / 3;
  assert.deepEqual(lanes.map((l) => Math.round(l.x * 100) / 100), [86, 86 + lw + 10, 86 + 2 * (lw + 10)].map((x) => Math.round(x * 100) / 100));
  assert.ok(Math.abs(lanes[2].x + lanes[2].w - 1000) < 1e-9, '右端は枠の右端');
  const plans = fx('chart-sample').sections.plans;
  const s = K.plansChart({ plans, close: 5522, W: 1300, H: 250, axisW: 76, gap: 10 });
  clean(s, 'plansChart');
  for (const [cls, i] of [['pl-zone', 0], ['pl-stop', 0], ['pl-tgt', 0], ['pl-zone', 1], ['pl-stop', 1], ['pl-tgt', 1]]) assert.match(s, new RegExp(`class="${cls}" data-p="${i}"`), `${cls} ${i}`);
  assert.doesNotMatch(s, /data-p="2"[^>]*class="pl-(zone|stop|tgt)"|class="pl-(zone|stop|tgt)" data-p="2"/, '見送りは価格なし');
  assert.match(s, /価格の指定なし/);
  assert.match(s, /class="pl-now"/);
  for (const y of nums(s, /<text x="[\d.-]+" y="([\d.-]+)"/g)) assert.ok(y >= 0 && y <= 250, `文字 y=${y}`);
  for (const x of nums(s, /<text x="([\d.-]+)"/g)) assert.ok(x >= 0 && x <= 1300, `文字 x=${x}`);
  // すべて null・現在値だけ・何もなし
  clean(K.plansChart({ plans: fx('chart-sparse').sections.plans, close: 5522, W: 900, H: 250 }), 'plans 全null');
  assert.match(K.plansChart({ plans: [], close: null, W: 900, H: 250 }), /価格の指定がありません/);
  clean(K.plansChart({ plans: [{ zone: { low: 100, high: null }, stop: { price: 100 }, target: { price: 100 } }], close: 100, W: 900, H: 250 }), 'plans 全同値');
});

test('prevFromYoy（前年値の逆算）: value ÷ (1+yoy/100)。yoy null・−100%以下・値 null は null', () => {
  assert.equal(Math.round(K.prevFromYoy(27096, 20)), 22580);
  assert.equal(Math.round(K.prevFromYoy(1894, -1.4)), 1921);
  assert.equal(K.prevFromYoy(0, 10), 0);
  assert.equal(K.prevFromYoy(100, null), null);
  assert.equal(K.prevFromYoy(null, 5), null);
  assert.equal(K.prevFromYoy(100, -100), null);
  assert.equal(K.prevFromYoy(100, -150), null);
  assert.equal(K.prevFromYoy(NaN, 5), null);
});

test('pairBars3d（今期と前年の立体棒）: 前年は≈つき、yoy null は今期だけ、負の値・0・null で NaN なし', () => {
  const s = K.pairBars3d({ curr: 27096, prev: K.prevFromYoy(27096, 20), W: 170, H: 150 });
  clean(s, 'pair');
  assert.match(s, /≈22,580/); assert.match(s, /27,096/); assert.match(s, /前年（逆算）/);
  const one = K.pairBars3d({ curr: 201.14, prev: null, W: 170, H: 150 });
  assert.doesNotMatch(one, /≈/); assert.match(one, /201\.14/);
  for (const [c, p] of [[-500, 300], [-500, -800], [0, 0], [0, null], [5, 5]]) clean(K.pairBars3d({ curr: c, prev: p, W: 170, H: 150 }), `pair ${c},${p}`);
  assert.doesNotMatch(K.pairBars3d({ curr: null, prev: 1, W: 170, H: 150 }), /<text/);
});

test('ring（進捗リング）: pct と均等ペースの角度、100%超は内側の輪、null は弧なし', () => {
  const g = K.ringGeom(21, 25);
  assert.equal(g.mainDeg, 21 * 3.6); assert.equal(g.paceDeg, 90); assert.equal(g.overDeg, 0);
  const g2 = K.ringGeom(200, 100);
  assert.equal(g2.mainDeg, 360); assert.equal(g2.overDeg, 360); assert.equal(g2.paceDeg, 360);
  assert.equal(K.ringGeom(250, 120).pct, 200, '200 で頭打ち');
  assert.equal(K.ringGeom(null, 25).pct, null);
  const s = K.ring(21, 25);
  clean(s, 'ring');
  const cx = 90, cy = 90;
  const t = /class="pr-pace"/.test(s) && /<line x1="[\d.]+" y1="[\d.]+" x2="([\d.]+)" y2="([\d.]+)"[^>]*class="pr-pace"/.exec(s);
  const ang = (x, y) => (Math.atan2(x - cx, -(y - cy)) * 180 / Math.PI + 360) % 360;
  assert.ok(Math.abs(ang(+t[1], +t[2]) - 90) < 1, '均等ペース 25% は真右');
  const e = /<circle cx="([\d.]+)" cy="([\d.]+)"[^>]*class="pr-end"/.exec(s);
  assert.ok(Math.abs(ang(+e[1], +e[2]) - 75.6) < 1, '21% の弧の終わり');
  assert.match(s, /data-pct="21"/); assert.match(s, /data-pace="25"/);
  const full = K.ring(200, 100);
  clean(full, 'ring 200');
  assert.match(full, /class="pr-over arc"/);
  assert.equal((full.match(/ A[\d.]+ [\d.]+ 0 1 1 /g) || []).length >= 4, true, '1周の弧は半円2つで描く（始点と終点が同じ弧は描かれないため）');
  const none = K.ring(null, 25);
  assert.doesNotMatch(none, /pr-arc|pr-end/); clean(none, 'ring null');
  clean(K.ring(0, 0), 'ring 0');
});

test('bulletModel（中計の目標の範囲 vs 実績 vs 今期予想）: 日立の実データ4本・軸は0起点にしない・未達／範囲内／超過の判定', () => {
  const real = JSON.parse(readFileSync(join(DATA, 'stocks/6501/analyses/2026-10-02-kessan.json'), 'utf8')).sections.deep.plan.targets;
  const want = [['in', 'above'], ['below', 'in'], ['in', 'in'], ['below', 'below']];
  real.forEach((t, i) => {
    const m = K.bulletModel(t);
    assert.ok(m, t.label);
    assert.deepEqual([m.sActual.k, m.sForecast.k], want[i], t.label);
    const vals = [m.lo, m.hi, m.actual, m.forecast];
    assert.ok(m.axisLo < Math.min(...vals) && m.axisHi > Math.max(...vals), `${t.label}: 軸に余白`);
    assert.ok(m.axisLo > 0, `${t.label}: 0 起点にしない（${m.axisLo}）`);
    for (const v of vals) assert.ok(m.pos(v) > 0 && m.pos(v) < 100);
    const h = K.bullet(t);
    clean(h, t.label);
    assert.match(h, /class="rb-a /); assert.match(h, /class="rb-f /);
    assert.match(h, t.nums.targetLow === t.nums.targetHigh ? /class="rb-tl"/ : /class="rb-band"/);
  });
  assert.equal(K.bulletModel(real[0]).sForecast.text, '目標を2pt上回る');
  assert.equal(K.bulletModel(real[1]).sActual.text, '目標まであと0.6pt');
  assert.equal(K.bulletModel(real[3]).sActual.text, '目標まであと12pt');
  assert.equal(K.bulletModel(real[2]).sForecast.text, '目標範囲内', '帯の端ちょうどは範囲内');
  assert.match(K.bullet(real[0]), /4%<\/span>/, '軸の目盛りに単位');
});

test('bulletModel: 一部 null・帯の片側だけ・低=高・範囲外の負値・全部 null・nums なし（従来の数値／文字）', () => {
  const part = K.bulletModel({ unit: '%', nums: { targetLow: null, targetHigh: 15, actual: null, forecast: 13 } });
  assert.equal(part.lo, 15); assert.equal(part.hi, 15); assert.equal(part.sActual, null); assert.equal(part.sForecast.text, '目標まであと2pt');
  const h = K.bullet({ unit: '%', nums: { targetLow: null, targetHigh: 15, actual: null, forecast: 13 } });
  assert.doesNotMatch(h, /rb-a/); assert.match(h, /rb-f/); assert.match(h, /rb-tl/); clean(h, 'part');
  const onlyA = K.bulletModel({ nums: { actual: 3 } });
  assert.equal(onlyA.lo, null); assert.equal(onlyA.sActual, null); clean(K.bullet({ nums: { actual: 3 } }), 'onlyA');
  const neg = K.bulletModel({ unit: '億円', nums: { targetLow: -5, targetHigh: 5, actual: -120, forecast: 80 } });
  assert.equal(neg.sActual.text, '目標まであと115億円'); assert.equal(neg.sForecast.text, '目標を75億円上回る');
  assert.ok(neg.axisLo < -120 && neg.axisHi > 80);
  const rev = K.bulletModel({ nums: { targetLow: 9, targetHigh: 7, actual: 8 } });
  assert.deepEqual([rev.lo, rev.hi, rev.sActual.k], [7, 9, 'in'], '下限と上限が逆でも直す');
  const same = K.bulletModel({ nums: { targetLow: 5, targetHigh: 5, actual: 5, forecast: 5 } });
  assert.ok(same.axisHi > same.axisLo); assert.equal(same.sActual.text, '目標どおり'); clean(K.bullet({ nums: { targetLow: 5, targetHigh: 5, actual: 5, forecast: 5 } }), 'same');
  const zero = K.bulletModel({ nums: { targetLow: 0, targetHigh: 0, actual: 0 } });
  assert.ok(zero.axisHi > zero.axisLo);
  assert.equal(K.bulletModel({ nums: { targetLow: null, targetHigh: null, actual: null, forecast: null } }), null);
  assert.match(K.bullet({ target: '7〜9%', actual: '+8%', forecast: '+11%', nums: { targetLow: null, targetHigh: null, actual: null, forecast: null } }), /数値の比較なし/);
  assert.match(K.bullet({ target: '業界トップ', actual: null, forecast: null }), /数値の比較なし/);
  const legacy = K.bulletModel({ target: 12, actual: 10.6, forecast: 11.7 });
  assert.deepEqual([legacy.lo, legacy.hi, legacy.sActual.k, legacy.sForecast.k], [12, 12, 'below', 'below'], 'nums が無ければ従来の数値');
  assert.equal(K.bulletModel(null), null);
  const ext = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/kessan-extreme.json'), 'utf8')).sections.deep.plan.targets;
  ext.forEach((t) => clean(K.bullet(t), t.label));
});

test('returns3d（配当とEPS）: 文字の配当は棒を描かない、予想は斜線、空・null だけでも NaN なし', () => {
  const r = fx('kessan-sample').sections.returns;
  assert.deepEqual(K.returnsPeriods(r.dividends, r.eps), ['2025.3', '2026.3', '2027.3']);
  const s = K.returns3d({ divs: r.dividends, eps: r.eps, W: 600, H: 210 });
  clean(s, 'returns');
  assert.equal((s.match(/class="a-grow rb"/g) || []).length, 2, '数値の配当2期だけ棒');
  assert.match(s, /表を参照/); assert.match(s, /201\.14/); assert.match(s, /2027\.3予/);
  const x = fx('kessan-extreme').sections.returns;
  const e = K.returns3d({ divs: x.dividends, eps: x.eps, W: 600, H: 96 });
  clean(e, 'returns extreme'); assert.match(e, /数値の配当・EPSはありません/);
  clean(K.returns3d({ divs: [], eps: [], W: 600, H: 210 }), 'returns 空');
  clean(K.returns3d({ divs: [{ period: '2026.3', value: 50, forecast: false }], eps: [{ period: '2026.3', value: -30, forecast: false }], W: 600, H: 210 }), 'returns 単一・負');
});

test('marginLine・changeOf・yoyBar・cmpPair・paceBar: 境界値で NaN なし', () => {
  clean(K.marginLine({ rows: [{ period: '25.04-06', v: 9.3 }, { period: '25.07-09', v: 9.3 }], W: 380, H: 116 }), 'marginLine 全同値');
  clean(K.marginLine({ rows: [{ period: 'a', v: -2 }, { period: 'b', v: 3 }], W: 380, H: 116 }), 'marginLine 負');
  assert.doesNotMatch(K.marginLine({ rows: [{ period: 'a', v: 1 }], W: 380, H: 116 }), /<path/);
  assert.deepEqual(K.changeOf(43.7, 43.7, '%'), { dir: 'flat', text: '0.0pt' });
  assert.deepEqual(K.changeOf(13234, 15044, '億円'), { dir: 'up', text: '+13.7%' });
  assert.equal(K.changeOf(null, 1, '億円'), null);
  assert.equal(K.changeOf(0, 5, '億円').dir, 'up');
  assert.equal(K.changeOf(-100, -50, '億円').text, '+50.0%', '赤字の縮小は改善');
  for (const v of [null, 0, -150, 999]) clean(K.yoyBar(v, 10), `yoyBar ${v}`);
  for (const [p, c] of [[null, null], [0, 0], [-5, 5], [10, null]]) clean(K.cmpPair(p, c), `cmpPair ${p},${c}`);
  for (const [p, q] of [[null, null], [200, 100], [21, 25]]) clean(K.paceBar(p, q), `paceBar ${p},${q}`);
});

test('marginLine: 期間の文字どうしが重ならない（8四半期・幅を変えても）', () => {
  const rows = ['24.07-09', '24.10-12', '25.01-03', '25.04-06', '25.07-09', '25.10-12', '26.01-03', '26.04-06'].map((p, i) => ({ period: p, v: 9 + (i % 3) }));
  for (const W of [300, 380, 480, 620]) {
    const s = K.marginLine({ rows, W, H: 116 });
    const labs = [...s.matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="st-t" text-anchor="middle" style="fill:[^"]+">(\d\d\.\d\d-\d\d)</g)].map((m) => [+m[1], m[3]]);
    assert.ok(labs.some((l) => l[1] === '26.04-06'), '最新の期は必ず出す');
    labs.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < labs.length; i++) assert.ok(labs[i][0] - labs[i - 1][0] >= K.textW('24.07-09', 12, true) + 4, `W=${W}: ${labs[i - 1][1]} と ${labs[i][1]} が近すぎる`);
  }
});
