// 分析JSONの検証: node tools/validate.mjs <file.json>
// JSON Schema（draft-07 の一部: type, required, properties, items, enum, minItems, maxItems,
// minimum, maximum, minLength, maxLength, pattern）＋ 意味検証（順序・種別・禁止語）。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BANNED_WORDS = ['買い推奨', '売り推奨', '買うべき', '売るべき', '今が買い', '今が売り'];

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

/** 意味検証（quick 型） */
export function semanticErrors(a, { checklistItems = loadChecklistItems() } = {}) {
  const errors = [];
  const s = a?.sections ?? {};
  // 禁止語
  for (const [path, str] of strings(a)) {
    for (const w of BANNED_WORDS) if (str.includes(w)) errors.push({ path, message: `禁止語「${w}」が含まれています（売買の断定はしない）` });
  }
  // sources
  if (!Array.isArray(a?.sources) || a.sources.length < 1) errors.push({ path: '$.sources', message: '出典が1件以上必要です' });
  if (a?.type === 'quick') {
    // checklist: 10件固定・C01〜C10 の順
    const ids = checklistItems.map((x) => x.id);
    const cl = Array.isArray(s.checklist) ? s.checklist : [];
    if (cl.length !== ids.length) errors.push({ path: '$.sections.checklist', message: `チェックリストは${ids.length}件固定です（実際: ${cl.length}件）` });
    cl.forEach((c, i) => {
      if (c?.id !== ids[i]) errors.push({ path: `$.sections.checklist[${i}].id`, message: `順序が違います（期待: ${ids[i] ?? 'なし'}、実際: ${c?.id}）` });
    });
    // diagnosis: quality/value/supply/trend の4件
    const dk = (Array.isArray(s.diagnosis) ? s.diagnosis : []).map((d) => d?.key);
    const wantD = ['quality', 'value', 'supply', 'trend'];
    if (dk.length !== 4 || !wantD.every((k) => dk.filter((x) => x === k).length === 1)) {
      errors.push({ path: '$.sections.diagnosis', message: `4点診断は ${wantD.join('/')} を1件ずつ（実際: ${dk.join(',') || 'なし'}）` });
    }
    // scenarios: bull/base/bear の3件
    const sk = (Array.isArray(s.scenarios) ? s.scenarios : []).map((x) => x?.kind);
    const wantS = ['bull', 'base', 'bear'];
    if (sk.length !== 3 || !wantS.every((k) => sk.filter((x) => x === k).length === 1)) {
      errors.push({ path: '$.sections.scenarios', message: `シナリオは ${wantS.join('/')} を1件ずつ（実際: ${sk.join(',') || 'なし'}）` });
    }
    (Array.isArray(s.scenarios) ? s.scenarios : []).forEach((x, i) => {
      const t = x?.target ?? {};
      if (t.low != null && t.high != null && t.low > t.high) errors.push({ path: `$.sections.scenarios[${i}].target`, message: 'low が high より大きい' });
    });
    // segments を省いたら missing に理由が必要
    if (!('segments' in s) && !(Array.isArray(a?.missing) && a.missing.length > 0)) {
      errors.push({ path: '$.sections.segments', message: 'segments を省く場合は missing に未取得の理由を書いてください' });
    }
  }
  return errors;
}

/** 分析JSON（オブジェクト）を検証して errors を返す */
export function validateAnalysis(a, { root = ROOT } = {}) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return [{ path: '$', message: 'JSONオブジェクトではありません' }];
  let schema;
  try {
    schema = loadSchema(a.type, root);
  } catch {
    return [{ path: '$.type', message: `未対応の型です: ${JSON.stringify(a.type)}（schemas/${a.type}.schema.json がない）` }];
  }
  return [...validateSchema(a, schema), ...semanticErrors(a, { checklistItems: loadChecklistItems(root) })];
}

export function validateFile(file) {
  let a;
  try {
    a = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return [{ path: '$', message: `JSONとして読めません: ${e.message}` }];
  }
  return validateAnalysis(a);
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
