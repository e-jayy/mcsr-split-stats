// Shared, throttled MCSR Ranked API client for the data scripts.
//
// Environment variables (all optional):
//   MCSR_API_KEY         API key for an expanded rate limit. Only ever set this for scripts
//                        running server-side (the GitHub Actions job keeps it as a secret);
//                        it is never used by the website.
//   MCSR_API_KEY_HEADER  Header the key is sent in (default: Private-Key).
//   MCSR_GAP_MS          Delay between requests in ms (default 1300, which keeps under the
//                        public limit of 500 requests / 10 minutes). Lower it to match the
//                        key's limit.

const BASE = 'https://api.mcsrranked.com';
const KEY = process.env.MCSR_API_KEY || '';
const HEADER = process.env.MCSR_API_KEY_HEADER || 'Private-Key';
const GAP_MS = Number(process.env.MCSR_GAP_MS) || 1300;
const headers = KEY ? { [HEADER]: KEY } : {};

export const usingKey = Boolean(KEY);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function get(path) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(BASE + path, { headers });
    } catch (e) {
      if (attempt > 5) throw e;
      await sleep(10000);
      continue;
    }
    if (res.status === 429) {
      const wait = (Number(res.headers.get('Retry-After')) || 60) * 1000;
      console.log(`  rate limited, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    const body = await res.json().catch(() => null);
    await sleep(GAP_MS);
    if (body?.status !== 'success') throw new Error(`${path}: ${JSON.stringify(body?.data)}`);
    return body.data;
  }
}
