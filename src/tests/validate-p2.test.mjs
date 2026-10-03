// chart・kessan 型の検証（P2a）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAnalysis, BANNED_WORDS, SUPPORTED_TYPES } from '../tools/validate.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const msgs = (errs) => errs.map((e) => `${e.path}: ${e.message}`).join('\n');
const ng = (a, re) => {
  const e = validateAnalysis(a);
  assert.ok(e.length > 0, '不合格になるはず');
  assert.match(msgs(e), re);
};

test('対応する型は quick・chart・kessan', () => {
  assert.deepEqual(SUPPORTED_TYPES, ['quick', 'chart', 'kessan']);
  ng({ ...load('chart-sample.json'), type: 'news' }, /未対応の型/);
});

for (const f of ['chart-sample.json', 'chart-extreme.json', 'chart-sparse.json', 'kessan-sample.json', 'kessan-extreme.json', 'kessan-sparse.json']) {
  test(`合格: フィクスチャ ${f}`, () => assert.deepEqual(validateAnalysis(load(f)), []));
}

test('上限いっぱいのフィクスチャは +1 文字・+1 件で不合格になる（上限が効いている）', () => {
  const a = load('chart-extreme.json');
  a.sections.checklist[0].reason += 'あ';
  ng(a, /checklist\[0\]\.reason: 文字数 161 は上限 160 超/);
  const b = load('chart-extreme.json');
  b.sections.levels.push({ ...b.sections.levels[0] });
  ng(b, /levels: 要素数 13 は上限 12 超/);
  const c = load('kessan-extreme.json');
  c.sections.points[0].text += 'あ';
  ng(c, /points\[0\]\.text: 文字数 121/);
  const d = load('kessan-extreme.json');
  d.sections.results.push({ ...d.sections.results[0], key: 'x7' });
  ng(d, /results: 要素数 7 は上限 6 超/);
});

test('chart: checklist 9件・順序違い', () => {
  const a = load('chart-sample.json');
  a.sections.checklist.pop();
  ng(a, /10件固定/);
  const b = load('chart-sample.json');
  b.sections.checklist.reverse();
  ng(b, /checklist\[0\]\.id: 順序が違います/);
});

test('chart: watch は進行中だけ', () => {
  const a = load('chart-sample.json');
  a.sections.checklist[0].watch = '';
  ng(a, /checklist\[0\]\.watch: 進行中の項目は watch/);
  const b = load('chart-sample.json');
  b.sections.checklist[1].watch = '次に見る点';
  ng(b, /checklist\[1\]\.watch: 進行中以外/);
});

test('chart: timeframes は monthly→weekly→daily の順', () => {
  const a = load('chart-sample.json');
  a.sections.timeframes.reverse();
  ng(a, /時間軸は monthly→weekly→daily/);
  const b = load('chart-sample.json');
  b.sections.timeframes.pop();
  ng(b, /timeframes: 要素数 2/);
});

test('chart: heat は ma25dev,rsi,change3d,volume の4件', () => {
  const a = load('chart-sample.json');
  a.sections.heat[3].key = 'rsi';
  ng(a, /過熱の物差しは ma25dev→rsi→change3d→volume/);
  const b = load('chart-sample.json');
  b.sections.heat[0].state = 'boiling';
  ng(b, /heat\[0\]\.state/);
});

test('chart: plans は pullback,breakout,wait の3件・zone の low<=high', () => {
  const a = load('chart-sample.json');
  [a.sections.plans[0], a.sections.plans[1]] = [a.sections.plans[1], a.sections.plans[0]];
  ng(a, /考え方のプランは pullback→breakout→wait/);
  const b = load('chart-sample.json');
  b.sections.plans[0].zone = { low: 5500, high: 5400 };
  ng(b, /plans\[0\]\.zone: low が high より大きい/);
});

test('chart: levels は low<=high・strength は1〜5の整数・basis は1〜4語', () => {
  const a = load('chart-sample.json');
  a.sections.levels[2] = { ...a.sections.levels[2], low: 5700, high: 5600 };
  ng(a, /levels\[2\]: low\(5700\) が high\(5600\) より大きい/);
  const b = load('chart-sample.json');
  b.sections.levels[0].strength = 2.5;
  ng(b, /levels\[0\]\.strength: 型が違います/);
  b.sections.levels[0].strength = 6;
  ng(b, /levels\[0\]\.strength: 6 は最大値 5 超/);
  const c = load('chart-sample.json');
  c.sections.levels[0].basis = [];
  ng(c, /basis: 要素数 0/);
  c.sections.levels[0].basis = ['十三文字の根拠の語を書いたもの'];
  ng(c, /basis\[0\]: 文字数/);
  const d = load('chart-sample.json');
  d.sections.levels = [d.sections.levels[0]];
  ng(d, /levels: 要素数 1 は最小 2/);
});

test('chart: sources 0件・禁止語', () => {
  const a = load('chart-sample.json');
  a.sources = [];
  ng(a, /出典が1件以上必要/);
  for (const w of BANNED_WORDS) {
    const b = load('chart-sample.json');
    b.sections.plans[1].pros = `${w}の形`;
    ng(b, new RegExp(`plans\\[1\\]\\.pros: 禁止語「${w}」`));
  }
});

test('kessan: points は3件固定', () => {
  const a = load('kessan-sample.json');
  a.sections.points.pop();
  ng(a, /判定の理由は3件固定/);
});

test('kessan: progress.pct は 0〜200（null は可）', () => {
  const a = load('kessan-sample.json');
  a.sections.progress.pct = 250;
  ng(a, /進捗率 250 は 0〜200 の範囲外/);
  a.sections.progress.pct = -1;
  ng(a, /progress\.pct/);
  a.sections.progress.pct = null;
  assert.deepEqual(validateAnalysis(a), []);
});

test('kessan: results の key 重複・件数', () => {
  const a = load('kessan-sample.json');
  a.sections.results[1].key = 'sales';
  ng(a, /key が重複しています: sales/);
  const b = load('kessan-sample.json');
  b.sections.results = [b.sections.results[0]];
  ng(b, /results: 要素数 1 は最小 2/);
});

test('kessan: 必須セクション欠落・enum 違い・禁止語・sources 0件', () => {
  const a = load('kessan-sample.json');
  delete a.sections.outlook;
  a.sections.verdict.grade = 'great';
  a.sections.next = [];
  a.sources = [];
  a.sections.driver.text = '今が買いの決算';
  const m = msgs(validateAnalysis(a));
  assert.match(m, /必須キー "outlook"/);
  assert.match(m, /verdict\.grade: 値 "great"/);
  assert.match(m, /next: 要素数 0/);
  assert.match(m, /出典が1件以上必要/);
  assert.match(m, /禁止語「今が買い」/);
});

test('kessan: deep は任意（あれば中身を検査）', () => {
  const a = load('kessan-extreme.json');
  delete a.sections.deep.plan;
  ng(a, /deep: 必須キー "plan"/);
  const b = load('kessan-sample.json');
  assert.equal('deep' in b.sections, false);
  assert.deepEqual(validateAnalysis(b), []);
});

test('quick の既存検証は変わらない', () => {
  const q = JSON.parse(readFileSync(new URL('../../data/stocks/6501/analyses/2026-10-01-quick.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateAnalysis(q), []);
  ng({ ...q, type: 'chart' }, /必須キー "timeframes"/);
});
