# scheme-calculator

Dealer scheme calculator for **Acme Paints** (paints).

## What this app does

Acme Paints runs sales schemes for its dealers. A scheme says: "If you buy this much in this period, you get this reward." Each scheme has levels, called **slabs**. A higher slab gives a bigger reward. The reward is a **gift** (a gold voucher or a trip) or a **credit note (CN)**, which is money off future bills.

A dealer wants to know three things:

1. Which slab have I reached?
2. What do I get for it?
3. How much more do I need to buy for the next slab?

This app answers these questions. It reads the dealer's purchases from Acme's sales data (BigQuery). It applies the rules of each scheme circular. It stores the result. Then it shows the result:

- to the **dealer**, in a "My Schemes" page inside the dealer's normal ordering apps (SAP Commerce / DMS and SFA),
- to **Acme staff**, in an admin report (how many dealers are in each slab, and why other dealers are not),
- to **other Acme systems**, through a JSON API (the same data as the dealer page).

### The schemes in this version

| Tag (example) | Scheme | Period | The dealer is measured on |
|---|---|---|---|
| FB-PAN | Festive Bonanza Oct–Nov'26 – Pan India except TNN, TNS, HP & JK | 01-10-2026 to 30-11-2026 | Oct + Nov sales, minimum Oct sales, growth over Q1 FY 2026-27 |
| FB-TNHPJK | Festive Bonanza Oct–Nov'26 – TNN, TNS, HP & JK | 01-10-2026 to 30-11-2026 | Oct + Nov sales, minimum Oct sales (no growth condition) |
| SP-Q3 | Star Points Q3 FY 2026-27 – Pan India | 01-10-2026 to 31-12-2026 | Points (litres bought × points per litre), growth over Q1 FY 2026-27 |

The rules come from the scheme circulars and are kept as configuration in `src/config/`. Sales amounts are **GSR** (DPL value − in-bill discounts). A dealer can join Festive Bonanza or Star Points, not both.

### How the slab is decided

Each slab has 2 or 3 conditions. The app checks Slab 1, then Slab 2, and so on. A slab is met only when **all** of its conditions are met. The app stops at the first slab that is not met. The dealer is in the slab before it. If Slab 1 is not met, the dealer is in no slab.

Example: Slab 1 needs A ≥ 10 and B ≥ 5. Slab 2 needs A ≥ 15 and B ≥ 10.

| Dealer has | Result |
|---|---|
| A = 16, B = 3 | No slab (B fails Slab 1) |
| A = 17, B = 9 | Slab 1 (B fails Slab 2) |

The dealer page shows each slab as **Unlocked** or **Locked**, with a tick or a cross for each condition. Two more checks can stop the benefit:

- **Outstanding (OD):** the dealer must have no overdue amount on the OD check date (30-11-2026 for Festive Bonanza, 31-12-2026 for Star Points).
- **Material returns:** returns are subtracted from sales, including returns up to 1 month after the scheme ends. Until then, the result is **provisional**.

Full scheme terms: [docs/scheme-rules-reference.md](docs/scheme-rules-reference.md).

## How to use it

| You are | What you use | How |
|---|---|---|
| A **dealer** | "My Schemes" page | Open it from the menu in SAP Commerce (DMS) or SFA. You do not log in again: the host app tells this app who you are. The page works on a phone. |
| **Acme sales or support staff** | Admin area, `/admin` | Log in with the admin user name and password. **Report**: dealer count per slab, gift / CN split, and the reasons why dealers are not in a slab. **Dealers**: search a dealer by code or name, and see the same page that the dealer sees. **Sync runs**: when the data was last loaded, and whether the load was successful. |
| A **developer of the host app** (SAP Commerce / SFA) | Iframe or API | Show the dealer page in an iframe ([Embed the iframe](#embed-the-iframe-in-sap-commerce--sfa)), or read the same data as JSON ([Dealer status API](#dealer-status-api), [docs/API_GUIDE.md](docs/API_GUIDE.md)). |
| A **developer of this app** | This repository | Follow the [Quick start](#quick-start). Without BigQuery access, use the [demo dealers](#try-it-with-demo-dealers). |
| An **operator** | The daily sync | Nothing to do. The app server loads the new sales totals from BigQuery each day at 08:00 India time and calculates all results again (`SYNC_DAILY_AT`, see [Daily data update](#daily-data-update)). Check admin "Sync runs" for the result. To load the data at another time, run `npm run sync:bigquery`. The pages show the time of the last load ("Data as of ..."). |

To change a scheme rule (for example, the Star Points bonus points for November), change `src/config/schemes.ts` and deploy. The server seeds and runs the engine at startup. Locally, run `npm run db:seed`. See [Scheme configuration](#scheme-configuration).

## What is not done yet

- OD data: there is no current OD source, so OD shows as "pending" for real dealers ([docs/assumptions.md](docs/assumptions.md) 2.1).
- Star Points bonus points for November and December are 0 until Acme Paints announces them.
- The domains that may embed the iframe (`EMBED_ALLOWED_ORIGINS`) come from the client.
- API servers (client's DevOps team): the number of proxies in front of the app (`TRUSTED_PROXY_HOPS`), Redis with or without TLS, the UAT and production hosts, and the QA client credentials for Dev.
- The Excel template upload is deferred. Until then, a new scheme needs a change in `src/config/`.

## Technology

Next.js 16 (App Router, TypeScript strict), PostgreSQL 17 with Drizzle ORM (migrations: drizzle-kit), BigQuery (read-only), Redis (optional: API rate limits and cache), Vitest.

## Quick start

1. Install the packages.

   ```
   npm install
   ```

2. Copy `.env.example` to `.env`. Fill in the values (see [Environment variables](#environment-variables)). On a developer machine, set `APP_ENV=local`. Without it, the server does not start with the example API client and key.

3. Start a local PostgreSQL (development only).

   ```
   docker run -d --name scheme-calc-pg -e POSTGRES_USER=scheme -e POSTGRES_PASSWORD=<choose> -e POSTGRES_DB=scheme_calculator -p 5433:5432 -v scheme-calc-pgdata:/var/lib/postgresql/data postgres:17-alpine
   ```

4. Create the tables and load the scheme configuration. (`npm run dev` and `npm run start` also do this at startup. See [Automatic database setup](#automatic-database-setup).)

   ```
   npm run db:migrate
   npm run db:seed
   ```

5. Log in to BigQuery: `gcloud auth application-default login`, or set `GOOGLE_APPLICATION_CREDENTIALS` to a service account key file, or put the key itself in `BIGQUERY_CREDENTIALS_JSON`.

6. Check the scan size. Then run the sync. The sync also runs the engine.

   ```
   npm run sync:bigquery -- --dry-run --no-sql
   npm run sync:bigquery
   ```

   Without BigQuery access, load test dealers instead: `npm run data:demo`.

   Optional: start a local Redis for the API rate limits and the response cache (development only), and set `REDIS_URL=redis://localhost:6380/0`.

   ```
   docker run -d --name scheme-calc-redis -p 6380:6379 redis:7-alpine
   ```

7. Start the app and open the dev host page.

   ```
   npm run dev
   ```

   Open `http://localhost:3000/dev/host?dealer_code=DEMO0001`. The admin report is at `http://localhost:3000/admin`.

All commands are in [Commands](#commands).

## Try it with demo dealers

`npm run data:demo` loads synthetic test dealers and runs the engine. A real sync does not touch them. Open `http://localhost:3000/dev/host?dealer_code=<code>` to see each one as the dealer sees it.

| Dealer code | What it shows |
|---|---|
| `DEMO0001` | FB-PAN circular example: Slab 1, gold voucher ₹5,000 |
| `DEMO0002` | FB-PAN: growth not met, no slab |
| `DEMO0003` | FB-PAN: growth 17% fails Slab 1, so no slab, although the numbers meet Slab 3 |
| `DEMO0004` | FB-PAN: top slab (Slab 7), with a material return in December |
| `DEMO0005` | FB-TNHPJK (TN North): Slab 2, no growth condition |
| `DEMO0006` | Not in the dealer master: region unknown |
| `DEMO0007` | Star Points: Slab 3 |
| `DEMO0008` | Star Points: above Slab 7, extra trip or CN |
| `DEMO0009` | Enrolled in Star Points, so Festive Bonanza shows "enrolled in other scheme" |
| `DEMO0010`, `DEMO-C1` | Parent and child dealer: the child's sales count for the parent |
| `DEMO0011` | Slab 1 numbers, but outstanding (OD) on 30-11-2026 blocks the benefit |
| `DEMO0012` | No Q1 FY 2026-27 sales of any product: growth not met, no slab |
| `DEMO0013` | No Q1 sales of scheme products, but Q1 sales of other products: growth met, Slab 1 |
| `DEMO0014` | Star Points: growth only met on the total GSR of all products, Slab 1 |

## Architecture

Data flow:

```
BigQuery (zsd_sales, customer_attributes, parent_child, test_product)
   │  sync job (server side, aggregate queries only, byte limits)
   ▼
PostgreSQL: dealer, dealer_metric (monthly GSR, returns, litres per category)
   │  scheme engine (plain TypeScript, src/engine/)
   ▼
PostgreSQL: dealer_scheme_result (one row per dealer and scheme)
   │  read only
   ├──► /embed                         iframe dealer view (SAP Commerce / SFA browser)
   ├──► /api/v1/dealer-scheme-status   dealer status API (SAP Commerce / SFA server)
   └──► /admin                         admin report (dealer count per slab, gift / CN split, reasons)
```

- The sync reads only totals from BigQuery. It does not copy raw sales rows.
- A routine sync reads only the scheme period and the return window (about 160 MB). The Q1 FY 2026-27 base is read once, or again with `--base`.
- The engine runs after each sync. Pages read the stored results. Pages never query BigQuery.
- The engine has no dependency on Next.js or the database. It has unit tests.

Main folders:

| Folder | Content |
|---|---|
| `src/config/` | Scheme configuration (the 3 circulars) |
| `src/engine/` | Scheme engine and its tests |
| `src/sync/` | BigQuery queries and the sync job |
| `src/server/` | Database read and write, engine run |
| `src/app/embed/` | Iframe dealer view |
| `src/app/admin/` | Admin login and report |
| `src/app/api/v1/`, `src/server/api/` | Dealer status API and health probe |
| `src/lib/auth/` | Embed token, frame policy, admin session, API keys, rate limits |
| `src/db/`, `drizzle/` | Drizzle schema and SQL migrations |
| `scripts/` | Command-line scripts (`npm run ...`) |
| `docs/` | BigQuery schema, assumptions, figures |

## Embed the iframe in SAP Commerce / SFA

### URL

```
https://<app-host>/embed?token=<token>
https://<app-host>/embed?token=<token>&tags=FB-PAN,SP-Q3
```

- `token` (required): a signed token for the logged-in dealer.
- `tags` (optional): show only these schemes. Without it, the page shows all schemes.
- The page is responsive. It works on mobile devices.
- Only the origins in `EMBED_ALLOWED_ORIGINS` can frame the page (CSP `frame-ancestors`).

```html
<iframe src="https://<app-host>/embed?token=<token>" style="width:100%;height:900px;border:0" title="My Schemes"></iframe>
```

### Token format

Make the token on the host **server**. Never make it in the browser, because the browser must not know the secret.

```
token      = payloadPart + "." + signature
payloadPart = base64url( JSON {"d": "<dealer code>", "exp": <unix seconds>, "v": 1} )
signature   = base64url( HMAC-SHA256( key = EMBED_SIGNING_SECRET, message = payloadPart ) )
```

- base64url = Base64 with `-` and `_`, and no `=` padding.
- The HMAC input is the `payloadPart` string exactly as it is in the token.
- `d`: dealer code, 1 to 32 letters, digits, `_` or `-`.
- `exp`: expiry time in unix seconds. Maximum 24 hours from now. Use a short lifetime, for example 1 hour.
- `v`: always `1`.
- The secret has at least 32 characters. The host and this app share it.
- A missing, changed or expired token shows "Session expired".

### Node.js example

```js
const { createHmac } = require("node:crypto");

function signEmbedToken(dealerCode, secret, ttlSeconds = 3600) {
  const payload = { d: dealerCode, exp: Math.floor(Date.now() / 1000) + ttlSeconds, v: 1 };
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payloadPart, "utf8").digest("base64url");
  return `${payloadPart}.${signature}`;
}

const token = signEmbedToken("DEMO0001", process.env.EMBED_SIGNING_SECRET);
const src = `https://<app-host>/embed?token=${encodeURIComponent(token)}`;
```

To make a test token with this app's secret: `npm run token:sign -- <dealer_code> [ttlSeconds]`.

For a child dealer, the view shows the result of the parent dealer.

## Dealer status API

The API is the second option for SAP Commerce / SFA. It returns the same data as the iframe, as JSON. Full contract: [docs/api-contract.md](docs/api-contract.md). OpenAPI 3.0.3: [docs/openapi.json](docs/openapi.json).

- Authentication: OAuth2 client credentials. `POST /api/v1/auth/token` with `grant_type=client_credentials`, `client_id` and `client_secret` gives a JWT access token (1 hour). Send it as `Authorization: Bearer <token>`. Reuse the token until it expires.
- `POST /api/v1/dealer-scheme-status` with the body `{"dealer_code": "...", "scheme_tags": ["FB-PAN", ...]}` (1 to 10 tags).
- `GET` or `HEAD /api/v1/health` (no authentication, never rate limited): `{"status":"ok","data_as_of":"..."}`.
- Server-to-server only. The API sends no CORS headers. A browser uses the iframe.
- Make a client with `npm run auth:client -- <client_id>`. Merge the printed `{"<client_id>":"<sha256>"}` entry into `AUTH_CLIENTS`. The server stores only the hash. Make a signing key with `npm run auth:jwt-secret`.
- Startup rules: with `APP_ENV` not set and no auth settings, the server does not start. Outside `APP_ENV=local`, `AUTH_CLIENTS` and `JWT_SECRET` must be set and strong, and the `.env.example` values are refused. With `APP_ENV=local` and no auth settings, auth is off (a warning is written).
- Rate limits: per client IP (`RATE_LIMIT_PER_SECOND`, default 2,500), token endpoint per client IP (`TOKEN_RATE_LIMIT_PER_MINUTE`, default 30), per client (`API_RATE_LIMIT_PER_MINUTE`, default 1,00,000 a minute, decision Q5). Counts are in Redis (`REDIS_URL`, `redis://` or `rediss://` with TLS). Without Redis, each process counts in memory.
- Response cache (optional): `CACHE_ENABLED=true` and `REDIS_URL`. Header `X-Cache: HIT | MISS | BYPASS`. Each engine run and each seed make the old answers unused.
- Swagger UI at `/api/docs` and the spec at `/api/v1/openapi.json` (`DOCS_ENABLED`; on by default only with `APP_ENV=local`). Set `DOCS_ENABLED=true` on Dev and UAT. Keep it off in production unless asked (decision Q9).
- Environments (decision Q8): Dev is `https://dev.scheme-calculator.example.com` (Swagger UI at `https://dev.scheme-calculator.example.com/api/docs`). UAT and production follow the same example pattern. Their hosts are to be confirmed.
- A child dealer code returns the parent's result.

```
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -d 'grant_type=client_credentials&client_id=local-client&client_secret=local-test-secret' | jq -r .access_token)
curl -s http://localhost:3000/api/v1/dealer-scheme-status \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dealer_code":"DEMO0001","scheme_tags":["FB-PAN","FB-TNHPJK","SP-Q3"]}'
```

The example client `local-client` / `local-test-secret` works only with `APP_ENV=local`.

## Environment variables

Keep all values in `.env`. Never commit `.env`. `.env.example` has the names only.

| Variable | Use |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. |
| `DATABASE_POOL_MAX` | Optional. Maximum database connections for each process (1 to 1,000, default 10). An invalid value stops the server at startup. |
| `BIGQUERY_PROJECT_ID`, `BIGQUERY_DATASET`, `BIGQUERY_LOCATION` | BigQuery source (`example-project`, `Testdb`, `asia-south1`). |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service account key file. Empty = Application Default Credentials. |
| `BIGQUERY_CREDENTIALS_JSON` | Optional. The service account key itself, so no key file has to be mounted: the key file as base64 on one line (`base64 -w0 key.json`; macOS `base64 -i key.json`), or its JSON on one line. Wins over `GOOGLE_APPLICATION_CREDENTIALS`. A bad value stops the sync with an error that names the setting. Secret: never commit it. |
| `BIGQUERY_MAX_BYTES_BILLED` | Byte limit for each routine sync query (default 1 GB). |
| `BIGQUERY_MAX_BYTES_BILLED_BASE` | Byte limit for each Q1 base query (default 5 GB). |
| `SYNC_DAILY_AT` | Time of the daily BigQuery sync, `HH:MM` (24-hour, India time), or `off`. Empty = `08:00`, but off with `APP_ENV=local`. An invalid value stops the server at startup. See [Daily data update](#daily-data-update). |
| `DB_AUTO_SETUP` | `true` (default when empty) or `false`. At server start: apply new migrations (a failure stops the server), seed the schemes when `src/config/` changed, and run the engine after a seed or a new build. See [Automatic database setup](#automatic-database-setup). |
| `EMBED_SIGNING_SECRET` | Shared secret for the iframe token (minimum 32 characters). |
| `EMBED_ALLOWED_ORIGINS` | Comma-separated origins that may frame `/embed`. |
| `ALLOW_DEV_DEALER_PARAM` | `true` allows `/embed?dealer_code=...` without a token. Ignored in production. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` | Admin login. |
| `TRUSTED_PROXY_HOPS` | Number of reverse proxies in front of the app (default 0). Used for the login limit and the API per-IP limits. When the value is 1 or more, the app port must accept connections only from the trusted proxies (firewall or private network). Otherwise a caller can set `X-Forwarded-For` and bypass the per-IP limits. Open item Q6 (DevOps): with nginx only in front (as on the other Acme API's Dev), the value is likely 1. |
| `APP_ENV` | `local`, `dev`, `uat` or `prod`. Set `local` on a developer machine. Not set and no auth settings = the server does not start. |
| `AUTH_CLIENTS` | API clients: JSON `{"<client_id>":"<sha256_hex_of_secret>"}`. Make one with `npm run auth:client -- <client_id>`. |
| `JWT_SECRET` | HS256 signing key of the access tokens (minimum 32 characters). `npm run auth:jwt-secret`. |
| `JWT_PREVIOUS_SECRET` | Old signing key during a rotation. Empty = not used. |
| `JWT_TTL_SECONDS` | Access token lifetime (default 3600, 60 to 86400). |
| `RATE_LIMIT_ENABLED` | `false` turns all API rate limits off (default `true`). |
| `RATE_LIMIT_PER_SECOND` | API requests per second for each client IP (default 2500). Not on the health probe. |
| `TOKEN_RATE_LIMIT_PER_MINUTE` | Token requests per minute for each client IP (default 30). |
| `API_RATE_LIMIT_PER_MINUTE` | Dealer status requests per minute for each `client_id` (default 100000 = 1,00,000, decision Q5; maximum 10,000,000). |
| `REDIS_URL` | Redis for the rate limits and the response cache. Empty = in memory for each process, cache off. `redis://[[user]:password@]host[:port][/db]` (no TLS) or `rediss://…` (TLS). Percent-encode special characters in the password. Another scheme stops the server. The app never logs the URL or the password. On servers (Redis from the client's DevOps team, decision Q7), use `rediss://` and a password when Redis is not on a private network. TLS or not is still open. |
| `CACHE_ENABLED`, `CACHE_TTL_SECONDS` | Response cache on/off (default off) and entry lifetime (default 900 s). |
| `DOCS_ENABLED` | Swagger UI and `/api/v1/openapi.json`. Empty = on only with `APP_ENV=local`. Per environment (decision Q9): `true` on Dev and UAT; empty (off) in production unless asked. |
| `DATABASE_POOL_TIMEOUT_MS` | Maximum wait for a free database connection (100 to 60,000 ms, default 5000). Then the API answers 503 `SERVICE_BUSY`. An invalid value stops the server at startup. |

## Daily data update

The app server runs the BigQuery sync (the same as `npm run sync:bigquery`) each day at `SYNC_DAILY_AT` (default 08:00 India time). The sync also runs the engine. Code: `src/server/sync-schedule.ts`, started from `src/instrumentation.ts`.

- **One run for all instances.** Each server instance tries at the same time. A PostgreSQL advisory lock lets only one of them run. The others write "Skipped" to the log.
- **Catch-up.** When a server starts after today's time and today's sync has not succeeded yet, the server runs it once. A restart after a successful run does nothing.
- **Manual runs.** `npm run sync:bigquery` takes the same lock. While the daily sync runs, a manual run stops with "Another BigQuery sync is running" and changes nothing.
- **Failures.** A failed run is logged (`[sync-schedule] Daily sync failed: ...`) and shows as FAILED in admin "Sync runs". The server tries again after 30 minutes, at most 3 attempts for one day (for example 08:00, 08:30, 09:00). After that, the next try is the next day or the next server start. A skip (another sync holds the lock, or today's sync already succeeded) is not retried.
- **BigQuery access.** The server needs the BigQuery credentials (`BIGQUERY_CREDENTIALS_JSON`, `GOOGLE_APPLICATION_CREDENTIALS` or Application Default Credentials) and `BIGQUERY_MAX_BYTES_BILLED`, the same as the command.
- **Turn it off** with `SYNC_DAILY_AT=off`, for example when an external scheduler runs `npm run sync:bigquery` instead. On a developer machine (`APP_ENV=local`) it is off unless you set a time.

The server writes the schedule at startup: `daily sync 08:00 IST` in the `[startup]` line, and `[sync-schedule] ... Next: <time>`.

## Automatic database setup

Each server start does the database steps of a deployment (`DB_AUTO_SETUP`, default on; `src/server/db-setup.ts`). DevOps does not run `npm run db:migrate`, `npm run db:seed` or `npm run engine:run`.

1. **Migrations.** Before the server takes requests, it applies the new migrations in `drizzle/`. When a migration fails, the server writes `[startup] Refused to start: database migration failed: ...` and stops (exit code 1). A database lock lets one instance migrate at a time.
2. **Seed.** In the background, the server compares the scheme configuration from `src/config/` with the hash of the last seed (table `app_state`). When they differ, it seeds.
3. **Engine.** After a seed, or when the build is new (`.next/BUILD_ID`), the server runs the engine once.
4. **Daily sync.** After steps 2 and 3, the daily sync schedule starts.

Steps 2 and 3 hold the same lock as the sync. When a sync or a script holds it, the server tries again each minute. After an error, it tries again after 30 minutes, at most 3 attempts. A restart with no change writes `[db-setup] Scheme configuration and build unchanged` and does nothing.

The deployment must include the `drizzle/` folder next to the app (the working directory of `next start`). Turn the setup off with `DB_AUTO_SETUP=false`. Then run the commands by hand.

## Scheme configuration

- `src/config/schemes.ts`: dates, channels, regions, exclusions, slabs, growth %, benefits, Star Points points per litre, bonus points, extra benefits, tools codes, return billing types.
- `src/config/star-points-products.ts`: Star Points Table III product list and the Channel 12 rule.
- `npm run db:seed` writes this configuration to the tables `scheme`, `scheme_slab`, `scheme_scope_rule` and `sp_product_category`. The engine reads it from the database.
- After a change on a server: deploy. The server seeds and runs the engine at startup (see [Automatic database setup](#automatic-database-setup)). On a machine without a running server: run `npm run db:seed` (it also runs the engine).
- A later phase adds an Excel template upload that writes the same tables.

Open items and defaults: [docs/assumptions.md](docs/assumptions.md). BigQuery columns: [docs/bigquery-schema.md](docs/bigquery-schema.md).

## Commands

Run all commands from the repository root. Every script reads `.env`.

**Database (drizzle-kit)**

| Command | What it does |
|---|---|
| `npm run db:generate` | Make a new SQL migration in `drizzle/` from `src/db/schema.ts`. Run it after each schema change. |
| `npm run db:migrate` | Apply the migrations in `drizzle/` to `DATABASE_URL`. |
| `npm run db:seed` | Write the 3 schemes from `src/config/` to the database. Safe to run again. |

**BigQuery sync and engine**

| Command | What it does |
|---|---|
| `npm run sync:bigquery -- --dry-run --no-sql` | Show the bytes that each query will scan. Nothing runs. Do this first. |
| `npm run sync:bigquery -- --dry-run` | Same, and print the SQL. |
| `npm run sync:bigquery` | Routine sync (scheme period and return window, about 160 MB), then the engine. The first run also reads the Q1 base. The app server also runs it each day (see [Daily data update](#daily-data-update)). |
| `npm run sync:bigquery -- --base` | Also read the Q1 FY 2026-27 base again (about 4.6 GB). Use it only when the base data changes. |
| `npm run engine:run` | Calculate the results again from the stored totals. Options: `-- --today=YYYY-MM-DD`, `-- --sync-run=<id>`. |
| `npm run bq:inspect` | Print the column list of the BigQuery tables (metadata only, no table scan). |

**Demo data, tokens and API clients**

| Command | What it does |
|---|---|
| `npm run data:demo` | Load the demo dealers and run the engine. |
| `npm run token:sign -- <dealer_code> [ttlSeconds]` | Print a signed iframe token and the `/embed` URL (default 3600 s, maximum 86400 s). |
| `npm run auth:client -- <client_id>` | Make an API client. Prints the secret one time and the `AUTH_CLIENTS` entry. |
| `npm run auth:jwt-secret` | Print a new `JWT_SECRET`. |
| `npm run openapi:check` | Check `docs/openapi.json` against the routes and the request validation. |

**App and checks**

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000. |
| `npm run build` / `npm run start` | Production build / start it. |
| `npm run typecheck` | `next typegen` and `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm test` | Vitest unit tests (`npm run test:watch` for watch mode). |

**QA suite**: Playwright API tests, Postman / newman, k6 load tests and security scans. See [qa/README.md](qa/README.md).

## Dependency audit

Use this command in the pipeline. It checks only the packages that run on the server:

```
npm audit --omit=dev
```

Status on 17-10-2026 (after `jose` 6.2.12 and `ioredis` 5.11.1 were added): 0 vulnerabilities in production packages.

The full `npm audit` (with development tools) shows one open advisory: `braces` (GHSA-vfj7-8cjw-p6xm), reached through `eslint-config-next` → `fast-glob` → `micromatch`. No patched version of `braces` exists yet. ESLint uses it on the developer machine only. It is not in the production build. Do not run `npm audit fix --force`: it downgrades `eslint-config-next` and `drizzle-kit` to old major versions.

`package.json` has an `overrides` entry that moves the `esbuild` used by `drizzle-kit` to a patched version (GHSA-67mh-4wv8-2f99).
