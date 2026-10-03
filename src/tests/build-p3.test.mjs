// build の P3a 拡張: market の履歴と series・用語型（data/glossary/）の統合・気づきノートの種別・答え合わせ（review）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { buildData, buildReview, writeDataJs } from '../build.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const quick = JSON.parse(readFileSync(join(ROOT, '..', 'data/stocks/6501/analyses/2026-10-01-quick.json'), 'utf8'));
const w = (p, o) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o));
};

function makeData() {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-build3-'));
  const d = join(dir, 'data');
  const rows = [['2026-09-30', 5489], ['2026-10-01', 5510], ['2026-10-02', 5522], ['2026-10-05', 5000]].map(([dd, c]) => ({ d: dd, o: c, h: c, l: c, c, v: 1 }));
  w(join(d, 'stocks/6501/prices.json'), { meta: { code: '6501' }, rows });
  w(join(d, 'stocks/6501/analyses/2026-10-01-quick.json'), quick);
  w(join(d, 'stocks/6501/analyses/2026-10-02-news.json'), fx('news-sample.json'));
  w(join(d, 'stocks/6501/analyses/2026-10-02-hansei.json'), fx('hansei-sample.json'));
  w(join(d, 'stocks/6501/analyses/2026-10-02-chart.json'), fx('chart-sample.json'));
  w(join(d, 'market/2026-10-03-raw.json'), { date: '2026-10-03', items: {} });
  w(join(d, 'market/2026-10-02.json'), fx('market-sample.json'));
  w(join(d, 'market/2026-09-25.json'), { ...fx('market-sparse.json'), date: '2026-09-25', price: { ...fx('market-sparse.json').price, asOf: '2026-09-25' } });
  w(join(d, 'market/series.json'), { generatedAt: 'x', series: { '^N225': { key: 'nikkei225', name: '日経平均', unit: '円', rows: [{ d: '2026-09-25', c: 66364.2 }, { d: '2026-09-26', c: 66000 }, { d: '2026-10-02', c: 68309.46 }, { d: '2026-10-05', c: 70500 }] } } });
  // 用語型: 分析の terms にもある語（受注残）と、用語型だけの語（金利と株価）
  w(join(d, 'glossary/金利と株価.json'), fx('yougo-sample.json'));
  w(join(d, 'glossary/受注残.json'), { ...fx('yougo-sparse.json'), term: '受注残', def: '用語型の定義（こちらが優先）', category: '決算' });
  w(join(d, 'glossary.json'), [{ term: 'PBR', def: '株価純資産倍率' }]);
  return dir;
}
const load = (dir) => buildData({ dataDir: join(dir, 'data'), schemasDir: join(ROOT, 'schemas') });

test('build: market の分析を全件・日付降順で analyses に、最新を analysis に、series.json を series に', () => {
  const dir = makeData();
  try {
    const k = load(dir);
    assert.deepEqual(k.market.analyses.map((a) => a.date), ['2026-10-02', '2026-09-25']);
    assert.equal(k.market.analysis.date, '2026-10-02');
    assert.equal(k.market.analyses[0]._file, 'data/market/2026-10-02.json');
    assert.equal(k.market.raw.date, '2026-10-03');
    assert.equal(k.market.series.series['^N225'].rows.length, 4);
    // 市場の分析は銘柄ではない（stocks に入らない）
    assert.deepEqual(Object.keys(k.stocks), ['6501']);
    assert.deepEqual(k.stocks['6501'].analyses.map((a) => a.type).sort(), ['chart', 'hansei', 'news', 'quick']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: market が無くても形は同じ（analyses は空配列、series は null）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-build3-'));
  try {
    const k = buildData({ dataDir: join(dir, 'data') });
    assert.deepEqual(k.market, { raw: null, analysis: null, analyses: [], series: null });
    assert.deepEqual(k.review, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: 用語型を用語帳に統合（同じ語は用語型の定義を優先し detail に本体）・旧 glossary.json も読む', () => {
  const dir = makeData();
  try {
    const g = Object.fromEntries(load(dir).glossary.map((x) => [x.term, x]));
    // 分析にもある語: 初出は分析のまま、定義と分類は用語型
    assert.equal(g['受注残'].def, '用語型の定義（こちらが優先）');
    assert.equal(g['受注残'].firstCode, '6501');
    assert.equal(g['受注残'].firstType, 'news');
    assert.equal(g['受注残'].category, '決算');
    assert.equal(g['受注残'].detail.body, fx('yougo-sparse.json').body);
    assert.equal(g['受注残'].detail._file, 'data/glossary/受注残.json');
    assert.ok(!('schema' in g['受注残'].detail) && !('type' in g['受注残'].detail));
    // 用語型だけの語
    const k = g['金利と株価'];
    assert.equal(k.firstCode, null);
    assert.equal(k.firstType, 'yougo');
    assert.equal(k.firstDate, '2026-10-03');
    assert.equal(k.detail.flow.length, 4);
    assert.deepEqual(k.detail.seesaw, fx('yougo-sample.json').seesaw);
    // 分析だけの語は category・detail が null。市場の分析の terms も入る
    assert.equal(g['違約金'].detail, null);
    assert.equal(g['違約金'].category, null);
    assert.equal(g['金利差'].firstType, 'market');
    assert.equal(g['金利差'].firstCode, null);
    assert.equal(g['PBR'].def, '株価純資産倍率');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: 気づきノートに insight・chart と hansei の lesson・hansei の nextChecks（種別つき、日付降順）', () => {
  const dir = makeData();
  try {
    const n = load(dir).notes;
    assert.deepEqual([...new Set(n.map((x) => x.kind))].sort(), ['insight', 'lesson', 'nextCheck']);
    const h = fx('hansei-sample.json');
    const nc = n.filter((x) => x.kind === 'nextCheck');
    assert.deepEqual(nc.map((x) => [x.title, x.text]), h.sections.nextChecks.map((c) => [c.label, c.how]));
    assert.ok(nc.every((x) => x.type === 'hansei' && x.code === '6501' && x.date === '2026-10-02'));
    assert.deepEqual(n.filter((x) => x.kind === 'lesson').map((x) => x.type).sort(), ['chart', 'hansei']);
    assert.equal(n.find((x) => x.kind === 'lesson' && x.type === 'hansei').title, h.sections.lesson.title);
    assert.ok(n.some((x) => x.kind === 'insight' && x.type === 'market' && x.code === null && x.name === '市場'));
    assert.ok(n.some((x) => x.kind === 'insight' && x.type === 'news'));
    const dates = n.map((x) => x.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    // 既存の形（date, code, name, type, text）は保つ
    for (const x of n) for (const key of ['date', 'code', 'name', 'type', 'text']) assert.ok(key in x, key);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: review（quick と market の答え合わせ）の基準・目安・その後の終値・いちばん近い目安', () => {
  const dir = makeData();
  try {
    const r = load(dir).review;
    assert.deepEqual(r.map((x) => [x.kind, x.date]), [['market', '2026-10-02'], ['stock', '2026-10-01'], ['market', '2026-09-25']]);
    const s = r.find((x) => x.kind === 'stock');
    assert.equal(s.code, '6501');
    assert.deepEqual(s.base, { price: 5510, date: '2026-10-01' });
    assert.deepEqual(s.after, [{ d: '2026-10-02', c: 5522 }, { d: '2026-10-05', c: 5000 }]);
    assert.equal(s.days, 2);
    assert.equal(s.young, true);
    assert.deepEqual(s.targets, [
      { kind: 'bull', label: '5,830円の高値更新', price: 5830, breakIf: '米IT大手のAI投資減速' },
      { kind: 'base', label: '5,040〜5,830円のレンジ', low: 5040, high: 5830, breakIf: '円高が進み想定レート160円を大きく下回る' },
      { kind: 'bear', label: '75日線 5,117円割れ', price: 5117, breakIf: '受注の伸びが決算で確認され続ける' },
    ]);
    // 最新 5000: 帯 5040〜5830 の下端まで 0.79%、5117 まで 2.29%、5830 まで 14.24%
    assert.deepEqual(s.nearest, { kind: 'base', distPct: 0.79 });
    assert.equal(s.file, 'data/stocks/6501/analyses/2026-10-01-quick.json');
    const m = r[0];
    assert.equal(m.code, null);
    assert.deepEqual(m.base, { price: 68309.46, date: '2026-10-02' });
    assert.deepEqual(m.after, [{ d: '2026-10-05', c: 70500 }]);
    // 70500: 中立の帯 64000〜70000 の上端まで 0.71%
    assert.deepEqual(m.nearest, { kind: 'base', distPct: 0.71 });
    assert.equal(r[2].days, 3); // 09-25 より後の 09-26・10-02・10-05
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReview: その後が無い・5営業日以上・帯の中は距離0・目安に数値が無い', () => {
  const a = { code: '9999', name: 'x', type: 'quick', date: '2026-01-05', price: { close: 100, asOf: '2026-01-05' } };
  const sc = [{ kind: 'bull', target: { label: '上', price: 120 } }, { kind: 'base', target: { label: '帯', low: 95, high: 105 } }, { kind: 'bear', target: { label: '数値なし' } }];
  const none = buildReview(a, 'stock', sc, null);
  assert.deepEqual([none.after, none.days, none.young, none.latest, none.nearest], [[], 0, true, null, null]);
  const rows = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-13'].map((d, i) => ({ d, c: 100 + i }));
  const r = buildReview(a, 'stock', sc, rows);
  assert.equal(r.days, 5);
  assert.equal(r.young, false);
  assert.deepEqual(r.latest, { d: '2026-01-13', c: 106 });
  assert.deepEqual(r.nearest, { kind: 'base', distPct: 0.95 }); // 106 は帯の上端 105 から 0.95%
  assert.deepEqual(r.targets[2], { kind: 'bear', label: '数値なし', breakIf: '' });
  const inside = buildReview(a, 'stock', sc, rows.slice(0, 3));
  assert.deepEqual(inside.nearest, { kind: 'base', distPct: 0 });
});

test('build: news・hansei でもファイル名の型と中身の type の食い違いは exit 1。市場・用語の type 違いも exit 1', () => {
  const dir = makeData();
  const run = () => spawnSync(process.execPath, [join(ROOT, 'build.mjs'), '--data', join(dir, 'data'), '--out', join(dir, 'out.js')], { encoding: 'utf8' });
  try {
    assert.equal(run().status, 0);
    w(join(dir, 'data/stocks/6501/analyses/2026-10-03-news.json'), fx('hansei-sample.json'));
    let r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ファイル名の型「news」と中身の type「hansei」.*2026-10-03-news\.json/);
    rmSync(join(dir, 'data/stocks/6501/analyses/2026-10-03-news.json'));
    w(join(dir, 'data/stocks/6501/analyses/2026-10-03-hansei.json'), fx('news-sample.json'));
    r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ファイル名の型「hansei」と中身の type「news」/);
    rmSync(join(dir, 'data/stocks/6501/analyses/2026-10-03-hansei.json'));
    w(join(dir, 'data/market/2026-10-06.json'), fx('news-sample.json'));
    r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /市場の分析ファイルの type が「market」ではありません.*2026-10-06\.json/);
    rmSync(join(dir, 'data/market/2026-10-06.json'));
    w(join(dir, 'data/glossary/x.json'), fx('news-sample.json'));
    r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /用語ファイルの type が「yougo」ではない.*glossary\/x\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: data.js として読めて NaN を含まない（P3a のキーつき）', () => {
  const dir = makeData();
  try {
    const k = load(dir);
    const out = join(dir, 'app', 'data.js');
    writeDataJs(k, out);
    const ctx = { window: {} };
    vm.runInNewContext(readFileSync(out, 'utf8'), ctx);
    const K = ctx.window.KABU;
    for (const key of ['stocks', 'market', 'glossary', 'notes', 'review', 'checklistItems']) assert.ok(key in K, key);
    assert.ok(!readFileSync(out, 'utf8').includes('NaN'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
