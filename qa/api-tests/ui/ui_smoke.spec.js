// Admin area and iframe dealer view in a real browser (UI_TC_n). qa/README.md, Step 4b.
//
// Env:
//   UI_BASE_URL          default API_BASE_URL, else http://localhost:3400
//   ADMIN_USERNAME       admin login of the server (the admin cases are skipped without both values)
//   ADMIN_PASSWORD
//   EMBED_SIGNING_SECRET the server's iframe signing secret, to sign a dealer token (the iframe cases with a
//                        valid token are skipped without it). Never put a real environment's secret in a file.
//   UI_DEALER_CODE       a dealer with results. Default DEMO0001 (npm run data:demo); with SAMPLE_DATA=false,
//                        dealers.main from qa/test-data/dealers.json (git-ignored).
//   SAMPLE_DATA          "false" on real environments (no DEMO dealers)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const USER = process.env.ADMIN_USERNAME || '';
const PASS = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.EMBED_SIGNING_SECRET || '';
const SAMPLE_DATA = process.env.SAMPLE_DATA !== 'false';

function dealerCode() {
  if (process.env.UI_DEALER_CODE) return process.env.UI_DEALER_CODE;
  if (SAMPLE_DATA) return 'DEMO0001';
  const file = path.join(__dirname, '..', '..', 'test-data', 'dealers.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).dealers.main : '';
}
const DEALER = dealerCode();

/** Iframe token: base64url(JSON {d, exp, v: 1}) + "." + base64url(HMAC-SHA256(payload part, secret)). */
function embedToken(code, ttlSeconds, secret = SECRET) {
  const payload = Buffer.from(JSON.stringify({ d: code, exp: Math.floor(Date.now() / 1000) + ttlSeconds, v: 1 })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

const needAdmin = () => test.skip(!USER || !PASS, 'set ADMIN_USERNAME and ADMIN_PASSWORD');
const needSecret = () => test.skip(!SECRET || !DEALER, 'set EMBED_SIGNING_SECRET (and a dealer code)');

async function login(page) {
  await page.goto('/admin/login');
  await page.fill('input[name=username]', USER);
  await page.fill('input[name=password]', PASS);
  await Promise.all([page.waitForURL(/\/admin$/), page.click('button[type=submit]')]);
  // WebKit does not send a Secure cookie over plain http://localhost (next start sets Secure; Dev/UAT/prod use
  // HTTPS). Test-only: keep the session in WebKit on a local http server.
  const ctx = page.context();
  if (ctx.browser()?.browserType().name() === 'webkit' && page.url().startsWith('http://')) {
    await ctx.addCookies((await ctx.cookies()).map((c) => ({ ...c, secure: false })));
  }
}

/** The page has no horizontal scroll at the current viewport. */
async function expectNoPageScroll(page) {
  const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(vw + 1);
}

test.describe('Admin area @ui', () => {
  test('UI_TC_1 /admin without a session redirects to the login page', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole('heading', { name: 'Admin login' })).toBeVisible();
  });

  test('UI_TC_2 A wrong password shows the generic error and stays on the login page', async ({ page }) => {
    needAdmin();
    await page.goto('/admin/login');
    await page.fill('input[name=username]', USER);
    await page.fill('input[name=password]', 'not-the-password');
    await page.click('button[type=submit]');
    await expect(page.getByText('The username or password is not correct.')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('UI_TC_3 Login opens the report: all scheme tags, the data time and the last sync', async ({ page }) => {
    needAdmin();
    await login(page);
    await expect(page.getByRole('heading', { name: 'Scheme report' })).toBeVisible();
    for (const tag of ['FB-PAN', 'FB-TNHPJK', 'SP-Q3']) await expect(page.getByText(tag, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Data as of/).first()).toBeVisible();
    await expect(page.getByText(/Last sync/).first()).toBeVisible();
    await expect(page.getByText('Dealers per slab').first()).toBeVisible();
  });

  test('UI_TC_4 Dealers: the list opens on Unlocked without a search; a dealer code finds the dealer; the support view opens; Back keeps the search', async ({ page }) => {
    needAdmin();
    test.skip(!DEALER, 'no dealer code');
    await login(page);
    await page.goto('/admin/dealers');
    await expect(page.getByLabel('Scheme')).toHaveValue('FB-PAN');
    await expect(page.getByRole('navigation', { name: 'Eligibility filter' }).getByRole('link', { name: /^Unlocked / })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await page.goto(`/admin/dealers?scheme=FB-PAN&status=ALL&q=${encodeURIComponent(DEALER)}`);
    const link = page.locator('table').getByRole('link', { name: DEALER, exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByText('Support view: this is the same view that the dealer sees in DMS / SFA.')).toBeVisible();
    await expect(page.getByText('Scheme FB-PAN only.')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(1);
    // "Back to dealers" and the browser Back both keep the search and the tab.
    await page.getByRole('link', { name: '← Back to dealers' }).click();
    await expect(page.getByLabel('Dealer code or name (optional)')).toHaveValue(DEALER);
    await expect(page.getByRole('navigation', { name: 'Eligibility filter' }).getByRole('link', { name: /^All / })).toHaveAttribute('aria-current', 'page');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator('article')).toHaveCount(1);
    await page.goBack();
    await expect(page.getByLabel('Dealer code or name (optional)')).toHaveValue(DEALER);
    await expect(link).toBeVisible();
  });

  test('UI_TC_5 An unknown dealer page does not crash', async ({ page }) => {
    needAdmin();
    await login(page);
    const res = await page.goto('/admin/dealers/NOPE0000');
    expect(res.status()).toBeLessThan(500);
    await expect(page.getByText('Application error')).toHaveCount(0);
  });

  test('UI_TC_6 Sync runs lists the runs with a status', async ({ page }) => {
    needAdmin();
    await login(page);
    await page.goto('/admin/runs');
    await expect(page.getByRole('heading', { name: 'Sync runs' })).toBeVisible();
    await expect(page.getByText(/^(Success|Running|Failed)$/).first()).toBeVisible();
  });

  test('UI_TC_22 Reward choices shows the history; a download link returns CSV; a bad link gives 400', async ({ page }) => {
    needAdmin();
    await login(page);
    await page.goto('/admin/choices');
    const history = page.locator('section[aria-labelledby=history]');
    await expect(history.getByRole('heading', { name: 'History' })).toBeVisible();
    const link = history.locator('a', { hasText: 'Download' }).first();
    if ((await link.count()) > 0) {
      const res = await page.request.get(await link.getAttribute('href'));
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('text/csv');
      expect((await res.text()).split('\r\n')[0]).toBe('changed_at,dealer_code,scheme_tag,choice,destination,chosen_by,source,sent_by');
    }
    expect((await page.request.get('/admin/choices/history?upload=abc')).status()).toBe(400);
  });

  test('UI_TC_7 Log out ends the session: /admin asks for the login again', async ({ page }) => {
    needAdmin();
    await login(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('UI_TC_17 Dealers: the filter tabs (Unlocked first and default, Locked, All) show counts; Unlocked lists only dealers in a slab, Locked only dealers in no slab', async ({ page }) => {
    needAdmin();
    await login(page);
    await page.goto('/admin/dealers?scheme=FB-PAN');
    const tabs = page.getByRole('navigation', { name: 'Eligibility filter' }).getByRole('link');
    await expect(tabs).toHaveText([/^Unlocked \([\d,]+\)$/, /^Locked \([\d,]+\)$/, /^All \([\d,]+\)$/]);
    const tab = (name) => tabs.filter({ hasText: new RegExp(`^${name} `) });
    const count = async (name) => Number((await tab(name).textContent()).replace(/\D/g, ''));
    expect(await count('All')).toBe((await count('Unlocked')) + (await count('Locked')));

    // Unlocked is the default: no status in the URL.
    await expect(tab('Unlocked')).toHaveAttribute('aria-current', 'page');
    await expect(page).not.toHaveURL(/status=/);
    const eligibility = page.locator('table tbody tr td:nth-child(4)');
    if ((await eligibility.count()) > 0) await expect(eligibility).toHaveText(Array((await eligibility.count())).fill(/Unlocked/));

    await tab('Locked').click();
    await expect(tab('Locked')).toHaveAttribute('aria-current', 'page');
    if ((await eligibility.count()) > 0) {
      await expect(eligibility).toHaveText(Array(await eligibility.count()).fill(/Locked/));
      await expect(page.locator('table tbody tr td:nth-child(5)').first()).toHaveText(/No slab/);
    }

    await tab('All').click();
    await expect(tab('All')).toHaveAttribute('aria-current', 'page');

    // The tab is not kept in the address bar: a reload opens Unlocked again (needs the page script).
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/status=/);
    await page.reload();
    await expect(tab('Unlocked')).toHaveAttribute('aria-current', 'page');
  });

  test('UI_TC_18 Dealers: picking a scheme reloads the list (no Show click); paging keeps the scheme and the filter; a reload opens page 1', async ({ page }) => {
    needAdmin();
    await login(page);
    await page.goto('/admin/dealers');
    // The list reloads when the scheme changes: no click on Show (needs the page script, so wait for the load).
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Scheme').selectOption('SP-Q3');
    await expect(page).toHaveURL(/scheme=SP-Q3/);
    await expect(page.getByLabel('Scheme')).toHaveValue('SP-Q3');
    await expect(page.locator('caption')).toContainText('SP-Q3');
    await page.goto('/admin/dealers?scheme=FB-PAN&status=LOCKED');
    const next = page.getByRole('link', { name: 'Next ›' });
    test.skip((await next.count()) === 0, 'only one page of locked dealers');
    await next.click();
    await expect(page.getByText(/^Page 2 of /)).toBeVisible();
    await expect(page).toHaveURL(/scheme=FB-PAN/);
    const tabs = page.getByRole('navigation', { name: 'Eligibility filter' });
    await expect(tabs.getByRole('link', { name: /^Locked / })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: '‹ Previous' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(page.getByText(/^Page 1 of /)).toBeVisible();
    await expect(tabs.getByRole('link', { name: /^Unlocked / })).toHaveAttribute('aria-current', 'page');
  });

  test('UI_TC_19 Dealers at phone width (320 px): cards with eligibility and slab, no horizontal scroll', async ({ browser }) => {
    needAdmin();
    const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
    const page = await ctx.newPage();
    await login(page);
    await page.goto('/admin/dealers?scheme=FB-PAN');
    await expect(page.locator('table')).toBeHidden();
    const card = page.getByRole('list', { name: 'Dealers of FB-PAN' }).getByRole('listitem').first();
    await expect(card).toBeVisible();
    await expect(card.getByText(/^(Unlocked|Locked)$/)).toBeVisible();
    await expect(card.getByRole('link', { name: /(Slab \d|No slab)/ })).toBeVisible();
    await expectNoPageScroll(page);
    await page.goto(`/admin/dealers/${encodeURIComponent(DEALER || 'X1')}?scheme=FB-PAN`);
    await expectNoPageScroll(page);
    await ctx.close();
  });
});

test.describe('Admin theme @ui', () => {
  test('UI_TC_20 The theme button switches to dark and back; the choice stays after a reload; the page behind is dark (no white strip); the iframe stays light', async ({ page }) => {
    needAdmin();
    await login(page);
    await page.waitForLoadState('networkidle');
    const root = page.locator('[data-theme-root]');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(root).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(root).toHaveClass(/\bdark\b/);
    // The page behind the admin area is dark too: a fast scroll that bounces shows no white strip.
    const pageBg = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(await pageBg()).toBe('rgb(13, 17, 23)');
    if (SECRET && DEALER) {
      await page.goto(`/embed?token=${embedToken(DEALER, 600)}`);
      await expect(page.locator('.dark')).toHaveCount(0);
      expect(await pageBg()).toBe('rgb(255, 255, 255)');
      await page.goto('/admin');
    }
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(root).not.toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(root).not.toHaveClass(/\bdark\b/);
  });
});

test.describe('Iframe dealer view @ui', () => {
  test('UI_TC_8 A valid token shows My Schemes: dealer code, data time, one card for each scheme tag', async ({ page }) => {
    needSecret();
    await page.goto(`/embed?token=${embedToken(DEALER, 600)}`);
    await expect(page.getByRole('heading', { name: 'My Schemes' })).toBeVisible();
    await expect(page.getByText(`Dealer code ${DEALER}`).first()).toBeVisible();
    await expect(page.getByText(/Data as of/).first()).toBeVisible();
    expect(await page.locator('article').count()).toBeGreaterThan(0);
  });

  test('UI_TC_9 A slab table shows Unlocked / Locked: at most one Unlocked slab, no conditions, no material returns', async ({ page }) => {
    needSecret();
    await page.goto(`/embed?token=${embedToken(DEALER, 600)}`);
    await expect(page.getByText(/^(Unlocked|Locked)$/).first()).toBeVisible();
    for (const table of await page.locator('article table').all()) {
      expect(await table.locator('tbody').getByText('Unlocked', { exact: true }).count()).toBeLessThanOrEqual(1);
      await expect(table.locator('thead th')).toHaveText(['Slab', 'Gift', 'CN alternative', 'Status']);
    }
    await expect(page.getByText(/^To unlock /)).toHaveCount(0);
    await expect(page.getByText('Material returns', { exact: true })).toHaveCount(0);
  });

  test('UI_TC_21 Each scheme card (not a "not in scheme" card) has a closed "Scheme terms and conditions" section that opens on a click', async ({ page }) => {
    needSecret();
    await page.goto(`/embed?token=${embedToken(DEALER, 600)}`);
    // Scheme cards only (a "not in scheme" card has no terms).
    const cards = page.locator('article[aria-labelledby]');
    await expect(cards.first()).toBeVisible();
    await expect(page.locator('article[aria-labelledby] details')).toHaveCount(await cards.count());
    const terms = cards.first().locator('details');
    await expect(terms.getByText('OD (overdue) criteria')).toBeHidden();
    await terms.getByText('Scheme terms and conditions').click();
    await expect(terms.getByText('OD (overdue) criteria')).toBeVisible();
    await expect(terms.getByText('Calculation', { exact: true })).toBeVisible();
  });

  for (const [id, name, token] of [
    ['UI_TC_10', 'no token', () => ''],
    // Always a different last character: a signature that already ends in "A" would otherwise stay unchanged.
    ['UI_TC_11', 'a token with a changed signature', () => {
      const t = embedToken(DEALER || 'X1', 600);
      return `${t.slice(0, -1)}${t.endsWith('A') ? 'Q' : 'A'}`;
    }],
    ['UI_TC_12', 'a token signed with another secret', () => embedToken(DEALER || 'X1', 600, 'another-secret-another-secret-12345')],
    ['UI_TC_13', 'an expired token', () => embedToken(DEALER || 'X1', -120)],
  ]) {
    test(`${id} ${name} shows "Session expired" and no dealer data`, async ({ page }) => {
      if (name !== 'no token') needSecret();
      await page.goto(`/embed?token=${token()}`);
      await expect(page.getByText('Session expired')).toBeVisible();
      await expect(page.locator('article')).toHaveCount(0);
    });
  }

  test('UI_TC_14 A plain dealer_code parameter is not accepted outside development', async ({ page, baseURL }) => {
    test.skip(/localhost|127\.0\.0\.1/.test(baseURL), 'ALLOW_DEV_DEALER_PARAM may be on locally');
    await page.goto(`/embed?dealer_code=${encodeURIComponent(DEALER || 'X1')}`);
    await expect(page.getByText('Session expired')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0);
  });

  test('UI_TC_15 Phone width (390 px): the page has no horizontal scroll', async ({ browser }) => {
    needSecret();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(`/embed?token=${embedToken(DEALER, 600)}`);
    await expect(page.locator('article').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await ctx.close();
  });

  test('UI_TC_16 The page sends frame-ancestors and no-store headers', async ({ page }) => {
    needSecret();
    const res = await page.goto(`/embed?token=${embedToken(DEALER, 600)}`);
    expect(res.headers()['content-security-policy']).toContain('frame-ancestors');
    expect(res.headers()['cache-control']).toContain('no-store');
  });
});
