// 業種の動き・値上がり／値下がりの上位・注目候補の株価（DESIGN.md §5.10）。ここは純粋関数だけ（ネットに出ない）。
// 収集の実行は collect/market.mjs の collectExtras が行う。
import { sparkPoints } from '../market.mjs';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r2 = (x) => Math.round(x * 100) / 100;

/** TOPIX-17 業種別ETF（NEXT FUNDS 1617〜1633）。名称は契約 §5.10 のとおり。key は画面・テストで使う英字の識別子 */
export const SECTORS = [
  { code: '1617', key: 'food', name: '食品' },
  { code: '1618', key: 'energy', name: 'エネルギー資源' },
  { code: '1619', key: 'construction', name: '建設・資材' },
  { code: '1620', key: 'materials', name: '素材・化学' },
  { code: '1621', key: 'pharma', name: '医薬品' },
  { code: '1622', key: 'auto', name: '自動車・輸送機' },
  { code: '1623', key: 'steel', name: '鉄鋼・非鉄' },
  { code: '1624', key: 'machinery', name: '機械' },
  { code: '1625', key: 'electric', name: '電機・精密' },
  { code: '1626', key: 'it', name: '情報通信・サービスその他' },
  { code: '1627', key: 'utilities', name: '電力・ガス' },
  { code: '1628', key: 'transport', name: '運輸・物流' },
  { code: '1629', key: 'trading', name: '商社・卸売' },
  { code: '1630', key: 'retail', name: '小売' },
  { code: '1631', key: 'banks', name: '銀行' },
  { code: '1632', key: 'finance', name: '金融（除く銀行）' },
  { code: '1633', key: 'realestate', name: '不動産' },
];
export const SECTOR_CODES = SECTORS.map((s) => s.code);
/** 期間 = さかのぼる営業日数（1日・1週＝5営業日・1か月＝21営業日） */
export const SECTOR_SPANS = { d1: 1, w1: 5, m1: 21 };
export const SECTOR_RANGE = '3mo';
export const PICKS_RANGE = '3mo';
export const PICKS_DAYS = 60; // 直近60日の市場分析の候補を追う
export const PICKS_PER_REQUEST = 20; // Yahoo spark の1リクエストあたりの銘柄数
export const PICKS_MAX_REQUESTS = 2;

/** 日付昇順の終値列 closes（数値）の、n 営業日前と比べた騰落率（%）。足りなければ null */
export function pctOver(closes, n) {
  if (!Array.isArray(closes) || closes.length < n + 1) return null;
  const last = closes.at(-1), base = closes.at(-1 - n);
  if (!isNum(last) || !isNum(base) || base === 0) return null;
  return r2(((last - base) / base) * 100);
}

/** spark 応答（1617.T〜1633.T）→ sectors.json の中身。取れない業種も行は残し、数値は null（並びは業種コード順） */
export function parseSectors(json, now = new Date()) {
  const items = [];
  const missing = [];
  let asOf = null;
  for (const s of SECTORS) {
    let pts = [];
    try {
      pts = sparkPoints(json?.[`${s.code}.T`]);
    } catch {
      pts = [];
    }
    const closes = pts.map((p) => p.c);
    const last = pts.at(-1) ?? null;
    if (!last) missing.push(`${s.name}(${s.code})`);
    if (last && (!asOf || last.d > asOf)) asOf = last.d;
    items.push({
      key: s.key, code: s.code, name: s.name,
      close: last ? Math.round(last.c * 100) / 100 : null,
      d1: pctOver(closes, SECTOR_SPANS.d1), w1: pctOver(closes, SECTOR_SPANS.w1), m1: pctOver(closes, SECTOR_SPANS.m1),
      asOf: last ? last.d : null,
    });
  }
  return {
    generatedAt: now.toISOString(), asOf,
    source: { title: 'Yahoo Finance spark API（TOPIX-17 業種別ETF 1617〜1633 の日足。業種別指数の代用）', url: 'https://finance.yahoo.co.jp/' },
    note: 'TOPIX-17 業種別指数そのものは取得できないため、NEXT FUNDS の業種別ETFの終値で代用。1週＝5営業日・1か月＝21営業日前の終値と比較',
    items, missing,
  };
}

/* ---------- 株探のランキング（値上がり率 mode=2_1・値下がり率 mode=2_2、市場の絞り込み market=1＝東証プライム・名証プレミア） ---------- */
export const KABUTAN_RANK_URL = (mode) => `https://kabutan.jp/warning/?mode=${mode}&market=1`;
export const MOVERS_N = 10;
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const text = (h) => String(h ?? '').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]).trim();
const num = (s) => {
  const t = String(s ?? '').replace(/[,，\s%]/g, '').replace(/[−–－]/g, '-');
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};
/** ETF・ETN・REIT・インフラファンド・優先株など、株式以外を名前で除く（市場の欄が「東Ｐ」でも念のため） */
export const NON_STOCK_RE = /ETF|ETN|REIT|リート|投資法人|インフラ|優先|受益証券|上場投信|ファンド/i;

/**
 * 株探のランキングの HTML → {asOf, time, rows:[{code, name, market, close, change, pct}]}（純粋関数）。
 * 表の形（コード・銘柄名・市場・…・株価・…・前日比の値・前日比の%）が変わっていたら例外。
 */
export function parseKabutanRanking(html) {
  const s = String(html ?? '');
  const i = s.indexOf('<table class="stock_table st_market">');
  if (i < 0) throw new Error('株探のランキング表（stock_table st_market）が見つからない');
  const end = s.indexOf('</table>', i);
  const tb = s.slice(i, end < 0 ? undefined : end);
  const head = (tb.match(/<thead>([\s\S]*?)<\/thead>/) || [])[1] || '';
  const hcells = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1].replace(/<div[\s\S]*?<\/div>/g, '')));
  if (hcells[0] !== 'コード' || hcells[1] !== '銘柄名' || hcells[2] !== '市場' || !hcells.includes('株価') || !hcells.includes('前日比')) {
    throw new Error(`株探のランキング表の列が想定と違う（${hcells.join('・')}）`);
  }
  const body = (tb.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '';
  const rows = [];
  for (const m of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]));
    if (cells.length < 9) continue;
    const code = cells[0].normalize('NFKC');
    if (!/^[0-9][0-9A-Z]{3}$/.test(code)) continue;
    rows.push({ code, name: cells[1].normalize('NFKC'), market: cells[2], close: num(cells[5]), change: num(cells[7]), pct: num(cells[8]) });
  }
  const date = s.match(/<li>(\d{4})年(\d{2})月(\d{2})日<\/li>/);
  const time = s.match(/<li>(\d{1,2}:\d{2})現在<\/li>/);
  return { asOf: date ? `${date[1]}-${date[2]}-${date[3]}` : null, time: time ? time[1].padStart(5, '0') : null, rows };
}

/** ランキングの行 → 東証プライムの株式だけの上位 n 件（騰落率の向きが合う行だけ） */
export function pickMovers(rows, dir, n = MOVERS_N) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.market === '東Ｐ' && !NON_STOCK_RE.test(r.name) && isNum(r.pct) && (dir === 'up' ? r.pct > 0 : r.pct < 0))
    .slice(0, n)
    .map((r) => ({ code: r.code, name: r.name, pct: r.pct, close: isNum(r.close) ? r.close : null }));
}

/** 2つのランキング → movers.json の中身。どちらも0件なら例外（推測で埋めない） */
export function buildMovers(upHtml, downHtml, now = new Date()) {
  const up = parseKabutanRanking(upHtml), dn = parseKabutanRanking(downHtml);
  const out = {
    generatedAt: now.toISOString(),
    asOf: up.asOf ?? dn.asOf,
    time: up.time ?? dn.time,
    source: { title: '株探 今日の株価上昇率・下落率ランキング（東証プライム）', url: KABUTAN_RANK_URL('2_1') },
    up: pickMovers(up.rows, 'up'),
    down: pickMovers(dn.rows, 'down'),
  };
  if (!out.up.length && !out.down.length) throw new Error('東証プライムの銘柄が1件も読めなかった（表の形の変化の可能性）');
  return out;
}

/* ---------- 注目候補の株価 ---------- */
const dayNum = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 864e5);
/**
 * 市場型の分析の配列 → 直近 days 日（today から数えて）の注目候補のコード（新しい分析の順・重複なし）
 */
export function pickCodes(analyses, today, days = PICKS_DAYS) {
  const t = dayNum(today);
  const list = (Array.isArray(analyses) ? analyses : [])
    .filter((a) => a && a.type === 'market' && typeof a.date === 'string' && Number.isFinite(dayNum(a.date)) && t - dayNum(a.date) <= days && t - dayNum(a.date) >= 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const codes = [];
  for (const a of list) {
    for (const th of Array.isArray(a.sections?.themes) ? a.sections.themes : []) {
      for (const s of Array.isArray(th?.stocks) ? th.stocks : []) {
        const c = typeof s?.code === 'string' ? s.code.trim() : '';
        if (/^[0-9][0-9A-Z]{3}$/.test(c) && !codes.includes(c)) codes.push(c);
      }
    }
  }
  return codes;
}

/** コードを1リクエストあたり per 件に分ける（最大 max 回。入りきらないコードは over） */
export function chunkCodes(codes, per = PICKS_PER_REQUEST, max = PICKS_MAX_REQUESTS) {
  const chunks = [];
  for (let i = 0; i < codes.length && chunks.length < max; i += per) chunks.push(codes.slice(i, i + per));
  return { chunks, over: codes.slice(per * max) };
}

/** spark 応答（複数可）→ picks-prices.json の中身。応答に無い・値が無いコードは missing（落とさない） */
export function parsePicksPrices(jsons, codes, { over = [], now = new Date(), failed = [] } = {}) {
  const merged = Object.assign({}, ...(Array.isArray(jsons) ? jsons : [jsons]).filter((x) => x && typeof x === 'object'));
  const prices = {};
  const missing = [];
  for (const c of codes) {
    let pts = [];
    try {
      pts = sparkPoints(merged[`${c}.T`]);
    } catch {
      pts = [];
    }
    if (pts.length) prices[c] = { rows: pts.map((p) => ({ d: p.d, c: Math.round(p.c * 100) / 100 })) };
    else missing.push({ code: c, reason: failed.includes(c) ? '取得に失敗' : '株価が見つからない（コードの誤りか上場廃止の可能性）' });
  }
  for (const c of over) missing.push({ code: c, reason: `1回の取得の上限（${PICKS_PER_REQUEST * PICKS_MAX_REQUESTS}銘柄）を超えたため未取得` });
  return {
    generatedAt: now.toISOString(), range: PICKS_RANGE,
    source: { title: 'Yahoo Finance spark API（注目候補の日足・終値）', url: 'https://finance.yahoo.co.jp/' },
    codes: [...codes, ...over], prices, missing,
  };
}
