// collect/run.mjs の型（P3a で news・hansei を追加。どちらも quick と同じ収集・digest）。ネットに出ない範囲で確認
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const run = (dir, ...a) => spawnSync(process.execPath, [join(ROOT, 'collect/run.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, KABU_DATA_DIR: dir } });

test('run.mjs: news・hansei は quick と同じ digest.md を使い、--if-stale で最新なら収集を省く', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kabu-run-'));
  try {
    const s = join(dir, 'stocks', '9999');
    mkdirSync(s, { recursive: true });
    for (const f of ['digest.md', 'prices.json', 'profile.json']) writeFileSync(join(s, f), '{}');
    for (const t of ['news', 'hansei']) {
      const r = run(dir, '9999', '--type', t, '--if-stale');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /収集を省略（9999 の digest は最新です）[\s\S]*digest\.md/);
    }
    const bad = run(dir, '9999', '--type', 'market');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /未対応の型です: market（対応: quick, chart, news, hansei, kessan）/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
