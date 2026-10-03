// デスクトップの単体ビューア（build.mjs）の機械テスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildViewerHtml, escapeInlineScript, resolveViewerPath, writeAtomic, dataJsText, expandHome } from '../build.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, '..', 'data');
const sampleKabu = { generatedAt: '2026-10-03T00:00:00.000Z', stocks: {}, market: null, glossary: [], notes: [], checklistItems: [], note: '</script><!-- x' };

test('ビューア: styles・data・charts・app を埋め込み、相対パスの外部参照を残さない', () => {
  const html = buildViewerHtml({ dataJs: dataJsText(sampleKabu) });
  assert.match(html, /^<!DOCTYPE html>\n<!-- このファイルは build が自動生成します/);
  assert.match(html, /<title>KABU LAB<\/title>/);
  assert.match(html, /window\.KABU = /);
  assert.match(html, /<style>/);
  // インライン化した script・style の中身（コメント内の文字列など）は対象外にして、タグとして残った参照だけを調べる
  const shell = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  const refs = [...shell.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
  for (const u of refs) assert.ok(/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u) || u.startsWith('data:'), `外部参照が残っている: ${u}`);
  assert.ok(!/<script\b[^>]*\bsrc=/.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')), 'src つきの script タグが残っている');
});

test('ビューア: test-hooks の中身を含まない', () => {
  const html = buildViewerHtml({ dataJs: dataJsText(sampleKabu) });
  assert.ok(!html.includes('__KABU_TEST ='), 'test-hooks.js が埋め込まれている');
  assert.ok(!html.includes('test-hooks.js"></script>'));
});

test('ビューア: データ中の </script> と <!-- が HTML を壊さない', () => {
  const js = dataJsText(sampleKabu);
  assert.ok(!js.includes('</script>') && !js.includes('<!--'));
  assert.equal(escapeInlineScript('a</script>b<!--c'), 'a<\\/script>b<\\!--c');
  const html = buildViewerHtml({ dataJs: js });
  const opens = (html.match(/<script>/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  assert.equal(opens, closes, 'script タグの開閉が合わない');
});

test('ビューアの書き出し先: 引数 > 環境変数 > config.json、~ はホームに展開', () => {
  assert.equal(resolveViewerPath({ cli: '~/x.html', env: { KABU_VIEWER_PATH: '/tmp/e.html' } }), join(homedir(), 'x.html'));
  assert.equal(resolveViewerPath({ env: { KABU_VIEWER_PATH: '/tmp/e.html' } }), '/tmp/e.html');
  assert.equal(resolveViewerPath({ env: {} }), join(homedir(), 'Desktop', 'KABU LAB.html'));
  assert.equal(expandHome('~'), homedir());
});

test('writeAtomic: 書けて、一時ファイルを残さない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-viewer-'));
  try {
    const p = join(dir, 'sub', 'KABU LAB.html');
    assert.equal(writeAtomic(p, 'abc'), 3);
    assert.equal(readFileSync(p, 'utf8'), 'abc');
    writeAtomic(p, 'defg');
    assert.equal(readFileSync(p, 'utf8'), 'defg');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: --data/--out を指定した実行は、--viewer を明示しない限りビューアを書かない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-build-'));
  try {
    cpSync(join(DATA, 'stocks', '6501'), join(dir, 'data', 'stocks', '6501'), { recursive: true });
    const env = { ...process.env };
    delete env.KABU_VIEWER_PATH;
    const r = spawnSync(process.execPath, [join(ROOT, 'build.mjs'), '--data', join(dir, 'data'), '--out', join(dir, 'out.js')], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/ビューア:/.test(r.stdout), 'ビューアを書いてしまった');
    const v = join(dir, 'v', 'KABU LAB.html');
    const r2 = spawnSync(process.execPath, [join(ROOT, 'build.mjs'), '--data', join(dir, 'data'), '--out', join(dir, 'out.js'), '--viewer', v], { encoding: 'utf8', env });
    assert.equal(r2.status, 0, r2.stderr);
    assert.ok(existsSync(v));
    assert.match(readFileSync(v, 'utf8'), /日立製作所/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: ビューアを書けない場所でも警告だけで成功する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-build-'));
  try {
    cpSync(join(DATA, 'stocks', '6501'), join(dir, 'data', 'stocks', '6501'), { recursive: true });
    writeFileSync(join(dir, 'blocker'), 'x'); // ファイルの下にはディレクトリを作れない
    const r = spawnSync(process.execPath, [join(ROOT, 'build.mjs'), '--data', join(dir, 'data'), '--out', join(dir, 'out.js'), '--viewer', join(dir, 'blocker', 'KABU LAB.html')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr + r.stdout, /警告: ビューアを書き出せませんでした/);
    assert.ok(existsSync(join(dir, 'out.js')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
