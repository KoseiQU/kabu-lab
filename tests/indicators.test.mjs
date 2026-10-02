import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sma, deviationPct, rsi, volumeRatio, swings, binStep, volumeProfile, gaps, crosses, priceCrosses, high52, computeAll,
} from '../collect/lib/indicators.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const bar = (d, c, extra = {}) => ({ d, o: c, h: c, l: c, c, v: 100, ...extra });
const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);

test('sma: 手計算と一致し、足りない位置は null', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(sma([10, 20], 5), [null, null]);
});

test('deviationPct: (価格−MA)/MA×100', () => {
  close(deviationPct(110, 100), 10);
  close(deviationPct(95, 100), -5);
  assert.equal(deviationPct(100, null), null);
});

test('rsi: 単調上昇=100、単調下降=0、手計算（Wilder）', () => {
  assert.equal(rsi([1, 2, 3, 4, 5], 2).at(-1), 100);
  assert.equal(rsi([5, 4, 3, 2, 1], 2).at(-1), 0);
  // n=2: 差分 +2, -1 → ag=1, al=0.5 → RSI=66.67。次の差分 +1 → ag=(1*1+1)/2=1, al=(0.5*1+0)/2=0.25 → 80
  const r = rsi([10, 12, 11, 12], 2);
  assert.deepEqual(r.slice(0, 2), [null, null]);
  close(r[2], 100 - 100 / (1 + 1 / 0.5));
  close(r[3], 80);
});

test('volumeRatio: 最終日 ÷ 前20日平均', () => {
  const rows = Array.from({ length: 21 }, (_, i) => bar(day(i), 100, { v: i === 20 ? 300 : 100 }));
  close(volumeRatio(rows, 20), 3);
  assert.equal(volumeRatio(rows.slice(0, 10), 20), null);
});

test('swings: 前後k日の山と谷を検出（端は対象外）', () => {
  const hs = [1, 2, 3, 9, 3, 2, 1, 2, 3, 2, 1];
  const ls = [5, 4, 3, 2, 3, 4, 0, 4, 3, 4, 5];
  const rows = hs.map((h, i) => ({ d: day(i), o: h, h, l: ls[i], c: h, v: 1 }));
  const s = swings(rows, { k: 2, lookback: 250 });
  assert.deepEqual(s.highs, [{ d: day(3), price: 9 }, { d: day(8), price: 3 }]);
  assert.deepEqual(s.lows, [{ d: day(3), price: 2 }, { d: day(6), price: 0 }]);
});

test('binStep: 終値の約2%を1・2・5刻みに丸める', () => {
  assert.equal(binStep(5510), 100); // 110 → 100
  assert.equal(binStep(2202), 50); // 44 → 50
  assert.equal(binStep(4769), 100); // 95 → 100
  assert.equal(binStep(1000), 20);
});

test('volumeProfile: 高安の重なりに比例して配分', () => {
  const rows = [
    { d: day(0), o: 100, h: 120, l: 100, c: 110, v: 200 }, // 100-110: 100, 110-120: 100
    { d: day(1), o: 105, h: 105, l: 105, c: 105, v: 50 }, // 高安が同じ → 終値の帯
  ];
  const vp = volumeProfile(rows, { step: 10 });
  assert.equal(vp.step, 10);
  assert.deepEqual(vp.bins.map((b) => [b.from, b.volume]), [[100, 150], [110, 100], [120, 0]]);
  close(vp.bins.reduce((s, b) => s + b.share, 0), 100, 0.11);
});

test('gaps: 1.5%以上の上窓・下窓と窓埋め', () => {
  const rows = [
    { d: day(0), o: 100, h: 100, l: 98, c: 99, v: 1 },
    { d: day(1), o: 103, h: 104, l: 102, c: 103, v: 1 }, // 上窓 100→102 (+2%)
    { d: day(2), o: 103, h: 103, l: 101, c: 102, v: 1 }, // まだ埋めない
    { d: day(3), o: 101, h: 101, l: 100.5, c: 101, v: 1 }, // 上窓 +0.5% 未満の判定なし（窓でもない）
    { d: day(4), o: 98, h: 99, l: 97, c: 98, v: 1 }, // 下窓 100.5→99 (-1.49%) は閾値未満。かつ安値97で上窓を埋める
  ];
  const g = gaps(rows, { thresholdPct: 1.5 });
  assert.equal(g.length, 1);
  assert.deepEqual({ ...g[0] }, { d: day(1), dir: 'up', from: 100, to: 102, pct: 2, filled: true });
  const g2 = gaps(rows.slice(0, 3), { thresholdPct: 1.5 });
  assert.equal(g2[0].filled, false);
  const down = gaps([{ d: day(0), o: 100, h: 101, l: 100, c: 100, v: 1 }, { d: day(1), o: 97, h: 98, l: 96, c: 97, v: 1 }]);
  assert.equal(down[0].dir, 'down');
  close(down[0].pct, -2);
});

test('crosses: GC/DC の発生日（等しい日を経由しても1回）', () => {
  const dates = [day(0), day(1), day(2), day(3), day(4)];
  const s = [1, 2, 3, 3, 1];
  const l = [2, 2, 2, 3, 2];
  assert.deepEqual(crosses(s, l, dates), [{ d: day(2), type: 'GC' }, { d: day(4), type: 'DC' }]);
  assert.deepEqual(crosses([null, 1, 3], [null, 2, 2], dates), [{ d: day(2), type: 'GC' }]);
});

test('priceCrosses: 終値の移動平均上抜け・下抜け', () => {
  assert.deepEqual(priceCrosses([9, 11, 8], [10, 10, 10], [day(0), day(1), day(2)]), [
    { d: day(1), dir: 'up' },
    { d: day(2), dir: 'down' },
  ]);
});

test('high52: 最終日から365日以内の高値・安値', () => {
  const rows = [
    { d: '2025-01-01', o: 1, h: 999, l: 1, c: 1, v: 1 }, // 範囲外
    { d: '2025-06-01', o: 5, h: 50, l: 4, c: 5, v: 1 },
    { d: '2026-01-01', o: 5, h: 30, l: 10, c: 20, v: 1 },
  ];
  assert.deepEqual(high52(rows), { high: 50, highDate: '2025-06-01', low: 4, lowDate: '2025-06-01' });
});

test('computeAll: 300本で全項目がそろい NaN を含まない', () => {
  const rows = Array.from({ length: 300 }, (_, i) => {
    const c = 1000 + 100 * Math.sin(i / 15) + i;
    return { d: day(i), o: c - 5, h: c + 10, l: c - 10, c, v: 1000 + (i % 7) * 100 };
  });
  const a = computeAll(rows);
  assert.equal(a.ma.length, 4);
  assert.ok(a.ma.every((m) => Number.isFinite(m.value) && Number.isFinite(m.deviationPct)));
  close(a.ma[0].value, Math.round((rows.slice(-5).reduce((s, r) => s + r.c, 0) / 5) * 10) / 10, 1e-6);
  assert.ok(a.rsi14 >= 0 && a.rsi14 <= 100);
  assert.equal(a.last20.length, 20);
  assert.ok(a.swings.highs.length > 0 && a.swings.lows.length > 0);
  assert.ok(!JSON.stringify(a).includes('NaN'));
  assert.ok(a.crosses.every((c) => Array.isArray(c.events)));
});
