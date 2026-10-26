// Shared settings and checks for the dealer scheme status API suites (qa/README.md).
//
// Env:
//   API_BASE_URL   default http://localhost:3400
//   CLIENT_ID      OAuth2 client credentials, exchanged once per worker at POST /api/v1/auth/token for
//   CLIENT_SECRET  a Bearer token (reused until < 60 s are left). Default local-client /
//                  local-test-secret (the .env.example values) only when API_BASE_URL is localhost;
//                  empty elsewhere. Set CLIENT_ID= (empty) to send no token.
//   AUTH_ENABLED   "true" when the server requires a token (runs the auth _SEC cases and the
//                  token-endpoint cases); a failed token request is then an error, not "auth off"
//   JWT_SECRET     the server's JWT_SECRET, to forge expired / wrong-scope / wrong-claim tokens
//                  (DSS_TC_80-83_SEC). Default: the .env.example key on localhost only; elsewhere
//                  those cases are skipped. Never put a real environment's key here.
//   JWT_TTL_SECONDS  the server's token lifetime (default 3600), checked as expires_in
//   DEALER_CODE    a dealer with stored results. Default: the synthetic dealer DEMO0001 (npm run data:demo);
//                  with SAMPLE_DATA=false, dealers.main from qa/test-data/dealers.json (git-ignored;
//                  see pick-dealers.ts), and one of the two is then required.
//   CHILD_DEALER_CODE, PARENT_DEALER_CODE  a child dealer and its parent. Default DEMO-C1 / DEMO0010, or
//                  dealers.child from dealers.json with SAMPLE_DATA=false (the case is skipped without one).
//   SCHEME_TAGS    comma-separated active scheme tags (default FB-PAN,FB-TNHPJK,SP-Q3)
//   SAMPLE_DATA    "true" (default) when the server holds the synthetic DEMO dealers (npm run data:demo);
//                  "false" on real environments: skips the cases that assert DEMO values
//   RATE_LIMIT     the server's RATE_LIMIT_PER_SECOND; set it (with a low server value, e.g. 20) to run DSS_TC_74_SEC
//   CLIENT_RATE_LIMIT  the server's API_RATE_LIMIT_PER_MINUTE; set it (with a low server value, e.g. 5) to run
//                  DSS_TC_75_SEC on its own (it uses up the client's limit for up to a minute)
//   TOKEN_RATE_LIMIT  the server's TOKEN_RATE_LIMIT_PER_MINUTE; set it to run COMMON_TC_19_SEC on its own
//   CACHE_ENABLED  "true" when the server has the response cache on (CACHE_ENABLED=true and REDIS_URL):
//                  runs DSS_TC_85-86 (X-Cache MISS then HIT)
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { test, expect } = require('@playwright/test');

const BASE_URL = (process.env.API_BASE_URL || 'http://localhost:3400').replace(/\/$/, '');
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(BASE_URL);
// The published local values from .env.example; the server refuses them outside APP_ENV=local.
const CLIENT_ID = process.env.CLIENT_ID ?? (IS_LOCAL ? 'local-client' : '');
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? (IS_LOCAL ? 'local-test-secret' : '');
const JWT_SECRET = process.env.JWT_SECRET ?? (IS_LOCAL ? 'local-only-jwt-signing-key-not-for-servers-0001' : '');
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
const SAMPLE_DATA = process.env.SAMPLE_DATA !== 'false';
const CACHE_ENABLED = process.env.CACHE_ENABLED === 'true';

const DSS = '/api/v1/dealer-scheme-status';
const TOKEN_PATH = '/api/v1/auth/token';
const HEALTH = '/api/v1/health';
const ISSUER = 'scheme-calculator'; // also the audience and the realm
const SCOPE = 'schemes:read';
const TAGS = (process.env.SCHEME_TAGS || 'FB-PAN,FB-TNHPJK,SP-Q3').split(',').map((t) => t.trim()).filter(Boolean);
const UNKNOWN_DEALER = 'DEMO9999';

// Real dealers (client data, git-ignored): {"dealers": {"main": "...", "child": {"code", "parent"}, ...}, "pool": [...]}.
function dealersFile() {
  const file = path.join(__dirname, '..', '..', 'test-data', 'dealers.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).dealers || {} : {};
}
const REAL = SAMPLE_DATA ? {} : dealersFile();
if (!SAMPLE_DATA && !process.env.DEALER_CODE && !REAL.main) {
  throw new Error('SAMPLE_DATA=false: set DEALER_CODE, or build qa/test-data/dealers.json (npm run qa:pick-dealers)');
}
const DEALER = process.env.DEALER_CODE || REAL.main || 'DEMO0001';
const CHILD = process.env.CHILD_DEALER_CODE || (REAL.child && REAL.child.code) || (SAMPLE_DATA ? 'DEMO-C1' : '');
const PARENT = process.env.PARENT_DEALER_CODE || (REAL.child && REAL.child.parent) || (SAMPLE_DATA ? 'DEMO0010' : '');

// Text that must never be in an error body: stack frames, file paths, SQL, driver errors.
const LEAK_MARKERS = ['    at ', '.ts:', '.js:', 'node_modules', '/src/', 'SELECT ', 'syntax error', 'ECONNREFUSED',
  'TypeError', 'ReferenceError', 'drizzle', '"stack"', 'pg_'];

// One token per worker process: POST /api/v1/auth/token has its own low per-IP limit
// (TOKEN_RATE_LIMIT_PER_MINUTE, default 30), so never fetch one per request.
let cachedToken = { token: '', expiresAt: 0 };
let pendingToken = null;

async function requestToken() {
  const response = await fetch(BASE_URL + TOKEN_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: SCOPE }),
  });
  const text = await response.text();
  if (response.status === 200) {
    const body = JSON.parse(text);
    cachedToken = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cachedToken.token;
  }
  // A server without auth refuses every client (401 invalid_client): carry on without a token.
  if (!AUTH_ENABLED && response.status === 401) return '';
  const hint = response.status === 429 ? ' (token rate limit: wait a minute, or raise TOKEN_RATE_LIMIT_PER_MINUTE)' : '';
  throw new Error(`POST ${TOKEN_PATH} as ${CLIENT_ID} returned ${response.status}${hint}: ${text}`);
}

// The worker's Bearer token ('' when no credentials are set or the server has auth off).
async function getToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    if (AUTH_ENABLED) throw new Error('AUTH_ENABLED=true needs CLIENT_ID and CLIENT_SECRET');
    return '';
  }
  if (cachedToken.token && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  pendingToken ??= requestToken().finally(() => { pendingToken = null; });
  return pendingToken;
}

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// A request context; with no `headers` it sends the worker's Bearer token, `{}` sends nothing.
async function newApi(playwright, headers) {
  return playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: headers ?? await authHeaders() });
}

// Runs `run` with a throwaway request context that sends exactly `headers`.
async function withHeaders(playwright, headers, run) {
  const ctx = await newApi(playwright, headers);
  try {
    await run(ctx);
  } finally {
    await ctx.dispose();
  }
}

// Opens one request context for the enclosing describe block; call client() inside tests.
function useClient() {
  let api;
  test.beforeAll(async ({ playwright }) => {
    api = await newApi(playwright);
  });
  test.afterAll(async () => {
    await api.dispose();
  });
  return () => api;
}

// An HS256 JWT, for forged-token cases. `claims` defaults to what the server issues.
const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
function tokenClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: ISSUER, aud: ISSUER, sub: CLIENT_ID, scope: SCOPE, iat: now, nbf: now, exp: now + 3600,
    jti: crypto.randomUUID().replace(/-/g, ''), ...overrides };
  for (const [key, value] of Object.entries(claims)) if (value === undefined) delete claims[key];
  return claims;
}
function signJwt(claims, key, header = { alg: 'HS256', typ: 'JWT' }) {
  const unsigned = `${b64url(header)}.${b64url(claims)}`;
  if (/^none$/i.test(header.alg)) return `${unsigned}.`;
  const hash = header.alg === 'HS512' ? 'sha512' : 'sha256';
  return `${unsigned}.${crypto.createHmac(hash, key).update(unsigned).digest('base64url')}`;
}

// The security headers of every API response (docs/api-contract.md section 10).
function expectSecurityHeaders(response) {
  const h = response.headers();
  expect(h['x-content-type-options'], 'nosniff').toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['cache-control']).toContain('no-store');
  expect(h['content-security-policy']).toContain("default-src 'none'");
  expect(h['strict-transport-security']).toMatch(/max-age=\d+/);
}

// The error envelope of the data endpoint: exactly {error: {code, message}}, no leak, no echo of `payload`.
async function expectApiError(response, status, code, payload) {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  const body = JSON.parse(text);
  expect(Object.keys(body)).toEqual(['error']);
  expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  if (payload) expect(text).not.toContain(payload);
  for (const marker of LEAK_MARKERS) expect(text).not.toContain(marker);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(response.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  expectSecurityHeaders(response);
  return body.error;
}

const expectInvalidRequest = (response, payload) => expectApiError(response, 400, 'INVALID_REQUEST', payload);

// The 401 a protected endpoint returns, per RFC 6750: error body and WWW-Authenticate challenge.
async function expectUnauthorized(response, message) {
  const error = await expectApiError(response, 401, 'UNAUTHORIZED');
  expect(error.message).toBe(message);
  const challenge = response.headers()['www-authenticate'] || '';
  expect(challenge).toMatch(/^Bearer realm="scheme-calculator"/);
  if (message === 'Not authenticated') expect(challenge).not.toContain('error=');
  else expect(challenge).toContain('error="invalid_token"');
}

// A POST with Transfer-Encoding: chunked (no Content-Length), which Playwright cannot send.
function chunkedPost(urlPath, chunks, headers = {}) {
  const url = new URL(BASE_URL + urlPath);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    // The server may answer and close before the whole body is sent; that is the expected result.
    req.on('socket', (s) => s.on('error', () => undefined));
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

// The request rules of the data endpoint (body {"dealer_code", "scheme_tags"}, Bearer token, limits, headers).
// Registers the edge, negative and security cases, numbered from `start`: <prefix>_TC_<n> (and _SEC).
function registerRequestContract({ prefix, path: urlPath, start }) {
  let n = start;
  const id = (sec = false) => `${prefix}_TC_${n++}${sec ? '_SEC' : ''}`;
  const base = { scheme_tags: TAGS };

  test.describe('Request contract', () => {
    const client = useClient();
    const call = (body, options = {}) => client().post(urlPath, { data: { ...base, ...body }, ...options });
    const raw = (data, contentType = 'application/json') =>
      client().post(urlPath, { data: Buffer.from(data), headers: { 'Content-Type': contentType } });

    test.describe('Edge Cases @edge', () => {
      test(`${id()} 32-character dealer code (maximum) passes validation`, async () => {
        await expectApiError(await call({ dealer_code: 'Q'.repeat(32) }), 404, 'DEALER_NOT_FOUND');
      });

      test(`${id()} Dealer code with letters, digits, "_" and "-" passes validation`, async () => {
        await expectApiError(await call({ dealer_code: 'QA_test-01' }), 404, 'DEALER_NOT_FOUND');
      });

      test(`${id()} Unknown extra fields in the body are ignored`, async () => {
        const first = await call({ dealer_code: DEALER });
        expect(first.status()).toBe(200);
        const response = await call({ dealer_code: DEALER, period: '2020-01', extra: true, nested: { a: [1] } });
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual(await first.json());
      });

      test(`${id()} Ten scheme tags (maximum) pass validation`, async () => {
        const tags = [...TAGS, ...Array.from({ length: 10 - TAGS.length }, (_, i) => `QA-UNKNOWN-${i}`)];
        const error = await expectApiError(await call({ dealer_code: DEALER, scheme_tags: tags }), 400, 'UNKNOWN_SCHEME_TAG');
        expect(error.message).toContain('QA-UNKNOWN-0');
      });

      test(`${id()} Repeated identical requests return identical results`, async () => {
        const [a, b] = [await call({ dealer_code: DEALER }), await call({ dealer_code: DEALER })];
        expect([a.status(), b.status()]).toEqual([200, 200]);
        expect(await b.json()).toEqual(await a.json());
      });

      test(`${id()} Body of exactly 8,192 bytes is accepted; 8,193 bytes gets 413`, async () => {
        const make = (size) => {
          const head = JSON.stringify({ dealer_code: DEALER, scheme_tags: TAGS, pad: '' });
          return head.replace('"pad":""', `"pad":"${'x'.repeat(size - head.length)}"`);
        };
        expect(Buffer.byteLength(make(8192))).toBe(8192);
        expect((await raw(make(8192))).status()).toBe(200);
        await expectApiError(await raw(make(8193)), 413, 'PAYLOAD_TOO_LARGE');
      });

      test(`${id()} Deeply nested JSON in an extra field does not cause a 500`, async () => {
        const nested = '['.repeat(3000) + ']'.repeat(3000);
        const response = await raw(`{"dealer_code": "${DEALER}", "scheme_tags": ${JSON.stringify(TAGS)}, "x": ${nested}}`);
        expect(response.status()).toBeLessThan(500);
      });
    });

    test.describe('Negative Cases @negative', () => {
      test(`${id()} Missing dealer_code returns 400`, async () => {
        await expectInvalidRequest(await call({}));
      });

      test(`${id()} Empty dealer_code returns 400`, async () => {
        await expectInvalidRequest(await call({ dealer_code: '' }));
      });

      test(`${id()} Whitespace-only dealer_code returns 400`, async () => {
        await expectInvalidRequest(await call({ dealer_code: '   ' }));
      });

      test(`${id()} null dealer_code returns 400`, async () => {
        await expectInvalidRequest(await call({ dealer_code: null }));
      });

      test(`${id()} Number or boolean dealer_code returns 400 (must be a string)`, async () => {
        await expectInvalidRequest(await call({ dealer_code: 61000001 }));
        await expectInvalidRequest(await call({ dealer_code: true }));
      });

      test(`${id()} Array or object dealer_code returns 400`, async () => {
        await expectInvalidRequest(await call({ dealer_code: [DEALER] }));
        await expectInvalidRequest(await call({ dealer_code: { code: DEALER } }));
      });

      test(`${id()} 33-character dealer code returns 400`, async () => {
        await expectInvalidRequest(await call({ dealer_code: 'Q'.repeat(33) }));
      });

      test(`${id()} Dealer code with a space, dot or slash inside returns 400`, async () => {
        for (const code of ['DEMO 0001', 'DEMO.0001', 'DEMO/0001']) await expectInvalidRequest(await call({ dealer_code: code }), code);
      });

      test(`${id()} Missing scheme_tags returns 400`, async () => {
        await expectInvalidRequest(await client().post(urlPath, { data: { dealer_code: DEALER } }));
      });

      test(`${id()} Empty scheme_tags array returns 400`, async () => {
        await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: [] }));
      });

      test(`${id()} scheme_tags that is not an array returns 400`, async () => {
        for (const tags of [TAGS[0], null, { tag: TAGS[0] }, 1]) await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: tags }));
      });

      test(`${id()} More than 10 scheme tags returns 400`, async () => {
        const tags = Array.from({ length: 11 }, (_, i) => `T${i}`);
        await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: tags }));
      });

      test(`${id()} A scheme tag that is not a string returns 400`, async () => {
        for (const item of [1, null, true, [TAGS[0]], { t: 1 }]) {
          await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: [TAGS[0], item] }));
        }
      });

      test(`${id()} Empty or whitespace-only scheme tag returns 400`, async () => {
        for (const item of ['', '   ']) await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: [item] }));
      });

      test(`${id()} Scheme tag longer than 32 characters or with a control character returns 400`, async () => {
        await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: ['T'.repeat(33)] }));
        await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: ['ABC\u00001'] }));
        await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: ['ABC\n1'] }));
      });

      test(`${id()} Duplicate scheme tags (also after trimming) return 400`, async () => {
        await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: [TAGS[0], TAGS[0]] }));
        await expectInvalidRequest(await call({ dealer_code: DEALER, scheme_tags: [TAGS[0], ` ${TAGS[0]} `] }));
      });

      test(`${id()} Invalid JSON returns 400`, async () => {
        // A Buffer, because Playwright would send a string that is not JSON as a quoted JSON string.
        await expectInvalidRequest(await raw('{"dealer_code": '));
      });

      test(`${id()} Empty body returns 400`, async () => {
        await expectInvalidRequest(await client().post(urlPath, { headers: { 'Content-Type': 'application/json' } }));
      });

      test(`${id()} Body that is a JSON array, string or number returns 400`, async () => {
        for (const body of ['[]', `["${DEALER}"]`, '"x"', '42', 'null']) await expectInvalidRequest(await raw(body));
      });

      test(`${id()} Non-JSON content type (form, text/plain, none) returns 400`, async () => {
        await expectInvalidRequest(await raw(`dealer_code=${DEALER}`, 'application/x-www-form-urlencoded'));
        await expectInvalidRequest(await raw(JSON.stringify({ dealer_code: DEALER, scheme_tags: TAGS }), 'text/plain'));
        const none = await client().fetch(urlPath, { method: 'POST', data: Buffer.from(JSON.stringify({ dealer_code: DEALER, scheme_tags: TAGS })) });
        await expectInvalidRequest(none);
      });

      test(`${id()} GET and HEAD on the POST endpoint return 405 with Allow: POST`, async () => {
        const get = await client().get(urlPath);
        await expectApiError(get, 405, 'METHOD_NOT_ALLOWED');
        expect(get.headers()['allow']).toBe('POST');
        const head = await client().head(urlPath);
        expect(head.status()).toBe(405);
        expect(head.headers()['allow']).toBe('POST');
      });
    });

    test.describe('Security @security', () => {
      test.describe('Authentication (OAuth2 Bearer token)', () => {
        test.beforeEach(() => test.skip(!AUTH_ENABLED, 'server does not require a token (AUTH_ENABLED != true)'));
        const post = (ctx, url = urlPath) => ctx.post(url, { data: { ...base, dealer_code: DEALER } });

        test(`${id(true)} Missing or empty Authorization returns 401 Not authenticated + Bearer challenge`, async ({ playwright }) => {
          for (const headers of [{}, { Authorization: '' }, { Authorization: 'Bearer' }, { Authorization: 'Bearer ' }]) {
            await withHeaders(playwright, headers, async (ctx) => expectUnauthorized(await post(ctx), 'Not authenticated'));
          }
        });

        test(`${id(true)} Garbage Bearer token returns 401 Invalid token`, async ({ playwright }) => {
          for (const token of ['not-a-jwt', 'a.b.c', 'eyJhbGciOiJIUzI1NiJ9.e30.', 'x'.repeat(2000)]) {
            await withHeaders(playwright, { Authorization: `Bearer ${token}` }, async (ctx) =>
              expectUnauthorized(await post(ctx), 'Invalid token'));
          }
        });

        test(`${id(true)} Valid token with a tampered signature or payload returns 401 Invalid token`, async ({ playwright }) => {
          const [header, payload, signature] = (await getToken()).split('.');
          const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
          const tampered = [
            `${header}.${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`,
            `${header}.${Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else' })).toString('base64url')}.${signature}`,
            `${header}.${payload}`,
          ];
          for (const token of tampered) {
            await withHeaders(playwright, { Authorization: `Bearer ${token}` }, async (ctx) =>
              expectUnauthorized(await post(ctx), 'Invalid token'));
          }
        });

        test(`${id(true)} Token in the query string is not accepted (header only)`, async ({ playwright }) => {
          const token = encodeURIComponent(await getToken());
          await withHeaders(playwright, {}, async (ctx) =>
            expectUnauthorized(await post(ctx, `${urlPath}?access_token=${token}`), 'Not authenticated'));
        });

        test(`${id(true)} X-API-Key alone (the old phase 2 scheme) returns 401`, async ({ playwright }) => {
          await withHeaders(playwright, { 'X-API-Key': CLIENT_SECRET || 'local-test-key' }, async (ctx) =>
            expectUnauthorized(await post(ctx), 'Not authenticated'));
        });
      });

      test.describe('Injection & input handling', () => {
        const payloads = {
          SQLi: ["1' OR '1'='1", '1; DROP TABLE dealer_scheme_result;--', '1 UNION SELECT * FROM dealer'],
          XSS: ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>'],
          'Path traversal': ['../../etc/passwd', '..%2F..%2Fetc%2Fpasswd'],
          'Null byte': ['DEMO\u00000001'],
          CRLF: ['DEMO\r\nX-Injected: yes'],
          Unicode: ['ＤＥＭＯ０００１', 'DEMO0001​'], // full-width characters, zero-width space
        };
        for (const [name, list] of Object.entries(payloads)) {
          test(`${id(true)} ${name} payloads in dealer_code are rejected with 400 and not reflected`, async () => {
            for (const payload of list) {
              const response = await call({ dealer_code: payload });
              await expectInvalidRequest(response, payload);
              expect(response.headers()['x-injected']).toBeUndefined();
            }
          });
        }

        test(`${id(true)} 5000-character dealer code is rejected (400/413), never 500`, async () => {
          const response = await call({ dealer_code: 'A'.repeat(5000) });
          expect([400, 413]).toContain(response.status());
          expect(await response.text()).not.toContain('A'.repeat(100));
        });

        test(`${id(true)} 1 MB body is rejected with 413 before it is read`, async () => {
          const response = await raw(JSON.stringify({ dealer_code: DEALER, scheme_tags: TAGS, pad: 'x'.repeat(1_000_000) }));
          await expectApiError(response, 413, 'PAYLOAD_TOO_LARGE');
        });

        test(`${id(true)} Chunked body (no Content-Length) over 8 KB is rejected with 413`, async () => {
          const token = await getToken();
          const chunk = 'x'.repeat(4096);
          const response = await chunkedPost(urlPath, [`{"dealer_code":"${DEALER}","pad":"`, chunk, chunk, chunk, '"}'],
            token ? { Authorization: `Bearer ${token}` } : {});
          expect(response.status, response.text).toBe(413);
          expect(JSON.parse(response.text).error.code).toBe('PAYLOAD_TOO_LARGE');
          expect(response.headers['x-content-type-options']).toBe('nosniff');
        });

        test(`${id(true)} Injection payloads in scheme_tags give 400 UNKNOWN_SCHEME_TAG as inert JSON (no SQL, no HTML)`, async () => {
          // QA-2 (fixed): the message names a tag only when it matches ^[A-Za-z0-9_-]{1,32}$. These payloads are
          // never repeated. The body is JSON with nosniff and CSP default-src 'none'.
          for (const tag of ["' OR '1'='1", '<script>alert(1)</script>', '1; DROP TABLE scheme;--']) {
            const response = await call({ dealer_code: DEALER, scheme_tags: [tag] });
            const error = await expectApiError(response, 400, 'UNKNOWN_SCHEME_TAG');
            expect(error.message).toBe('A scheme tag does not exist.');
            expect(await response.text()).not.toContain(tag);
            expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
          }
        });
      });

      test.describe('Method abuse', () => {
        test(`${id(true)} PUT / DELETE / PATCH return 405 METHOD_NOT_ALLOWED`, async () => {
          for (const method of ['put', 'delete', 'patch']) {
            const response = await client()[method](urlPath, { data: { ...base, dealer_code: DEALER } });
            await expectApiError(response, 405, 'METHOD_NOT_ALLOWED');
            expect(response.headers()['allow'], method).toBe('POST');
          }
        });

        test(`${id(true)} OPTIONS and TRACE do not expose data or CORS permissions`, async () => {
          const options = await client().fetch(urlPath, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } });
          expect(options.status()).toBe(204); // documented (docs/api-contract.md section 2); the reference API sends 405
          expect(options.headers()['allow']).toBe('POST, OPTIONS');
          expect(Object.keys(options.headers()).filter((h) => h.startsWith('access-control-'))).toEqual([]);
          expect(await options.text()).toBe('');
          // TRACE: Next.js cannot pass it to a route. The method guard answers 405 JSON (QA-1, fixed). No echo, no leak.
          const trace = await client().fetch(urlPath, { method: 'TRACE', headers: { 'X-Trace-Probe': 'qa-trace-probe' } });
          await expectApiError(trace, 405, 'METHOD_NOT_ALLOWED', 'qa-trace-probe');
          expect(trace.headers()['allow']).toBe('POST');
          expect(trace.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
          expectSecurityHeaders(trace);
          const text = await trace.text();
          for (const marker of LEAK_MARKERS) expect(text).not.toContain(marker);
        });
      });

      test.describe('Response headers (CWE-693) & information disclosure (CWE-200/209)', () => {
        let headers;
        let headerList; // every header line as sent, to catch duplicates that headers() merges
        test.beforeAll(async () => {
          const response = await call({ dealer_code: DEALER });
          expect(response.status()).toBe(200);
          headers = response.headers();
          headerList = response.headersArray();
        });

        test(`${id(true)} X-Content-Type-Options is nosniff`, async () => {
          expect(headers['x-content-type-options']).toBe('nosniff');
        });

        test(`${id(true)} Strict-Transport-Security max-age >= 31536000, sent once`, async () => {
          // Browsers apply only the first HSTS header (RFC 6797 8.1): the app and a proxy must not both send one.
          expect(headerList.filter((h) => h.name.toLowerCase() === 'strict-transport-security')).toHaveLength(1);
          const maxAge = Number((headers['strict-transport-security'] || '').match(/max-age=(\d+)/)?.[1]);
          expect(maxAge).toBeGreaterThanOrEqual(31536000);
        });

        test(`${id(true)} Cache-Control is no-store on dealer data and on errors`, async () => {
          expect(headers['cache-control']).toContain('no-store');
          expect((await call({})).headers()['cache-control']).toContain('no-store');
        });

        test(`${id(true)} CSP, X-Frame-Options, Referrer-Policy and CORP are set, each one time`, async () => {
          expect(headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
          expect(headers['x-frame-options']).toBe('DENY');
          expect(headers['referrer-policy']).toBe('no-referrer');
          expect(headers['cross-origin-resource-policy']).toBe('same-origin');
          for (const name of ['content-security-policy', 'x-frame-options', 'referrer-policy', 'cross-origin-resource-policy',
            'x-content-type-options', 'cache-control']) {
            expect(headerList.filter((h) => h.name.toLowerCase() === name), name).toHaveLength(1);
          }
        });

        test(`${id(true)} Server header does not reveal a product version; no X-Powered-By`, async () => {
          expect(headers['server'] || '').not.toMatch(/\/\d|\d+\.\d+/);
          expect(headers['x-powered-by']).toBeUndefined();
        });

        test(`${id(true)} CORS: a foreign Origin is not allowed`, async () => {
          const response = await call({ dealer_code: DEALER }, { headers: { Origin: 'https://evil.example.com' } });
          expect(response.headers()['access-control-allow-origin']).toBeUndefined();
          expect(response.headers()['access-control-allow-credentials']).toBeUndefined();
        });

        test(`${id(true)} Every response has its own X-Request-Id (200, 400, 405)`, async () => {
          const ids = [headers['x-request-id'], (await call({})).headers()['x-request-id'], (await client().get(urlPath)).headers()['x-request-id']];
          for (const value of ids) expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
          expect(new Set(ids).size).toBe(3);
        });
      });

      test.describe('Rate limiting', () => {
        test(`${id(true)} 50 rapid requests cause no 500s (records whether 429 is enforced)`, async () => {
          const responses = await Promise.all(Array.from({ length: 50 }, () => call({ dealer_code: DEALER })));
          const statuses = responses.map((r) => r.status());
          expect(statuses.filter((s) => s >= 500)).toEqual([]);
          test.info().annotations.push({
            type: 'rate-limit',
            // The per-IP limit (2,500/s by default) is far above 50; DSS_TC_74_SEC tests it with a low limit.
            description: statuses.includes(429) ? '429 enforced' : 'under the rate limits',
          });
        });
      });
    });
  });
  return n;
}

module.exports = {
  test, expect, AUTH_ENABLED, CLIENT_ID, CLIENT_SECRET, JWT_SECRET, SAMPLE_DATA, CACHE_ENABLED, DEALER, CHILD, PARENT,
  UNKNOWN_DEALER, BASE_URL, DSS, TOKEN_PATH, HEALTH, ISSUER, SCOPE, TAGS, LEAK_MARKERS, newApi, withHeaders, getToken,
  authHeaders, tokenClaims, signJwt, useClient, expectApiError, expectInvalidRequest, expectUnauthorized,
  expectSecurityHeaders, chunkedPost, registerRequestContract,
};
