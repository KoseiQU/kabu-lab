// 分析JSONの検証: node tools/validate.mjs <file.json>
// type（quick / chart / kessan / market / news / hansei / yougo）を見て schemas/<type>.schema.json を選ぶ。未知の型は NG。
// yougo（用語）は骨格が別（kabu-term@1）で、sources は任意。
// JSON Schema（draft-07 の一部: type, required, properties, items, enum, minItems, maxItems,
// minimum, maximum, minLength, maxLength, pattern）＋ 意味検証（順序・種別・禁止語）。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BANNED_WORDS = ['買い推奨', '売り推奨', '買うべき', '売るべき', '今が買い', '今が売り'];
// 反省型だけに足す断定語（「いま売るべきか」に答えない。振り返りと次回の確認点だけ）
export const HANSEI_BANNED_WORDS = ['損切りすべき', '利確すべき', '利益確定すべき', '買い増しすべき', 'ナンピンすべき', '手放すべき', '持ち続けるべき', '保有し続けるべき', '売り時です', '買い時です'];

/** 用語型のファイル名（拡張子なし）: / \ : * ? " < > | と空白を _ に置換（DESIGN.md §5.7） */
export function termFileName(term) {
  return String(term ?? '').replace(/[\/\\:*?"<>|\s]/gu, '_');
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

/** 自作の最小 JSON Schema バリデータ。errors: [{path, message}] */
export function validateSchema(value, schema, path = '$', errors = []) {
  if (!schema || typeof schema !== 'object') return errors;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push({ path, message: `型が違います（期待: ${types.join('|')}、実際: ${typeOf(value)}）` });
      return errors;
    }
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push({ path, message: `値 ${JSON.stringify(value)} は許可されていません（${schema.enum.join(', ')}）` });
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push({ path, message: `${value} は最小値 ${schema.minimum} 未満` });
    if (schema.maximum != null && value > schema.maximum) errors.push({ path, message: `${value} は最大値 ${schema.maximum} 超` });
  }
  if (typeof value === 'string') {
    const len = [...value].length;
    if (schema.minLength != null && len < schema.minLength) errors.push({ path, message: `文字数 ${len} は最小 ${schema.minLength} 未満` });
    if (schema.maxLength != null && len > schema.maxLength) errors.push({ path, message: `文字数 ${len} は上限 ${schema.maxLength} 超` });
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push({ path, message: `形式 /${schema.pattern}/ に合いません: ${JSON.stringify(value)}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push({ path, message: `要素数 ${value.length} は最小 ${schema.minItems} 未満` });
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push({ path, message: `要素数 ${value.length} は上限 ${schema.maxItems} 超` });
    if (schema.items) value.forEach((v, i) => validateSchema(v, schema.items, `${path}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) {
      if (!(k in value)) errors.push({ path, message: `必須キー "${k}" がありません` });
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in value) validateSchema(value[k], sub, `${path}.${k}`, errors);
    }
  }
  return errors;
}

/** 全文字列フィールドを巡回 */
function* strings(v, path = '$') {
  if (typeof v === 'string') yield [path, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${path}[${i}]`);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) yield* strings(x, `${path}.${k}`);
}

export function loadSchema(type, root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'schemas', `${type}.schema.json`), 'utf8'));
}
export function loadChecklistItems(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'schemas', 'checklist-items.json'), 'utf8'));
}

const arrOf = (x) => (Array.isArray(x) ? x : []);

/** 配列の key 列が want と完全に一致（件数・順序）するか */
function exactOrder(errors, path, list, field, want, what) {
  const got = arrOf(list).map((x) => x?.[field]);
  if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
    errors.push({ path, message: `${what}は ${want.join('→')} の${want.length}件をこの順で（実際: ${got.join(',') || 'なし'}）` });
  }
}

/** checklist: 10件固定・C01〜C10 の順 */
function checklistErrors(errors, cl, checklistItems) {
  const ids = checklistItems.map((x) => x.id);
  const list = arrOf(cl);
  if (list.length !== ids.length) errors.push({ path: '$.sections.checklist', message: `チェックリストは${ids.length}件固定です（実際: ${list.length}件）` });
  list.forEach((c, i) => {
    if (c?.id !== ids[i]) errors.push({ path: `$.sections.checklist[${i}].id`, message: `順序が違います（期待: ${ids[i] ?? 'なし'}、実際: ${c?.id}）` });
  });
}

/** 型ごとの意味検証 */
const TYPE_RULES = {
  quick(a, errors, ctx) {
    const s = a.sections ?? {};
    checklistErrors(errors, s.checklist, ctx.checklistItems);
    // diagnosis: quality/value/supply/trend の4件
    const dk = arrOf(s.diagnosis).map((d) => d?.key);
    const wantD = ['quality', 'value', 'supply', 'trend'];
    if (dk.length !== 4 || !wantD.every((k) => dk.filter((x) => x === k).length === 1)) {
      errors.push({ path: '$.sections.diagnosis', message: `4点診断は ${wantD.join('/')} を1件ずつ（実際: ${dk.join(',') || 'なし'}）` });
    }
    // scenarios: bull/base/bear の3件
    const sk = arrOf(s.scenarios).map((x) => x?.kind);
    const wantS = ['bull', 'base', 'bear'];
    if (sk.length !== 3 || !wantS.every((k) => sk.filter((x) => x === k).length === 1)) {
      errors.push({ path: '$.sections.scenarios', message: `シナリオは ${wantS.join('/')} を1件ずつ（実際: ${sk.join(',') || 'なし'}）` });
    }
    arrOf(s.scenarios).forEach((x, i) => {
      const t = x?.target ?? {};
      if (t.low != null && t.high != null && t.low > t.high) errors.push({ path: `$.sections.scenarios[${i}].target`, message: 'low が high より大きい' });
    });
    // segments を省いたら missing に理由が必要
    if (!('segments' in s) && !(Array.isArray(a?.missing) && a.missing.length > 0)) {
      errors.push({ path: '$.sections.segments', message: 'segments を省く場合は missing に未取得の理由を書いてください' });
    }
  },
  chart(a, errors, ctx) {
    const s = a.sections ?? {};
    checklistErrors(errors, s.checklist, ctx.checklistItems);
    arrOf(s.checklist).forEach((c, i) => {
      const w = c?.watch;
      if (c?.status === 'progress' && !(typeof w === 'string' && w.length > 0)) errors.push({ path: `$.sections.checklist[${i}].watch`, message: '進行中の項目は watch（次に見る点）が必要です' });
      if (c?.status !== 'progress' && typeof w === 'string' && w.length > 0) errors.push({ path: `$.sections.checklist[${i}].watch`, message: '進行中以外の項目の watch は空文字にしてください' });
    });
    exactOrder(errors, '$.sections.timeframes', s.timeframes, 'frame', ['monthly', 'weekly', 'daily'], '時間軸');
    exactOrder(errors, '$.sections.heat', s.heat, 'key', ['ma25dev', 'rsi', 'change3d', 'volume'], '過熱の物差し');
    exactOrder(errors, '$.sections.plans', s.plans, 'kind', ['pullback', 'breakout', 'wait'], '考え方のプラン');
    arrOf(s.levels).forEach((l, i) => {
      if (typeof l?.low === 'number' && typeof l?.high === 'number' && l.low > l.high) errors.push({ path: `$.sections.levels[${i}]`, message: `low(${l.low}) が high(${l.high}) より大きい` });
    });
    arrOf(s.plans).forEach((p, i) => {
      const z = p?.zone ?? {};
      if (typeof z.low === 'number' && typeof z.high === 'number' && z.low > z.high) errors.push({ path: `$.sections.plans[${i}].zone`, message: 'low が high より大きい' });
    });
  },
  kessan(a, errors) {
    const s = a.sections ?? {};
    if (arrOf(s.points).length !== 3) errors.push({ path: '$.sections.points', message: `判定の理由は3件固定です（実際: ${arrOf(s.points).length}件）` });
    const pct = s.progress?.pct;
    if (typeof pct === 'number' && (pct < 0 || pct > 200)) errors.push({ path: '$.sections.progress.pct', message: `進捗率 ${pct} は 0〜200 の範囲外` });
    const keys = arrOf(s.results).map((r) => r?.key);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dup.length) errors.push({ path: '$.sections.results', message: `key が重複しています: ${[...new Set(dup)].join(', ')}` });
  },
  market(a, errors) {
    const s = a.sections ?? {};
    exactOrder(errors, '$.sections.outlook', s.outlook, 'kind', ['bull', 'base', 'bear'], '見通し');
    targetErrors(errors, '$.sections.outlook', s.outlook, true);
    uniqueKeys(errors, '$.sections.level.gauges', s.level?.gauges, 'key');
    uniqueKeys(errors, '$.sections.rates.items', s.rates?.items, 'key');
    // geo: 5件固定・影響の大きい順（level が増えない）
    const geo = arrOf(s.geo);
    if (geo.length !== 5) errors.push({ path: '$.sections.geo', message: `地政学ランキングは5件固定です（実際: ${geo.length}件）` });
    geo.forEach((g, i) => {
      if (i > 0 && typeof g?.level === 'number' && typeof geo[i - 1]?.level === 'number' && g.level > geo[i - 1].level) {
        errors.push({ path: `$.sections.geo[${i}].level`, message: `影響の大きい順に並べてください（${i}位 ${geo[i - 1].level} < ${i + 1}位 ${g.level}）` });
      }
    });
    ascendingDates(errors, '$.sections.calendar', s.calendar, (c) => c?.date, '予定');
    if (isDate(a.price?.asOf) && isDate(a.date) && a.price.asOf > a.date) errors.push({ path: '$.price.asOf', message: `基準日 ${a.price.asOf} が分析日 ${a.date} より後です` });
  },
  news(a, errors) {
    const s = a.sections ?? {};
    const f = arrOf(s.impact?.factors);
    if (f.length < 2 || f.length > 4) errors.push({ path: '$.sections.impact.factors', message: `長引くかどうかを分ける要因は2〜4件です（実際: ${f.length}件）` });
    const r = s.reaction ?? {};
    const fd = r.from?.date, td = r.to?.date, ed = s.event?.date;
    if (isDate(fd) && isDate(td) && fd > td) errors.push({ path: '$.sections.reaction', message: `from の日付 ${fd} が to の日付 ${td} より後です` });
    if (isDate(fd) && isDate(ed) && fd > ed) errors.push({ path: '$.sections.reaction.from.date', message: `from（出来事の前日の終値）${fd} が出来事の日 ${ed} より後です` });
    const fp = r.from?.price, tp = r.to?.price;
    if (isNum(fp) && fp > 0 && isNum(tp) && isNum(r.changePct)) {
      const calc = ((tp - fp) / fp) * 100;
      if (Math.abs(calc - r.changePct) > 0.15) errors.push({ path: '$.sections.reaction.changePct', message: `騰落率 ${r.changePct}% が from/to の価格から計算した ${calc.toFixed(2)}% と合いません` });
    }
    // 出典（url）のない過去事例には数字を入れない（数字の捏造・推測での穴埋め禁止）
    arrOf(s.cases).forEach((c, i) => {
      if (c && c.url == null) {
        for (const k of ['dropPct', 'days', 'recoveryMonths']) {
          if (c[k] != null) errors.push({ path: `$.sections.cases[${i}].${k}`, message: `出典（url）のない事例に数字 ${k} は入れられません（null にする）` });
        }
      }
    });
    if (isDate(ed) && isDate(a.date) && ed > a.date) errors.push({ path: '$.sections.event.date', message: `出来事の日 ${ed} が分析日 ${a.date} より後です` });
  },
  hansei(a, errors) {
    const s = a.sections ?? {};
    exactOrder(errors, '$.sections.at', s.at, 'key', ['ma25dev', 'rsi', 'change3d', 'volume'], '買った日の過熱の物差し');
    const e = s.entry ?? {}, r = s.result ?? {};
    if (isNum(e.price) && e.price <= 0) errors.push({ path: '$.sections.entry.price', message: '購入価格は0より大きい数' });
    if (isDate(e.date) && isDate(r.asOf) && e.date > r.asOf) errors.push({ path: '$.sections.entry.date', message: `購入日 ${e.date} が最終取引日 ${r.asOf} より後です` });
    for (const k of ['Up', 'Down']) {
      const pct = r[`max${k}Pct`], d = r[`max${k}Date`];
      if ((pct == null) !== (d == null)) errors.push({ path: `$.sections.result.max${k}Date`, message: `max${k}Pct と max${k}Date は両方そろえる（片方だけ null は不可）` });
      if (isDate(d) && ((isDate(e.date) && d <= e.date) || (isDate(r.asOf) && d > r.asOf))) errors.push({ path: `$.sections.result.max${k}Date`, message: `${d} が購入日より後〜最終取引日の範囲外です` });
    }
    if (isNum(r.pnlPct)) {
      if (isNum(r.maxUpPct) && r.maxUpPct < r.pnlPct - 0.01) errors.push({ path: '$.sections.result.maxUpPct', message: `最大含み益 ${r.maxUpPct}% が現在の損益率 ${r.pnlPct}% より小さい` });
      if (isNum(r.maxDownPct) && r.maxDownPct > r.pnlPct + 0.01) errors.push({ path: '$.sections.result.maxDownPct', message: `最大含み損 ${r.maxDownPct}% が現在の損益率 ${r.pnlPct}% より大きい` });
    }
    const sp = s.position?.support?.price, rp = s.position?.resistance?.price;
    if (isNum(sp) && isNum(rp) && sp > rp) errors.push({ path: '$.sections.position', message: `support(${sp}) が resistance(${rp}) より上です` });
    arrOf(s.alt).forEach((x, i) => lowHigh(errors, `$.sections.alt[${i}].zone`, x?.zone));
    arrOf(s.chart?.levels).forEach((x, i) => lowHigh(errors, `$.sections.chart.levels[${i}]`, x));
    for (const [path, str] of strings(a)) {
      for (const w of HANSEI_BANNED_WORDS) if (str.includes(w)) errors.push({ path, message: `禁止語「${w}」が含まれています（反省型は売買の判断をしない）` });
    }
  },
  yougo(a, errors) {
    const flow = arrOf(a.flow);
    if (flow.length < 2 || flow.length > 5) errors.push({ path: '$.flow', message: `因果の流れ図は2〜5件です（実際: ${flow.length}件）` });
    const rel = arrOf(a.related);
    if (rel.includes(a.term)) errors.push({ path: '$.related', message: `関連語に用語自身「${a.term}」が入っています` });
    const dup = rel.filter((x, i) => rel.indexOf(x) !== i);
    if (dup.length) errors.push({ path: '$.related', message: `関連語が重複しています: ${[...new Set(dup)].join(', ')}` });
    if (typeof a.term === 'string' && termFileName(a.term) === '') errors.push({ path: '$.term', message: '用語が空です' });
  },
};

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

function lowHigh(errors, path, o) {
  if (isNum(o?.low) && isNum(o?.high) && o.low > o.high) errors.push({ path, message: `low(${o.low}) が high(${o.high}) より大きい` });
}
/** シナリオの目安: low<=high。needNumber なら price か low/high の数値が必要（答え合わせに使う） */
function targetErrors(errors, path, list, needNumber) {
  arrOf(list).forEach((x, i) => {
    const t = x?.target ?? {};
    lowHigh(errors, `${path}[${i}].target`, t);
    if (needNumber && !isNum(t.price) && !(isNum(t.low) && isNum(t.high))) errors.push({ path: `${path}[${i}].target`, message: '目安には price か low/high の数値が必要です（答え合わせに使う）' });
  });
}
function uniqueKeys(errors, path, list, field) {
  const keys = arrOf(list).map((x) => x?.[field]);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dup.length) errors.push({ path, message: `${field} が重複しています: ${[...new Set(dup)].join(', ')}` });
}
function ascendingDates(errors, path, list, get, what) {
  const ds = arrOf(list).map(get);
  for (let i = 1; i < ds.length; i++) {
    if (isDate(ds[i]) && isDate(ds[i - 1]) && ds[i] < ds[i - 1]) errors.push({ path: `${path}[${i}]`, message: `${what}は日付の古い順に並べてください（${ds[i - 1]} → ${ds[i]}）` });
  }
}
export const SUPPORTED_TYPES = Object.keys(TYPE_RULES);

/** 意味検証: 共通（禁止語・sources）＋型ごと */
export function semanticErrors(a, { checklistItems = loadChecklistItems() } = {}) {
  const errors = [];
  // 禁止語（全文字列フィールド）
  for (const [path, str] of strings(a)) {
    for (const w of BANNED_WORDS) if (str.includes(w)) errors.push({ path, message: `禁止語「${w}」が含まれています（売買の断定はしない）` });
  }
  // 出典: 分析（kabu-analysis@1）は1件以上必須。用語（yougo）は任意
  if (a?.type !== 'yougo' && (!Array.isArray(a?.sources) || a.sources.length < 1)) errors.push({ path: '$.sources', message: '出典が1件以上必要です' });
  TYPE_RULES[a?.type]?.(a, errors, { checklistItems });
  return errors;
}

/** 分析JSON（オブジェクト）を検証して errors を返す */
export function validateAnalysis(a, { root = ROOT } = {}) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return [{ path: '$', message: 'JSONオブジェクトではありません' }];
  if (!SUPPORTED_TYPES.includes(a.type)) {
    return [{ path: '$.type', message: `未対応の型です: ${JSON.stringify(a.type)}（対応: ${SUPPORTED_TYPES.join(', ')}）` }];
  }
  let schema;
  try {
    schema = loadSchema(a.type, root);
  } catch (e) {
    return [{ path: '$.type', message: `型 ${a.type} のスキーマを読めません: schemas/${a.type}.schema.json (${e.message})` }];
  }
  return [...validateSchema(a, schema), ...semanticErrors(a, { checklistItems: loadChecklistItems(root) })];
}

/** パスの解決: 絶対パス／今いる場所からの相対パス。見つからなければ src からの相対パスも試す */
export function resolveInput(file) {
  if (isAbsolute(file) || existsSync(file)) return resolve(file);
  const fromSrc = resolve(ROOT, file);
  return existsSync(fromSrc) ? fromSrc : resolve(file);
}

/**
 * 保存場所とファイル名の検査（data/ 配下の置き場所だけ。フィクスチャ等は対象外）
 * - analyses/<日付>-<型>.json: 型が中身の type と一致
 * - market/<日付>.json: 市場型の分析（日付は実行日。§5.9）
 * - glossary/<用語>.json: ファイル名が termFileName(term)
 */
export function placementErrors(path, a) {
  const dir = basename(dirname(path)), f = basename(path);
  const errors = [];
  if (dir === 'analyses') {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-([a-z]+)\.json$/);
    if (!m) errors.push({ path: '$', message: `分析ファイル名は <日付>-<型>.json にしてください: ${f}` });
    else if (m[2] !== a?.type) errors.push({ path: '$.type', message: `ファイル名の型「${m[2]}」と中身の type「${a?.type}」が食い違っています` });
    if (a?.type === 'market' || a?.type === 'yougo') errors.push({ path: '$.type', message: `${a.type} 型は analyses/ ではなく ${a.type === 'market' ? 'data/market/<日付>.json' : 'data/glossary/<用語>.json'} に置きます` });
  } else if (dir === 'market' && a?.type === 'market') {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) errors.push({ path: '$', message: `市場型のファイル名は <日付>.json（実行日）にしてください: ${f}` });
  } else if (dir === 'glossary' && a?.type === 'yougo') {
    const want = `${termFileName(a.term)}.json`;
    if (f !== want) errors.push({ path: '$', message: `用語のファイル名は ${want} にしてください（実際: ${f}）` });
  }
  return errors;
}

export function validateFile(file) {
  let a;
  const path = resolveInput(file);
  try {
    a = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return [{ path: '$', message: `JSONとして読めません: ${e.message}` }];
  }
  return [...validateAnalysis(a), ...placementErrors(path, a)];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const file = process.argv[2];
  if (!file) {
    console.error('使い方: node tools/validate.mjs <分析JSON>');
    process.exit(1);
  }
  const errors = validateFile(file);
  if (errors.length === 0) {
    console.log(`OK ${file}`);
  } else {
    console.log(`NG ${file}（${errors.length}件）`);
    for (const e of errors) console.log(`  - ${e.path}: ${e.message}`);
    process.exit(1);
  }
}
