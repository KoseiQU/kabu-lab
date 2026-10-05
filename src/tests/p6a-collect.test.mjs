// P6a（§5.10）の収集: 業種の動き・値上がり／値下がりの上位・注目候補の株価・digest の追記・refresh の一部失敗（ネットに出ない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SECTORS, SECTOR_CODES, pctOver, parseSectors, parseKabutanRanking, pickMovers, buildMovers, NON_STOCK_RE,
  pickCodes, chunkCodes, parsePicksPrices, KABUTAN_RANK_URL,
} from '../collect/lib/market-extra.mjs';
import { collectExtras, marketPaths, PARTIAL_PREFIX } from '../collect/market.mjs';
import { buildMarketDigest, MARKET_DIGEST_LIMIT, sectorDigest, moversDigest } from '../collect/lib/digest-market.mjs';
import { marketResult } from '../tools/refresh.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const SPARK = JSON.parse(fx('yahoo-spark-sectors-tail.json')); // 2026-10-05 の実応答（1617〜1633、各25点）
const UP = fx('kabutan-warning-up.html'), DOWN = fx('kabutan-warning-down.html'), MIXED = fx('kabutan-warning-mixed.html');
const NOW = new Date('2026-10-05T03:00:00Z');
const T0 = Date.UTC(2026, 8, 1, 0, 0) / 1000; // 2026-09-01 09:00 JST
/** 営業日に関係なく1日ずつの spark 1銘柄分 */
const sp = (closes) => ({ timestamp: closes.map((_, i) => T0 + i * 86400), close: closes });

test('SECTORS: 1617〜1633 の17業種・契約の名称', () => {
  assert.equal(SECTORS.length, 17);
  assert.deepEqual(SECTOR_CODES, Array.from({ length: 17 }, (_, i) => String(1617 + i)));
  assert.equal(SECTORS.find((s) => s.code === '1626').name, '情報通信・サービスその他');
  assert.equal(SECTORS.find((s) => s.code === '1632').name, '金融（除く銀行）');
  assert.equal(new Set(SECTORS.map((s) => s.key)).size, 17);
});

test('pctOver: n 営業日前の終値との比較（手計算）。足りなければ null', () => {
  const c = [100, 110, 99, 120, 80, 100, 105];
  assert.equal(pctOver(c, 1), 5); // 100→105
  assert.equal(pctOver(c, 5), -4.55); // 110→105 = -4.545…
  assert.equal(pctOver(c, 6), 5); // 100→105
  assert.equal(pctOver(c, 7), null);
  assert.equal(pctOver([0, 5], 1), null);
  assert.equal(pctOver(null, 1), null);
});

test('parseSectors: 保存した実応答から17業種・1日／1週／1か月（データ不足は null）', () => {
  const s = parseSectors(SPARK, NOW);
  assert.equal(s.items.length, 17);
  assert.equal(s.asOf, '2026-10-05');
  assert.deepEqual(s.missing, []);
  const raw = SPARK['1625.T'].close.filter((x) => x != null);
  const it = s.items.find((x) => x.code === '1625');
  assert.equal(it.close, raw.at(-1));
  assert.equal(it.d1, Math.round(((raw.at(-1) - raw.at(-2)) / raw.at(-2)) * 1e4) / 100);
  assert.equal(it.w1, Math.round(((raw.at(-1) - raw.at(-6)) / raw.at(-6)) * 1e4) / 100);
  assert.equal(it.m1, Math.round(((raw.at(-1) - raw.at(-22)) / raw.at(-22)) * 1e4) / 100);
  for (const x of s.items) for (const k of ['d1', 'w1', 'm1']) assert.equal(typeof x[k], 'number', `${x.code} ${k}`);
  // 足りない業種: 3点しか無い → 1日だけ。応答に無い業種は行を残して null・missing
  const s2 = parseSectors({ '1617.T': sp([100, 102, 101]), '1618.T': sp([50]) }, NOW);
  assert.equal(s2.items.length, 17);
  const f = s2.items[0];
  assert.deepEqual([f.d1, f.w1, f.m1], [-0.98, null, null]);
  assert.deepEqual([s2.items[1].close, s2.items[1].d1], [50, null]);
  assert.equal(s2.items[2].close, null);
  assert.equal(s2.missing.length, 15);
  assert.ok(s2.missing[0].includes('1619'));
});

test('parseKabutanRanking: 保存した株探の表から日付・時刻・行（コード・名前・市場・株価・騰落率）', () => {
  const u = parseKabutanRanking(UP);
  assert.equal(u.asOf, '2026-10-05');
  assert.equal(u.time, '11:53');
  assert.equal(u.rows.length, 15);
  assert.deepEqual(u.rows[0], { code: '6762', name: 'TDK', market: '東Ｐ', close: 3455, change: 257, pct: 8.04 });
  const d = parseKabutanRanking(DOWN);
  assert.deepEqual(d.rows[0], { code: '8798', name: 'Aクリエイト', market: '東Ｐ', close: 68, change: -20, pct: -22.73 });
  assert.throws(() => parseKabutanRanking('<html>no table</html>'), /見つからない/);
  assert.throws(() => parseKabutanRanking(UP.replace('<th scope="col" class="w38">市場</th>', '<th>出来高</th>')), /列が想定と違う/);
});

test('pickMovers/buildMovers: 東証プライムの株式だけ上位10件。ETF・他市場・向きの違う行は除く。0件なら例外', () => {
  const m = buildMovers(UP, DOWN, NOW);
  assert.equal(m.up.length, 10);
  assert.equal(m.down.length, 10);
  assert.equal(m.asOf, '2026-10-05');
  assert.ok(m.up.every((x, i) => x.pct > 0 && (i === 0 || x.pct <= m.up[i - 1].pct)));
  assert.ok(m.down.every((x) => x.pct < 0));
  assert.deepEqual(Object.keys(m.up[0]), ['code', 'name', 'pct', 'close']);
  assert.equal(m.source.url, KABUTAN_RANK_URL('2_1'));
  // 絞り込みなしの表（名Ｎ・東Ｅ・東Ｇ・東Ｓ）からはプライムが0件
  const mixed = parseKabutanRanking(MIXED);
  assert.ok(mixed.rows.some((r) => r.market === '東Ｅ'));
  assert.deepEqual(pickMovers(mixed.rows, 'up'), []);
  assert.throws(() => buildMovers(MIXED, MIXED, NOW), /1件も読めなかった/);
  // 名前で ETF・REIT・優先株を除く
  const rows = [
    { code: '1306', name: 'TOPIX連動型上場投信', market: '東Ｐ', pct: 3, close: 1 },
    { code: '8951', name: '日本ビルファンド投資法人', market: '東Ｐ', pct: 2, close: 1 },
    { code: '1234', name: '普通の会社', market: '東Ｐ', pct: 1, close: null },
    { code: '1235', name: '下がった会社', market: '東Ｐ', pct: -1, close: 5 },
  ];
  assert.deepEqual(pickMovers(rows, 'up').map((r) => r.code), ['1234']);
  assert.deepEqual(pickMovers(rows, 'down').map((r) => r.code), ['1235']);
  assert.ok(NON_STOCK_RE.test('ＮＦ 日経ＥＴＦ'.normalize('NFKC')));
});

test('pickCodes: 直近60日の市場分析の themes のコード（新しい分析から・重複なし・形の不正は除く）', () => {
  const an = (date, codes) => ({ type: 'market', date, sections: { themes: [{ stocks: codes.map((c) => ({ code: c })) }, { stocks: [] }] } });
  const list = [an('2026-08-01', ['1111']), an('2026-08-10', ['2222', '3333']), an('2026-10-05', ['3333', '4444', 'bad', '55555']), an('2026-10-06', ['9999']), { type: 'market', date: '2026-10-01', sections: {} }];
  assert.deepEqual(pickCodes(list, '2026-10-05'), ['3333', '4444', '2222']); // 8/1 は61日前で対象外・未来の日付も除く
  assert.deepEqual(pickCodes([], '2026-10-05'), []);
  assert.deepEqual(pickCodes(null, '2026-10-05'), []);
});

test('chunkCodes/parsePicksPrices: 20銘柄ずつ最大2回。応答に無いコード・上限超えは missing（落とさない）', () => {
  const codes = Array.from({ length: 45 }, (_, i) => String(1000 + i));
  const { chunks, over } = chunkCodes(codes);
  assert.deepEqual(chunks.map((c) => c.length), [20, 20]);
  assert.equal(over.length, 5);
  const pp = parsePicksPrices([{ '6501.T': sp([10, 11, null, 12]) }, { '7013.T': sp([5]) }], ['6501', '7013', '0000'], { over: ['1111'], now: NOW });
  assert.deepEqual(pp.prices['6501'].rows.map((r) => r.c), [10, 11, 12]);
  assert.deepEqual(pp.prices['7013'].rows.map((r) => r.c), [5]);
  assert.deepEqual(pp.missing.map((m) => m.code), ['0000', '1111']);
  assert.match(pp.missing[1].reason, /上限/);
  assert.deepEqual(pp.codes, ['6501', '7013', '0000', '1111']);
});

/** 偽の fetcher（呼ばれた URL を記録。fail に合う URL は例外） */
function fakeFetcher({ fail = [] } = {}) {
  const calls = [];
  const hit = (u) => { calls.push(u); if (fail.some((f) => u.includes(f))) throw new Error(`HTTP 500: ${u}`); };
  return {
    calls,
    async json(u) {
      hit(u);
      if (u.includes('1617.T')) return SPARK;
      const syms = decodeURIComponent(u.split('symbols=')[1].split('&')[0]).split(',');
      return Object.fromEntries(syms.filter((s) => s !== '0000.T').map((s) => [s, sp([100, 101, 102])]));
    },
    async text(u) { hit(u); return u.includes('2_1') ? UP : DOWN; },
  };
}
const themesAn = (date, n) => ({ type: 'market', date, sections: { themes: [{ stocks: Array.from({ length: n }, (_, i) => ({ code: String(2000 + i) })) }, { stocks: [{ code: '0000' }] }] } });

test('collectExtras: Yahoo は業種1回＋候補0〜2回（市場の1回と合わせて4回以内）、株探2回。3つのファイルを書く', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-p6a-'));
  try {
    const f = fakeFetcher();
    const ex = await collectExtras({ fetcher: f, dataDir: dir, now: NOW, analyses: [themesAn('2026-10-05', 30)] });
    const yahoo = f.calls.filter((u) => u.includes('yahoo')), kab = f.calls.filter((u) => u.includes('kabutan'));
    assert.equal(yahoo.length, 3, '業種1＋候補2（31銘柄）');
    assert.ok(1 + yahoo.length <= 4);
    assert.equal(kab.length, 2);
    assert.ok(yahoo[0].includes('range=3mo'));
    assert.deepEqual(ex.failures, []);
    const p = marketPaths(dir, NOW);
    for (const k of ['sectors', 'movers', 'picks']) assert.ok(existsSync(p[k]), k);
    assert.equal(Object.keys(ex.picks.prices).length, 30);
    assert.deepEqual(ex.picks.missing.map((m) => m.code), ['0000']);
    // 候補が0件なら候補の取得はしない（ファイルも書かない）
    const f2 = fakeFetcher();
    const dir2 = mkdtempSync(join(tmpdir(), 'kabu-p6a-'));
    const ex2 = await collectExtras({ fetcher: f2, dataDir: dir2, now: NOW, analyses: [] });
    assert.equal(f2.calls.filter((u) => u.includes('yahoo')).length, 1);
    assert.equal(ex2.picks, null);
    assert.ok(!existsSync(marketPaths(dir2, NOW).picks));
    rmSync(dir2, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectExtras: 業種・上位が失敗しても例外にせず failures に積む（他は続ける）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-p6a-'));
  try {
    const f = fakeFetcher({ fail: ['1617.T', 'mode=2_2'] });
    const ex = await collectExtras({ fetcher: f, dataDir: dir, now: NOW, analyses: [themesAn('2026-10-01', 2)] });
    assert.deepEqual(ex.failures.map((x) => x.key), ['sectors', 'movers']);
    assert.equal(ex.sectors, null);
    assert.equal(ex.movers, null);
    assert.equal(Object.keys(ex.picks.prices).length, 2, '候補の株価は取れる');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('digest-market: 業種（17・1日の順）と上位（各10）を足しても6KB以内。未取得は「未取得」と理由', () => {
  const sectors = parseSectors(SPARK, NOW), movers = buildMovers(UP, DOWN, NOW);
  // 2年分の長い系列でも
  const rows = Array.from({ length: 500 }, (_, i) => ({ d: new Date(Date.UTC(2024, 9, 1) + i * 864e5).toISOString().slice(0, 10), c: 30000 + i * 7.123 }));
  const series = { series: { '^N225': { key: 'nikkei225', name: '日経平均', unit: '円', rows }, 'JPY=X': { key: 'usdjpy', name: 'ドル円', unit: '円', rows: rows.map((r) => ({ d: r.d, c: r.c / 200 })) }, '^TNX': { key: 'us10y', name: '米10年金利', unit: '%', rows: rows.map((r) => ({ d: r.d, c: 4 })) } } };
  const raw = { source: { title: 'x' }, items: { nikkei225: { name: '日経平均', unit: '円', value: 1, change: 1, changePct: 1, asOf: '2026-10-05' } }, missing: [] };
  const t = buildMarketDigest({ raw, series, sectors, movers, generatedAt: NOW.toISOString() });
  assert.equal(MARKET_DIGEST_LIMIT, 6144);
  assert.ok(Buffer.byteLength(t) <= MARKET_DIGEST_LIMIT, `${Buffer.byteLength(t)} bytes`);
  assert.ok(!/NaN|undefined|null/.test(t));
  const sec = t.slice(t.indexOf('## 業種の騰落率'), t.indexOf('## 値上がり'));
  const lines = sec.split('\n').filter((l) => /^\| 16\d\d /.test(l));
  assert.equal(lines.length, 17);
  const d1 = lines.map((l) => Number(l.split('|')[3].replace(/[%+\s]/g, '')));
  assert.deepEqual(d1, [...d1].sort((a, b) => b - a), '1日の騰落率順');
  assert.match(t, /値上がり率:\n1\. 6762 TDK \+8\.04%/);
  assert.match(t, /値下がり率:\n1\. 8798 Aクリエイト -22\.73%/);
  assert.equal((t.match(/^\d+\. /gm) || []).length, 20);
  assert.match(t, /直近\d+営業日の終値/);
  // 未取得
  assert.match(sectorDigest({ error: 'HTTP 500' }), /未取得（HTTP 500）/);
  assert.match(moversDigest(null), /未取得$/);
  const t2 = buildMarketDigest({ raw, series: null });
  assert.match(t2, /## 業種の騰落率[^\n]*\n未取得/);
  assert.match(t2, /## 値上がり・値下がりの上位[^\n]*\n未取得/);
});

test('refresh の市場の手順: exit 0 でも「一部未取得」の行があれば一部失敗（message に何が取れなかったか）', () => {
  const ok = marketResult({ code: 0, stdout: '日経平均 70000円（+1 / 0.1%）2026-10-05\n業種の動き: 17/17業種\n', stderr: '' });
  assert.deepEqual(ok, { ok: true, message: '日経平均 70000円（+1 / 0.1%）2026-10-05' });
  const part = marketResult({ code: 0, stdout: `日経平均 1\n${PARTIAL_PREFIX}値上がり・値下がりの上位（HTTP 503）\n`, stderr: '' });
  assert.equal(part.ok, false);
  assert.match(part.message, /指数・為替は更新。一部未取得: 値上がり・値下がりの上位（HTTP 503）/);
  const ng = marketResult({ code: 1, stdout: '', stderr: 'エラー: 市場データの取得に失敗しました: x\n' });
  assert.equal(ng.ok, false);
  assert.match(ng.message, /市場データの取得に失敗/);
});
