import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { validateAnalysis, validateSchema, BANNED_WORDS } from '../tools/validate.mjs';

const SAMPLE_PATH = new URL('../../data/stocks/6501/analyses/2026-10-01-quick.json', import.meta.url);
const sample = () => JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
const msgs = (errs) => errs.map((e) => `${e.path}: ${e.message}`).join('\n');

test('合格: 日立のサンプル分析', () => {
  assert.deepEqual(validateAnalysis(sample()), []);
});

test('不合格: 禁止語（深い位置の文字列も検出）', () => {
  for (const w of BANNED_WORDS) {
    const a = sample();
    a.sections.scenarios[1].text = `ここは${w}の局面`;
    const e = validateAnalysis(a);
    assert.ok(e.some((x) => x.path === '$.sections.scenarios[1].text' && x.message.includes(w)), msgs(e));
  }
});

test('不合格: checklist 9件', () => {
  const a = sample();
  a.sections.checklist.pop();
  const e = msgs(validateAnalysis(a));
  assert.match(e, /要素数 9 は最小 10 未満/);
  assert.match(e, /10件固定/);
});

test('不合格: checklist の順序違い', () => {
  const a = sample();
  [a.sections.checklist[0], a.sections.checklist[1]] = [a.sections.checklist[1], a.sections.checklist[0]];
  assert.match(msgs(validateAnalysis(a)), /checklist\[0\]\.id: 順序が違います/);
});

test('不合格: sources 0件', () => {
  const a = sample();
  a.sources = [];
  const e = msgs(validateAnalysis(a));
  assert.match(e, /\$\.sources/);
  assert.match(e, /出典が1件以上必要/);
});

test('不合格: diagnosis の重複・scenarios の欠け・level 範囲外', () => {
  const a = sample();
  a.sections.diagnosis[3].key = 'quality';
  a.sections.diagnosis[0].level = 1.2;
  a.sections.scenarios.pop();
  const e = msgs(validateAnalysis(a));
  assert.match(e, /4点診断は/);
  assert.match(e, /シナリオは/);
  assert.match(e, /最大値 1 超/);
});

test('不合格: 必須キー欠落・型違い・形式違い・文字数超過・未対応の型', () => {
  const a = sample();
  delete a.summary;
  a.price.close = '5510';
  a.date = '2026/10/01';
  a.insight = 'あ'.repeat(121);
  const e = msgs(validateAnalysis(a));
  assert.match(e, /必須キー "summary"/);
  assert.match(e, /\$\.price\.close: 型が違います/);
  assert.match(e, /\$\.date: 形式/);
  assert.match(e, /\$\.insight: 文字数 121/);
  assert.match(msgs(validateAnalysis({ ...sample(), type: 'nope' })), /未対応の型/);
});

test('segments を省くなら missing が必要', () => {
  const a = sample();
  delete a.sections.segments;
  assert.match(msgs(validateAnalysis(a)), /segments を省く場合/);
  a.missing = ['事業別利益（決算資料を未取得）'];
  assert.deepEqual(validateAnalysis(a), []);
});

test('validateSchema: 各キーワード', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: ['number', 'null'], minimum: 0, maximum: 5 }, b: { type: 'array', items: { type: 'string', enum: ['x', 'y'], maxLength: 1 }, minItems: 1, maxItems: 2 }, c: { type: 'string', pattern: '^C\\d$' } } };
  assert.deepEqual(validateSchema({ a: null, b: ['x'], c: 'C1' }, s), []);
  assert.equal(validateSchema({ a: 6, b: [], c: 'D1' }, s).length, 3);
  assert.equal(validateSchema({ b: ['z', 'x', 'y'] }, s).length, 3); // required, enum, maxItems
  assert.equal(validateSchema({ a: 'x' }, s).length, 1);
});

test('CLI: OK は exit 0、NG は理由を出して exit 1', () => {
  const ok = spawnSync(process.execPath, ['tools/validate.mjs', SAMPLE_PATH.pathname], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^OK /);
  const ng = spawnSync(process.execPath, ['tools/validate.mjs', new URL('../package.json', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(ng.status, 1);
  assert.match(ng.stdout, /^NG /);
});
