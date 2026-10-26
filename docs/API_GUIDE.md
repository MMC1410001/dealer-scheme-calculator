# Dealer scheme status API — integration and test guide

Version `v1` · Base path `/api/v1` · Status date 22-10-2026

This guide tells how to call the dealer scheme status API and how to test it. Part 1 is for teams that connect a
system to the API (SAP Commerce / SFA back end). Part 2 is for QA. The full contract is
[api-contract.md](api-contract.md). The machine-readable contract is [openapi.json](openapi.json).

Files in this repository:

| File | Use |
|---|---|
| `qa/postman/Scheme_Calculator_Dealer_Status.postman_collection.json` | Postman collection: requests and tests |
| `qa/postman/*.postman_environment.json` | Postman environments (Local, Dev) |
| `qa/swagger/Scheme_Calculator_Dealer_Status.openapi.json` | Swagger file with request examples and error codes |
| `docs/openapi.json` | The OpenAPI 3.0.3 contract (Swagger UI, Postman, code generators) |
| `/api/docs` on a running server | Swagger UI, when `DOCS_ENABLED` is on for that server |

---

## Part 1 — Use the API

### 1.1 What the API gives

The API gives the scheme status of one dealer for one or more schemes: the slabs with `LOCKED` / `UNLOCKED`, the
gift and the CN alternative of each slab, and the values of the conditions. It is the same data as the iframe
(`/embed`). The API reads stored results. The results change after each data load (BigQuery sync and engine run).

| Endpoint | Use |
|---|---|
| `POST /api/v1/auth/token` | Get an access token (OAuth2 client credentials) |
| `POST /api/v1/dealer-scheme-status` | Scheme status of one dealer |
| `POST /api/v1/dealer-reward-choice` | Save the dealer's reward choice (gift or CN) for one scheme. Needs the scope `choices:write`. See 1.9. |
| `POST /api/v1/embed-token` | Get a signed iframe URL (`/embed?token=...`) for one dealer. See 1.10. |
| `GET` / `HEAD /api/v1/health` | Readiness probe (checks the database). No token. |

### 1.2 Environments

| Environment | Base URL | Swagger UI (`/api/docs`) |
|---|---|---|
| Dev | `https://dev.scheme-calculator.example.com` | On: `https://dev.scheme-calculator.example.com/api/docs` |
| UAT | Same pattern as Dev, *host to be confirmed* | On (`DOCS_ENABLED=true`) |
| Production | Same pattern as Dev, *host to be confirmed* | Off (on only when asked) |

Decisions of Mayur, 18-10-2026: the hosts use the example domain, with the same pattern as the other Acme API
(`dev.scheme-api.example.com`) (Q8). Swagger UI is on in Dev and UAT and off in production (Q9). Do not use a UAT or
production host before it is confirmed.

Use HTTPS only. The API is server-to-server: call it from your back end, never from a browser or a mobile app.

### 1.3 Authentication

1. Get a `client_id` and a `client_secret` from the developer (one pair for each system and environment). Keep the
   secret in your secret store.
2. Get a token:

   ```bash
   curl -s -X POST https://<host>/api/v1/auth/token -u "$CLIENT_ID:$CLIENT_SECRET" -d grant_type=client_credentials
   ```

   The answer is `{"access_token": "…", "token_type": "Bearer", "expires_in": 3600, "scope": "schemes:read"}`.
   A client that may save reward choices (in `AUTH_WRITE_CLIENTS` on the server) gets
   `"scope": "schemes:read choices:write"`. Ask the developer to add your `client_id` to that list.
3. Send `Authorization: Bearer <access_token>` on each data request.
4. Use the same token again until it expires. Get a new token about 60 s before `expires_in` ends, or after a
   401 with the message `Token expired`. The token endpoint allows only 30 requests a minute for each IP.

Rate limits: 1,00,000 data requests a minute for each `client_id` (decision Q5), 2,500 requests a second for each
client IP, and 30 token requests a minute for each client IP. Over a limit, the API answers 429 with `Retry-After`.

### 1.4 Request

`POST /api/v1/dealer-scheme-status`, `Content-Type: application/json`, body 8 KB or smaller:

```json
{ "dealer_code": "DEMO0001", "scheme_tags": ["FB-PAN", "FB-TNHPJK", "SP-Q3"] }
```

| Field | Rule |
|---|---|
| `dealer_code` | String. Spaces at the start and end are removed. Then 1–32 characters: letters, digits, `_`, `-`. |
| `scheme_tags` | 1–10 strings, unique, each 1–32 characters. Each tag must be an active scheme. Tags are case-sensitive. |

### 1.5 Response

The answer has `dealer_code`, `dealer_name`, `data_as_of` and `schemes` (one item for each tag, in the order of
`scheme_tags`). For a child dealer, `dealer_code` is the parent code. Each item is `IN_SCHEME` (with the header,
the slabs and the conditions) or `NOT_IN_SCOPE` (with `reason_code` and `reason`). See
[api-contract.md](api-contract.md) sections 5 and 6 for all fields and a full example. Read metrics and conditions
by `key`, not by position.

### 1.6 Errors

Errors of the data endpoint have the form `{"error": {"code": "…", "message": "…"}}`. Use `code` in your logic. The
token endpoint uses the OAuth2 form `{"error": "…", "error_description": "…"}`.

| Status | `code` | When | Retry |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | Body not valid (see 1.4). The message never repeats your input. | No. Fix the request. |
| 400 | `UNKNOWN_SCHEME_TAG` | A tag is not an active scheme | No |
| 401 | `UNAUTHORIZED` | Token missing, not valid or expired | After `Token expired`: get a new token, retry one time |
| 403 | `INSUFFICIENT_SCOPE` | Token without the scope of the endpoint (`schemes:read`, or `choices:write` for the reward choice) | No |
| 404 | `DEALER_NOT_FOUND` | Dealer code not known | No |
| 405 | `METHOD_NOT_ALLOWED` | Method is not `POST` | No |
| 409 | `CHOICE_NOT_ALLOWED` | Reward choice only: the dealer is not in a slab of the scheme, or a destination is not allowed | No |
| 413 | `PAYLOAD_TOO_LARGE` | Body larger than 8 KB | No |
| 429 | `RATE_LIMITED` | Too many requests (more than 1,00,000 a minute for your `client_id`, or 2,500 a second from one IP) | Yes, after `Retry-After` seconds |
| 500 | `INTERNAL_ERROR` | Unexpected error. Report it with the `X-Request-Id`. | One time |
| 503 | `SERVICE_BUSY` | Database busy | Yes, after `Retry-After` seconds |

Every answer has an `X-Request-Id` header. Give it to support with a problem report.

### 1.7 Postman

1. **Import** the collection and an environment from `qa/postman/`.
2. Select the environment. Set `baseUrl`, `clientId`, `clientSecret` and `dealerCode`. The collection gets the
   token itself and uses it until shortly before it expires.
3. Open **2. Dealer scheme status**, select a request and click **Send**. To run all checks, click **Run** on the
   collection.

### 1.8 Code examples

Both examples keep one token in memory, get a new one 60 s before it expires, and retry one time after
`401 Token expired`. `BASE_URL`, `CLIENT_ID` and `CLIENT_SECRET` come from your configuration. In a service with
many threads or processes, share the token and refresh it under a lock.

**Python (requests)**

```python
import time
import requests

session = requests.Session()
_token = {"value": None, "expires_at": 0.0}


def get_token(force: bool = False) -> str:
    if force or time.time() >= _token["expires_at"] - 60:
        r = session.post(f"{BASE_URL}/api/v1/auth/token", data={"grant_type": "client_credentials"},
                         auth=(CLIENT_ID, CLIENT_SECRET), timeout=15)
        r.raise_for_status()
        body = r.json()
        _token.update(value=body["access_token"], expires_at=time.time() + body["expires_in"])
    return _token["value"]


def dealer_status(dealer_code: str, scheme_tags: list[str]) -> dict:
    for attempt in range(2):
        r = session.post(f"{BASE_URL}/api/v1/dealer-scheme-status",
                         json={"dealer_code": dealer_code, "scheme_tags": scheme_tags},
                         headers={"Authorization": f"Bearer {get_token(force=attempt > 0)}"}, timeout=15)
        if r.status_code == 401 and attempt == 0 and r.json()["error"]["message"] == "Token expired":
            continue  # get a new token and retry one time
        r.raise_for_status()
        return r.json()


for scheme in dealer_status("DEMO0001", ["FB-PAN", "FB-TNHPJK", "SP-Q3"])["schemes"]:
    print(scheme["scheme_tag"], scheme["participation"], scheme.get("current_slab"))
```

**JavaScript (Node 18+, fetch)**

```javascript
let token = null;
let expiresAt = 0;

async function getToken(force = false) {
  if (force || Date.now() >= expiresAt - 60_000) {
    const res = await fetch(`${BASE_URL}/api/v1/auth/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    });
    if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);
    const body = await res.json();
    token = body.access_token;
    expiresAt = Date.now() + body.expires_in * 1000;
  }
  return token;
}

async function dealerStatus(dealerCode, schemeTags) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE_URL}/api/v1/dealer-scheme-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken(attempt > 0)}` },
      body: JSON.stringify({ dealer_code: dealerCode, scheme_tags: schemeTags }),
    });
    if (res.status === 401 && attempt === 0) {
      const { error } = await res.json();
      if (error.message === 'Token expired') continue; // get a new token and retry one time
      throw new Error(`HTTP 401: ${error.message}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.json()).error.code}`);
    return res.json();
  }
}

const status = await dealerStatus('DEMO0001', ['FB-PAN', 'FB-TNHPJK', 'SP-Q3']);
```

### 1.9 Reward choice (gift or CN)

The dealer chooses the gift (gold voucher or trip) or the CN alternative of the slab. There are three ways to save the
choice. All three write the same record:

| Way | Who | How |
|---|---|---|
| API | SAP / SFA back end | `POST /api/v1/dealer-reward-choice` (below). |
| Admin upload | Business team (admin-area user) | `/admin/choices`: upload a `.csv` or `.xlsx` file for many dealers. |
| Admin dealer page | Admin-area user | Open the dealer, select Gift or CN for the scheme, click **Save choice**. |

Rules: the dealer must be in a slab of the scheme. The choice never locks: a new choice replaces the saved one. For
Star Points, a dealer in Slab 7 also chooses the destination: `CRUISE` or `OVERSEAS`. The iframe shows the saved
choice and the final benefit; it has no form.

Final benefit of the Star Points extra points (circular p2): with `GIFT`, the extra tickets of the chosen destination
(or their CN in place of the tickets); with `CN`, ₹18,500 CN for every 26,000 points. See
[api-contract.md](api-contract.md) section 13.5.

Request (token with `choices:write`):

```bash
curl -s https://<host>/api/v1/dealer-reward-choice \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dealer_code":"DEMO0001","scheme_tag":"FB-PAN","choice":"GIFT","chosen_by":"SO1234"}'
```

| Field | Rule |
|---|---|
| `dealer_code` | Same rule as 1.4. A child code is saved under its parent. |
| `scheme_tag` | One active scheme tag. |
| `choice` | `GIFT` or `CN`. |
| `destination` | Star Points Slab 7 only: `CRUISE` or `OVERSEAS`. Else omit it or send `null`. |
| `chosen_by` | The ID of the user who recorded the choice (audit). 1–64 letters, digits, `.`, `_`, `@`, `-`. |

The answer is `{"dealer_code", "scheme_tag", "changed", "reward_choice"}`. `changed` is `false` when the same choice
was already saved: you can send a choice again with no side effect. After a save, the dealer status (iframe and API)
shows the choice in `reward_choice` of the scheme. Errors: 400, 404, and 409 `CHOICE_NOT_ALLOWED` (see 1.6).

### 1.10 Iframe (DMS and SFA pages)

The iframe shows the dealer view on the host page. Get a signed URL on the server for the logged-in dealer, then use
it as the iframe `src`. The host does not need the iframe signing secret.

```bash
curl -s https://<host>/api/v1/embed-token \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dealer_code":"DEMO0001"}'
# {"token":"...","embed_path":"/embed?token=...","expires_at":"2026-10-22T12:30:00.000Z"}
```

| Field | Rule |
|---|---|
| `dealer_code` | The logged-in dealer. Same rule as 1.4. |
| `scheme_tags` | Optional. Show only these schemes, for example `["FB-PAN"]`. |
| `ttl_seconds` | Optional. 60 to 86400. Default 3600. |

iframe `src` = `https://<host>` + `embed_path`. Ask for a new URL each time the page opens. The iframe sends its
height to the host page; set the iframe height from it (script in [api-contract.md](api-contract.md) section 14.4).
The host page origin must be in `EMBED_ALLOWED_ORIGINS`, or the browser blocks the iframe.

### 1.11 Questions

**Why is a scheme `NOT_IN_SCOPE`?** Read `reason_code`: the region is not in the scheme, the region is not known,
the dealer joined the other scheme (Festive Bonanza or Star Points, not both), or there is no stored result.

**Why is `current_slab` null?** The dealer does not meet all conditions of Slab 1. `reason_code` names the first
failed condition. The rule checks the slabs in order and stops at the first slab with a failed condition.

**Why does a child dealer code give another `dealer_code`?** Sales of a child roll up to the parent. The answer is
the parent's.

**Is the data real-time?** No. The data changes after each data load. `data_as_of` gives the time of that load.
Results are provisional until `final_on`.

---

## Part 2 — Test the API (QA)

All test files are in `qa/`. Start with the step-by-step QA guide in [qa/README.md](../qa/README.md). Latest
results: [qa/TEST_RESULTS.md](../qa/TEST_RESULTS.md).

| Layer | Tool | Location | What it covers |
|---|---|---|---|
| Unit | Vitest | `src/**/*.test.ts`, `qa/**/*.test.ts` | Engine, auth, rate limits, cache, security, config, docs; Postman and Swagger guards (no server needed) |
| Functional and negative | Postman / newman | `qa/postman/` | 84 requests, folder 6 = reward choice (runs only with `writeEnabled=true` and the DEMO dealers) |
| Full API suite | Playwright | `qa/api-tests/` | 113 cases: `dealer_scheme_status.spec.js` (87), `common.spec.js` (26) |
| Performance | k6 | `qa/k6/` | Smoke, load (150 VUs), stress (600 VUs), spike (500 VUs), fixed rate (`rate.js`) |
| Security | Semgrep, npm audit, gitleaks, git, OWASP ZAP | `qa/security/` | Static analysis, dependency CVEs, secrets, repository rules, active API scan |

### 2.1 Test data

On a local machine, `npm run data:demo` loads synthetic dealers (`DEMO0001`–`DEMO0014`, `DEMO-C1`). The list of
cases is in [qa/README.md](../qa/README.md) Step 2. `DEMO9999` does not exist (404).

On Dev or production, use real dealer codes from the git-ignored file `qa/test-data/dealers.json`
(`npm run qa:pick-dealers`), and set `SAMPLE_DATA=false` for Playwright. Real dealer codes are client data: never
put them in a tracked file, a ticket or a chat.

### 2.2 Quick start

```bash
# Postman (headless)
cd qa/postman
npx --yes newman@6.2.2 run Scheme_Calculator_Dealer_Status.postman_collection.json -e Local.postman_environment.json

# Playwright (all, or one file with npm run test:dss / test:common)
cd qa/api-tests && npm install && AUTH_ENABLED=true npx playwright test

# Playwright on Dev (https://dev.scheme-calculator.example.com; QA client from the developer)
cd qa/api-tests && CLIENT_ID=<id> CLIENT_SECRET=<secret> npm run test:dev

# k6
cd qa/k6 && k6 run smoke.js && k6 run load.js

# Security scans
CLIENT_ID=local-client CLIENT_SECRET=local-test-secret qa/security/run_scans.sh
```

On a local machine the client is `local-client` / `local-test-secret`. The suites get a token from
`/api/v1/auth/token` themselves. On other servers, set `API_BASE_URL` / `BASE_URL`, `CLIENT_ID` and `CLIENT_SECRET`.
On Dev, the Postman environment **Scheme Calculator - Dev** and `npm run test:dev` already have the Dev URL.

### 2.3 Acceptance criteria

| Area | Criterion |
|---|---|
| Functional | All Postman checks and Playwright tests pass (skips only with a stated reason) |
| Performance | Error rate < 1%, checks > 99%, p95 < 500 ms and p99 < 1 s at expected load |
| Security | No Semgrep findings, no known CVEs in production dependencies, no secrets, no hygiene problems, no ZAP FAIL alerts |
