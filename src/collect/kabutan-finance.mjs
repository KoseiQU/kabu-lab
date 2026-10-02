// 株探の決算ページ（/stock/finance?code=）から業績・財務・CFを抽出し data/stocks/<code>/finance.json に保存する。
// 使い方: node collect/kabutan-finance.mjs <code> [--save-html <path>]
// 金額の単位は株探の表示どおり「百万円」（1株益・配当は円、比率は%、有利子負債倍率は倍）。
// 抽出は表ごと・項目ごとに try し、取れないものは null にして missing に入れる。
import { join } from 'node:path';
import { defaultFetcher } from './lib/fetch.mjs';
import { ROOT, isMain, writeJson, writeText, checkCode, fail } from './lib/util.mjs';
import { stripTags, toHalf, parseNum, between, rows, cells } from './kabutan.mjs';

export const financeUrl = (code) => `https://kabutan.jp/stock/finance?code=${code}`;

// ---- 表の汎用パーサ ----
const normHeader = (h) =>
  toHalf(stripTags(h))
    .replace(/[Ａ-Ｚａ-ｚ１]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]/g, '');
// 修正方向の矢印（入れ子の table）は、それを包む <td> ごと取り除く（列ずれ防止）
const dropArrows = (html) => html.replace(/<td>\s*<table class="arrow">[\s\S]*?<\/table>\s*<\/td>/g, '').replace(/<table class="arrow">[\s\S]*?<\/table>/g, '');

/** <table> を {headers, rows:[{label, forecast, tds:[html]}]} にする（入れ子の table は事前に除く） */
export function parseTable(tableHtml) {
  const html = dropArrows(tableHtml);
  const head = (html.match(/<thead>([\s\S]*?)<\/thead>/) ?? [])[1] ?? '';
  const headers = cells(head).map((c) => normHeader(c.html));
  const body = (html.match(/<tbody>([\s\S]*?)<\/tbody>/) ?? [])[1] ?? html;
  const out = [];
  for (const tr of rows(body)) {
    const cs = cells(tr);
    const th = cs.find((c) => c.tag === 'th');
    if (!th) continue;
    const raw = stripTags(th.html);
    out.push({ label: raw.replace(/^[IU連単]\s*(予|旧|新|実|変)?\s*/, '').trim(), raw, forecast: /予/.test(raw), tds: cs.filter((c) => c.tag === 'td').map((c) => c.html) });
  }
  return { headers, rows: out };
}

/** 位置 anchor の後ろで最初の <table>…</table> */
function tableAfter(html, anchor) {
  const i = html.indexOf(anchor);
  if (i < 0) return null;
  const s = html.indexOf('<table', i);
  if (s < 0) return null;
  // 入れ子 table を考慮して対応する </table> を探す
  let depth = 0;
  const re = /<\/?table\b/g;
  re.lastIndex = s;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0] === '<table' ? 1 : -1;
    if (depth === 0) return html.slice(s, html.indexOf('>', m.index) + 1);
  }
  return null;
}

/** 見出しの正規表現 → 列キー で行を {key: value} にする */
function mapRows(table, colDefs, { textKeys = [] } = {}) {
  const idx = Object.fromEntries(Object.entries(colDefs).map(([k, re]) => [k, table.headers.findIndex((h) => re.test(h))]));
  const conv = (k, html) => (html === undefined ? null : textKeys.includes(k) ? stripTags(html) || null : parseNum(html));
  const data = [], yoy = {};
  for (const r of table.rows) {
    const isPeriod = /^\d{2,4}\.\d{2}(-\d{2})?$/.test(r.label);
    const rec = {};
    for (const [k, i] of Object.entries(idx)) rec[k] = i > 0 ? conv(k, r.tds[i - 1]) : null; // headers[0] は「決算期」
    if (isPeriod) data.push({ period: r.label, forecast: r.forecast, ...rec });
    else if (/前期比|前年同期比/.test(r.label)) Object.assign(yoy, Object.fromEntries(Object.entries(rec).filter(([, v]) => typeof v === 'number')));
  }
  return { rows: data, yoy: Object.keys(yoy).length ? yoy : null };
}

const PL = {
  sales: /^(売上高|営業収益|経常収益|売上収益|収益)/,
  operatingProfit: /^営業益/,
  ordinaryProfit: /^(経常益|税前益)/,
  netProfit: /^(最終益|純利益)/,
  eps: /1株益/,
};
const announced = /発表日/;

// ---- 表ごとの抽出器 ----
const EXTRACT = {
  annual(html) {
    const t = parseTable(tableAfter(html, 'fin_year_result_d'));
    const { rows: r, yoy } = mapRows(t, { ...PL, dividend: /1株配/, announced }, { textKeys: ['announced'] });
    if (!r.length) throw new Error('no rows');
    return { rows: r, yoy };
  },
  cumulative(html) {
    const blk = between(html, 'gyousekizaimu_title', '</table>');
    const h3 = stripTags((blk.match(/<h3>([\s\S]*?)<\/h3>/) ?? [])[1] ?? '');
    const qm = toHalf(h3).match(/第(\d)四半期/);
    const t = parseTable(tableAfter(html, 'gyousekizaimu_title'));
    const { rows: r, yoy } = mapRows(t, { ...PL, progressH1: /対上期進捗率/, announced }, { textKeys: ['announced'] });
    if (!r.length) throw new Error('no rows');
    return { label: h3.replace(/【実績】/, '') || null, quarter: qm ? Number(qm[1]) : null, rows: r, yoy };
  },
  quarterly(html) {
    const t = parseTable(tableAfter(html, 'fin_quarter_result_d'));
    const { rows: r, yoy } = mapRows(t, { ...PL, opMargin: /売上営業損益率|営業利益率/, announced }, { textKeys: ['announced'] });
    if (!r.length) throw new Error('no rows');
    return { rows: r, yoy };
  },
  revisions(html) {
    // 今期（予想の期）の業績予想の修正履歴。直近以外の数値は有料のため取れないことがある
    let blk = between(html, 'fin_year_forecast_d', 'fin_year_growth_d');
    blk = dropArrows(blk);
    const out = [];
    let period = null;
    const re = /<td class="td_hpd"[^>]*>\s*(\d{4}\.\d{2})\s*<\/td>|<td class="tac fs14">\s*(\d{2}\/\d{2}\/\d{2})\s*<\/td>\s*<td class="tal fs12">\s*([^<]*?)\s*<\/td>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = re.exec(blk))) {
      if (m[1]) { period = m[1]; continue; }
      const nums = [...m[4].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => parseNum(x[1]));
      out.push({ period, date: m[2], kind: m[3], sales: nums[0] ?? null, operatingProfit: nums[1] ?? null, ordinaryProfit: nums[2] ?? null, netProfit: nums[3] ?? null, dividend: nums[4] ?? null });
    }
    if (!out.length) throw new Error('no rows');
    const last = out.at(-1).period;
    const cur = out.filter((x) => x.period === last);
    // 直近の修正方向（同じ期の1つ前と比べる。数値が非公開なら null）
    let latest = null;
    if (cur.length >= 2) {
      const [a, b] = cur.slice(-2);
      const dir = (k) => (a[k] == null || b[k] == null ? null : b[k] > a[k] ? 'up' : b[k] < a[k] ? 'down' : 'flat');
      latest = { date: b.date, kind: b.kind, sales: dir('sales'), operatingProfit: dir('operatingProfit'), ordinaryProfit: dir('ordinaryProfit'), netProfit: dir('netProfit') };
    }
    return { period: last, revised: cur.some((x) => x.kind === '修'), history: cur, latest };
  },
  profitability(html) {
    const t = parseTable(tableAfter(html, 'fin_year_profit_d'));
    const { rows: r } = mapRows(t, { opMargin: /売上営業利益率/, roe: /ROE/, roa: /ROA/, assetTurnover: /総資産回転率/ });
    if (!r.length) throw new Error('no rows');
    return r;
  },
  cashflow(html) {
    const t = parseTable(tableAfter(html, 'cashflow_title'));
    const { rows: r } = mapRows(t, { fcf: /フリーCF/, operating: /営業CF/, investing: /投資CF/, financing: /財務CF/, cash: /現金等残高/, cashRatio: /現金比率/ });
    if (!r.length) throw new Error('no rows');
    return r;
  },
  balance(html) {
    const t = parseTable(tableAfter(html, '財務 【実績】'));
    const { rows: r } = mapRows(t, { bps: /1株純資産/, equityRatio: /自己資本比率/, totalAssets: /総資産/, equity: /^自己資本$/, retainedEarnings: /剰余金/, deRatio: /有利子負債倍率/, announced }, { textKeys: ['announced'] });
    if (!r.length) throw new Error('no rows');
    return r;
  },
  docs(html) {
    // 決算短信PDF（株探の開示ページへのリンク）。日付の新しい順・重複なし
    const seen = new Map();
    // url は株探の閲覧ページ（HTML）。pdf はその中で参照される PDF 本体（tdnet-pdf.kabutan.jp）で、fetch-doc に渡せる
    for (const m of html.matchAll(/<a href="(https:\/\/kabutan\.jp\/disclosures\/pdf\/(\d{8})\/(\d+)\/?)"[^>]*>/g)) {
      const d = `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}`;
      if (!seen.has(m[1])) seen.set(m[1], { date: d, url: m[1], pdf: `https://tdnet-pdf.kabutan.jp/${m[2]}/${m[3]}.pdf` });
    }
    const out = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!out.length) throw new Error('none');
    return out.slice(0, 8);
  },
};

const LABELS = { annual: '通期業績', cumulative: '四半期累計業績', quarterly: '3か月業績', revisions: '業績予想の修正履歴', profitability: '収益性', cashflow: 'キャッシュフロー', balance: '財務', docs: '決算短信PDFのリンク' };

/** 累計の期（例 "26.04-06"）の決算年度末を "2027.03" の形で返す */
export function fiscalEndOf(cumPeriod) {
  const m = cumPeriod?.match(/^(\d{2})\.(\d{2})-\d{2}$/);
  if (!m) return null;
  const start = new Date(Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1 + 11, 1));
  return `${start.getUTCFullYear()}.${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 通期予想に対する累計の進捗率（計算できる範囲） */
export function computeProgress(annual, cumulative) {
  const fc = annual?.rows?.find((r) => r.forecast);
  const cur = cumulative?.rows?.at(-1);
  if (!fc || !cur) return null;
  const fy = fiscalEndOf(cur.period);
  if (fy !== fc.period) return null; // 累計が予想の期と一致しない（決算期変更など）
  const q = cumulative.quarter;
  const items = [['sales', '売上高'], ['operatingProfit', '営業益'], ['ordinaryProfit', '経常益'], ['netProfit', '最終益']].map(([k, label]) => ({
    key: k,
    label,
    actual: cur[k],
    forecast: fc[k],
    pct: cur[k] != null && fc[k] ? Math.round((cur[k] / fc[k]) * 1000) / 10 : null,
  }));
  return { fiscalYear: fc.period, cumulativePeriod: cur.period, quarter: q, pace: q ? q * 25 : null, items };
}

/** 株探 決算ページHTML → finance（純粋関数） */
export function parseFinance(html, code) {
  const fin = { code, name: null, units: { money: '百万円', perShare: '円', ratio: '%', deRatio: '倍' } };
  const missing = [];
  const errors = {};
  try {
    const h2 = html.match(/<div class="si_i1_1">\s*<h2>([\s\S]*?)<\/h2>/) ?? html.match(/<h2><span class="inline-block">\w+<\/span>[\s\S]*?<\/h2>/);
    fin.name = stripTags(h2[1] ?? h2[0]).replace(code, '').trim() || null;
  } catch {
    fin.name = null;
  }
  for (const [key, fn] of Object.entries(EXTRACT)) {
    try {
      fin[key] = fn(html);
    } catch (e) {
      fin[key] = null;
      errors[key] = e.message;
      missing.push(LABELS[key]);
    }
  }
  fin.progress = computeProgress(fin.annual, fin.cumulative);
  if (!fin.progress) missing.push('通期予想に対する進捗率（予想または累計が取れない）');
  if (fin.revisions?.revised && !['sales', 'operatingProfit', 'ordinaryProfit', 'netProfit'].some((k) => fin.revisions.latest?.[k])) {
    missing.push('直近の業績予想の修正方向（数値が非公開）');
  }
  const ann = fin.annual?.rows ?? [];
  for (const [k, l] of [['sales', '売上高'], ['operatingProfit', '営業益'], ['netProfit', '最終益'], ['dividend', '1株配']]) {
    const nulls = ann.filter((r) => r[k] === null);
    if (!nulls.length) continue;
    if (nulls.length === ann.length) missing.push(`通期 ${l}（株探に掲載なし）`);
    else for (const r of nulls) missing.push(`通期 ${r.period}${r.forecast ? '予' : ''} ${l}`);
  }
  fin.source = { title: `株探 ${fin.name ?? code} 決算`, url: financeUrl(code) };
  fin.missing = missing;
  if (Object.keys(errors).length) fin.parseErrors = errors;
  return fin;
}

export async function fetchFinance(code, { fetcher = defaultFetcher(), saveHtml } = {}) {
  checkCode(code);
  const html = await fetcher.text(financeUrl(code), { accept: 'text/html' });
  if (saveHtml) writeText(saveHtml, html);
  if (!html.includes('fin_year_result_d') && !html.includes('gyousekizaimu_title')) {
    throw new Error(`株探の決算ページの構造が想定と異なります（業績表が見つからない）: ${financeUrl(code)}`);
  }
  const fin = parseFinance(html, code);
  fin.fetchedAt = new Date().toISOString();
  return fin;
}

export function financePath(code) {
  return join(ROOT, 'data', 'stocks', code, 'finance.json');
}

if (isMain(import.meta.url)) {
  const code = process.argv[2];
  const si = process.argv.indexOf('--save-html');
  try {
    const fin = await fetchFinance(checkCode(code), { saveHtml: si > 0 ? process.argv[si + 1] : undefined });
    writeJson(financePath(code), fin);
    console.log(`${financePath(code)}（未取得: ${fin.missing.join('、') || 'なし'}）`);
  } catch (e) {
    fail(`株探（決算）の取得に失敗しました: ${e.message}`);
  }
}
