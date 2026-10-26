// Dealer scheme status API: POST /api/v1/dealer-scheme-status with {"dealer_code", "scheme_tags"} returns the
// stored scheme status of one dealer (docs/api-contract.md). Settings are described in helpers.js.
// DEMO dealers are synthetic test data (npm run data:demo), not client data.
const crypto = require('crypto');
const {
  test, expect, AUTH_ENABLED, CLIENT_ID, CLIENT_SECRET, JWT_SECRET, SAMPLE_DATA, CACHE_ENABLED, DEALER, CHILD, PARENT,
  UNKNOWN_DEALER, DSS, HEALTH, TAGS, withHeaders, getToken, tokenClaims, signJwt, useClient, expectApiError,
  expectUnauthorized, expectSecurityHeaders, registerRequestContract,
} = require('./helpers');

const TOP_KEYS = ['data_as_of', 'dealer_code', 'dealer_name', 'schemes'];
const NOT_IN_SCOPE_KEYS = ['participation', 'reason', 'reason_code', 'scheme_tag'];
const IN_SCHEME_KEYS = ['benefit_blocked', 'current_slab', 'current_slab_no', 'details', 'final_on', 'header', 'od_status',
  'participation', 'provisional', 'scheme_tag'];
const IN_SCHEME_OPTIONAL = ['reason', 'reason_code', 'extra_benefits', 'reward_choice'];
const NOT_IN_SCOPE_CODES = ['REGION_NOT_IN_SCOPE', 'REGION_UNKNOWN', 'ENROLLED_IN_OTHER_SCHEME', 'NO_DATA'];
const IN_SCHEME_CODES = ['SLAB1_PERIOD_GSR_NOT_MET', 'SLAB1_MIN_FIRST_MONTH_GSR_NOT_MET', 'SLAB1_GROWTH_NOT_MET',
  'SLAB1_POINTS_NOT_MET', 'OD_ON_CHECK_DATE'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IST_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+05:30$/;

const inScheme = (body) => body.schemes.filter((s) => s.participation === 'IN_SCHEME');
const byTag = (body, tag) => body.schemes.find((s) => s.scheme_tag === tag);
const metric = (scheme, key) => (scheme.header.metrics.find((m) => m.key === key) || {}).value;

test.describe('Dealer scheme status', () => {
  const client = useClient();
  const dss = (body, options = {}) => client().post(DSS, { data: body, ...options });
  // Asserts 200 and the top-level shape first, so that a server error (for example 503) fails here instead of two
  // equal error bodies passing a "same result as" comparison.
  const statusOf = async (dealer, tags = TAGS) => {
    const response = await dss({ dealer_code: dealer, scheme_tags: tags });
    expect(response.status(), `dealer_code ${JSON.stringify(dealer)}`).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(TOP_KEYS);
    return body;
  };
  const sample = () => test.skip(!SAMPLE_DATA, 'asserts the synthetic DEMO dealers (SAMPLE_DATA=false)');

  // ===========================================================================
  // FUNCTIONAL — DSS_TC_1 to DSS_TC_10
  // ===========================================================================
  test.describe('Functional @functional', () => {
    test('DSS_TC_1 Returns 200 with dealer_code, dealer_name, data_as_of and one scheme per requested tag', async () => {
      const body = await statusOf(DEALER);
      expect(body.dealer_code).toBe(DEALER);
      expect(body.schemes.map((s) => s.scheme_tag)).toEqual(TAGS);
      expect(['string', 'object']).toContain(typeof body.dealer_name);
    });

    test('DSS_TC_2 Schemes come back in the order of scheme_tags', async () => {
      const reversed = [...TAGS].reverse();
      expect((await statusOf(DEALER, reversed)).schemes.map((s) => s.scheme_tag)).toEqual(reversed);
    });

    test('DSS_TC_3 One tag returns one scheme, equal to the same scheme in a multi-tag answer', async () => {
      const all = await statusOf(DEALER);
      for (const tag of TAGS) {
        const one = await statusOf(DEALER, [tag]);
        expect(one.schemes).toEqual([byTag(all, tag)]);
      }
    });

    test('DSS_TC_4 A child dealer code returns the parent result (dealer_code is the parent)', async () => {
      test.skip(!CHILD || !PARENT, 'no child dealer known (set CHILD_DEALER_CODE and PARENT_DEALER_CODE)');
      const child = await statusOf(CHILD);
      expect(child.dealer_code).toBe(PARENT);
      expect(child.schemes).toEqual((await statusOf(PARENT)).schemes);
    });

    test('DSS_TC_5 Spaces around dealer_code and scheme tags are trimmed', async () => {
      const plain = await statusOf(DEALER);
      const spaced = await statusOf(`  ${DEALER} `, TAGS.map((t) => ` ${t}  `));
      expect(spaced).toEqual(plain);
    });

    test('DSS_TC_6 Unknown dealer returns 404 DEALER_NOT_FOUND', async () => {
      await expectApiError(await dss({ dealer_code: UNKNOWN_DEALER, scheme_tags: TAGS }), 404, 'DEALER_NOT_FOUND');
    });

    test('DSS_TC_7 Unknown scheme tag returns 400 UNKNOWN_SCHEME_TAG, checked before the dealer', async () => {
      const error = await expectApiError(await dss({ dealer_code: DEALER, scheme_tags: [TAGS[0], 'QA9'] }), 400, 'UNKNOWN_SCHEME_TAG');
      expect(error.message).toBe('Scheme tag QA9 does not exist.');
      await expectApiError(await dss({ dealer_code: UNKNOWN_DEALER, scheme_tags: ['QA9'] }), 400, 'UNKNOWN_SCHEME_TAG');
      // QA-2: a tag with other characters than letters, digits, _ and - is not repeated in the message.
      const other = await expectApiError(await dss({ dealer_code: DEALER, scheme_tags: ['QA 9.x'] }), 400, 'UNKNOWN_SCHEME_TAG');
      expect(other.message).toBe('A scheme tag does not exist.');
    });

    test('DSS_TC_8 Scheme tags are case-sensitive', async () => {
      const lower = TAGS[0].toLowerCase();
      test.skip(lower === TAGS[0], 'the first tag has no upper-case letters');
      await expectApiError(await dss({ dealer_code: DEALER, scheme_tags: [lower] }), 400, 'UNKNOWN_SCHEME_TAG');
    });

    test('DSS_TC_9 Content-Type is matched case-insensitively and may carry a charset', async () => {
      const plain = await statusOf(DEALER);
      for (const contentType of ['Application/JSON', 'application/json; charset=utf-8', 'APPLICATION/JSON;charset=UTF-8']) {
        const response = await client().post(DSS, {
          data: Buffer.from(JSON.stringify({ dealer_code: DEALER, scheme_tags: TAGS })), headers: { 'Content-Type': contentType },
        });
        expect(response.status(), contentType).toBe(200);
        expect(await response.json()).toEqual(plain);
      }
    });

    test('DSS_TC_10 data_as_of is an IST date-time (or null) and the body is JSON with security headers', async () => {
      const response = await dss({ dealer_code: DEALER, scheme_tags: TAGS });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
      expectSecurityHeaders(response);
      const body = await response.json();
      if (body.data_as_of !== null) expect(body.data_as_of).toMatch(IST_DATE_TIME);
    });
  });

  // ===========================================================================
  // DATA VALIDATION — DSS_TC_11 to DSS_TC_20 (11–15 hold for any dealer; 16–20 assert the DEMO dealers)
  // ===========================================================================
  test.describe('Data Validation @validation', () => {
    test('DSS_TC_11 Each scheme has exactly the fields of its participation; reason codes are documented', async () => {
      for (const s of (await statusOf(DEALER)).schemes) {
        if (s.participation === 'NOT_IN_SCOPE') {
          expect(Object.keys(s).sort(), s.scheme_tag).toEqual(NOT_IN_SCOPE_KEYS);
          expect(NOT_IN_SCOPE_CODES).toContain(s.reason_code);
          expect(typeof s.reason).toBe('string');
        } else {
          expect(s.participation).toBe('IN_SCHEME');
          const keys = Object.keys(s);
          for (const k of IN_SCHEME_KEYS) expect(keys, `${s.scheme_tag}.${k}`).toContain(k);
          for (const k of keys) expect([...IN_SCHEME_KEYS, ...IN_SCHEME_OPTIONAL], `${s.scheme_tag}.${k}`).toContain(k);
          if (s.reason_code !== undefined) expect(IN_SCHEME_CODES).toContain(s.reason_code);
          expect(['NO_OD', 'OD', 'PENDING']).toContain(s.od_status);
          expect(typeof s.provisional).toBe('boolean');
          expect(typeof s.benefit_blocked).toBe('boolean');
        }
      }
    });

    test('DSS_TC_12 LOCKED / UNLOCKED: a slab is UNLOCKED only when the dealer is in that slab or a higher one', async () => {
      for (const s of inScheme(await statusOf(DEALER))) {
        for (const d of s.details) {
          const unlocked = s.current_slab_no !== null && d.slab_no <= s.current_slab_no;
          expect(d.lock_status, `${s.scheme_tag} ${d.slab}`).toBe(unlocked ? 'UNLOCKED' : 'LOCKED');
        }
        if (s.current_slab_no === null) expect(s.current_slab).toBeNull();
        else expect(s.current_slab).toBe(s.details.find((d) => d.slab_no === s.current_slab_no).slab);
      }
    });

    test('DSS_TC_13 Slab rule (CLAUDE.md section 6): the dealer is in the slab before the first slab with a failed condition', async () => {
      for (const s of inScheme(await statusOf(DEALER))) {
        const firstFail = s.details.findIndex((d) => d.conditions.some((c) => !c.met));
        const expected = firstFail === -1 ? s.details.length : firstFail; // number of slabs passed in order
        expect(s.current_slab_no ?? 0, s.scheme_tag).toBe(expected === 0 ? 0 : s.details[expected - 1].slab_no);
      }
    });

    test('DSS_TC_14 Slabs, gifts, conditions and metrics have the documented types', async () => {
      for (const s of inScheme(await statusOf(DEALER))) {
        expect(s.details.map((d) => d.slab_no)).toEqual([...s.details.map((d) => d.slab_no)].sort((a, b) => a - b));
        for (const d of s.details) {
          expect(Object.keys(d).sort()).toEqual(['cn_alternative', 'conditions', 'gift', 'lock_status', 'slab', 'slab_no']);
          expect(Object.keys(d.gift).sort()).toEqual(['description', 'value']);
          expect(d.gift.value === null || typeof d.gift.value === 'number').toBe(true);
          expect(typeof d.cn_alternative).toBe('number');
          for (const c of d.conditions) {
            expect(Object.keys(c).sort()).toEqual(['actual', 'key', 'label', 'met', 'required']);
            expect(typeof c.required).toBe('number');
            expect(c.actual === null || typeof c.actual === 'number').toBe(true);
            expect(typeof c.met).toBe('boolean');
          }
        }
        expect(Object.keys(s.header).sort()).toEqual(['from_date', 'metrics', 'q1_monthly_avg_gsr', 'scheme_name', 'to_date']);
        for (const m of s.header.metrics) {
          expect(Object.keys(m).sort()).toEqual(['key', 'label', 'unit', 'value']);
          expect(['INR', 'PERCENT', 'POINTS']).toContain(m.unit);
          expect(m.value === null || typeof m.value === 'number').toBe(true);
        }
      }
    });

    test('DSS_TC_15 Dates are YYYY-MM-DD; from_date <= to_date < final_on', async () => {
      for (const s of inScheme(await statusOf(DEALER))) {
        for (const value of [s.header.from_date, s.header.to_date, s.final_on]) expect(value).toMatch(DATE);
        expect(s.header.from_date <= s.header.to_date).toBe(true);
        expect(s.header.to_date < s.final_on).toBe(true);
      }
    });

    test('DSS_TC_16 [demo data] DEMO0001: FB-PAN Slab 1 of 7 (circular example), FB-TNHPJK not in scope, SP-Q3 no data', async () => {
      sample();
      const body = await statusOf('DEMO0001', ['FB-PAN', 'FB-TNHPJK', 'SP-Q3']);
      const abc1 = byTag(body, 'FB-PAN');
      expect(abc1).toMatchObject({ participation: 'IN_SCHEME', current_slab: 'Slab 1', current_slab_no: 1, benefit_blocked: false });
      expect(abc1.details).toHaveLength(7);
      expect(abc1.details.map((d) => d.lock_status)).toEqual(['UNLOCKED', ...Array(6).fill('LOCKED')]);
      expect(abc1.header.q1_monthly_avg_gsr).toBe(150000);
      expect([metric(abc1, 'oct_gsr'), metric(abc1, 'nov_gsr'), metric(abc1, 'period_gsr'), metric(abc1, 'growth_pct')])
        .toEqual([160000, 200000, 360000, 20]);
      expect(abc1.details[0].gift.value).toBe(5000);
      expect(abc1.details[0].cn_alternative).toBe(4500);
      expect(abc1.details[0].conditions.map((c) => [c.key, c.required, c.actual, c.met])).toEqual([
        ['period_gsr', 250000, 360000, true], ['min_first_month_gsr', 100000, 160000, true], ['growth_pct', 20, 20, true]]);
      expect(byTag(body, 'FB-TNHPJK')).toMatchObject({ participation: 'NOT_IN_SCOPE', reason_code: 'REGION_NOT_IN_SCOPE' });
      expect(byTag(body, 'SP-Q3')).toMatchObject({ participation: 'NOT_IN_SCOPE', reason_code: 'NO_DATA' });
    });

    test('DSS_TC_17 [demo data] No slab: DEMO0002 fails Slab 1 growth; DEMO0003 meets Slab 3 but stops at Slab 1', async () => {
      sample();
      for (const code of ['DEMO0002', 'DEMO0003']) {
        const abc1 = byTag(await statusOf(code, ['FB-PAN']), 'FB-PAN');
        expect(abc1, code).toMatchObject({ current_slab: null, current_slab_no: null, reason_code: 'SLAB1_GROWTH_NOT_MET' });
        expect(abc1.details.every((d) => d.lock_status === 'LOCKED'), code).toBe(true);
      }
      const demo3 = byTag(await statusOf('DEMO0003', ['FB-PAN']), 'FB-PAN');
      expect(demo3.details[2].conditions.every((c) => c.met)).toBe(true); // all Slab 3 conditions met (CLAUDE.md section 11)
    });

    test('DSS_TC_18 [demo data] DEMO0004 Slab 7 with returns; DEMO0005 FB-TNHPJK Slab 2 without growth; DEMO0006 region unknown', async () => {
      sample();
      const demo4 = byTag(await statusOf('DEMO0004', ['FB-PAN']), 'FB-PAN');
      expect(demo4.current_slab_no).toBe(7);
      // Only the dealer's slab is UNLOCKED; lower slabs stay LOCKED (22-10-2026).
      expect(demo4.details.map((d) => d.lock_status)).toEqual([...Array(6).fill('LOCKED'), 'UNLOCKED']);
      expect(metric(demo4, 'mrv_total')).toBe(-20000);
      const demo5 = await statusOf('DEMO0005', ['FB-PAN', 'FB-TNHPJK']);
      expect(byTag(demo5, 'FB-PAN').reason_code).toBe('REGION_NOT_IN_SCOPE');
      const abc2 = byTag(demo5, 'FB-TNHPJK');
      expect(abc2.current_slab_no).toBe(2);
      expect(abc2.details[0].conditions.map((c) => c.key)).toEqual(['period_gsr', 'min_first_month_gsr']); // no growth for FB-TNHPJK
      const demo6 = await statusOf('DEMO0006', ['FB-PAN', 'FB-TNHPJK']);
      expect(demo6.dealer_name).toBeNull(); // not in the dealer master
      expect(demo6.schemes.map((s) => s.reason_code)).toEqual(['REGION_UNKNOWN', 'REGION_UNKNOWN']);
    });

    test('DSS_TC_19 [demo data] Star Points: points, trip gifts with null value, extra benefits, enrolment', async () => {
      sample();
      const sp7 = byTag(await statusOf('DEMO0007', ['SP-Q3']), 'SP-Q3');
      expect(sp7.current_slab_no).toBe(3);
      expect(metric(sp7, 'points_earned')).toBe(138000);
      expect(sp7.details[0].conditions.map((c) => c.key)).toEqual(['points', 'growth_pct']);
      expect(sp7.details[1].gift.value).toBeNull(); // Slab 2 is a cruise ticket
      expect(sp7.details[2].cn_alternative).toBe(96000);
      expect(sp7.extra_benefits).toEqual([]);
      const sp8 = byTag(await statusOf('DEMO0008', ['SP-Q3']), 'SP-Q3');
      expect(sp8.current_slab_no).toBe(7);
      expect(metric(sp8, 'points_earned')).toBe(480000);
      expect(sp8.extra_benefits).toHaveLength(2);
      for (const e of sp8.extra_benefits) {
        expect(Object.keys(e).sort()).toEqual(['cn_option_value', 'description', 'destination', 'extra_ticket_cn_value', 'extra_tickets']);
      }
      const demo9 = await statusOf('DEMO0009', ['FB-PAN', 'FB-TNHPJK', 'SP-Q3']);
      expect(demo9.schemes.map((s) => s.reason_code)).toEqual(['ENROLLED_IN_OTHER_SCHEME', 'ENROLLED_IN_OTHER_SCHEME', 'SLAB1_POINTS_NOT_MET']);
    });

    test('DSS_TC_20 [demo data] DEMO0011: outstanding on the check date blocks the benefit but keeps the slab', async () => {
      sample();
      const abc1 = byTag(await statusOf('DEMO0011', ['FB-PAN']), 'FB-PAN');
      expect(abc1).toMatchObject({ current_slab_no: 1, benefit_blocked: true, od_status: 'OD', reason_code: 'OD_ON_CHECK_DATE' });
    });

    test('DSS_TC_88 [demo data] Zero Q1 sales (BA, 19-10-2026): none of any product -> no slab; other products only -> growth met', async () => {
      sample();
      const none = byTag(await statusOf('DEMO0012', ['FB-PAN']), 'FB-PAN');
      expect(none).toMatchObject({ participation: 'IN_SCHEME', current_slab: null, current_slab_no: null, reason_code: 'SLAB1_GROWTH_NOT_MET' });
      expect(none.header.q1_monthly_avg_gsr).toBe(0);
      expect(none.details[0].conditions.map((c) => [c.key, c.met])).toEqual([['period_gsr', true], ['min_first_month_gsr', true], ['growth_pct', false]]);
      expect(none.details.every((d) => d.lock_status === 'LOCKED')).toBe(true);
      const other = byTag(await statusOf('DEMO0013', ['FB-PAN']), 'FB-PAN');
      expect(other).toMatchObject({ participation: 'IN_SCHEME', current_slab_no: 1 });
      expect(other.header.q1_monthly_avg_gsr).toBe(0); // zero scheme base
      expect(other.details[0].conditions.find((c) => c.key === 'growth_pct')).toMatchObject({ required: 20, actual: null, met: true });
    });

    test('DSS_TC_89 [demo data] Star Points growth uses total GSR of all products (BA, 19-10-2026)', async () => {
      sample();
      const gt = byTag(await statusOf('DEMO0014', ['SP-Q3']), 'SP-Q3');
      expect(gt).toMatchObject({ participation: 'IN_SCHEME', current_slab_no: 1 });
      // Table III GSR is flat (5 L a month in Q1 and Q3); total GSR grows 6 L -> 7 L a month (+16.66%).
      expect(gt.header.q1_monthly_avg_gsr).toBe(600000);
      expect([metric(gt, 'q3_gsr'), metric(gt, 'growth_pct'), metric(gt, 'points_earned')]).toEqual([2100000, 16.66, 90000]);
      expect(gt.details[0].conditions.map((c) => [c.key, c.required, c.actual, c.met])).toEqual([
        ['points', 85000, 90000, true], ['growth_pct', 10, 16.66, true]]);
    });
  });

  // ===========================================================================
  // REQUEST CONTRACT — DSS_TC_21 to DSS_TC_73 (edge, negative and security cases, helpers.js)
  // ===========================================================================
  registerRequestContract({ prefix: 'DSS', path: DSS, start: 21 });

  // ===========================================================================
  // RATE LIMITS — DSS_TC_74_SEC (per IP, RATE_LIMIT) and DSS_TC_75_SEC (per client, CLIENT_RATE_LIMIT).
  // Each runs only when its variable is set to the server's value. Start a test server with a low value.
  // ===========================================================================
  test.describe('Rate limit @security', () => {
    test('DSS_TC_74_SEC More than the per-IP limit in one second gets 429 with Retry-After: 1; health is never limited', async () => {
      const LIMIT = Number(process.env.RATE_LIMIT || 0);
      test.skip(!LIMIT, "set RATE_LIMIT to the server's RATE_LIMIT_PER_SECOND (low, e.g. 20)");
      const call = () => dss({ dealer_code: DEALER, scheme_tags: TAGS });
      await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 20)); // start of a window
      const [responses, health] = await Promise.all([
        Promise.all(Array.from({ length: LIMIT * 3 }, call)),
        Promise.all(Array.from({ length: LIMIT * 2 }, () => client().get(HEALTH))),
      ]);
      expect(responses.map((r) => r.status()).filter((s) => s >= 500)).toEqual([]);
      const refused = responses.filter((r) => r.status() === 429);
      expect(refused.length).toBeGreaterThan(0);
      for (const response of refused) {
        expect(response.headers()['retry-after']).toBe('1');
        await expectApiError(response, 429, 'RATE_LIMITED');
      }
      expect(health.map((r) => r.status()).filter((s) => s !== 200)).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect((await call()).status()).toBe(200);
    });

    test('DSS_TC_75_SEC More than the per-client limit in one minute gets 429 with Retry-After <= 60', async () => {
      const LIMIT = Number(process.env.CLIENT_RATE_LIMIT || 0);
      test.skip(!LIMIT, "set CLIENT_RATE_LIMIT to the server's API_RATE_LIMIT_PER_MINUTE (low, e.g. 5) and run it alone");
      test.skip(!AUTH_ENABLED, 'the per-client limit counts by client_id (AUTH_ENABLED != true)');
      const responses = [];
      for (let i = 0; i < LIMIT + 3; i++) responses.push(await dss({ dealer_code: DEALER, scheme_tags: TAGS }));
      const statuses = responses.map((r) => r.status());
      expect(statuses.filter((s) => s >= 500)).toEqual([]);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(3);
      for (const response of responses.filter((r) => r.status() === 429)) {
        const retryAfter = Number(response.headers()['retry-after']);
        expect(retryAfter).toBeGreaterThanOrEqual(1);
        expect(retryAfter).toBeLessThanOrEqual(60);
        await expectApiError(response, 429, 'RATE_LIMITED');
      }
    });
  });

  // ===========================================================================
  // BEARER TOKENS — DSS_TC_76_SEC onwards (DSS_TC_49–53_SEC cover a missing, garbage or tampered token, a
  // token in the query string and X-API-Key). Tokens the server never issued get 401 (403 only for a
  // missing scope), never 200 or 500. TC_80–83 forge tokens with the server's key (JWT_SECRET).
  // ===========================================================================
  test.describe('Bearer tokens @security', () => {
    test.beforeEach(() => test.skip(!AUTH_ENABLED, 'server does not require a token (AUTH_ENABLED != true)'));
    const body = { dealer_code: DEALER, scheme_tags: TAGS };
    const callWith = async (playwright, authorization, check) =>
      withHeaders(playwright, { Authorization: authorization }, async (ctx) => check(await ctx.post(DSS, { data: body })));
    const needsKey = () => test.skip(!JWT_SECRET, "set JWT_SECRET to the server's key to forge tokens");

    test('DSS_TC_76_SEC Non-ASCII Bearer token returns 401 Invalid token, never 500', async ({ playwright }) => {
      for (const token of ['kéy', `${await getToken()}é`, 'ÿ'.repeat(14)]) {
        await callWith(playwright, `Bearer ${token}`, (response) => expectUnauthorized(response, 'Invalid token'));
      }
    });

    test('DSS_TC_77_SEC Other schemes (Basic with the client credentials, Token, JWT, a bare token) return 401', async ({ playwright }) => {
      const token = await getToken();
      const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
      for (const authorization of [`Basic ${basic}`, `Token ${token}`, `JWT ${token}`, token]) {
        await callWith(playwright, authorization, (response) => expectUnauthorized(response, 'Not authenticated'));
      }
    });

    test('DSS_TC_78_SEC Unsigned token (alg "none") returns 401', async ({ playwright }) => {
      for (const alg of ['none', 'None', 'NONE']) {
        await callWith(playwright, `Bearer ${signJwt(tokenClaims(), '', { alg, typ: 'JWT' })}`,
          (response) => expectUnauthorized(response, 'Invalid token'));
      }
    });

    test('DSS_TC_79_SEC Token signed with another key or algorithm (RS256) returns 401', async ({ playwright }) => {
      const claims = tokenClaims();
      const tokens = [signJwt(claims, 'an-attacker-key-that-is-at-least-32-chars'), signJwt(claims, '')];
      const rs = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
      const unsigned = `${Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
      tokens.push(`${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), rs).toString('base64url')}`);
      for (const token of tokens) {
        await callWith(playwright, `Bearer ${token}`, (response) => expectUnauthorized(response, 'Invalid token'));
      }
    });

    test('DSS_TC_80_SEC Expired token returns 401 Token expired with error="invalid_token"', async ({ playwright }) => {
      needsKey();
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(tokenClaims({ iat: now - 7200, nbf: now - 7200, exp: now - 120 }), JWT_SECRET);
      await callWith(playwright, `Bearer ${token}`, async (response) => {
        await expectUnauthorized(response, 'Token expired');
        expect(response.headers()['www-authenticate']).toContain('error_description="Token expired"');
      });
    });

    test('DSS_TC_81_SEC Token without the schemes:read scope returns 403 INSUFFICIENT_SCOPE', async ({ playwright }) => {
      needsKey();
      for (const scope of ['', 'schemes:write', 'admin', undefined]) {
        await callWith(playwright, `Bearer ${signJwt(tokenClaims({ scope }), JWT_SECRET)}`, async (response) => {
          const error = await expectApiError(response, 403, 'INSUFFICIENT_SCOPE');
          expect(error.message, String(scope)).toBe('Insufficient scope');
          expect(response.headers()['www-authenticate']).toContain('error="insufficient_scope"');
        });
      }
    });

    test('DSS_TC_82_SEC Correctly signed token with a wrong claim or algorithm returns 401 Invalid token', async ({ playwright }) => {
      needsKey();
      const now = Math.floor(Date.now() / 1000);
      const cases = {
        'unknown client (revoked)': [{ sub: 'not-a-registered-client' }],
        'wrong audience': [{ aud: 'another-api' }],
        'wrong issuer': [{ iss: 'https://evil.example.com' }],
        'not valid yet': [{ nbf: now + 600, iat: now + 600 }],
        'no exp': [{ exp: undefined }],
        'no jti': [{ jti: undefined }],
        'no sub': [{ sub: undefined }],
        'no iat': [{ iat: undefined }],
        'no nbf': [{ nbf: undefined }],
        'HS512 with the right key': [{}, { alg: 'HS512', typ: 'JWT' }],
      };
      for (const [name, [overrides, header]] of Object.entries(cases)) {
        await callWith(playwright, `Bearer ${signJwt(tokenClaims(overrides), JWT_SECRET, header)}`, async (response) => {
          expect(response.status(), name).toBe(401);
          await expectUnauthorized(response, 'Invalid token');
        });
      }
    });

    test('DSS_TC_83_SEC A token that expired less than 30 s ago is still accepted (clock skew)', async ({ playwright }) => {
      needsKey();
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(tokenClaims({ iat: now - 3600, nbf: now - 3600, exp: now - 10 }), JWT_SECRET);
      await callWith(playwright, `Bearer ${token}`, (response) => expect(response.status()).toBe(200));
    });

    test('DSS_TC_84 Valid token works with any case of "Bearer" and is reusable', async ({ playwright }) => {
      const token = await getToken();
      for (const scheme of ['Bearer', 'bearer', 'BEARER']) {
        await callWith(playwright, `${scheme} ${token}`, async (response) => {
          expect(response.status(), scheme).toBe(200);
          expect((await response.json()).dealer_code).toBe(DEALER);
        });
      }
    });
  });

  // ===========================================================================
  // RESPONSE CACHE — DSS_TC_85–86 (CACHE_ENABLED=true: the server has CACHE_ENABLED=true and REDIS_URL)
  // ===========================================================================
  test.describe('Response cache @functional', () => {
    test.beforeEach(() => test.skip(!CACHE_ENABLED, 'server has no response cache (CACHE_ENABLED != true)'));

    test('DSS_TC_85 First request is X-Cache MISS, the repeat is HIT with the same status and body (200 and 404)', async () => {
      // A new random dealer code: nobody asked for it before, so the first answer cannot be cached yet.
      const fresh = { dealer_code: `QA${crypto.randomBytes(6).toString('hex')}`, scheme_tags: TAGS };
      const miss = await dss(fresh);
      expect(miss.headers()['x-cache']).toBe('MISS');
      const hit = await dss(fresh);
      expect(hit.headers()['x-cache']).toBe('HIT');
      expect([miss.status(), hit.status()]).toEqual([404, 404]);
      expect(await hit.text()).toBe(await miss.text());
      expectSecurityHeaders(hit);
      const first = await dss({ dealer_code: DEALER, scheme_tags: TAGS });
      const again = await dss({ dealer_code: DEALER, scheme_tags: TAGS });
      expect(['MISS', 'HIT']).toContain(first.headers()['x-cache']);
      expect(again.headers()['x-cache']).toBe('HIT');
      expect([first.status(), again.status()]).toEqual([200, 200]);
      expect(await again.json()).toEqual(await first.json());
    });

    test('DSS_TC_86 The cache keeps the tag order and never serves one order for another; INVALID_REQUEST 400s are not cached', async () => {
      const reversed = [...TAGS].reverse();
      for (let i = 0; i < 2; i++) {
        expect((await (await dss({ dealer_code: DEALER, scheme_tags: TAGS })).json()).schemes.map((s) => s.scheme_tag)).toEqual(TAGS);
        expect((await (await dss({ dealer_code: DEALER, scheme_tags: reversed })).json()).schemes.map((s) => s.scheme_tag)).toEqual(reversed);
      }
      const invalid = await dss({ dealer_code: '', scheme_tags: TAGS });
      expect(invalid.status()).toBe(400);
      expect(invalid.headers()['x-cache']).toBeUndefined();
    });

    test('DSS_TC_87_SEC A request without a valid token never gets a cached answer', async ({ playwright }) => {
      test.skip(!AUTH_ENABLED, 'server does not require a token (AUTH_ENABLED != true)');
      await dss({ dealer_code: DEALER, scheme_tags: TAGS }); // make sure the answer is cached
      await withHeaders(playwright, {}, async (ctx) => {
        const response = await ctx.post(DSS, { data: { dealer_code: DEALER, scheme_tags: TAGS } });
        await expectUnauthorized(response, 'Not authenticated');
        expect(response.headers()['x-cache']).toBeUndefined();
      });
    });
  });
});

