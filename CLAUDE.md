# CLAUDE.md – scheme-calculator

This file gives Claude the context for this repository. Read it before you start work.

## 1. What this project is

- A **dealer scheme calculator** for **Acme Paints** (paints). A vendor builds it for the client.
- The system calculates, for each dealer, which **slab** of a sales scheme the dealer has unlocked. It shows the benefit: **gift** (gold voucher or trip) or **CN** (credit note).
- The system shows the result in a **custom iframe**. The client embeds this iframe in their **SAP Commerce (DMS) / SFA e-commerce** applications. The iframe is the **first option**. A dealer status **API is the second option**. Build the API only if it is needed, after the iframe product works.
- **Stack: Next.js (TypeScript) full stack + own PostgreSQL database.** Sales data comes from BigQuery. Do **not** use Frappe.
- Owner: Mayur Chaudhary (developer). Acme lead: the client lead.

## 2. Status and scope (16-10-2026)

- Phase 1 works end to end on real BigQuery data: sync → engine → iframe dealer view → admin report. All 3 schemes are seeded from the circulars. Typecheck, lint, tests and the production build pass. Nothing is committed yet. Open items are in `docs/assumptions.md`.
- **Target:** a **working product as soon as possible.** There is no fixed date.
- **Rule:** build a working end-to-end product now. If data or a decision is missing, do not stop. Use a default that is easy to change, mark it, and continue (see section 11). Add the missing parts later.
- **Phase 1 scope – all 3 schemes must work:**

| Tag | Scheme | Circular (file in `../scheme-calculator-context/circulars/`) |
|---|---|---|
| FB-PAN | Festive Bonanza Oct–Nov'26 – Pan India except TNN, TNS, HP & JK | ACME/SALES/Oct-Nov'26-FY27-GIFT SCHEME/1st Oct 2026 – `festive-bonanza-oct-nov26-pan-india-except-tnn-tns-hp-jk.pdf` |
| FB-TNHPJK | Festive Bonanza Oct–Nov'26 – TNN, TNS, HP & JK | ACME/SALES/Oct-Nov'26-FY27-GIFT SCHEME/1st Oct 2026 – `festive-bonanza-oct-nov26-tnn-tns-hp-jk.pdf` |
| SP-Q3 | Star Points Q3 FY 2026-27 – Pan India | ACME/SALES/Q3-FY27-SCHEME/1st Oct '26 – `star-points-q3-fy27-pan-india.pdf` |

  The tags were renamed from the meeting examples ABC1, ABC2, ABC3 on 22-10-2026 (Mayur; no alias for the old tags, `docs/api-contract.md` 12.4). The tags are in `SCHEME_TAGS` in `src/config/schemes.ts` only, not in the environment: a tag keys the stored data, so a rename needs a code change and a migration.
- **Phase 1 delivery:** the iframe dealer view and the admin report.
- **Scheme setup in phase 1:** hard-code all 3 schemes from the circulars (section 3): dates, channels, region scope, product scope and exclusions, slabs, growth %, benefits, Star Points points and categories. Keep them as configuration data in one place, not spread through the code. **There is no Excel template upload in phase 1.**
- **Phase 2 (decision, Mayur, 16-10-2026): the dealer status API**, not the Excel upload. `POST /api/v1/dealer-scheme-status` returns the same dealer status as the iframe (`docs/api-contract.md`).
- **Deferred (no date):** the Excel template upload (template v3.0), so that the business team can add new schemes without a code change. The upload must write the same configuration that phase 1 hard-codes. Until then, a new scheme needs a change in `src/config/` and `npm run db:seed`.

## 3. Reference material

The source files are **outside this repository** and **not in git**: `../scheme-calculator-context/`. It has two sub-folders, `circulars/` and `requirements/`. Use these files as the source of truth for scheme rules. Do not invent rules or values that are not in them.

| File (in `../scheme-calculator-context/`) | What it contains |
|---|---|
| `requirements/festive-bonanza-scheme-requirements.md` | Requirements note v1.3: client decisions, template v3.0, scheme rules, output, open items. Note: it says "Frappe" and "API or iframe". The later decisions are **Next.js + PostgreSQL** and **iframe first** (see section 1). |
| `requirements/dealer-scheme-status-api.yaml` | Draft OpenAPI contract (Frappe, v1.0.0-draft). This is the **second option**, built only if needed after the iframe product works. |
| `circulars/*.pdf` | The three scheme circulars (see section 2). The Star Points circular has the product list for each points category (Table III). |

The repository has summaries of these files. Read them first. They are enough when the folder is not available:

| In-repo file | What it contains |
|---|---|
| `docs/scheme-rules-reference.md` | Circular terms that affect eligibility or payout but are not in the engine (OD at payout time, MRV, no monetisation, trips, visa, cancellation, ad-hoc bonus points, new products). Each term is marked engine / payout-time / open item, with the circular page and point. |
| `docs/template-v3.md` | Template v3.0: full column list, Include / Exclude and Applies To rules, ABC4 example, open items for the upload phase. |
| `docs/api-contract.md` | The current contract of the built dealer status API (endpoint, auth, request, response, errors, limits) and the changes from the Frappe draft. `docs/openapi.json` is the OpenAPI 3.0.3 copy. It is also the data shape of the dealer view. |
| `docs/assumptions.md` | Defaults for the open items, BigQuery mapping, region and product matching. |

If a source file conflicts with this CLAUDE.md, follow this CLAUDE.md (it has the later decisions) and tell Mayur about the conflict.

## 4. Data sources

- Sales and billing data: BigQuery project `example-project`, dataset `Testdb`, tables `zsd_sales` and `zsd_billing`.
- `customer_code` in the sales data is the **dealer code**.
- Dealers have parent–child relations. Both parent and child codes appear in the sales data. Use `Testdb.parent_child` to resolve them. This table is refreshed each month, on about the 5th or 6th.
- Dealer code and GSR come from the client lead's database.
- Product, region and dealer masters, and the dealer's reward choice (gift or CN), come from the backend data.
- The **scheme rules** come from the circulars. BigQuery does not have them. In phase 1 they are hard-coded (section 2). In a later phase the Excel upload supplies them.
- **BigQuery is the source of all sales data.** Sales data comes from GCS into BigQuery. Do not copy the raw sales rows into PostgreSQL.
- The application stores only these in its **own PostgreSQL database**: the scheme configuration, the per-dealer totals that it gets from BigQuery (for example monthly GSR, litres by category), and the calculated results.
- The BigQuery column list is not confirmed yet. Before you write a query, check the real schema. Do not guess column names.

## 5. Key decisions

From the client meeting, 16-10-2026. Decisions 1–5 and 7 are about the Excel template. They apply to the later upload phase. Design the phase 1 configuration so that it can follow them.

1. **One template** for all schemes. **Scheme Tag** is the key. One tag has many rows.
2. Exclusion is a column in the same template (Include / Exclude). In one row, all filled columns combine with **AND (&&)**. Example: Region = Maharashtra North AND Depot = 1105. Because each cell has one value, several values for one column need several rows. Include rows add scope: several Include rows with values in the same column combine with OR (any value matches), and different columns must all match (AND). An Exclude row removes scope only when all its filled cells match together. Example tags from the meeting: ABC1, ABC2, ABC3 (the 3 phase 1 schemes, now `FB-PAN`, `FB-TNHPJK`, `SP-Q3`) and ABC4 = depot and benefit exclusion example (from the meeting). Assumption, not in the source: ABC4 may be the Region = Maharashtra North AND Depot = 1105 example, and the benefit exclusion may use Applies To. Confirm with the client.
3. **One value per cell.** No comma-separated values (about 9,000 SKUs).
4. **Empty cell = all eligible.**
5. Inclusion at product level. Exclusion at product or SKU level. SKU level is necessary for the benefit calculation.
6. Slab conditions are **hard-coded** for the current schemes. Make them parameters later.
7. The business team uploads the template. Users see only the upload screen.

Template v3.0 (one sheet) columns: Scheme Tag*, Scheme Name*, From Date*, To Date*, Channel, Zone, Region, Area, Depot, Product Code, SKU Code, Include / Exclude*, Applies To, Remarks, Row Check (* = mandatory). The template does not change for a new scheme. **Applies To:** `QUALIFICATION_AND_BENEFIT` (default) or `BENEFIT_ONLY` ("Benefit only": the sales count for the slab, but the matched rows get no benefit). Phase 1 uses only the default. Details and open items: `docs/template-v3.md`.

Later decisions (Mayur, 16-10-2026):

8. Delivery to SAP Commerce / SFA is a **custom iframe**. The API is the second option.
9. **No Frappe.** Build on **Next.js (TypeScript)** with an **own PostgreSQL** database.
10. **Phase 1 hard-codes the 3 schemes from the circulars.** No Excel upload in phase 1. The upload comes in a later phase.
11. **Phase 2 is the dealer status API, not the Excel upload** (Mayur, 16-10-2026). The Excel upload is deferred. Phase 1 (iframe and admin report) goes to the client first.
12. **API keys stay snake_case** (Mayur, 17-10-2026). The dealer status API returns the same objects as the iframe (`scheme_tag`, `lock_status`, ...). Do not change them to PascalCase, although the other Acme API (`other-scheme-api`) uses PascalCase. Phase 2 matches that project's features (OAuth2 client credentials, Redis rate limiting and cache, QA suite), not its key style.
13. **Phase 2 API decisions** (Mayur, 17-10-2026):
    - Real dealer codes: never in tracked files. They were replaced in the files; the git history is not rewritten.
    - Contract changes accepted: an oversized body gives 413; new codes `INSUFFICIENT_SCOPE` (403), `SERVICE_BUSY` (503), `NOT_FOUND` (404 JSON). The error envelope stays `{error:{code,message}}`.
    - OAuth scope: `schemes:read` (the same as the other Acme API). Issuer and audience: `scheme-calculator`.
    - Health endpoint: readiness (it checks the database, value kept for 15 s).
14. **Phase 2 environment decisions** (Mayur, 18-10-2026):
    - Per-client rate limit: 1,00,000 requests a minute (`API_RATE_LIMIT_PER_MINUTE=100000`), not 600.
    - Redis in production: the client's DevOps team provides it. TLS (`rediss://`) is not decided yet; the app supports `redis://` and `rediss://` with a password.
    - Domains: example, the same pattern as the other Acme API (`dev.scheme-api.example.com`). Dev: `https://dev.scheme-calculator.example.com`. UAT and production hosts: same pattern, to be confirmed.
    - Swagger UI (`DOCS_ENABLED=true`) on Dev and UAT. Off in production.
    - `TRUSTED_PROXY_HOPS`: open. Ask DevOps how many proxies are in front of the app (nginx only = 1).
15. **Reward choice (gift or CN)** (Mayur, 22-10-2026):
    - Acme gives the choices by Excel (admin upload `/admin/choices`) or by `POST /api/v1/dealer-reward-choice` (scope `choices:write`, the SFA system's client in `AUTH_WRITE_CLIENTS`). Admin-area users can also enter one choice on the dealer page.
    - No sales officer ID. More admin-area users in `ADMIN_USERS` (`npm run admin:user`); role `CHOICES` sees only Dealers and Reward choices.
    - The iframe (DMS and SFA) shows the saved choice and the final benefit, read-only.
    - Only a dealer in a slab can choose. The choice never locks. An uploaded row for a dealer with no slab is refused. The change log is kept 3 months.
    - History on `/admin/choices` (22-10-2026): one entry per file upload (`reward_choice_upload`), and one entry per day and sender for the API (`client_id`) and the dealer page, with a CSV download of the changed rows (from the log: `actor`, `upload_id`). The uploaded file is not stored. No delete or undo: a corrected upload replaces the choice.
    - Star Points Slab 7: the destination (cruise or Overseas Tour) picks the extra-benefit rule. Keep the circular rule: extra tickets (or their CN) or ₹18,500 CN for every 26,000 points. Final benefit shown: gift = extra tickets (or their CN); CN = ₹18,500 for every 26,000 points.
    - Do not create scheme rules that are not in the circulars.

## 6. Common rules (all 3 schemes)

- **GSR = DPL − in-bill discounts.**
- Base period: **Q1 FY 2026-27** (01-04-2026 to 30-06-2026). Q1 monthly average = Q1 GSR ÷ 3.
- **Zero Q1 sales = not eligible** (BA, 19-10-2026). If the dealer had no Q1 FY 2026-27 sales of **any product** (sync metric `total_gsr`), the growth condition is not met, so the dealer is in no slab (`zeroBaseGrowthRule: "MET_IF_ANY_BASE_SALES"`, FB-PAN and SP-Q3). A dealer who had Q1 sales (any product) passes on a zero scheme base, and a dealer with growth ≥ 100% is eligible as usual. FB-TNHPJK has no growth condition and is not affected.
- **Slab classification rule (from Mayur, 16-10-2026):**
  1. Check the slabs in order: Slab 1, then Slab 2, then Slab 3, and so on.
  2. A dealer meets a slab only when **all** conditions of that slab are true. The conditions combine with **AND (&&), never OR.** If one condition fails, the slab fails.
  3. Stop at the first slab where **any one** condition is not met. The dealer is in the **previous slab**.
  4. If any condition of Slab 1 is not met, the dealer is in **no slab**.
  5. In the dealer view, only the slab that the dealer is in is **UNLOCKED**. All other slabs, also the lower slabs, are **LOCKED** (client lead and Mayur, 22-10-2026). The dealer view and the admin dealer page do not show the conditions (met / not met) or the material returns. The engine still calculates the conditions, and the API still returns them.
- Example (two conditions, A and B):

| Slab | Required A | Required B |
|---|---|---|
| 1 | 10 | 5 |
| 2 | 15 | 10 |

| Dealer achieved | Slab 1 | Slab 2 | Result |
|---|---|---|---|
| A = 16, B = 3 | B not met (3 < 5) | – | **No slab** |
| A = 17, B = 9 | Met | B not met (9 < 10) | **Slab 1** |

- Test this rule with these two cases.
- A dealer can join **Festive Bonanza or Star Points, not both.**
- Deduct material return value (MRV), including returns up to 1 month after the scheme end date. Results are **provisional** until then. Circular: MRV "from any time of the year" is subtracted from the scheme-period achievement (FB p2 and SP p9, point 6). Default: deduct all return billing types billed in the scheme period and the return window, whatever the original invoice date. Open: the client must confirm that returns billed before the scheme start do not count (`docs/assumptions.md` 2.9).
- No benefit if the dealer has OD in any account on the OD check date (Festive Bonanza 30-11-2026, Star Points 31-12-2026). The dealer must also have no OD at the time of gold voucher disbursement, travel or CN settlement (FB p2 and SP p9, OD Criteria 1). The engine checks only the OD check date. The later checks are a payout-time check outside the engine.
- No monetisation: the circulars give no pro-rata benefit for GSR or points between slabs or above a slab (FB p2 and SP p9, point 4). A dealer gets only the benefit of the slab reached. Star Points also has the extra Trip/CN rules in section 8.
- New products launched in the scheme period are announced by Acme Paints. Festive Bonanza: they count automatically, unless they match an exclusion. Star Points: they count only after they are added to `src/config/star-points-products.ts` with a category (`docs/assumptions.md` 2.11).
- Amounts in the circulars are in **₹ lakh** for GSR slabs. Store and calculate in **INR**.

## 7. Festive Bonanza (FB-PAN and FB-TNHPJK)

- Period: 01-10-2026 to 30-11-2026. Channel: Trade and Franchise only.
- Products: all Trade products **except** Distemper, Colorants, Style Aluminium Paint and Venture 15/25/Roller.
- Slab conditions (all must be true):
  1. Oct + Nov GSR ≥ slab GSR.
  2. Oct GSR ≥ slab minimum.
  3. Average of Oct and Nov GSR ≥ Q1 monthly average × (1 + growth %). **FB-PAN only.** FB-TNHPJK (TNN, TNS, HP & JK) does not have this condition.
- OD check date: 30-11-2026.
- Circular example (FB-PAN): Q1 = ₹4.5 lakh → average ₹1.5 lakh a month → +20% = ₹1.8 lakh a month → ₹3.6 lakh in Oct + Nov, with minimum ₹1 lakh in Oct → Slab 1, gold voucher ₹5,000.

| Slab | Oct + Nov GSR (₹ lakh) | Min Oct GSR (₹ lakh) | Growth (FB-PAN only) | Gold voucher (₹) | CN alternative (₹) |
|---|---|---|---|---|---|
| 1 | 2.5 | 1 | 20% | 5,000 | 4,500 |
| 2 | 4.0 | 1.5 | 20% | 8,000 | 7,200 |
| 3 | 6.0 | 2.5 | 15% | 12,000 | 10,800 |
| 4 | 8.0 | 3 | 15% | 18,000 | 16,200 |
| 5 | 10.0 | 4 | 15% | 24,000 | 21,600 |
| 6 | 12.0 | 5 | 10% | 30,000 | 27,000 |
| 7 | 15.0 | 6 | 10% | 40,000 | 36,000 |

- Gold voucher brand: Jeweller A / Jeweller B / reputed brand (circular p1 footnote). The company can change the brand and the voucher company (circular p2 points 8–9).

## 8. Star Points Q3 FY 2026-27 (SP-Q3)

- Period: 01-10-2026 to 31-12-2026. Pan India.
- Channel: Trade (including Franchise stores) and Channel 12 (Institutional). In Channel 12 billing, only the Trade products of Acme One Emulsions topcoats in the product list count.
- Only products in the 5 categories of Table III count: **Luxury, Premium, Economy, Enamels, Others.** No other product counts.
- **Points = litres purchased × points per litre** for the category. Points per litre = base + bonus for that month.
- Free packs give no points (Mayur, 23-10-2026). A free pack is a SKU with `test_product.paidfree` = Free (GSR 0, for example "XNSS ... 1L").

| Points per litre | Luxury | Premium | Economy | Enamels | Others |
|---|---|---|---|---|---|
| Base (whole period) | 14 | 6 | 3 | 3 | 2.5 |
| Bonus Oct'26 | 16 | 7 | 3 | 3 | 0 |
| Total Oct'26 | 30 | 13 | 6 | 6 | 2.5 |

- Bonus points for Nov and Dec are announced at the start of each month. They are **not known yet**. Keep them as configuration, not code.
- Besides the monthly per-litre bonus, Acme Paints may announce additional bonus points from time to time. These are added to the total points (SP p2, Points Earning Mechanism 5). Default: none. Open item: the form of these bonuses (per litre, per product, or a lump sum) and the configuration field for them (`docs/assumptions.md` 2.10).
- Tools (Rollers, Sandpapers, Masking Tapes): **400 points for each ₹15,000 GSR.**
- Slab conditions (all must be true):
  1. Total points ≥ slab points.
  2. Q3 GSR ≥ Q1 FY 2026-27 GSR × 1.10 (growth 10%). Beyond Slab 7, the growth needed is 5%. The growth GSR is the dealer's **total GSR of all products** in the scheme channels, not only Table III (BA, 19-10-2026).
- OD check date: 31-12-2026.

| Slab | Points | Benefit | Growth | CN alternative (₹) |
|---|---|---|---|---|
| 1 | 85,000 | Gold voucher ₹65,000 (Jeweller A / Jeweller B) | 10% | 55,000 |
| 2 | 1,10,400 | 1 ticket 4N5D Island cruise (or equivalent) | 10% | 78,000 |
| 3 | 1,36,000 | 1 cruise ticket + ₹18,000 CN | 10% | 96,000 |
| 4 | 1,61,000 | 1 cruise ticket + ₹36,000 CN | 10% | 1,14,000 |
| 5 | 1,87,000 | 1 cruise ticket + ₹54,000 CN | 10% | 1,32,000 |
| 6 | 2,17,000 | 2 cruise tickets | 10% | 1,56,000 |
| 7 | 2,25,000 | 1 ticket 4N5D Overseas Tour | 10% | 1,62,000 |

- Above the top slabs (from the circular):
  - Beyond 2,17,000 points: 1 more cruise ticket (or CN ₹78,000) for each 1,06,000 points, **or** ₹18,500 CN for each 26,000 points.
  - Beyond 2,25,000 points: 1 more Overseas Tour ticket (or CN ₹1,62,000) for each 2,11,000 points, **or** ₹18,500 CN for each 26,000 points.
  - A dealer can select only one trip destination: Overseas Tour or the Island (or equivalent) cruise (SP p2). The two extra-benefit rules are alternatives, not additive. The dealer view must not add them together. Cruise text: 'Island Cruise (or equivalent)'. Destinations can change to an equivalent location (SP p9 point 22).
- Gift value is null for trips. Show the trip text and the CN alternative.
- Fewer tickets: if a dealer qualifies for several tickets and travels on fewer, the dealer gets CN for each ticket not used, at the 1-ticket CN value of that trip (cruise ₹78,000, Overseas Tour ₹1,62,000) (SP p2, Scheme related Key Points 1). This is a payout-time rule. The calculation of the slab does not change. The dealer view does not show this option now.
- Visa rejected: the dealer can take the CN alternative of the slab (SP p9 point 18). This is a payout-time rule. It does not change the slab calculation.
- Late cancellation: if the dealer cancels a confirmed trip booking within 60 days of the travel date, the dealer loses the slab CN (SP p9 point 14). This is a payout-time rule. It is not in the engine.
- Other trip terms (travellers, passport, documents): `docs/scheme-rules-reference.md` section 5.2. TDS and other common terms: section 3 of that file.

## 9. Output

- **Dealer view (iframe):** for each scheme the dealer is in, show a header (scheme name, dates, Q1 FY 2026-27 monthly average, monthly GSR, growth, and points for Star Points) and all slabs with **LOCKED / UNLOCKED** (as the slab classification rule in section 6 sets them), the gift and the CN. For a scheme the dealer is not in, show the reason. Use the client mock-up layout (Book2.xlsx) and the data shape in `docs/api-contract.md`. Below each scheme: a closed "Scheme terms and conditions" section (also in the admin report) with only the circular terms that affect the calculation or the payout (Mayur, 22-10-2026; text in `src/config/scheme-terms.ts`).
- **Upload screen (later phase, not phase 1):** the business team uploads the scheme template (template v3.0, `docs/template-v3.md`). Validate each row and show the errors. Region, depot, channel, product and SKU values must exist in the masters (`customer_attributes`, `test_product`). Reject a row with an unknown value and show the error.
- **Admin Dealers page** (22-10-2026): a list of all dealers of one scheme (scheme dropdown, default FB-PAN), with an eligibility filter (Unlocked / Locked / All with counts; Unlocked first and the default), an optional code or name search, and 50 rows a page. Columns: Dealer code, Name, Region, Eligibility (Unlocked / Locked), Slab. A click on the code or the slab opens the dealer page for that scheme (no arrow next to the slab). Filters from the report links: `slab=N` and `scope=in`, shown as removable chips next to the All tab. Ineligible dealers stay in the list. Left out: no sales data for the scheme (`NO_DATA`) and region in another scheme (`REGION_NOT_IN_SCOPE`).
- **Admin report:** for each scheme, the slab table of the circular (Table I: same columns and order) plus a Dealers column, and the counts in scope / in a slab / no slab / not in scope. Each count, except "Not in scope", links to the Dealers page with the same number (22-10-2026): slab row → `slab=N`; Total and "In a slab" → Unlocked; "In scope" and "In scope, no slab" → `scope=in` (without the region-unknown and other-scheme dealers that the Locked and All tabs also list). All admin table headers: bold, one size bigger than the data. The gift / CN split, the Star Points destination split and "On hold (overdue)" (OD) are hidden; the link "Show reward choice columns" (`/admin?choices=1`) shows them (the client sends this data later). No reason tables (client lead and Mayur, 22-10-2026: not a client requirement).
- **Reward choice:** the admin upload `/admin/choices`, the form on the admin dealer page and the API `POST /api/v1/dealer-reward-choice` all write `dealer_reward_choice` (one row per dealer and scheme) and the audit log `dealer_reward_choice_log` (decision 15). The iframe shows the choice read-only.

## 10. Technical guidelines (Next.js + PostgreSQL)

- One Next.js app (TypeScript, strict mode) holds:
  - the **iframe dealer view** (an embed page),
  - the **admin area**: the report (and the template upload in a later phase),
  - the **API route** (phase 2): `POST /api/v1/dealer-scheme-status`, API key per client system. It calls the same `getDealerStatus` function as the iframe.
  - the **iframe token route** `POST /api/v1/embed-token` (22-10-2026): the host back end gets a signed `/embed` URL for the logged-in dealer and does not need the signing secret. Full host integration: `docs/api-contract.md` section 14.
- **Data flow:**
  1. A **sync job** runs aggregate queries in BigQuery (server side only): GSR per dealer per month, Q1 FY 2026-27 GSR, returns, and litres by category. It applies the parent–child mapping. It writes only these totals to PostgreSQL.
  2. The **scheme engine** runs after each sync. It calculates the status of each dealer for each scheme and stores the result in PostgreSQL.
  3. The iframe page and the report **read the stored results**. Do not calculate on each page load. Do not query BigQuery from a page request.
- Keep the **scheme engine** as plain TypeScript functions in its own module, with no dependency on Next.js or the database. Give it unit tests (start with the two cases in section 6). One server-side function builds the dealer status in the shape of `docs/api-contract.md`. The iframe page and the API route (`src/app/api/v1/dealer-scheme-status/route.ts`) use this function, with no change to the engine.
- Keep scheme rules (slabs, points per litre, bonus points) in one place, so that a later phase can make them parameters.
- **Scheme configuration:** put the 3 schemes from the circulars into the database as seed data. The engine reads them from there. The later upload screen writes to the same tables.
- **Embedding:** allow framing only from the client's SAP Commerce / SFA domains (CSP `frame-ancestors` header). Read the domain list from configuration. Do not allow all origins.
- **Dealer identity:** the host application must tell the iframe which dealer is logged in. Do not trust a plain dealer code in the URL, because a user can change it (see section 11 for the default).
- Make the iframe page responsive. SFA can run on mobile devices.
- Use a schema migration tool for PostgreSQL. Record the tool and the commands in section 13 when you set up the project.
- Proposal for performance: expand the include / exclude rules into a flat dealer × product scope table when the scheme configuration loads. The engine then reads that table. This is not yet decided.
- Keep secrets (BigQuery service account key, database URL, iframe signing secret) in environment variables. Never commit them. `.gitignore` excludes `.env` files. Commit a `.env.example` with the variable names only.

## 11. Open items – do not block the build

These items are not confirmed. **Do not stop work for them.** Build with the default below. Put each default in configuration (not in hard-coded logic), so that it is easy to change. Record each default in `docs/assumptions.md` and keep that file current. When the client confirms an item, change the configuration and update the file.

| Open item | Default for now |
|---|---|
| Iframe dealer identity (how SAP Commerce / SFA passes the logged-in dealer) | Signed token in the iframe URL (dealer code + expiry, signed with a shared secret). In development only, allow a plain `dealer_code` parameter for testing. |
| Domains that may embed the iframe | A configuration list. Empty in development. Fill it when the client gives the domains. |
| Admin login (admin report) | Simple login with credentials from environment variables. Replace later if the client needs SSO. |
| BigQuery column names | Check the real schema before you write queries. Record the mapping in `docs/assumptions.md`. |
| Slab 1 gift value (Festive Bonanza): meeting ₹4,000, circular ₹5,000 | Use the circular: ₹5,000 (CN ₹4,500). |
| Excluded products in Festive Bonanza (Distemper, Colorants, Style Aluminium Paint, Venture 15/25/Roller). The circulars name them by category or brand, not by product code. | Match them to product codes with the category and brand fields of the product data in BigQuery. Record the matched codes in `docs/assumptions.md`. |
| Which scheme a dealer joined (Festive Bonanza or Star Points) | A dealer–scheme enrolment record. If a dealer has no record, calculate all schemes in scope and show all of them. |
| Star Points bonus points for Nov and Dec | Configuration values. Use 0 until the client announces them. |
| Star Points product categories and litres | Use the data if BigQuery has them. If not, load the category list from Table III of the circular and flag the litres gap. |
| Slab editing (frontend or backend) | Backend configuration only. No frontend editing in phase 1. |
| Lower growth % in higher slabs (Festive Bonanza FB-PAN: 20% → 15% → 10%). A dealer can fail Slab 1 on growth but meet all conditions of Slab 3. Example: Oct ₹3L, Nov ₹3.5L, growth 17%. | Follow the slab classification rule (section 6): stop at the first failed slab, so the result is **no slab**. Keep a flag in configuration so that the rule can change to "highest slab with all conditions met" (result: Slab 3) if the client asks. |
| Region names in the circulars (TNN, TNS, HP, JK) | Match them to the region values in the BigQuery data. Record the mapping in `docs/assumptions.md`. A dealer with no region value goes to the report as "region unknown". |

## 12. How to work with Mayur

- Write documents in **ASD-STE100** (Simplified Technical English): short sentences, active voice, one instruction per sentence.
- Use only the source materials for scheme rules. Do not invent rules or values. If data is missing, use a clearly marked default (section 11), tell Mayur, and continue. Do not stop the build.
- Show a preview (diagram, mock-up or draft) before you make a final file.
- Make outputs that open directly in their target application (for example, native `.drawio` XML for draw.io).
- Speak in English.
- Git: the remote is `origin` → `github.com/MMC1410001/dealer-scheme-calculator` (private). The default branch is `main`. Commit or push only when Mayur asks.

## 13. Commands

Run all commands from the repository root. Every script and the server read `.env`.

**Environment files** (repository root, git-ignored): `.env` = local, `.env.dev`, `.env.uat`, `.env.prod`. Plain `npm run <script>` uses `.env`. To run a script with another environment: `npm run env -- <dev|uat|prod> <script> [args]` (for example `npm run env -- dev db:migrate`). `.env` is not changed, and the keys still marked `TODO_` are listed. On a server, deploy that environment's file as `.env`. Do not name a file `.env.local`, `.env.development` or `.env.production`: Next.js loads those automatically and they would override `.env`. `.env.example` describes each key. Dev, UAT and prod use the database of the Other Scheme API project for now (same database, own tables).

**Install**

```
npm install
```

**Local PostgreSQL (development only, `docker-compose.yml`)**

The Docker files (`docker-compose.yml`, `Dockerfile`, `.dockerignore`) and all `*.yaml` / `*.yml` files are for local use only. Git ignores them. Never add them to git: the client's DevOps team owns the pipeline.

```
docker compose up -d       # Postgres 17 on localhost:5433, volume scheme-calc-pgdata
docker compose down        # stop (data stays in the volume)
```

Set `POSTGRES_PASSWORD` and `DATABASE_URL=postgres://scheme:<password>@localhost:5433/scheme_calculator` in `.env`. Without Docker Compose, use the same container directly:

```
docker run -d --name scheme-calc-pg -e POSTGRES_USER=scheme -e POSTGRES_PASSWORD=<choose> -e POSTGRES_DB=scheme_calculator -p 5433:5432 -v scheme-calc-pgdata:/var/lib/postgresql/data postgres:17-alpine
```

**Database (migration tool: drizzle-kit)**

| Command | What it does |
|---|---|
| `npm run db:generate` | Make a new SQL migration in `drizzle/` from `src/db/schema.ts` (drizzle-kit). Run it after each schema change. |
| `npm run db:migrate` | Apply the migrations in `drizzle/` to `DATABASE_URL`. |
| `npm run db:seed` | Write the 3 schemes from `src/config/` to the database, then run the engine again so that the results follow the new configuration (for example a new Star Points monthly bonus). Safe to run again. `-- --no-engine`: configuration only. |
| (server start) | Automatic setup (`DB_AUTO_SETUP`, default on; Mayur, 26-10-2026; `src/server/db-setup.ts`): apply new migrations before requests (a failure stops the server), then in the background seed when the `src/config/` rows changed (hash in `app_state`) and run the engine after a seed or a new build (`.next/BUILD_ID`). DevOps runs none of `db:migrate`, `db:seed`, `engine:run` after a deployment. The deployment must include `drizzle/`. |
| `npm run db:cleanup` | Delete the dealer totals that no active scheme needs (scheme not active, or month outside its base, period and return-window months), and sync-run logs older than 6 months that no row refers to. The daily scheduled sync runs it after each successful sync. After a delete, it runs `VACUUM (ANALYZE)` on that table (never `VACUUM FULL`). `-- --dry-run` shows the counts only. |

**BigQuery authentication (one of the three)**

- `gcloud auth application-default login` (developer machine). Leave `GOOGLE_APPLICATION_CREDENTIALS` empty.
- `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json` in `.env` (server). Never commit the key file.
- `BIGQUERY_CREDENTIALS_JSON=<base64 of the key file>` in `.env` (server, no file to mount). It wins over the key file. Make the value with `base64 -w0 key.json` (macOS: `base64 -i key.json`). Never commit it.

**BigQuery sync and engine**

| Command | What it does |
|---|---|
| `npm run sync:bigquery -- --dry-run --no-sql` | Show the bytes that each query will scan. Nothing runs and nothing is written. Do this first. |
| `npm run sync:bigquery -- --dry-run` | Same, and print the SQL. |
| `npm run sync:bigquery` | Routine sync: scheme period and return window only (about 160 MB in total), then the engine. A scheme with no stored Q1 base also gets its base query once. |
| `npm run sync:bigquery -- --base` | Also read the Q1 FY 2026-27 base again (about 4.6 GB). Use it only when the base data changes. |
| `npm run engine:run` | Calculate the results again from the stored totals. Only changed results are written (the output shows `changed` and `removed`). Options: `-- --today=YYYY-MM-DD`, `-- --sync-run=<id>`. |
| `npm run bq:inspect` | Print the column list of the BigQuery tables (metadata query, no table scan). Add table names to limit it. |

Byte limits: `BIGQUERY_MAX_BYTES_BILLED` (routine, default 1 GB) and `BIGQUERY_MAX_BYTES_BILLED_BASE` (`--base`, default 5 GB). A query above the limit stops. In BigQuery a `LIMIT` does not reduce the bytes scanned. Only the `billing_date` partition filter and the column choice reduce them. For a manual `bq` check on `zsd_sales`: filter on `billing_date`, select few columns, add `LIMIT`, run `--dry_run` first, and set `--maximum_bytes_billed`.

**Demo data and tokens**

| Command | What it does |
|---|---|
| `npm run data:demo` | Load the synthetic test dealers (`DEMO0001` to `DEMO0014`, `DEMO-C1`) and run the engine. A real sync does not touch `DEMO%` rows. |

`db:seed`, `engine:run`, `data:demo` and `db:cleanup` (not `--dry-run`) hold the same database lock as the BigQuery sync. When a sync or another of these runs is in progress, the command stops at once with exit code 1 and writes nothing. The sync and the engine write only changed rows (`IS DISTINCT FROM` guards), so an unchanged re-send makes no dead rows.
| `npm run token:sign -- <dealer_code> [ttlSeconds]` | Print a signed iframe token and the `/embed` URL. Default TTL 3600 s, maximum 86400 s. |
| `npm run admin:user -- <username> [ADMIN\|CHOICES]` | Make an admin-area user (default role CHOICES: Dealers and Reward choices only). Prints the password one time and the `ADMIN_USERS` entry (hash only). |

**Dealer status API (phase 2, `docs/api-contract.md`)**

| Command | What it does |
|---|---|
| `npm run auth:client -- <client_id>` | Make an OAuth2 client. The script prints the `client_secret` one time and the entry `{"<client_id>":"<sha256>"}`. Merge the entry into `AUTH_CLIENTS` (JSON). Never commit a secret. |
| `npm run auth:jwt-secret` | Make a `JWT_SECRET` (one for each environment). |
| `TOKEN=$(curl -s localhost:3000/api/v1/auth/token -d grant_type=client_credentials -d client_id=local-client -d client_secret=local-test-secret \| node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')` | Get a token (local example client). A client in `AUTH_WRITE_CLIENTS` gets `schemes:read choices:write`. |
| `curl -s http://localhost:3000/api/v1/dealer-scheme-status -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"dealer_code":"DEMO0001","scheme_tags":["FB-PAN","FB-TNHPJK","SP-Q3"]}'` | Call the status API (local). The 200 body is the dealer status. Errors: `{"error":{"code","message"}}`. |
| `curl -s http://localhost:3000/api/v1/dealer-reward-choice -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"dealer_code":"DEMO0001","scheme_tag":"FB-PAN","choice":"GIFT","chosen_by":"SO1234"}'` | Save a reward choice (scope `choices:write`). |
| `curl -s http://localhost:3000/api/v1/embed-token -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"dealer_code":"DEMO0001"}'` | Get a signed iframe URL for a dealer (scope `schemes:read`). iframe `src` = base URL + `embed_path`. The iframe sends its height to the host page (`docs/api-contract.md` section 14). |
| `curl -s http://localhost:3000/api/v1/health` | Health probe (no authentication). |

Auth settings: `APP_ENV`, `AUTH_CLIENTS`, `AUTH_WRITE_CLIENTS`, `JWT_SECRET` (`docs/api-contract.md` section 3). `docs/openapi.json` is the OpenAPI 3.0.3 file (JSON). Check it with `npm run openapi:check`.

**App**

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000. Dev host page: `/dev/host?dealer_code=DEMO0001`. |
| `npm run build` | Production build. |
| `npm run start` | Start the production build. Use `npx next start -p 3100` for another port. |

**Checks**

| Command | What it does |
|---|---|
| `npm run typecheck` | `next typegen` and `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm test` | Vitest, all unit tests (`npm run test:watch` for watch mode). |

**First run on a new machine**

```
npm install
docker compose up -d                   # or the docker run command above
npm run db:migrate && npm run db:seed
npm run sync:bigquery -- --dry-run --no-sql
npm run sync:bigquery                  # first run also reads the Q1 base once
npm run dev
```
