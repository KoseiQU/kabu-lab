// P3c：シナリオの答え合わせの図・用語の流れ図とシーソー図（app/charts.js）の機械テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import '../app/charts.js';
import { buildReview, buildData, buildViewerHtml, dataJsText } from '../build.mjs';

const K = globalThis.KABU_CHARTS;
const ROOT = new URL('..', import.meta.url).pathname;
const BAD = /NaN|undefined|Infinity/;
const clean = (s, what) => assert.ok(!BAD.test(s), `${what} に NaN/undefined/Infinity: …${String(s).slice(Math.max(0, String(s).search(BAD) - 60), String(s).search(BAD) + 20)}…`);
const fx = (n) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${n}.json`), 'utf8'));
const days = (n, start, f) => { const out = []; const t = new Date(start + 'T00:00:00Z'); while (out.length < n) { t.setUTCDate(t.getUTCDate() + 1); if (t.getUTCDay() % 6) out.push({ d: t.toISOString().slice(0, 10), c: f(out.length) }); } return out; };
const rv = (o) => ({ base: { price: 1000, date: '2026-09-01' }, targets: [], after: days(10, '2026-09-01', (i) => 1000 + i * 5), ...o });
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

test('P3c charts: 部品が globalThis.KABU_CHARTS に出ている', () => {
  for (const k of ['reviewModel', 'reviewChart', 'flowHtml', 'seesawHtml']) assert.equal(typeof K[k], 'function', k);
  assert.deepEqual(Object.keys(K.RV_KIND), ['bull', 'base', 'bear']);
});

test('reviewModel: 基準線・折れ線の始点と終点・縦軸の向き（値→座標）', () => {
  const r = rv({ targets: [{ kind: 'bull', price: 1100 }, { kind: 'base', low: 1010, high: 1060 }, { kind: 'bear', price: 950 }] });
  const m = K.reviewModel(r, 600, 240);
  assert.ok(m, 'モデルができる');
  assert.equal(m.line.length, 11, '基準＋10営業日');
  assert.deepEqual(m.line[0], [m.X(0), m.Y(1000)], '始点＝分析日・基準価格');
  assert.ok(near(m.base.y, m.Y(1000)));
  assert.ok(near(m.last.x, m.X(10)) && near(m.last.y, m.Y(1045)), '終点＝直近の終値');
  assert.ok(m.Y(1100) < m.Y(1000) && m.Y(950) > m.Y(1000), '高い値ほど上');
  assert.ok(m.P0 <= 950 && m.P1 >= 1100, '近い目安は軸に含める');
  for (const [x, y] of m.line) assert.ok(x >= m.x0 && x <= m.x1 && y >= m.top && y <= m.bot, `折れ線が枠内 ${x},${y}`);
  assert.ok(m.last.x <= m.x0 + (m.x1 - m.x0) * 0.9 + 1e-6, '右に余白を残す');
  const t = Object.fromEntries(m.targets.map((x) => [x.kind, x]));
  assert.equal(t.bull.type, 'line'); assert.ok(near(t.bull.y, m.Y(1100)) && t.bull.out === null);
  assert.equal(t.base.type, 'band'); assert.ok(near(t.base.y0, m.Y(1060)) && near(t.base.y1, m.Y(1010)), '帯の上端＝high・下端＝low');
  assert.ok(near(t.bear.y, m.Y(950)));
});

test('reviewModel: 現在値から極端に遠い目安は軸に入れず、端に寄せて out を付ける（値動きが潰れない）', () => {
  const r = rv({ targets: [{ kind: 'bull', price: 9000 }, { kind: 'base', low: 1020, high: 8000 }, { kind: 'bear', price: 12 }] });
  const m = K.reviewModel(r, 600, 240);
  const t = Object.fromEntries(m.targets.map((x) => [x.kind, x]));
  assert.equal(t.bull.out, 'up'); assert.equal(t.bull.y, m.top, '上端に寄せる');
  assert.equal(t.bear.out, 'down'); assert.equal(t.bear.y, m.bot, '下端に寄せる');
  assert.equal(t.base.out, null, '一部が範囲内の帯は切り取って描く');
  assert.ok(t.base.clipTop && !t.base.clipBot && near(t.base.y0, m.top), '帯の上側は枠の上端で切る');
  // 実際の値動き（1000〜1045）が縦の高さの3割以上を使う
  assert.ok((m.Y(1000) - m.Y(1045)) / (m.bot - m.top) > 0.3, `値動きが潰れていない ${((m.Y(1000) - m.Y(1045)) / (m.bot - m.top)).toFixed(2)}`);
  const lb = Object.fromEntries(m.labels.map((l) => [l.key, l]));
  assert.match(lb.bull.text, /▲9,000/); assert.match(lb.bear.text, /▼12/);
  // 帯全体が範囲外
  const m2 = K.reviewModel(rv({ targets: [{ kind: 'base', low: 5000, high: 6000 }] }), 600, 240);
  assert.equal(m2.targets[0].out, 'up');
  // reach を広げると軸に含める
  const m3 = K.reviewModel(rv({ targets: [{ kind: 'bull', price: 1200 }] }), 600, 240, { reach: 10 });
  assert.equal(m3.targets[0].out, null);
});

test('reviewModel: after が無い・基準が無い・小さすぎる枠は null。日数が少ないときは minSlots の幅', () => {
  assert.equal(K.reviewModel(rv({ after: [] }), 600, 240), null);
  assert.equal(K.reviewModel(rv({ base: { price: null } }), 600, 240), null);
  assert.equal(K.reviewModel(rv({}), 100, 240), null);
  assert.equal(K.reviewChart(rv({ after: [] }), 600, 240), '');
  const one = K.reviewModel(rv({ after: [{ d: '2026-09-02', c: 1003 }] }), 600, 240);
  assert.equal(one.slots, 5);
  assert.ok(one.last.x < one.x0 + (one.x1 - one.x0) * 0.25, '1営業日目は左寄り（まだ日が浅いことが見える）');
  const flat = K.reviewModel(rv({ after: [{ d: '2026-09-02', c: 1000 }] }), 600, 240);
  assert.ok(flat.P1 > flat.P0 && Number.isFinite(flat.Y(1000)), '値動きが無くても縦軸が潰れない');
});

test('reviewChart: 札が重ならず枠内、NaN を出さない（標準・極端・小数・5桁）', () => {
  const cases = [
    rv({ targets: [{ kind: 'bull', price: 1100 }, { kind: 'base', low: 1010, high: 1060 }, { kind: 'bear', price: 950 }] }),
    rv({ targets: [{ kind: 'bull', price: 1e6 }, { kind: 'base', low: 0.5, high: 1e5 }, { kind: 'bear', price: 0.1 }] }),
    rv({ base: { price: 68309.46, date: '2026-09-01' }, after: days(40, '2026-09-01', (i) => 68309.46 + Math.sin(i) * 900), targets: [{ kind: 'bull', low: 72000, high: 73500 }, { kind: 'base', low: 64000, high: 70000 }, { kind: 'bear', price: 62600 }] }),
    rv({ base: { price: 157.83, date: '2026-09-01' }, after: days(3, '2026-09-01', (i) => 157.83 + i * 0.07), targets: [{ kind: 'bull', price: 160.5 }, { kind: 'bear', price: 150.25 }, { kind: 'x', price: 1 }] }),
  ];
  for (const [W, H] of [[380, 196], [600, 232], [1100, 232]]) {
    for (const r of cases) {
      const s = K.reviewChart(r, W, H);
      assert.ok(s.startsWith('<svg'), `${W}x${H}`);
      clean(s, `reviewChart ${W}x${H}`);
      assert.ok(s.includes('class="rv-line"') && s.includes('class="rv-bline"'));
      const m = K.reviewModel(r, W, H);
      const ys = m.labels.map((l) => l.ty).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 15.99, `札の間隔 ${ys[i] - ys[i - 1]}`);
      assert.ok(ys[0] >= 12 && ys[ys.length - 1] <= H, '札が枠内');
      const widest = Math.max(...m.labels.map((l) => K.textW(l.text, 12)));
      assert.ok(m.x1 + 8 + widest <= W + 0.5, '札の文字が右端からはみ出さない');
      assert.equal(m.targets.length, r.targets.filter((t) => K.RV_KIND[t.kind]).length, '不明な kind は描かない');
    }
  }
});

test('reviewChart: 実データの答え合わせ（build の review）を描ける', () => {
  const k = buildData();
  for (const r of k.review) {
    const s = K.reviewChart(r, 600, 232);
    if (r.after.length) { assert.ok(s.includes('rv-line')); clean(s, `${r.code} ${r.date}`); } else assert.equal(s, '');
  }
});

test('flowHtml: 2〜5箱・向き（up/down/none、不明は none）・5箱を超えたら切る・エスケープ', () => {
  const f = fx('yougo-sample').flow;
  const h = K.flowHtml(f);
  assert.equal((h.match(/class="fb /g) || []).length, f.length);
  assert.equal((h.match(/class="fa"/g) || []).length, f.length - 1, '箱の間に矢印');
  assert.deepEqual([...h.matchAll(/data-dir="(\w+)"/g)].map((m) => m[1]), f.map((x) => x.dir));
  const ex = K.flowHtml(fx('yougo-extreme').flow);
  assert.equal((ex.match(/class="fb /g) || []).length, 5);
  assert.ok(ex.includes('grid-template-columns:minmax(0,1fr) 22px minmax(0,1fr) 22px minmax(0,1fr) 22px minmax(0,1fr) 22px minmax(0,1fr)'));
  const many = K.flowHtml([...Array(7)].map((_, i) => ({ label: `<b>${i}`, dir: i === 3 ? 'sideways' : 'up' })));
  assert.equal((many.match(/class="fb /g) || []).length, 5);
  assert.ok(!many.includes('<b>0') && many.includes('&lt;b&gt;0'));
  assert.match(many, /data-flow="3" data-dir="none"/);
  assert.equal(K.flowHtml([]), '');
  assert.equal(K.flowHtml(null), '');
});

test('seesawHtml: 左は上向き・右は下向き、語のエスケープ、無ければ空', () => {
  const s = K.seesawHtml({ left: '金利<', right: '株価', note: '片方が上がると' });
  assert.match(s, /class="ssl up"><i aria-hidden="true">▲<\/i>金利&lt;/);
  assert.match(s, /class="ssl dn"><i aria-hidden="true">▼<\/i>株価/);
  assert.ok(s.includes('逆向きも同じ'));
  assert.ok(!/<text/.test(s), '図の文字は HTML（拡大縮小で12px未満にならない）');
  assert.equal(K.seesawHtml(null), '');
  assert.equal(K.seesawHtml({ left: '金利' }), '');
});

test('test-hooks の答え合わせ（フィクスチャ用）は build.mjs の buildReview と同じ結果', () => {
  const w = {};
  vm.runInNewContext(readFileSync(join(ROOT, 'app/test-hooks.js'), 'utf8'), { window: w });
  const port = (...x) => JSON.parse(JSON.stringify(w.__KABU_TEST._buildReview(...x))); // vm の別レルムのオブジェクトを素の値に
  const rows = days(30, '2026-08-01', (i) => 2000 + Math.sin(i / 3) * 80);
  const a = (date, sc) => ({ code: '9990', name: '検査', type: 'quick', date, _file: 'x', price: { close: 2000, asOf: date }, sections: { scenarios: sc } });
  const sc = [{ kind: 'bull', target: { label: 'a', price: 2100 }, breakIf: 'x' }, { kind: 'base', target: { label: 'b', low: 1950, high: 2050 }, breakIf: '' }, { kind: 'bear', target: { label: 'c' } }];
  for (const d of [rows[0].d, rows[10].d, rows[26].d, rows[29].d]) assert.deepEqual(port(a(d, sc), 'stock', sc, rows), buildReview(a(d, sc), 'stock', sc, rows), d);
  const m = fx('market-extreme');
  assert.deepEqual(port(m, 'market', m.sections.outlook, rows), buildReview(m, 'market', m.sections.outlook, rows));
});

test('ビューア: 用語帳・気づきノート・答え合わせの画面を含み、準備中の画面は残っていない', () => {
  const html = buildViewerHtml({ dataJs: dataJsText({ generatedAt: '2026-10-03T00:00:00.000Z', stocks: {}, market: null, glossary: [], notes: [], review: [], checklistItems: [] }) });
  for (const k of ['renderGlossary', 'renderNotes', 'reviewPanel', 'reviewChart', 'flowHtml']) assert.ok(html.includes(k), k);
  assert.ok(!html.includes('renderPending') && !html.includes('は準備中です'));
});
