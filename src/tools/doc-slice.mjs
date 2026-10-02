// pdf2text のテキストから必要な部分だけを取り出す（Claude が読むのは1資料20KBまで）。
// 使い方: node tools/doc-slice.mjs <txt> [--pages 1-2,8] [--grep <語>]... [--context 2]
//   --pages: ページ番号の範囲（カンマ区切り）。--grep: 語を含む行と前後 context 行を、ページ番号つきで出す（複数指定は OR）。
//   出力が20KBを超えたら切り詰めて標準エラーに警告する。
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitPages } from './fetch-doc.mjs';

export const SLICE_LIMIT = 20 * 1024;

export function parsePages(spec) {
  const set = new Set();
  for (const part of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`--pages の形式が不正です: "${part}"（例: 1-2,8）`);
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (a < 1 || b < a) throw new Error(`--pages の範囲が不正です: "${part}"`);
    for (let i = a; i <= b; i++) set.add(i);
  }
  return [...set].sort((x, y) => x - y);
}

export function slicePages(pages, wanted) {
  const byNo = new Map(pages.map((p) => [p.page, p]));
  const missing = wanted.filter((n) => !byNo.has(n));
  const text = wanted.filter((n) => byNo.has(n)).map((n) => `===== PAGE ${n} =====\n${byNo.get(n).text}\n`).join('\n');
  return { text, missing };
}

export function grepPages(pages, terms, context = 2) {
  const out = [];
  let hits = 0;
  for (const p of pages) {
    const lines = p.text.split('\n');
    const idx = lines.map((l, i) => (terms.some((t) => l.includes(t)) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    hits += idx.length;
    // 前後 context 行の範囲をまとめる
    const ranges = [];
    for (const i of idx) {
      const [a, b] = [Math.max(0, i - context), Math.min(lines.length - 1, i + context)];
      if (ranges.length && a <= ranges.at(-1)[1] + 1) ranges.at(-1)[1] = Math.max(ranges.at(-1)[1], b);
      else ranges.push([a, b]);
    }
    const body = ranges.map(([a, b]) => lines.slice(a, b + 1).map((l, k) => `${idx.includes(a + k) ? '>' : ' '} ${l}`).join('\n')).join('\n  …\n');
    out.push(`===== PAGE ${p.page}（一致 ${idx.length}行） =====\n${body}\n`);
  }
  return { text: out.join('\n'), hits, pagesHit: out.length };
}

/** 上限を超えたらバイト境界で切る */
export function limitBytes(text, limit = SLICE_LIMIT) {
  if (Buffer.byteLength(text) <= limit) return { text, truncated: false };
  const note = '\n…（20KB上限のため以降を省略。--pages を絞ってください）\n';
  const cut = Buffer.from(text, 'utf8').subarray(0, limit - Buffer.byteLength(note)).toString('utf8').replace(/�+$/, '');
  return { text: cut + note, truncated: true };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const die = (m) => {
    console.error(`エラー: ${m}\n使い方: node tools/doc-slice.mjs <txt> [--pages 1-2,8] [--grep <語>] [--context 2]`);
    process.exit(1);
  };
  let file = null, pagesSpec = null, context = 2;
  const terms = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pages') pagesSpec = argv[++i];
    else if (argv[i] === '--grep') terms.push(argv[++i]);
    else if (argv[i] === '--context') context = Number(argv[++i]);
    else if (!file) file = argv[i];
  }
  if (!file) die('テキストファイルを指定してください');
  if (!existsSync(file)) die(`ファイルがありません: ${file}`);
  if (!pagesSpec && !terms.length) die('--pages か --grep を指定してください');
  if (terms.some((t) => !t)) die('--grep の語が空です');
  const pages = splitPages(readFileSync(file, 'utf8'));
  if (!pages.length) die(`ページ区切り（===== PAGE n =====）が見つかりません: ${file}`);
  const parts = [];
  if (pagesSpec) {
    let wanted;
    try {
      wanted = parsePages(pagesSpec);
    } catch (e) {
      die(e.message);
    }
    const r = slicePages(pages, wanted);
    if (r.missing.length) console.error(`注意: 存在しないページ ${r.missing.join(', ')}（全${pages.length}ページ）`);
    parts.push(r.text);
  }
  if (terms.length) {
    const r = grepPages(pages, terms, Number.isFinite(context) ? context : 2);
    parts.push(r.hits ? `# grep「${terms.join('」「')}」: ${r.pagesHit}ページ・${r.hits}行\n${r.text}` : `# grep「${terms.join('」「')}」: 一致なし\n`);
  }
  const { text, truncated } = limitBytes(parts.join('\n'));
  process.stdout.write(text);
  if (truncated) console.error(`警告: 出力が20KBを超えたため切り詰めました（全${pages.length}ページ）。--pages を絞ってください`);
}
