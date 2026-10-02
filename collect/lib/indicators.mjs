// 指標計算（純粋関数のみ）。入力 rows は日付昇順の [{d,o,h,l,c,v}]。
// 値がまだ計算できない位置は null を返す。

export const MA_PERIODS = [5, 25, 75, 200];
export const CROSS_PAIRS = [[5, 25], [25, 75], [75, 200]];

const round = (x, n = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);

/** 単純移動平均。返り値は values と同じ長さ（先頭 n-1 個は null） */
export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** 乖離率(%) = (価格 − 移動平均) ÷ 移動平均 × 100 */
export function deviationPct(price, ma) {
  if (ma == null || !Number.isFinite(ma) || ma === 0) return null;
  return ((price - ma) / ma) * 100;
}

/** RSI（Wilder の平滑化）。先頭 n 個は null */
export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let ag = gain / n, al = loss / n;
  const val = () => (al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al));
  out[n] = val();
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

/** 最終日の出来高 ÷ その前20日の平均出来高 */
export function volumeRatio(rows, n = 20) {
  if (rows.length < n + 1) return null;
  const prev = rows.slice(-n - 1, -1);
  const avg = prev.reduce((s, r) => s + r.v, 0) / n;
  return avg === 0 ? null : rows.at(-1).v / avg;
}

/**
 * スイング高値・安値。高値: 前後 k 日の高値より高い（左は厳密に上、右は以上）足。安値は逆。
 * 直近 lookback 本の範囲で判定し、前後 k 日がそろわない端の足は対象外。
 */
export function swings(rows, { k = 8, lookback = 250 } = {}) {
  const start = Math.max(0, rows.length - lookback);
  const highs = [], lows = [];
  for (let i = start + k; i < rows.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k && (isH || isL); j++) {
      if (j === i) continue;
      if (j < i ? rows[j].h >= rows[i].h : rows[j].h > rows[i].h) isH = false;
      if (j < i ? rows[j].l <= rows[i].l : rows[j].l < rows[i].l) isL = false;
    }
    if (isH) highs.push({ d: rows[i].d, price: rows[i].h });
    if (isL) lows.push({ d: rows[i].d, price: rows[i].l });
  }
  return { highs, lows };
}

/** 価格帯の刻み: 終値の約2%を 1・2・5×10^n に丸めた幅 */
export function binStep(price) {
  const raw = price * 0.02;
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const cands = [1, 2, 5, 10].map((m) => m * p);
  return cands.reduce((best, c) => (Math.abs(Math.log(c / raw)) < Math.abs(Math.log(best / raw)) ? c : best));
}

/**
 * 価格帯別出来高（直近 lookback 本）。各日の出来高をその日の安値〜高値に重なる帯へ、重なり幅に比例して配る。
 * 返り値 bins は価格の低い順。share は全体に占める割合(%)。
 */
export function volumeProfile(rows, { lookback = 250, step } = {}) {
  const rs = rows.slice(-lookback);
  if (rs.length === 0) return { step: null, bins: [] };
  const st = step ?? binStep(rs.at(-1).c);
  const minP = Math.min(...rs.map((r) => r.l));
  const maxP = Math.max(...rs.map((r) => r.h));
  const base = Math.floor(minP / st) * st;
  const nb = Math.max(1, Math.floor((maxP - base) / st) + 1);
  const vol = new Array(nb).fill(0);
  for (const r of rs) {
    if (r.h <= r.l) {
      vol[Math.min(nb - 1, Math.floor((r.c - base) / st))] += r.v;
      continue;
    }
    const b0 = Math.floor((r.l - base) / st), b1 = Math.min(nb - 1, Math.floor((r.h - base) / st));
    for (let b = b0; b <= b1; b++) {
      const lo = Math.max(r.l, base + b * st), hi = Math.min(r.h, base + (b + 1) * st);
      if (hi > lo) vol[b] += (r.v * (hi - lo)) / (r.h - r.l);
    }
  }
  const total = vol.reduce((s, x) => s + x, 0) || 1;
  const bins = vol.map((v, b) => ({ from: base + b * st, to: base + (b + 1) * st, volume: Math.round(v), share: round((v / total) * 100, 1) }));
  return { step: st, bins };
}

/**
 * 窓（ギャップ）。上窓: 当日安値 > 前日高値 かつ その差が前日高値の threshold% 以上。下窓は逆。
 * filled: その後の足が窓を埋めた（上窓なら安値が前日高値以下に戻った）か。
 */
export function gaps(rows, { thresholdPct = 1.5, lookback = 250 } = {}) {
  const start = Math.max(1, rows.length - lookback);
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const p = rows[i - 1], r = rows[i];
    if (r.l > p.h && ((r.l - p.h) / p.h) * 100 >= thresholdPct) {
      const filled = rows.slice(i + 1).some((x) => x.l <= p.h);
      out.push({ d: r.d, dir: 'up', from: p.h, to: r.l, pct: round(((r.l - p.h) / p.h) * 100), filled });
    } else if (r.h < p.l && ((p.l - r.h) / p.l) * 100 >= thresholdPct) {
      const filled = rows.slice(i + 1).some((x) => x.h >= p.l);
      out.push({ d: r.d, dir: 'down', from: p.l, to: r.h, pct: round(((r.h - p.l) / p.l) * 100), filled });
    }
  }
  return out;
}

/** 2本の系列のクロス。GC: 前日 短≦長 → 当日 短>長。DC: 前日 短≧長 → 当日 短<長 */
export function crosses(short, long, dates) {
  const out = [];
  for (let i = 1; i < dates.length; i++) {
    const [s0, l0, s1, l1] = [short[i - 1], long[i - 1], short[i], long[i]];
    if ([s0, l0, s1, l1].some((x) => x == null)) continue;
    if (s0 <= l0 && s1 > l1) out.push({ d: dates[i], type: 'GC' });
    else if (s0 >= l0 && s1 < l1) out.push({ d: dates[i], type: 'DC' });
  }
  return out;
}

/** 終値が移動平均を上抜け(up)/下抜け(down)した日 */
export function priceCrosses(closes, ma, dates) {
  return crosses(closes, ma, dates).map((x) => ({ d: x.d, dir: x.type === 'GC' ? 'up' : 'down' }));
}

/** 52週高値・安値（最終日から365日以内の足の高値・安値） */
export function high52(rows) {
  if (rows.length === 0) return null;
  const last = new Date(rows.at(-1).d + 'T00:00:00Z');
  const from = new Date(last.getTime() - 364 * 86400000).toISOString().slice(0, 10);
  const rs = rows.filter((r) => r.d >= from);
  let hi = rs[0], lo = rs[0];
  for (const r of rs) {
    if (r.h >= hi.h) hi = r;
    if (r.l <= lo.l) lo = r;
  }
  return { high: hi.h, highDate: hi.d, low: lo.l, lowDate: lo.d };
}

/** まとめて計算 */
export function computeAll(rows) {
  if (!rows?.length) throw new Error('株価データが空です');
  const closes = rows.map((r) => r.c);
  const dates = rows.map((r) => r.d);
  const last = rows.at(-1);
  const prev = rows.at(-2) ?? null;
  const maSeries = Object.fromEntries(MA_PERIODS.map((n) => [n, sma(closes, n)]));
  const ma = MA_PERIODS.map((n) => {
    const v = maSeries[n].at(-1);
    const v5ago = maSeries[n].at(-6) ?? null;
    return {
      n,
      value: round(v, 1),
      deviationPct: round(deviationPct(last.c, v)),
      slope: v == null || v5ago == null ? null : v > v5ago ? 'up' : v < v5ago ? 'down' : 'flat',
    };
  });
  const crossList = CROSS_PAIRS.map(([a, b]) => ({ pair: `${a}/${b}`, events: crosses(maSeries[a], maSeries[b], dates) }));
  const priceX = [75, 200].map((n) => ({ n, events: priceCrosses(closes, maSeries[n], dates) }));
  return {
    asOf: last.d,
    close: last.c,
    change: prev ? round(last.c - prev.c, 1) : null,
    changePct: prev ? round(((last.c - prev.c) / prev.c) * 100) : null,
    bars: rows.length,
    ma,
    rsi14: round(rsi(closes, 14).at(-1), 1),
    volumeRatio20: round(volumeRatio(rows, 20)),
    swings: swings(rows, { k: 8, lookback: 250 }),
    volumeProfile: volumeProfile(rows, { lookback: 250 }),
    gaps: gaps(rows, { thresholdPct: 1.5, lookback: 250 }),
    crosses: crossList,
    priceCrosses: priceX,
    week52: high52(rows),
    last20: rows.slice(-20),
  };
}
