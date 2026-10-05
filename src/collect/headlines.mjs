// 最新の見出し（自動取得・解説なし）: 公開RSS 3本から題名とリンクだけを集める（DESIGN.md §5.9）。
// 使い方: node collect/headlines.mjs → data/market/headlines.json
//   {fetchedAt, sources:[{name, url, ok, count, message}], items:[{title, url, source, publishedAt}]}
// 各RSSは1リクエスト（失敗時のリトライ1回は fetch.mjs の作法どおり）、RSS どうしの間は1秒以上あける。
// 本文・要約は持たない。URL は http(s) だけを通す。1つのRSSが失敗しても他は載せる。
// 全部失敗したら既存の headlines.json を消さずに残し、exit 1。
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createFetcher } from './lib/fetch.mjs';
import { DATA_DIR, isMain, writeJson } from './lib/util.mjs';

export const FEEDS = [
  { name: 'NHK 経済', url: 'https://www3.nhk.or.jp/rss/news/cat5.xml' },
  { name: 'Yahoo!ニュース 経済', url: 'https://news.yahoo.co.jp/rss/topics/business.xml' },
  { name: '日本銀行 新着', url: 'https://www.boj.or.jp/rss/whatsnew.xml' },
];
export const MAX_ITEMS = 30;
export const TITLE_MAX = 200;
export const FEED_MAX_BYTES = 2 * 1024 * 1024;
/** RSS の最新の項目がこれより古ければ「更新が止まっている可能性」と記録する（取得は成功扱いのまま） */
export const STALE_DAYS = 7;

/** 最新の項目の日付が STALE_DAYS より古ければその日付（YYYY-MM-DD、日本時間）、そうでなければ null（純粋関数） */
export function staleSince(items, now = new Date()) {
  const ts = (items ?? []).map((x) => Date.parse(x?.publishedAt ?? '')).filter(Number.isFinite);
  if (!ts.length) return null;
  const newest = Math.max(...ts);
  return now.getTime() - newest > STALE_DAYS * 864e5 ? new Date(newest + 9 * 3600e3).toISOString().slice(0, 10) : null;
}
export const headlinesPath = (dataDir = DATA_DIR) => join(dataDir, 'market', 'headlines.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** 実体参照（&amp; &lt; &#12354; &#x3042; など）を文字に戻す（純粋関数）。知らない名前はそのまま残す */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** 要素の中身の文字列: CDATA を外し、CDATA の外だけ実体参照を戻す。残った HTML タグは取り除き、空白を詰める */
export function textOf(raw) {
  if (raw == null) return '';
  let out = '';
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0, m;
  while ((m = re.exec(raw))) {
    out += decodeEntities(raw.slice(last, m.index)) + m[1];
    last = re.lastIndex;
  }
  out += decodeEntities(raw.slice(last));
  // HTML のタグらしいもの（英字で始まる）だけを取り除く。「<速報>」のような和文の山括弧は残す（画面では必ずエスケープする）
  return out.replace(/<\/?[a-z][^>]*>/gi, '').replace(/\s+/g, ' ').trim();
}

/** タグ名（名前空間つき可）の最初の要素の中身。無ければ null */
function inner(block, tag) {
  const t = tag.replace(/[:]/g, '\\:');
  const m = block.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}\\s*>`, 'i'));
  return m ? m[1] : null;
}

/** http(s) の URL だけを通す（それ以外は null） */
export function safeUrl(u) {
  const s = String(u ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const x = new URL(s);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
  } catch {
    return null;
  }
}

/** 日付の文字列（RFC 822 の pubDate、ISO 8601 の dc:date / updated）→ ISO 文字列。読めなければ null */
export function parseDate(s) {
  const v = textOf(s);
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * RSS 2.0・RSS 1.0（RDF）・Atom の素朴なパーサ（純粋関数）。
 * 返り値: [{title, url, publishedAt}]（フィードの並び順のまま。題名か URL の無い項目は除く）
 */
export function parseFeed(xml) {
  const src = String(xml ?? '');
  const out = [];
  const blocks = [...src.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)].map((m) => m[2]);
  for (const b of blocks) {
    const title = textOf(inner(b, 'title')).slice(0, TITLE_MAX);
    let link = null;
    const ln = inner(b, 'link');
    if (ln != null && textOf(ln)) link = textOf(ln);
    if (!link) {
      // Atom: <link rel="alternate" href="..."/>（rel が無ければ alternate 扱い）
      const links = [...b.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
      const pick = links.find((a) => !/\brel\s*=/.test(a) || /\brel\s*=\s*["']alternate["']/.test(a)) ?? null;
      const href = pick && pick.match(/\bhref\s*=\s*["']([^"']*)["']/i);
      if (href) link = decodeEntities(href[1]);
    }
    if (!link) {
      const guid = inner(b, 'guid');
      if (guid && !/isPermaLink\s*=\s*["']false/i.test(b)) link = textOf(guid);
    }
    const url = safeUrl(link);
    const date = inner(b, 'pubDate') ?? inner(b, 'dc:date') ?? inner(b, 'published') ?? inner(b, 'updated');
    if (!title || !url) continue;
    out.push({ title, url, publishedAt: parseDate(date) });
  }
  return out;
}

/** バイト列 → 文字列（XML 宣言か Content-Type の charset を見る。既定 UTF-8） */
export function decodeXml(buffer, contentType = '') {
  const head = Buffer.from(buffer).subarray(0, 300).toString('latin1');
  const enc = (head.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i) || [])[1] || (String(contentType).match(/charset=([^;\s]+)/i) || [])[1] || 'utf-8';
  try {
    return new TextDecoder(enc.trim().toLowerCase()).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

const titleKey = (t) => String(t).normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/**
 * 出典ごとの結果をまとめる（純粋関数）: 同じ題名は1つ（新しいほうを残す）、新しい順（日付なしは最後）に最大 max 件。
 * results: [{name, items:[{title, url, publishedAt}]}]
 */
export function mergeHeadlines(results, max = MAX_ITEMS) {
  const all = [];
  results.forEach((r, si) => (r.items ?? []).forEach((it, i) => {
    const url = safeUrl(it?.url);
    const title = typeof it?.title === 'string' ? it.title.trim() : '';
    if (url && title) all.push({ title, url, source: r.name, publishedAt: it.publishedAt ?? null, _o: si * 1e4 + i });
  }));
  const ts = (x) => (x.publishedAt ? Date.parse(x.publishedAt) : -Infinity);
  all.sort((a, b) => ts(b) - ts(a) || a._o - b._o);
  const seen = new Set();
  const out = [];
  for (const x of all) {
    const k = titleKey(x.title);
    if (seen.has(k)) continue;
    seen.add(k);
    const { _o, ...rest } = x;
    out.push(rest);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 3本のRSSを順に取る。fetcher は { binary(url, opt) } を持つもの（テストでは差し替える）。
 * 返り値 { data: headlines.json の中身, okCount }
 */
export async function collectHeadlines({ fetcher = createFetcher(), feeds = FEEDS, now = () => new Date(), wait = sleep, gapMs = 1000 } = {}) {
  const sources = [];
  const results = [];
  for (let i = 0; i < feeds.length; i++) {
    const f = feeds[i];
    if (i > 0 && gapMs > 0) await wait(gapMs);
    try {
      const res = await fetcher.binary(f.url, { maxBytes: FEED_MAX_BYTES, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' });
      const items = parseFeed(decodeXml(res.buffer, res.contentType));
      if (!items.length) throw new Error('見出しが1件も読めませんでした（形式の変化の可能性）');
      results.push({ name: f.name, items });
      const stale = staleSince(items, now());
      sources.push({ name: f.name, url: f.url, ok: true, count: items.length, message: stale ? `最新の項目が ${stale}（RSS の更新が止まっている可能性）` : '', ...(stale ? { stale } : {}) });
    } catch (e) {
      sources.push({ name: f.name, url: f.url, ok: false, count: 0, message: String(e?.message ?? e).slice(0, 200) });
    }
  }
  const items = mergeHeadlines(results);
  return { data: { fetchedAt: now().toISOString(), sources, items }, okCount: sources.filter((s) => s.ok).length };
}

/** 収集して書く。全部失敗なら書かない（既存を残す）。返り値 {ok, message, count, path} */
export async function runHeadlines({ dataDir = DATA_DIR, ...opt } = {}) {
  const path = headlinesPath(dataDir);
  const { data, okCount } = await collectHeadlines(opt);
  const failed = data.sources.filter((s) => !s.ok);
  const stale = data.sources.filter((s) => s.stale);
  if (!okCount) {
    return { ok: false, count: 0, path, data, message: `全RSSの取得に失敗（${existsSync(path) ? '前回の headlines.json を残しました' : 'headlines.json はまだありません'}）: ${failed.map((s) => `${s.name}: ${s.message}`).join(' ／ ')}` };
  }
  writeJson(path, data);
  return { ok: true, count: data.items.length, path, data, message: `${data.items.length}件${failed.length ? `（失敗: ${failed.map((s) => s.name).join('・')}）` : ''}${stale.length ? `（更新が止まっている可能性: ${stale.map((s) => `${s.name} 最新 ${s.stale}`).join('・')}）` : ''}` };
}

if (isMain(import.meta.url)) {
  const r = await runHeadlines();
  for (const s of r.data.sources) console.log(`${s.ok ? 'OK' : 'NG'} ${s.name}: ${s.ok ? `${s.count}件` : s.message}`);
  if (!r.ok) {
    console.error(`エラー: ${r.message}`);
    process.exit(1);
  }
  console.log(`書いたファイル: ${r.path}（${r.message}）`);
}
