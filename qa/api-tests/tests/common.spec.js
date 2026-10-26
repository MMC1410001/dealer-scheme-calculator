// Checks that belong to the server, not to the dealer status endpoint: health, unknown routes, HTTPS, API docs,
// and the OAuth2 token endpoint POST /api/v1/auth/token (COMMON_TC_5 onwards; RFC 6749 client credentials).
const crypto = require('crypto');
const {
  test, expect, AUTH_ENABLED, BASE_URL, CLIENT_ID, CLIENT_SECRET, DSS, TOKEN_PATH, HEALTH, ISSUER, SCOPE, TAGS, DEALER,
  LEAK_MARKERS, newApi, withHeaders, getToken, useClient, expectApiError, expectSecurityHeaders,
} = require('./helpers');

test.describe('Common', () => {
  const client = useClient();

  test('COMMON_TC_1 GET /api/v1/health returns 200 {status: "ok", data_as_of} @functional', async () => {
    const response = await client().get(HEALTH);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['data_as_of', 'status']);
    expect(body.status).toBe('ok');
    expect(body.data_as_of === null || /\+05:30$/.test(body.data_as_of)).toBe(true);
    expectSecurityHeaders(response);
  });

  test('COMMON_TC_2 Unknown /api route returns a JSON 404 NOT_FOUND for every method @negative', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const response = await client().fetch('/api/v1/schemes/unknown', { method, data: { dealer_code: '1' } });
      await expectApiError(response, 404, 'NOT_FOUND');
    }
  });

  test('COMMON_TC_25 /api and /api/ return the JSON 404 NOT_FOUND with the API security headers (QA-3) @negative', async () => {
    for (const path of ['/api', '/api/']) {
      for (const method of ['GET', 'POST']) {
        const response = await client().fetch(path, { method, data: { dealer_code: '1' } }); // /api/ follows the 308 to /api
        await expectApiError(response, 404, 'NOT_FOUND');
        expectSecurityHeaders(response);
        expect(response.headers()['referrer-policy'], `${method} ${path}`).toBe('no-referrer');
        expect(response.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      }
    }
  });

  test('COMMON_TC_26_SEC TRACE and methods that Next.js rejects get a JSON answer, not 500 (QA-1) @security', async () => {
    const cases = [
      { path: HEALTH, method: 'TRACE', status: 405, code: 'METHOD_NOT_ALLOWED', allow: 'GET, HEAD' },
      { path: TOKEN_PATH, method: 'TRACE', status: 405, code: 'METHOD_NOT_ALLOWED', allow: 'POST' },
      { path: DSS, method: 'PROPFIND', status: 405, code: 'METHOD_NOT_ALLOWED', allow: 'POST' },
      { path: '/api/v1/schemes/unknown', method: 'TRACE', status: 404, code: 'NOT_FOUND', allow: undefined },
      { path: '/api', method: 'QUERY', status: 404, code: 'NOT_FOUND', allow: undefined },
      { path: '/embed', method: 'TRACE', status: 405, code: 'METHOD_NOT_ALLOWED', allow: 'GET, HEAD' },
    ];
    for (const c of cases) {
      const response = await client().fetch(c.path, { method: c.method, headers: { 'X-Trace-Probe': 'qa-trace-probe' } });
      const label = `${c.method} ${c.path}`;
      expect(response.status(), label).toBe(c.status);
      expect(response.headers()['content-type'], label).toBe('application/json; charset=utf-8');
      const error = await expectApiError(response, c.status, c.code, 'qa-trace-probe');
      expect(error.message.length).toBeGreaterThan(0);
      expect(response.headers()['allow'], label).toBe(c.allow);
      expect(response.headers()['x-request-id'], label).toMatch(/^[0-9a-f-]{36}$/);
      expectSecurityHeaders(response);
    }
  });

  test('COMMON_TC_3_SEC /api/v1/health stays open without a token; HEAD answers 200 with no body @security', async ({ playwright }) => {
    const ctx = await newApi(playwright, {});
    try {
      expect((await ctx.get(HEALTH)).status()).toBe(200);
      const head = await ctx.head(HEALTH);
      expect(head.status()).toBe(200);
      expect(await head.text()).toBe('');
    } finally {
      await ctx.dispose();
    }
  });

  test('COMMON_TC_4_SEC Plain HTTP is redirected or refused (deployed environments only) @security', async ({ playwright }) => {
    test.skip(!BASE_URL.startsWith('https://'), 'local run over http; check on the deployed URL');
    const ctx = await playwright.request.newContext({ maxRedirects: 0 });
    let status = 0;
    try {
      status = (await ctx.get(`${BASE_URL.replace('https://', 'http://')}${HEALTH}`)).status();
    } catch {
      status = -1; // connection refused counts as a pass
    }
    expect([-1, 301, 302, 307, 308]).toContain(status);
    await ctx.dispose();
  });

  test('COMMON_TC_21_SEC Swagger UI loads one pinned swagger-ui-dist release with integrity hashes that match @security', async ({ playwright }) => {
    const response = await client().get('/api/docs');
    test.skip(response.status() === 404, 'docs are off on this server (DOCS_ENABLED=false)');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain('swagger-ui-dist@5/');
    const assets = [...html.matchAll(/(?:src|href)="(https:\/\/cdn\.jsdelivr\.net\/npm\/swagger-ui-dist@(\d+\.\d+\.\d+)\/[^"]+)" integrity="(sha384-[^"]+)" crossorigin="anonymous"/g)];
    expect(assets.map((a) => a[1].split('/').pop()).sort()).toEqual(['swagger-ui-bundle.js', 'swagger-ui.css']);
    const base = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${assets[0][2]}/`;
    const csp = response.headers()['content-security-policy'];
    expect(csp).toMatch(new RegExp(`script-src 'sha256-[A-Za-z0-9+/=]+' ${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')};`));
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
    // The browser refuses a file whose hash differs: check the hashes against the CDN now.
    const cdn = await playwright.request.newContext();
    try {
      for (const [, url, , integrity] of assets) {
        const file = await cdn.get(url);
        expect(file.status(), url).toBe(200);
        const digest = crypto.createHash('sha384').update(await file.body()).digest('base64');
        expect(`sha384-${digest}`, url).toBe(integrity);
      }
    } finally {
      await cdn.dispose();
    }
  });

  test('COMMON_TC_22 GET /api/v1/openapi.json serves the contract when docs are on @functional', async () => {
    const response = await client().get('/api/v1/openapi.json');
    test.skip(response.status() === 404, 'docs are off on this server (DOCS_ENABLED=false)');
    expect(response.status()).toBe(200);
    const spec = await response.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining([DSS, TOKEN_PATH, HEALTH]));
    expect(spec.servers[0].url).toBe('/');
  });

  test('COMMON_TC_23 A trailing slash gets the Next.js 308 redirect to the path without it (documented deviation) @edge', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: BASE_URL, maxRedirects: 0 });
    try {
      const response = await ctx.get(`${HEALTH}/`);
      expect(response.status()).toBe(308);
      expect(response.headers()['location']).toBe(HEALTH);
    } finally {
      await ctx.dispose();
    }
  });

  // =========================================================================
  // TOKEN ENDPOINT — COMMON_TC_5 onwards. About 22 token requests here (plus one per worker): the endpoint allows
  // TOKEN_RATE_LIMIT_PER_MINUTE (default 30) per IP, so wait a minute before another full run.
  // =========================================================================
  test.describe('Token endpoint (OAuth2 client credentials)', () => {
    test.beforeEach(() => test.skip(!AUTH_ENABLED, 'server does not require a token (AUTH_ENABLED != true)'));
    const form = (params) => new URLSearchParams(params).toString();
    const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const GOOD = { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
    const basic = (id = CLIENT_ID, secret = CLIENT_SECRET) =>
      `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;
    // Every token request goes out with no Authorization unless the case sets one.
    const tokenCall = async (playwright, options, check) => withHeaders(playwright, {}, async (ctx) => check(await ctx.post(TOKEN_PATH, options)));

    async function expectToken(response) {
      expect(response.status(), await response.text()).toBe(200);
      const body = await response.json();
      expect(Object.keys(body).sort()).toEqual(['access_token', 'expires_in', 'scope', 'token_type']);
      expect(body.token_type).toBe('Bearer');
      // A client in AUTH_WRITE_CLIENTS also gets choices:write when it asks for no scope.
      expect(body.scope.split(' ')).toContain(SCOPE);
      expect(body.expires_in).toBe(Number(process.env.JWT_TTL_SECONDS || 3600)); // the server's JWT_TTL_SECONDS
      expect(body.access_token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      const claims = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
      expect(claims).toMatchObject({ iss: ISSUER, aud: ISSUER, sub: CLIENT_ID, scope: body.scope });
      expect(claims.jti).toMatch(/^[0-9a-f]{32}$/);
      expect(claims.exp - claims.iat).toBe(body.expires_in);
      expect(JSON.stringify(claims)).not.toContain(CLIENT_SECRET);
      expect(response.headers()['cache-control']).toContain('no-store');
      return body.access_token;
    }

    // RFC 6749 section 5.2 error: status, {error, error_description}, never a stack trace or the secret.
    // challenge: true when the request sent an Authorization header. Only then has a 401 the Basic challenge
    // (RFC 6749 section 5.2); with the credentials in the body a browser must not get a sign-in dialog.
    async function expectOAuthError(response, statusCode, error, challenge = false) {
      const text = await response.text();
      expect(response.status(), text).toBe(statusCode);
      const body = JSON.parse(text);
      expect(Object.keys(body).sort()).toEqual(['error', 'error_description']);
      expect(body.error).toBe(error);
      expect(response.headers()['cache-control']).toContain('no-store');
      expect(response.headers()['pragma']).toBe('no-cache');
      if (statusCode === 401 && challenge) expect(response.headers()['www-authenticate']).toMatch(/^Basic realm="scheme-calculator"/);
      if (statusCode === 401 && !challenge) expect(response.headers()['www-authenticate']).toBeUndefined();
      for (const leak of [...LEAK_MARKERS, CLIENT_SECRET, 'wrong-secret-qa']) if (leak) expect(text).not.toContain(leak);
    }

    test('COMMON_TC_5 Form-encoded client credentials return a Bearer token that works on the API @functional', async ({ playwright }) => {
      await tokenCall(playwright, { data: form({ ...GOOD, scope: SCOPE }), headers: FORM }, async (response) => {
        const token = await expectToken(response);
        await withHeaders(playwright, { Authorization: `Bearer ${token}` }, async (ctx) =>
          expect((await ctx.post(DSS, { data: { dealer_code: DEALER, scheme_tags: TAGS } })).status()).toBe(200));
      });
    });

    test('COMMON_TC_6 JSON body with client credentials returns a token (scope optional) @functional', async ({ playwright }) => {
      await tokenCall(playwright, { data: GOOD }, expectToken);
    });

    test('COMMON_TC_7 HTTP Basic client authentication returns a token @functional', async ({ playwright }) => {
      await tokenCall(playwright, { data: form({ grant_type: 'client_credentials' }), headers: { ...FORM, Authorization: basic() } }, expectToken);
    });

    test('COMMON_TC_8_SEC Wrong client_secret in the body returns 401 invalid_client with no Basic challenge @security', async ({ playwright }) => {
      await tokenCall(playwright, { data: form({ ...GOOD, client_secret: 'wrong-secret-qa' }), headers: FORM },
        (response) => expectOAuthError(response, 401, 'invalid_client'));
    });

    test('COMMON_TC_9_SEC Unknown client_id returns 401 invalid_client (same as a wrong secret) @security', async ({ playwright }) => {
      await tokenCall(playwright, { data: form({ ...GOOD, client_id: 'unknown-client-qa' }), headers: FORM }, async (response) => {
        await expectOAuthError(response, 401, 'invalid_client');
        expect((await response.json()).error_description).toBe('Client authentication failed');
      });
    });

    test('COMMON_TC_10_SEC Missing grant_type returns 400 invalid_request @security', async ({ playwright }) => {
      const { grant_type: _omit, ...rest } = GOOD;
      await tokenCall(playwright, { data: form(rest), headers: FORM }, (response) => expectOAuthError(response, 400, 'invalid_request'));
    });

    test('COMMON_TC_11_SEC Other grant types (password) return 400 unsupported_grant_type @security', async ({ playwright }) => {
      await tokenCall(playwright, { data: form({ ...GOOD, grant_type: 'password', username: 'a', password: 'b' }), headers: FORM },
        (response) => expectOAuthError(response, 400, 'unsupported_grant_type'));
    });

    test('COMMON_TC_12_SEC Scope other than schemes:read returns 400 invalid_scope @security', async ({ playwright }) => {
      await tokenCall(playwright, { data: form({ ...GOOD, scope: `${SCOPE} admin` }), headers: FORM },
        (response) => expectOAuthError(response, 400, 'invalid_scope'));
    });

    test('COMMON_TC_13_SEC Credentials in both Basic and the body return 400 invalid_request @security', async ({ playwright }) => {
      await tokenCall(playwright, { data: form(GOOD), headers: { ...FORM, Authorization: basic() } },
        (response) => expectOAuthError(response, 400, 'invalid_request'));
    });

    test('COMMON_TC_14_SEC GET on the token endpoint returns 405 (credentials never in a URL) @security', async ({ playwright }) => {
      await withHeaders(playwright, {}, async (ctx) => {
        const response = await ctx.get(`${TOKEN_PATH}?${form(GOOD)}`);
        expect(response.status()).toBe(405);
        expect(response.headers()['allow']).toBe('POST');
        expect(await response.text()).not.toContain(CLIENT_SECRET);
      });
    });

    test('COMMON_TC_15_SEC Token responses (success and error) are not cached: no-store, Pragma no-cache @security', async ({ playwright }) => {
      for (const data of [form(GOOD), form({ ...GOOD, client_secret: 'wrong-secret-qa' })]) {
        await tokenCall(playwright, { data, headers: FORM }, async (response) => {
          expect(response.headers()['cache-control']).toContain('no-store');
          expect(response.headers()['pragma']).toBe('no-cache');
          expectSecurityHeaders(response);
        });
      }
    });

    test('COMMON_TC_16_SEC Unsupported content type or unparseable body returns 400 invalid_request @security', async ({ playwright }) => {
      const cases = [
        { data: form(GOOD), headers: { 'Content-Type': 'text/plain' } },
        { data: Buffer.from('{"grant_type": '), headers: { 'Content-Type': 'application/json' } },
        { data: Buffer.from('["client_credentials"]'), headers: { 'Content-Type': 'application/json' } },
        { data: Buffer.from(JSON.stringify({ ...GOOD, client_secret: 123 })), headers: { 'Content-Type': 'application/json' } },
      ];
      for (const options of cases) {
        await tokenCall(playwright, options, (response) => expectOAuthError(response, 400, 'invalid_request'));
      }
    });

    test('COMMON_TC_17_SEC A parameter sent twice returns 400 invalid_request (no parameter pollution) @security', async ({ playwright }) => {
      await tokenCall(playwright, { data: `${form(GOOD)}&client_id=unknown-client-qa`, headers: FORM },
        (response) => expectOAuthError(response, 400, 'invalid_request'));
    });

    test('COMMON_TC_18_SEC Missing client_secret, an empty one, malformed or wrong Basic returns 401 invalid_client; only Basic gets the challenge @security', async ({ playwright }) => {
      const cases = [
        [{ data: form({ grant_type: 'client_credentials', client_id: CLIENT_ID }), headers: FORM }, false],
        [{ data: form({ ...GOOD, client_secret: '' }), headers: FORM }, false],
        [{ data: form({ grant_type: 'client_credentials' }), headers: { ...FORM, Authorization: 'Basic not-base64!' } }, true],
        [{ data: form({ grant_type: 'client_credentials' }), headers: { ...FORM, Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:wrong-secret-qa`).toString('base64')}` } }, true],
      ];
      for (const [options, challenge] of cases) {
        await tokenCall(playwright, options, (response) => expectOAuthError(response, 401, 'invalid_client', challenge));
      }
    });

    test('COMMON_TC_20_SEC A JSON parameter sent twice returns 400 invalid_request, even if the last one is right @security', async ({ playwright }) => {
      const repeated = [
        `{"grant_type": "client_credentials", "client_id": ${JSON.stringify(CLIENT_ID)}, "client_secret": "wrong-secret-qa", "client_secret": ${JSON.stringify(CLIENT_SECRET)}}`,
        `{"grant_type": "client_credentials", "client_id": "unknown-client-qa", "client_id": ${JSON.stringify(CLIENT_ID)}, "client_secret": ${JSON.stringify(CLIENT_SECRET)}}`,
      ];
      for (const body of repeated) {
        await tokenCall(playwright, { data: Buffer.from(body), headers: { 'Content-Type': 'application/json' } },
          (response) => expectOAuthError(response, 400, 'invalid_request'));
      }
    });

    test('COMMON_TC_24_SEC Token body over 8 KB returns 413; a lone surrogate in JSON returns 400 @security', async ({ playwright }) => {
      await tokenCall(playwright, { data: form({ ...GOOD, pad: 'x'.repeat(9000) }), headers: FORM }, async (response) => {
        expect(response.status()).toBe(413);
        expect((await response.json()).error).toBe('invalid_request');
      });
      const lone = `{"grant_type":"client_credentials","client_id":${JSON.stringify(CLIENT_ID)},"client_secret":"\\ud800"}`;
      await tokenCall(playwright, { data: Buffer.from(lone), headers: { 'Content-Type': 'application/json' } },
        (response) => expectOAuthError(response, 400, 'invalid_request'));
    });

    // Uses up the token limit for this IP for up to a minute, so it runs only when asked:
    //   TOKEN_RATE_LIMIT=30 AUTH_ENABLED=true npx playwright test -g COMMON_TC_19
    test('COMMON_TC_19_SEC More than TOKEN_RATE_LIMIT_PER_MINUTE token requests get 429 with Retry-After @security', async ({ playwright }) => {
      const LIMIT = Number(process.env.TOKEN_RATE_LIMIT || 0);
      test.skip(!LIMIT, "set TOKEN_RATE_LIMIT to the server's TOKEN_RATE_LIMIT_PER_MINUTE and run this case on its own");
      await getToken(); // this worker's token, fetched before the limit is used up
      await withHeaders(playwright, {}, async (ctx) => {
        const bad = form({ ...GOOD, client_secret: 'wrong-secret-qa' }); // failed attempts count too
        const responses = await Promise.all(Array.from({ length: LIMIT + 5 }, () => ctx.post(TOKEN_PATH, { data: bad, headers: FORM })));
        const statuses = responses.map((r) => r.status());
        expect(statuses.filter((s) => s >= 500)).toEqual([]);
        const refused = responses.filter((r) => r.status() === 429);
        expect(refused.length).toBeGreaterThanOrEqual(5);
        for (const response of refused) {
          const retryAfter = Number(response.headers()['retry-after']);
          expect(retryAfter).toBeGreaterThanOrEqual(1);
          expect(retryAfter).toBeLessThanOrEqual(60);
          const body = await response.json();
          expect(body.error).toBe('rate_limited');
          expect(response.headers()['x-content-type-options']).toBe('nosniff');
        }
        // A caller cannot get a fresh allowance by naming another IP in X-Forwarded-For.
        for (const spoofed of ['1.2.3.4', '203.0.113.9, 198.51.100.7']) {
          const response = await ctx.post(TOKEN_PATH, { data: bad, headers: { ...FORM, 'X-Forwarded-For': spoofed } });
          expect(response.status(), `X-Forwarded-For: ${spoofed}`).toBe(429);
        }
        // The data endpoint has its own limits: an existing token keeps working.
        const api = await newApi(playwright);
        try {
          expect((await api.post(DSS, { data: { dealer_code: DEALER, scheme_tags: TAGS } })).status()).toBe(200);
        } finally {
          await api.dispose();
        }
      });
    });
  });
});
