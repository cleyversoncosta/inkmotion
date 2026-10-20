const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.addInitScript(() => localStorage.setItem('wb_onboarding_done_v1', '1'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto('/en/studio');
  await page.waitForFunction(() => window.state && currentProjectId && !_pagesRestoring);
  await page.evaluate(async () => {
    const image = new Image();
    const bitmap = document.createElement('canvas');
    bitmap.width = bitmap.height = 40;
    bitmap.getContext('2d').fillRect(0, 0, 40, 40);
    image.src = bitmap.toDataURL();
    await image.decode();
    state.layers = [
      { id: 901, x: 100, y: 100 }, { id: 902, x: 220, y: 100 },
      { id: 903, x: 400, y: 100 }, { id: 904, x: 150, y: 100, locked: true },
      { id: 905, x: 150, y: 150, visible: false },
    ].map(layer => ({ name: `Object ${layer.id}`, w: 60, h: 60, img: image, visible: true, ...layer }));
    state.groups = [];
    state.virtualCamera = null;
    setSelectedLayers([]);
    initCanvas(1280, 720);
  });
});

async function point(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const rect = canvas.getBoundingClientRect();
    if (state.virtualCamera) {
      const camera = InkplainerAnimation.cameraAt(state.virtualCamera, 0, state.canvasW, state.canvasH);
      x = (x - camera.x) * camera.zoom + state.canvasW / 2;
      y = (y - camera.y) * camera.zoom + state.canvasH / 2;
    }
    return { x: rect.left + x * rect.width / state.canvasW, y: rect.top + y * rect.width / state.canvasW };
  }, { x, y });
}

async function drag(page, from, to) {
  const a = await point(page, ...from), b = await point(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

const selection = page => page.evaluate(() => getSelectedLayers().map(layer => layer.id).sort());

test('rectangle selection moves and deletes multiple objects with one-step undo', async ({ page }) => {
  await drag(page, [80, 80], [300, 190]);
  expect(await selection(page)).toEqual([901, 902]);
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await drag(page, [120, 120], [150, 140]);
  const positions = () => page.evaluate(() => state.layers.slice(0, 2).map(({ x, y }) => ({ x, y })));
  const moved = await positions();
  expect(Math.abs(moved[0].x - 130)).toBeLessThan(3);
  expect(moved[1].x - moved[0].x).toBeCloseTo(120);
  expect(Math.abs(moved[0].y - 120)).toBeLessThan(3);
  await page.evaluate(() => undo());
  await expect.poll(positions).toEqual([{ x: 100, y: 100 }, { x: 220, y: 100 }]);
  await drag(page, [80, 80], [300, 190]);
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => state.layers.map(layer => layer.id))).toEqual([903, 904, 905]);
  await page.evaluate(() => undo());
  await expect.poll(() => page.evaluate(() => state.layers.length)).toBe(5);
});

test('reverse selection works with zoom, Shift selection, grouping and empty clicks', async ({ page }) => {
  await page.evaluate(() => setCanvasZoom(1.4));
  await drag(page, [300, 190], [80, 80]);
  expect(await selection(page)).toEqual([901, 902]);
  await page.keyboard.down('Shift');
  const third = await point(page, 430, 130);
  await page.mouse.click(third.x, third.y);
  expect(await selection(page)).toEqual([901, 902, 903]);
  await page.mouse.click(third.x, third.y);
  await page.keyboard.up('Shift');
  expect(await selection(page)).toEqual([901, 902]);
  await page.evaluate(() => createGroupFromSelected());
  expect(await page.evaluate(() => state.groups[0].layerIds)).toEqual([901, 902]);
  const empty = await point(page, 80, 80);
  await page.mouse.click(empty.x, empty.y);
  expect(await selection(page)).toEqual([]);
});
