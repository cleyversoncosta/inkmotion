const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wb_onboarding_done_v1', '1'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto('/en/studio');
  await page.waitForFunction(() => window.state && currentProjectId && !_pagesRestoring);
});

async function uploadImages(page, count = 1) {
  const images = await page.evaluate(count => Array.from({ length: count }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 60;
    const context = canvas.getContext('2d');
    context.fillStyle = index % 2 ? '#3455aa' : '#ee7744';
    context.fillRect(0, 0, 80, 60);
    return canvas.toDataURL().split(',')[1];
  }), count);
  await page.locator('#file-input').setInputFiles(images.map((data, index) => ({
    name: `Fixture ${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64'),
  })));
  await expect(page.locator('.asset-item')).toHaveCount(count);
}

async function insertLibraryImage(page) {
  await page.locator('.asset-item').first().click();
  // reuseAsset decodes its Image asynchronously before creating the layer.
  await expect(page.locator('.layer-item')).toHaveCount(1);
}

test('uploads stay in the library and local project data survives reload', async ({ page }) => {
  await uploadImages(page, 2);
  expect(await page.evaluate(() => state.layers.length)).toBe(0);
  await insertLibraryImage(page);
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get(currentProjectId);
    request.onsuccess = () => resolve({ layers: request.result?.state.layers.length, assets: request.result?.state.assets.length });
    request.onerror = () => reject(request.error);
  }))).toEqual({ layers: 1, assets: 2 });
  const before = await page.evaluate(() => ({ name: state.layers[0].name, src: state.layers[0].img.src }));
  await page.reload();
  await expect(page.locator('.layer-item')).toHaveCount(1);
  await expect(page.locator('.asset-item')).toHaveCount(2);
  expect(await page.evaluate(() => ({ name: state.layers[0].name, src: state.layers[0].img.src }))).toEqual(before);
});

test('saving captures the requested state before later edits change it', async ({ page }) => {
  await uploadImages(page);
  await insertLibraryImage(page);
  const saved = await page.evaluate(async () => {
    state.layers[0].name = 'Requested snapshot';
    saveProjectNow();
    state.layers[0].name = 'Later edit';
    persistActivePageToMemory();
    return new Promise(resolve => {
      const request = db.transaction('projects').objectStore('projects').get(currentProjectId);
      request.onsuccess = () => resolve({ name: request.result.state.layers[0].name, sceneName: request.result.state.pages[0].layers[0].name });
    });
  });
  expect(saved).toEqual({ name: 'Requested snapshot', sceneName: 'Requested snapshot' });
});

test('layer dimensions, confirmed deletion, undo and redo preserve the image', async ({ page }) => {
  await uploadImages(page);
  await insertLibraryImage(page);
  const toggle = page.locator('.layer-collapse-btn');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.getByLabel('Width (px)', { exact: true }).fill('320');
  await page.getByLabel('Width (px)', { exact: true }).press('Enter');
  await page.getByLabel('Height (px)', { exact: true }).fill('180');
  await page.getByLabel('Height (px)', { exact: true }).press('Enter');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  await expect(page.locator('.layer-item')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  await expect(page.locator('.layer-item')).toHaveCount(0);
  await page.evaluate(() => undo());
  await page.waitForFunction(() => !_undoRestoring && state.layers.length === 1);
  expect(await page.evaluate(() => ({ w: state.layers[0].w, h: state.layers[0].h, decoded: state.layers[0].img.naturalWidth > 0 })))
    .toEqual({ w: 320, h: 180, decoded: true });
  await page.evaluate(() => redo());
  await expect(page.locator('.layer-item')).toHaveCount(0);
});

test('legacy single-scene state restores rich layer data without changing its persisted shape', async ({ page }) => {
  await uploadImages(page);
  await insertLibraryImage(page);
  const result = await page.evaluate(async () => {
    const layer = state.layers[0];
    Object.assign(layer, { kind: 'text', textProps: { text: 'Compatibility', fontSize: 32, fontFamily: 'sans-serif' },
      reviewStrategy: 'fade', reviewDuration: 2, stopTime: 1, opacity: 0.65, visible: false, groupId: 'compat-group',
      sliceSourceImageDataURL: layer.img.src, sliceSourceRect: { x: 0, y: 0, w: 80, h: 60 } });
    state.groups = [{ id: 'compat-group', name: 'Compatibility', layerIds: [layer.id], collapsed: false }];
    const saved = JSON.parse(JSON.stringify(serializeEditorState()));
    const normalized = normalizeProjectPages(saved);
    await new Promise(resolve => restoreEditorState(normalized.pages[0], resolve));
    const restored = serializeEditorState();
    const keys = ['id', 'name', 'imageDataURL', 'x', 'y', 'w', 'h', 'opacity', 'visible', 'groupId',
      'kind', 'textProps', 'reviewStrategy', 'reviewDuration', 'stopTime', 'sliceSourceImageDataURL', 'sliceSourceRect'];
    const pick = layer => Object.fromEntries(keys.map(key => [key, layer[key]]));
    return { before: pick(saved.layers[0]), after: pick(restored.layers[0]), groups: restored.groups,
      expectedGroups: saved.groups, pages: normalized.pages.length };
  });
  expect(result.pages).toBe(1);
  expect(result.after).toEqual(result.before);
  expect(result.groups).toEqual(result.expectedGroups);
});

test('known R6: undo should restore the position before a canvas drag', async ({ page }) => {
  await uploadImages(page);
  await insertLibraryImage(page);
  const target = await page.evaluate(() => {
    clearUndoHistory();
    const layer = getSelectedLayer();
    const rect = canvas.getBoundingClientRect();
    return { originalX: layer.x,
      x: rect.left + (layer.x + layer.w / 2) * rect.width / state.canvasW,
      y: rect.top + (layer.y + layer.h / 2) * rect.height / state.canvasH };
  });
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 20, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => state.layers[0].x)).not.toBe(target.originalX);
  await page.evaluate(() => undo());
  await page.waitForFunction(() => !_undoRestoring);
  const restoredX = await page.evaluate(() => state.layers[0].x);
  expect(restoredX).toBe(target.originalX);
});

test('known R6: undo should retain editable text and review strategy metadata', async ({ page }) => {
  await uploadImages(page);
  await insertLibraryImage(page);
  await page.evaluate(() => {
    Object.assign(state.layers[0], { kind: 'text', textProps: { text: 'History fixture' }, reviewStrategy: 'fade' });
    clearUndoHistory();
    setLayerOpacity(state.layers[0].id, 0.5);
    undo();
  });
  await page.waitForFunction(() => !_undoRestoring);
  const restored = await page.evaluate(() => ({ kind: state.layers[0].kind || null,
    textProps: state.layers[0].textProps || null, reviewStrategy: state.layers[0].reviewStrategy }));
  expect(restored).toEqual({ kind: 'text', textProps: { text: 'History fixture' }, reviewStrategy: 'fade' });
});

for (const cancel of [false, true]) {
  test(`offline export orchestration ${cancel ? 'cancels and releases resources' : 'encodes every timestamp and releases resources'} (mock codec/muxer)`, async ({ page }) => {
    await uploadImages(page);
    await insertLibraryImage(page);
    const result = await page.evaluate(async cancel => {
      state.layers[0].reviewDuration = 0.2;
      state.layers[0].stopTime = 0;
      state.layers[0].hand = 'ghost';
      const timestamps = [];
      let closed = false, finalized = false;
      const originalEncoder = window.VideoEncoder;
      const originalFrame = window.VideoFrame;
      const originalConfig = OfflineExportEngine.prototype.selectEncoderConfig;
      const originalMuxer = OfflineExportEngine.prototype.createMuxer;
      const originalSettings = getExportSettings;
      window.VideoFrame = class {
        constructor(canvas, options) { this.timestamp = options.timestamp; }
        close() {}
      };
      window.VideoEncoder = class {
        encodeQueueSize = 0;
        configure() {}
        encode(frame) { timestamps.push(frame.timestamp); if (cancel) cancelCurrentExport(); }
        async flush() {}
        close() { closed = true; }
      };
      getExportSettings = () => ({ width: 80, height: 60, fps: 30, bitrate: 1000000, codec: 'auto' });
      OfflineExportEngine.prototype.selectEncoderConfig = async () => ({ codec: 'vp09.00.10.08' });
      OfflineExportEngine.prototype.createMuxer = async () => ({
        muxer: { finalize() { finalized = true; } }, target: { buffer: new ArrayBuffer(8) },
      });
      let error = null, profile = null;
      try {
        const exported = await runOfflineExport('webm', document.createElement('div'), document.createElement('div'));
        profile = exported.profile;
      } catch (err) { error = err.message; }
      finally {
        window.VideoEncoder = originalEncoder;
        window.VideoFrame = originalFrame;
        getExportSettings = originalSettings;
        OfflineExportEngine.prototype.selectEncoderConfig = originalConfig;
        OfflineExportEngine.prototype.createMuxer = originalMuxer;
      }
      return { timestamps, closed, finalized, error, profile, released: currentOfflineExport === null && !state.recording };
    }, cancel);
    expect(result.closed).toBe(true);
    expect(result.released).toBe(true);
    if (cancel) {
      expect(result.error).toBe('Export cancelled');
      expect(result.finalized).toBe(false);
      expect(result.timestamps).toHaveLength(1);
    } else {
      expect(result.error).toBeNull();
      expect(result.finalized).toBe(true);
      expect(result.profile.frameCount).toBe(6);
      expect(result.timestamps).toEqual([0, 33333, 66666, 99999, 133332, 166665]);
    }
  });
}
