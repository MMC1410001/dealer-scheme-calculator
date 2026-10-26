# Annexure A – User guide

This annexure tells the users how to use the Acme Paints Scheme Module. It has three parts:

| Part | For | What it covers |
|---|---|---|
| A.1 Dealer view (My Schemes) | Dealers, sales team, BA | How to open and read the scheme status of a dealer in DMS or SFA, with the saved reward choice |
| A.2 Admin area | Acme Paints admin users, BA, support | Login and users, scheme report, dealer search, reward choice entry and upload, sync runs |
| A.3 Integration | DMS (SAP Commerce) and SFA teams | How to open the iframe; the dealer status API and the reward choice API: Swagger UI, response fields, error codes |


## A.1 Dealer view (My Schemes)

### A.1.1 Open the dealer view

1. Log in to DMS (SAP Commerce) or SFA with your dealer account.
2. Open **My Schemes**.
3. The page shows the schemes of the logged-in dealer. You do not enter a dealer code. DMS or SFA tells the page who
   you are.

The page shows the saved result of the last data load. The data loads each day at 08:00 India time. The time of the
last load is under the dealer name ("Data as of").

| Item | Meaning |
|---|---|
| Dealer name and dealer code | The dealer that is logged in. A child dealer sees the result of the parent dealer, with the parent code and name. |
| Data as of | Date and time of the last data load from BigQuery. |
| Provisional (yellow box) | The result can change until the return window and the overdue check are complete. |

### A.1.2 Read a scheme card

Each scheme has one card. The card has a header, the current slab, the figures of the dealer and the slab table.

| Part of the card | What it shows |
|---|---|
| Scheme tag and name | For example FB-PAN, Festive Bonanza Oct–Nov'26 – Pan India except TNN, TNS, HP & JK. |
| Dates | Scheme period, and the date until which the result is provisional. |
| Current slab (green) | The slab that the dealer has reached, with the gift and the CN alternative. "No slab yet" when Slab 1 is not met. |
| Figures | Q1 FY 2026-27 monthly average GSR, the GSR of each scheme month, the total GSR and the growth. FB-PAN and Star Points also show the GSR required for the Slab 1 growth and the GSR still needed for it. Star Points also shows the points. |
| Overdue check | The OD (overdue) check date. There must be no overdue amount on that date to get the benefit. |
| Slabs table | All slabs of the scheme, with the gift, the CN alternative and the status. Festive Bonanza: the column **Gold voucher worth\*** shows the amount of the gold voucher. The note below the table gives the brand (Jeweller A / Jeweller B / reputed brand). |
| Status | **Unlocked** = the slab that the dealer is in. **Locked** = all other slabs, also the lower slabs. "Your slab" marks the current slab. |
| Scheme terms and conditions | At the bottom of the card. The section is closed. Click it to open the terms of the circular that affect the calculation and the payout: key terms, OD (overdue) criteria and calculation. Star Points also shows the points earning (points per litre) and the additional Trip / CN criteria. |

How the system finds the slab:

1. It checks the slabs in order: Slab 1, then Slab 2, and so on.
2. A slab is met only when all its conditions are met.
3. It stops at the first slab with a condition that is not met. The dealer is in the slab before it.
4. If a condition of Slab 1 is not met, the dealer is in no slab.

### A.1.3 Dealer with no slab

In this example, the GSR conditions of Slab 1 are met, but the growth is −70.4% and Slab 1 needs 20%. So all slabs are
Locked. The dealer still needs ₹15,92,597 GSR in Oct + Nov for the growth.

FB-PAN shows two more figures for the growth. **GSR required for 20% growth** is the Oct + Nov GSR that meets the Slab 1
growth (Q1 FY 2026-27 monthly average × 1.20 × 2). **GSR still needed for 20% growth** is the Oct + Nov GSR that the
dealer still needs for it (0 when the growth is met).

A month that is not billed yet counts as 0. So during the scheme period, the growth % alone looks low. The GSR still
needed shows how far the dealer is from the growth condition. The two figures do not show when the dealer has no Q1
FY 2026-27 GSR. FB-TNHPJK has no growth condition and does not show these figures.

### A.1.4 Star Points

- The card shows the points earned, and the points of each category (Luxury, Premium, Economy, Enamels, Others) and of
  the tools.
- Points = litres purchased × points per litre of the category. Tools give 400 points for each Rs 15,000 GSR.
- Free packs give no points. A free pack is a free SKU of a product (GSR 0), for example a 1 L free pack.
- The growth uses the total GSR of all products in the scheme channels. Each slab needs 10% growth over Q1 FY 2026-27.
- **GSR required for 10% growth** is the Q3 GSR that meets the growth (Q1 FY 2026-27 GSR × 1.10). **GSR still needed
  for 10% growth** is the Q3 GSR that the dealer still needs for it (0 when the growth is met). A month that is not
  billed yet counts as 0. The two figures do not show when the dealer has no Q1 FY 2026-27 GSR.
- For a trip slab, the gift is the trip. The CN alternative is in the next column.

When a dealer is above the top slabs, the card shows the extra benefits as options. The dealer gets only one of them.
The values are not added together.

### A.1.5 Benefit on hold (overdue)

If the dealer has an overdue amount (OD) on the OD check date, the card shows **Benefit on hold (overdue)** and a yellow message.
The slab stays the same. The dealer gets no benefit for this scheme while there is an outstanding.

### A.1.6 Scheme not in scope

A scheme that does not apply to the dealer shows one line with the reason.

| Reason on the page | Meaning |
|---|---|
| Dealer region is not in the scope of this scheme | The dealer's region is outside the scheme (for example FB-TNHPJK is only for TNN, TNS, HP & JK). |
| Region unknown | The dealer is not in the dealer master, or has no region value. |
| Dealer is enrolled in another scheme | The dealer joined the other scheme. A dealer can join Festive Bonanza or Star Points, not both. |
| No sales data for this scheme | The dealer has no sales in the scheme channels and products. |

### A.1.7 Session expired

The link that DMS or SFA opens is valid for a short time. When it expires, or when it is not valid, the page shows
"Session expired". Do these steps:

1. Close the page.
2. Open **My Schemes** again from DMS or SFA.

### A.1.8 Mobile devices

The page fits the screen of a phone. The figures show in two columns. Below them, each slab shows as one box with its
gift, its CN alternative and its status.

### A.1.9 Reward choice (gift or CN)

For each scheme, the dealer chooses the gift (gold voucher or trip) or the CN alternative of the slab. Acme Paints sends
the choices to this system (file or API), or an admin-area user enters them (A.2.4 and A.2.5). The dealer view shows the
saved choice and the benefit. The dealer cannot change the choice on this page.

| Line | Meaning |
|---|---|
| Gift or CN | The saved choice. Star Points, Slab 7: also the destination (Island Cruise or Overseas Tour). |
| saved by … on … | Who saved the choice and when, and how (admin, file upload or API). |
| Benefit | The benefit of the choice at the current slab. Star Points above the top slab: with the gift, the extra tickets of the chosen destination (or their CN); with CN, ₹18,500 CN for every 26,000 points. |
| Not chosen yet | No choice is saved for this scheme. |

The box shows only when the dealer is in a slab, or when a choice is saved. If the dealer moves to another slab later,
the saved choice stays, and the benefit of the new slab shows.

## A.2 Admin area

The admin area is for Acme Paints admin users, the BA and the support team. It is at `/admin` on the server, for
example `https://dev.scheme-calculator.example.com/admin` on Dev. The vendor gives the user name and the password.

### A.2.1 Log in

1. Open `/admin` on the server.
2. Enter the user name and the password.
3. Click **Sign in**. The scheme report opens (a Reward choices user: the Reward choices page).

After 5 wrong attempts, the login stops for 15 minutes. To end the session, click **Log out**.

There are two kinds of users. The vendor gives the user name and the password of each user.

| Role | Menu | Use |
|---|---|---|
| Admin | **Report**, **Dealers**, **Reward choices**, **Sync runs** | All pages. |
| Reward choices | **Dealers**, **Reward choices** | Enter or upload the dealers' reward choices (A.2.4 and A.2.5). This user lands on **Reward choices**. |

### A.2.2 Scheme report

The top of the report shows the time of the data ("Data as of") and the last sync. Each scheme has one section.

| Item | Meaning |
|---|---|
| In scope | Dealers in the scope of the scheme (channel, region and sales). |
| In a slab | Dealers in Slab 1 or a higher slab. |
| In scope, no slab | Dealers in scope that do not meet Slab 1. |
| Not in scope | Dealers outside the scheme. |
| Dealers per slab | The slab table of the circular (Table I), with the same columns, and the number of dealers in each slab. Festive Bonanza: GSR slab (Rs lacs), minimum GSR in Oct'26, growth (FB-PAN only), gold voucher worth and CN alternative. Star Points: points required, benefit, GSR growth criteria and CN alternative. Turn on the **Reward choice columns** switch (top right) to add the reward choice (chose gift, chose CN, not chosen), the destination of the extra tickets (Star Points: Cruise, Overseas Tour) and the dealers with the benefit on hold (on hold (overdue)). Turn it off to remove them again. |
| Links | Each number of dealers is a link, except **Not in scope**. Click it to open **Dealers** with the same dealers, and the same number on the selected filter: a number in a slab row shows the dealers of that slab; **In a slab** and **Total** show the unlocked dealers; **In scope** and **In scope, no slab** show only the dealers in scope. A number 0 is not a link. |
| Scheme terms and conditions | Below the slab table. The same terms as on the scheme card of the dealer view. Click to open or close. |

### A.2.3 Find a dealer

1. Click **Dealers**. The page shows the unlocked dealers (the dealers in a slab) of the first scheme (FB-PAN), the highest slab first.
2. Select the scheme in **Scheme**. To find one dealer, enter the dealer code or a part of the name. Click **Show**.
3. Click **Unlocked**, **Locked** or **All** to filter the list. **Unlocked** is selected first. Each filter shows the number of dealers. If
   a search finds only locked dealers, click **Locked** or **Show all**.
4. Click the dealer code or the slab. The dealer page opens for that scheme. Click **← Back to dealers** to go back to the
   same list (the same search, filter and page). A reload of the list opens **Unlocked**, page 1.

When you open **Dealers** from a number on the report (A.2.2), the filter of the report shows next to **All**, for
example **Filter: Slab 2** or **Filter: In scope only**. The numbers on **Unlocked**, **Locked** and **All** then count
only these dealers. Click **✕** on the filter to remove it. When you select another scheme, the slab filter is removed;
**In scope only** stays.

The list has 50 dealers a page. Its columns are **Dealer code**, **Name**, **Region**, **Eligibility** and **Slab**. Use
**Next** and **Previous** to go to the other pages. **Eligibility** is **Unlocked**
when the dealer is in a slab, and **Locked** when the dealer is in no slab. Dealers with no slab stay in the list. The
list does not show dealers with no sales data for the scheme, or dealers whose region is in another scheme.

The dealer page shows the same view that the dealer sees in DMS or SFA, with the saved reward choice. Use it to answer a
question from a dealer or from the sales team. Click **Back to dealers** to go back to the list. Click **Show all schemes** to see all schemes of the dealer.

### A.2.4 Enter one reward choice

Use the dealer page to enter or change the choice of one dealer.

1. Click **Dealers** and open the dealer (A.2.3).
2. Find the scheme card. The box **Reward choice** has the form when the dealer is in a slab.
3. Under **Benefit**, select **Gift** or **CN**. The gift and the CN are those of the dealer's current slab.
4. Star Points, Slab 7 only: select the **destination**, **Island Cruise (or equivalent)** or **Overseas
   Tour**. It applies to the extra benefit above the top slab. Select only one destination.
5. Click **Save choice**. The message **Choice saved.** shows. The box shows the saved choice, your user name and the
   benefit.

The choice never locks. To change it, select another value and click **Save choice** again. "No change: this choice is
already saved." means that the same choice was saved before.

### A.2.5 Upload reward choices

Use this page to save the reward choice of many dealers at one time, for example from an Excel file of SAP or SFA.

1. Click **Reward choices**.
2. Click **Download template (CSV)**, next to **Upload**. Open the file in Excel.
3. Enter one row for each dealer and scheme:

   | Column | Value |
   |---|---|
   | `dealer_code` | The dealer code. A child dealer code is saved under its parent. |
   | `scheme_tag` | FB-PAN, FB-TNHPJK or SP-Q3. |
   | `choice` | `GIFT` or `CN`. |
   | `destination` | Star Points, Slab 7 only: `CRUISE` or `OVERSEAS`. Else leave the cell empty. |
   | `chosen_by` | Optional: who recorded the choice (for example the user in SAP or SFA). Empty = your user name. |

   The template has example rows (one for each case). Their dealer code starts with `#`. The upload skips every row
   whose dealer code starts with `#`, so you can delete the example rows or keep them. A file with only example rows
   is refused.

4. Save the file as `.csv` or `.xlsx` (5 MB or smaller, up to 20,000 rows).
5. Click **Choose File**, select the file and click **Upload**.
6. Read the result:
   - **Saved (new or changed)**: rows saved.
   - **No change**: rows with the same choice as before. Nothing is written.
   - **Refused**: rows that are not saved. The table gives the row number and the reason. Click **Download all errors
     (CSV)** to get all of them.
7. Correct the refused rows and upload them again. The rows that were saved stay saved.

A row is refused when the dealer is not in a slab of the scheme, when the dealer or the scheme does not exist, when a
value is not valid, or when the same dealer and scheme are in more than one row of the file.

**History.** The **History** section below the upload shows the saved changes of the last 3 months:

| Source | One entry for | Details |
|---|---|---|
| File upload | Each file | File name, user, and the rows changed, unchanged and refused. |
| API | Each day and API client (for example SFA) | Number of changes, time of the last change. |
| Dealer page | Each day and user | Number of changes, time of the last change. |

Click **Download** to get the choices that the entry changed (CSV: time, dealer code, scheme tag, choice, destination,
chosen by, source, sent by). The system does not keep the uploaded file, and you cannot delete an upload. To correct a
wrong upload, upload a corrected file: the new choice replaces the old one, and the history keeps both.

### A.2.6 Sync runs

Each row is one data load from BigQuery.

| Column | Meaning |
|---|---|
| Status | **SUCCESS**, **RUNNING** or **FAILED**. |
| Started / Finished | Start and end time of the run (India time). |
| Data as of | The date of the sales data in BigQuery. |
| Rows | The dealer totals that the run saved. |
| BigQuery bytes | The data that BigQuery scanned (the BigQuery cost depends on it). |
| Message | Number of dealers, rows, scheme tags and results. For a failed run, the error. |

The sync runs each day at 08:00 India time. A failed run is tried again after 30 minutes, at most 3 times. If the last
run is FAILED, or if there is no new run for a day, tell the support team.

## A.3 Integration (DMS and SFA teams)

### A.3.1 Open the dealer view (iframe)

DMS and SFA show the dealer view in an iframe. The iframe URL has a signed token that identifies the logged-in dealer.
Get the URL on your server, never in the browser.

1. Get an API client (client ID and secret) from the vendor. The client of the dealer status API (A.3.2) can be used. Keep
   the secret on the server.
2. Give the vendor the domains of DMS and SFA that open the iframe. Only these domains can show the page.
3. When a dealer opens **My Schemes**, get an access token (A.3.2). Then get the iframe URL:
   - Send `POST https://<host>/api/v1/embed-token` with `{"dealer_code": "<dealer code>"}`.
   - Optional: `"scheme_tags": ["FB-PAN"]` shows only these schemes. `"ttl_seconds"` sets the expiry (60 to 86,400
     seconds, default 3,600).
   - The answer has `embed_path` and `expires_at`.
4. Open the iframe with this URL: `https://<host>` + `embed_path`. Get a new URL each time the page opens.
5. Set the iframe height from the height message of the page. The page sends
   `{"type": "scheme-calculator:height", "height": <pixels>}` to the host page when it opens and when its height
   changes. Accept the message only from `https://<host>` and from the iframe. Without this step, the iframe keeps a
   fixed height and scrolls inside.

Other way: your server makes the token with a shared secret from the vendor (secure channel). Then step 3 is not
necessary:

- Payload: JSON `{"d": "<dealer code>", "exp": <expiry time, Unix seconds>, "v": 1}`.
- Token: `base64url(payload)` + `.` + `base64url(HMAC-SHA256(base64url(payload), secret))`.
- Expiry: at most 24 hours. Use a short time, for example 1 hour.
- URL: `https://<host>/embed?token=<token>`.

A token that is changed, expired or not valid shows "Session expired". The page never accepts a plain
dealer code in place of the token. The API contract (section 14) has the full details and code examples.

### A.3.2 Dealer status API (second option)

The API gives the same result as the iframe, as JSON. It is for server-to-server calls only. A browser page cannot
call it (no CORS). The full contract is in the API contract in the code repository.

| Item | Value |
|---|---|
| Dev host | `https://dev.scheme-calculator.example.com` (UAT and production: same pattern, hosts to be confirmed) |
| Swagger UI | `/api/docs` on Dev and UAT. Off in production. |
| Authentication | OAuth2 client credentials. Scope `schemes:read` (dealer status) and `choices:write` (reward choice, only for the clients that the vendor allows). The vendor gives one client ID and secret for each system and environment. |
| Token lifetime | 1 hour. Use one token again until it expires. Do not get a new token for each call. |
| Limits | 2,500 requests a second for each client IP; 30 token requests a minute for each client IP; 1,00,000 requests a minute for each client. |
| Request body limit | 8 KB |

| Endpoint | Purpose | Token needed |
|---|---|---|
| `POST /api/v1/auth/token` | Get an access token with the client ID and secret | No |
| `POST /api/v1/dealer-scheme-status` | Scheme status of one dealer for 1 to 10 scheme tags | Yes |
| `POST /api/v1/dealer-reward-choice` | Save the reward choice of one dealer for one scheme: `{"dealer_code", "scheme_tag", "choice": "GIFT" or "CN", "destination", "chosen_by"}`. The answer has `changed` (false = the same choice was already saved). | Yes, scope `choices:write` |
| `GET /api/v1/health` | Health check: database up and time of the last data load | No |

### A.3.3 Try the API in Swagger UI

Use Swagger UI to see the API and to send test calls on Dev or UAT.

1. Open `https://dev.scheme-calculator.example.com/api/docs`. The page shows the endpoints in four groups: **auth**,
   **dealer-status**, **reward-choice** and **health**.
2. Click **Authorize** (padlock button at the top).
3. Enter the **client_id** and the **client_secret** that the vendor gave you.
4. Select the scope **schemes:read**. To try the reward choice, also select **choices:write** (only for a client that
   the vendor allows).
5. Click **Authorize**. Swagger UI gets the token from `/api/v1/auth/token` for you.

6. The dialog shows **Authorized**. Click **Close**. To use other credentials, click **Logout** and do steps 2 to 5
   again.

7. Open **POST /api/v1/dealer-scheme-status** (click the row).
8. Click **Try it out**.
9. In **Request body**, select an example or type the body. Put the dealer code and the scheme tags. The examples
   that start with `valid_` use test dealer codes that exist only on a test server. On Dev, type a real dealer code.

10. Click **Execute**.
11. Read the answer under **Server response**. Code 200 gives the dealer status. The same block shows the response
    headers. Give the `x-request-id` value to the vendor when you report a problem.

A request that is not correct gives an error code and a message, for example 400 when `scheme_tags` is empty:

To check that the server is up, open **GET /api/v1/health**, click **Try it out** and **Execute**. No token is
needed.

### A.3.4 Read the response

The response has the same data as the dealer view. The order of `schemes` is the order of `scheme_tags` in the
request.

| Field | Meaning |
|---|---|
| `dealer_code`, `dealer_name` | The dealer. For a child dealer code, the parent dealer. |
| `data_as_of` | Time of the last data load (India time). |
| `schemes[].scheme_tag` | The scheme tag of the request, for example FB-PAN. |
| `schemes[].participation` | `IN_SCHEME` or `NOT_IN_SCOPE`. For `NOT_IN_SCOPE`, `reason_code` and `reason` give the reason (table in A.1.6). |
| `schemes[].header` | Scheme name, dates, Q1 FY 2026-27 monthly average GSR, and `metrics` (monthly GSR, growth, points). |
| `schemes[].current_slab`, `current_slab_no` | The slab that the dealer has reached. `null` when the dealer is in no slab. |
| `schemes[].provisional`, `final_on` | The result can change until the date in `final_on`. |
| `schemes[].benefit_blocked`, `od_status` | Benefit on hold because of outstanding (OD). `od_status`: `NO_OD`, `OD` or `PENDING` (check date not reached or no OD data). |
| `schemes[].details[]` | All slabs: `lock_status` (UNLOCKED only for the slab that the dealer is in, LOCKED for all other slabs), `gift` (description and value; value empty for trips), `cn_alternative`, and `conditions` (required, actual, met). |
| `schemes[].extra_benefits` | Star Points only: the extra benefit options above the top slabs. The dealer gets one of them. |
| `schemes[].reward_choice` | The saved reward choice: `choice` (`GIFT` or `CN`), `destination` (`CRUISE`, `OVERSEAS` or null), `source` (`ADMIN`, `UPLOAD` or `API`), `chosen_by` and `updated_at`. `null` = not chosen. |

### A.3.5 Error codes

All errors have one format: `{"error": {"code": "...", "message": "..."}}`. The token endpoint uses the OAuth2 format
`{"error": "...", "error_description": "..."}`.

| HTTP | Code | Meaning | What to do |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | The body is not correct (for example no dealer code, or no scheme tag). | Correct the body. |
| 400 | `UNKNOWN_SCHEME_TAG` | A scheme tag is not active. Tags are case-sensitive. | Use an active tag (FB-PAN, FB-TNHPJK, SP-Q3). |
| 401 | `UNAUTHORIZED` | The token is missing, not valid or expired. | Get a new token. |
| 403 | `INSUFFICIENT_SCOPE` | The token does not have the scope of the endpoint (`schemes:read`, or `choices:write` for the reward choice). | Get a token with the scope. For `choices:write`, ask the vendor to allow your client. |
| 404 | `DEALER_NOT_FOUND` | The dealer code does not exist. | Check the dealer code. |
| 409 | `CHOICE_NOT_ALLOWED` | Reward choice only: the dealer is not in a slab of the scheme, or a destination is sent for a dealer who is not in Slab 7. | Check the dealer's slab. Send no destination below Slab 7. |
| 413 | `PAYLOAD_TOO_LARGE` | The body is larger than 8 KB. | Send a smaller body. |
| 429 | `RATE_LIMITED` | Too many requests. | Wait for the time in the `Retry-After` header. |
| 500 | `INTERNAL_ERROR` | Error on the server. | Tell the vendor, with the `x-request-id`. |
| 503 | `SERVICE_BUSY` / `API_DISABLED` | The server is busy, or the API is not set up on this server. | Try again later. If it stays, tell the vendor. |

## A.4 Questions and problems

| Problem | What to do |
|---|---|
| The dealer sees "Session expired". | Close the page. Open My Schemes again from DMS or SFA. If it happens again, the DMS / SFA team checks the token and the clock of its server. |
| The page does not show in DMS or SFA (blank frame). | The domain of DMS or SFA is not in the permitted list. Give the domain to the vendor. |
| The figures are old. | Look at "Data as of" and at the Sync runs page. If the last run is FAILED or old, tell vendor support. |
| A scheme shows "Region unknown". | The dealer is not in the dealer master or has no region. Acme Paints updates the dealer master. |
| The dealer expected a slab but sees "No slab yet". | Open the dealer in the admin area. Compare the figures of the dealer (GSR, growth, GSR still needed for the growth, points) with the slab conditions in the scheme report (A.2.2). The dealer status API also returns each condition with the required and actual values. Remember: the system stops at the first slab with a condition not met. |
| The dealer view shows "Not chosen yet". | The choice of this dealer and scheme is not received yet. Send it by file or API, or enter it on the dealer page (A.2.4). |
| The dealer page has no **Save choice** form. | The dealer is not in a slab of this scheme. A choice is possible only for a dealer in a slab. |
| An uploaded row is refused. | Read the reason in the table or in the error file. Correct the row and upload it again. |
| The result changes after the scheme end. | The result is provisional until the return window and the OD check end. Material returns and outstanding can change it. |
