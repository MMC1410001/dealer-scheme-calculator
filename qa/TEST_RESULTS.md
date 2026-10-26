# Dealer scheme status API — test execution report

| | |
|---|---|
| Date | 17-10-2026 (second run of the QA suite, after the fixes of QA-1 to QA-5) |
| Build | `scheme-calculator` 0.1.0, branch `feat/phase2-dealer-status-api`, uncommitted changes of this date; `npm run build` (Next.js 16.4.2), `next start` (one Node.js process) |
| Environment | Local: Apple laptop, 8 cores, 16 GB · PostgreSQL in Docker (`scheme-calc-pg`, port 5433) · Redis 7 in Docker (`scheme-calc-redis`, port 6380) · Node.js 22.23.2 · k6 1.7.1 |
| Server under test | Port 3460: `APP_ENV=local REDIS_URL=redis://localhost:6380 CACHE_ENABLED=true DOCS_ENABLED=true API_RATE_LIMIT_PER_MINUTE=1000000` (all other values from `.env`: auth on with the local example client, per-IP limit 2,500/s, token limit 30/min). Extra servers for the limit cases: 3461 (`RATE_LIMIT_PER_SECOND=20`, Redis db 1), 3462 (`API_RATE_LIMIT_PER_MINUTE=5`, Redis db 2). Each server was started new from the final build. All servers are stopped. |
| Data | Local database: 44,433 real dealers with results (133,332 result rows) plus the synthetic DEMO dealers (`npm run data:demo`) |

> The performance numbers come from one laptop that runs k6, the app, PostgreSQL and Redis on the same 8 cores,
> with one `next start` process. They show the behaviour and the relative limits of the API, not the production
> capacity. Run k6 again on the deployed environment.

> `API_RATE_LIMIT_PER_MINUTE=1000000` on the main QA server of this run (17-10-2026): all suites use one `client_id`,
> and the default limit was then 600 a minute for each client, which stops k6 and ZAP.
> **Since 18-10-2026 (decision Q5) the default is 1,00,000 a minute for each client.** With this default, the main QA
> server needs no override for Playwright, newman, ZAP and the k6 smoke, load, stress and spike runs: their highest
> rate in this report is about 620 requests a second (stress), that is about 37,200 a minute. Only `rate.js` at its
> default 1,700 a second (1,02,000 a minute) is above the limit. For that run, use `RATE=1650` or start the server with
> `API_RATE_LIMIT_PER_MINUTE` above `RATE` × 60 (for example 200000). DSS_TC_75_SEC still needs its own server with a
> low value (`API_RATE_LIMIT_PER_MINUTE=5`, server 3462). A local `.env` made from the old `.env.example` still has
> `API_RATE_LIMIT_PER_MINUTE=600`: change it to 100000 or remove the line.

## UI compatibility run — 22-10-2026: Dealers list, slab view, three browsers

Scope: the new admin Dealers list (scheme filter, Unlocked / Locked tabs, paging), the slab view without conditions
(only the dealer's slab Unlocked), the iframe, the report, Reward choices and Sync runs. Server: `next start` on port
3400, local data plus the DEMO dealers. Browsers: Google Chrome, Firefox 153 (Playwright build 1538), WebKit 26.6
(build 2336). Widths 320, 390, 768 and 1280 px.

| Check | Result |
|---|---|
| Layout sweep: 13 pages × 3 browsers × 4 widths (page-level horizontal scroll, elements outside the viewport, screenshots reviewed) | 156 checks, 0 issues after the fixes |
| Browser suite `UI_BROWSERS=chrome,firefox,webkit` (UI_TC_1–19), two runs | 54 passed, 3 skipped (UI_TC_14 on localhost) each run |
| Vitest | 494 passed, 5 skipped |

Defects found and fixed:

| # | Defect | Browsers | Fix |
|---|---|---|---|
| UI-1 | Dealers list at 320–390 px: the page scrolls sideways (529 px). The sr-only "view slabs" labels are absolutely positioned with no positioned ancestor, so they escape the table's scroll box. | Chrome, Firefox | `relative` on the scroll box. |
| UI-2 | Dealers list at phone width: Eligibility and Slab are off-screen; the user must scroll the table. | All | Cards below 640 px (code, eligibility, name, region, slab); the table from 640 px. |
| UI-3 | Dealers page at 320–390 px: the page is as wide as the selected scheme name (504 px). The `<select>` grows to its option text. | WebKit (Safari) | `min-w-0` on the field and `w-full min-w-0 truncate` on the select. |
| UI-4 | A login in the same second as a logout is already logged out; two logins in the same second share one session, so a logout on one device ends the other. The session value had no random part. | All | Random nonce `n` in the session payload (unit test added). Existing sessions stay valid. |

Not a defect: WebKit drops the `Secure` admin cookie on plain `http://localhost` (`next start` sets `Secure`). Dev, UAT
and prod use HTTPS. The spec keeps the session in WebKit on a local http server only.

## Fix — 21-10-2026: no Basic challenge for body credentials

Found in Swagger UI on Dev: a wrong `client_secret` in the body gave `401` with `WWW-Authenticate: Basic`. Chrome then
opens its own sign-in dialog, and the Swagger request does not finish. Fix: the token endpoint sends the Basic challenge
only when the request has an `Authorization` header (RFC 6749 section 5.2). Tests: Vitest (both cases), COMMON_TC_8_SEC,
COMMON_TC_18_SEC (body: no challenge; malformed or wrong Basic: challenge), Postman "wrong secret in HTTP Basic".
Local results: Vitest 446 passed; Playwright API 108 passed, 7 skipped; newman 72 requests, 498 checks, 0 failed.
Dev gets the fix with the next deploy.

## Script update — 21-10-2026 (after Dev run 2)

New: DEMO0012–DEMO0014 and DSS_TC_88–89 (zero-Q1 rule and Star Points growth on total GSR, BA 19-10-2026), three
Postman requests for them, the browser suite `ui/ui_smoke.spec.js` (UI_TC_1–16), Vitest `src/app/api/v1/health/route.test.ts`
(health checks the database: 200 when it answers, 503 when it fails, 15 s cache), the Dev newman command with the child
and parent codes, and a sync lock key that does not look like a dealer code (DEV-4 fixed).

| Suite | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Vitest (`npm test`) | 451 | 446 | 0 | 5 (needs `TEST_REDIS_URL`) |
| `npm run typecheck`, `npm run lint`, `npm run build` | 3 | 3 | 0 | 0 |
| Playwright API, local (`AUTH_ENABLED=true`, cache off) | 115 | 108 | 0 | 7 (COMMON_TC_4_SEC, COMMON_TC_19_SEC, DSS_TC_74–75_SEC, DSS_TC_85–87: need HTTPS, a limit server or the cache) |
| Playwright DEMO cases DSS_TC_16–20, 88, 89 (local) | 7 | 7 | 0 | 0 |
| newman, Local (cache off) | 71 requests, 490 checks | 490 | 0 | – |
| Browser suite, local | 16 | 15 | 0 | 1 (UI_TC_14 on localhost) |
| Browser suite, Dev (`npm run test:ui:dev`) | 16 | 16 | 0 | 0 |
| Repository hygiene | – | passed | 0 | – |

## Dev run 2 — 21-10-2026 afternoon (`https://dev.scheme-calculator.example.com`)

Same server state as the morning run (no change on the server). Client `dev-client`. Test dealers from
`dealers.json`. Load, stress and spike were not run: the Dev VM also runs production containers of other projects.

| Suite | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Vitest (`npm test`, local) | 444 | 439 | 0 | 5 (needs `TEST_REDIS_URL`) |
| Playwright — `npm run test:dev` | 113 | 95 | 3 (COMMON_TC_26_SEC, DSS_TC_65_SEC, DSS_TC_67_SEC: DEV-1, DEV-2) | 15 (by design) |
| newman — Dev, with `childDealerCode` and `parentDealerCode` | 68 requests, 465 checks | 464 | 1 (HSTS sent once: DEV-1) | – |
| k6 `smoke.js` (`DEALERS_FILE=true`) | 58 requests | 100% checks | 0 errors | p95 75 ms, p99 123 ms |
| Semgrep, gitleaks | – | no findings | – | – |
| npm audit | – | production: 0 | – | dev only: 5 high (`braces`), report only |
| Repository hygiene | – | – | 1 | `SYNC_LOCK_KEY` in `src/sync/sync-lock.ts` was a 10-digit number that starts with 7, so it looked like a dealer code. It was a lock number, not client data (not in the dealer master). Fixed: the key now starts with 5 (DEV-4). |
| OWASP ZAP API scan | 121 rules | 118 PASS | FAIL-NEW 0 | WARN-NEW 3 |
| Scripted UI (Playwright, Chrome): admin redirect, wrong password, login, report ABC1–ABC3, last sync, dealer search, support view, unknown dealer, sync runs, logout, iframe on 390 px | 16 | 15 | 0 | 1 check not valid: the 1-character search text match failed on the React text marker; the page shows "Enter at least 2 characters." |

ZAP warnings:

- **DEV-3 One 502 on `POST /api/v1/auth/token`.** nginx did not get an answer from the app for one request. Health was
  200 right after the scan. DevOps: check `docker ps` (container uptime) and `docker logs dev-scheme-calc-app` around
  15:25 IST for a restart or a crash.
- The 503 answers on `/computeMetadata/v1/`, `/latest/meta-data/` and similar are the ZAP cloud-metadata rule. It sends
  another `Host` header, and nginx answers with its default page. Not an app error.
- HSTS sent twice (DEV-1, as in the morning).

## Dev run — 21-10-2026 (`https://dev.scheme-calculator.example.com`)

First run on the Dev server (Docker on `app-net`, nginx-proxy with Let's Encrypt, database
`shared-postgres-db`, data as of 18-10-2026). Client `dev-client`. Test dealers from `npm run qa:pick-dealers`
(git-ignored `dealers.json`). The cache is off on Dev (no Redis yet). ZAP, load, stress and spike were not run
(shared server; agree the load with the team first).

| Suite | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Playwright — `npm run test:dev` | 113 | 95 | 3 (COMMON_TC_26_SEC, DSS_TC_65_SEC, DSS_TC_67_SEC) | 15 (by design: DEMO data 16–20, cache 85–87, limit servers 74/75/19, `JWT_SECRET` 80–83) |
| newman — Dev environment | 68 requests, 467 checks | 465 | 2 (HSTS sent once; child dealer, see below) | – |
| k6 `smoke.js` (`DEALERS_FILE=true`) | 57 requests | 100% checks | 0 errors | p95 127 ms, p99 169 ms |
| Browser — admin login, report (ABC1–ABC3), dealer search, sync runs, logout redirect | 5 | 5 | 0 | – |
| Browser/curl — iframe: valid token shows the dealer; changed signature, changed payload, expired token and no token show "Session expired" | 5 | 5 | 0 | – |

Failures:

- **DEV-1 HSTS sent twice** (DSS_TC_67_SEC, newman). nginx adds `max-age=31536000; includeSubDomains` and the app adds
  `max-age=31536000`. Fix in nginx or in the app: send one header only.
- **DEV-2 TRACE answered by nginx** (COMMON_TC_26_SEC, DSS_TC_65_SEC). nginx returns 405 with an HTML body before the
  request gets to the app. No data is exposed. Accept it, or let nginx pass TRACE to the app.
- newman "dealer_code is the parent": test set-up only (`parentDealerCode` not given). A direct call returns the parent.

Other findings: the last sync is #2 of 19-10-2026; no daily sync ran on 20 or 21-10-2026. The server `.env` is a mix of
`.env.dev` and the local `.env` (admin password and embed secret of the local file). Phone width was not checked.

## Re-check — 18-10-2026 (local, after the decisions Q5, Q7, Q8 and Q9)

Changes: per-client default 1,00,000 a minute; `REDIS_URL` check and redaction for `redis://` and `rediss://`
(new `src/server/redis.test.ts`, new cases in `src/server/config.test.ts`); Dev URL in Postman, Swagger and
`test:dev`. Server for Playwright: port 3480, `next start` of the new build, `APP_ENV=local REDIS_URL=redis://localhost:6380
CACHE_ENABLED=true` and `API_RATE_LIMIT_PER_MINUTE=` (empty, so the code default 100000 applies; the startup line showed
`100000/min per client`). k6, newman and the security scans were not run again.

| Suite | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Vitest (`npm test`) | 410 | 405 | 0 | 5 (`ratelimit.redis.test.ts`, needs `TEST_REDIS_URL`) |
| Vitest with the real Redis (`TEST_REDIS_URL=redis://localhost:6380/15`) | 410 | 410 | 0 | 0 |
| `npm run lint`, `npm run typecheck`, `npm run build` | 3 | 3 | 0 | 0 |
| Playwright — DSS + common (`AUTH_ENABLED=true CACHE_ENABLED=true`, 4 workers) | 113 | 109 | 0 | 4 (COMMON_TC_4_SEC, DSS_TC_74_SEC, DSS_TC_75_SEC, COMMON_TC_19_SEC, as below) |

The server log of 3480 had no 5xx line, no 429 and no stack trace.

## Full local run and fixes — 18-10-2026

All suites ran again on a production build on port 3400 (`APP_ENV=local REDIS_URL=redis://localhost:6380
CACHE_ENABLED=true DOCS_ENABLED=true`, code default 1,00,000 a minute for each client). The app had no defect. Two
defects of the QA tools were found and fixed.

| Suite | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Vitest (`npm test`) | 411 | 406 | 0 | 5 (needs `TEST_REDIS_URL`) |
| Vitest with the real Redis | 411 | 411 | 0 | 0 |
| `npm run lint`, `npm run typecheck`, `npm run build` | 3 | 3 | 0 | 0 |
| Postman (newman 6.2.2, Local, `cacheEnabled=true`) — 68 requests, 13 token requests — assertions | 477 | 477 | 0 | 0 |
| Playwright — DSS + common | 113 | 109 | 0 | 4 (by design, as below) |
| k6 smoke (30 s, 1 user) | — | checks 100% | 0% failed | — |
| Security: Semgrep, npm audit, gitleaks, hygiene | 4 scans | 4 | 0 | Semgrep 0 findings; npm audit production 0; gitleaks no leaks; hygiene 173 files, no problems |
| Security: OWASP ZAP (`-silent` fallback, see QA-8) | 1 scan | 1 | 0 | FAIL-NEW 0, WARN-NEW 2 (100001 on non-API paths; 10105 Basic auth over plain HTTP), PASS 112 |

The server logs had no 5xx line and no stack trace.

| # | Sev | Finding | Status |
|---|---|---|---|
| QA-8 | Medium (QA tool) | ZAP did not start: `zap-api-scan.py` adds `-addonupdate`, and the add-on download hung after "There is/are 5 newer addons". The scan failed after 600 s (twice). | **Fixed** in `qa/security/run_scans.sh`: ZAP gets at most `ZAP_START_MINUTES` (default 3) to start. On exit code 3 the script runs the scan again with `-silent` (no add-on update). Then 6 beta passive rules do not run (10026, 10049, 10063, 10099, 10110, 90004): PASS 112 in place of 118. Proof: the next run fell back after 180 s and passed (203 s in total). |
| QA-9 | Medium (QA tool) | A Postman run straight after ZAP gave 111 failed checks. The ZAP active scan sends 350–435 attack requests to `/api/v1/auth/token`; the token limit (30 a minute, one shared bucket with `TRUSTED_PROXY_HOPS=0`) answered them with 429, as designed. The collection pre-request script then asked for a token again before each request: 67 more token requests, all 429, 134 requests in total, and only 401 failures that hid the cause. | **Fixed** in `qa/postman/build-collection.ts`: after a failed token request the script waits 60 s before it asks again, and one check "Token request succeeds" fails with the cause and the hint to wait one minute. Guard test in `collection.test.ts`. Proof with a used-up token limit: 68 requests (not 134), 13 token requests (as in a normal run), one clear token failure. `run_scans.sh` and `qa/README.md` Step 6 now say: run ZAP last, then wait one minute. |

## Summary — 17-10-2026 (local)

| Suite | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Vitest (`npm test`: app tests + `qa/postman` and `qa/swagger` guards) | 395 | 390 | 0 | 5 (`ratelimit.redis.test.ts`, needs `TEST_REDIS_URL`) |
| Vitest with the real Redis (`TEST_REDIS_URL=redis://localhost:6380/15 npm test`) | 395 | 395 | 0 | 0 |
| `npm run lint`, `npm run typecheck`, `npm run build` | 3 | 3 | 0 | 0 |
| Postman (newman 6.2.2, Local, cache on) — 67 requests (newman: 68 with the token request) — assertions | 477 | 477 | 0 | 0 |
| Playwright — DSS + common (`AUTH_ENABLED=true CACHE_ENABLED=true`, 4 workers) | 113 | 109 | 0 | 4 |
| Playwright — same with real dealers (`SAMPLE_DATA=false`, `qa/test-data/dealers.json`) | 113 | 104 | 0 | 9 |
| Playwright — DSS_TC_74_SEC on 3461 (`RATE_LIMIT=20`), 4 runs | 4 | 4 | 0 | 0 |
| Playwright — DSS_TC_75_SEC on 3462 (`CLIENT_RATE_LIMIT=5`) | 1 | 1 | 0 | 0 |
| Playwright — COMMON_TC_19_SEC on 3460 (`TOKEN_RATE_LIMIT=30`) | 1 | 1 | 0 | 0 |
| k6 smoke (30 s, 1 user), DEMO pool and real pool | 2 runs | 2 | 0 | — |
| k6 load, stress, spike — DEMO pool and real pool (1,000 dealers) | 6 runs | 6 | 0 | — (0.00% errors, all thresholds passed) |
| Security: Semgrep, npm audit, gitleaks, hygiene, OWASP ZAP | 5 scans | 5 | 0 | — (ZAP: FAIL-NEW 0, WARN-NEW 2) |

Playwright skips (main run): COMMON_TC_4_SEC (needs an HTTPS URL), DSS_TC_74_SEC, DSS_TC_75_SEC and
COMMON_TC_19_SEC (each needs a server with a low limit; run separately, see the rows above). With
`SAMPLE_DATA=false`, DSS_TC_16–20 (DEMO values) are also skipped. DSS_TC_4 (child dealer) ran with a real child
dealer from `dealers.json`.

Notes on the runs:

- The Playwright suite has 2 new cases: COMMON_TC_25 (QA-3) and COMMON_TC_26_SEC (QA-1). DSS_TC_7, DSS_TC_63_SEC
  (QA-2) and DSS_TC_65_SEC (QA-1) now check the fixed behaviour.
- Each Playwright run makes about 28 token requests, each newman run 13, each k6 run 1. The token limit is 30 a
  minute for each IP. The runs were made at least one minute apart.
- The server log of 3460 has no 5xx line and no stack trace (632,799 lines, about 631,000 requests).

## QA findings (17-10-2026)

| # | Sev | Finding | Status | Test |
|---|---|---|---|---|
| QA-1 | Low | `TRACE` on any path (also `/api/v1/dealer-scheme-status`) gave **500** `text/plain` "Internal Server Error" and a stack trace in the server log (`TypeError: 'TRACE' HTTP method is unsupported`). Next.js makes a Fetch `Request` for the route handler and for the proxy, and the Fetch standard forbids `TRACE`. So route handlers, `src/proxy.ts` and `next.config.ts` cannot answer it (checked on Next.js 16.4.2). Methods such as `PROPFIND` gave 400 with an empty body on `/api` paths. | **Fixed.** New method guard `src/server/method-guard.ts`, installed by `src/instrumentation.ts`: it wraps `http.Server.prototype.emit("request")` and answers before Next.js. `TRACE` (every path) and methods other than GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS (on `/api` paths) get **405** `METHOD_NOT_ALLOWED` in the API envelope with the route's `Allow` (404 `NOT_FOUND` on an `/api` path with no route), the API security headers, `X-Request-Id` and one `api_request` log line. Evidence on 3460: `TRACE /api/v1/dealer-scheme-status` → 405 `{"error":{"code":"METHOD_NOT_ALLOWED","message":"Method not allowed. Use POST."}}`, `Allow: POST`; no stack trace in the log. `TRACK` and `CONNECT` never reach the app (Node.js: 400 and connection closed). The reverse proxy should still refuse `TRACE` (defence in depth, contract section 2). | Vitest `src/server/method-guard.test.ts` (7 cases, real HTTP server); Playwright DSS_TC_65_SEC, COMMON_TC_26_SEC |
| QA-2 | Low | `400 UNKNOWN_SCHEME_TAG` repeated the requested tag in `message`, also text like `<script>alert(1)</script>` or `' OR 1=1--`. | **Fixed.** The message names the tag only when it matches `^[A-Za-z0-9_-]{1,32}$`. Otherwise it is `A scheme tag does not exist.` (`unknownTagMessage` in `src/server/api/dealer-status.ts`). Contract section 7 and `docs/openapi.json` updated. | Vitest `dealer-status.test.ts` (new case: 7 unsafe tags, 2 safe tags); Playwright DSS_TC_7 (`QA 9.x` → generic message), DSS_TC_63_SEC (3 payloads: generic message, payload not in the body) |
| QA-3 | Low | `/api` and `/api/` gave the Next.js **HTML** 404 page with the page headers. | **Fixed.** The catch-all is now optional (`src/app/api/[[...slug]]/route.ts`), so it also matches `/api`. The proxy matcher excludes `/api` itself (`api(?:/|$)`), so `/api` gets the API headers, not the page headers. `/api/` gets the Next.js 308 to `/api`, then the JSON 404. Evidence: `GET /api` → 404 `{"error":{"code":"NOT_FOUND","message":"Not found."}}` with `Referrer-Policy: no-referrer`, CSP `default-src 'none'`, `X-Request-Id`. ZAP 100001 no longer lists `/api` or `/api/`. | Playwright COMMON_TC_25; Vitest `src/lib/auth/proxy.test.ts` (matcher); ZAP |
| QA-4 | Low | Right after `next start`, the first Redis use failed with `Redis is not ready (connecting)` (lazy connect). The limiters then counted in memory for 30 s. | **Fixed.** (a) A connection in progress (`wait`, `connecting`, `connect`) is not a failure: every caller waits for the same "ready" (at most 500 ms for the rate limits, 1 s for the cache). `reconnecting` still fails at once (`src/server/redis.ts`). (b) `src/instrumentation.ts` opens the Redis connections at startup (`warmUpRedisAtStartup`, log line `[startup] Redis connected (rate, cache).`). Evidence: new server 3461 (`RATE_LIMIT_PER_SECOND=20`), 4 DSS_TC_74_SEC bursts: **0** `redis_unavailable` lines (before: 19 lines for one burst). | Vitest `ratelimit.redis.test.ts`: 60 parallel requests on a new connection → 60 Redis counts (1–60), no warning; `warmUpRedis` case |
| QA-5 | Low | Too many `redis_unavailable` log lines: each request in flight wrote a line before the 30 s back-off took effect (131 lines in about 30 s at 1,700 requests/s; 19 lines for one burst after a start). | **Fixed.** `RedisBackoff.fail()` writes the line only on the change from up to down. Failures of requests that were already in flight do not write a line and do not extend the back-off. So each Redis user writes at most one line every 30 s. Evidence: (a) new server with an unreachable Redis (port 6399), 2 tokens and 120 parallel requests: **4** lines, one for each user (`rate-limit`, `rate-limit:token`, `rate-limit:client`, `response-cache`); (b) server 3460 during all suites and the k6 stress and spike runs (about 631,000 requests): **14** lines in total (7 `rate-limit`, 7 `rate-limit:client`, all `Command timed out` under CPU saturation). | Vitest `ratelimit.test.ts`: 60 in-flight failures → 1 line; no line while down; the next line only after 30 s |
| QA-6 | Info | Semgrep rule `javascript.express.security.x-frame-options-misconfiguration` on `src/proxy.ts` (`h.set("X-Frame-Options", "DENY")`). The value is a constant, not user input. | **False positive**, annotated with `nosemgrep` and a reason (comment only). | Semgrep |
| QA-7 | Info | ZAP alert 10050 "Retrieved from Cache" on `POST /api/v1/dealer-scheme-status`: ZAP reads the app header `X-Cache: HIT` as a shared HTTP cache. The response has `Cache-Control: no-store`. | **False positive** (informational). Not raised in the ZAP run of this report. | ZAP |

## Performance (k6)

All runs on server 3460, cache on, 5% requests for an unknown dealer (404). DEMO pool: the 12 DEMO dealers. Real
pool: 1,000 real dealers (`DEALERS_FILE=true`, git-ignored `qa/test-data/dealers.json`). Each run started at least
one minute after the one before. Stress ran the full profile (5 min); it was not shortened.

### Smoke, load, stress and spike (17-10-2026)

| Test | Pool | Requests (rate) | Errors | Checks | Max VUs | p50 / p95 / p99 (ms) | Cache hits | Result |
|---|---|---|---|---|---|---|---|---|
| Smoke (30 s) | DEMO | 63 (2.1/s) | 0.00% | 100% | 1 | 10.1 / 22.5 / 27.5 | 86.9% | Pass |
| Smoke (30 s) | Real | 61 (2.0/s) | 0.00% | 100% | 1 | 8.9 / 11.9 / 16.7 | 100% | Pass |
| Load (150 VUs, 3 min hold) | DEMO | 60,282 (267.7/s) | 0.00% | 100% | 150 | 2.8 / 5.6 / 12.2 | 100% | Pass |
| Load (150 VUs, 3 min hold) | Real | 60,344 (268.1/s) | 0.00% | 100% | 150 | 2.9 / 6.4 / 14.0 | 98.3% | Pass |
| Stress (to 600 VUs, 5 min) | DEMO | 186,442 (620.5/s) | 0.00% | 100% | 600 | 2.3 / 21.8 / 98.5 | 99.99% | Pass |
| Stress (to 600 VUs, 5 min) | Real | 183,594 (611.1/s) | 0.00% | 100% | 600 | 2.8 / 77.4 / 244.5 | 99.4% | Pass |
| Spike (20 → 500 VUs) | DEMO | 68,550 (471.2/s) | 0.00% | 100% | 500 | 4.2 / 185.2 / 417.9 | 100% | Pass |
| Spike (20 → 500 VUs) | Real | 71,906 (495.2/s) | 0.00% | 100% | 500 | 3.0 / 25.7 / 125.6 | 100% | Pass |

For load, stress and spike, the p95 and p99 of the dealer status requests are the same as the overall values in the
table (±0.1 ms). Smoke also calls the health probe: dealer status p95 / p99 is 22.1 / 25.6 ms (DEMO) and
11.8 / 14.2 ms (real).
Thresholds: errors < 1%, checks > 99%, dealer status p95 < 500 ms and p99 < 1,000 ms.

Observations:

- At the expected load (150 VUs) the p99 stays under 15 ms with zero errors, also with 1,000 real dealers.
- From about 300 VUs the laptop CPU saturates (k6, the app, PostgreSQL and Redis share 8 cores). The latency
  increases, but it stays inside the thresholds with zero errors up to 600 VUs.
- The spike test recovered to the base latency after the burst with no errors. The two spike runs have a different
  p95 (185 ms and 26 ms). On one shared laptop the burst latency changes from run to run.
- Under stress and spike, some Redis commands passed their 100 ms time-out. The limiters then counted in memory for
  30 s. The log has one `redis_unavailable` line for each such event and user (QA-5 fixed).

### Fixed rate, cache on and off (`rate.js`, 30 s each, real pool of 1,000 dealers, 5% unknown dealer)

Earlier run of 17-10-2026, before the fixes of QA-1 to QA-5 (servers 3410 and 3413). Not run again for this report:
the fixes do not change the request path of a normal request.

| Server | Target | Achieved | Not sent | Errors | p50 | p95 | p99 | Cache hits | Thresholds |
|---|---|---|---|---|---|---|---|---|---|
| Cache on (3410) | 500/s | 499.6/s | 0 | 0.00% | 1.9 ms | 5.6 ms | 47.9 ms | 94.1% | Pass |
| Cache on (3410) | 1,000/s | 999.5/s | 0 | 0.00% | 1.6 ms | 5.0 ms | 41.7 ms | 100% | Pass |
| Cache on (3410) | 1,700/s | 1,672.6/s | 793 | 1.63% | 2.0 ms | 233 ms | 3,001 ms | 99.0% | **Fail** (errors, p95/p99, not sent) |
| Cache off (3413), first run after start | 500/s | 468.8/s | 892 | 0.84% | 868 ms | 2,329 ms | 2,679 ms | — | **Fail** (p95/p99, not sent) |
| Cache off (3413), warm | 200/s | 200.0/s | 0 | 0.00% | 3.7 ms | 5.7 ms | 12.1 ms | — | Pass |
| Cache off (3413), warm | 350/s | 349.9/s | 0 | 0.00% | 3.4 ms | 4.7 ms | 8.9 ms | — | Pass |
| Cache off (3413), warm | 500/s | 499.9/s | 0 | 0.00% | 3.5 ms | 5.5 ms | 12.1 ms | — | Pass |
| Cache off (3413), warm | 1,000/s | 559.2/s | 12,353 | 0.07% | 3,364 ms | 3,629 ms | 3,664 ms | — | **Fail** (p95/p99, not sent) |

Observations:

- One `next start` process serves about 500–560 database reads a second on this laptop. With the cache on, it serves
  1,000 a second with p95 5 ms. At 1,700 a second (the reference target of 1 lakh a minute) it saturates: 1.63% of
  the requests failed (connection errors or time-outs on the k6 side; no 5xx and no 429 in the server log).
- Do a warm-up (a smoke run) before a rate run: the first cache-off run after a start failed at 500/s, the same rate
  passed when the server was warm.
- To reach 1,700 a second, run more than one process (or more instances) behind the load balancer, and keep the
  cache on. Then the per-IP and per-client limits need Redis (they count in memory for each process otherwise).

## Security

| Scan | Tool and version | Result |
|---|---|---|
| sast | Semgrep `semgrep/semgrep:1.177.0` (Docker), `p/typescript`, `p/nodejs`, `p/secrets`; `src/`, `scripts/`, `qa/`, `next.config.ts` (139 files) | **0 findings.** 1 file only partly parsed (`src/lib/auth/clients.timing.test.ts`, a test file). Semgrep writes a `safe.directory` git warning in a git worktree; no effect on the result. |
| deps | `npm audit` | Production dependencies: **0 vulnerabilities**. All dependencies (with dev): 5 high, all one chain `braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next` → `eslint-config-next` (dev only, lint tool; the offered fix is a breaking downgrade to eslint-config-next 14). `qa/api-tests`: 0 vulnerabilities. |
| secrets | gitleaks `zricethezav/gitleaks:v8.30.1` (Docker) on the files that git would commit (about 1.2 MB) | No leaks. The allowlist (`qa/security/gitleaks.toml`) has only the published local example values. |
| hygiene | git | 177 files checked: no YAML, Docker, `CLAUDE.md`, `AGENTS.md`, `context/`, `.env` or QA output files, and no dealer-code-like values (`6`/`7` + 9 digits, `7` + 7 digits). A second run with `REAL_CODES_FILE` (the 1,003 real codes of `dealers.json`, list kept outside the repository) found none of them (Q11). |
| zap | OWASP ZAP `ghcr.io/zaproxy/zaproxy:stable` (local image of 09-10-2026), API scan with the Bearer token, target `/api/v1/openapi.json`, 26 URLs | **FAIL-NEW 0**, WARN-NEW 2, PASS 118. WARN 100001 "Unexpected Content-Type" ×5: only non-API paths (`/` and probe paths such as `/metadata/v1`) give HTML pages; `/api` and `/api/` are no longer listed (QA-3 fixed). WARN 10105 "Weak Authentication Method": the token endpoint takes HTTP Basic over plain HTTP on the local run (the reference had the same warning; deployed servers use HTTPS). Informational: 10049 non-storable content (expected, `no-store`), 100000 client error codes (the expected 4xx answers). |

## Test suite added in this session

| Item | Files |
|---|---|
| Guide and results | `qa/README.md`, `qa/TEST_RESULTS.md`, `docs/API_GUIDE.md` |
| Postman | `qa/postman/build-collection.ts` (`npm run qa:postman`), collection, `Local` and `Dev` environments, guard `collection.test.ts` |
| Swagger | `qa/swagger/build-specs.ts` (`npm run qa:swagger`), `Scheme_Calculator_Dealer_Status.openapi.json`, guard `specs.test.ts` |
| Playwright | `qa/api-tests/` (`@playwright/test` 1.63.0, published 04-09-2026), `helpers.js`, `dealer_scheme_status.spec.js` (87 cases), `common.spec.js` (26 cases) |
| k6 | `qa/k6/config.js`, `traffic.js`, `smoke.js`, `load.js`, `stress.js`, `spike.js`, `rate.js` |
| Security | `qa/security/run_scans.sh` (`sast`, `deps`, `secrets`, `hygiene`, `zap`), `gitleaks.toml` |
| Test data | `qa/test-data/pick-dealers.ts` (`npm run qa:pick-dealers`); output `dealers.json` is git-ignored |
| Config | `.gitignore` (QA outputs), `vitest.config.ts` (`qa/**/*.test.ts`), `eslint.config.mjs` and `tsconfig.json` (exclude `qa/api-tests`, `qa/k6`), npm scripts `qa:*` |
| Tests for the QA fixes | `src/server/method-guard.test.ts` (new), new cases in `src/server/ratelimit.test.ts`, `src/server/ratelimit.redis.test.ts`, `src/server/api/dealer-status.test.ts`, `src/lib/auth/proxy.test.ts`; Playwright COMMON_TC_25, COMMON_TC_26_SEC, changed DSS_TC_7, DSS_TC_63_SEC, DSS_TC_65_SEC |

## Open items

| # | Item | Owner |
|---|---|---|
| 1 | QA-1 to QA-5 are fixed (see above). The reverse proxy (nginx or load balancer) should also refuse `TRACE`. | DevOps |
| 2 | Dev URL **decided** (Mayur, 18-10-2026, Q8): `https://dev.scheme-calculator.example.com` (Swagger UI at `/api/docs`). It is set in the Postman Dev environment, `npm run test:dev` (`qa/api-tests`) and the Swagger servers. After the deploy, run `npm run test:dev`, newman Dev and k6 smoke on Dev with a QA client and `dealers.json`. COMMON_TC_4_SEC (HTTPS redirect) runs only there. UAT and production hosts: same pattern, to be confirmed. | QA after deploy |
| 3 | Plan open questions. **Decided** (Mayur, 17-10-2026, CLAUDE.md decisions 12 and 13): Q1 response keys stay snake_case; Q2 scope `schemes:read`, issuer and audience `scheme-calculator` (the code uses these values); Q3 error envelope `{error:{code,message}}` stays (the token endpoint keeps RFC 6749); Q4 contract changes accepted (413, 403 `INSUFFICIENT_SCOPE`, 503 `SERVICE_BUSY`, JSON 404 `NOT_FOUND`), `OPTIONS` stays as it is; Q10 the health probe stays a readiness probe; Q11 real dealer codes are replaced in tracked files only, no history rewrite (hygiene scan: none in the files that git would commit). **Decided** (Mayur, 18-10-2026, CLAUDE.md decision 14): Q5 per-client limit 1,00,000 a minute (`API_RATE_LIMIT_PER_MINUTE` default 100000); Q7 Redis in production comes from the client's DevOps team (`REDIS_URL` accepts `redis://` and `rediss://` with a password; "TLS or not" stays open for DevOps, see item 7); Q8 Dev `https://dev.scheme-calculator.example.com`, UAT and production the same pattern, hosts to be confirmed; Q9 Swagger UI on in Dev and UAT (`DOCS_ENABLED=true`), off in production unless asked. **Still open:** Q6 `TRUSTED_PROXY_HOPS` (waiting for DevOps; the other Acme API has nginx in front on Dev, so the likely value is 1; with 1 or more, the app port must accept connections only from the proxy). | Mayur / DevOps |
| 4 | Capacity: run k6 `load.js`, `stress.js`, `spike.js` and `rate.js` on the deployed set-up (several processes or instances, Redis), with k6 on another machine. | QA / DevOps |
| 5 | Pin the ZAP image to an exact version (the reference uses the floating `stable` tag; this suite keeps the same image as asked, override with `ZAP_IMAGE`). | Team decision |
| 6 | The full `npm audit` reports the dev-only `braces` chain in `eslint-config-next`. Follow the next eslint-config-next release. | Developer |
| 7 | Redis TLS (Q7): `rediss://` or `redis://`, the host, the port and the password for each environment. Recommendation: `rediss://` and a password when Redis is not on a private network. Outside `APP_ENV=local`, the server writes a startup warning for a URL with no TLS or no password. | DevOps |
