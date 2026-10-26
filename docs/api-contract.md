# Dealer scheme status API – contract

Status date: 22-10-2026. Owner: Mayur Chaudhary. Version: `v1` (path `/api/v1/`).

This page is the **current contract of the built API**. The machine-readable copy is [`docs/openapi.json`](openapi.json) (OpenAPI 3.0.3). `npm run openapi:check` (and a unit test) checks it against the code. The code is in `src/app/api/`, `src/server/api/`, `src/server/` and `src/lib/auth/`.

## 1. Purpose and scope

- The API returns the scheme status of one dealer for one or more scheme tags.
- The API is the **second option** for SAP Commerce (DMS) / SFA. The iframe (`/embed`) is the first option. Decision (Mayur, 16-10-2026): phase 2 is this API. The Excel upload comes later.
- The API is **server-to-server only**. The client system calls it from its back end. A browser must not call it. The API sends no CORS headers, so a browser on another origin cannot read the response. The browser path is the iframe.
- The dealer status endpoint is read-only. It reads the stored results that the scheme engine wrote after the last data load. It does not calculate on request. It does not query BigQuery.
- The reward choice endpoint (section 13, 22-10-2026) writes one thing only: the dealer's choice of gift or CN. Acme (SAP / SFA) uses it to send the choice to this application. The iframe and the status API then show the choice.
- The iframe token endpoint (section 14, 22-10-2026) helps the host put the iframe on its page: it returns a signed `/embed` URL for the logged-in dealer. Section 14 also gives the full iframe integration (host page and height message).
- The 200 body is the same object that the iframe shows (`getDealerStatus()` in `src/server/repo.ts`).
- All amounts are in INR (rupees, not lakh). GSR = DPL − in-bill discounts.

## 2. Endpoints

| Method and path | Authentication | Use |
|---|---|---|
| `POST /api/v1/auth/token` | Client credentials (HTTP Basic or body) | Get an access token (section 3). |
| `POST /api/v1/dealer-scheme-status` | `Authorization: Bearer <access_token>` (scope `schemes:read`) | Scheme status of one dealer. |
| `POST /api/v1/dealer-reward-choice` | `Authorization: Bearer <access_token>` (scope `choices:write`) | Save the reward choice (gift or CN) of one dealer for one scheme (section 13). |
| `POST /api/v1/embed-token` | `Authorization: Bearer <access_token>` (scope `schemes:read`) | Get a signed iframe URL (`/embed?token=...`) for one dealer (section 14). |
| `GET /embed?token=...` | The signed token in the URL | The iframe dealer view (a web page, not an API). Section 14. |
| `GET /api/v1/health`, `HEAD /api/v1/health` | None | Probe for DevOps. Returns `{"status":"ok","data_as_of":"…"}` (200), or `{"status":"unavailable","data_as_of":null}` (503) when the database does not answer. `HEAD` gives the same status with no body (for load balancers); it is not listed in the OpenAPI file, so Swagger UI shows one health row. No dealer data. The value is kept for 15 s. Never rate limited. |
| `GET /api/v1/openapi.json` | None | The OpenAPI spec. Only when `DOCS_ENABLED` (default: only with `APP_ENV=local`). Otherwise 404. Dev and UAT set `DOCS_ENABLED=true`; production keeps it off unless asked (decision Q9, 18-10-2026). |
| `GET /api/docs` | None | Swagger UI (one pinned `swagger-ui-dist` release with Subresource Integrity). Same switch as the spec. |

Base URL (decision Q8, Mayur, 18-10-2026: domain example, the same pattern as the other Acme API `https://dev.scheme-api.example.com`):

| Environment | Base URL | Swagger UI |
|---|---|---|
| Dev | `https://dev.scheme-calculator.example.com` | `https://dev.scheme-calculator.example.com/api/docs` |
| UAT | Same pattern, host to be confirmed | On (`DOCS_ENABLED=true`) |
| Production | Same pattern, host to be confirmed | Off unless asked |

Other methods on `/api/v1/dealer-scheme-status`, `/api/v1/dealer-reward-choice`, `/api/v1/embed-token` and `/api/v1/auth/token` (`GET`, `HEAD`, `PUT`, `PATCH`, `DELETE`) return **405** with `Allow: POST`. `OPTIONS` returns 204 with `Allow: POST, OPTIONS` and no CORS headers. These responses also have `X-Request-Id`.

`TRACE` (on every path) and other methods that are not `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` or `OPTIONS` (on `/api` paths, for example `PROPFIND`) never reach a route handler: Next.js cannot pass them to a route. The method guard (`src/server/method-guard.ts`, installed by `src/instrumentation.ts`) answers them before Next.js. The answer is **405** `METHOD_NOT_ALLOWED` in the API envelope with the `Allow` header of the route (`POST` for the data and token endpoints, `GET, HEAD` for the health probe, the docs and pages), or **404** `NOT_FOUND` for an `/api` path that has no route. The answer has the security headers of section 10 and `X-Request-Id`. The request is never repeated in the body. `TRACK` and `CONNECT` never reach the app: Node.js refuses them (400, or the connection closes). The reverse proxy in front of the app must also refuse `TRACE` (defence in depth).

Every other path under `/api/`, and `/api` itself, returns a JSON **404** `NOT_FOUND` for every method. A path with a trailing slash (for example `/api/` or `/api/v1/health/`) gets a Next.js **308** redirect to the path without the slash.

## 3. Authentication

The API uses **OAuth2 client credentials** (RFC 6749 section 4.4) with short-lived **JWT bearer tokens** (RFC 6750). This is the same scheme as the Other Scheme API.

1. The client system gets a `client_id` and a `client_secret` (one pair for each client system, for example SAP Commerce production and SFA production).
2. The client system sends them to `POST /api/v1/auth/token` and gets an access token.
3. The client system sends `Authorization: Bearer <access_token>` on each `POST /api/v1/dealer-scheme-status` (and `POST /api/v1/dealer-reward-choice`) call.
4. The client system reuses the token until it expires (`expires_in`, default 3,600 s). It gets a new token shortly before the expiry, or after a 401 with `Token expired`.

To stop a client before its tokens expire, change the configuration and restart the server. The server checks the configuration on each call:

- Remove the `client_id` from `AUTH_CLIENTS`: all its tokens get 401 at once.
- Remove the `client_id` from `AUTH_WRITE_CLIENTS`: its write calls get 403 `INSUFFICIENT_SCOPE` at once. Its read calls continue to work (section 13.1).

### 3.1 Token request

`POST /api/v1/auth/token`. Send the parameters form-encoded (`application/x-www-form-urlencoded`, RFC 6749) or as a JSON object of strings (`application/json`).

| Parameter | Required | Rule |
|---|---|---|
| `grant_type` | yes | Must be `client_credentials`. |
| `client_id`, `client_secret` | yes | In HTTP Basic auth (`Authorization: Basic base64(client_id:client_secret)`) **or** in the body. Not in both. |
| `scope` | no | Empty = all scopes that the client may use. Or a space-separated list of `schemes:read` and `choices:write`. Only a client in `AUTH_WRITE_CLIENTS` may get `choices:write` (section 13.1). |

Each parameter must come only one time. The body must be valid UTF-8 and 8 KB or smaller.

```
curl -s -X POST https://<app-host>/api/v1/auth/token \
  -d 'grant_type=client_credentials&client_id=<client_id>&client_secret=<client_secret>'
```

Response 200:

```json
{ "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…", "token_type": "Bearer", "expires_in": 3600, "scope": "schemes:read" }
```

`scope` in the response gives the granted scopes. A client in `AUTH_WRITE_CLIENTS` that sends no `scope` gets `"schemes:read choices:write"`.

Errors of the token endpoint use the RFC 6749 format `{"error": "...", "error_description": "..."}`. Every response has `Cache-Control: no-store` and `Pragma: no-cache`.

| HTTP | `error` | When |
|---|---|---|
| 400 | `invalid_request` | `Content-Type` is not form or JSON; the body does not parse; a parameter is sent more than one time; not valid UTF-8; `grant_type` is missing; credentials in Basic auth and in the body. |
| 400 | `unsupported_grant_type` | `grant_type` is not `client_credentials`. |
| 400 | `invalid_scope` | `scope` has a value that is not `schemes:read` or `choices:write`, or asks for `choices:write` for a client that is not in `AUTH_WRITE_CLIENTS`. |
| 401 | `invalid_client` | Wrong, missing or malformed client credentials. The response has `WWW-Authenticate: Basic realm="scheme-calculator"` only when the request sent an `Authorization` header (HTTP Basic, RFC 6749 section 5.2). With the credentials in the body, there is no challenge, so a browser (for example Swagger UI) opens no sign-in dialog. The description is always `Client authentication failed`. |
| 405 | `invalid_request` | Method is not `POST`. |
| 413 | `invalid_request` | Body larger than 8 KB. |
| 429 | `rate_limited` | Too many token requests from this IP (section 8). `Retry-After` is set. |
| 503 | `temporarily_unavailable` | The auth settings of the server are refused (section 3.4). |

### 3.2 Access token

- The token is a JWT signed with HS256 and `JWT_SECRET`.
- Claims: `iss` = `aud` = `scheme-calculator`, `sub` = `client_id`, `scope` = the granted scopes (space-separated), `iat` = `nbf` = issue time, `exp` = `iat` + `JWT_TTL_SECONDS`, `jti` = 32 random hex characters.
- The server checks: algorithm HS256 only (also no `alg: none`), signature, `iss`, `aud`, all 7 claims present, `exp` and `nbf` with 30 s of clock skew, and the scope. The check needs no database and no Redis call.
- The `sub` client must still be in `AUTH_CLIENTS`. When you remove a client, its tokens stop at once.

Errors of the data endpoint:

| Case | HTTP | `code` | `message` | `WWW-Authenticate` |
|---|---|---|---|---|
| No `Authorization` header, or not `Bearer` | 401 | `UNAUTHORIZED` | `Not authenticated` | `Bearer realm="scheme-calculator"` |
| Token expired | 401 | `UNAUTHORIZED` | `Token expired` | `Bearer realm="scheme-calculator", error="invalid_token", error_description="Token expired"` |
| Any other token problem | 401 | `UNAUTHORIZED` | `Invalid token` | `Bearer realm="scheme-calculator", error="invalid_token", error_description="Invalid token"` |
| Token without the scope of the endpoint (`schemes:read` for the status, `choices:write` for the reward choice) | 403 | `INSUFFICIENT_SCOPE` | `Insufficient scope` | `Bearer realm="scheme-calculator", error="insufficient_scope", scope="<the scope>"` |

### 3.3 Make a client and a signing key

1. Run `npm run auth:client -- <client_id>`. Example: `npm run auth:client -- sfa-prod`. `client_id`: 1 to 64 letters, digits, `.`, `_` or `-`.
2. The script prints the `client_secret` one time. Give the secret to the client system through a secure channel. Do not store it in the repository.
3. Merge the printed entry `{"<client_id>":"<sha256_hex>"}` into the JSON of `AUTH_CLIENTS`. The server stores only the SHA-256 hash of each secret. It compares in constant time, also for an unknown `client_id`.
4. Run `npm run auth:jwt-secret` one time for each environment. Put the value in `JWT_SECRET`.
5. Restart the app, or deploy with the new environment.

Rotate the signing key with no downtime:

1. Move the value of `JWT_SECRET` to `JWT_PREVIOUS_SECRET`.
2. Set a new `JWT_SECRET`. Restart.
3. After `JWT_TTL_SECONDS`, remove `JWT_PREVIOUS_SECRET`. Restart.

Rotate a client secret: make a second client (new `client_id`), change the client system to it, then remove the old entry from `AUTH_CLIENTS`.

### 3.4 Startup rules

`APP_ENV` (`local`, `dev`, `uat` or `prod`) controls the rules. The server checks them when it starts (`src/instrumentation.ts`).

1. `APP_ENV` is not set and there are no auth settings: the server does not start.
2. `APP_ENV` is not `local`, or an auth setting is given: `AUTH_CLIENTS` and `JWT_SECRET` must be set and valid (`JWT_SECRET` and `JWT_PREVIOUS_SECRET` at least 32 characters, `JWT_TTL_SECONDS` 60 to 86,400). Outside `local`, the example client and key of `.env.example` are refused, also when the example key is in `JWT_PREVIOUS_SECRET`. If a rule fails, the server writes the reason and does not start.
3. `APP_ENV=local` and no auth settings: auth is **off** (a warning is written). Every caller passes. Use this only on a developer machine.

Outside `local`, the server also writes a warning when `TRUSTED_PROXY_HOPS` is 0, and a warning when it is 1 or more (the app port must accept connections only from the trusted proxies). Outside `local`, it also writes a warning when `REDIS_URL` has no TLS (`redis://`) or no password. A `REDIS_URL` that is not `redis://` or `rediss://` stops the server (the message does not show the URL). See section 8.

The route handlers apply the same rules. If the rules fail, every API request gets 503 `API_DISABLED`.

## 4. Request

`POST /api/v1/dealer-scheme-status`, `Content-Type: application/json`. Maximum body size: 8 KB (8,192 bytes).

| Field | Type | Required | Rules |
|---|---|---|---|
| `dealer_code` | string | yes | Dealer code (SAP customer code). The server removes spaces at the start and the end. Then 1 to 32 characters: letters, digits, `_` and `-`. |
| `scheme_tags` | array of string | yes | 1 to 10 items. Each item: a non-empty string (spaces at the start and the end are removed), 32 characters or fewer, no control characters. Items must be unique. Each tag must be an **active** scheme in the scheme table. Tags are case-sensitive. |

The server ignores other fields in the body.

```json
{ "dealer_code": "DEMO0001", "scheme_tags": ["FB-PAN", "FB-TNHPJK", "SP-Q3"] }
```

Order of checks: settings (503 `API_DISABLED`) → rate limit for each client IP (429) → declared body size (413) → token (401 / 403) → rate limit for each client (429) → `Content-Type` (400) → streamed body size (413) → JSON and fields (400) → response cache (when on) → scheme tags (400) → dealer (404) → 200.

## 5. Response 200

The body is a `StatusResponse` object. There is **no wrapper** (no Frappe `message`).

### 5.1 StatusResponse

| Field | Type | Always present | Meaning |
|---|---|---|---|
| `dealer_code` | string | yes | The dealer of the result. For a **child dealer**, this is the **parent code** (section 9). |
| `dealer_name` | string or null | yes | Name from the dealer master. Null when the dealer is not in the master. |
| `data_as_of` | string (date-time, IST offset `+05:30`) or null | yes | Time of the sales data load that the result uses. Null when no data load exists. |
| `schemes` | array of `SchemeStatus` | yes | One item for each requested tag, **in the same order as `scheme_tags`**. |

### 5.2 SchemeStatus

| Field | Type | When present | Meaning |
|---|---|---|---|
| `scheme_tag` | string | always | |
| `participation` | `IN_SCHEME` \| `NOT_IN_SCOPE` | always | `NOT_IN_SCOPE`: only `reason_code` and `reason` follow. |
| `reason_code` | string | `NOT_IN_SCOPE`; `IN_SCHEME` with no slab or with OD | See section 5.7. |
| `reason` | string | same as `reason_code` | Text for the dealer. |
| `header` | `Header` | `IN_SCHEME` | |
| `provisional` | boolean | `IN_SCHEME` | True until `final_on`. |
| `final_on` | date | `IN_SCHEME` | After this date the result is final (OD check and return window are closed). |
| `current_slab` | string or null | `IN_SCHEME` | Highest unlocked slab, for example `Slab 1`. Null = no slab. |
| `current_slab_no` | integer or null | `IN_SCHEME` | Number of `current_slab`. |
| `benefit_blocked` | boolean | `IN_SCHEME` | True when an overdue amount (OD) on the check date blocks the benefit. `reason` then says "Dealer has an overdue amount on <date>. No benefit is given." |
| `od_status` | `NO_OD` \| `OD` \| `PENDING` | `IN_SCHEME` | `PENDING`: OD data is not available yet. |
| `details` | array of `SlabStatus` | `IN_SCHEME` | All slabs of the scheme, in slab order. |
| `extra_benefits` | array of `ExtraBenefit` | Star Points, `IN_SCHEME` | Extra benefit above Slab 6 and Slab 7, one item for each destination rule. Only one rule applies (the chosen destination). Do not add them. Section 13.5 gives the paid amount. |
| `reward_choice` | `RewardChoice` or null | `IN_SCHEME` | The saved reward choice of the dealer (section 13.3). Null = not chosen. Added 22-10-2026. |

### 5.3 Header and metrics

`Header`: `scheme_name` (string), `from_date` (date), `to_date` (date), `q1_monthly_avg_gsr` (number, INR: Q1 FY 2026-27 GSR ÷ 3), `metrics` (array of `Metric`).

`Metric`: `key` (string), `label` (string), `value` (number or null), `unit` (`INR` \| `PERCENT` \| `POINTS`). `value` is null for `growth_pct` when the Q1 base is zero.

| Scheme | Metric keys, in display order |
|---|---|
| Festive Bonanza (FB-PAN, FB-TNHPJK) | `oct_gsr`, `nov_gsr`, `period_gsr`, `growth_pct`, `growth_gsr_required` and `growth_gsr_needed` (FB-PAN only, not when the Q1 base is zero), `mrv_total` (only when not zero) |
| Star Points (SP-Q3) | `oct_gsr`, `nov_gsr`, `dec_gsr`, `q3_gsr`, `growth_pct`, `growth_gsr_required` and `growth_gsr_needed` (not when the Q1 base is zero), `points_earned`, `points_luxury`, `points_premium`, `points_economy`, `points_enamels`, `points_others`, `points_tools`, `mrv_total` (only when not zero) |

`growth_gsr_required` (INR) is the period GSR total that meets the Slab 1 growth %. `growth_gsr_needed` (INR) is the period GSR that the dealer still needs to meet the Slab 1 growth % (Star Points: Q3 GSR, 10%. FB-PAN: Oct + Nov GSR, 20%). It is 0 when the growth is met. Months not billed yet count as 0, so before the period ends `growth_pct` alone looks low. `growth_pct` does not change: it is still returned and shown. Added 23-10-2026 (Star Points), and the same day for FB-PAN.

The client must read metrics by `key`, not by position. New keys can come in a later version.

### 5.4 SlabStatus

| Field | Type | Meaning |
|---|---|---|
| `slab` | string | For example `Slab 1`. |
| `slab_no` | integer | Configured slab number. |
| `lock_status` | `UNLOCKED` \| `LOCKED` | `UNLOCKED` only for the slab that the dealer is in (`current_slab_no`). All other slabs, also the lower slabs, are `LOCKED` (CLAUDE.md section 6, changed 22-10-2026). |
| `gift` | `{ description: string, value: number or null }` | `value` is null for trips. |
| `cn_alternative` | number | Credit note in INR in place of the gift. |
| `conditions` | array of `Condition` | All conditions of the slab. |

### 5.5 Condition

`key` (string), `label` (string), `required` (number), `actual` (number or null), `met` (boolean).

| Scheme | Condition keys |
|---|---|
| Festive Bonanza FB-PAN | `period_gsr`, `min_first_month_gsr`, `growth_pct` |
| Festive Bonanza FB-TNHPJK (TNN, TNS, HP & JK) | `period_gsr`, `min_first_month_gsr` |
| Star Points SP-Q3 | `points`, `growth_pct` |

`required` and `actual` for `growth_pct` are percent values (20 = 20%). `actual` is null when the Q1 base is zero.

### 5.6 ExtraBenefit (Star Points)

`description` (string), `destination` (`CRUISE` \| `OVERSEAS` \| null; added 22-10-2026, missing in results stored before the next engine run), `extra_tickets` (integer), `extra_ticket_cn_value` (number, INR: the CN in place of the extra tickets), `cn_option_value` (number, INR: ₹18,500 for every 26,000 points). Circular SP p2: the extra tickets (or their CN) **or** the CN option; only one destination.

### 5.7 Reason codes

| Code | `participation` | Meaning |
|---|---|---|
| `REGION_NOT_IN_SCOPE` | `NOT_IN_SCOPE` | The dealer region is not in the scope of the scheme. |
| `REGION_UNKNOWN` | `NOT_IN_SCOPE` | The dealer region is not known. The scheme applies only to some regions. |
| `ENROLLED_IN_OTHER_SCHEME` | `NOT_IN_SCOPE` | The dealer joined another scheme of the group (Festive Bonanza or Star Points, not both). |
| `NO_DATA` | `NOT_IN_SCOPE` | No stored result for this dealer in this scheme. |
| `SLAB1_PERIOD_GSR_NOT_MET`, `SLAB1_MIN_FIRST_MONTH_GSR_NOT_MET`, `SLAB1_GROWTH_NOT_MET`, `SLAB1_POINTS_NOT_MET` | `IN_SCHEME` | No slab. The code is the first failed Slab 1 condition. |
| `OD_ON_CHECK_DATE` | `IN_SCHEME` | Outstanding on the check date blocks the benefit. |

## 6. Example (real response, local database, dealer DEMO0001, 16-10-2026)

Request:

```json
{ "dealer_code": "DEMO0001", "scheme_tags": ["FB-PAN", "FB-TNHPJK"] }
```

Response 200. FB-PAN is `IN_SCHEME` (all 7 slabs). FB-TNHPJK is `NOT_IN_SCOPE`. The order of the keys in an object can be different in the real response. JSON does not use the key order.

```json
{
  "dealer_code": "DEMO0001",
  "dealer_name": "Demo Dealer 01 FB-PAN circular example (Slab 1)",
  "data_as_of": "2026-10-15T00:00:00+05:30",
  "schemes": [
    {
      "scheme_tag": "FB-PAN",
      "participation": "IN_SCHEME",
      "header": {
        "scheme_name": "Festive Bonanza Oct-Nov'26 (Pan India except TNN, TNS, HP & JK)",
        "from_date": "2026-10-01",
        "to_date": "2026-11-30",
        "q1_monthly_avg_gsr": 150000,
        "metrics": [
          {"key": "oct_gsr", "label": "Oct'26 GSR", "value": 160000, "unit": "INR"},
          {"key": "nov_gsr", "label": "Nov'26 GSR", "value": 200000, "unit": "INR"},
          {"key": "period_gsr", "label": "GSR Oct + Nov'26", "value": 360000, "unit": "INR"},
          {"key": "growth_pct", "label": "Growth", "value": 20, "unit": "PERCENT"}
        ]
      },
      "provisional": true,
      "final_on": "2026-12-31",
      "current_slab": "Slab 1",
      "current_slab_no": 1,
      "benefit_blocked": false,
      "od_status": "PENDING",
      "details": [
        {
          "slab": "Slab 1", "slab_no": 1, "lock_status": "UNLOCKED",
          "gift": {"description": "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", "value": 5000}, "cn_alternative": 4500,
          "conditions": [
            {"key": "period_gsr", "label": "GSR Oct + Nov'26", "required": 250000, "actual": 360000, "met": true},
            {"key": "min_first_month_gsr", "label": "Min GSR in Oct'26", "required": 100000, "actual": 160000, "met": true},
            {"key": "growth_pct", "label": "Growth over Q1 monthly avg", "required": 20, "actual": 20, "met": true}
          ]
        },
        {
          "slab": "Slab 2", "slab_no": 2, "lock_status": "LOCKED",
          "gift": {"description": "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", "value": 8000}, "cn_alternative": 7200,
          "conditions": [
            {"key": "period_gsr", "label": "GSR Oct + Nov'26", "required": 400000, "actual": 360000, "met": false},
            {"key": "min_first_month_gsr", "label": "Min GSR in Oct'26", "required": 150000, "actual": 160000, "met": true},
            {"key": "growth_pct", "label": "Growth over Q1 monthly avg", "required": 20, "actual": 20, "met": true}
          ]
        },
        {
          "slab": "Slab 3", "slab_no": 3, "lock_status": "LOCKED",
          "gift": {"description": "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", "value": 12000}, "cn_alternative": 10800,
          "conditions": [
            {"key": "period_gsr", "label": "GSR Oct + Nov'26", "required": 600000, "actual": 360000, "met": false},
            {"key": "min_first_month_gsr", "label": "Min GSR in Oct'26", "required": 250000, "actual": 160000, "met": false},
            {"key": "growth_pct", "label": "Growth over Q1 monthly avg", "required": 15, "actual": 20, "met": true}
          ]
        },
        {
          "slab": "Slab 4", "slab_no": 4, "lock_status": "LOCKED",
          "gift": {"description": "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", "value": 18000}, "cn_alternative": 16200,
          "conditions": [
            {"key": "period_gsr", "label": "GSR Oct + Nov'26", "required": 800000, "actual": 360000, "met": false},
            {"key": "min_first_month_gsr", "label": "Min GSR in Oct'26", "required": 300000, "actual": 160000, "met": false},
            {"key": "growth_pct", "label": "Growth over Q1 monthly avg", "required": 15, "actual": 20, "met": true}
          ]
        },
        {
          "slab": "Slab 5", "slab_no": 5, "lock_status": "LOCKED",
          "gift": {"description": "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", "value": 24000}, "cn_alternative": 21600,
          "conditions": [
            {"key": "period_gsr", "label": "GSR Oct + Nov'26", "required": 1000000, "actual": 360000, "met": false},
            {"key": "min_first_month_gsr", "label": "Min GSR in Oct'26", "required": 400000, "actual": 160000, "met": false},
            {"key": "growth_pct", "label": "Growth over Q1 monthly avg", "required": 15, "actual": 20, "met": true}
          ]
        },
        {
          "slab": "Slab 6", "slab_no": 6, "lock_status": "LOCKED",
          "gift": {"description": "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", "value": 30000}, "cn_alternative": 27000,
          "conditions": [
            {"key": "period_gsr", "label": "GSR Oct + Nov'26", "required": 1200000, "actual": 360000, "met": false},
            {"key": "min_first_month_gsr", "label": "Min GSR in Oct'26", "required": 500000, "actual": 160000, "met": false},
            {"key": "growth_pct", "label": "Growth over Q1 monthly avg", "required": 10, "actual": 20, "met": true}
          ]
        },
        {
          "slab": "Slab 7", "slab_no": 7, "lock_status": "LOCKED",
          "gift": {"description": "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", "value": 40000}, "cn_alternative": 36000,
          "conditions": [
            {"key": "period_gsr", "label": "GSR Oct + Nov'26", "required": 1500000, "actual": 360000, "met": false},
            {"key": "min_first_month_gsr", "label": "Min GSR in Oct'26", "required": 600000, "actual": 160000, "met": false},
            {"key": "growth_pct", "label": "Growth over Q1 monthly avg", "required": 10, "actual": 20, "met": true}
          ]
        }
      ]
    },
    {"scheme_tag": "FB-TNHPJK", "participation": "NOT_IN_SCOPE", "reason_code": "REGION_NOT_IN_SCOPE", "reason": "Dealer region is not in the scope of this scheme."}
  ]
}
```

`NOT_IN_SCOPE` examples from the same database:

```json
{"scheme_tag": "FB-TNHPJK", "participation": "NOT_IN_SCOPE", "reason_code": "REGION_NOT_IN_SCOPE", "reason": "Dealer region is not in the scope of this scheme."}
{"scheme_tag": "SP-Q3", "participation": "NOT_IN_SCOPE", "reason_code": "NO_DATA", "reason": "No sales data for this dealer in this scheme."}
```

## 7. Errors

Every error body of the data endpoint (and of the 404 for unknown paths) has this form. Both fields are always present. The token endpoint uses the RFC 6749 format (section 3.1).

```json
{ "error": { "code": "UNKNOWN_SCHEME_TAG", "message": "Scheme tag ABC9 does not exist." } }
```

| HTTP | `code` | When | Example `message` |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | `Content-Type` is not `application/json`; JSON not valid; body not an object; `dealer_code` missing, empty, longer than 32 characters or with characters that are not allowed; `scheme_tags` missing, empty, more than 10 items, an item that is not a string, empty, too long or a duplicate. The message never repeats the input value. | `scheme_tags must have 10 items or fewer.` |
| 400 | `UNKNOWN_SCHEME_TAG` | A tag is not an active scheme. The server checks the tags before the dealer. The message names the first unknown tag only when the tag matches `^[A-Za-z0-9_-]{1,32}$`. For any other tag, the message is `A scheme tag does not exist.`: the server does not repeat the input. | `Scheme tag ABC9 does not exist.` |
| 401 | `UNAUTHORIZED` | Token missing, not valid or expired (section 3.2). The response has `WWW-Authenticate: Bearer …`. | `Not authenticated` / `Invalid token` / `Token expired` |
| 403 | `INSUFFICIENT_SCOPE` | Valid token without the scope of the endpoint (`schemes:read`, or `choices:write` for the reward choice). | `Insufficient scope` |
| 404 | `DEALER_NOT_FOUND` | The dealer code is in neither the dealer master nor the stored results. | `Dealer D99999 does not exist.` |
| 404 | `NOT_FOUND` | No API route has this path. | `Not found.` |
| 409 | `CHOICE_NOT_ALLOWED` | Reward choice only (section 13): the dealer is not in the scheme or not in a slab, or a destination is sent where the dealer has no destination choice. | `The dealer has not reached a slab in this scheme yet.` |
| 405 | `METHOD_NOT_ALLOWED` | Method is not `POST` (also `TRACE` and other methods that Next.js cannot pass to a route, section 2). The response has `Allow: POST`. | `Method not allowed. Use POST.` |
| 413 | `PAYLOAD_TOO_LARGE` | Body larger than 8 KB: declared `Content-Length` (checked before the token), or a streamed (chunked) body. | `The request body must be 8192 bytes or smaller.` |
| 429 | `RATE_LIMITED` | A rate limit is used (section 8). The response has `Retry-After` (seconds). | `Too many requests. Wait and try again.` |
| 500 | `INTERNAL_ERROR` | An unexpected server error. The body has no detail. The server log has the detail and the request ID on the same line. | `Internal error. Try again later.` |
| 503 | `SERVICE_BUSY` | No free database connection within `DATABASE_POOL_TIMEOUT_MS` (default 5 s), or the database refuses the connection. The response has `Retry-After: 2`. | `Service busy. Try again in a few seconds.` |
| 503 | `API_DISABLED` | The auth settings of the server are refused (section 3.4). | `The API is not enabled on this server.` |

The client must use `code` for its logic. The `message` text can change.

Retry advice: retry 429 after `Retry-After` seconds. Retry 503 `SERVICE_BUSY` after `Retry-After` seconds. Retry 500 one time. For 401 `Token expired`, get a new token and retry one time. Do not retry other 4xx.

## 8. Limits, rate limit, caching and freshness

| Item | Value |
|---|---|
| Body size | 8 KB maximum (413). |
| Tags in one request | 1 to 10. |
| Rate limit for each client IP | `RATE_LIMIT_PER_SECOND` (default 2,500) requests a second, on every `/api/` path except the health probe. Checked before the token and before the body is read. |
| Token endpoint limit | `TOKEN_RATE_LIMIT_PER_MINUTE` (default 30) token requests a minute for each client IP, in addition to the limit above. A client needs one token an hour. |
| Rate limit for each client | `API_RATE_LIMIT_PER_MINUTE` (default 1,00,000, that is 100,000; 1 to 10,000,000) requests a minute for each `client_id`, after the token check (decision Q5, Mayur, 18-10-2026). Every authenticated request counts, also a request that gets 400 or 404. With auth off, all callers share one bucket. |
| Windows | Fixed windows (one second or one minute). `Retry-After` gives the seconds to the end of the window. `RATE_LIMIT_ENABLED=false` turns all three limits off. |
| Rate-limit store | Redis (`REDIS_URL`), so that the limits hold across processes and servers. Key `scheme:rate[:token|:client]:<key>:<window>`, with an expiry. `REDIS_URL` is `redis://[[user]:password@]host[:port][/db]` (no TLS) or `rediss://[[user]:password@]host[:port][/db]` (TLS); special characters in the password are percent-encoded. Any other value stops the server at startup. The URL and the password are never written to a log. In production, the client's DevOps team provides Redis (decision Q7). Use `rediss://` and a password when Redis is not on a private network. TLS or not is still open (DevOps). Outside `local`, the server writes a startup warning when `REDIS_URL` has no TLS or no password. If `REDIS_URL` is not set, or Redis fails or takes more than 100 ms, each process counts in memory (with N processes, a client can make up to N × the limit). After a Redis failure, the server does not try Redis again for 30 s. The server opens the Redis connections when it starts. A connection that is still in progress is not a failure: the request waits for it, at most 500 ms (rate limits) or 1 s (cache). |
| Client IP | The N-th entry from the right of `X-Forwarded-For`, where N = `TRUSTED_PROXY_HOPS` (the number of reverse proxies in front of the app). With 0, the header is not trusted and **all callers share one bucket** (also for the token limit of 30 a minute). So one caller that sends many bad token requests can block token issue for all clients for up to one minute. Set the right value in each environment. The value is still open (Q6, waiting for DevOps). The other Acme API has nginx in front of it on Dev, so the likely value is 1 (nginx only). An entry that is not an IP address goes to the shared bucket. **When `TRUSTED_PROXY_HOPS` is 1 or more, the app port must accept connections only from the trusted proxies (firewall or private network).** The app cannot see the socket peer. A caller that reaches the app port directly can set `X-Forwarded-For` and get a new bucket for each request. The server writes a warning about this at startup outside `local`. |
| Response cache | Optional: on only when `CACHE_ENABLED=true` and `REDIS_URL` is set. The server keeps the answers 200, 404 `DEALER_NOT_FOUND` and 400 `UNKNOWN_SCHEME_TAG` in Redis for `CACHE_TTL_SECONDS` (default 900). The key has the data version, the dealer code and the tags in request order. Other errors are not cached. |
| `X-Cache` | Only when the cache is on: `HIT` (from Redis, no database call), `MISS` (from the database, now cached) or `BYPASS` (Redis not available or too slow, more than 250 ms; answered from the database; Redis is not tried again for 30 s). |
| Cache freshness | Each engine run (`npm run engine:run`, `npm run sync:bigquery`, `npm run data:demo`), each `npm run db:seed` and each saved reward choice change (iframe, admin upload or API, section 13) increases the data version in Redis (`scheme:data-version`) after the commit. The cache key prefix is `scheme:v2` (v2: `reward_choice` in the response, 22-10-2026). Each server process reads the version again at most every 5 s. So a new result is served at most 5 s after the engine run. Old entries expire after the TTL. |
| HTTP caching | Every response has `Cache-Control: no-store`. Do not cache in a proxy. |
| Idempotency | The status request is read-only. The client can send it again with no side effect. The method is `POST` only because the request has a JSON body. The reward choice request is idempotent: the same values again write nothing (`changed: false`). |
| Request ID | Every API response has `X-Request-Id` (also 405, 429 and `OPTIONS`). Give this value to support with a problem report. |
| Data freshness | The results change only after a data load (BigQuery sync and engine run). `data_as_of` gives the time of that load. Calls between two loads return the same result. |
| Provisional result | `provisional: true` until `final_on`. Material returns up to 1 month after the scheme end date and the OD check can still change the result. |

## 9. Child and parent dealers

- Sales of a child dealer roll up to the parent (`Testdb.parent_child`).
- A request with a child code returns the **parent's** result. `dealer_code` and `dealer_name` in the response are the parent's.
- Example (local database): request `DEMO-C1` → response `dealer_code: "DEMO0010"`.
- The iframe does the same.

## 10. Security

- Server-to-server only. Keep the client secret and the token on the client system's server. Never put them in a browser, a mobile app or a URL.
- Use HTTPS only (the hosting terminates TLS).
- No CORS headers. `OPTIONS` sends no `Access-Control-*` header.
- Response headers on every API response (also errors, 413 and 429): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. Each header appears one time. The Swagger UI page (`/api/docs`) has its own CSP that allows only the pinned Swagger UI release and its one start script.
- Known gap: the Next.js 308 trailing-slash redirect has none of these headers.
- The Next.js proxy (`src/proxy.ts`) does not run for `/api/*`. When a proxy runs, Next.js copies the full request body (up to 10 MB) into memory before the route can reject the request. Each route handler starts with the API pipeline (`src/server/api/pipeline.ts`): settings, rate limit by IP, declared body size. `next.config.ts` (`headers()`) sets the security headers for `/api/*` as a second layer.
- Error bodies never contain a stack trace, SQL or the input value.
- Log: one JSON line for each request: `api_request` (`request_id`, `client_id`, `status`, `code`, `tags` (count), `dealer_code`, `duration_ms`, `cache`), or `token_issued` / `token_refused` for the token endpoint. A 5xx line also has `error` (the error detail, at most 300 characters) and goes to stderr. The log never has the client secret, a token, a hash or the body. A Redis failure writes one `redis_unavailable` line for each Redis user (`rate-limit`, `rate-limit:token`, `rate-limit:client`, `response-cache`) only when the state changes from up to down, so at most one line every 30 s for each user. Requests that were in flight at that time write no line. An answer of the method guard (section 2) writes an `api_request` line with `method`.
- Brute force on client secrets is not practical (256-bit random secrets). The token endpoint limit (30 a minute for each IP) also slows it down.

## 11. Example calls

curl:

```
TOKEN=$(curl -s -X POST https://<app-host>/api/v1/auth/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" -d grant_type=client_credentials | jq -r .access_token)
curl -s https://<app-host>/api/v1/dealer-scheme-status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dealer_code":"DEMO0001","scheme_tags":["FB-PAN","FB-TNHPJK","SP-Q3"]}'
```

Node.js (server side), with token reuse and one retry after `Token expired`:

```js
let token = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token; // reuse until 60 s before expiry
  const res = await fetch("https://<app-host>/api/v1/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SCHEME_CLIENT_ID,
      client_secret: process.env.SCHEME_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status}`);
  const body = await res.json();
  token = body.access_token;
  tokenExpiresAt = Date.now() + body.expires_in * 1000;
  return token;
}

async function dealerStatus(dealerCode, schemeTags, retried = false) {
  const res = await fetch("https://<app-host>/api/v1/dealer-scheme-status", {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dealer_code: dealerCode, scheme_tags: schemeTags }),
  });
  if (res.status === 401 && !retried) {
    token = null; // expired or revoked: get a new token one time
    return dealerStatus(dealerCode, schemeTags, true);
  }
  if (res.status === 429 || res.status === 503) {
    // wait Number(res.headers.get("Retry-After")) seconds, then try again
  }
  return res.json(); // 200: StatusResponse; other: { error: { code, message } }
}
```

## 12. Changes from the Frappe draft

The draft was `dealer-scheme-status-api.yaml` v1.0.0-draft (written for Frappe). The built API keeps its semantics. These items changed:

| Area | Frappe draft | Built API |
|---|---|---|
| Path | `POST /api/method/dealer_scheme.api.get_dealer_scheme_status` | `POST /api/v1/dealer-scheme-status` |
| Wrapper | `{ "message": StatusResponse }` | No wrapper. The body is `StatusResponse`. |
| Authentication | `Authorization: token <api_key>:<api_secret>` | OAuth2 client credentials: `POST /api/v1/auth/token`, then `Authorization: Bearer <JWT>`. Only secret hashes on the server. |
| Error codes | 5 codes | Also `INSUFFICIENT_SCOPE` (403), `NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `PAYLOAD_TOO_LARGE` (413), `INTERNAL_ERROR` (500), `SERVICE_BUSY` (503) and `API_DISABLED` (503). Duplicate tags give `INVALID_REQUEST`. |
| `dealer_code` in the response | The requested code | The parent code for a child dealer. |
| New fields | – | `dealer_name`, `slab_no`, `current_slab_no`, `reason_code`, `benefit_blocked`, `od_status`, `extra_benefits`. `reason` is also set for `IN_SCHEME` with no slab or with OD. |
| Nullable values | – | `data_as_of`, `Metric.value` and `Condition.actual` can be null. |
| Header metric keys | FB: `oct_gsr`, `nov_gsr`, `growth_pct`. SP: also `dec_gsr`, `points_earned`. | All draft keys are present. More keys (section 5.3). |
| Labels and gift text | `Oct26 GSR`, `Gold Voucher` | `Oct'26 GSR`, `Gold Voucher (Jeweller A / Jeweller B / reputed brand)` (circular text). |
| Health probe | – | `GET` and `HEAD /api/v1/health`. |

### 12.1 Changes on the phase 2 branch (17-10-2026)

The first version of this branch used static API keys (`API_KEYS`) and an in-memory limit. To match the Other Scheme API, these items changed. The branch is not released, so no client is affected.

| Area | Before | Now |
|---|---|---|
| Authentication | `Authorization: Bearer <api_key>`, env `API_KEYS`, `npm run api:key` | OAuth2 client credentials and JWT (section 3), env `AUTH_CLIENTS` and `JWT_SECRET`, `npm run auth:client` and `npm run auth:jwt-secret`. |
| Settings | `API_KEYS` empty = 503 at request time | Startup rules with `APP_ENV` (section 3.4). |
| Body larger than 8 KB | 400 `INVALID_REQUEST` | 413 `PAYLOAD_TOO_LARGE`. |
| Rate limit | 600 a minute for each client, in memory | 1,00,000 a minute for each client (decision Q5, 18-10-2026). Also by client IP (2,500 a second) and on the token endpoint (30 a minute). Counts in Redis (`redis://` or `rediss://`), memory as fallback. |
| Response cache | – | Optional Redis cache with `X-Cache` (section 8). |
| Security headers | nosniff, DENY, CSP `frame-ancestors`, `strict-origin-when-cross-origin` | The full set of section 10 (also HSTS, `Cross-Origin-Resource-Policy`, `Referrer-Policy: no-referrer`, `default-src 'none'`). |
| Database busy | 500 | 503 `SERVICE_BUSY` with `Retry-After: 2`. |
| Unknown `/api/` path | HTML 404 | JSON 404 `NOT_FOUND`, also for `/api` and `/api/` (QA-3). |
| `TRACE`, unknown methods | 500 `text/plain` (Next.js) or 400 with no body | 405 `METHOD_NOT_ALLOWED` JSON (or 404 `NOT_FOUND` on an `/api` path with no route), from the method guard (QA-1). |
| `UNKNOWN_SCHEME_TAG` message | Always named the tag | Names the tag only when it matches `^[A-Za-z0-9_-]{1,32}$` (QA-2). |
| API docs | `docs/openapi.json` only | Also `/api/v1/openapi.json` and Swagger UI at `/api/docs` (`DOCS_ENABLED`). |

### 12.2 Differences from the Other Scheme API (FastAPI reference)

Decisions (Mayur, 17-10-2026, CLAUDE.md decisions 12 and 13): Q1 (snake_case keys), Q2 (JWT names and scope), Q3 (error envelope), Q4 (contract changes, `OPTIONS` as now), Q10 (readiness probe) and Q11 (real dealer codes are replaced in tracked files only, no history rewrite) are decided. Decisions (Mayur, 18-10-2026, CLAUDE.md decision 14): Q5 (per-client limit 1,00,000 a minute), Q7 (Redis from the client's DevOps team; `redis://` and `rediss://` with a password are supported; TLS or not is still open for DevOps), Q8 (Dev `https://dev.scheme-calculator.example.com`; UAT and production follow the same pattern, hosts to be confirmed) and Q9 (Swagger UI on Dev and UAT, off in production) are decided. Q6 (`TRUSTED_PROXY_HOPS`) stays open: it waits for DevOps.

| Area | Other Scheme API | This API | Reason |
|---|---|---|---|
| Response keys | PascalCase | snake_case, the same object as the iframe | **Decided** (Mayur, 17-10-2026, Q1; CLAUDE.md decision 12): the keys stay snake_case. |
| Error body | `{"detail": "..."}` | `{"error": {"code", "message"}}` (the token endpoint keeps RFC 6749 `{error, error_description}`) | **Decided** (Mayur, 17-10-2026, Q3): the envelope stays. |
| JWT names | `iss`/`aud`/realm `other-scheme-api`, scope `schemes:read` | `iss`/`aud`/realm `scheme-calculator`, scope `schemes:read` | **Decided** (Mayur, 17-10-2026, Q2): the scope stays `schemes:read`, the issuer and the audience stay `scheme-calculator`. |
| Client IP | `TRUSTED_PROXIES` (CIDR list, socket peer address) | `TRUSTED_PROXY_HOPS` (hop count) | A Next.js route handler cannot read the socket peer address. With 1 or more hops, the app port must be reachable only through the proxies. With 0 hops, all callers share one bucket, so bad token requests from one caller can block token issue for all. The reference keys on the socket peer and does not have this lockout. **Open** (Q6, DevOps): the reference has nginx in front on Dev, so the likely value is 1. With 1 or more, the app port must accept connections only from the proxy. |
| Settings files | `.env.<APP_ENV>` | `.env` (Next.js loads it) | Next.js loads `.env` files itself. |
| Trailing slash | 404 | 308 redirect (without security headers) | `skipTrailingSlashRedirect` would change the iframe and admin pages too. |
| Health probe | Liveness only | Readiness (checks the database, value kept for 15 s) | **Decided** (Mayur, 17-10-2026, Q10): it stays a readiness probe. |
| `OPTIONS` | 405 | 204 with `Allow` | **Decided** (Mayur, 17-10-2026, Q4): keep `OPTIONS` as it is now. |
| Contract changes of section 12.1 | – | 413 for an oversized body, 403 `INSUFFICIENT_SCOPE`, 503 `SERVICE_BUSY`, JSON 404 `NOT_FOUND` | **Accepted** (Mayur, 17-10-2026, Q4). |
| Zero-padded JSON numbers | Accepted (`"month": 09`) | Not applicable | The request has no number fields. |
| OpenAPI | Generated by FastAPI | Hand-written, checked by `npm run openapi:check` | Next.js does not generate a spec. |
| Per-client limit | – | `API_RATE_LIMIT_PER_MINUTE` (default 1,00,000 a minute) | **Decided** (Mayur, 18-10-2026, Q5): 1,00,000 a minute for each client, not 600. |
| Environments | `https://dev.scheme-api.example.com` | `https://dev.scheme-calculator.example.com` | **Decided** (Mayur, 18-10-2026, Q8): same example pattern. UAT and production hosts to be confirmed. |
| Swagger UI | `/docs`, on in Dev | `/api/docs`, `DOCS_ENABLED` (code default: on only with `APP_ENV=local`) | **Decided** (Mayur, 18-10-2026, Q9): on in Dev and UAT, off in production unless asked. |
| Redis | – | `REDIS_URL` with `redis://` or `rediss://` and a password | **Decided** (Mayur, 18-10-2026, Q7): the client's DevOps team provides Redis. TLS or not is open (DevOps). |

### 12.3 Changes on 22-10-2026 (reward choice)

| Area | Before | Now |
|---|---|---|
| Endpoints | Read-only API | New `POST /api/v1/dealer-reward-choice` (section 13). |
| Scopes | `schemes:read` only | Also `choices:write`, only for clients in `AUTH_WRITE_CLIENTS`. A token request with no `scope` gets all scopes of the client. |
| `SchemeStatus` | – | New field `reward_choice` (`IN_SCHEME` only, null = not chosen). A client that ignores unknown fields is not affected. |
| `ExtraBenefit` | – | New field `destination` (`CRUISE` / `OVERSEAS`). Results stored before the next engine run do not have it. |
| Errors | – | New code `CHOICE_NOT_ALLOWED` (409). |
| Response cache | Key prefix `scheme:v1` | `scheme:v2`. A saved choice change increases the data version. |

### 12.4 Changes on 22-10-2026 (scheme tags, lock status, texts)

This change breaks callers that send the old tags. Tell the SFA / DMS teams before the deploy.

| Area | Before | Now |
|---|---|---|
| Scheme tags | `ABC1`, `ABC2`, `ABC3` | `FB-PAN` (Festive Bonanza Pan India except TNN, TNS, HP & JK), `FB-TNHPJK` (Festive Bonanza TNN, TNS, HP & JK), `SP-Q3` (Star Points Q3 FY 2026-27). Also in the reward choice API and upload. The old tags give 400 `UNKNOWN_SCHEME_TAG` (no alias). |
| `lock_status` | `UNLOCKED` for the dealer's slab and all lower slabs | `UNLOCKED` only for the dealer's slab (section 5.4). |
| Texts | Scheme names `Festive Bonanza Oct-Nov'26 - Pan India ...`, trip gifts `1 Ticket – 4N5D ...` | `Festive Bonanza Oct-Nov'26 (Pan India except TNN, TNS, HP & JK)`, `1 Ticket for 4N5D Island Cruise (or equivalent)`. A client must not match on these texts; use `scheme_tag` and `slab_no`. |

Deploy: `npm run db:migrate` (migration `0002_rename_scheme_tags` moves all stored rows to the new tags), restart the app, then `npm run db:seed` and `npm run engine:run`. The tags are in the code only (`SCHEME_TAGS`); the server ignores old `SCHEME_TAG_*` lines in its `.env`.

### 12.5 Changes on 22-10-2026 (iframe integration)

No change for existing callers. OpenAPI version 1.3.0.

| Area | Before | Now |
|---|---|---|
| Endpoints | The host signs the iframe token itself | New `POST /api/v1/embed-token` (section 14.2). The host can get the signed URL from the API and does not need `EMBED_SIGNING_SECRET`. Signing on the host stays possible (section 14.5). |
| Iframe height | Fixed height on the host page; the iframe scrolls inside | `/embed` sends its content height to the host page (`postMessage`, section 14.4). The host sets the iframe height, so there is no inner scroll bar. |

### 12.6 Changes on 23-10-2026 (growth gap: Star Points and FB-PAN)

No change for existing callers: one new header metric.

| Area | Before | Now |
|---|---|---|
| Star Points header | `growth_pct` only | Also `growth_gsr_required` (Q3 GSR that meets the Slab 1 growth %) and `growth_gsr_needed` (the GSR still needed for it) (section 5.3). The iframe shows them as header tiles. |
| FB-PAN header | `growth_pct` only | Also `growth_gsr_required` and `growth_gsr_needed` (Oct + Nov GSR that meets, and still needed for, the Slab 1 growth %, 20%). FB-TNHPJK has no growth condition and gets no new metric. `growth_pct` stays in both schemes. |

## 13. Reward choice (POST /api/v1/dealer-reward-choice)

Decisions (Mayur, 22-10-2026): Acme gives the dealers' choices to this application by Excel (admin upload) or by this API. Users of the admin area can also enter one choice on the dealer page. The iframe shows the saved choice and the final benefit; it does not change it. The choice is possible only after the dealer reaches a slab. The choice never locks: a new choice replaces the saved one. For Star Points, the destination (cruise or Overseas Tour) picks the extra-benefit rule above the top slab (section 13.5).

### 13.1 Access

- The token needs the scope `choices:write`. Add the `client_id` to `AUTH_WRITE_CLIENTS` (comma-separated). Each id must also be in `AUTH_CLIENTS`, or the server does not start. Empty = no client can write through the API.
- A token without `choices:write` gets 403 `INSUFFICIENT_SCOPE`.
- The server checks `AUTH_WRITE_CLIENTS` on each write call, not only when it issues the token. Remove a `client_id` from `AUTH_WRITE_CLIENTS` and restart the server: the write access of that client stops at once. Its tokens that were issued before still have `choices:write`, but a write call gets 403 `INSUFFICIENT_SCOPE`. The read scope `schemes:read` continues to work.
- The same limits as the status endpoint apply (section 8): 8 KB body, rate limit for each IP and for each client.

### 13.2 Request

`Content-Type: application/json`. One dealer and one scheme in each request.

| Field | Type | Required | Rules |
|---|---|---|---|
| `dealer_code` | string | yes | Same rule as section 4. A child code is saved under the parent code (section 9). |
| `scheme_tag` | string | yes | An active scheme tag. 1 to 32 letters, digits, `_` or `-`. |
| `choice` | string | yes | `GIFT` (the slab gift: gold voucher or trip) or `CN` (the slab CN alternative). Upper case. |
| `destination` | string or null | no | Star Points only: `CRUISE` or `OVERSEAS`, the destination of the extra tickets. Allowed only when the dealer can get extra tickets for both destinations (Slab 7). Omit or null otherwise. |
| `chosen_by` | string | yes | The ID of the user who recorded the choice in the client system (for the audit trail). 1 to 64 letters, digits, `.`, `_`, `@` or `-`. |

```json
{ "dealer_code": "DEMO0008", "scheme_tag": "SP-Q3", "choice": "GIFT", "destination": "OVERSEAS", "chosen_by": "SO1234" }
```

Order of checks: settings (503) → rate limit for each IP (429) → declared body size (413) → token and scope (401 / 403) → rate limit for each client (429) → `Content-Type`, JSON and fields (400) → scheme tag (400 `UNKNOWN_SCHEME_TAG`) → dealer (404 `DEALER_NOT_FOUND`) → dealer in a slab and destination (409 `CHOICE_NOT_ALLOWED`) → 200. The response is never cached.

### 13.3 Response 200

| Field | Type | Meaning |
|---|---|---|
| `dealer_code` | string | The code the choice is saved under (the parent code for a child dealer). |
| `scheme_tag` | string | |
| `changed` | boolean | False when the same `choice` and `destination` were already saved. Then nothing is written and `updated_at` does not change. |
| `reward_choice` | `RewardChoice` | The saved choice. |

`RewardChoice` (also in `SchemeStatus.reward_choice`):

| Field | Type | Meaning |
|---|---|---|
| `choice` | `GIFT` \| `CN` | |
| `destination` | `CRUISE` \| `OVERSEAS` \| null | Destination of the extra tickets. Null = not chosen or not applicable. |
| `source` | `ADMIN` \| `UPLOAD` \| `API` \| `DEMO` \| null | Where the choice came from: one choice entered on the admin dealer page, the admin file upload, this API, or the demo data. |
| `chosen_by` | string or null | The admin-area user name, or `chosen_by` of the API. |
| `updated_at` | string (date-time, `+05:30`) | Time of the last change. |

```json
{ "dealer_code": "DEMO0008", "scheme_tag": "SP-Q3", "changed": true,
  "reward_choice": { "choice": "GIFT", "destination": "OVERSEAS", "source": "API", "chosen_by": "SO1234", "updated_at": "2026-10-22T11:30:00+05:30" } }
```

### 13.4 Other ways to save a choice

- **Admin file upload:** `/admin/choices` accepts a `.csv` or `.xlsx` file with the columns `dealer_code`, `scheme_tag`, `choice`, `destination`, `chosen_by` (up to 20,000 rows, 5 MB). Valid rows are saved. Each refused row is reported with its row number and the reason.
- **Admin dealer page:** a user of the admin area opens the dealer and selects Gift or CN (and the destination) for a scheme where the dealer is in a slab. `chosen_by` = the user name, `source: ADMIN`.
- Admin-area users: the built-in admin (`ADMIN_USERNAME`, role `ADMIN`) and the users of `ADMIN_USERS` (role `ADMIN` or `CHOICES`; `npm run admin:user`). Role `CHOICES` can open only the dealer pages and the reward choices page.
- All ways use the same rules and the same table. Each change also adds one row to the audit table `dealer_reward_choice_log`; rows older than 3 months are deleted by the daily clean-up. An unchanged re-send adds nothing.
- History (`/admin/choices`, 22-10-2026): each log row keeps the sender (`actor`: the `client_id` of the token for this API, the user name for the admin area) and, for a file, the upload (`reward_choice_upload`). The page shows one entry for each file upload, and one entry for each day and sender for the API and the dealer page, with a CSV download of the changed rows. The API request and response do not change.
- The iframe (DMS and SFA) shows the saved choice and the final benefit (section 13.5). It has no form.

### 13.5 Final benefit (Star Points extra benefit)

The circular (SP p2, "Additional Trip/CN criteria") gives the extra benefit above the top slab as extra tickets (each with its CN alternative) **or** ₹18,500 CN for every 26,000 points, with only one trip destination. The dealer view shows the final benefit of the saved choice:

| Choice | Slab benefit | Extra benefit (rule of the chosen destination) |
|---|---|---|
| `GIFT` | The slab gift (ticket or gold voucher) | The extra tickets (`extra_tickets`), or their CN in place of the tickets (`extra_ticket_cn_value`), as in the circular. |
| `CN` | The slab CN alternative | ₹18,500 CN for every 26,000 points (`cn_option_value`). Decision of Mayur, 22-10-2026. |

At Slab 7, the dealer chooses the destination (`CRUISE` or `OVERSEAS`); it picks the rule. At Slab 6, only the cruise rule applies. Example (test dealer DEMO0008, 4,80,000 points, Slab 7, destination `OVERSEAS`): `GIFT` = 1 Overseas Tour ticket + 1 extra Overseas Tour ticket (or CN ₹1,62,000 in place of the extra ticket); `CN` = CN ₹1,62,000 + CN ₹1,66,500 = CN ₹3,28,500.

## 14. Iframe integration (DMS and SFA)

The iframe is the first option (section 1). The host application (SAP Commerce DMS or SFA) shows the dealer view of the logged-in dealer in an iframe. The host must do 3 things:

1. On its **server**, get a signed iframe URL for the logged-in dealer (section 14.2). Never do this in the browser.
2. Put an iframe with that URL on its page (section 14.3).
3. Set the iframe height from the height message of the page (section 14.4).

### 14.1 Set-up for each environment

| Item | Who | Value |
|---|---|---|
| Base URL | The vendor gives | Dev: `https://dev.scheme-calculator.example.com`. UAT and production: same pattern, hosts to be confirmed. |
| API client (`client_id`, `client_secret`) | The vendor gives | Made with `npm run auth:client`. The same client as the dealer status API can be used. Scope `schemes:read`. |
| Host origins | The client gives | The exact origins of the DMS and SFA pages that show the iframe, for example `https://dms.example.com`. The vendor puts them in `EMBED_ALLOWED_ORIGINS`. The browser blocks the iframe on any other origin (CSP `frame-ancestors`). |
| `EMBED_SIGNING_SECRET` | The vendor sets on the server | Only the server knows it when the host uses section 14.2. Give it to the client only for section 14.5. |

### 14.2 Get the signed URL: POST /api/v1/embed-token

Server-to-server, the same token and limits as the status endpoint (sections 3 and 8). Call it each time the page with the iframe opens.

Request (`Content-Type: application/json`):

| Field | Type | Required | Rules |
|---|---|---|---|
| `dealer_code` | string | yes | The logged-in dealer (`customer_code`). Same rule as section 4. A child code shows the parent's result (section 9). |
| `scheme_tags` | array of strings | no | Show only these schemes, for example `["FB-PAN"]`. Each must be an active tag (else 400 `UNKNOWN_SCHEME_TAG`). Missing or empty = all schemes of the dealer. Up to 10. |
| `ttl_seconds` | integer | no | Token lifetime, 60 to 86400. Default 3600 (1 hour). |

```json
{ "dealer_code": "DEMO0001", "scheme_tags": ["FB-PAN"], "ttl_seconds": 900 }
```

Response 200:

| Field | Type | Meaning |
|---|---|---|
| `token` | string | The signed iframe token. Do not change it. |
| `embed_path` | string | Path and query of the iframe page, URL-encoded: `/embed?token=...` (and `&tags=...` when `scheme_tags` is given). iframe `src` = base URL + `embed_path`. |
| `expires_at` | string (date-time, UTC) | After this time the iframe shows "Session expired". |

```json
{ "token": "eyJkIjoiREVNTzAwMDEiLCJleHAiOjE3OTI2NzIyMDAsInYiOjF9.eORrEW6HfuWQcMTCMgKqOtGVHtlczRzzdngSO2mN9EU",
  "embed_path": "/embed?token=eyJkIjoiREVNTzAwMDEiLCJleHAiOjE3OTI2NzIyMDAsInYiOjF9.eORrEW6HfuWQcMTCMgKqOtGVHtlczRzzdngSO2mN9EU&tags=FB-PAN",
  "expires_at": "2026-10-22T12:30:00.000Z" }
```

Order of checks: settings (503) → rate limit for each IP (429) → declared body size (413) → token and scope (401 / 403) → rate limit for each client (429) → `Content-Type`, JSON and fields (400) → scheme tags (400 `UNKNOWN_SCHEME_TAG`) → signing secret not set on the server (503 `API_DISABLED`) → 200. The dealer is not looked up: for an unknown dealer the iframe shows "No scheme data for your dealer code yet". The response is never cached.

A client that may read the status of any dealer (`schemes:read`) may also open the iframe for any dealer, so the endpoint needs no extra scope. The host must ask only for the dealer who is logged in.

### 14.3 The iframe

```html
<iframe id="acme-schemes" title="My schemes" src="https://dev.scheme-calculator.example.com/embed?token=..."
        style="width:100%;height:600px;border:0"></iframe>
```

- Put the `src` on the page from the server (for example in the page template). Do not log the URL: it holds the token.
- The page is responsive (desktop and mobile SFA). It sends no referrer.
- Errors are shown in the iframe: "Session expired" (token missing, not valid or expired; open the page again for a new token), "No scheme data for your dealer code yet", "Scheme data is not available right now".

### 14.4 Height message (postMessage)

After the page loads, and each time its content height changes (for example when the dealer opens "Scheme terms and conditions"), `/embed` sends this message to the host page:

```json
{ "type": "scheme-calculator:height", "height": 1266 }
```

`height` is the content height in CSS pixels. The message goes only to the origins in `EMBED_ALLOWED_ORIGINS`. The host sets the iframe height from it:

```html
<script>
  const SCHEME_ORIGIN = "https://dev.scheme-calculator.example.com";
  const frame = document.getElementById("acme-schemes");
  window.addEventListener("message", (e) => {
    if (e.origin !== SCHEME_ORIGIN || e.source !== frame.contentWindow) return;
    if (e.data && e.data.type === "scheme-calculator:height") frame.style.height = e.data.height + "px";
  });
</script>
```

Check `e.origin` and `e.source`: accept the message only from the iframe. Without this script the iframe keeps its fixed height and scrolls inside. Tested on 22-10-2026 with a host page on another origin (Chrome, 1400 px and 375 px): the iframe takes the content height, grows when the terms open, and has no inner scroll bar.

### 14.5 Other way: the host signs the token

The host can sign the token itself in place of section 14.2. Then the vendor gives it the `EMBED_SIGNING_SECRET` of the environment by a secure channel. Format (`src/lib/auth/embed-token.ts`):

```
token = base64url(JSON {"d":"<dealer_code>","exp":<unix seconds>,"v":1}) + "." + base64url(HMAC-SHA256(<first part>, EMBED_SIGNING_SECRET))
```

base64url without `=` padding. `exp` at most 24 hours ahead (clock tolerance 60 s). iframe `src` = base URL + `/embed?token=<token>` (and `&tags=FB-PAN,SP-Q3`). Java example:

```java
Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
long exp = System.currentTimeMillis() / 1000 + 3600;
String payload = "{\"d\":\"" + dealerCode + "\",\"exp\":" + exp + ",\"v\":1}";
String p = b64.encodeToString(payload.getBytes(StandardCharsets.UTF_8));
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
String token = p + "." + b64.encodeToString(mac.doFinal(p.getBytes(StandardCharsets.UTF_8)));
```

A test token for any dealer: `npm run token:sign -- <dealer_code>` (developer machine, with the secret of the environment).
