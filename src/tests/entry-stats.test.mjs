// tools/entry-stats.mjs（反省型の材料）: 手計算で答えが分かる小さな系列で検証
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { entryStats, formatEntryStats, alignEntryDate, EntryRangeError, ENTRY_STATS_LIMIT } from '../tools/entry-stats.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** 2026-01-05(月) から平日だけ30本。終値 100+i、高値 +2、安値 -2。10本目と20本目は安値90（同じ値） */
function makeRows() {
  const rows = [];
  let t = Date.UTC(2026, 0, 5);
  while (rows.length < 30) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const i = rows.length, c = 100 + i;
      rows.push({ d: new Date(t).toISOString().slice(0, 10), o: c, h: c + 2, l: i === 10 || i === 20 ? 90 : c - 2, c, v: 1000 });
    }
    t += 86400000;
  }
  return rows;
}
const ROWS = makeRows();

test('休場日は翌営業日に寄せる・範囲外は EntryRangeError', () => {
  assert.equal(ROWS[5].d, '2026-01-12');
  assert.deepEqual(alignEntryDate(ROWS, '2026-01-10'), { index: 5, date: '2026-01-12', adjusted: true }); // 土曜
  assert.deepEqual(alignEntryDate(ROWS, '2026-01-12'), { index: 5, date: '2026-01-12', adjusted: false });
  assert.throws(() => alignEntryDate(ROWS, '2026-01-04'), EntryRangeError);
  assert.throws(() => alignEntryDate(ROWS, ROWS.at(-1).d.replace(/\d\d$/, (x) => String(Number(x) + 1).padStart(2, '0'))), /より後/);
  assert.throws(() => alignEntryDate(ROWS, '2026/01/12'), /形式が不正/);
  assert.throws(() => entryStats(ROWS, '2026-01-12', 0), /購入価格が不正/);
});

test('購入後の最大含み益・含み損（翌営業日以降の高値・安値、同じ値なら早い日）・損益率・経過日数', () => {
  const s = entryStats(ROWS, '2026-01-10', 105);
  assert.equal(s.entry.adjusted, true);
  assert.deepEqual(s.day, { o: 105, h: 107, l: 103, c: 105, v: 1000 });
  assert.equal(s.inRange, true);
  assert.equal(s.rangePos, 0.5);
  assert.equal(s.result.days, 24);
  assert.equal(s.result.asOf, ROWS[29].d);
  assert.equal(s.result.close, 129);
  assert.equal(s.result.pnlPct, 22.86); // (129-105)/105
  assert.equal(s.result.maxUpPct, 24.76); // 最終日の高値131
  assert.equal(s.result.maxUpDate, ROWS[29].d);
  assert.equal(s.result.maxDownPct, -14.29); // 安値90
  assert.equal(s.result.maxDownDate, ROWS[10].d); // 20本目も90だが早い日
  assert.equal(s.heat.change3d, 2.94); // (105-102)/102
  assert.equal(s.heat.ma25dev, null); // 25本に足りない
});

test('買った日の物差しと移動平均・直前のスイング', () => {
  const s = entryStats(ROWS, ROWS[25].d, 125);
  // 25日線 = 101..125 の平均 113、乖離 (125-113)/113
  const m25 = s.ma.find((m) => m.n === 25);
  assert.equal(m25.value, 113);
  assert.equal(m25.closeDevPct, 10.62);
  assert.equal(s.heat.ma25dev, 10.62);
  assert.equal(s.ma.find((m) => m.n === 75).value, null);
  assert.deepEqual(s.ma.map((m) => m.n), [25, 75, 200]);
  assert.equal(s.heat.volume, 1);
  assert.equal(s.heat.rsi > 50, true);
  assert.deepEqual(s.swingLow, { d: ROWS[20].d, price: 90, fromPricePct: -28 });
  assert.equal(s.swingHigh, null); // 一直線に上がる系列に高値の山はない
});

test('値幅の外の価格は警告・最終日に買ったら含み益・含み損は無い', () => {
  const s = entryStats(ROWS, ROWS[5].d, 110);
  assert.equal(s.inRange, false);
  const md = formatEntryStats(s, { code: '9999', name: 'テスト' });
  assert.match(md, /警告: 購入価格 110円 はその日の値幅 103〜107円 の外/);
  const last = entryStats(ROWS, ROWS[29].d, 129);
  assert.equal(last.result.days, 0);
  assert.equal(last.result.maxUpPct, null);
  assert.equal(last.result.maxDownDate, null);
  assert.match(formatEntryStats(last, { code: '9999' }), /購入日が最終取引日のため、まだ無い/);
});

test('md: 必要な項目がそろい 2KB 以内・NaN なし', () => {
  const md = formatEntryStats(entryStats(ROWS, '2026-01-10', 105), { code: '9999', name: 'テスト' });
  assert.ok(Buffer.byteLength(md) <= ENTRY_STATS_LIMIT);
  for (const k of ['休場日のため、翌営業日 2026-01-12 に寄せた', '四本値', 'ma25dev', 'RSI(14)', '直近3日の騰落率', '出来高 前20日平均比', '| 25日 |', '| 200日 |', '直前のスイング', '経過営業日数 24', '損益率 +22.86%', '最大含み益 +24.76%', '最大含み損 -14.29%']) {
    assert.ok(md.includes(k), k);
  }
  assert.ok(!/NaN|undefined/.test(md));
});

test('CLI: 範囲外は exit 1、範囲内は md を出す（KABU_DATA_DIR の日足を使う）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-entry-'));
  try {
    mkdirSync(join(dir, 'stocks', '9999'), { recursive: true });
    writeFileSync(join(dir, 'stocks', '9999', 'prices.json'), JSON.stringify({ meta: { code: '9999', name: 'テスト', asOf: ROWS[29].d }, rows: ROWS }));
    const run = (...a) => spawnSync(process.execPath, [join(ROOT, 'tools/entry-stats.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, KABU_DATA_DIR: dir } });
    const ok = run('9999', '2026-01-10', '105');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /# 9999 テスト entry-stats（購入 2026-01-12 105円）/);
    const before = run('9999', '2025-12-31', '105');
    assert.equal(before.status, 1);
    assert.match(before.stderr, /より前です/);
    const after = run('9999', '2026-03-31', '105');
    assert.equal(after.status, 1);
    assert.match(after.stderr, /より後です/);
    assert.equal(run('9999', '2026-01-10').status, 1); // 価格なし
    assert.equal(run('8888', '2026-01-10', '105').status, 1); // prices.json なし
    assert.equal(run('9999', '2026-01-10', '1,050円').status, 0); // 「1,050円」の表記も受け付ける
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
