// 株探の個別銘柄ページから基本情報を抽出し data/stocks/<code>/profile.json に保存する。
// 使い方: node collect/kabutan.mjs <code> [--save-html <path>]
// 抽出は項目ごとに try し、1項目の失敗で全体を落とさない。取れない項目は null にして missing に入れる。
import { join } from 'node:path';
import { defaultFetcher } from './lib/fetch.mjs';
import { ROOT, isMain, writeJson, writeText, checkCode, fail } from './lib/util.mjs';

export const kabutanUrl = (code) => `https://kabutan.jp/stock/?code=${code}`;

// ---- 文字列ヘルパー ----
const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
export function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ENTITIES[m])
    .replace(/[\s　]+/g, ' ')
    .trim();
}

/** 全角→半角（数字・記号）。 */
export function toHalf(s) {
  return String(s)
    .replace(/[０-９．，＋－％]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[−–—―‐]/g, '-');
}

/** "27.3倍" "+0.22%" "3,518.8" "－" → number | null */
export function parseNum(s) {
  if (s == null) return null;
  let t = toHalf(stripTags(s)).replace(/[,\s倍%円株]/g, '');
  if (t === '' || /^-+$/.test(t) || t === '--') return null;
  const m = t.match(/^[+-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** "25兆454億円" "2,396億円" → { yen, text } */
export function parseMarketCap(s) {
  const text = stripTags(s).replace(/\s/g, '');
  const t = toHalf(text).replace(/,/g, '');
  const m = t.match(/^(?:(\d+(?:\.\d+)?)兆)?(?:(\d+(?:\.\d+)?)億)?円$/);
  if (!m || (!m[1] && !m[2])) return null;
  const yen = Math.round((Number(m[1] ?? 0) * 1e12 + Number(m[2] ?? 0) * 1e8));
  return { yen, text };
}

const MARKET_NAMES = { '東証P': '東証プライム', '東証S': '東証スタンダード', '東証G': '東証グロース' };
function normalizeMarket(raw) {
  const h = toHalf(raw).replace(/[Ｐ]/g, 'P').replace(/[Ｓ]/g, 'S').replace(/[Ｇ]/g, 'G');
  return MARKET_NAMES[h] ?? raw;
}

/** 範囲切り出し: start を含む位置から end までの部分 */
function between(html, start, end) {
  const i = html.indexOf(start);
  if (i < 0) return null;
  const j = html.indexOf(end, i + start.length);
  return j < 0 ? html.slice(i) : html.slice(i, j);
}

function rows(tableHtml) {
  return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
}
function cells(trHtml) {
  return [...trHtml.matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ tag: m[1].toLowerCase(), html: m[2] }));
}
/** <th scope='row'>ラベル</th><td>値</td> 形式の表から値HTMLを探す */
function rowValue(html, label) {
  const re = new RegExp(`<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`);
  const m = html.match(re);
  return m ? m[1] : null;
}

// ---- 項目ごとの抽出器 ----
const LABELS = {
  name: '社名', market: '市場', industry: '業種', tags: '区分', price: '株価', priceTime: '株価時刻',
  change: '前日比', changePct: '前日比(%)', per: 'PER', pbr: 'PBR', yield: '利回り',
  marginRatio: '信用倍率', marketCap: '時価総額', unitShares: '単元株数', minPurchase: '売買最低代金',
  psr: 'PSR', margin: '信用取引', performance: '業績推移', themes: 'テーマ', overview: '概要',
};

function headerBlock(html) {
  return between(html, 'id="stockinfo_i1"', 'stockinfo_i1-->') ?? '';
}
function indicatorTable(html) {
  const blk = between(html, 'id="stockinfo_i3"', 'stockinfo_i3-->');
  if (!blk) return null;
  const head = (blk.match(/<thead>([\s\S]*?)<\/thead>/) ?? [])[1] ?? '';
  const body = (blk.match(/<tbody>([\s\S]*?)<\/tbody>/) ?? [])[1] ?? '';
  const names = cells(head).map((c) => stripTags(c.html));
  const first = rows(body)[0] ?? '';
  const vals = cells(first).filter((c) => c.tag === 'td').map((c) => c.html);
  const out = {};
  names.forEach((n, i) => (out[n] = vals[i]));
  return { map: out, blk };
}
function companyBlock(html) {
  return between(html, 'class="company_block"', '</table>') ?? '';
}

const EXTRACT = {
  name(html, code) {
    const h2 = headerBlock(html).match(/<div class="si_i1_1">\s*<h2>([\s\S]*?)<\/h2>/);
    const t = stripTags(h2[1]).replace(code, '').trim();
    if (!t) throw new Error('empty');
    return t;
  },
  market(html) {
    const m = headerBlock(html).match(/<span class="market">([\s\S]*?)<\/span>/);
    return normalizeMarket(stripTags(m[1]));
  },
  industry(html) {
    const v = rowValue(companyBlock(html), '業種');
    if (v) return stripTags(v);
    const m = between(html, 'id="stockinfo_i2"', 'stockinfo_i2-->').match(/<a href="\/themes\/\?industry=[^"]*">([\s\S]*?)<\/a>/);
    return stripTags(m[1]);
  },
  tags(html) {
    const blk = between(html, 'id="stockinfo_b1"', 'stockinfo_b1-->') ?? '';
    const t = [...blk.matchAll(/<div class="kubun_btn"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => stripTags(m[1]));
    return t;
  },
  price(html) {
    return parseNum(headerBlock(html).match(/<span class="kabuka">([\s\S]*?)<\/span>/)[1]);
  },
  priceTime(html) {
    const m = headerBlock(html).match(/<time datetime="([^"]+)"/);
    return m[1];
  },
  change(html) {
    const dl = headerBlock(html).match(/<dl class="si_i1_dl1">([\s\S]*?)<\/dl>/)[1];
    return parseNum([...dl.matchAll(/<dd>([\s\S]*?)<\/dd>/g)][0][1]);
  },
  changePct(html) {
    const dl = headerBlock(html).match(/<dl class="si_i1_dl1">([\s\S]*?)<\/dl>/)[1];
    return parseNum([...dl.matchAll(/<dd>([\s\S]*?)<\/dd>/g)][1][1]);
  },
  per: (html) => parseNum(indicatorTable(html).map['PER']),
  pbr: (html) => parseNum(indicatorTable(html).map['PBR']),
  yield: (html) => parseNum(indicatorTable(html).map['利回り']),
  marginRatio: (html) => parseNum(indicatorTable(html).map['信用倍率']),
  marketCap(html) {
    const blk = indicatorTable(html)?.blk ?? '';
    const m = blk.match(/class="v_zika2">([\s\S]*?)<\/td>/);
    return parseMarketCap(m ? m[1] : rowValue(html, '時価総額'));
  },
  unitShares(html) {
    const v = rowValue(html, '単元株数');
    if (v) return parseNum(v);
    const m = between(html, 'id="stockinfo_i2"', 'stockinfo_i2-->').match(/<dt>単位<\/dt>\s*<dd>([\s\S]*?)<\/dd>/);
    return parseNum(m[1]);
  },
  minPurchase: (html) => parseNum(rowValue(html, '売買最低代金')),
  psr(html) {
    const blk = between(html, 'class="hist_per1"', '</table>');
    const m = blk.match(/<span class="bold">PSR<\/span><\/td>\s*<td[^>]*>([\s\S]*?)<span/);
    return parseNum(m[1]);
  },
  margin(html) {
    const blk = between(html, '信用取引&nbsp;(単位:千株)', '</table>') ?? between(html, '信用取引', '</table>');
    const out = [];
    for (const tr of rows(blk)) {
      const dm = tr.match(/<time datetime="(\d{4}-\d{2}-\d{2})"/);
      if (!dm) continue;
      const tds = cells(tr).filter((c) => c.tag === 'td').map((c) => parseNum(c.html));
      out.push({ date: dm[1], sell: tds[0], buy: tds[1], ratio: tds[2] });
    }
    if (out.length === 0) throw new Error('no rows');
    return out.sort((a, b) => (a.date < b.date ? -1 : 1)); // 古い順
  },
  performance(html) {
    const blk = between(html, 'class="gyouseki_block"', '</table>');
    const unit = stripTags((blk.match(/<dt>単位<\/dt>\s*<dd>([\s\S]*?)<\/dd>/) ?? [])[1] ?? '') || null;
    const head = (blk.match(/<thead>([\s\S]*?)<\/thead>/) ?? [])[1] ?? '';
    const headers = cells(head).map((c) => toHalf(stripTags(c.html)).replace(/１/g, '1'));
    const idx = (re) => headers.findIndex((h) => re.test(h));
    const col = {
      sales: idx(/売上|営業収益|経常収益|収益/),
      ordinaryProfit: idx(/経常益|税前益|営業益/),
      netProfit: idx(/最終益|純利益/),
      eps: idx(/1株益/),
      dividend: idx(/1株配/),
      announced: idx(/発表日/),
    };
    const out = [];
    for (const tr of rows(blk)) {
      const cs = cells(tr);
      const th = cs.find((c) => c.tag === 'th');
      if (!th) continue;
      const label = stripTags(th.html);
      const pm = label.match(/(\d{4}\.\d{2})/);
      if (!pm) continue;
      const tds = cs.filter((c) => c.tag === 'td').map((c) => c.html);
      const at = (k) => (col[k] > 0 ? tds[col[k] - 1] : undefined); // headers[0] は「決算期」
      const ann = at('announced');
      out.push({
        period: pm[1],
        forecast: /予/.test(label),
        sales: parseNum(at('sales')),
        ordinaryProfit: parseNum(at('ordinaryProfit')),
        netProfit: parseNum(at('netProfit')),
        eps: parseNum(at('eps')),
        dividend: parseNum(at('dividend')),
        announced: ann ? stripTags(ann) || null : null,
      });
    }
    if (out.length === 0) throw new Error('no rows');
    return { unit, headers, rows: out };
  },
  themes(html) {
    const v = rowValue(companyBlock(html), 'テーマ');
    const t = [...v.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => stripTags(m[1])).filter(Boolean);
    if (t.length === 0) throw new Error('empty');
    return t.slice(0, 10);
  },
  overview: (html) => stripTags(rowValue(companyBlock(html), '概要')) || null,
};

/** 株探HTML → profile（純粋関数） */
export function parseKabutan(html, code) {
  const profile = { code };
  const missing = [];
  const errors = {};
  for (const [key, fn] of Object.entries(EXTRACT)) {
    let v = null;
    try {
      v = fn(html, code);
    } catch (e) {
      errors[key] = e.message;
      v = null;
    }
    if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) v = null;
    profile[key] = v;
    if (v === null || (Array.isArray(v) && v.length === 0)) missing.push(LABELS[key]);
  }
  // 業績推移の個別欠損（例: 予想期の配当「－」）も記録する
  for (const r of profile.performance?.rows ?? []) {
    for (const k of ['sales', 'netProfit', 'eps', 'dividend']) {
      if (r[k] === null) missing.push(`業績推移 ${r.period}${r.forecast ? '予' : ''} ${PERF_LABELS[k]}`);
    }
  }
  profile.source = { title: `株探 ${profile.name ?? code}`, url: kabutanUrl(code) };
  profile.missing = missing;
  if (Object.keys(errors).length) profile.parseErrors = errors;
  return profile;
}
const PERF_LABELS = { sales: '売上高', netProfit: '最終益', eps: '1株益', dividend: '1株配' };

export async function fetchKabutan(code, { fetcher = defaultFetcher(), saveHtml } = {}) {
  checkCode(code);
  const html = await fetcher.text(kabutanUrl(code), { accept: 'text/html' });
  if (saveHtml) writeText(saveHtml, html);
  if (!html.includes('stockinfo')) throw new Error(`株探のページ構造が想定と異なります（stockinfo が見つからない）: ${kabutanUrl(code)}`);
  const profile = parseKabutan(html, code);
  profile.fetchedAt = new Date().toISOString();
  return { profile, html };
}

export function profilePath(code) {
  return join(ROOT, 'data', 'stocks', code, 'profile.json');
}

if (isMain(import.meta.url)) {
  const code = process.argv[2];
  const si = process.argv.indexOf('--save-html');
  try {
    const { profile } = await fetchKabutan(checkCode(code), { saveHtml: si > 0 ? process.argv[si + 1] : undefined });
    writeJson(profilePath(code), profile);
    console.log(`${profilePath(code)}（未取得: ${profile.missing.join('、') || 'なし'}）`);
  } catch (e) {
    fail(`株探の取得に失敗しました: ${e.message}`);
  }
}
