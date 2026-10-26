# Assumptions and open items

Status date: 22-10-2026. Owner: Mayur Chaudhary.

This file lists each default that the build uses where the client has not confirmed a decision (CLAUDE.md section 11). It also records the BigQuery data mapping that the sync uses.

Rules for this file:

- Keep each default in configuration (file, environment variable or database table), not in code logic.
- When the client confirms an item, change the configuration. Then set the status to **Confirmed** and write the date.
- Status values: **Open** = the client must confirm. **Confirmed** = the client or Mayur confirmed it. **Internal** = a technical decision. The client does not need to confirm it.

## 1. Open items from CLAUDE.md section 11

| # | Item | Default used | Where it is configured | Status | Client must confirm |
|---|---|---|---|---|---|
| 1.1 | Iframe dealer identity | Signed token in the URL: `?token=<payload>.<signature>`. Payload `{d, exp, v:1}`, HMAC-SHA256 with a shared secret. Maximum lifetime 24 h. Clock tolerance 60 s. A plain `?dealer_code=` works only when `NODE_ENV` is not `production` and `ALLOW_DEV_DEALER_PARAM=true`. A bad token never falls back to `dealer_code`. The host gets the signed URL from `POST /api/v1/embed-token` (OAuth client, scope `schemes:read`, default lifetime 1 h; 22-10-2026), so the secret stays on this server. Signing on the host with the shared secret stays possible. | `src/lib/auth/embed-token.ts`, `src/server/api/embed-token.ts`; env `EMBED_SIGNING_SECRET` (minimum 32 characters), `ALLOW_DEV_DEALER_PARAM`; `docs/api-contract.md` section 14 | Open | Which way SAP Commerce / SFA use: the API (recommended) or their own signing. For own signing: how the shared secret is exchanged. |
| 1.2 | Domains that may embed the iframe | `frame-ancestors 'self'` plus the configured list. Empty in development. Invalid origins are dropped. `*` is never allowed. All other routes send `frame-ancestors 'none'` and `X-Frame-Options: DENY`. `/embed` sends its content height (`postMessage` `{type: "scheme-calculator:height", height}`) only to these origins and its own origin; the host sets the iframe height from it (22-10-2026). | env `EMBED_ALLOWED_ORIGINS` (comma-separated, for example `https://dms.example.com`); `src/lib/auth/frame-policy.ts`, `src/proxy.ts`, `src/components/EmbedAutoHeight.tsx`; `docs/api-contract.md` section 14.4 | Open | The exact SAP Commerce (DMS) and SFA origins, for test and production. |
| 1.3 | Admin login | One user from environment variables. Session cookie `sc_admin`, path `/admin`, 8 h. A session is tied to the current user name and password. A change to either ends all sessions. Logout ends the session in one server process only. Rotate `ADMIN_SESSION_SECRET` to end all sessions on all instances. Failed logins: 5 for each IP in 15 minutes, counted in memory for each process. | env `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `TRUSTED_PROXY_HOPS`; `src/lib/auth/admin-session.ts`, `src/lib/auth/rate-limit.ts` | Open | If SSO is necessary. The number of reverse proxies in front of the app. |
| 1.4 | Client IP for the login limit | `TRUSTED_PROXY_HOPS=0`: the app does not trust `X-Forwarded-For`. All clients then share one login limit. With N, the client IP is the N-th entry from the right. There is no limit for each user name. | env `TRUSTED_PROXY_HOPS` | Open | The proxy set-up of the hosting environment (Q6, waiting for DevOps; likely 1 with nginx only, see row 11.12). |
| 1.5 | BigQuery column names | Checked against the real schema on 16-10-2026. See section 3. | `docs/bigquery-schema.md`, `src/sync/queries.ts` | Confirmed (16-10-2026, real schema) | – |
| 1.6 | Festive Bonanza Slab 1 gift: meeting ₹4,000, circular ₹5,000 | Circular value: gold voucher ₹5,000, CN ₹4,500. | `src/config/schemes.ts` (`FB_TABLE`) | Open | The correct Slab 1 value. |
| 1.7 | Festive Bonanza excluded products | Matched to product codes. See section 5. | `src/config/schemes.ts` (`FB_EXCLUSIONS`) | Open | The matched codes. |
| 1.8 | Which scheme a dealer joined (Festive Bonanza or Star Points) | Table `dealer_scheme_enrolment`. No record = calculate all schemes in scope and show all. An enrolment with an unknown tag is ignored. The table is empty now. No sync fills it. | table `dealer_scheme_enrolment` | Open | The source of the enrolment data. |
| 1.9 | Star Points bonus points for Nov'26 and Dec'26 | 0 for all categories. Also open (requirements note v1.3, open items): the basis of the bonus points is not clear. The client will define an incremental strategy separately. | `src/config/schemes.ts` (`starPoints.bonusPerLitre["2026-11"]`, `["2026-12"]`). Run `npm run db:seed` and `npm run engine:run` after a change. | Open | The bonus points at the start of each month. The basis and the incremental strategy. |
| 1.10 | Star Points product categories and litres | Categories from Table III of the circular (242 codes). Litres from `zsd_sales.inv_vol`. Free packs (`test_product.paidfree` = Free) give no litres (decided by Mayur, 23-10-2026). See section 6. | `src/config/star-points-products.ts`, table `sp_product_category` | Internal (data found) | – |
| 1.11 | Slab editing | Backend configuration only. No frontend editing. | `src/config/schemes.ts` → `npm run db:seed` | Confirmed (CLAUDE.md) | – |
| 1.12 | Lower growth % in higher Festive Bonanza slabs (20% → 15% → 10%) | Stop at the first failed slab (`STOP_AT_FIRST_FAIL`). Example: Oct ₹3 L, Nov ₹3.5 L, growth 17% → no slab. The other value, `HIGHEST_ALL_MET`, gives Slab 3. | `src/config/schemes.ts` (`classificationRule`) | Open | Which rule to use. |
| 1.13 | Region names TNN, TNS, HP, JK | See section 4. A dealer with no region is reported as "region unknown". | `src/config/schemes.ts` (`REGION_ALIASES`) | Open | The mapping. |

## 2. Other open items for the client

| # | Item | Default used | Where it is configured | Status | Client must confirm |
|---|---|---|---|---|---|
| 2.1 | Outstanding (OD) on the scheme end date | No current OD source. `SalesMLDB.overdue_report` was last changed in Jan 2026. Table `dealer_od_status` is empty, so OD shows as **PENDING** for all real dealers. If a dealer has OD, the benefit is blocked. If the dealer is also in no slab, the reason is the failed Slab 1 condition. The engine checks OD only on the OD check date (Festive Bonanza 30-11-2026, Star Points 31-12-2026). The circulars also need no OD at gold voucher disbursement, at travel and at CN settlement (FB p2 and SP p9, OD Criteria 1). That second check is a payout-time check outside the engine. See `docs/scheme-rules-reference.md` 3.1. | table `dealer_od_status` | Open | The OD data source and its refresh date. Who does the payout-time OD check. |
| 2.2 | Dealer master is old | `Testdb.customer_attributes` has one load (data_month 2026-08-01). It has no dealers created after that load. 7,046 dealers with sales have no region and show "region unknown" in FB-PAN and FB-TNHPJK. | BigQuery `customer_attributes` | Open | A newer dealer master load. |
| 2.3 | Star Points: "Beyond Slab 7, growth required is 5%" | Not applied. The extra benefits need Slab 6 or Slab 7, which need 10% growth. So a 5% value cannot change a result. | Comment in `src/config/schemes.ts` | Open | What the 5% rule means. |
| 2.4 | Star Points extra benefits above Slab 6 and Slab 7 | The engine calculates both rules, each from its slab upwards. They apply only to a dealer who is in Slab 6 or Slab 7 (these slabs need 10% growth). The circular says: "Dealer Can select only 1 Trip Destination- Overseas Tour or Island/equivalent Cruise" (SP p2). So the two rules are **alternatives, not additive**. In each rule, the trip option and the CN option (₹18,500 for each 26,000 points) are also alternatives ("OR" in the circular table). The dealer view shows each value as an option and says "choose one". It never adds the values. See `docs/scheme-rules-reference.md` 5.2. | `src/config/schemes.ts` (`extraBenefits`, `destination` of each rule); `src/components/dealer-view/SchemeCard.tsx`; `src/server/reward-choice.ts` | Decided | Mayur, 22-10-2026: the dealer in Slab 7 chooses the destination; it picks the extra-benefit rule. The circular rule itself is unchanged: extra tickets (each with its CN alternative) or ₹18,500 CN for every 26,000 points. The final benefit in the dealer view: with the gift, the extra tickets (or their CN); with CN, ₹18,500 for every 26,000 points (Mayur's answer, 22-10-2026). A Slab 6 dealer has only the cruise rule, so there is no destination choice. |
| 2.5 | Channel 12 (Institutional) product list | 22 codes. See section 7. | `src/config/star-points-products.ts` (`isChannel12Eligible`) | Open | The list. |
| 2.6 | EV50 code | 917052 (from `test_product`). The circular has no code for EV50. | `src/config/star-points-products.ts` | Open | The code. |
| 2.7 | Dealer reward choice (gift or CN) | Acme gives the choices to this application by Excel (admin upload) or by `POST /api/v1/dealer-reward-choice`; admin-area users can also enter one choice on the dealer page. The iframe (DMS and SFA) shows the saved choice and the final benefit, read-only (no sales officer ID). One current row for each dealer (parent code) and scheme in `dealer_reward_choice`: `choice` (GIFT / CN), `destination` (CRUISE / OVERSEAS, Star Points Slab 7), `source` (ADMIN / UPLOAD / API), `chosen_by`, `updated_at`. Each change adds one row to `dealer_reward_choice_log` (audit), kept for 3 months (daily clean-up). An unchanged re-send writes nothing. Rules: only a dealer in a slab can choose; the choice never locks; an uploaded row for a dealer with no slab is refused. The admin report splits each slab by gift / CN / not chosen and, for Star Points, by destination. | tables `dealer_reward_choice`, `dealer_reward_choice_log`; `src/server/reward-choice*.ts`; `src/app/admin/(protected)/choices/`, `src/app/admin/(protected)/dealers/[code]/actions.ts`; `src/app/api/v1/dealer-reward-choice/`; env `AUTH_WRITE_CLIENTS`, `ADMIN_USERS`; `src/sync/cleanup.ts` | Decided | Mayur, 22-10-2026: choices come by Excel or API; no sales officer ID; more admin-area users (role CHOICES) enter choices by file, API or screen; the SFA system's API client gets write access; audit log 3 months; never locks; only after a slab; refuse an uploaded row with no slab. **Open:** the `client_id` of the SFA system for each environment. |
| 2.8 | Book2.xlsx mock-up layout | Not available. The dealer view follows the API data shape (`docs/api-contract.md`). | `src/components/dealer-view/` | Open | Send Book2.xlsx. |
| 2.9 | MRV scope. Circular: "Material Return Value (MRV) sales from any time of the year will be subtracted from the total achievement of slab for the scheme period" (FB p2 and SP p9, point 6). Returns up to 1 month after the end date are also deducted for the payout (point 7). | The sync deducts all return billing types billed in the scheme period and in the return window, whatever the original invoice date. Returns billed before the scheme start do not count. See section 3.4. | `src/config/schemes.ts` (`RETURN_BILLING_TYPES`, `returnWindowMonths`); `src/sync/queries.ts` | Open | That returns billed before the scheme start do not count. |
| 2.10 | Star Points ad-hoc additional bonus points. Circular: "Additional Bonus points may also be announced from time to time which will be added to the overall points earned" (SP p2, Points Earning Mechanism 5). This is separate from the monthly bonus per litre. | None. There is no configuration field for them now. | – (`StarPointsPointsConfig` in `src/engine/types.ts` has only `bonusPerLitre` by month) | Open | The form of these bonuses (per litre, per product or a lump sum). Then add a configuration field. |
| 2.11 | New products launched in the scheme period. Circular: Acme Paints announces them when they launch (FB p1 and SP p8, "Please note"). | Festive Bonanza: a new Trade product counts automatically, unless it matches an exclusion (section 5). Star Points: a new product counts only after it is added to `src/config/star-points-products.ts` with a category (section 6). Then run `npm run db:seed` and `npm run engine:run`. | `src/config/star-points-products.ts` | Open | The new product codes and their Star Points category. |
| 2.12 | Category column in template v3.0 (upload phase) | Phase 1 table `scheme_scope_rule` has `product_category` and `product_group` for the exclusions that the circulars name by category (Distemper, Colorants). Template v3.0 has no such column. | `src/db/schema.ts` | Open | Add a Category column to the template, or list each product code in its own row. See `docs/template-v3.md` T2. |
| 2.13 | Master values in template rows (upload phase) | Region (TNN, TNS, HP, JK, Maharashtra North), depot, channel, product and SKU values must match the masters (`customer_attributes`, `test_product`). The upload rejects a row with an unknown value and shows the error. | Upload screen (later phase) | Open | The master lists for depot and region. See `docs/template-v3.md` T3. |
| 2.14 | Row Check column in template v3.0 (upload phase) | The source does not define it. Treat it as a per-row validation result that the template writes. Ignore it on upload. | Upload screen (later phase) | Open | The meaning of Row Check. See `docs/template-v3.md` T1. |
| 2.15 | Star Points trip text | Slabs 2–6 show "Island Cruise (or equivalent)". Circular: "Cruise Venue will be Island/equivalent" (SP p2, footnote 1). Destinations can change to an equivalent location (SP p9 point 22). Festive Bonanza gift text: "Gold Voucher (Jeweller A / Jeweller B / reputed brand)" (FB p1 footnote). | `src/config/schemes.ts` (`SP_TABLE`, `fbSlabs`) | Internal (circular text) | – |
| 2.16 | Time of the daily data update | The app server runs the BigQuery sync each day at 08:00 India time. On 19-10-2026 at 10:00, the latest billing date in BigQuery was 18-10-2026. So the 08:00 run shows the sales up to the previous day, if the BigQuery load ends before 08:00. | env `SYNC_DAILY_AT` (`HH:MM` India time or `off`); `src/server/sync-schedule.ts` | Open | The time when the daily sales load into BigQuery ends. Then set `SYNC_DAILY_AT` after that time. |
| 2.17 | Star Points growth basis. Circular: only Table III products count for "points achievement" (SP p1). The growth column says only "GSR Growth Criteria (Q3 over Q1-FY 27)" and names no products. | The dealer's total GSR of all products in the scheme channels (Trade 11, Franchise 21, Channel 12), not only Table III + tools. Sync metric `total_gsr`; `growthGsrBasis: "ALL_PRODUCTS"`. The dealer view shows the Q3 GSR and the growth with "(all products)". | `src/config/schemes.ts`, `src/sync/queries.ts`, `src/engine/star-points.ts` | Decided | BA, 19-10-2026 (option a). Open detail: all products also on Channel 12 (assumption). |
| 2.18 | "No Q1 sales" in the zero-Q1 rule (row 8.2) | No Q1 FY 2026-27 sales of any product in the scheme channels (`total_gsr`). A dealer who sold only other products in Q1 (scheme Q1 = 0, total Q1 > 0) passes the growth condition. | `src/config/schemes.ts` (`zeroBaseGrowthRule: "MET_IF_ANY_BASE_SALES"`) | Decided | BA, 19-10-2026 (option a). |
| 2.19 | Lock status and slab view (meeting client lead and Mayur, 22-10-2026) | Only the slab that the dealer is in is UNLOCKED. The lower slabs are LOCKED too. The slab rule stays `STOP_AT_FIRST_FAIL` (row 1.12). The iframe and the admin dealer page show the slab, gift, CN and status only: no conditions (met / not met), no "To unlock" box, no material returns. The engine and the API keep the conditions and `mrv_total`. Admin Dealers page: all dealers of one scheme (default FB-PAN), filter Unlocked / Locked / All (Unlocked is the default), 50 a page. Left out: `NO_DATA` and `REGION_NOT_IN_SCOPE`. | `src/engine/index.ts`, `src/components/dealer-view/SchemeCard.tsx`, `src/server/repo.ts` (`listSchemeDealers`), `src/app/admin/(protected)/dealers/` | Decided | client lead and Mayur, 22-10-2026. Internal: `REGION_NOT_IN_SCOPE` left out of the list, so that a TN dealer does not show as Locked under FB-PAN. |
| 2.20 | Scheme tags | `FB-PAN` (Festive Bonanza Pan India except TNN, TNS, HP & JK), `FB-TNHPJK` (Festive Bonanza TNN, TNS, HP & JK), `SP-Q3` (Star Points Q3 FY 2026-27), in place of the example tags `ABC1`, `ABC2`, `ABC3`. No alias for the old tags. Migration `drizzle/0002_rename_scheme_tags.sql` moves all stored rows (reward choices and their log included). | `src/config/schemes.ts` (`SCHEME_TAGS`) only. The env overrides `SCHEME_TAG_*` are removed (22-10-2026): a tag keys the stored data, so a rename needs a migration, not an env change. | Decided | Mayur, 22-10-2026. SFA / DMS must use the new tags from the deploy. |
| 2.21 | Reward choice history (Mayur, 22-10-2026) | `/admin/choices` shows one entry for each file upload and one entry for each day and sender for the API and the dealer page, with a CSV download of the changed rows. The uploaded file is not kept. No delete or undo of an upload: a later change (upload, API, dealer page) can replace the same choice, so a delete could remove a newer choice. A corrected upload replaces the choice. Kept 3 months with the log. Log rows from before migration 0003 have no sender. | `src/server/reward-choice-history.ts`, `src/app/admin/(protected)/choices/`, `drizzle/0003_reward_choice_history.sql`, `src/sync/cleanup.ts` | Decided | Revert (restore the previous choice when nothing newer exists) only if the business asks. |

## 3. BigQuery data mapping (example-project.Testdb, location asia-south1)

Checked against the real data on 16-10-2026. The full column list is in `docs/bigquery-schema.md`.

### 3.1 Column mapping used

| Table.column | Meaning in the app |
|---|---|
| `zsd_sales.billing_date` | Date of the sales line. The table is partitioned by DAY on this column. Every query filters on it. |
| `zsd_sales.invoice_date` | Date of the line when `billing_date` is NULL (NULL partition, invoice months Mar–May 2026). Read only in the base (Q1) query. |
| `zsd_sales.customer_code` | Dealer code (before the parent roll-up). |
| `zsd_sales.distribution_channel` | Channel code. See section 3.3. |
| `zsd_sales.billing_type` | Invoice, return or cancellation. See section 3.4. |
| `zsd_sales.gross_sales_revenue` | GSR = DPL − in-bill discount (= `value_sales + inbill`). Signed: returns and cancellations are negative. STRING → `SAFE_CAST(... AS NUMERIC)`. |
| `zsd_sales.inv_vol` | Litres (inv_qty × pack volume). Signed. STRING → NUMERIC. |
| `zsd_sales.product_code` | 6-digit base product code (= `test_product.baseproduct` = Table III "Prod code"). Values like "932002.0" are cleaned. When NULL: `test_product.baseproduct` by SKU, then the first 6 digits of the SKU. |
| `zsd_sales.sku_code` | Long SKU code. Its first 6 digits are matched first for Star Points Table III. |
| `zsd_sales.inv_no`, `line_item`, `data_month` | Key and load month for the de-duplication. See section 3.5. |
| `zsd_sales.region_name` | Not used. It is a short state code ("TN", "HP", "Mah"), not the scheme region. |
| `customer_attributes.dealer_code`, `dealer_name`, `zone`, `region_code`, `region_name`, `territory_name`, `depot_code` | Dealer master. `region_name` is the scheme region. Latest `data_month` only. |
| `parent_child.parent`, `child`, `data_month` | Parent–child map. Latest `data_month` only. Dealer = `COALESCE(parent, customer_code)`. |
| `test_product.skucode`, `baseproduct`, `categoryname`, `productgrp` | Product master: SKU → base product, and the Festive Bonanza exclusions. |
| `Trip_Scheme_SKUs` | Q2 Star Points list. Cross-check only (section 6). Not a source. |
| `SalesMLDB.Product_Master` | Not used. Checked 19-10-2026: same columns as `test_product`, 45,142 rows, last changed 06-04-2026. It has no Star Points category column. `marketingCategory` (numeric code) does not match the Table III categories (only Enamels = 10003). It has 162 of the 242 Table III codes (`test_product`: 164). The Star Points category comes from Table III (`src/config/star-points-products.ts`), as the BA proposed (CASE WHEN or upload). |
| `zsd_billing` | Not used. It holds only Sep-2026. `zsd_sales` already has Sep and Oct 2026. |

### 3.2 Base period and routine sync

- The Q1 FY 2026-27 base (01-04-2026 to 30-06-2026) is read once, or again with `npm run sync:bigquery -- --base` (about 4.6 GB). It is the only query that reads the NULL partition.
- A routine sync reads only the scheme period and the return window (about 160 MB in total).
- A routine sync keeps the stored base months. Base rows count as present only if a successful BigQuery sync wrote them. Demo rows do not count.
- Assumption: the NULL partition holds only invoices from Mar to May 2026. If a later load puts scheme-period rows there, the routine sync does not see them.
- Byte limits: env `BIGQUERY_MAX_BYTES_BILLED` (routine, default 1 GB) and `BIGQUERY_MAX_BYTES_BILLED_BASE` (default 5 GB). Note: the local `.env` still has 20 GB. Lower it to use the 1 GB default.
- A `LIMIT` does not reduce the bytes that BigQuery scans. Only the partition filter and the column choice do that. Use `LIMIT` on manual checks to keep the result small, and use `--dry_run` and `--maximum_bytes_billed` to limit the scan.

### 3.3 Channel codes (`distribution_channel`)

| Code | Name | Festive Bonanza | Star Points |
|---|---|---|---|
| 11 | Direct Dealer (Trade) | Yes | Yes |
| 21 | Franchise | Yes | Yes |
| 12 | Institutional (Channel 12) | No | Only the 22 Channel 12 codes (section 7) |
| 10, 20, 14, other | Distributor, Retail, Company store, other | No | No |

Configured in `src/config/schemes.ts` (`CHANNELS`, `SCHEME_CHANNELS`). For Festive Bonanza, the Trade check is only the channel filter. Prime products billed on channels 11 and 21 count.

### 3.4 Billing types and material returns (MRV)

- Material returns: `ZRET`, `ZEXR`, `ZNCR`, `ZEPR` (`RETURN_BILLING_TYPES` in `src/config/schemes.ts`).
- Cancellations (`S1`, `S2`) are not returns. They net into GSR.
- In the scheme period, all billing types count. In the return window (Festive Bonanza Dec'26, Star Points Jan'27), only return types count. They count against the last period month.
- Results stay **provisional** until the end of the return window.
- Open item 2.9: the circulars subtract MRV "from any time of the year". The sync deducts only returns billed in the scheme period and the return window.

### 3.5 Duplicate loads

The same invoice line (`inv_no`, `line_item`) is in several `data_month` loads (Apr–Jul 2026; for May 2026: 2.63 M rows, 1.28 M unique lines). The sync keeps one row for each line, from the latest load:

```
QUALIFY ROW_NUMBER() OVER (PARTITION BY inv_no, line_item ORDER BY data_month DESC, billing_date IS NULL) = 1
```

### 3.6 Parent–child

- A child's sales roll up to the parent. Metrics are stored under the parent code.
- A child's iframe login shows the parent's result, with the parent's code and name.
- Children in `parent_child` that are not in `customer_attributes` are added to the dealer table (289 in the 2026-09 load). They have no region. This has no effect, because their sales count under the parent.

## 4. Region mapping

| Circular code | `customer_attributes.region_name` |
|---|---|
| TNN | TN North |
| TNS | TN South |
| HP | HP & JK |
| JK | HP & JK |

- HP and JK are one region in the data.
- FB-PAN excludes these regions. FB-TNHPJK includes only these regions. SP-Q3 is Pan India.
- Region names are matched without regard to letter case or spaces at the ends.
- A dealer with no region value shows as "region unknown" (not in scope for FB-PAN and FB-TNHPJK).

## 5. Festive Bonanza exclusions

Circular text: "Distemper, Colorants, Style Aluminium Paint and Venture 15/25/Roller". Matched to `test_product` on 16-10-2026. Exclusion is at base product level.

| Circular name | Rule used |
|---|---|
| Colorants | `test_product.categoryname = 'Colorants'` |
| Distemper | `test_product.productgrp = 'DISTEMPER'` on any SKU of the base product (some SKUs have `productgrp` NULL, for example 943010 SUPER BRIGHT) |
| Style Aluminium Paint | 962006 (ALUMINIUM PAINT, sub-brand Style) |
| Venture 15 | 930001 |
| Venture 25 | 930004 |
| Venture Roller | 930002 |

Configured in `FB_EXCLUSIONS` in `src/config/schemes.ts`. Seed: 11 scope rules for each Festive Bonanza scheme.

New products (open item 2.11): a new Trade product launched in the scheme period counts automatically, unless it matches one of these rules.

## 6. Star Points products

- Source: Table III of the circular, pages 3–8. 242 codes: Luxury 158, Premium 24, Economy 29, Enamels 16, Others 15.
- Tools (Rollers, Sandpapers, Masking Tapes): 20 base product codes from `test_product`, stored with category TOOLS. Tools are not eligible on Channel 12. If a code is in Table III and in the tools list, Table III wins.
  - Rollers: 972200, 972211, 972212, 972215, 972302, 972310
  - Sandpapers: 972102, 972103, 972104, 972105, 972106, 972122, 972123, 972124, 972125, 972126
  - Masking tapes: 972001, 972002, 972003, 972004
- Match order: first 6 digits of the SKU first, then `product_code`. Reason: some Table III codes are SKU prefixes (for example 517179 PU Thinner has `product_code` 953004).
- Star Points product scope comes only from table `sp_product_category`.
- New products (open item 2.11): a new product counts only after it is added to `src/config/star-points-products.ts` with a category. Then run `npm run db:seed` and `npm run engine:run`.
- Growth GSR (Q3 compared with Q1 FY 2026-27 × 1.10) uses the dealer's total GSR of all products in the scheme channels (open item 2.17, decided by the BA on 19-10-2026). The points still use only Table III and tools.
- Free packs give no points (Mayur, 23-10-2026). A free pack is a SKU with `test_product.paidfree` = Free and GSR 0 (for example "XNSS White Lumina Neo Star Shine-1L"). The circular gives points for litres purchased. The Acme update of 20-10-2026 also leaves them out: without free packs, the October points of 66.8% of dealers agree with the Acme file (23.0% with them). From 1 to 20 Oct 2026, free packs of Table III products were about 8.15 lakh litres. A SKU that is not in `test_product` counts as paid.
- Points are calculated exactly, then rounded down to 2 decimals before the slab check. Tools points are never below 0. Category points can go below 0 after returns. Return-window litres use the bonus of the last period month.

### Cross-check with `Testdb.Trip_Scheme_SKUs` (Q2 list, 239 codes, read 16-10-2026)

The circular says that the Q3 classification is the same as Q2. All 239 Q2 codes are in Table III with the same category. Table III has 3 more codes:

| Code | Name | Category in Table III | In Q2 list |
|---|---|---|---|
| 917052 | EV50 | Premium | No |
| 931009 | TRUE LOOK SHINE | Luxury | No |
| 932007 | NEO KING | Premium | No |

The Q2 list has points 28 / 11 / 6 / 5 / 2.5. The app does not use them. It uses the Q3 points from the circular.

## 7. Channel 12 eligible codes

Circular: "In Channel 12 billing (Institutional): Only Trade products of Acme One Emulsions topcoats as mentioned in the product list will be included."

Rule used: brand "One" AND category "Interior Emulsions" or "Exterior Emulsions" AND the name has no "putty" or "primer". This rule excludes 941006 Pro Smooth Putty. Result: 22 codes, all Luxury.

| Code | Name | Category |
|---|---|---|
| 930003 | Inspire Concrete | Exterior Emulsions |
| 931001 | True Look | Exterior Emulsions |
| 931009 | True Look Shine | Exterior Emulsions |
| 931002 | True Flex | Exterior Emulsions |
| 931003 | True Life | Exterior Emulsions |
| 931004 | True Vision | Exterior Emulsions |
| 931005 | Inspire Clear Coat | Exterior Emulsions |
| 940001 | Dream Effects | Interior Emulsions |
| 940002 | Dream Effects Metallic | Interior Emulsions |
| 940003 | Dream Marble | Interior Emulsions |
| 940004 | Dream Texture | Interior Emulsions |
| 940005 | Dream Duracoat | Interior Emulsions |
| 940101 | Timeless Stone | Interior Emulsions |
| 940102 | Timeless Natura | Interior Emulsions |
| 940103 | Timeless Clay | Interior Emulsions |
| 940104 | Timeless Marmarino | Interior Emulsions |
| 940105 | Timeless Marmarino Metallic | Interior Emulsions |
| 941001 | Pure Elegance | Interior Emulsions |
| 941002 | Pure Elegance Shine | Interior Emulsions |
| 941003 | Pure Elegance Matte | Interior Emulsions |
| 941004 | Pure Legend | Interior Emulsions |
| 941014 | Pure Elegance Soft | Interior Emulsions |

## 8. Engine assumptions (internal)

| # | Assumption | Where |
|---|---|---|
| 8.1 | `classifySlabs` returns a 0-based index. `current_slab_no` stores the configured slab number. | `src/engine/classify.ts` |
| 8.2 | With a zero (or negative) Q1 base, growth % shows as null. The result follows `zeroBaseGrowthRule`. Value: `MET_IF_ANY_BASE_SALES` for FB-PAN and SP-Q3: met only when the dealer had Q1 FY 2026-27 sales of any product (`total_gsr`, all products in the scheme channels). So a dealer with no Q1 sales at all is in no slab (reason `SLAB1_GROWTH_NOT_MET`). FB-TNHPJK has no growth condition. Decision: BA, 19-10-2026 (rows 2.17, 2.18). Without `total_gsr` data (demo data), the scheme GSR is used. | `src/config/schemes.ts`, `src/engine/money.ts` |
| 8.3 | Growth % is rounded down to 2 decimals for display (19.995% shows as 19.99%). The dealer's INR values and points are also rounded down for display. A gap shows at least 0.1 percentage points. | `src/engine/money.ts`, `src/components/format.ts` |
| 8.4 | The engine writes its own labels, for example "Oct'26 GSR" (the Frappe draft example had "Oct26 GSR", see `docs/api-contract.md` section 12). | `src/engine/labels.ts` |
| 8.5 | When Slab 1 fails, the hint shows all unmet Slab 1 conditions. When the dealer is in a slab, the hint also shows what is missing for the next slab. | `src/engine/` |
| 8.6 | A dealer can be in Festive Bonanza or Star Points, not both (`exclusivityGroup`). With an enrolment, the other schemes show "enrolled in another scheme". | `src/engine/participation.ts` |
| 8.7 | "Today" is the Asia/Kolkata date. | `src/server/run-engine.ts` |

## 9. Data layer and web assumptions (internal)

| # | Assumption | Where |
|---|---|---|
| 9.1 | Dealers evaluated = dealers with metrics plus dealers with an enrolment. Each gets a result for every active scheme. | `src/server/run-engine.ts` |
| 9.2 | A scheme with no stored result shows as not in scope, reason `NO_DATA`. Unknown or inactive tags are dropped from the dealer view. | `src/server/repo.ts` |
| 9.3 | "Data as of" comes from the latest successful sync run. A real (non-DEMO) run comes first. The demo run is used only when no real run exists. | `src/server/repo.ts`, `src/server/run-engine.ts` |
| 9.4 | Admin report: a result with no reason code is grouped as `UNSPECIFIED`. "Last sync" also counts DEMO runs. | `src/server/repo.ts` |
| 9.5 | A real sync does not delete or change the demo test rows (dealer codes `DEMO%`). | `src/sync/run-sync.ts` |
| 9.6 | The `/embed` page sets no referrer. `/dev/host` returns 404 in production. The app sends no `X-Powered-By` header. | `src/app/embed/page.tsx`, `next.config.ts` |
| 9.7 | Light theme only, system fonts. A gift amount is not shown twice when the gift text already contains it. | `src/components/` |
| 9.8 | Reward choice in the dealer view: the saved choice and the final benefit (`finalBenefitText`), read-only in the iframe. The admin dealer page also has the form (only for a dealer in a slab). A dealer who drops out of all slabs after a choice keeps the saved choice; it shows, but the form does not. | `src/components/dealer-view/RewardChoicePanel.tsx`, `RewardChoiceForm.tsx`, `helpers.ts` |
| 9.9 | Admin upload of reward choices: `.csv` or `.xlsx` (first sheet), 5 MB, up to 20,000 rows. Valid rows are saved in one transaction; refused rows are listed with their row number (all of them in the CSV download). Rows for the same dealer and scheme in one file are all refused. An empty `chosen_by` cell = the admin user name. Dependency `exceljs` (its `uuid` dependency is raised to 11.1.1 with an npm override, for GHSA-w5hq-g745-h8pq). | `src/server/reward-choice-upload.ts`, `src/app/admin/(protected)/choices/`, `package.json` |
| 9.10 | Admin-area users: the built-in admin (`ADMIN_USERNAME` / `ADMIN_PASSWORD`, role ADMIN) and `ADMIN_USERS` (JSON, role ADMIN or CHOICES, PBKDF2-SHA256 password hash with 600,000 iterations, made with `npm run admin:user`). The hash uses `:` as separator, because Next.js expands `$NAME` in `.env` files. Role CHOICES can open only `/admin/dealers` and `/admin/choices` (proxy and pages check it). A session ends when the user's hash or role changes. Users are added in the env file (no user-management screen). | `src/lib/auth/admin-users.ts`, `src/lib/auth/admin-session.ts`, `src/proxy.ts`, `scripts/admin-user.ts` |

## 10. Known technical limits

- The engine takes about 20 s for 44,000 dealers. Most of the time is the `jsonb` write.
- Logout ends a session in one server process only.
- The login limit is in memory. It is not shared between instances.
- The API rate limits use Redis when `REDIS_URL` is set (shared between instances). Without Redis, or when Redis fails, each instance counts in memory.

## 11. Dealer status API (phase 2)

Decision (Mayur, 16-10-2026): phase 2 is the dealer status API, not the Excel upload. Contract: `docs/api-contract.md`. Decisions (Mayur, 17-10-2026, CLAUDE.md decisions 12 and 13): Q1, Q2, Q3, Q4, Q10 and Q11 are decided (rows 11.1, 11.8 and 11.15 to 11.18). Decisions (Mayur, 18-10-2026, CLAUDE.md decision 14): Q5, Q7, Q8 and Q9 are decided (rows 11.2, 11.3, 11.14 and 11.22). Q6 (`TRUSTED_PROXY_HOPS`, row 11.12) stays open: it waits for DevOps. In row 11.22, "TLS or not" also stays open for DevOps.

| # | Item | Default used | Where it is configured | Status | Client must confirm |
|---|---|---|---|---|---|
| 11.1 | API authentication | OAuth2 client credentials (same scheme as the Other Scheme API). `POST /api/v1/auth/token` gives an HS256 JWT for 1 hour. One `client_id` / `client_secret` for each client system. The server stores only the SHA-256 hash of each secret. Startup rules with `APP_ENV`: the server does not start with missing or weak auth settings outside `local`. `iss`/`aud`/realm `scheme-calculator`, scope `schemes:read`. | env `APP_ENV`, `AUTH_CLIENTS`, `JWT_SECRET`, `JWT_PREVIOUS_SECRET`, `JWT_TTL_SECONDS`; `src/lib/auth/`; `src/server/config.ts`; `npm run auth:client`, `npm run auth:jwt-secret` | Open | The client systems (SAP Commerce, SFA, test and production) and how the secret is given to each. The JWT names and the scope are **decided** (Mayur, 17-10-2026, Q2): scope `schemes:read`, issuer and audience `scheme-calculator`. |
| 11.2 | Rate limit | Three fixed-window limits: 2,500 requests a second for each client IP (all `/api/` paths except health), 30 token requests a minute for each client IP, 1,00,000 requests a minute for each `client_id`. Counts in Redis, memory as fallback. `RATE_LIMIT_ENABLED=false` turns them off. | env `RATE_LIMIT_ENABLED`, `RATE_LIMIT_PER_SECOND`, `TOKEN_RATE_LIMIT_PER_MINUTE`, `API_RATE_LIMIT_PER_MINUTE` (default 100000, `DEFAULT_API_RATE_LIMIT_PER_MINUTE` in `src/server/config.ts`); `src/server/ratelimit.ts` | Decided | Mayur, 18-10-2026 (Q5): the per-client limit is 1,00,000 requests a minute for each client, not 600. |
| 11.3 | Path, version and hosts | `POST /api/v1/dealer-scheme-status`. The Frappe path and the `message` wrapper are not used. Dev: `https://dev.scheme-calculator.example.com` (Swagger UI at `/api/docs`). UAT and production: the same example pattern, hosts to be confirmed. | `src/app/api/v1/`; Dev URL in `qa/postman/build-collection.ts`, `qa/swagger/build-specs.ts`, `qa/api-tests/package.json` (`test:dev`), `docs/openapi.json` | Decided | Mayur, 18-10-2026 (Q8): domain example, the same pattern as the other Acme API (`dev.scheme-api.example.com`). Still to confirm: the UAT and production hosts. |
| 11.4 | Request limits | Body maximum 8 KB (413 `PAYLOAD_TOO_LARGE`, as in the Other Scheme API). 1 to 10 tags. Dealer code 1 to 32 characters (letters, digits, `_`, `-`) after the server removes spaces at the start and the end. Tags are case-sensitive and must be active schemes. Other body fields are ignored. Wrong `Content-Type` gives 400 `INVALID_REQUEST` (not 415). | `src/server/api/dealer-status.ts`, `src/server/api/pipeline.ts` | Internal | – |
| 11.5 | Child dealer | A child code returns the parent's result. The response `dealer_code` is the parent code (same as the iframe, section 3.6). | `src/server/repo.ts` (`getDealerStatus`) | Internal | – |
| 11.6 | Unknown dealer | 404 only when the code is in neither the dealer master nor the stored results. A dealer in the master with no result gets 200 with `NO_DATA` for each scheme. | `src/server/repo.ts` | Internal | – |
| 11.7 | CORS and headers | No CORS. The API is server-to-server only. A browser uses the iframe. The proxy does not run for `/api/*`, so that Next.js does not copy request bodies into memory. The route handlers set the security headers of the Other Scheme API (nosniff, DENY, `no-referrer`, CORP, HSTS, `no-store`, `default-src 'none'`); `next.config.ts` sets them as a second layer. The Next.js 308 trailing-slash redirect has no security headers (known gap). | `src/server/api/http.ts`, `next.config.ts`, `src/proxy.ts` (matcher), route files | Internal | – |
| 11.8 | Health probe | `GET` and `HEAD /api/v1/health`, no authentication, never rate limited, returns only `status` and `data_as_of`. Readiness probe (checks the database). The value is kept for 15 s. The Other Scheme API probe is liveness only. | `src/app/api/v1/health/route.ts` | Decided | Mayur, 17-10-2026 (Q10): the probe stays a readiness probe (database check, value kept for 15 s). |
| 11.9 | Failed authentication | The token endpoint allows 30 requests a minute for each client IP. Client secrets are 256-bit random values. | `TOKEN_RATE_LIMIT_PER_MINUTE` | Internal | – |
| 11.10 | Logging | One JSON line for each request (also 405, 429 and `OPTIONS`): `request_id`, `client_id`, `status`, `code`, `tags` (count), `dealer_code`, `duration_ms`, `cache`. Token endpoint: `token_issued` / `token_refused`. A 5xx line also has `error` and goes to stderr. No secret, no token, no hash, no body. | `src/server/api/http.ts`, `src/server/api/pipeline.ts`, `src/lib/auth/token-endpoint.ts` | Internal | – |
| 11.11 | Response cache | Off by default. With `CACHE_ENABLED=true` and `REDIS_URL`, the answers 200, 404 `DEALER_NOT_FOUND` and 400 `UNKNOWN_SCHEME_TAG` are kept in Redis for 900 s. The engine run and `db:seed` increase the data version, so old answers are not used again (at most 5 s later). Redis failure: answers come from the database (`X-Cache: BYPASS`). The cache holds dealer results: Redis in production must be private to the app. | env `CACHE_ENABLED`, `CACHE_TTL_SECONDS`, `REDIS_URL`; `src/server/cache.ts` | Internal | Redis in production: see row 11.22. |
| 11.12 | Client IP behind proxies | `TRUSTED_PROXY_HOPS` (default 0): the client IP is the N-th entry from the right of `X-Forwarded-For`. With 0, all callers share one rate-limit bucket. Then one caller with many bad token requests can block token issue for all clients for up to one minute. With 1 or more, the app port must accept connections only from the trusted proxies (firewall or private network), because the app cannot see the socket peer. An entry that is not an IP address goes to the shared bucket. The server writes a warning at startup outside `APP_ENV=local` (for 0 and for 1 or more). Real per-peer keys need a custom server or a client-IP header from the platform. | env `TRUSTED_PROXY_HOPS`; `src/lib/auth/rate-limit.ts` | Open | Q6, waiting for DevOps: the number of reverse proxies in front of the app in each environment, and the token lockout with 0. The other Acme API has nginx in front of it on Dev, so the likely value is 1 (nginx only). With 1 or more, the app port must accept connections only from the proxy (firewall or private network). |
| 11.13 | Database busy | The pool waits at most 5 s for a connection, then the API answers 503 `SERVICE_BUSY` with `Retry-After: 2`. A refused database connection gives the same answer. | env `DATABASE_POOL_TIMEOUT_MS`, `DATABASE_POOL_MAX` (invalid values stop the server); `src/server/config.ts`, `src/db/client.ts` | Internal | – |
| 11.14 | API docs | Swagger UI at `/api/docs` (pinned `swagger-ui-dist` 5.32.15 with SRI) and the spec at `/api/v1/openapi.json`. Code default: on only with `APP_ENV=local`. Dev and UAT set `DOCS_ENABLED=true`. Production keeps it empty (off). | env `DOCS_ENABLED`; `src/server/api/docs.ts` | Decided | Mayur, 18-10-2026 (Q9): Swagger UI on in Dev and UAT; off in production unless asked. |
| 11.15 | Response key style | snake_case keys, the same objects as the iframe (`scheme_tag`, `lock_status`, ...). Not PascalCase as in the Other Scheme API. | `src/server/repo.ts`, `docs/api-contract.md` | Decided | Mayur, 17-10-2026 (Q1, CLAUDE.md decision 12). |
| 11.16 | Error envelope | `{"error": {"code", "message"}}` on the data endpoint and the JSON 404. The token endpoint keeps the RFC 6749 format `{error, error_description}`. | `src/server/api/dealer-status.ts`, `src/server/api/pipeline.ts`, `src/lib/auth/token-endpoint.ts` | Decided | Mayur, 17-10-2026 (Q3). |
| 11.17 | Contract changes and `OPTIONS` | 413 `PAYLOAD_TOO_LARGE` for an oversized body, 403 `INSUFFICIENT_SCOPE`, 503 `SERVICE_BUSY`, JSON 404 `NOT_FOUND`. `OPTIONS` stays 204 with `Allow` and no CORS headers. | `docs/api-contract.md` 12.1 | Decided | Mayur, 17-10-2026 (Q4). |
| 11.18 | Real dealer codes in git | Real dealer codes are replaced in the tracked files only. The git history is not rewritten. `qa/test-data/dealers.json` and the QA outputs are git-ignored. The hygiene scan (`qa/security/run_scans.sh hygiene`) checks that no 10-digit `6xxxxxxxxx` code is in a file that git would commit. DEMO codes are synthetic. | `.gitignore`, `qa/security/run_scans.sh` | Decided | Mayur, 17-10-2026 (Q11). |
| 11.19 | Unusual HTTP methods | `TRACE` on every path, and methods other than GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS on `/api` paths, get 405 `METHOD_NOT_ALLOWED` JSON (404 `NOT_FOUND` on an `/api` path with no route) from the method guard. Next.js cannot pass these methods to a route. The reverse proxy should also refuse `TRACE`. | `src/server/method-guard.ts`, `src/instrumentation.ts` | Internal | – |
| 11.20 | Unknown scheme tag message | 400 `UNKNOWN_SCHEME_TAG` names the tag only when it matches `^[A-Za-z0-9_-]{1,32}$`. Otherwise the message is `A scheme tag does not exist.` (no echo of the input). | `src/server/api/dealer-status.ts` (`unknownTagMessage`) | Internal | – |
| 11.21 | Redis at startup | The server opens the Redis connections when it starts. A request that finds a connection in progress waits for it (at most 500 ms for the rate limits, 1 s for the cache). A `redis_unavailable` line is written only when a Redis user changes from up to down (at most one line every 30 s for each user). | `src/server/redis.ts`, `src/server/startup.ts` | Internal | – |
| 11.22 | Redis in production | The client's DevOps team provides Redis. `REDIS_URL` accepts `redis://` (no TLS) and `rediss://` (TLS), each with an optional user name and password in the URL (percent-encoded). ioredis reads the password and the db number from the URL; the app makes the scheme lower case, so that `REDISS://` also uses TLS. Any other value stops the server at startup, with a message that does not show the URL. Logs never show the URL or the password (`redisErrorText`, `redactRedisUrl`). Outside `APP_ENV=local`, a startup warning names a URL with no TLS or no password. Recommendation: `rediss://` and a password when Redis is not on a private network. | env `REDIS_URL`; `src/server/redis-url.ts`, `src/server/redis.ts`, `src/server/config.ts`; tests `src/server/redis.test.ts`, `src/server/config.test.ts` | Decided / Open | Decided (Mayur, 18-10-2026, Q7): DevOps provides Redis. **Open for DevOps:** TLS or not (`rediss://` or `redis://`), the host, the port and the password for each environment. |
| 11.23 | Write scope for the reward choice | `POST /api/v1/dealer-reward-choice` needs the scope `choices:write`. Only clients in `AUTH_WRITE_CLIENTS` (comma-separated, each must be in `AUTH_CLIENTS`, else the server does not start) get it. A token request with no `scope` gets all scopes of the client. Read-only clients are not affected. New error code 409 `CHOICE_NOT_ALLOWED`. The response cache key prefix is now `scheme:v2`; a saved choice change increases the data version. | env `AUTH_WRITE_CLIENTS`; `src/lib/auth/jwt.ts`, `src/lib/auth/token-endpoint.ts`, `src/server/config.ts`, `src/server/cache.ts` | Open | Which client systems may write (SAP Commerce, SFA) in each environment. Empty on Dev, UAT and production until then. |
