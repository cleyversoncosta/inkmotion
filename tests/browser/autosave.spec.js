const { test, expect } = require('@playwright/test');

async function readProject(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get(currentProjectId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wb_onboarding_done_v1', '1'));
});

test('an edit survives an immediate refresh without a manual save', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto('/en/studio');
  await page.waitForFunction(() => currentProjectId && !_pagesRestoring);
  await page.evaluate(() => selectBgPreset(null, 'solid', '#123456'));
  await page.reload();
  await page.waitForFunction(() => currentProjectId && !_pagesRestoring);
  expect(await page.evaluate(() => state.canvasBg)).toEqual({ type: 'solid', val: '#123456' });
});

test('account refresh preserves failed autosaves and retries them', async ({ page }) => {
  const user = { id: 'autosave-user', email: 'autosave@example.test' };
  let project = { id: 'autosave-project', name: 'Autosave regression', state: {} };
  let failWrites = true;
  let writes = 0;
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user } }));
  await page.route('**/api/projects', route => route.fulfill({ json: { projects: [project] } }));
  await page.route('**/api/projects/autosave-project', async route => {
    if (route.request().method() === 'PUT') {
      writes++;
      if (failWrites) {
        await route.fulfill({ status: 503, json: { error: 'Simulated outage' } });
        return;
      }
      project = { ...project, ...route.request().postDataJSON() };
    }
    await route.fulfill({ json: { project } });
  });
  await page.goto('/en/studio/autosave-user/autosave-project');
  await page.waitForFunction(() => currentProjectId && !_pagesRestoring);
  await page.evaluate(() => selectBgPreset(null, 'solid', '#abcdef'));
  await expect.poll(() => writes).toBeGreaterThan(0);
  expect((await readProject(page)).pendingCloudSave).toBeTruthy();
  await page.reload();
  await page.waitForFunction(() => currentProjectId && !_pagesRestoring);
  expect(await page.evaluate(() => state.canvasBg)).toEqual({ type: 'solid', val: '#abcdef' });
  expect((await readProject(page)).pendingCloudSave).toBeTruthy();
  failWrites = false;
  await expect.poll(async () => (await readProject(page)).pendingCloudSave).toBeFalsy();
  expect(project.state.canvasBg).toEqual({ type: 'solid', val: '#abcdef' });
});

test('an older cloud response cannot mark a newer edit as synced', async ({ page }) => {
  const user = { id: 'autosave-user', email: 'autosave@example.test' };
  const project = { id: 'autosave-project', name: 'Autosave regression', state: {} };
  let firstWrite;
  let writes = 0;
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user } }));
  await page.route('**/api/projects', route => route.fulfill({ json: { projects: [project] } }));
  await page.route('**/api/projects/autosave-project', async route => {
    if (route.request().method() === 'PUT') {
      writes++;
      if (writes === 1) {
        firstWrite = route;
        return;
      }
      await route.fulfill({ status: 503, json: { error: 'Simulated outage' } });
      return;
    }
    await route.fulfill({ json: { project } });
  });
  await page.goto('/en/studio/autosave-user/autosave-project');
  await page.waitForFunction(() => currentProjectId && !_pagesRestoring);
  await page.evaluate(() => selectBgPreset(null, 'solid', '#111111'));
  await expect.poll(() => !!firstWrite).toBe(true);
  const oldRevision = (await readProject(page)).pendingCloudSave;
  await page.evaluate(() => selectBgPreset(null, 'solid', '#222222'));
  const newRevision = (await readProject(page)).pendingCloudSave;
  expect(newRevision).not.toBe(oldRevision);
  await firstWrite.fulfill({ json: { project: { ...project, ...firstWrite.request().postDataJSON() } } });
  await expect.poll(() => writes).toBe(2);
  expect((await readProject(page)).pendingCloudSave).toBe(newRevision);
  await page.reload();
  await page.waitForFunction(() => currentProjectId && !_pagesRestoring);
  expect(await page.evaluate(() => state.canvasBg)).toEqual({ type: 'solid', val: '#222222' });
});
