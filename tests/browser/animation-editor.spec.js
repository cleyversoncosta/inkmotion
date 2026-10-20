const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wb_onboarding_done_v1', '1'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto('/en/studio');
  await page.waitForFunction(() => window.InkplainerTimeline && currentProjectId && !_pagesRestoring);
  await page.evaluate(async () => {
    for (const color of ['#ff0000', '#0000ff']) {
      const source = document.createElement('canvas'); source.width = source.height = 40;
      const c = source.getContext('2d'); c.fillStyle = color; c.fillRect(0, 0, 40, 40);
      const img = new Image(); img.src = source.toDataURL(); await img.decode(); addLayer(img, color);
    }
    state.layers.forEach((layer, i) => { layer.x = 40 + i * 100; layer.y = 40; layer.w = layer.h = 40; layer.reviewStrategy = 'fade'; });
    redrawLayersOnCanvas();
  });
  await expect(page.locator('#motion-editor .motion-scroll')).toBeVisible();
});

for (const mode of ['grid', 'rect']) {
test(`slicer ${mode} order matches object tracks, layer list and playback`, async ({ page }) => {
  const expected = await page.evaluate(mode => {
    const source = state.layers.at(-1);
    source.name = 'Source';
    selectLayer(source.id);
    openSlicerModal();
    switchSlicerTab(mode);
    if (mode === 'grid') {
      document.getElementById('slicer-cols').value = '3';
      document.getElementById('slicer-rows').value = '1';
    } else {
      // A reordered manual list must retain its chosen order.
      _slicerRects = [3, 1, 2].map((label, index) => ({
        x: source.x + index * 10, y: source.y, w: 10, h: 40, label: `Slice ${label}`,
      }));
    }
    const names = mode === 'grid' ? ['Source 1', 'Source 2', 'Source 3']
      : _slicerRects.map(rect => `Source — ${rect.label}`);
    applySlices();
    return [...names, state.layers[0].name];
  }, mode);
  await expect.poll(() => page.evaluate(() => state.layers.length)).toBe(4);
  await expect(page.locator('#layer-list .layer-name')).toHaveText(expected);
  await expect(page.locator('.motion-track:not(.audio-track) .motion-name')).toHaveText(expected);
  expect(await page.evaluate(() => getStableOrderedLayers(state.layers).map(layer => layer.name))).toEqual(expected);
});
}

test('selecting a clip restores visible canvas objects without changing their timing', async ({ page }) => {
  const before = await page.evaluate(() => ({ pixels: canvas.toDataURL(), clips: state.layers.map(l => l.clip || null) }));
  await page.evaluate(() => InkplainerTimeline.seek(0));
  await page.locator('.motion-track .motion-clip').first().click();
  await expect.poll(() => page.evaluate(() => canvas.toDataURL())).toBe(before.pixels);
  expect(await page.evaluate(() => state.layers.map(l => l.clip || null))).toEqual(before.clips);
});

test('audio and object rulers use the largest duration and zoom together with minute labels', async ({ page }) => {
  await page.evaluate(() => {
    state.audioClips = [{ id: 'long-audio', name: 'Long audio', startMs: 0, durationMs: 90000, dataURL: 'data:audio/wav;base64,AAAA' }];
    // Isolate layout from audio decoding for this synthetic clip.
    window.alert = () => {};
    InkplainerTimeline.refresh();
  });
  const metrics = () => page.evaluate(() => {
    const object = document.querySelector('.motion-ruler .motion-lane');
    const audio = document.querySelector('.motion-ruler .audio-lane');
    return { widths: [object.style.width, audio.style.width], labels: [object.textContent, audio.textContent], fill: document.getElementById('motion-zoom').style.getPropertyValue('--pct') };
  });
  const initial = await metrics();
  expect(initial.widths).toEqual(['7300px', '7300px']);
  expect(initial.labels[0]).toBe(initial.labels[1]);
  expect(initial.labels[0]).toContain('01:30');
  const zoom = page.locator('#motion-zoom');
  await zoom.focus(); await zoom.press('ArrowRight');
  const updated = await metrics();
  expect(updated.widths).toEqual(['7390px', '7390px']);
  expect(updated.fill).not.toBe(initial.fill);
  await page.evaluate(() => { state.audioClips = []; state.sceneDurationMs = 120000; InkplainerTimeline.refresh(); });
  expect((await metrics()).widths).toEqual(['9820px', '9820px']);
});

test('GIF search uses the supported MIME filter and displays returned GIFs', async ({ page }) => {
  let query;
  await page.route('https://commons.wikimedia.org/w/api.php?**', route => {
    query = new URL(route.request().url()).searchParams.get('gsrsearch');
    return route.fulfill({ json: { query: { pages: { 1: { pageid: 1, title: 'File:Cat.gif', imageinfo: [{ mime: 'image/gif', url: 'https://example.com/cat.gif' }] } } } } });
  });
  await page.evaluate(async () => {
    document.getElementById('external-search-query').value = 'cat';
    document.getElementById('external-search-source').value = 'gifs';
    await searchExternalAssets();
  });
  expect(query).toBe('cat filemime:"image/gif"');
  await expect(page.locator('#external-search-results')).toContainText('Cat.gif');
});

test('infinite canvas prevents adding and duplicating scenes until disabled', async ({ page }) => {
  const count = await page.evaluate(() => state.pages.length);
  await page.evaluate(() => toggleInfiniteCanvas(true));
  for (const selector of ['.scene-timeline-add', '.pages-add-btn', '[data-action="duplicate"]']) {
    await expect(page.locator(selector)).toBeDisabled();
  }
  await page.evaluate(() => {
    createPage();
    document.querySelector('[data-action="duplicate"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(await page.evaluate(() => state.pages.length)).toBe(count);
  await page.evaluate(() => toggleInfiniteCanvas(false));
  for (const selector of ['.scene-timeline-add', '.pages-add-btn', '[data-action="duplicate"]']) {
    await expect(page.locator(selector)).toBeEnabled();
  }
  await page.locator('.scene-timeline-add').click();
  await expect.poll(() => page.evaluate(() => state.pages.length)).toBe(count + 1);
});

test('scenes and tracks share one scroll area', async ({ page }) => {
  await page.evaluate(() => {
    const layer = state.layers[0];
    state.layers = Array.from({ length: 18 }, (_, i) => ({ ...layer, id: 100 + i, objectId: `scroll-${i}`, name: `Track ${i}`, clip: { startMs: i * 1000, durationMs: 20000 } }));
    persistActivePageToMemory(); renderSceneThumbs(); InkplainerTimeline.refresh();
  });
  const result = await page.evaluate(() => {
    const outer = document.getElementById('scene-timeline');
    const inner = [document.getElementById('scene-scroll'), document.querySelector('.motion-scroll')];
    const scene = document.getElementById('scene-ruler'), track = document.querySelector('.motion-lane');
    const before = [scene.getBoundingClientRect().left, track.getBoundingClientRect().left];
    outer.scrollLeft = 200; outer.scrollTop = 160;
    return {
      overflow: inner.map(el => [getComputedStyle(el).overflowX, getComputedStyle(el).overflowY]),
      innerScroll: inner.map(el => [el.scrollLeft, el.scrollTop]),
      scroll: [outer.scrollLeft, outer.scrollTop],
      movement: [before[0] - scene.getBoundingClientRect().left, before[1] - track.getBoundingClientRect().left],
    };
  });
  expect(result.overflow).toEqual([['visible', 'visible'], ['visible', 'visible']]);
  expect(result.innerScroll).toEqual([[0, 0], [0, 0]]);
  expect(result.scroll).toEqual([200, 160]);
  expect(result.movement).toEqual([200, 200]);
  await expect(page.locator('#scene-timeline').getByTitle('Add scene', { exact: true })).toBeInViewport();
});

test('clip drag and resize change shared timing, persist and undo', async ({ page }) => {
  const layerId = await page.evaluate(() => state.layers[1].id);
  const clip = page.locator(`.motion-clip[data-layer-id="${layerId}"]`);
  await clip.scrollIntoViewIfNeeded();
  const bounds = await clip.boundingBox();
  await page.mouse.move(bounds.x + 20, bounds.y + 10); await page.mouse.down();
  await page.mouse.move(bounds.x + 100, bounds.y + 10, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => state.layers[1].clip?.startMs)).toBe(1000);
  await expect.poll(() => page.evaluate(() => ensurePreviewController().renderer.compileTimeline().items.find(i => i.layer === state.layers[1]).startMs)).toBe(1000);
  await clip.locator('.motion-resize').scrollIntoViewIfNeeded();
  const resize = await clip.locator('.motion-resize').boundingBox();
  await page.mouse.move(resize.x + 4, resize.y + 10); await page.mouse.down();
  await page.mouse.move(resize.x + 84, resize.y + 10, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => state.layers[1].clip.durationMs)).toBe(6000);
  await page.evaluate(() => undo());
  await page.waitForFunction(() => !_undoRestoring);
  expect(await page.evaluate(() => state.layers[1].clip.durationMs)).toBe(5000);
  await page.evaluate(() => redo()); await page.waitForFunction(() => !_undoRestoring);
  expect(await page.evaluate(() => state.layers[1].clip.durationMs)).toBe(6000);
  await page.evaluate(() => saveProjectNow());
  await expect.poll(() => page.evaluate(() => new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get(currentProjectId); r.onsuccess = () => resolve(r.result.state.layers[1].clip?.durationMs); }))).toBe(6000);
  await page.reload(); await page.waitForFunction(() => state.layers.length === 2 && !_pagesRestoring);
  expect(await page.evaluate(() => state.layers[1].clip)).toEqual({ startMs: 1000, durationMs: 6000 });
});

test('overlapping object transforms and camera render deterministic preview/export frames', async ({ page }) => {
  const result = await page.evaluate(async () => {
    InkplainerTimeline.enableTracks();
    state.layers.forEach((layer, index) => {
      layer.clip = { startMs: 0, durationMs: 1000 };
      layer.keyframes = { x: [{ timeMs: 0, value: 40 + index * 100 }, { timeMs: 1000, value: 80 + index * 100 }] };
    });
    state.virtualCamera = { x: state.canvasW / 2, y: state.canvasH / 2, zoom: 1, keyframes: { zoom: [{ timeMs: 0, value: 1 }, { timeMs: 1000, value: 1.1 }] } };
    const before = JSON.stringify(state.layers.map(l => [l.x, l.y, l.keyframes]));
    const c = document.createElement('canvas'); await InkplainerRenderer.prepareAssets();
    renderFrameAt(500, c); const first = c.toDataURL();
    renderFrameAt(1000, c); renderFrameAt(0, c); renderFrameAt(500, c);
    const repeated = c.toDataURL();
    const controller = ensurePreviewController(); await controller.seek(500);
    return { first, repeated, preview: canvas.toDataURL(), unchanged: JSON.stringify(state.layers.map(l => [l.x, l.y, l.keyframes])) === before };
  });
  expect(result.repeated).toBe(result.first); expect(result.preview).toBe(result.first); expect(result.unchanged).toBe(true);
});

test('keyframe UI, scene duplication and cross-scene undo retain independent objects', async ({ page }) => {
  await page.locator('#motion-property').selectOption('x');
  await page.locator('#motion-key-time').fill('500'); await page.locator('#motion-key-value').fill('200');
  await page.locator('[data-action="key"]').click();
  expect(await page.evaluate(() => getSelectedLayer().keyframes.x[0].value)).toBe(200);
  await page.locator('[data-action="duplicate"]').click();
  await page.waitForFunction(() => state.pages.length === 2 && !_pagesRestoring);
  const copy = await page.evaluate(() => ({ id: state.activePageId, keys: state.layers.find(l => l.keyframes)?.keyframes }));
  expect(copy.keys.x[0].value).toBe(200);
  await page.evaluate(() => undo()); await page.waitForFunction(() => !_undoRestoring);
  expect(await page.evaluate(() => state.pages.length)).toBe(1);
  await page.evaluate(() => redo()); await page.waitForFunction(() => !_undoRestoring);
  expect(await page.evaluate(() => state.activePageId)).toBe(copy.id);
  expect(await page.evaluate(() => state.layers.find(l => l.keyframes).keyframes)).toEqual(copy.keys);
});

test('camera zoom maps actual canvas dragging back to world coordinates', async ({ page }) => {
  const before = await page.evaluate(() => {
    const layer = state.layers[0]; selectLayer(layer.id, { openSettings: false });
    state.virtualCamera = { x: layer.x + layer.w / 2, y: layer.y + layer.h / 2, zoom: 2 };
    redrawLayersOnCanvas(); drawSelectionHandles();
    return { x: layer.x, width: state.canvasW };
  });
  const bounds = await page.locator('#select-canvas').boundingBox();
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  await page.mouse.move(center.x + 30, center.y, { steps: 4 }); await page.mouse.up();
  expect(await page.evaluate(() => state.layers[0].x)).toBeCloseTo(before.x + 30 * before.width / bounds.width / 2, 1);
});

test('editing saved text preserves stable identity, content and keyframe tracks', async ({ page }) => {
  await page.evaluate(() => { openTextEditor(100, 100, null); document.getElementById('text-editor-ta').value = 'Editable text'; closeTextEditor(true); });
  await page.waitForFunction(() => state.layers.some(layer => layer.kind === 'text'));
  const original = await page.evaluate(async () => {
    const layer = state.layers.find(layer => layer.kind === 'text');
    layer.clip = { startMs: 300, durationMs: 2000 };
    layer.keyframes = { opacity: [{ timeMs: 0, value: 0 }, { timeMs: 2000, value: 1 }] };
    const id = layer.id, saved = serializeEditorState();
    await new Promise(resolve => restoreEditorState(saved, resolve));
    openTextEditor(100, 100, state.layers.find(layer => layer.id === id));
    return { id, content: document.getElementById('text-editor-ta').value };
  });
  expect(original.content).toBe('Editable text');
  await page.evaluate(() => { document.getElementById('text-editor-ta').value = 'Updated text'; closeTextEditor(true); });
  await page.waitForFunction(() => state.layers.some(layer => layer._textContent === 'Updated text'));
  const result = await page.evaluate(() => { const layer = state.layers.find(layer => layer.kind === 'text'); return { id: layer.id, clip: layer.clip, keys: layer.keyframes, text: serializeEditorState().layers.find(layer => layer.kind === 'text').textProps.text }; });
  expect(result.id).toBe(original.id); expect(result.clip).toEqual({ startMs: 300, durationMs: 2000 });
  expect(result.keys.opacity).toHaveLength(2); expect(result.text).toBe('Updated text');
});
