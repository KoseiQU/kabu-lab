// build の P5a 拡張: refresh.json → refresh、headlines.json → market.headlines、分析ごとの鮮度 _age、市場型の edition 欄
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { buildData, analysisAge, sanitizeHeadlines, sanitizeRefresh, dataJsText } from '../build.mjs';
import { validateAnalysis, validateFile } from '../tools/validate.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const w = (p, o) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o));
};
const days = (list) => list.map(([d, c]) => ({ d, o: c, h: c, l: c, c, v: 1 }));

function makeData() {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-build5-'));
  const d = join(dir, 'data');
  // 銘柄: prices.json の全期間（250本に切り詰める前）で数える
  w(join(d, 'stocks/6501/prices.json'), { meta: { code: '6501' }, rows: days([['2026-09-29', 1], ['2026-09-30', 2], ['2026-10-01', 3], ['2026-10-02', 4], ['2026-10-05', 5]]) });
  w(join(d, 'stocks/6501/analyses/2026-10-02-chart.json'), { ...fx('chart-sample.json'), code: '6501', date: '2026-10-02', price: { ...fx('chart-sample.json').price, asOf: '2026-10-02' } });
  w(join(d, 'stocks/6501/analyses/2026-09-30-news.json'), { ...fx('news-sample.json'), code: '6501', date: '2026-09-30', price: null });
  w(join(d, 'stocks/6501/analyses/2026-09-28-hansei.json'), { ...fx('hansei-sample.json'), code: '6501', date: '2026-09-28', price: { ...fx('hansei-sample.json').price, asOf: '2026-10-05' } });
  // 株価の無い銘柄の分析は null
  w(join(d, 'stocks/9999/analyses/2026-10-02-chart.json'), { ...fx('chart-sample.json'), code: '9999' });
  // 市場: 日経平均の日足で数える（date は実行日、price.asOf は最終取引日）
  w(join(d, 'market/2026-10-05.json'), { ...fx('market-sample.json'), date: '2026-10-05', price: { ...fx('market-sample.json').price, asOf: '2026-10-02' }, sections: { ...fx('market-sample.json').sections, edition: 'pre' } });
  w(join(d, 'market/2026-09-25.json'), { ...fx('market-sparse.json'), date: '2026-09-25', price: { ...fx('market-sparse.json').price, asOf: '2026-09-25' } });
  w(join(d, 'market/series.json'), { generatedAt: 'x', series: { '^N225': { key: 'nikkei225', name: '日経平均', unit: '円', rows: [{ d: '2026-09-25', c: 1 }, { d: '2026-09-26', c: 2 }, { d: '2026-10-02', c: 3 }, { d: '2026-10-05', c: 4 }] } } });
  return dir;
}

test('build: _age は基準日（price.asOf、無ければ date）より後の取引日数。株価が無ければ null', () => {
  const dir = makeData();
  try {
    const k = buildData({ dataDir: join(dir, 'data'), schemasDir: join(ROOT, 'schemas') });
    const by = Object.fromEntries(k.stocks['6501'].analyses.map((a) => [a.type, a._age]));
    assert.deepEqual(by, { chart: 1, news: 3, hansei: 0 }); // news は price が null → date 2026-09-30 から
    assert.equal(k.stocks['9999'].analyses[0]._age, null);
    assert.deepEqual(k.market.analyses.map((a) => [a.date, a._age]), [['2026-10-05', 1], ['2026-09-25', 3]]);
    assert.equal(k.market.analysis._age, 1);
    assert.equal(k.market.analysis.sections.edition, 'pre');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analysisAge: 境界（基準日が最終日・最終日より後・日付が無い・日足が空）', () => {
  const rows = days([['2026-10-01', 1], ['2026-10-02', 2]]);
  assert.equal(analysisAge({ date: '2026-10-02' }, rows), 0);
  assert.equal(analysisAge({ date: '2026-10-09' }, rows), 0);
  assert.equal(analysisAge({ date: '2026-09-01' }, rows), 2);
  assert.equal(analysisAge({ date: '2026-10-02', price: { asOf: '2026-09-30' } }, rows), 2);
  assert.equal(analysisAge({ date: 'きのう' }, rows), null);
  assert.equal(analysisAge({ date: '2026-10-01' }, []), null);
  assert.equal(analysisAge({ date: '2026-10-01' }, null), null);
});

test('build: refresh.json → refresh、headlines.json → market.headlines（無ければ null、壊れていても build は止めない）', () => {
  const dir = makeData();
  try {
    const d = join(dir, 'data');
    const opts = { dataDir: d, schemasDir: join(ROOT, 'schemas'), warn: () => {} };
    let k = buildData(opts);
    assert.equal(k.refresh, null);
    assert.equal(k.market.headlines, null);
    const refresh = { at: '2026-10-04T22:21:00.000Z', finishedAt: '2026-10-04T22:21:30.000Z', steps: [{ key: 'market', ok: true, message: '日経平均', sec: 1.2 }, { key: 'stocks', ok: false, message: '1銘柄が失敗', sec: 9 }, { key: 'headlines', ok: true, message: '30件', sec: 3 }, { key: 'build', ok: true, message: 'data.js', sec: 1 }], stocks: [{ code: '6501', ok: false, lastDate: '2026-10-02', message: '株探の取得に失敗' }] };
    w(join(d, 'refresh.json'), refresh);
    w(join(d, 'market/headlines.json'), { fetchedAt: '2026-10-04T22:21:20.000Z', sources: [{ name: 'NHK 経済', url: 'https://www3.nhk.or.jp/rss/news/cat5.xml', ok: true, count: 2, message: '' }], items: [
      { title: '題名', url: 'https://www3.nhk.or.jp/a.html', source: 'NHK 経済', publishedAt: '2026-10-04T22:00:00.000Z' },
      { title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', source: 'NHK 経済', publishedAt: null },
      { title: 42, url: 'https://e.com/', source: 'X', publishedAt: null },
    ] });
    k = buildData(opts);
    assert.deepEqual(k.refresh, refresh);
    assert.equal(k.market.headlines.items.length, 1, 'http(s) 以外・文字列でない題名は渡さない');
    assert.equal(k.market.headlines.items[0].title, '題名');
    assert.equal(k.market.headlines.fetchedAt, '2026-10-04T22:21:20.000Z');
    // data.js として読め、< は < に（題名に </script> があっても HTML を壊さない）
    const ctx = { window: {} };
    vm.runInNewContext(dataJsText(k), ctx);
    assert.equal(ctx.window.KABU.refresh.steps[1].ok, false);
    // 壊れた補助ファイルは警告して null
    w(join(d, 'refresh.json'), '{"at": ');
    const warns = [];
    k = buildData({ ...opts, warn: (m) => warns.push(m) });
    assert.equal(k.refresh, null);
    assert.match(warns.join('\n'), /refresh\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sanitizeRefresh / sanitizeHeadlines: 形をそろえる', () => {
  assert.equal(sanitizeRefresh({ steps: [] }), null); // at が無い
  assert.deepEqual(sanitizeRefresh({ at: 'x', steps: [{ key: 'build', ok: 'yes' }, null], stocks: [{ code: '1', lastDate: 'bad' }] }), { at: 'x', finishedAt: null, steps: [{ key: 'build', ok: false, message: '' }], stocks: [{ code: '1', ok: false, lastDate: null, message: '' }] });
  assert.equal(sanitizeHeadlines(null), null);
  assert.deepEqual(sanitizeHeadlines({ items: [{ title: ' a ', url: ' http://e.com/x ', source: 'S' }] }), { fetchedAt: null, sources: [], items: [{ title: ' a ', url: 'http://e.com/x', source: 'S', publishedAt: null }] });
});

test('市場型の edition（任意）: pre / post / other だけ。既存の市場の分析とフィクスチャは通る', () => {
  for (const e of ['pre', 'post', 'other']) {
    const a = fx('market-sample.json');
    a.sections.edition = e;
    assert.deepEqual(validateAnalysis(a), []);
  }
  const b = fx('market-sample.json');
  b.sections.edition = 'morning';
  assert.match(validateAnalysis(b).map((x) => `${x.path}: ${x.message}`).join('\n'), /\$\.sections\.edition: 値 "morning" は許可されていません/);
  for (const f of ['market-sample.json', 'market-sparse.json', 'market-extreme.json']) assert.deepEqual(validateAnalysis(fx(f)), [], f);
  assert.deepEqual(validateFile(join(ROOT, '..', 'data/market/2026-10-02.json')), []);
});
