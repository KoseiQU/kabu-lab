import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { buildData, writeDataJs, PRICE_BARS } from '../build.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const sample = JSON.parse(readFileSync(join(ROOT, 'data/stocks/6501/analyses/2026-10-01-quick.json'), 'utf8'));
const w = (p, o) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o));
};

function makeData() {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-build-'));
  const d = join(dir, 'data');
  const rows = Array.from({ length: 300 }, (_, i) => ({ d: `2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, o: 1, h: 2, l: 1, c: 1.5, v: 10 }));
  w(join(d, 'stocks/6501/prices.json'), { meta: { code: '6501' }, rows });
  w(join(d, 'stocks/6501/profile.json'), { code: '6501', name: '日立製作所' });
  w(join(d, 'stocks/6501/analyses/2026-10-01-quick.json'), sample);
  w(join(d, 'stocks/6501/analyses/2026-10-05-quick.json'), { ...sample, date: '2026-10-05', insight: '新しい気づき', terms: [{ term: 'PER', def: '別定義' }, { term: 'RSI', def: '買われすぎ・売られすぎの目安' }] });
  w(join(d, 'stocks/8001/analyses/2026-09-30-quick.json'), { ...sample, code: '8001', name: '伊藤忠商事', date: '2026-09-30', terms: [{ term: '信用倍率', def: 'x' }] });
  w(join(d, 'market/2026-10-02-raw.json'), { date: '2026-10-02', items: {} });
  w(join(d, 'market/2026-10-03-raw.json'), { date: '2026-10-03', items: { nikkei225: { value: 1 } } });
  w(join(d, 'glossary.json'), [{ term: 'PBR', def: '株価純資産倍率' }]);
  return dir;
}

test('build: 生成物の形', () => {
  const dir = makeData();
  try {
    const k = buildData({ dataDir: join(dir, 'data'), schemasDir: join(ROOT, 'schemas') });
    assert.deepEqual(Object.keys(k.stocks).sort(), ['6501', '8001']);
    const s = k.stocks['6501'];
    assert.equal(s.profile.name, '日立製作所');
    assert.equal(s.prices.rows.length, PRICE_BARS);
    assert.deepEqual(s.analyses.map((a) => a.date), ['2026-10-05', '2026-10-01']); // 日付降順
    assert.equal(k.stocks['8001'].prices, null);
    assert.equal(k.stocks['8001'].name, '伊藤忠商事');
    // 用語帳: 重複排除・初出（最古）の銘柄と日付・glossary.json の統合
    const g = Object.fromEntries(k.glossary.map((x) => [x.term, x]));
    assert.deepEqual(Object.keys(g).sort(), ['PBR', 'PER', 'RSI', '信用倍率', '乖離率'].sort());
    assert.equal(g['PER'].def, '株価が1年分の利益の何倍か');
    assert.equal(g['PER'].firstDate, '2026-10-01');
    assert.equal(g['信用倍率'].firstCode, '8001'); // 8001 の 09-30 が最古
    assert.equal(g['RSI'].firstDate, '2026-10-05');
    assert.equal(g['PBR'].def, '株価純資産倍率');
    // 気づきノート: 日付降順
    assert.deepEqual(k.notes.map((n) => n.date), ['2026-10-05', '2026-10-01', '2026-09-30']);
    assert.equal(k.notes[0].text, '新しい気づき');
    assert.equal(k.market.raw.date, '2026-10-03');
    assert.equal(k.checklistItems.length, 10);
    // data.js として読み込める
    const out = join(dir, 'app', 'data.js');
    writeDataJs(k, out);
    const ctx = { window: {} };
    vm.runInNewContext(readFileSync(out, 'utf8'), ctx);
    assert.equal(ctx.window.KABU.stocks['6501'].analyses[0].date, '2026-10-05');
    assert.ok(typeof ctx.window.KABU.generatedAt === 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: 壊れたJSONはファイル名を示して exit 1', () => {
  const dir = makeData();
  try {
    w(join(dir, 'data/stocks/6501/analyses/2026-10-06-quick.json'), '{ "broken": ');
    const r = spawnSync(process.execPath, [join(ROOT, 'build.mjs'), '--data', join(dir, 'data'), '--out', join(dir, 'out.js')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /壊れたJSON: .*2026-10-06-quick\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: indicators（系列は prices.rows と同じ長さ）と finance', () => {
  const dir = makeData();
  try {
    w(join(dir, 'data/stocks/6501/finance.json'), { code: '6501', annual: { rows: [] } });
    const k = buildData({ dataDir: join(dir, 'data'), schemasDir: join(ROOT, 'schemas') });
    const s = k.stocks['6501'];
    const ind = s.indicators;
    assert.deepEqual(Object.keys(ind.ma), ['ma5', 'ma25', 'ma75', 'ma200']);
    for (const arr of Object.values(ind.ma)) assert.equal(arr.length, s.prices.rows.length);
    assert.equal(ind.bars, s.prices.rows.length);
    assert.equal(ind.ma.ma5.at(-1), 1.5);
    // 300本中の末尾250本を表示: 表示の添字 i は全体の 50+i。200日線は全体の添字199（表示149）から値がある
    assert.equal(ind.ma.ma200[148], null);
    assert.equal(ind.ma.ma200[149], 1.5);
    assert.equal(ind.ma.ma75[23], null);
    assert.equal(ind.ma.ma75[24], 1.5);
    for (const k2 of ['close', 'ma', 'rsi14', 'volumeRatio20', 'change3dPct', 'week52']) assert.ok(k2 in ind.latest, k2);
    for (const k2 of ['volumeProfile', 'swings', 'crosses', 'priceCrosses', 'gaps', 'maTouches', 'weekly', 'monthly']) assert.ok(k2 in ind, k2);
    assert.ok(ind.weekly.length > 0 && ind.monthly.length > 0);
    assert.ok(ind.weekly.every((b) => ['d', 'o', 'h', 'l', 'c', 'v'].every((x) => x in b)));
    assert.deepEqual(s.finance, { code: '6501', annual: { rows: [] } });
    assert.equal(k.stocks['8001'].indicators, null);
    assert.equal(k.stocks['8001'].finance, null);
    assert.ok(!JSON.stringify(k).includes('NaN'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: ファイル名の型と中身の type が食い違えば exit 1（全型が対象）', () => {
  const dir = makeData();
  try {
    w(join(dir, 'data/stocks/6501/analyses/2026-10-07-chart.json'), { ...sample, type: 'quick' });
    const r = spawnSync(process.execPath, [join(ROOT, 'build.mjs'), '--data', join(dir, 'data'), '--out', join(dir, 'out.js')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /食い違って.*2026-10-07-chart\.json/);
    rmSync(join(dir, 'data/stocks/6501/analyses/2026-10-07-chart.json'));
    w(join(dir, 'data/stocks/6501/analyses/2026-10-07-chart.json'), { ...sample, type: 'chart', date: '2026-10-07' });
    const k = buildData({ dataDir: join(dir, 'data'), schemasDir: join(ROOT, 'schemas') });
    assert.deepEqual(k.stocks['6501'].analyses.map((a) => a.type), ['chart', 'quick', 'quick']);
    w(join(dir, 'data/stocks/6501/analyses/memo.json'), { ...sample });
    assert.throws(() => buildData({ dataDir: join(dir, 'data') }), /<日付>-<型>\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
