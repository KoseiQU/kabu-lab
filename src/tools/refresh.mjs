// 自動更新の第1層（DESIGN.md §5.9。トークン0）: 市場 → 登録銘柄 → 見出し → build を順に実行する。
// 使い方（src で実行）: node tools/refresh.mjs [--no-viewer] [--data <dataDir>] [--viewer <path>]
//   1. 市場の収集（node collect/market.mjs。業種・上位・候補の株価を含む。それらが取れなければ「一部未取得」で一部失敗）
//   2. 登録銘柄（data/stocks/<code>/analyses/ に分析が1件以上ある銘柄）の株価と銘柄情報（node collect/run.mjs <code> --if-stale）。銘柄の間は2秒以上あける
//   3. 見出しの収集（collect/headlines.mjs の runHeadlines）
//   4. build（node build.mjs。--no-viewer でビューアを省く。--data を付けたときは --viewer を明示しない限りビューアを書き換えない）
// どれかが失敗しても残りを続け、結果を data/refresh.json に書く（build の前に一度書き、build の結果で書き直す）。
// exit code: 全部成功 0 ／ 一部失敗 2 ／ build 失敗 1（知らない引数も 1。何も実行しない）。
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, isMain, writeJson } from '../collect/lib/util.mjs';
import { runHeadlines } from '../collect/headlines.mjs';
import { PARTIAL_PREFIX } from '../collect/market.mjs';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STOCK_GAP_MS = 2000;
export const CHILD_TIMEOUT_MS = 180000;
export const STEP_LABEL = { market: '市場', stocks: '登録銘柄', headlines: '見出し', build: 'build' };
export const USAGE = '使い方: node tools/refresh.mjs [--no-viewer] [--data <dataDir>] [--viewer <path>]';

/** 引数を読む。知らない引数・値の無い --data/--viewer は例外（何も実行しないため） */
export function parseArgs(argv) {
  const out = { noViewer: false, data: null, viewer: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-viewer') out.noViewer = true;
    else if (a === '--data' || a === '--viewer') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} の値がありません`);
      out[a === '--data' ? 'data' : 'viewer'] = resolve(v);
    } else throw new Error(`知らない引数 ${a}`);
  }
  if (out.noViewer && out.viewer) throw new Error('--no-viewer と --viewer は同時に指定できません');
  return out;
}

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

/** 登録銘柄: data/stocks/<code>/analyses/ に分析（*.json）が1件以上ある銘柄（コード順） */
export function registeredCodes(dataDir = DATA_DIR) {
  const sd = join(dataDir, 'stocks');
  if (!isDir(sd)) return [];
  return readdirSync(sd).sort().filter((c) => {
    const ad = join(sd, c, 'analyses');
    return isDir(ad) && readdirSync(ad).some((f) => f.endsWith('.json'));
  });
}

/** prices.json の最終日（無い・読めないときは null） */
export function lastDateOf(dataDir, code) {
  try {
    const p = JSON.parse(readFileSync(join(dataDir, 'stocks', code, 'prices.json'), 'utf8'));
    const rows = Array.isArray(p?.rows) ? p.rows : [];
    return rows.length && typeof rows.at(-1).d === 'string' ? rows.at(-1).d : null;
  } catch {
    return null;
  }
}

/** exit code: build 失敗 1 ／ ほかに失敗あり 2 ／ 全部成功 0 */
export function exitCodeOf(result) {
  const steps = result?.steps ?? [];
  if (steps.some((s) => s.key === 'build' && !s.ok)) return 1;
  return steps.some((s) => !s.ok) ? 2 : 0;
}

const hhmmss = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 19);
const sec = (ms) => Math.round(ms / 100) / 10;
const oneLine = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** 子プロセスで node <script> を実行し {code, stdout, stderr} を返す（タイムアウトで kill） */
export function runNode(script, args = [], { env = {}, timeoutMs = CHILD_TIMEOUT_MS } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(SRC, script), ...args], { cwd: SRC, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', (e) => { clearTimeout(timer); done({ code: 1, stdout, stderr: `${stderr}\n起動できません: ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code: killed ? 1 : code ?? 1, stdout, stderr: killed ? `${stderr}\nタイムアウト（${timeoutMs / 1000}秒）で中断しました` : stderr });
    });
  });
}
/**
 * 市場の手順の結果（P6a）: exit 0 でも「一部未取得: …」の行があれば一部失敗（業種・上位・候補のどれかが取れなかった）。
 * 指数・為替の収集は成功しているので、message に日経平均の行と取れなかったものを両方書く
 */
export function marketResult(r) {
  if (r.code !== 0) return { ok: false, message: errLine(r) };
  const lines = r.stdout.split('\n');
  const nk = lines.find((l) => l.startsWith('日経平均'));
  const part = lines.find((l) => l.startsWith(PARTIAL_PREFIX));
  if (part) return { ok: false, message: oneLine(`指数・為替は更新。${part}`) };
  return { ok: true, message: oneLine(nk || '市場データを更新') };
}
const errLine = (r) => oneLine(r.stderr.split('\n').filter((l) => l.trim()).map((l) => l.replace(/^エラー:\s*/, '')).join(' ／ ') || `exit ${r.code}`);

/**
 * 既定の手順（子プロセスと runHeadlines）。dataDir は環境変数 KABU_DATA_DIR で子へ渡す。
 * customData: --data を指定したとき（build にも --data を渡す＝--viewer を明示しない限りビューアを書き換えない）
 */
export function defaultRunners({ dataDir = DATA_DIR, customData = false, noViewer = false, viewer = null, log = () => {} } = {}) {
  const env = { KABU_DATA_DIR: dataDir };
  const echo = (r) => r.stdout.split('\n').filter((l) => l.trim()).forEach((l) => log(`    │ ${l}`));
  return {
    async market() {
      const r = await runNode('collect/market.mjs', [], { env });
      echo(r);
      return marketResult(r);
    },
    async stock(code) {
      const r = await runNode('collect/run.mjs', [code, '--if-stale'], { env });
      echo(r);
      if (r.code !== 0) return { ok: false, message: errLine(r) };
      return { ok: true, message: r.stdout.includes('収集を省略') ? '最新のため収集を省略' : '株価・銘柄情報・digest を更新' };
    },
    async headlines() {
      const r = await runHeadlines({ dataDir });
      r.data.sources.forEach((s) => log(`    │ ${s.ok ? 'OK' : 'NG'} ${s.name}: ${s.ok ? `${s.count}件` : s.message}`));
      const failed = r.data.sources.filter((s) => !s.ok);
      return { ok: r.ok && !failed.length, message: r.message };
    },
    async build() {
      const args = [...(customData ? ['--data', dataDir] : []), ...(viewer ? ['--viewer', viewer] : []), ...(noViewer ? ['--no-viewer'] : [])];
      const r = await runNode('build.mjs', args, { env });
      echo(r);
      r.stderr.split('\n').filter((l) => l.trim()).forEach((l) => log(`    │ ${l}`));
      if (r.code !== 0) return { ok: false, message: errLine(r) };
      if (/ビューアを書き出せませんでした/.test(r.stderr)) return { ok: false, message: oneLine(r.stderr.split('\n').find((l) => /ビューア/.test(l))) };
      const wroteViewer = /^ビューア: /m.test(r.stdout);
      return { ok: true, message: wroteViewer ? 'data.js とビューアを作り直し' : 'data.js を作り直し（ビューアは書き換えず）' };
    },
  };
}

/** 1手順を実行（例外も失敗として受け止める） */
async function attempt(fn) {
  try {
    const r = (await fn()) ?? {};
    return { ok: r.ok === true, message: oneLine(r.message ?? '') };
  } catch (e) {
    return { ok: false, message: oneLine(`例外: ${e?.message ?? e}`) };
  }
}

/**
 * 4手順を実行して data/refresh.json を書く。runners を差し替えるとネットにもデスクトップにも出ない（テスト用）。
 * 返り値 { result: refresh.json の中身, exitCode }
 */
export async function refresh({ dataDir = DATA_DIR, runners, log = console.log, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date(), stockGapMs = STOCK_GAP_MS } = {}) {
  const R = runners ?? defaultRunners({ dataDir, log });
  const t0 = now();
  const result = { at: t0.toISOString(), finishedAt: null, steps: [], stocks: [] };
  const path = join(dataDir, 'refresh.json');
  const step = async (key, i, fn) => {
    const s = now();
    log(`[${hhmmss(s)}] ${i}/4 ${STEP_LABEL[key]} …`);
    const r = await fn();
    const e = { key, ok: r.ok, message: r.message, sec: sec(now() - s) };
    log(`[${hhmmss(now())}] ${i}/4 ${STEP_LABEL[key]} ${r.ok ? 'OK' : 'NG'}（${e.sec}秒）${r.message ? ' ' + r.message : ''}`);
    return e;
  };

  log(`自動更新を開始（データ: ${dataDir}）`);
  result.steps.push(await step('market', 1, () => attempt(() => R.market())));

  const codes = registeredCodes(dataDir);
  result.steps.push(await step('stocks', 2, async () => {
    if (!codes.length) return { ok: true, message: '登録銘柄なし（分析が1件以上ある銘柄が対象）' };
    for (let i = 0; i < codes.length; i++) {
      if (i > 0 && stockGapMs > 0) await wait(stockGapMs);
      const code = codes[i];
      const r = await attempt(() => R.stock(code));
      const e = { code, ok: r.ok, lastDate: lastDateOf(dataDir, code), message: r.message };
      result.stocks.push(e);
      log(`    ${code} ${r.ok ? 'OK' : 'NG'} 最終日 ${e.lastDate ?? '—'}${r.message ? ' ' + r.message : ''}`);
    }
    const bad = result.stocks.filter((x) => !x.ok);
    return { ok: !bad.length, message: bad.length ? `${codes.length}銘柄中${bad.length}銘柄が失敗（${bad.map((x) => x.code).join('・')}）` : `${codes.length}銘柄（${codes.join('・')}）` };
  }));

  result.steps.push(await step('headlines', 3, () => attempt(() => R.headlines())));

  // build の前に一度書く（data.js に refresh を入れるため）。build の手順は成功した前提で書き、結果で書き直す
  const pre = { ...result, finishedAt: now().toISOString(), steps: [...result.steps, { key: 'build', ok: true, message: 'data.js とビューアを作り直し', sec: 0 }] };
  try {
    writeJson(path, pre);
  } catch (e) {
    log(`警告: ${path} を書けませんでした: ${e.message}`);
  }
  const b = await step('build', 4, () => attempt(() => R.build()));
  result.steps.push(b);
  result.finishedAt = now().toISOString();
  try {
    writeJson(path, result);
  } catch (e) {
    log(`警告: ${path} を書けませんでした: ${e.message}`);
  }
  const exitCode = exitCodeOf(result);
  const failed = result.steps.filter((s) => !s.ok).map((s) => STEP_LABEL[s.key]);
  log(`終了（${sec(now() - t0)}秒）: ${exitCode === 0 ? '全部成功' : exitCode === 1 ? 'build 失敗' : `一部失敗（${failed.join('・')}）`} exit ${exitCode} → ${path}`);
  return { result, exitCode };
}

if (isMain(import.meta.url)) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`エラー: ${e.message}\n${USAGE}`);
    process.exit(1);
  }
  const dataDir = args.data ?? DATA_DIR;
  const runners = defaultRunners({ dataDir, customData: !!args.data, noViewer: args.noViewer, viewer: args.viewer, log: console.log });
  const { exitCode } = await refresh({ dataDir, runners });
  process.exit(exitCode);
}
