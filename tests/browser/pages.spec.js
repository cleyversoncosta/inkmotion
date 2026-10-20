const { test, expect } = require('@playwright/test');
const origin = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:18083').origin;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wb_onboarding_done_v1', '1'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
});

test('Studio workspaces organize tools and remain accessible on short screens', async ({ page }) => {
  await page.goto(`${origin}/studio`);
  const sidebar = page.locator('#sidebar');
  await expect(page.locator('#stab-content')).toHaveAttribute('aria-selected', 'true');
  await expect(sidebar.locator('#drop-zone')).toBeVisible();
  await sidebar.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.locator('#text-panel')).toBeVisible();
  await sidebar.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page.locator('#upload-panel')).toBeVisible();
  await page.locator('#stab-content').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#stab-animation')).toBeFocused();
  await expect(page.locator('#stab-animation')).toHaveAttribute('aria-selected', 'true');
  const presets = sidebar.getByRole('button', { name: /Settings Presets/ });
  await presets.focus();
  await page.keyboard.press('Enter');
  await expect(presets).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(presets).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#stab-canvas').click();
  await expect(sidebar.locator('#background-panel')).toBeVisible();
  await expect(sidebar.locator('#bottom-bar')).toBeVisible();
  await expect(sidebar.locator('#audio-controls-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: '+ Add audio', exact: true })).toBeVisible();
  await sidebar.locator('.bg-preset[title="Notebook"]').click();
  await expect(sidebar.locator('.bg-preset[title="Notebook"]')).toHaveClass(/active/);
  await page.setViewportSize({ width: 1100, height: 700 });
  await sidebar.locator('#background-panel').scrollIntoViewIfNeeded();
  await expect(page.locator('#stab-content')).toBeInViewport();
  await expect(page.locator('#btn-generate')).toBeInViewport();
  expect(await sidebar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('#stab-content').click();
  await expect(sidebar.locator('#upload-panel')).toBeVisible();
});

test('Home and Studio are separate documents with independent initialization', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(origin);
  await expect(page.locator('#home-page')).toBeVisible();
  await expect(page.locator('#playbar, #main-canvas')).toHaveCount(0);
  await expect(page.locator('#auth-modal')).toBeHidden();
  expect(requests.some(url => url.includes('animations.js'))).toBe(false);
  expect(await page.evaluate(() => typeof window.launchStudio)).toBe('undefined');
  await page.evaluate(() => { window.homeDocumentMarker = true; });
  await page.getByRole('link', { name: 'Open Studio', exact: true }).click();
  await expect(page.locator('#main-canvas')).toBeVisible();
  await expect(page.locator('#playbar')).toBeVisible();
  await expect(page.locator('#home-page')).toHaveCount(0);
  expect(await page.evaluate(() => window.homeDocumentMarker)).toBeUndefined();
  await page.goto(origin);
  await expect(page.locator('#home-page')).toBeVisible();
  await expect(page.locator('#playbar')).toHaveCount(0);
});

for (const mode of ['login', 'signup']) {
  test(`Home ${mode} stays on Home until authentication succeeds`, async ({ page }) => {
    let succeed = false;
    await page.route(`**/api/auth/${mode}`, route => route.fulfill({
      status: succeed ? 200 : 401,
      json: succeed ? { user: { id: 'test-user' } } : { error: 'Authentication failed.' },
    }));
    await page.goto(origin);
    await page.evaluate(() => { window.homeDocumentMarker = true; });
    await page.getByRole('link', { name: mode === 'login' ? 'Log in' : 'Sign up', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/en`);
    expect(await page.evaluate(() => window.homeDocumentMarker)).toBe(true);
    await expect(page.locator('#auth-modal')).toBeVisible();
    await expect(page.locator('#main-canvas, #playbar')).toHaveCount(0);
    await page.locator('#auth-email').fill('test@example.invalid');
    await page.locator('#auth-password').fill('test-password');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-error')).toHaveText('Authentication failed.');
    await expect(page).toHaveURL(`${origin}/en`);
    succeed = true;
    await page.locator('#auth-submit').click();
    await expect(page).toHaveURL(/\/studio(?:[/?]|$)/);
    await expect(page.locator('#main-canvas')).toBeVisible();
  });
}

test('Google callback on Home requires a confirmed session before entering Studio', async ({ page }) => {
  await page.goto(`${origin}/?auth=google`);
  await expect(page.locator('#auth-error')).toHaveText('Please sign in again to continue.');
  await expect(page).toHaveURL(`${origin}/en?auth=google`);
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'test-user' } } }));
  await page.reload();
  await expect(page).toHaveURL(/\/studio(?:[/?]|$)/);
});

test('nested project routes serve Studio and resolve its rendering engine', async ({ page }) => {
  await page.goto(`${origin}/studio/test-user/test-project`);
  await expect(page.locator('#main-canvas')).toBeVisible();
  await expect(page.locator('#home-page')).toHaveCount(0);
  await expect(page.locator('#auth-modal')).toBeVisible();
  const source = await page.locator('script[src*="animations.js"]').getAttribute('src');
  expect(new URL(source, await page.evaluate(() => document.baseURI)).pathname).toBe('/animations.js');
});

test('export requires a session and rechecks it before recording', async ({ page }) => {
  await page.goto(`${origin}/studio`);
  await page.locator('#btn-export-top').click();
  await expect(page.locator('#auth-modal')).toBeVisible();
  await expect(page.locator('#export-banner')).not.toHaveClass(/active/);
  await page.evaluate(() => closeAuthModal());
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'test-user', email: 'test@example.invalid' } } }));
  await page.locator('#btn-export-top').click();
  await expect(page.locator('#export-banner')).toHaveClass(/active/);
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.locator('#start-recording-btn').click();
  await expect(page.locator('#auth-modal')).toBeVisible();
  await expect(page.locator('#export-progress-container')).not.toHaveClass(/active/);
  await expect(page.locator('#export-banner')).not.toHaveClass(/active/);
});

test('direct recording is blocked when session verification fails', async ({ page }) => {
  await page.goto(`${origin}/studio`);
  await page.route('**/api/auth/me', route => route.abort());
  await page.evaluate(() => startRecording());
  await expect(page.locator('#auth-modal')).toBeVisible();
  await expect(page.locator('#export-progress-container')).not.toHaveClass(/active/);
});
