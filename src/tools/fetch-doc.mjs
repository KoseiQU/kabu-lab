// 決算短信などのPDFを取得してテキスト化する。
// 使い方: node tools/fetch-doc.mjs <code> <url> [--name <名前>] [--dir <保存先>]（--dir はテスト用。既定は raw/docs）
//   → data/stocks/<code>/raw/docs/<名前>.pdf と <名前>.txt（tools/pdf2text.py でページ区切り付き）
//   標準出力にページ数・文字数・各ページ先頭40字の目次を出す。続きは tools/doc-slice.mjs で必要なページだけ読む。
// 共通fetch（UA明示・15秒・リトライ1回・同一サイト4リクエストまで）。最大20MB。Content-Type が PDF でなければエラー。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultFetcher } from '../collect/lib/fetch.mjs';
import { checkCode } from '../collect/lib/util.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_BYTES = 20 * 1024 * 1024;

export function isPdf(contentType, buffer) {
  const ct = (contentType ?? '').toLowerCase();
  const magic = buffer?.subarray(0, 5).toString('latin1') === '%PDF-';
  return ct.includes('application/pdf') || (ct.includes('application/octet-stream') && magic);
}

export function safeName(name, url) {
  const base = name ?? decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'doc').replace(/\.pdf$/i, '');
  if (!base || /[\/\\\0]/.test(base) || base.startsWith('.')) throw new Error(`--name が不正です: "${base}"（/ や先頭の . は使えない）`);
  return base;
}

/** pdf2text の出力（===== PAGE n =====）→ [{page, text}] */
export function splitPages(txt) {
  const out = [];
  const re = /^===== PAGE (\d+) =====$/gm;
  const marks = [...txt.matchAll(re)];
  marks.forEach((m, i) => {
    const start = m.index + m[0].length + 1;
    const end = i + 1 < marks.length ? marks[i + 1].index : txt.length;
    out.push({ page: Number(m[1]), text: txt.slice(start, end).replace(/\s+$/, '') });
  });
  return out;
}

/** ページ数・文字数・目次（各ページ先頭40字） */
export function summarize(txt) {
  const pages = splitPages(txt);
  const chars = pages.reduce((s, p) => s + [...p.text].length, 0);
  const toc = pages.map((p) => ({ page: p.page, head: [...p.text.replace(/\s+/g, ' ').trim()].slice(0, 40).join('') }));
  return { pages: pages.length, chars, toc };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [code, url] = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && !['--name', '--dir'].includes(arr[i - 1]));
  const ni = process.argv.indexOf('--name');
  const di = process.argv.indexOf('--dir');
  const die = (m) => {
    console.error(`エラー: ${m}`);
    process.exit(1);
  };
  try {
    checkCode(code);
    if (!/^https?:\/\//.test(url ?? '')) throw new Error('URL を指定してください（http/https）');
  } catch (e) {
    die(`${e.message}\n使い方: node tools/fetch-doc.mjs <code> <url> [--name <名前>]`);
  }
  let name;
  try {
    name = safeName(ni > 0 ? process.argv[ni + 1] : undefined, url);
  } catch (e) {
    die(e.message);
  }
  const dir = di > 0 ? resolve(process.argv[di + 1]) : join(ROOT, 'data', 'stocks', code, 'raw', 'docs');
  let got;
  try {
    got = await defaultFetcher().binary(url, { maxBytes: MAX_BYTES, accept: 'application/pdf' });
  } catch (e) {
    die(`PDFの取得に失敗しました: ${e.message}`);
  }
  if (!isPdf(got.contentType, got.buffer)) {
    die(`PDFではありません（Content-Type: ${got.contentType || '不明'}、先頭: ${JSON.stringify(got.buffer.subarray(0, 16).toString('latin1'))}）: ${url}`);
  }
  mkdirSync(dir, { recursive: true });
  const pdf = join(dir, `${name}.pdf`);
  const txt = join(dir, `${name}.txt`);
  writeFileSync(pdf, got.buffer);
  const r = spawnSync('python3', [join(ROOT, 'tools', 'pdf2text.py'), pdf, txt], { encoding: 'utf8' });
  if (r.status !== 0) die(`テキスト化に失敗しました: ${(r.stderr || r.error?.message || '').trim()}`);
  const sum = summarize(readFileSync(txt, 'utf8'));
  console.log(`PDF  ${pdf} (${(got.buffer.length / 1024).toFixed(0)} KB)`);
  console.log(`TEXT ${txt}`);
  console.log(`ページ数 ${sum.pages} / 文字数 ${sum.chars.toLocaleString('ja-JP')}`);
  console.log('目次（各ページ先頭40字）:');
  for (const t of sum.toc) console.log(`  p${t.page}: ${t.head || '（文字なし・画像の可能性）'}`);
  console.log(`続き: node tools/doc-slice.mjs ${txt} --pages 1-2 | --grep <語>`);
}
