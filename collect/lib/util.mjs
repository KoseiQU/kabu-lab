import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function isMain(metaUrl) {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}

export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 1) + '\n');
}

/** {meta, rows} を「1行=1日足」で書く（差分を読みやすくする） */
export function writeRowsJson(path, { rows, ...rest }) {
  mkdirSync(dirname(path), { recursive: true });
  const head = JSON.stringify(rest, null, 1).replace(/\n}$/, '');
  const body = rows.map((r) => ' ' + JSON.stringify(r)).join(',\n');
  writeFileSync(path, `${head},\n "rows": [\n${body}\n ]\n}\n`);
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function checkCode(code) {
  if (!/^[0-9][0-9A-Z]{3}$/.test(code ?? '')) {
    throw new Error(`銘柄コードが不正です: "${code ?? ''}"（例: 6501, 130A）`);
  }
  return code;
}

/** JST の YYYY-MM-DD */
export function jstDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function fail(msg) {
  console.error(`エラー: ${msg}`);
  process.exit(1);
}

// digest が「取り直す必要のない新しさ」かを判定する。
// 直近の大引け（平日 15:45 JST）より後に作られていれば、株価は変わっていないので最新とみなす。
// それ以外でも、作成から3時間以内なら取り直さない（外部サイトへの配慮）。祝日は考慮しない（余分に取り直すだけで害はない）。
export function lastCloseBefore(now) {
  const JST = 9 * 3600 * 1000;
  const j = new Date(now.getTime() + JST); // JST の壁時計を UTC フィールドで扱う
  const d = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), 15, 45));
  for (let i = 0; i < 8; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && d.getTime() <= j.getTime()) break;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return new Date(d.getTime() - JST);
}
export function isDigestFresh(mtime, now = new Date()) {
  if (!(mtime instanceof Date) || Number.isNaN(mtime.getTime())) return false;
  if (mtime.getTime() > now.getTime()) return false;
  if (now.getTime() - mtime.getTime() < 3 * 3600 * 1000) return true;
  return mtime.getTime() >= lastCloseBefore(now).getTime();
}
