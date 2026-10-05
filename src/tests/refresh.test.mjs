// 自動更新（tools/refresh.mjs）の機械テスト。手順は差し替えた関数で動かし、ネットにもデスクトップのビューアにも出ない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { refresh, parseArgs, registeredCodes, lastDateOf, exitCodeOf, STOCK_GAP_MS } from '../tools/refresh.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

function makeData() {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-refresh-'));
  const w = (p, o) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), typeof o === 'string' ? o : JSON.stringify(o)); };
  w('stocks/1111/analyses/2026-10-01-quick.json', { type: 'quick' });
  w('stocks/1111/prices.json', { meta: {}, rows: [{ d: '2026-10-01', c: 1 }, { d: '2026-10-02', c: 2 }] });
  mkdirSync(join(dir, 'stocks/2222/analyses'), { recursive: true }); // 分析なし（対象外）
  w('stocks/2222/prices.json', { meta: {}, rows: [{ d: '2026-10-02', c: 2 }] });
  w('stocks/3333/analyses/2026-10-02-chart.json', { type: 'chart' });
  w('stocks/3333/analyses/memo.txt', 'x');
  w('stocks/4444/prices.json', { meta: {}, rows: [] }); // analyses フォルダなし（対象外）
  return dir;
}

/** 呼ばれた順を記録する偽の手順。fail に入れた手順は失敗、throws に入れた手順は例外 */
function fakeRunners({ fail = [], throws = [], onBuild } = {}) {
  const calls = [];
  const res = (k) => {
    calls.push(k);
    if (throws.includes(k)) throw new Error(`${k} で例外`);
    return { ok: !fail.includes(k), message: fail.includes(k) ? `${k} 失敗` : `${k} 成功` };
  };
  return {
    calls,
    runners: {
      market: async () => res('market'),
      stock: async (code) => res(`stock:${code}`),
      headlines: async () => res('headlines'),
      build: async () => { onBuild?.(); return res('build'); },
    },
  };
}
const quiet = { log: () => {} };
const clock = () => { let t = Date.parse('2026-10-04T22:21:00Z'); return () => new Date((t += 500)); };

test('registeredCodes: analyses に分析が1件以上ある銘柄だけ。lastDateOf は prices.json の最終日', () => {
  const dir = makeData();
  try {
    assert.deepEqual(registeredCodes(dir), ['1111', '3333']);
    assert.equal(lastDateOf(dir, '1111'), '2026-10-02');
    assert.equal(lastDateOf(dir, '3333'), null);
    assert.equal(lastDateOf(dir, '4444'), null);
    assert.deepEqual(registeredCodes(join(dir, 'nothing')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refresh 全部成功: 市場→登録銘柄（間は2秒以上）→見出し→build の順、refresh.json の形、exit 0', async () => {
  const dir = makeData();
  try {
    const f = fakeRunners();
    const waits = [];
    const lines = [];
    const { result, exitCode } = await refresh({ dataDir: dir, runners: f.runners, wait: async (ms) => waits.push(ms), log: (l) => lines.push(l), now: clock() });
    assert.equal(exitCode, 0);
    assert.deepEqual(f.calls, ['market', 'stock:1111', 'stock:3333', 'headlines', 'build']);
    assert.deepEqual(waits, [STOCK_GAP_MS]);
    assert.ok(STOCK_GAP_MS >= 2000);
    const saved = JSON.parse(readFileSync(join(dir, 'refresh.json'), 'utf8'));
    assert.deepEqual(saved, result);
    assert.equal(saved.at, '2026-10-04T22:21:00.500Z');
    assert.deepEqual(saved.steps.map((s) => [s.key, s.ok]), [['market', true], ['stocks', true], ['headlines', true], ['build', true]]);
    assert.ok(saved.steps.every((s) => typeof s.message === 'string' && typeof s.sec === 'number'));
    assert.deepEqual(saved.stocks, [
      { code: '1111', ok: true, lastDate: '2026-10-02', message: 'stock:1111 成功' },
      { code: '3333', ok: true, lastDate: null, message: 'stock:3333 成功' },
    ]);
    // 進み具合を1行ずつ（定時実行のログで読めるように）
    assert.ok(lines.some((l) => /1\/4 市場 OK/.test(l)) && lines.some((l) => /4\/4 build OK/.test(l)) && /exit 0/.test(lines.at(-1)), lines.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refresh 一部失敗: 市場の例外・1銘柄の失敗があっても残りを続け、exit 2', async () => {
  const dir = makeData();
  try {
    const f = fakeRunners({ throws: ['market'], fail: ['stock:1111'] });
    const { result, exitCode } = await refresh({ dataDir: dir, runners: f.runners, wait: async () => {}, ...quiet });
    assert.equal(exitCode, 2);
    assert.deepEqual(f.calls, ['market', 'stock:1111', 'stock:3333', 'headlines', 'build']);
    const st = Object.fromEntries(result.steps.map((s) => [s.key, s]));
    assert.equal(st.market.ok, false);
    assert.match(st.market.message, /例外: market で例外/);
    assert.equal(st.stocks.ok, false);
    assert.match(st.stocks.message, /2銘柄中1銘柄が失敗（1111）/);
    assert.equal(st.headlines.ok, true);
    assert.equal(st.build.ok, true);
    assert.deepEqual(result.stocks.map((s) => [s.code, s.ok]), [['1111', false], ['3333', true]]);
    assert.equal(result.stocks[0].lastDate, '2026-10-02'); // 失敗しても手元の最終日は書く
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refresh build 失敗: exit 1。build の前に refresh.json が書かれている（data.js に入れるため）', async () => {
  const dir = makeData();
  try {
    let pre = null;
    const f = fakeRunners({ fail: ['build', 'headlines'], onBuild: () => { pre = JSON.parse(readFileSync(join(dir, 'refresh.json'), 'utf8')); } });
    const { result, exitCode } = await refresh({ dataDir: dir, runners: f.runners, wait: async () => {}, ...quiet });
    assert.equal(exitCode, 1);
    assert.deepEqual(pre.steps.map((s) => s.key), ['market', 'stocks', 'headlines', 'build']);
    assert.equal(pre.steps[2].ok, false);
    const saved = JSON.parse(readFileSync(join(dir, 'refresh.json'), 'utf8'));
    assert.deepEqual(saved, result);
    assert.equal(saved.steps[3].ok, false);
    assert.equal(saved.steps[3].message, 'build 失敗');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refresh: 登録銘柄が無ければ銘柄の手順は成功扱い（収集しない）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-refresh-'));
  try {
    const f = fakeRunners();
    const { result, exitCode } = await refresh({ dataDir: dir, runners: f.runners, wait: async () => {}, ...quiet });
    assert.equal(exitCode, 0);
    assert.deepEqual(f.calls, ['market', 'headlines', 'build']);
    assert.match(result.steps[1].message, /登録銘柄なし/);
    assert.deepEqual(result.stocks, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exitCodeOf と引数: 知らない引数は例外（何も実行しない）', () => {
  assert.equal(exitCodeOf({ steps: [{ key: 'market', ok: true }, { key: 'build', ok: true }] }), 0);
  assert.equal(exitCodeOf({ steps: [{ key: 'market', ok: false }, { key: 'build', ok: true }] }), 2);
  assert.equal(exitCodeOf({ steps: [{ key: 'market', ok: false }, { key: 'build', ok: false }] }), 1);
  assert.deepEqual(parseArgs([]), { noViewer: false, data: null, viewer: null });
  assert.equal(parseArgs(['--no-viewer']).noViewer, true);
  assert.equal(parseArgs(['--data', '/tmp/x', '--viewer', '/tmp/v.html']).viewer, '/tmp/v.html');
  assert.throws(() => parseArgs(['--help']), /知らない引数 --help/);
  assert.throws(() => parseArgs(['now']), /知らない引数 now/);
  assert.throws(() => parseArgs(['--data']), /値がありません/);
  assert.throws(() => parseArgs(['--no-viewer', '--viewer', '/tmp/v.html']), /同時に/);
});

test('CLI: 知らない引数（--help）では実行せず exit 1（refresh.json も書かない）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-refresh-'));
  try {
    const r = spawnSync(process.execPath, ['tools/refresh.mjs', '--help'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, KABU_DATA_DIR: dir, KABU_VIEWER_PATH: join(dir, 'v.html') }, timeout: 20000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /知らない引数 --help/);
    assert.equal(existsSync(join(dir, 'refresh.json')), false);
    assert.equal(existsSync(join(dir, 'v.html')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
