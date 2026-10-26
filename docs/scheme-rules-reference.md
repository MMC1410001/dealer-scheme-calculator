# Scheme rules reference (circular terms)

Status date: 16-10-2026. Owner: Mayur Chaudhary.

This file records the circular terms that are not fully in the engine. The slab tables, dates, channels, products and points per litre are in `src/config/schemes.ts` and `src/config/star-points-products.ts`. CLAUDE.md sections 6, 7 and 8 summarise them.

## 1. Sources

The circular PDFs and the requirements note are outside this repository. They are not in git. Location on Mayur's machine: `../scheme-calculator-context/` (sub-folders `circulars/` and `requirements/`).

| Tag (example) | Circular number | File (in `circulars/`) | Pages |
|---|---|---|---|
| FB-PAN | ACME/SALES/Oct-Nov'26-FY27-GIFT SCHEME/1st Oct 2026 – Pan India except TNN, TNS, HP & JK | `festive-bonanza-oct-nov26-pan-india-except-tnn-tns-hp-jk.pdf` | 2 |
| FB-TNHPJK | ACME/SALES/Oct-Nov'26-FY27-GIFT SCHEME/1st Oct 2026 – TNN, TNS, HP & JK | `festive-bonanza-oct-nov26-tnn-tns-hp-jk.pdf` | 2 |
| SP-Q3 | ACME/SALES/Q3-FY27-SCHEME/1st Oct '26 – Pan India | `star-points-q3-fy27-pan-india.pdf` | 9 |

In this file, "FB" means both Festive Bonanza circulars. The two FB circulars have the same point numbers on page 2. "SP" means the Star Points circular.

Note: the FB circulars name the other scheme "Acme Paints Star Celebration Q3 FY27 Scheme". The SP circular names it "Acme Paints Star Points Q3 FY27". This is the same scheme. In the circular titles and quotes, "FY27" means FY 2026-27. The rest of the documentation and the code use "FY 2026-27".

## 2. Status values

- **engine**: the engine applies the term.
- **payout-time (outside engine)**: the term applies when Acme Paints gives the voucher, the trip or the CN. The engine does not check it. The dealer view and the admin report do not show it, unless the row says so.
- **open item**: the meaning or the data is not confirmed. The default is in `docs/assumptions.md`.

## 3. Terms for all schemes

| # | Term (source) | Status | What the app does |
|---|---|---|---|
| 3.1 | **OD.** "Scheme benefit will not be extended to any Channel Partner having OD (Outstanding) in any account as on 30th Nov'26 and at the time of Gold Voucher disbursement / time of Credit Note (CN) settlement." (FB p2, OD Criteria 1). SP: "as on 31st December'26 and at the time of travel or at the time of Credit Note (CN) settlement." (SP p9, OD Criteria 1). | engine (check date) + payout-time (outside engine) | The engine checks OD only on the OD check date (FB 30-11-2026, SP 31-12-2026). The dealer must also have no OD at voucher disbursement, at travel or at CN settlement. The payout team must do this second check. The OD data source is open (`docs/assumptions.md` 2.1). |
| 3.2 | **GSR.** "GSR = DPL – In bill discounts" (FB p2 point 2; SP p9 point 2). | engine | GSR = `zsd_sales.gross_sales_revenue`. |
| 3.3 | **All criteria.** "Achievement of all basic qualification criteria and sub criteria is necessary for qualification in the scheme." (FB p2 point 3; SP p9 point 3). FB p1/p2 Key Terms: both the minimum Oct GSR and the growth must be met (FB-PAN). FB-TNHPJK Key Terms name only the minimum Oct GSR. | engine | All conditions of a slab combine with AND (CLAUDE.md section 6). |
| 3.4 | **No monetisation.** "There is no monetization of points / volumes at or above the qualifying or intermediate slabs." (FB p2 point 4; SP p9 point 4). | engine | There is no pro-rata benefit for GSR or points between slabs or above a slab. The dealer gets only the benefit of the slab reached. Star Points also has the extra Trip/CN rules (section 5.2). |
| 3.5 | **TDS.** "All TDS, if applicable, will be borne by the Channel Partner." (FB p2 point 5; SP p9 point 5). | payout-time (outside engine) | Not shown. |
| 3.6 | **MRV from any time of the year.** "Material Return Value (MRV) sales from any time of the year will be subtracted from the total achievement of slab for the scheme period." (FB p2 point 6; SP p9 point 6). | open item | Default: the sync deducts all return billing types billed in the scheme period and in the return window, whatever the original invoice date. Returns billed before the scheme start do not count. See `docs/assumptions.md` 2.9. |
| 3.7 | **Returns after the end date.** "Material returns up to 1 month post scheme end date will be deducted from the scheme calculation for payout." (FB p2 point 7; SP p9 point 7). | engine | Return window: FB Dec'26, SP Jan'27. Results are provisional until the window ends (`docs/assumptions.md` 3.4). |
| 3.8 | **New products.** "Any new products launched/introduced during the scheme period will be intimated as and when the product is launched in the market." (FB p1 "Please note"; SP p8 "Please note"). | open item | FB: a new Trade product counts automatically, unless it matches an exclusion. SP: a new product counts only after it is added to `src/config/star-points-products.ts` with a category. Then run `npm run db:seed` and `npm run engine:run`. See `docs/assumptions.md` 2.11. |
| 3.9 | **One scheme only.** A channel partner can join Festive Bonanza or Star Points, not both (FB p1; SP p1). | engine | `exclusivityGroup` and the enrolment table (`docs/assumptions.md` 1.8). |
| 3.10 | **Withdrawal, ambiguity, jurisdiction.** Acme Paints can withdraw the offer in a situation beyond normal control. The decision of Acme Paints is final. Disputes go to the Mumbai courts. (FB p2 points 10–12; SP p9 points 20, 21, 23.) SP also: Acme Paints can withdraw the offer from a channel partner who does an unfavourable practice (SP p9 point 19). | payout-time (outside engine) | Not in the app. |

## 4. Festive Bonanza only (FB-PAN, FB-TNHPJK)

| # | Term (source) | Status | What the app does |
|---|---|---|---|
| 4.1 | **Gold voucher brand.** "GV will be of Jeweller A/Jeweller B/reputed brand" (FB p1, footnote under Table I). | engine (display text) | Gift text: "Gold Voucher (Jeweller A / Jeweller B / reputed brand)" (`src/config/schemes.ts`, `fbSlabs`). |
| 4.2 | **Brand can change.** "The company reserves the right to determine the brand and configuration of the gifts." "Gold Voucher companies may change at discretion of the company." (FB p2 points 8–9.) | payout-time (outside engine) | Not shown. The voucher value does not change. |

## 5. Star Points only (SP-Q3)

### 5.1 Points

| # | Term (source) | Status | What the app does |
|---|---|---|---|
| 5.1.1 | **Monthly bonus.** Base points are fixed for the scheme period. Bonus points change each month. Acme Paints announces them at the start of each month. (SP p2, "Points Offered & Points Earning Mechanism" 3 and 6.) | engine | `starPoints.bonusPerLitre` by month. Nov and Dec are 0 until announced (`docs/assumptions.md` 1.9). |
| 5.1.2 | **Ad-hoc additional bonus points.** "Additional Bonus points may also be announced from time to time which will be added to the overall points earned." (SP p2, same list, point 5.) This is separate from the monthly bonus per litre. | open item | Not configurable now. Default: none. See `docs/assumptions.md` 2.10. |
| 5.1.3 | **Only Table III products.** "Beyond these products, no other product will be considered." Table III classification of Q3 is the same as Q2 FY 2026-27. (SP p1, p3.) | engine | `src/config/star-points-products.ts` (242 codes) plus tools. |

### 5.2 Trips and extra benefits

| # | Term (source) | Status | What the app does |
|---|---|---|---|
| 5.2.1 | **One trip destination.** "Dealer Can select only 1 Trip Destination- Overseas Tour or Island/equivalent Cruise." (SP p2, below the Table I footnotes.) | engine (display) + reward choice | The two extra-benefit rules are alternatives. They are not added together. The dealer view shows them as options ("choose one"). For a dealer in Slab 7, the chosen destination is saved with the reward choice; it picks the rule (Mayur, 22-10-2026). See `docs/assumptions.md` 2.4 and 2.7. |
| 5.2.2 | **Extra benefits.** "Additional Trip/CN criteria": beyond 2,17,000 points, 1 ticket 4N5D Island Cruise (or equivalent) or CN ₹78,000 for every 1,06,000 points; beyond 2,25,000 points, 1 ticket 4N5D Overseas Tour or CN ₹1,62,000 for every 2,11,000 points. "OR" ₹18,500 CN for every 26,000 points. (SP p2.) | engine | `starPoints.extraBenefits`. The trip option and the CN option are alternatives. |
| 5.2.3 | **Cruise venue.** "Cruise Venue will be Island/equivalent, 4 Nights 5 Days." (SP p2, footnote 1.) "Trip Destination/Cruise venues may change from Overseas Tour/ Island to equivalent location at the discretion of the company." (SP p9 point 22.) Trip plan and number of days can change (SP p9 point 8). | engine (display text) + payout-time | Gift text for Slabs 2–6: "Island Cruise (or equivalent)". Changes of destination are payout-time. |
| 5.2.4 | **Fewer tickets.** A dealer who qualifies for several tickets but travels on fewer can take CN for each ticket not used, at the 1-ticket CN of that trip: cruise ₹78,000, Overseas Tour ₹1,62,000. Example: 2 cruise tickets, 1 used: ₹78,000 CN for the other. (SP p2, "Scheme related Key Points" 1 and Example 1.) | payout-time (outside engine) | The slab calculation does not change. The dealer view does not show this option now. |
| 5.2.5 | **Visa rejected.** "If a channel partner's visa is rejected, he can avail the CN option available." (SP p9 point 18.) | payout-time (outside engine) | The dealer gets the CN alternative of the slab. The slab calculation does not change. |
| 5.2.6 | **Late cancellation.** If the dealer cannot travel after the company confirmed and booked the travel, and the cancellation is within 60 days of the travel date, the dealer does not get the slab CN. (SP p9 point 14.) | payout-time (outside engine) | Not in the engine. |
| 5.2.7 | **CN is not the trip cost.** "CN value shown for the respective trips should not be construed as the trip cost." (SP p9 point 13.) | payout-time (outside engine) | Not shown. |
| 5.2.8 | **Travel rules.** Acme Paints arranges pick-up and drop-off for international trips (point 9). Only a business partner of the firm or immediate blood relations can travel (points 10, 12). A dealer who qualifies for 1 international ticket can buy at most 1 more ticket. The company tells the cost (points 11, 12). The company decides admission (point 15). Names and documents are due within 1 week of scheme closure (point 16). Passport is due 60 days before an international trip (point 17). (SP p9.) | payout-time (outside engine) | Not in the app. |
| 5.2.9 | **Growth beyond Slab 7.** "Beyond Slab 7, growth required is 5%." (SP p1, note under Table I.) | open item | Not applied. See `docs/assumptions.md` 2.3. |
