import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseChart } from '../collect/prices.mjs';
import { parseSpark, parseMarket } from '../collect/market.mjs';
import { createFetcher, FetchLimitError, USER_AGENT } from '../collect/lib/fetch.mjs';

const T0 = Date.UTC(2026, 8, 30, 0, 0) / 1000; // 2026-09-30 09:00 JST

test('parseChart: JST日付・null行除外・小数1桁・最終行の終値を meta で補う', () => {
  const json = {
    chart: {
      result: [{
        meta: { currency: 'JPY', symbol: '6501.T', longName: 'Hitachi', gmtoffset: 32400, regularMarketPrice: 5522, regularMarketTime: T0 + 2 * 86400 + 6.5 * 3600, regularMarketDayHigh: 5541, regularMarketDayLow: 5455, regularMarketVolume: 999 },
        timestamp: [T0 - 86400 * 1, T0, T0 + 86400, T0 + 2 * 86400],
        indicators: { quote: [{ open: [1, 5465, null, 5455], high: [1, 5514.04, null, 5541], low: [1, 5393, null, 5455], close: [1, 5489.06, null, null], volume: [1, 14102000, null, 11270600] }] },
      }],
      error: null,
    },
  };
  const p = parseChart(json, '6501');
  assert.deepEqual(p.rows.map((r) => r.d), ['2026-09-29', '2026-09-30', '2026-10-02']);
  assert.deepEqual(p.rows[1], { d: '2026-09-30', o: 5465, h: 5514, l: 5393, c: 5489.1, v: 14102000 });
  assert.equal(p.rows[2].c, 5522);
  assert.equal(p.meta.asOf, '2026-10-02');
  assert.equal(p.meta.lastCloseFromMeta, true);
  assert.throws(() => parseChart({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }, '0000'), /Not Found/);
});

test('parseSpark/parseMarket: 前日比・欠損は missing', () => {
  assert.deepEqual(parseSpark({ timestamp: [T0, T0 + 86400, T0 + 2 * 86400], close: [100, 110, null], fulldayPrice: 99 }), {
    value: 99, prev: 110, change: -11, changePct: -10, asOf: '2026-10-02',
  });
  assert.equal(parseSpark({ timestamp: [T0], close: [1] }), null);
  const m = parseMarket({ '^N225': { timestamp: [T0, T0 + 86400], close: [100, 101] } }, new Date('2026-10-02T16:00:00Z'));
  assert.equal(m.date, '2026-10-03');
  assert.equal(m.items.nikkei225.value, 101);
  assert.equal(m.items.usdjpy, null);
  assert.ok(m.missing.includes('ドル円(JPY=X)'));
});

test('fetch: UA明示・1サイト4リクエスト上限・間隔・リトライ1回', async () => {
  let hits = 0, lastUA = '';
  const times = [];
  const srv = createServer((req, res) => {
    hits++;
    lastUA = req.headers['user-agent'];
    times.push(Date.now());
    if (req.url === '/fail') { res.statusCode = 503; return res.end('busy'); }
    if (req.url === '/404') { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const f = createFetcher({ minIntervalMs: 50, retryWaitMs: 0, timeoutMs: 2000 });
    assert.deepEqual(await f.json(`${base}/a`), { ok: true });
    assert.equal(lastUA, USER_AGENT);
    await assert.rejects(f.text(`${base}/fail`), /HTTP 503/); // 2回（初回＋リトライ1回）
    assert.equal(hits, 3);
    await assert.rejects(f.text(`${base}/404`), /HTTP 404/); // 404 は再試行しない
    assert.equal(hits, 4);
    await assert.rejects(f.text(`${base}/a`), FetchLimitError); // 5回目は上限
    assert.equal(hits, 4);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 45, `間隔 ${times[i] - times[i - 1]}ms`);
  } finally {
    srv.close();
  }
});

test('fetch: タイムアウトは原因が分かるメッセージ', async () => {
  const srv = createServer(() => {}); // 応答しない
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const f = createFetcher({ minIntervalMs: 0, retryWaitMs: 0, timeoutMs: 100, retries: 0 });
    await assert.rejects(f.text(`http://127.0.0.1:${srv.address().port}/`), /タイムアウト\(100ms\)/);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
