// 入口: node collect/run.mjs <code> [--type quick|chart|kessan] [--if-stale]
// quick/chart: 株価(Yahoo)と株探の基本ページを取得し、指標を計算して prices.json・profile.json・digest.md を書く。
//   （chart 型は quick と同じ収集・同じ digest を使う）
// kessan: 株探の決算ページだけを取得し finance.json・digest-kessan.md を書く（同じ実行で quick の収集はしない）。
// --if-stale: その型の digest が最新（直近の大引け以降に作成、または作成から3時間以内）なら収集を省く。
import { join } from 'node:path';
import { mkdirSync, statSync, existsSync } from 'node:fs';
import { fetchPrices, pricesPath } from './prices.mjs';
import { fetchKabutan, profilePath } from './kabutan.mjs';
import { computeAll } from './lib/indicators.mjs';
import { buildDigest, DIGEST_LIMIT } from './lib/digest.mjs';
import { fetchFinance, financePath } from './kabutan-finance.mjs';
import { buildKessanDigest } from './lib/digest-kessan.mjs';
import { DATA_DIR, writeJson, writeRowsJson, writeText, checkCode, fail, isDigestFresh } from './lib/util.mjs';

const TYPES = ['quick', 'chart', 'kessan'];

function parseArgs(argv) {
  const args = { code: null, type: 'quick', ifStale: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--type') args.type = argv[++i];
    else if (argv[i] === '--if-stale') args.ifStale = true;
    else if (!args.code) args.code = argv[i];
  }
  return args;
}

const { code, type, ifStale } = parseArgs(process.argv.slice(2));
try {
  checkCode(code);
} catch (e) {
  fail(`${e.message}\n使い方: node collect/run.mjs <code> [--type quick|chart|kessan] [--if-stale]`);
}
if (!TYPES.includes(type)) fail(`未対応の型です: ${type}（対応: ${TYPES.join(', ')}）`);

const dir = join(DATA_DIR, 'stocks', code);
if (ifStale) {
  const dp = join(dir, type === 'kessan' ? 'digest-kessan.md' : 'digest.md');
  const need = type === 'kessan' ? [dp, financePath(code)] : [dp, pricesPath(code), profilePath(code)];
  if (need.every((f) => existsSync(f)) && isDigestFresh(statSync(dp).mtime)) {
    mkdirSync(join(dir, 'analyses'), { recursive: true });
    console.log(`収集を省略（${code} の digest は最新です）:\n  ${dp}`);
    process.exit(0);
  }
}

const written = [];
const errors = [];
const missing = [];

if (type === 'kessan') {
  let fin = null;
  try {
    fin = await fetchFinance(code, { saveHtml: join(dir, 'raw', 'kabutan-finance.html') });
  } catch (e) {
    fail(`株探（決算ページ）の取得に失敗しました: ${e.message}`);
  }
  writeJson(financePath(code), fin);
  written.push(financePath(code));
  const digest = buildKessanDigest({ code, fin });
  const p = join(dir, 'digest-kessan.md');
  writeText(p, digest);
  written.push(`${p} (${Buffer.byteLength(digest)} bytes / 上限 ${DIGEST_LIMIT})`);
  mkdirSync(join(dir, 'analyses'), { recursive: true });
  console.log(`書いたファイル（${code} ${fin.name ?? ''} 決算）:`);
  for (const w of written) console.log(`  ${w}`);
  if (fin.parseErrors) console.log(`注意: 取れなかった表 ${Object.keys(fin.parseErrors).join(', ')}（missing に記録）`);
  process.exit(0);
}

let prices = null;
try {
  prices = await fetchPrices(code);
} catch (e) {
  // 銘柄そのものが存在しない（Yahoo 404）なら何も書かずに終える。株探は指数等の別ページを返すことがあるため
  if (/HTTP 404/.test(e.message)) fail(`銘柄 ${code} の株価が見つかりません（Yahoo 404）。コードを確認してください: ${e.message}`);
  errors.push(`株価(Yahoo)の取得に失敗: ${e.message}`);
  missing.push('株価・テクニカル指標（Yahoo chart API の取得失敗）');
}

let profile = null;
try {
  ({ profile } = await fetchKabutan(code, { saveHtml: join(dir, 'raw', 'kabutan.html') }));
  missing.push(...profile.missing.map((m) => `株探: ${m}`));
} catch (e) {
  errors.push(`株探の取得に失敗: ${e.message}`);
  missing.push('株探の基本情報一式（取得失敗）');
}

if (prices) {
  if (profile?.name) prices.meta.name = profile.name;
  writeRowsJson(pricesPath(code), prices);
  written.push(pricesPath(code));
}
if (profile) {
  writeJson(profilePath(code), profile);
  written.push(profilePath(code));
}

let ind = null;
if (prices) {
  try {
    ind = computeAll(prices.rows);
    if (ind.bars < 200) missing.push(`日足が${ind.bars}本のため200日線などが計算できない場合あり`);
  } catch (e) {
    errors.push(`指標計算に失敗: ${e.message}`);
  }
}

if (prices || profile) {
  const digest = buildDigest({ code, type, profile, ind, pricesMeta: prices?.meta, missing });
  const p = join(dir, 'digest.md');
  writeText(p, digest);
  written.push(`${p} (${Buffer.byteLength(digest)} bytes / 上限 ${DIGEST_LIMIT})`);
  // 分析JSONの保存先を先に用意しておく（スキル実行時に書き込みで失敗しないように）
  mkdirSync(join(dir, 'analyses'), { recursive: true });
}

console.log(`書いたファイル（${code} ${profile?.name ?? ''}）:`);
for (const w of written) console.log(`  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`エラー: ${e}`);
  process.exit(1);
}
