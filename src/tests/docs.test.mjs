// fetch-doc・doc-slice・共通fetchのバイナリ取得（P2a）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createFetcher } from '../collect/lib/fetch.mjs';
import { isPdf, safeName, splitPages, summarize } from '../tools/fetch-doc.mjs';
import { parsePages, slicePages, grepPages, limitBytes, SLICE_LIMIT } from '../tools/doc-slice.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const PDF = readFileSync(new URL('./fixtures/sample-2p.pdf', import.meta.url));
const TXT = '===== PAGE 1 =====\n決算短信\n売上収益 2,709,586\n調整後営業利益 294,287\n\n===== PAGE 2 =====\nセグメント情報\nエナジー 129,100\n\n===== PAGE 3 =====\n注記\n';

function serve(handler) {
  return new Promise((r) => {
    const srv = createServer(handler);
    srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}
const runNode = (args) =>
  new Promise((r) => {
    const p = spawn(process.execPath, args, { cwd: ROOT });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (status) => r({ status, out, err }));
  });

test('splitPages・summarize: ページ数・文字数・先頭40字の目次', () => {
  const pages = splitPages(TXT);
  assert.deepEqual(pages.map((p) => p.page), [1, 2, 3]);
  assert.equal(pages[1].text, 'セグメント情報\nエナジー 129,100');
  const s = summarize(TXT);
  assert.equal(s.pages, 3);
  assert.equal(s.toc[0].head, '決算短信 売上収益 2,709,586 調整後営業利益 294,287');
  assert.ok(s.chars > 30);
});

test('isPdf・safeName', () => {
  assert.ok(isPdf('application/pdf', Buffer.from('x')));
  assert.ok(isPdf('application/octet-stream', Buffer.from('%PDF-1.7')));
  assert.ok(!isPdf('text/html; charset=UTF-8', Buffer.from('<!DOCTYPE')));
  assert.equal(safeName(undefined, 'https://x.jp/a/2026_1Q.pdf'), '2026_1Q');
  assert.equal(safeName('決算短信-1Q', 'https://x.jp/a.pdf'), '決算短信-1Q');
  assert.throws(() => safeName('../x', 'https://x.jp/a.pdf'), /不正/);
  assert.throws(() => safeName('.hidden', 'https://x.jp/a.pdf'), /不正/);
});

test('doc-slice: --pages の解析と抜き出し', () => {
  assert.deepEqual(parsePages('1-2,8, 2'), [1, 2, 8]);
  assert.throws(() => parsePages('2-1'), /範囲/);
  assert.throws(() => parsePages('a'), /形式/);
  const r = slicePages(splitPages(TXT), [2, 9]);
  assert.match(r.text, /^===== PAGE 2 =====\nセグメント情報/);
  assert.ok(!r.text.includes('PAGE 1'));
  assert.deepEqual(r.missing, [9]);
});

test('doc-slice: --grep は一致ページの番号と前後の行', () => {
  const r = grepPages(splitPages(TXT), ['エナジー', '調整後'], 1);
  assert.equal(r.hits, 2);
  assert.equal(r.pagesHit, 2);
  assert.match(r.text, /PAGE 1（一致 1行）[\s\S]*> 調整後営業利益 294,287/);
  assert.match(r.text, /  売上収益 2,709,586/); // 前1行
  assert.match(r.text, /PAGE 2（一致 1行）/);
  assert.equal(grepPages(splitPages(TXT), ['存在しない語']).hits, 0);
});

test('doc-slice: 20KB超は切り詰め', () => {
  const big = 'あ'.repeat(20000);
  const r = limitBytes(big);
  assert.equal(r.truncated, true);
  assert.ok(Buffer.byteLength(r.text) <= SLICE_LIMIT);
  assert.ok(!r.text.includes('�'));
  assert.equal(limitBytes('短い').truncated, false);
});

test('doc-slice CLI: 切り詰めの警告・引数エラー', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-slice-'));
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, Array.from({ length: 40 }, (_, i) => `===== PAGE ${i + 1} =====\n${'決算の本文。'.repeat(200)}\n`).join('\n'));
    const r = spawnSync(process.execPath, ['tools/doc-slice.mjs', f, '--pages', '1-40'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.ok(Buffer.byteLength(r.stdout) <= SLICE_LIMIT);
    assert.match(r.stderr, /20KBを超えたため切り詰め/);
    const g = spawnSync(process.execPath, ['tools/doc-slice.mjs', f, '--grep', '決算', '--pages', '2'], { cwd: ROOT, encoding: 'utf8' });
    assert.match(g.stdout, /^===== PAGE 2 =====/);
    assert.match(g.stdout, /# grep「決算」: 40ページ/);
    const e = spawnSync(process.execPath, ['tools/doc-slice.mjs', f], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(e.status, 1);
    assert.match(e.stderr, /--pages か --grep/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fetcher.binary: サイズ上限（Content-Length と実データの両方）', async () => {
  const { srv, base } = await serve((req, res) => {
    if (req.url === '/len') {
      res.setHeader('content-length', '5000');
      return res.end(Buffer.alloc(5000));
    }
    res.write(Buffer.alloc(3000)); // Content-Length なし（chunked）
    res.end(Buffer.alloc(3000));
  });
  try {
    const f = createFetcher({ minIntervalMs: 0, retryWaitMs: 0, retries: 0 });
    await assert.rejects(f.binary(`${base}/len`, { maxBytes: 4000 }), /サイズ上限超過/);
    await assert.rejects(f.binary(`${base}/chunk`, { maxBytes: 4000 }), /サイズ上限超過/);
    const ok = await f.binary(`${base}/chunk`, { maxBytes: 10000 });
    assert.equal(ok.buffer.length, 6000);
  } finally {
    srv.close();
  }
});

test('fetch-doc CLI: PDFを保存してテキスト化・目次を出す／PDFでなければ exit 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-doc-'));
  const { srv, base } = await serve((req, res) => {
    if (req.url === '/doc.pdf') {
      res.setHeader('content-type', 'application/pdf');
      return res.end(PDF);
    }
    res.setHeader('content-type', 'text/html; charset=UTF-8');
    res.end('<!DOCTYPE html><p>viewer</p>');
  });
  try {
    const r = await runNode(['tools/fetch-doc.mjs', '6501', `${base}/doc.pdf`, '--name', 't1', '--dir', dir]);
    assert.equal(r.status, 0, r.err);
    assert.ok(existsSync(join(dir, 't1.pdf')) && existsSync(join(dir, 't1.txt')));
    assert.match(r.out, /ページ数 2 \/ 文字数 \d+/);
    assert.match(r.out, /p1: Kessan Tanshin page one/);
    assert.match(r.out, /p2: Segment info revenue 123/);
    assert.match(readFileSync(join(dir, 't1.txt'), 'utf8'), /^===== PAGE 1 =====/);
    const bad = await runNode(['tools/fetch-doc.mjs', '6501', `${base}/viewer/`, '--name', 't2', '--dir', dir]);
    assert.equal(bad.status, 1);
    assert.match(bad.err, /PDFではありません（Content-Type: text\/html/);
    assert.ok(!existsSync(join(dir, 't2.pdf')));
    const noUrl = await runNode(['tools/fetch-doc.mjs', '6501']);
    assert.equal(noUrl.status, 1);
    assert.match(noUrl.err, /URL を指定/);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
