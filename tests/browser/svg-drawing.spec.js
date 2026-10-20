const { test, expect } = require('@playwright/test');
const assets = {
  simple: '<path d="M10 50 L190 50" fill="none" stroke="#2455dd" stroke-width="4"/>',
  multipath: '<path d="M10 25 Q100 100 190 25 M10 75 L190 75" fill="none" stroke="#2455dd" stroke-width="4"/>',
  nested: '<g transform="translate(20 10)" opacity=".7"><g transform="scale(.8)"><path d="M0 0 L180 80" fill="none" stroke="#dd4422" stroke-width="5"/></g></g>',
  filled: '<path d="M10 10 H190 V90 H10 Z" fill="#2455dd"/>',
  complex: Array.from({ length: 80 }, (_, i) => `<path d="M${i * 2} 5 Q${i * 2 + 40} 50 ${i * 2} 95" fill="none" stroke="#2455dd" stroke-width=".5"/>`).join(''),
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wb_onboarding_done_v1', '1'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto('/en/studio'); await page.waitForFunction(() => window.InkplainerSVG && !_pagesRestoring);
});
for (const [name, markup] of Object.entries(assets)) {
  test(`SVG ${name}: visual reveal, deterministic seek and faithful final image`, async ({ page }) => {
    const result = await page.evaluate(async markup => {
      const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${markup}</svg>`);
      const img = new Image(); img.src = src; await img.decode();
      const layer = { x: 0, y: 0, w: 200, h: 100, img, opacity: 1, svgDrawing: { enabled: true, pauseMs: 80 } };
      const c = document.createElement('canvas'); c.width = 200; c.height = 100; const ctx = c.getContext('2d');
      const draw = progress => { ctx.clearRect(0, 0, 200, 100); const result = InkplainerSVG.draw(ctx, layer, img, progress, 2000); return { image: c.toDataURL(), pose: result.pose }; };
      const zero = draw(0), half = draw(.5); draw(.8); draw(.1); const repeated = draw(.5), final = draw(1);
      ctx.clearRect(0, 0, 200, 100); ctx.drawImage(img, 0, 0, 200, 100); const original = c.toDataURL();
      ctx.clearRect(0, 0, 200, 100); const blank = c.toDataURL();
      return { supported: InkplainerSVG.compile(src, layer.svgDrawing).supported, zero, half, repeated, final, original, blank };
    }, markup);
    expect(result.zero.image).toBe(result.blank);
    expect(result.half.image).not.toBe(result.final.image);
    expect(result.repeated).toEqual(result.half);
    expect(result.final.image).toBe(result.original);
    expect(result.supported).toBe(name !== 'filled');
    if (name === 'simple') { expect(result.half.pose.x).toBeCloseTo(100); expect(result.half.pose.y).toBeCloseTo(50); expect(result.half.pose.angle).toBeCloseTo(0); }
    expect(Buffer.from(result.half.image.split(',')[1], 'base64')).toMatchSnapshot(`svg-${name}-half.png`);
    expect(Buffer.from(result.final.image.split(',')[1], 'base64')).toMatchSnapshot(`svg-${name}-final.png`);
  });
}

test('unsupported filters retain original source and clearly report fallback', async ({ page }) => {
  const result = await page.evaluate(() => InkplainerSVG.compile('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="a"/></defs><path filter="url(#a)" d="M0 0L10 10"/></svg>')));
  expect(result.supported).toBe(false); expect(result.reason).toContain('unsupported SVG');
});

test('SVG geometry and settings survive scene restoration and use shared preview/export rendering', async ({ page }) => {
  const result = await page.evaluate(async markup => {
    const src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${markup}</svg>`);
    const img = new Image(); img.src = src; await img.decode(); addLayer(img, 'Vector');
    const layer = getSelectedLayer(); layer.svgDrawing = { enabled: true, pauseMs: 80, order: 'reverse', fallback: 'wipe' }; layer.clip = { startMs: 0, durationMs: 2000 };
    const saved = serializeEditorState();
    await new Promise(resolve => restoreEditorState(saved, resolve));
    const controller = ensurePreviewController(); await controller.prepare();
    const first = document.createElement('canvas'), second = document.createElement('canvas');
    controller.renderer.renderFrameAt(800, first, { includeHand: true, compositeHand: true });
    renderFrameAt(800, second);
    return { retained: saved.layers[0].imageDataURL === src, supported: InkplainerSVG.compile(state.layers[0].img.src, state.layers[0].svgDrawing).supported, same: first.toDataURL() === second.toDataURL(), settings: state.layers[0].svgDrawing };
  }, assets.multipath);
  expect(result.retained).toBe(true); expect(result.supported).toBe(true); expect(result.same).toBe(true);
  expect(result.settings).toEqual({ enabled: true, pauseMs: 80, order: 'reverse', fallback: 'wipe' });
});
