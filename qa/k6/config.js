// Shared settings for every k6 script. Nothing secret lives here: pass credentials via env.
//
//   BASE_URL       default http://localhost:3400. Dev: https://dev.scheme-calculator.example.com (UAT and
//                  production follow the same pattern; hosts to be confirmed)
//   CLIENT_ID      OAuth2 client credentials. setup() exchanges them ONCE at POST /api/v1/auth/token
//   CLIENT_SECRET  and every VU sends that Bearer token (the token endpoint allows only
//                  TOKEN_RATE_LIMIT_PER_MINUTE requests per IP, default 30). Default
//                  local-client / local-test-secret on localhost only; empty = no token (auth off).
//                  A token lasts JWT_TTL_SECONDS (1 h): keep runs shorter than that.
//   AUTH_ENABLED   "true" = a refused token request stops the run (instead of running without a token)
//   SCHEME_TAGS    comma-separated tags sent in every request (default FB-PAN,FB-TNHPJK,SP-Q3)
//   DEALERS_FILE   "true" = take the dealer pool from ../test-data/dealers.json (git-ignored; see pick-dealers.ts)
//   DEALER_CODES   comma-separated dealer codes (for Dev/UAT); used when DEALERS_FILE is not "true"
//                  Default pool: the synthetic DEMO dealers of `npm run data:demo`.
//   UNKNOWN_RATE   share of requests for a dealer that does not exist (DEMO9999, answer 404; default 0.05)
//
// The server must allow the test rate: API_RATE_LIMIT_PER_MINUTE counts every request of the one client_id
// (default 1,00,000 a minute = about 1,666 a second), and RATE_LIMIT_PER_SECOND every request of one IP (default
// 2,500 a second). smoke, load, stress and spike stay far below both. rate.js at its default 1,700 a second
// (1,02,000 a minute) is above the per-client default: see rate.js.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Rate } from 'k6/metrics';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3400').replace(/\/$/, '');
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(BASE_URL);
const CLIENT_ID = __ENV.CLIENT_ID !== undefined ? __ENV.CLIENT_ID : (IS_LOCAL ? 'local-client' : '');
const CLIENT_SECRET = __ENV.CLIENT_SECRET !== undefined ? __ENV.CLIENT_SECRET : (IS_LOCAL ? 'local-test-secret' : '');
const UNKNOWN_RATE = parseFloat(__ENV.UNKNOWN_RATE || '0.05');
const UNKNOWN_DEALER = 'DEMO9999';
export const TAGS = (__ENV.SCHEME_TAGS || 'FB-PAN,FB-TNHPJK,SP-Q3').split(',').map((t) => t.trim()).filter(Boolean);
export const DSS = `${BASE_URL}/api/v1/dealer-scheme-status`;
export const HEALTH = `${BASE_URL}/api/v1/health`;
const DEMO_DEALERS = ['DEMO0001', 'DEMO0002', 'DEMO0003', 'DEMO0004', 'DEMO0005', 'DEMO0006', 'DEMO0007', 'DEMO0008',
  'DEMO0009', 'DEMO0010', 'DEMO0011', 'DEMO-C1'];

function dealerPool() {
  if (__ENV.DEALERS_FILE === 'true') {
    const file = JSON.parse(open('../test-data/dealers.json'));
    const codes = file.pool || [];
    if (!codes.length) throw new Error('no dealers in qa/test-data/dealers.json (npm run qa:pick-dealers)');
    return codes;
  }
  const listed = (__ENV.DEALER_CODES || '').split(',').map((c) => c.trim()).filter(Boolean);
  return listed.length ? listed : DEMO_DEALERS;
}
const DEALERS = dealerPool();

// A 404 for the unknown dealer is an expected answer, not a failed request.
http.setResponseCallback(http.expectedStatuses(200, 404));

export const cacheHits = new Rate('cache_hits'); // share of answers with X-Cache: HIT (only when the cache is on)

// Call from each script's setup(): one token for the whole test, handed to every VU as setup data.
// A server with auth off refuses every client (401), so the test then runs without a token.
export function authSetup() {
  if (!CLIENT_ID || !CLIENT_SECRET) return { token: '' };
  const res = http.post(`${BASE_URL}/api/v1/auth/token`,
    { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: 'schemes:read' },
    { tags: { name: 'token' }, responseCallback: http.expectedStatuses(200) });
  if (res.status === 200) return { token: res.json('access_token') };
  if (res.status === 401 && __ENV.AUTH_ENABLED !== 'true') {
    console.warn('token request refused (401): running without a token (server auth off?)');
    return { token: '' };
  }
  throw new Error(`POST /api/v1/auth/token returned ${res.status}: ${res.body}`);
}

export const params = (name, token) => ({
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  tags: { name }, // groups metrics per endpoint in the summary
  timeout: '15s',
});

// Spread VUs over the dealer pool so the test is not served from one hot row.
export function pickDealer() {
  if (Math.random() < UNKNOWN_RATE) return UNKNOWN_DEALER;
  const i = exec.vu.idInTest * 7919 + exec.scenario.iterationInTest;
  return DEALERS[i % DEALERS.length];
}

// A timed-out or reset request has no body; treat that as a failed check, not a script error.
function jsonBody(r) {
  try {
    return r.json();
  } catch (e) {
    return null;
  }
}

export function checkStatus(res, dealer) {
  const body = jsonBody(res);
  const xCache = res.headers['X-Cache'];
  if (xCache) cacheHits.add(xCache === 'HIT');
  if (dealer === UNKNOWN_DEALER) {
    return check(res, {
      'unknown dealer is 404': (r) => r.status === 404,
      'unknown dealer code is DEALER_NOT_FOUND': () => body !== null && body.error && body.error.code === 'DEALER_NOT_FOUND',
    });
  }
  return check(res, {
    'status is 200': (r) => r.status === 200,
    'one scheme per tag, in order': () => body !== null && Array.isArray(body.schemes) &&
      body.schemes.map((s) => s.scheme_tag).join(',') === TAGS.join(','),
  });
}

export const summaryTrendStats = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];

// Pass/fail criteria (same as the reference API). A dealer lookup is one indexed read, so p95 is held tight.
export const thresholds = {
  http_req_failed: ['rate<0.01'],                                         // < 1% errors
  'http_req_duration{name:dealer-scheme-status}': ['p(95)<500', 'p(99)<1000'],
  checks: ['rate>0.99'],                                                  // > 99% of checks pass
};

// Writes a JSON summary to reports/<script>-summary.json next to the console output.
export function summaryTo(name) {
  return (data) => ({
    [`reports/${name}-summary.json`]: JSON.stringify(data, null, 2),
    stdout: '\n' + textSummary(data),
  });
}

function textSummary(data) {
  const m = data.metrics;
  const fmt = (metric, stat) => (m[metric] && m[metric].values[stat] !== undefined ? m[metric].values[stat].toFixed(2) : 'n/a');
  const api = 'http_req_duration{name:dealer-scheme-status}';
  const lines = [
    `requests:        ${m.http_reqs ? m.http_reqs.values.count : 0} (${fmt('http_reqs', 'rate')}/s)`,
    `failed:          ${(m.http_req_failed ? m.http_req_failed.values.rate * 100 : 0).toFixed(2)}%`,
    `checks passed:   ${(m.checks ? m.checks.values.rate * 100 : 0).toFixed(2)}%`,
    `latency p50/p95/p99 (ms): ${fmt('http_req_duration', 'med')} / ${fmt('http_req_duration', 'p(95)')} / ${fmt('http_req_duration', 'p(99)')}`,
    `dealer status p95/p99 (ms): ${fmt(api, 'p(95)')} / ${fmt(api, 'p(99)')}`,
    `cache hits:      ${m.cache_hits ? (m.cache_hits.values.rate * 100).toFixed(2) + '%' : 'n/a (cache off)'}`,
    `dropped:         ${m.dropped_iterations ? m.dropped_iterations.values.count : 0}`,
    `max VUs:         ${m.vus_max ? m.vus_max.values.max : 'n/a'}`,
  ];
  const failed = Object.entries(data.metrics)
    .filter(([, v]) => v.thresholds && Object.values(v.thresholds).some((t) => !t.ok))
    .map(([k]) => k);
  lines.push(failed.length ? `THRESHOLDS FAILED: ${failed.join(', ')}` : 'all thresholds passed');
  return lines.join('\n') + '\n';
}
