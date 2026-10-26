# Scheme template v3.0 (later upload phase)

Status date: 16-10-2026. Owner: Mayur Chaudhary.

Source: requirements note v1.3 ("Acme Paints Scheme Module – Requirements Note", 16-10-2026), sections "Decisions", "Template v3.0", "Open items". The note is outside this repository: `../scheme-calculator-context/requirements/festive-bonanza-scheme-requirements.md`.

Phase 1 has no upload. Phase 1 hard-codes the 3 schemes in `src/config/schemes.ts` and writes them with `npm run db:seed`. The later upload must write the same tables (`scheme`, `scheme_slab`, `scheme_scope_rule` in `src/db/schema.ts`).

## 1. Decisions (client meeting, 16-10-2026)

1. One template for all schemes. The **Scheme Tag** (for example FB-PAN) is the primary key. One tag has many rows. The template does not change for a new scheme.
2. Exclusion is a column in the same template. There is no separate exclusion template.
3. One value per cell. No comma-separated values (about 9,000 SKUs).
4. Empty cell = all eligible (Pan India, all products).
5. Inclusion at product level. Exclusion at product or SKU level. SKU level is necessary for the benefit calculation.
6. Slab conditions of the current schemes are hard-coded. They become parameters later.
7. The business team uploads the template. Users see only the upload screen.

## 2. Columns (one sheet)

`*` = mandatory.

| # | Column | Mandatory | Meaning | Table column (`scheme_scope_rule` unless stated) |
|---|---|---|---|---|
| 1 | Scheme Tag | * | Key of the scheme. Same value on all rows of one scheme. | `scheme_tag` (also `scheme.tag`) |
| 2 | Scheme Name | * | Display name. | `scheme.name` |
| 3 | From Date | * | Scheme start date. | `scheme.from_date` |
| 4 | To Date | * | Scheme end date. | `scheme.to_date` |
| 5 | Channel | – | One channel. Empty = all. | `channel` |
| 6 | Zone | – | One zone. Empty = all. | `zone` |
| 7 | Region | – | One region. Empty = all. | `region` |
| 8 | Area | – | One area. Empty = all. | `area` |
| 9 | Depot | – | One depot code. Empty = all. | `depot` |
| 10 | Product Code | – | One product code. Empty = all. | `product_code` |
| 11 | SKU Code | – | One SKU code. Empty = all. Exclusion only (decision 5). | `sku_code` |
| 12 | Include / Exclude | * | INCLUDE or EXCLUDE. | `rule_type` |
| 13 | Applies To | – | "Qualification and Benefit" (default) or "Benefit only". See section 3. | `applies_to` |
| 14 | Remarks | – | Free text. | `remarks` |
| 15 | Row Check | – | Meaning not defined in the source. Open item (section 5). | – |

Phase 1 additions: `scheme_scope_rule` also has `product_category` and `product_group`. Phase 1 uses them for the Festive Bonanza exclusions that the circulars name by category (Distemper, Colorants). Template v3.0 has no such column. See section 5.

## 3. Rules

- **Include rows add scope.** Several Include rows with values in the same column combine with OR (any value matches). Different columns must all match (AND).
- **Exclude rows remove scope.** In one Exclude row, all filled cells must match together (AND). Example: Region = Maharashtra North AND Depot = 1105.
- **One value per cell.** Several values for one column need several rows.
- **Empty cell = all eligible.**
- **Applies To:**
  - `QUALIFICATION_AND_BENEFIT` ("Qualification and Benefit", default): the matched sales count for the slab and get the benefit.
  - `BENEFIT_ONLY` ("Benefit only"): the matched sales count for the slab qualification, but get no benefit.
  - Phase 1 uses only the default.

## 4. Example tags

Tag names are examples. Keep the tags in configuration.

| Tag | Meaning |
|---|---|
| FB-PAN | Festive Bonanza Pan India except TNN, TNS, HP & JK |
| FB-TNHPJK | Festive Bonanza TNN, TNS, HP & JK |
| SP-Q3 | Star Points Q3 FY 2026-27 |
| ABC4 | Depot and benefit exclusion example (from the meeting). The requirements note gives no rows for it. Assumption (open): it may be the Exclude row Region = Maharashtra North AND Depot = 1105, and the benefit exclusion may use the Applies To column. Confirm with the client. |

## 5. Open items for the upload phase

| # | Item | Default | Status |
|---|---|---|---|
| T1 | **Row Check** column. The source does not define it. | Treat it as a per-row validation result that the template writes. Ignore it on upload. | Open. Confirm with the client. |
| T2 | **Category column.** The circulars exclude Distemper and Colorants by category. Template v3.0 has no category column. | Phase 1 uses `product_category` / `product_group` in `scheme_scope_rule`. For the upload: add a Category column, or list each product code in its own row. | Open. Confirm with the client. Also `docs/assumptions.md` 2.12. |
| T3 | **Master values.** Region (TNN, TNS, HP, JK, Maharashtra North), depot, channel, product and SKU values must match the masters (`customer_attributes`, `test_product`). | Validate each row. Reject a row with an unknown value and show the error. | Open. Also `docs/assumptions.md` 2.13. |
| T4 | **Product codes** for Style Aluminium Paint and Venture 15/25/Roller are not in the circular. | Phase 1 matched them in `test_product` (`docs/assumptions.md` section 5). | Open. |
| T5 | **Scope expansion for performance.** No decision. | Proposal: expand the rules to a flat dealer × product scope table once at upload. The daily calculation reads that table. | Open (CLAUDE.md section 10). |
| T6 | **Slab conditions** are not in template v3.0. | Backend configuration only (`src/config/schemes.ts`). | Confirmed for phase 1 (decision 6). |
