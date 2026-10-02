// 共通fetch: User-Agent明示・タイムアウト15秒・リトライ1回・同一サイト間隔1秒以上・1サイト最大4リクエスト/実行
// 依存パッケージなし（Node 標準の fetch のみ）。

export const USER_AGENT = 'Mozilla/5.0 (compatible; kabu-lab/0.1; personal study tool)';
// 注: ブラウザ風のフルUA（Chrome/...）は Yahoo が 429 を返すことがあるため、簡素なUAにしている。

export const DEFAULTS = Object.freeze({
  maxPerHost: 4,
  minIntervalMs: 1000,
  timeoutMs: 15000,
  retries: 1,
  retryWaitMs: 2000,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class FetchLimitError extends Error {}

/** 実行ごとの状態（ホスト別の回数・最終時刻）を持つ fetch 器を作る */
export function createFetcher(options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const hosts = new Map(); // host -> { count, last }

  async function request(url, { accept } = {}) {
    const host = new URL(url).host;
    let lastErr;
    for (let attempt = 0; attempt <= opt.retries; attempt++) {
      const st = hosts.get(host) ?? { count: 0, last: 0 };
      if (st.count >= opt.maxPerHost) {
        throw new FetchLimitError(
          `リクエスト上限超過: ${host} は1回の実行で最大${opt.maxPerHost}リクエストまで（${url}）`,
        );
      }
      const wait = st.last + opt.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      if (attempt > 0 && opt.retryWaitMs > 0) await sleep(opt.retryWaitMs);
      st.count += 1;
      st.last = Date.now();
      hosts.set(host, st);
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': opt.userAgent ?? USER_AGENT,
            Accept: accept ?? '*/*',
            'Accept-Language': 'ja,en;q=0.8',
          },
          signal: AbortSignal.timeout(opt.timeoutMs),
        });
        st.last = Date.now();
        if (res.ok) return res;
        const body = (await res.text().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ');
        lastErr = new Error(`HTTP ${res.status} ${res.statusText}: ${url} ${body}`);
        // 404 等のクライアントエラーは再試行しても無駄（429 は除く）
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
      } catch (e) {
        st.last = Date.now();
        const reason = e?.name === 'TimeoutError' ? `タイムアウト(${opt.timeoutMs}ms)` : e?.message;
        lastErr = new Error(`通信失敗: ${url} (${reason})`);
      }
    }
    throw lastErr;
  }

  return {
    async text(url, o) {
      const res = await request(url, o);
      return res.text();
    },
    async json(url, o) {
      const res = await request(url, { accept: 'application/json', ...o });
      const t = await res.text();
      try {
        return JSON.parse(t);
      } catch {
        throw new Error(`JSONとして読めない応答: ${url} 先頭=${t.slice(0, 80)}`);
      }
    },
    /** バイナリ取得。maxBytes を超えたら例外。返り値 { buffer, contentType, url } */
    async binary(url, { maxBytes = 20 * 1024 * 1024, accept = '*/*' } = {}) {
      const res = await request(url, { accept });
      const contentType = res.headers.get('content-type') ?? '';
      const len = Number(res.headers.get('content-length') ?? NaN);
      if (Number.isFinite(len) && len > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`サイズ上限超過: ${(len / 1048576).toFixed(1)}MB > ${(maxBytes / 1048576).toFixed(0)}MB（${url}）`);
      }
      const chunks = [];
      let total = 0;
      for await (const chunk of res.body ?? []) {
        total += chunk.byteLength;
        if (total > maxBytes) throw new Error(`サイズ上限超過: ${(maxBytes / 1048576).toFixed(0)}MB を超えました（${url}）`);
        chunks.push(chunk);
      }
      return { buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))), contentType, url: res.url || url };
    },
    count(host) {
      return hosts.get(host)?.count ?? 0;
    },
  };
}

// 1プロセス=1実行として共有する既定インスタンス
let shared;
export function defaultFetcher() {
  shared ??= createFetcher();
  return shared;
}
