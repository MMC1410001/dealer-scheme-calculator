# Dealer scheme status API — QA suite

This folder holds the functional, security and performance tests of the dealer scheme status API (phase 2).
The layout and the rules are the same as in the QA suite of the Other Scheme API (`example-org/other-scheme-api`).
Latest results: [TEST_RESULTS.md](TEST_RESULTS.md). API guide: [../docs/API_GUIDE.md](../docs/API_GUIDE.md).
Contract: [../docs/api-contract.md](../docs/api-contract.md).

The API has one data endpoint: `POST /api/v1/dealer-scheme-status` (body `{dealer_code, scheme_tags}`).
Callers use OAuth2 client credentials: `POST /api/v1/auth/token` with a `client_id` and a `client_secret` gives a
Bearer token (1 hour). Send it as `Authorization: Bearer <token>`. On a local machine the client is
`local-client` / `local-test-secret` (from `.env.example`). Each suite gets **one** token and uses it again. The
token endpoint allows only `TOKEN_RATE_LIMIT_PER_MINUTE` (default 30) requests for each IP in one minute.

| | `POST /api/v1/dealer-scheme-status` |
|---|---|
| Postman | `postman/Scheme_Calculator_Dealer_Status.postman_collection.json` |
| Swagger | `swagger/Scheme_Calculator_Dealer_Status.openapi.json` |
| Playwright | `api-tests/tests/dealer_scheme_status.spec.js` (`DSS_TC_n`) |
| k6 | `k6 run <script>.js` |

The suite also has the Postman environments (`Local`, `Dev`), `api-tests/tests/common.spec.js` (health, unknown
route, HTTPS, API docs, token endpoint; `COMMON_TC_n`), `api-tests/tests/helpers.js`, and the security scans.

The DEMO dealers (`DEMO0001`–`DEMO0014`, `DEMO-C1`) are synthetic test data from `npm run data:demo`. They are not
client data. Real dealer codes are client data: never put them in a tracked file (see Step 7).

## QA guide (step by step)

Steps 1–3 are manual tests in Postman. Steps 4–6 are the automated suites. Step 7 is about tests on Dev.
Step 8 is about reports.

### Step 0 — Install the tools (one time)

| Tool | Used for | Install on a Mac |
|---|---|---|
| Node.js 22, Docker Desktop, Git | The app, the database, Redis, the scans | See the [main README](../README.md) |
| Postman (desktop app) | Manual tests | Download from postman.com |
| k6 | Performance tests | `brew install k6` (local path `/opt/homebrew/bin/k6`) |

Playwright runs API tests only. It does not need a browser download.

### Step 1 — Start the API locally

1. Start the containers: `docker start scheme-calc-pg scheme-calc-redis` (PostgreSQL on port 5433, Redis on port 6380).
2. Load the data: `npm run db:migrate && npm run db:seed && npm run data:demo`.
3. Build the app: `npm run build`.
4. Start the app:

   ```bash
   APP_ENV=local DOCS_ENABLED=true CACHE_ENABLED=true REDIS_URL=redis://localhost:6380 PORT=3400 npm run start
   ```

   The per-client limit is 1,00,000 requests a minute by default (`API_RATE_LIMIT_PER_MINUTE=100000`, decision Q5).
   All suites use one `client_id`. Playwright, newman, ZAP and the k6 smoke, load, stress and spike runs stay far
   below this limit, so the QA server needs no override. Only `rate.js` at its default rate (1,700 a second =
   1,02,000 a minute) is above it. For that run, see Step 5. If your `.env` still has `API_RATE_LIMIT_PER_MINUTE=600`
   (the old example value), change it to `100000` or remove the line. DSS_TC_75_SEC tests the per-client limit on a
   separate server with a low limit (see "Rate-limit runs" below).
5. Check that it is up: `curl http://localhost:3400/api/v1/health` returns `{"status":"ok","data_as_of":"…"}`.

### Step 2 — Test manually in Postman

1. Open Postman. Click **Import**. Select the three files in `qa/postman/`: the collection
   `Scheme_Calculator_Dealer_Status…` and the two environments (`Local…`, `Dev…`). You get the collection
   **Scheme Calculator - Dealer scheme status API**, with the folders 1. Health, 2. Dealer scheme status,
   3. Negative cases, 4. Security, 5. Auth and 6. Reward choice.
2. In the environment list (top right), select **Scheme Calculator - Local**. It has `baseUrl = http://localhost:3400`,
   `clientId = local-client`, `clientSecret = local-test-secret`, `authEnabled = true`, `dealerCode = DEMO0001`,
   `childDealerCode = DEMO-C1`, `sampleData = true`, `cacheEnabled = false` and `writeEnabled = true`. Set
   `cacheEnabled = true` when the server has the cache on. Folder **6. Reward choice** writes choices of DEMO dealers.
   It runs only with `writeEnabled = true` (the client is in `AUTH_WRITE_CLIENTS`) and `sampleData = true`.
3. Open the collection → **2. Dealer scheme status** → a request → **Send**. The collection gets the token for you:
   its pre-request script gets one from `/api/v1/auth/token`, keeps it in the collection variable `accessToken`
   (and `accessTokenExpiresAt`), and uses it until one minute before it expires. To get a new token, clear
   `accessToken` in the **Variables** tab of the collection.
4. The checks of each request are in **Scripts → Post-response**.
   Four requests have saved example responses (under the request, **Examples**): the real DEMO0001 200 response
   (FB-PAN and FB-TNHPJK), 404 `DEALER_NOT_FOUND`, 400 `UNKNOWN_SCHEME_TAG` and the token 200 response. The 200 bodies come
   from `docs/openapi.json`.
5. To run all requests: click the collection → **Run**. Expect 71 requests and 498 passed checks (Local, auth on,
   cache on). newman counts 72 requests, because it also counts the token request of the pre-request script. One run makes 13 token requests. Wait one minute between full runs (token rate limit).

Test data:

| Dealer | The API shows |
|---|---|
| `DEMO0001` | FB-PAN Slab 1 of 7 (the circular example: Q1 4.5 lakh, Oct + Nov 3.6 lakh, growth 20%); FB-TNHPJK `REGION_NOT_IN_SCOPE`; SP-Q3 `NO_DATA` |
| `DEMO0002`, `DEMO0003` | FB-PAN no slab, `SLAB1_GROWTH_NOT_MET`. DEMO0003 meets all Slab 3 conditions, but the rule stops at Slab 1 |
| `DEMO0004` | FB-PAN Slab 7, with a material return (`mrv_total` −20,000) |
| `DEMO0005` | FB-TNHPJK Slab 2 (no growth condition); FB-PAN `REGION_NOT_IN_SCOPE` |
| `DEMO0006` | Not in the dealer master: `REGION_UNKNOWN`, `dealer_name` null |
| `DEMO0007`, `DEMO0008` | Star Points Slab 3 (138,000 points) and Slab 7 with 2 extra-benefit options (480,000 points) |
| `DEMO0009` | Enrolled in Star Points: FB-PAN and FB-TNHPJK `ENROLLED_IN_OTHER_SCHEME` |
| `DEMO0011` | FB-PAN Slab 1, but OD on the check date: `benefit_blocked: true`, `OD_ON_CHECK_DATE` |
| `DEMO0012` | FB-PAN: no Q1 sales of any product. Slab 1 GSR met, growth not met: no slab, `SLAB1_GROWTH_NOT_MET` (BA, 19-10-2026) |
| `DEMO0013` | FB-PAN: no Q1 sales of scheme products, but Q1 sales of other products (`total_gsr`): growth met on the zero base, Slab 1 |
| `DEMO0014` | SP-Q3: Table III GSR flat, total GSR +16.66%: Slab 1 only because the growth uses the total GSR (BA, 19-10-2026) |
| `DEMO-C1` | Child of `DEMO0010`: the answer is the parent's (`dealer_code: "DEMO0010"`, FB-PAN Slab 2) |
| `DEMO9999` | Does not exist: 404 `DEALER_NOT_FOUND` |

### Step 3 — Exploratory checks to do by hand

- Spaces around the dealer code or a tag are removed. `" DEMO0001 "` gives the same result as `"DEMO0001"`.
- A dealer code with characters that are not allowed (`DEMO 0001`, `DEMO.0001`, 33 characters) gives 400
  `INVALID_REQUEST`. The message never repeats the input.
- A tag that is not active (`ABC9`, `fb-pan`) gives 400 `UNKNOWN_SCHEME_TAG`. The message names the tag only when the
  tag has only letters, digits, `_` and `-` (1 to 32 characters). For other text (`<b>x</b>`, `ABC 9`), the message is
  `A scheme tag does not exist.` (QA-2, fixed).
- The `schemes` array has the order of `scheme_tags`. Send `["SP-Q3","FB-PAN"]` and `["FB-PAN","SP-Q3"]` and compare.
- No token, a made-up token, or a token with one changed character gives 401 with a `WWW-Authenticate: Bearer …`
  header. `X-API-Key` alone gives 401.
- A token request with a wrong secret gives `401 {"error": "invalid_client", …}`. The body never contains the secret.
  After 30 token requests in one minute you get 429 with `Retry-After`.
- A body larger than 8 KB gives 413 `PAYLOAD_TOO_LARGE`, also when it is sent in chunks.
- Start-up safety (stop the server first; use a shell where `.env` has no `AUTH_CLIENTS` and `JWT_SECRET`, or
  move `.env` aside):
  - `APP_ENV= npm run start` must refuse to start with `APP_ENV is not set and there are no auth settings`.
  - `APP_ENV=prod` with the `.env.example` client and key must refuse to start (`Auth settings invalid for APP_ENV=prod`).
  - `APP_ENV=local` with no auth settings starts and writes a warning (auth is off).
- With the cache on (`CACHE_ENABLED=true`, Redis running): the first request for a dealer and tags gives
  `X-Cache: MISS`. A repeat gives `X-Cache: HIT` with the same body. Stop Redis (`docker stop scheme-calc-redis`):
  requests still work (`X-Cache: BYPASS`). Start Redis again after the test.
- `npm run engine:run` makes the old cached answers unused (`X-Cache: MISS` again within 5 s).

### Step 4 — Run the automated API tests (Playwright)

```bash
cd qa/api-tests
npm install                                                    # first time only
AUTH_ENABLED=true CACHE_ENABLED=true npx playwright test       # 115 cases (DSS + common)
npm run report                                                 # opens the HTML report
```

On localhost the suite uses `local-client` / `local-test-secret` when `CLIENT_ID` / `CLIENT_SECRET` are not set.
Each worker gets one token. The default is 4 workers (`PW_WORKERS`). Expected: 111 passed, 4 skipped. The skipped
cases are COMMON_TC_4_SEC (needs an HTTPS URL), DSS_TC_74_SEC (`RATE_LIMIT`), DSS_TC_75_SEC (`CLIENT_RATE_LIMIT`)
and COMMON_TC_19_SEC (`TOKEN_RATE_LIMIT`). A run makes about 28 token requests (one for each worker and 24 in the
token-endpoint cases). Wait one minute before you run it (or newman) again, or the token requests get 429.

Run one file with `npm run test:dss` (or `test:common`). Run one category with `npm run test:security` (or
`:functional`, `:validation`, `:edge`, `:negative`, `:auth`). Run one case with `npx playwright test -g "DSS_TC_12"`.
Put `API_BASE_URL=… AUTH_ENABLED=true` in front of `npm run` too. The case index is at the end of this file.

**Rate-limit runs.** These cases need a server with a low limit. Run each one alone. Use a separate Redis database,
so that the counts do not mix with the main QA server. `npx next start` must run in the repository root (it needs
the `.next` build). `npx playwright test` must run in `qa/api-tests`. The commands below start each server in the
root from `qa/api-tests` (the directory of Step 4), in a subshell:

```bash
# Run these lines in qa/api-tests. Start each server in its own terminal (or add "&").
# Per-IP limit (DSS_TC_74_SEC):
(cd ../.. && APP_ENV=local REDIS_URL=redis://localhost:6380/1 RATE_LIMIT_PER_SECOND=20 npx next start -p 3411)
API_BASE_URL=http://localhost:3411 AUTH_ENABLED=true RATE_LIMIT=20 npx playwright test -g DSS_TC_74
# Per-client limit (DSS_TC_75_SEC):
(cd ../.. && APP_ENV=local REDIS_URL=redis://localhost:6380/2 API_RATE_LIMIT_PER_MINUTE=5 npx next start -p 3412)
API_BASE_URL=http://localhost:3412 AUTH_ENABLED=true CLIENT_RATE_LIMIT=5 npx playwright test -g DSS_TC_75
# Token limit (COMMON_TC_19_SEC): on the QA server of Step 1 (default per-IP limit). Then wait one minute.
API_BASE_URL=http://localhost:3400 AUTH_ENABLED=true TOKEN_RATE_LIMIT=30 npx playwright test -g COMMON_TC_19
```

Do not run COMMON_TC_19_SEC on the server with `RATE_LIMIT_PER_SECOND=20`. Its 35 token requests use up the
per-IP limit of that second, and its last data request then gets 429. Stop each server after the run
(`lsof -ti :3411 | xargs kill`).

### Step 4b — Run the browser tests (admin area and iframe)

`ui/ui_smoke.spec.js` (UI_TC_1–22) opens the admin area and the iframe page in Google Chrome (the installed browser,
`channel: "chrome"`; no browser download). The admin cases need the admin login of the server. The iframe cases sign a
dealer token with the server's iframe secret. Never put a real environment's password or secret in a file.

```bash
cd qa/api-tests
# Local (QA server of Step 1, DEMO data). Take the values from your .env.
UI_BASE_URL=http://localhost:3400 ADMIN_USERNAME=<user> ADMIN_PASSWORD=<password> EMBED_SIGNING_SECRET=<secret> npm run test:ui
# Dev (real dealers: dealers.main from qa/test-data/dealers.json)
ADMIN_USERNAME=<user> ADMIN_PASSWORD=<password> EMBED_SIGNING_SECRET=<secret> npm run test:ui:dev
```

Expected: Local 21 passed, 1 skipped (UI_TC_14: a plain `dealer_code` can be allowed on localhost). Dev 22 passed.

To run the suite in Firefox and WebKit (Safari) too, set `UI_BROWSERS=chrome,firefox,webkit`. Firefox and WebKit need
`npx playwright install firefox webkit`, or `PW_FIREFOX_PATH` / `PW_WEBKIT_PATH` set to an installed build. Expected:
63 passed, 3 skipped (UI_TC_14 in each browser). WebKit does not send a `Secure` cookie over plain `http://localhost`;
`login()` in the spec keeps the session in WebKit on a local http server only. Dev, UAT and prod use HTTPS.
The suite uses one worker: 5 wrong admin logins from one IP stop the login for 15 minutes, and UI_TC_2 makes one.

### Step 5 — Run the performance tests (k6)

Always run the smoke test first. Continue only when it passes.

```bash
cd qa/k6
BASE_URL=http://localhost:3400 k6 run smoke.js     # 30 s, 1 user
BASE_URL=http://localhost:3400 k6 run load.js      # about 4 min, 150 users
BASE_URL=http://localhost:3400 RATE=1650 k6 run rate.js   # 2 min at 1,650 requests a second (just below 1 lakh a minute)
```

The `setup()` of each script gets one token (on localhost with `local-client` / `local-test-secret`; on other
servers set `CLIENT_ID` and `CLIENT_SECRET`). Each virtual user sends it as `Authorization: Bearer`. Keep runs
shorter than one hour (the token lifetime).

The default dealer pool is the 12 DEMO dealers, so nearly all answers come from the cache. For a test of the
database path, build the git-ignored pool of real dealers (Step 7) and add `DEALERS_FILE=true`.

`rate.js` sends a fixed number of requests each second. Run it with the cache off and on to compare. Set `RATE` and
`DURATION` to change it. The server must allow the rate: `API_RATE_LIMIT_PER_MINUTE` must be higher than
`RATE` × 60. The default limit is 1,00,000 a minute (about 1,666 a second). The default `RATE` of 1,700 (the peak of
the reference API) is 1,02,000 a minute: with the default limit, the last requests of each minute get 429. So use
`RATE=1650` to test at the real limit, or start the server for this run with a higher limit, for example
`API_RATE_LIMIT_PER_MINUTE=200000`.

The last lines of each run say `all thresholds passed` or list what failed. Pass criteria: errors < 1%, checks
> 99%, p95 < 500 ms and p99 < 1 s. `stress.js` and `spike.js` find the limits. Run them when the team asks. The
results go to `qa/k6/reports/` (git-ignored).

### Step 6 — Run the security scans

```bash
qa/security/run_scans.sh sast deps secrets hygiene     # code, dependencies, secrets, repository rules (no server)
BASE_URL=http://localhost:3400 CLIENT_ID=local-client CLIENT_SECRET=local-test-secret \
  qa/security/run_scans.sh zap                         # OWASP ZAP (Docker); server with DOCS_ENABLED=true
```

The script gets one token with curl. The ZAP replacer adds `Authorization: Bearer <token>` to each request. Without
`CLIENT_ID` / `CLIENT_SECRET`, ZAP scans with no token (useful only when the server has auth off).

Run ZAP **last**. Its active scan sends some hundred attack requests to `/api/v1/auth/token`. The token limit (30 a
minute for each IP) answers them with 429, so for about one minute after the scan this IP gets no token. Wait one
minute before you run newman or Playwright again. If you do not wait, the Postman run fails with one check "Token
request succeeds" (429) and the requests get 401.

ZAP gets at most `ZAP_START_MINUTES` (default 3) minutes to start. At start, `zap-api-scan.py` downloads add-on
updates (`-addonupdate`, as in the reference). When that download hangs (seen on 18-10-2026), ZAP does not start
(exit code 3). The script then runs the scan again with `-silent`: no add-on update, only the rules of the image
(6 beta passive rules fewer: 10026, 10049, 10063, 10099, 10110, 90004). The script prints a line when it does this.

Pass = no Semgrep findings, no known vulnerabilities in the production dependencies, no gitleaks findings, no
hygiene problems, and ZAP `FAIL-NEW: 0`. The reports go to `qa/security/reports/` (git-ignored).

In a git worktree, Semgrep writes a warning about `safe.directory`. The warning has no effect on the scan.

### Step 7 — Test on Dev or production

**Test dealers.** Real environments do not have the DEMO dealers. Build the git-ignored file
`qa/test-data/dealers.json` from a database with results (read-only):

```bash
npm run qa:pick-dealers                  # DATABASE_URL from .env; add -- --pool 2000 for a larger k6 pool
```

The file has `dealers.main` (highest slab, in the most schemes), `dealers.no_slab`, `dealers.not_in_scope`,
`dealers.child` (`{code, parent}`) and a `pool` for k6. It holds client data: share it only through the team's
secret store.

Dev is at `https://dev.scheme-calculator.example.com` (decision Q8: the same example pattern as the other Acme API,
`https://dev.scheme-api.example.com`). Swagger UI is at `https://dev.scheme-calculator.example.com/api/docs`
(`DOCS_ENABLED=true` on Dev and UAT, decision Q9). The API paths are the same as on a local machine, for example
`/api/v1/dealer-scheme-status`. UAT and production follow the same pattern. Their hosts are to be confirmed: use
`API_BASE_URL` / `BASE_URL` / `baseUrl` for them.

Dev requires a Bearer token. Ask the developer for a QA client (`client_id`, `client_secret`) for each environment.
Never commit them or put them in tickets.

- **Postman:** select **Scheme Calculator - Dev** (`baseUrl` and `authEnabled = true` are already set). Set
  `clientId`, `clientSecret` and a real `dealerCode`. Keep `sampleData = false` (skips the DEMO checks) and
  `writeEnabled = false` (the reward choice requests write data, so they never run on Dev).
- **newman:** `npx --yes newman@6.2.2 run <collection> -e Dev.postman_environment.json --env-var clientId=<id> --env-var clientSecret=<secret> --env-var dealerCode=$(node -p "require('../test-data/dealers.json').dealers.main") --env-var childDealerCode=$(node -p "require('../test-data/dealers.json').dealers.child.code") --env-var parentDealerCode=$(node -p "require('../test-data/dealers.json').dealers.child.parent")`.
  Without `childDealerCode` the child case is skipped; without `parentDealerCode` it fails ("dealer_code is the parent").
- **Playwright (Dev):** `CLIENT_ID=<id> CLIENT_SECRET=<secret> npm run test:dev` (dealers from `dealers.json`;
  `test:dev` sets `API_BASE_URL=https://dev.scheme-calculator.example.com AUTH_ENABLED=true SAMPLE_DATA=false`).
  Other servers: `API_BASE_URL=https://<host> CLIENT_ID=<id> CLIENT_SECRET=<secret> AUTH_ENABLED=true SAMPLE_DATA=false npx playwright test`.
  DSS_TC_80–83_SEC forge tokens with the server's signing key. They are skipped unless `JWT_SECRET` is set. Do not
  set it to a real key outside a secure runner. COMMON_TC_4_SEC (HTTP to HTTPS) runs only on an HTTPS URL such as Dev.
- **k6:** `BASE_URL=https://dev.scheme-calculator.example.com CLIENT_ID=<id> CLIENT_SECRET=<secret> DEALERS_FILE=true k6 run smoke.js`
  (or `DEALER_CODES=<code1>,<code2>,…`). Agree the load level with the team before a load or stress test on a shared server.

### Step 8 — Report results and bugs

- Record each run in [TEST_RESULTS.md](TEST_RESULTS.md): date, environment, counts for each suite, k6 numbers,
  scan results.
- For a bug, give: the environment and base URL, the request (method, URL, body, headers without the token and the
  client secret), the response (status, body, `X-Request-Id`), the time, the dealer code (DEMO codes only in tickets),
  and the expected and actual result. In Postman, the **Code** button (`</>`) gives a curl command.

---

# Reference

## Folders

| Folder | Tool | What it covers |
|---|---|---|
| `postman/` | Postman / newman | Collection (71 requests, 498 checks with the cache on; newman shows 72 requests with the token request), Local and Dev environments, generator `build-collection.ts`, guard `collection.test.ts` |
| `swagger/` | Swagger Editor / Swagger UI | OpenAPI 3.0.3 file cut from `docs/openapi.json` (dealer status, token, health), with valid and `invalid_*` request examples; guard `specs.test.ts` |
| `api-tests/` | Playwright | API: 115 test cases, `dealer_scheme_status.spec.js` (89), `common.spec.js` (26). Browser: `ui/ui_smoke.spec.js` (20, `playwright.ui.config.js`) |
| `k6/` | k6 | Smoke, load, stress, spike and fixed-rate (`rate.js`) tests of the dealer status endpoint |
| `security/` | Semgrep, npm audit, gitleaks, git, OWASP ZAP | Static analysis, dependency CVEs, secrets, repository rules, active API scan |
| `test-data/` | `pick-dealers.ts` | Real dealer codes for Dev/UAT runs (`dealers.json`, git-ignored) |
| `../src/**/*.test.ts` | Vitest | Unit tests of the app (`npm test`); `qa/**/*.test.ts` are in the same run |

## Running the suites

### Unit tests

```bash
npm test                                                     # Vitest: app tests + qa/postman and qa/swagger guards
TEST_REDIS_URL=redis://localhost:6380/15 npx vitest run src/server/ratelimit.redis.test.ts   # with a real Redis
```

### Postman

```bash
cd qa/postman
npx --yes newman@6.2.2 run Scheme_Calculator_Dealer_Status.postman_collection.json -e Local.postman_environment.json \
  --env-var baseUrl=http://localhost:3400 --env-var cacheEnabled=true
```

`build-collection.ts` makes the collection and the environments. Change requests and tests there. Then run
`npm run qa:postman` and commit the JSON. `collection.test.ts` fails when the JSON is stale, when an operation of
`docs/openapi.json` has no request, when a request has no tests, or when the collection calls another path. Set
`authEnabled=false` when the server has auth off (no token is fetched, and the auth cases show SKIPPED). Set
`sampleData=false` when the server does not have the DEMO dealers.

### Swagger

1. Open https://editor.swagger.io → **File → Import file** → select the file in `qa/swagger/`. Postman
   (**Import**), Insomnia or a code generator can also read it.
2. Select a server (Local `http://localhost:3400` or Dev `https://dev.scheme-calculator.example.com`). Click **Authorize**. Enter
   `client_id` and `client_secret` (`local-client` / `local-test-secret` on a local machine). Swagger gets the token
   from `/api/v1/auth/token` itself.
3. Open the request → **Try it out** → select an example → **Execute**. Examples named `invalid_…` must return 400.
   The other examples return 200.

**Execute** from editor.swagger.io is a browser call to another site. The API refuses it, because it sends no CORS
headers (on purpose). To send requests, use `/api/docs` on the server (`DOCS_ENABLED=true`) or Postman.

`build-specs.ts` cuts the file from `docs/openapi.json`. After a change of the contract, run `npm run qa:swagger` and
commit the JSON. `specs.test.ts` fails when the file is stale, has another path, has a `$ref` that does not resolve,
has a request example that the API treats differently from its name, or has a 200 example that does not match the
`StatusResponse` schema.

### Playwright API tests

```bash
cd qa/api-tests
npm install
API_BASE_URL=http://localhost:3400 AUTH_ENABLED=true CACHE_ENABLED=true npx playwright test   # all
npx playwright test tests/dealer_scheme_status.spec.js                    # one file (or npm run test:dss)
npm run test:security                                                     # one category
npm run test:auth                                                         # only the token and Bearer cases
npx playwright test -g "DSS_TC_15"                                        # one case
CLIENT_ID=<id> CLIENT_SECRET=<secret> npm run test:dev                    # Dev server (https://dev.scheme-calculator.example.com)
npm run report                                                            # HTML report
```

| Variable | Default | Meaning |
|---|---|---|
| `API_BASE_URL` | `http://localhost:3400` | Server under test |
| `CLIENT_ID`, `CLIENT_SECRET` | `local-client` / `local-test-secret` on localhost, else empty | Exchanged one time for each worker at `/api/v1/auth/token`; sent as `Authorization: Bearer`. `CLIENT_ID=` sends no token |
| `AUTH_ENABLED` | `false` | `true` when the server needs a token: runs the auth cases (DSS_TC_49–53_SEC, DSS_TC_76–84, DSS_TC_87_SEC, COMMON_TC_5–20, 24) and makes a failed token request an error |
| `JWT_SECRET` | the `.env.example` key on localhost, else empty | The server's signing key, to forge expired / wrong-scope / wrong-claim tokens (DSS_TC_80–83_SEC; skipped without it) |
| `JWT_TTL_SECONDS` | `3600` | The server's token lifetime, checked as `expires_in` |
| `DEALER_CODE` | `DEMO0001`; with `SAMPLE_DATA=false` `dealers.main` of `qa/test-data/dealers.json` | A dealer with stored results |
| `CHILD_DEALER_CODE`, `PARENT_DEALER_CODE` | `DEMO-C1` / `DEMO0010`; with `SAMPLE_DATA=false` `dealers.child` | DSS_TC_4 (skipped without them) |
| `SCHEME_TAGS` | `FB-PAN,FB-TNHPJK,SP-Q3` | Active scheme tags |
| `SAMPLE_DATA` | `true` | `false` on real environments: skips the DEMO cases (DSS_TC_16–20) |
| `CACHE_ENABLED` | `false` | `true` when the server has the response cache on: runs DSS_TC_85–87 |
| `RATE_LIMIT` | — | The server's `RATE_LIMIT_PER_SECOND`; set it (with a low server value, e.g. 20) to run DSS_TC_74_SEC |
| `CLIENT_RATE_LIMIT` | — | The server's `API_RATE_LIMIT_PER_MINUTE`; set it (with a low server value, e.g. 5) to run DSS_TC_75_SEC alone |
| `TOKEN_RATE_LIMIT` | — | The server's `TOKEN_RATE_LIMIT_PER_MINUTE`; set it to run COMMON_TC_19_SEC alone |
| `PW_WORKERS` | `4` | Number of workers (each gets one token) |

### k6

```bash
cd qa/k6
k6 run smoke.js     # always first
k6 run load.js      # 150 VUs, 3 min hold
k6 run stress.js    # steps to 600 VUs
k6 run spike.js     # 20 -> 500 VUs burst
k6 run rate.js      # 1,700 requests/s for 2 min (above the default per-client limit: see Step 5)
```

| Script | Profile | Overrides |
|---|---|---|
| `smoke.js` | 1 VU, 30 s | `DURATION` |
| `load.js` | ramp 30 s → 150 VUs for 3 min → ramp down | `TARGET_VUS`, `HOLD` |
| `stress.js` | 25% → 50% → 100% of 600 VUs, 1 min each | `MAX_VUS` |
| `spike.js` | 20 VUs → 500 VUs in 10 s, hold 1 min, recover | `BASE_VUS`, `SPIKE_VUS` |
| `rate.js` | fixed 1,700 requests/s for 2 min, no think time (also fails if > 1% of requests cannot be sent). Needs `RATE=1650` or a server limit above 1,02,000 a minute (Step 5) | `RATE`, `DURATION`, `MAX_VUS` |

All scripts send `POST /api/v1/dealer-scheme-status` only (request tag `dealer-scheme-status`), with one Bearer token
from `setup()` (`authSetup()` in `config.js`). Settings: `BASE_URL` (default `http://localhost:3400`; Dev
`https://dev.scheme-calculator.example.com`); `CLIENT_ID` and `CLIENT_SECRET` (default
`local-client` / `local-test-secret` on localhost only; `AUTH_ENABLED=true` makes a refused token request stop the
run); `SCHEME_TAGS` (default `FB-PAN,FB-TNHPJK,SP-Q3`); the dealer pool: `DEALERS_FILE=true` (the `pool` of
`qa/test-data/dealers.json`), else `DEALER_CODES` (comma-separated), else the DEMO dealers; `UNKNOWN_RATE` (default
0.05, sends `DEMO9999`, which gives an expected 404). Think time 0.25–0.75 s (none in `rate.js`). Thresholds: error
rate < 1%, checks > 99%, p95 < 500 ms and p99 < 1 s. The summary also shows the share of `X-Cache: HIT`. JSON
summaries go to `k6/reports/<script>-summary.json`. For an HTML dashboard, add
`K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=reports/load.html`.

### Security scans

```bash
CLIENT_ID=local-client CLIENT_SECRET=local-test-secret BASE_URL=http://localhost:3400 qa/security/run_scans.sh   # all
qa/security/run_scans.sh sast deps                    # no server needed
```

| Scan | Tool | Pass when | Report |
|---|---|---|---|
| `sast` | Semgrep `semgrep/semgrep:1.177.0` (Docker), rule sets `p/typescript`, `p/nodejs`, `p/secrets` | no findings | `semgrep.txt`, `semgrep.json` |
| `deps` | `npm audit --omit=dev` (gate); `npm audit` and `qa/api-tests` (report only) | 0 vulnerabilities in production dependencies | `npm-audit-*.txt` |
| `secrets` | gitleaks `zricethezav/gitleaks:v8.30.1` (Docker) on every file that git would commit; allowlist `gitleaks.toml` (published local example values only) | no leaks | `gitleaks.json` |
| `hygiene` | git | no YAML, Docker, `CLAUDE.md`, `AGENTS.md`, `context/`, `.env` or QA output files, and no dealer-code-like values (10 digits `6xxxxxxxxx` or `7xxxxxxxxx`, or 8 digits `7xxxxxxx`) in the files that git would commit. Optional: set `REAL_CODES_FILE` to a git-ignored list of real codes (one for each line) to look for each of them too | `hygiene.txt` |
| `zap` | OWASP ZAP `ghcr.io/zaproxy/zaproxy:stable` (Docker, the same image as the reference API) driven by `/api/v1/openapi.json` | `FAIL-NEW: 0` (exit code 2 = warnings only = pass) | `zap-report.html/.md/.json` |

Override an image with `SEMGREP_IMAGE`, `GITLEAKS_IMAGE` or `ZAP_IMAGE`. An unknown scan name gives exit code 2.

## Test case index (Playwright)

### Dealer scheme status — `dealer_scheme_status.spec.js`

| TC | Category | Description | Expected |
|---|---|---|---|
| DSS_TC_1 | Functional | Dealer with all tags | 200, exactly `dealer_code`, `dealer_name`, `data_as_of`, `schemes`; one scheme per tag |
| DSS_TC_2 | Functional | Tags in reverse order | Schemes in the order of `scheme_tags` |
| DSS_TC_3 | Functional | One tag | One scheme, equal to the same scheme in the multi-tag answer |
| DSS_TC_4 | Functional | Child dealer | The parent's result; `dealer_code` is the parent |
| DSS_TC_5 | Functional | Spaces around the code and the tags | Trimmed, same result |
| DSS_TC_6 | Functional | Unknown dealer | 404 `DEALER_NOT_FOUND` |
| DSS_TC_7 | Functional | Unknown tag (also with an unknown dealer) | 400 `UNKNOWN_SCHEME_TAG`, checked before the dealer |
| DSS_TC_8 | Functional | Tag in lower case | 400 `UNKNOWN_SCHEME_TAG` (case-sensitive) |
| DSS_TC_9 | Functional | `Application/JSON`, `; charset=utf-8` | 200, same result |
| DSS_TC_10 | Functional | `data_as_of`, content type, security headers | IST date-time or null; `application/json; charset=utf-8` |
| DSS_TC_11 | Validation | Fields for each participation | `NOT_IN_SCOPE`: 4 fields; `IN_SCHEME`: documented fields; documented reason codes |
| DSS_TC_12 | Validation | LOCKED / UNLOCKED | UNLOCKED only for the current slab and lower slabs |
| DSS_TC_13 | Validation | Slab rule (CLAUDE.md section 6) | The slab before the first slab with a failed condition |
| DSS_TC_14 | Validation | Types of slabs, gifts, conditions, metrics | As in the contract |
| DSS_TC_15 | Validation | Dates | `YYYY-MM-DD`; `from_date` ≤ `to_date` < `final_on` |
| DSS_TC_16 | Validation | [demo] DEMO0001 | FB-PAN Slab 1 of 7 with the circular values; FB-TNHPJK / SP-Q3 not in scope |
| DSS_TC_17 | Validation | [demo] DEMO0002, DEMO0003 | No slab; DEMO0003 meets Slab 3 but stops at Slab 1 |
| DSS_TC_18 | Validation | [demo] DEMO0004, DEMO0005, DEMO0006 | Slab 7 with returns; FB-TNHPJK Slab 2 without growth; region unknown |
| DSS_TC_19 | Validation | [demo] DEMO0007, DEMO0008, DEMO0009 | Star Points points, trip gift value null, extra benefits, enrolment |
| DSS_TC_20 | Validation | [demo] DEMO0011 | OD blocks the benefit, slab kept |
| DSS_TC_21–27 | Edge | 32-character code, `_`/`-` code, extra fields, 10 tags, repeats, body of exactly 8,192 bytes, deep nesting | Passes validation / 200 / < 500 |
| DSS_TC_28–35 | Negative | `dealer_code` missing, empty, blanks, null, number, boolean, array, object, 33 characters, space / dot / slash | 400 `INVALID_REQUEST`, no echo |
| DSS_TC_36–43 | Negative | `scheme_tags` missing, empty, not an array, 11 items, non-string, empty item, too long, control character, duplicate | 400 `INVALID_REQUEST` |
| DSS_TC_44–47 | Negative | Invalid JSON, empty body, JSON array / string / number, form / text / no content type | 400 `INVALID_REQUEST` |
| DSS_TC_48 | Negative | `GET` and `HEAD` | 405 with `Allow: POST` |
| DSS_TC_49_SEC | Authentication | No `Authorization`, empty, `Bearer` with no token | 401 `Not authenticated` + `WWW-Authenticate: Bearer realm=…` |
| DSS_TC_50_SEC | Authentication | Garbage token | 401 `Invalid token`, `error="invalid_token"` |
| DSS_TC_51_SEC | Authentication | Changed signature, changed payload, no signature | 401 `Invalid token` |
| DSS_TC_52_SEC | Authentication | Token in the query string only | 401 (header only) |
| DSS_TC_53_SEC | Authentication | `X-API-Key` alone (the old phase 2 scheme) | 401 `Not authenticated` |
| DSS_TC_54–59_SEC | Injection | SQLi, XSS, path traversal, null byte, CRLF, Unicode in `dealer_code` | 400, not reflected, no injected header |
| DSS_TC_60_SEC | Oversized input | 5,000-character dealer code | 400 or 413, never 500 |
| DSS_TC_61_SEC | Resource consumption | 1 MB body | 413 `PAYLOAD_TOO_LARGE` |
| DSS_TC_62_SEC | Resource consumption | Chunked body over 8 KB (no `Content-Length`) | 413 |
| DSS_TC_63_SEC | Injection | SQLi / script text in `scheme_tags` | 400 `UNKNOWN_SCHEME_TAG` as JSON with nosniff and CSP; message `A scheme tag does not exist.`, no echo (QA-2) |
| DSS_TC_64_SEC | Method abuse | `PUT` / `DELETE` / `PATCH` | 405 `METHOD_NOT_ALLOWED` |
| DSS_TC_65_SEC | Method abuse | `OPTIONS`, `TRACE` | `OPTIONS` 204 with `Allow` and no CORS; `TRACE` 405 `METHOD_NOT_ALLOWED` JSON with `Allow: POST`, security headers, no echo (QA-1) |
| DSS_TC_66–70_SEC | Headers (CWE-693, CWE-200) | nosniff; HSTS ≥ 1 year exactly once; `no-store` (also errors); CSP, DENY, `no-referrer`, CORP, each once; no server version, no `X-Powered-By` | present / absent |
| DSS_TC_71_SEC | CORS | Foreign `Origin` | no `Access-Control-Allow-*` |
| DSS_TC_72_SEC | Traceability | `X-Request-Id` on 200, 400, 405 | a different UUID on each |
| DSS_TC_73_SEC | Rate limiting | 50 parallel requests | no 5xx |
| DSS_TC_74_SEC | Rate limiting | 3 × the per-IP limit in one second (`RATE_LIMIT`) | some 429 with `Retry-After: 1`, `RATE_LIMITED`, headers; health never limited; 200 again after 1 s |
| DSS_TC_75_SEC | Rate limiting | Per-client limit + 3 (`CLIENT_RATE_LIMIT`) | ≥ 3 × 429 with `Retry-After` 1–60 |
| DSS_TC_76_SEC | Authentication | Non-ASCII token | 401 `Invalid token`, never 500 |
| DSS_TC_77_SEC | Authentication | `Basic`, `Token`, `JWT`, bare token | 401 `Not authenticated` |
| DSS_TC_78_SEC | Authentication | `alg` `none` / `None` / `NONE` | 401 `Invalid token` |
| DSS_TC_79_SEC | Authentication | Other HS256 key, empty key, RS256 | 401 `Invalid token` |
| DSS_TC_80_SEC | Authentication | Expired token (needs `JWT_SECRET`) | 401 `Token expired`, `error="invalid_token"` |
| DSS_TC_81_SEC | Authorization | No `schemes:read` scope (empty, other, missing) | 403 `INSUFFICIENT_SCOPE`, `error="insufficient_scope"` |
| DSS_TC_82_SEC | Authentication | Revoked client, wrong `aud` / `iss`, future `nbf`, no `exp` / `jti` / `sub` / `iat` / `nbf`, HS512 | 401 `Invalid token` |
| DSS_TC_83_SEC | Authentication | Expired 10 s ago (30 s clock skew) | 200 |
| DSS_TC_84 | Authentication | `Bearer` / `bearer` / `BEARER`, token used again | 200 |
| DSS_TC_85 | Cache | New dealer code twice (404); DEALER twice (200) (`CACHE_ENABLED`) | `X-Cache` MISS then HIT, same status and body |
| DSS_TC_86 | Cache | Two tag orders, twice each; a 400 | The order of each request is kept; the `INVALID_REQUEST` 400 has no `X-Cache` (an `UNKNOWN_SCHEME_TAG` 400 is cached) |
| DSS_TC_87_SEC | Cache | No token after the answer is cached | 401, no `X-Cache` |
| DSS_TC_88 | Validation | [demo] DEMO0012, DEMO0013 | No Q1 sales of any product: no slab, growth not met; Q1 sales of other products only: growth met, Slab 1 |
| DSS_TC_89 | Validation | [demo] DEMO0014 | Star Points growth on total GSR: 16.66%, Slab 1 |

Browser suite (`ui/ui_smoke.spec.js`, Step 4b):

| ID | Area | Case | Expected |
|---|---|---|---|
| UI_TC_1 | Admin | `/admin` without a session | Redirect to the login page |
| UI_TC_2 | Admin | Wrong password | Generic error, still on the login page |
| UI_TC_3 | Admin | Login | Report with FB-PAN–SP-Q3, "Data as of", last sync, dealers per slab |
| UI_TC_4 | Admin | Dealers without a search, then the dealer code | The FB-PAN list opens on Unlocked; the dealer is found; the support view opens with that scheme only; **Back to dealers** and the browser Back keep the search text and the tab |
| UI_TC_5 | Admin | Unknown dealer page | No 5xx, no application error |
| UI_TC_6 | Admin | Sync runs | Runs listed with a status |
| UI_TC_7 | Admin | Log out | Back to login; `/admin` asks for the login again |
| UI_TC_8 | Iframe | Valid token | My Schemes, dealer code, data time, scheme cards |
| UI_TC_9 | Iframe | Valid token | Slab status Unlocked / Locked; at most one Unlocked slab per scheme; columns Slab, Gift, CN alternative, Status; no "To unlock" box, no material returns |
| UI_TC_10–13 | Iframe | No token, changed signature, other secret, expired | "Session expired", no dealer data |
| UI_TC_14 | Iframe | Plain `dealer_code` parameter (not on localhost) | "Session expired", no dealer data |
| UI_TC_15 | Iframe | Phone width 390 px | No horizontal scroll |
| UI_TC_16 | Iframe | Response headers | `frame-ancestors` in the CSP, `Cache-Control: no-store` |
| UI_TC_17 | Admin | Dealers filter tabs | Order Unlocked, Locked, All; Unlocked selected by default; All = Unlocked + Locked; Unlocked lists only dealers in a slab; Locked only dealers with "No slab"; the tab is not kept in the address bar, so a reload opens Unlocked |
| UI_TC_18 | Admin | Scheme filter and paging | Picking SP-Q3 reloads the list without a click on Show; page 2 keeps the scheme and the status filter; a reload opens Unlocked, page 1 |
| UI_TC_19 | Admin | Dealers at 320 px | Cards with eligibility and slab (no table); no horizontal scroll on the list and the dealer page |
| UI_TC_20 | Admin | Theme button | Dark theme on click and after a reload; the page behind is dark too (no white strip when a fast scroll bounces); the iframe stays light; back to light |
| UI_TC_21 | Iframe | Scheme terms | Each scheme card (not a "not in scheme" card) has a closed "Scheme terms and conditions" section; a click opens it (OD (overdue) criteria, Calculation) |
| UI_TC_22 | Admin | Reward choice history | The History section shows; a Download link returns the CSV with the header `changed_at,...,sent_by`; a bad link gives 400 |

Every error is also checked for the envelope `{error: {code, message}}`, `X-Request-Id`, the security headers, and
no leak (no stack trace, file path, SQL or driver text, no echo of the input).

### Common — `common.spec.js`

| TC | Category | Description | Expected |
|---|---|---|---|
| COMMON_TC_1 | Functional | `GET /api/v1/health` | 200 `{status: "ok", data_as_of}` with the security headers |
| COMMON_TC_2 | Negative | Unknown `/api` route, 4 methods | JSON 404 `NOT_FOUND` |
| COMMON_TC_25 | Negative | `/api` and `/api/` (`GET`, `POST`) | JSON 404 `NOT_FOUND` with the API security headers and `X-Request-Id` (QA-3) |
| COMMON_TC_26_SEC | Method abuse | `TRACE` on health, token, unknown `/api` path and `/embed`; `PROPFIND` and `QUERY` on `/api` paths | 405 `METHOD_NOT_ALLOWED` JSON with the route's `Allow` (404 `NOT_FOUND` on an `/api` path with no route), security headers, no echo, not 500 (QA-1) |
| COMMON_TC_3_SEC | Authentication | Health without a token; `HEAD` | 200; `HEAD` has no body |
| COMMON_TC_4_SEC | Transport | Plain HTTP on a deployed URL | Redirect or refused (skipped on local http) |
| COMMON_TC_21_SEC | Supply chain | `/api/docs`: one pinned `swagger-ui-dist` release with `integrity` + `crossorigin`; CSP allows only that release and the start script by hash; the hashes match the files on the CDN | All true (skipped when docs are off) |
| COMMON_TC_22 | Functional | `GET /api/v1/openapi.json` | 200, the three paths, this server first (skipped when docs are off) |
| COMMON_TC_23 | Edge | `/api/v1/health/` (trailing slash) | 308 to `/api/v1/health` (documented difference from the reference API) |

Token endpoint `POST /api/v1/auth/token` (RFC 6749 client credentials; runs with `AUTH_ENABLED=true`). Each error is
checked for `{error, error_description}` only, `Cache-Control: no-store`, `Pragma: no-cache`, and no stack trace or
secret in the body.

| TC | Category | Description | Expected |
|---|---|---|---|
| COMMON_TC_5 | Functional | Form-encoded credentials with `scope=schemes:read` | 200 `{access_token, token_type: "Bearer", expires_in: 3600, scope}`; claims `iss`/`aud` `scheme-calculator`, `sub`, 32-hex `jti`; works on the API |
| COMMON_TC_6 | Functional | JSON body, no `scope` | 200, same body |
| COMMON_TC_7 | Functional | Credentials in HTTP Basic | 200, same body |
| COMMON_TC_8_SEC | Authentication | Wrong `client_secret` | 401 `invalid_client`, `WWW-Authenticate: Basic realm="scheme-calculator"` |
| COMMON_TC_9_SEC | Authentication | Unknown `client_id` | 401 `invalid_client`, same message (no client enumeration) |
| COMMON_TC_10_SEC | Negative | No `grant_type` | 400 `invalid_request` |
| COMMON_TC_11_SEC | Negative | `grant_type=password` | 400 `unsupported_grant_type` |
| COMMON_TC_12_SEC | Authorization | `scope=schemes:read admin` | 400 `invalid_scope` |
| COMMON_TC_13_SEC | Negative | Credentials in Basic **and** in the body | 400 `invalid_request` |
| COMMON_TC_14_SEC | Method abuse | `GET` with credentials in the query string | 405, `Allow: POST`, no secret in the body |
| COMMON_TC_15_SEC | Headers | Success and error | `no-store`, `Pragma: no-cache`, security headers |
| COMMON_TC_16_SEC | Negative | `text/plain`, broken JSON, JSON array, non-string value | 400 `invalid_request` |
| COMMON_TC_17_SEC | Parameter pollution | `client_id` two times (form) | 400 `invalid_request` |
| COMMON_TC_18_SEC | Authentication | No secret, empty secret, malformed Basic | 401 `invalid_client` |
| COMMON_TC_19_SEC | Rate limiting | `TOKEN_RATE_LIMIT` + 5 requests at once (alone); then a forged `X-Forwarded-For` | ≥ 5 × 429 with `Retry-After` 1–60 and `rate_limited`; forged header still 429; the API still works with the old token |
| COMMON_TC_20_SEC | Parameter pollution | JSON body with `client_secret` (or `client_id`) two times, the last one right | 400 `invalid_request` |
| COMMON_TC_24_SEC | Resource consumption | Body over 8 KB; lone surrogate `\ud800` in JSON | 413; 400 `invalid_request` |

## OWASP API Security Top 10 (2023) coverage

| Risk | Status | How |
|---|---|---|
| API1 Broken Object Level Authorization | By design | One client sees every dealer (SAP Commerce / SFA serve all dealers). If per-dealer access is necessary, tokens must carry a dealer scope. |
| API2 Broken Authentication | Covered | OAuth2 client credentials (SHA-256 secret hashes, constant-time check, same error for an unknown client and a wrong secret), 1-hour HS256 JWTs (algorithm fixed; `iss`/`aud`/`sub`/`iat`/`nbf`/`exp`/`jti` required; a removed client loses its tokens), token endpoint limited for each IP. Tests: DSS_TC_49–53_SEC, DSS_TC_76–84, DSS_TC_87_SEC, COMMON_TC_3_SEC, COMMON_TC_5–20, 24, Postman folders 4 and 5. Auth is required outside `APP_ENV=local` (startup rules; Vitest `src/server/config.test.ts`; manual check in Step 3). |
| API3 Broken Object Property Level Authorization | Covered | Fixed response shape; only the stored status object (DSS_TC_1, 11, 14; `specs.test.ts`). |
| API4 Unrestricted Resource Consumption | Covered | 8 KB body limit, also chunked (DSS_TC_26, 60–62_SEC, COMMON_TC_24_SEC); 1–10 tags; DB pool timeout with 503; limits for each IP (2,500/s, DSS_TC_74_SEC), each client (1,00,000/min by default, decision Q5; DSS_TC_75_SEC with a low server value) and the token endpoint (30/min, COMMON_TC_19_SEC). |
| API5 Broken Function Level Authorization | N/A | No admin or write endpoints in the API. The admin report has its own login (phase 1). |
| API6 Unrestricted Access to Sensitive Business Flows | N/A | Read-only look-ups. |
| API7 Server-Side Request Forgery | N/A | No URL inputs. |
| API8 Security Misconfiguration | Covered | Security headers, no stack traces, no server version (DSS_TC_66–72_SEC, ZAP). The server refuses to start with weak, example or missing auth settings, also when `APP_ENV` is not set. TLS redirect to check on deployment (COMMON_TC_4_SEC). `TRACE` and unknown methods get 405 JSON from the method guard (QA-1, fixed; DSS_TC_65_SEC, COMMON_TC_26_SEC). |
| API9 Improper Inventory Management | Covered | Versioned `/api/v1`; contract `docs/openapi.json` checked by `npm run openapi:check`; Swagger UI only with `DOCS_ENABLED` (default only `APP_ENV=local`). |
| API10 Unsafe Consumption of APIs | Covered | The API reads stored results only. The BigQuery sync and the engine validate the data (phase 1 tests). |
