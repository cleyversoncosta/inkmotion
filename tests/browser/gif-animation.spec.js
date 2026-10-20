const { test, expect } = require('@playwright/test');

// Small, real GIF89a files; no image-decoder or renderer mocks.
function gif(frames, width = 2, height = 2) {
  const bytes = [...Buffer.from('GIF89a'), width, 0, height, 0, 0x81, 0, 0,
    0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 0,
    0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0];
  for (const frame of frames) {
    const w = frame.w || width, h = frame.h || height, pixels = frame.pixels || Array(w * h).fill(frame.color);
    const codes = [4, ...pixels, 5], packed = [];
    let bits = 0, value = 0, size = 3, next = 6, previous = false;
    for (const code of codes) {
      value |= code << bits; bits += size;
      while (bits >= 8) { packed.push(value & 255); value >>= 8; bits -= 8; }
      if (code === 4) { size = 3; next = 6; previous = false; }
      else if (code !== 5) { if (previous && ++next === 1 << size && size < 12) size++; previous = true; }
    }
    if (bits) packed.push(value & 255);
    bytes.push(0x21, 0xf9, 4, ((frame.disposal || 1) << 2) | 1, frame.delay || 20, 0, 0, 0,
      0x2c, frame.x || 0, 0, frame.y || 0, 0, w, 0, h, 0, frame.interlace ? 64 : 0,
      2, packed.length, ...packed, 0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}
const animated = gif([{ color: 1 }, { color: 2, delay: 30 }]);
const dataURL = `data:image/gif;base64,${animated.toString('base64')}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wb_onboarding_done_v1', '1'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto('/en/studio');
  await page.waitForFunction(() => window.InkplainerTimeline && currentProjectId && !_pagesRestoring);
});

test('downloaded GIF animates on the canvas and remains a GIF after saving and reload', async ({ page }) => {
  await page.route('https://example.com/animated.gif', route => route.fulfill({ contentType: 'image/gif', body: animated }));
  await page.evaluate(() => addRemoteImageToContent('Animated GIF', 'https://example.com/animated.gif'));
  await page.waitForFunction(() => state.layers.length === 1);
  await page.evaluate(async () => {
    const layer = state.layers[0]; layer.x = layer.y = 0; layer.w = layer.h = 100;
    await InkplainerGif.prepare(layer.img); redrawLayersOnCanvas();
  });
  const pixel = () => page.evaluate(() => [...ctx.getImageData(20, 20, 1, 1).data]);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  expect(await page.evaluate(() => getCurrentProjectSnapshot().layers[0].imageDataURL)).toBe(dataURL);
  await page.evaluate(() => saveProjectNow());
  await expect.poll(() => page.evaluate(() => new Promise(resolve => {
    const request = db.transaction('projects').objectStore('projects').get(currentProjectId);
    request.onsuccess = () => resolve(request.result?.state?.layers?.[0]?.imageDataURL);
  }))).toBe(dataURL);
  await page.reload();
  await page.waitForFunction(() => !_pagesRestoring && state.layers.length === 1 && state.layers[0].img?.complete);
  await page.evaluate(async () => { await InkplainerGif.prepare(state.layers[0].img); redrawLayersOnCanvas(); });
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
});

test('GIF preview and export frames follow scene time and survive random access seeking', async ({ page }) => {
  await page.evaluate(url => addImageDataURLToContent('Animation', url), dataURL);
  await page.waitForFunction(() => state.layers.length === 1);
  const result = await page.evaluate(async () => {
    const layer = state.layers[0]; layer.x = layer.y = 0; layer.w = layer.h = 100;
    layer.clip = { startMs: 100, durationMs: 2000 };
    const renderer = ensurePreviewController().renderer; await renderer.prepare();
    const output = document.createElement('canvas');
    const at = t => { renderer.renderFrameAt(t, output, { includeHand: false }); return [...output.getContext('2d').getImageData(20, 20, 1, 1).data]; };
    return [at(150), at(350), at(650), at(350)];
  });
  expect(result).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [255, 0, 0, 255], [0, 0, 255, 255]]);
  await page.evaluate(() => generate());
  await expect.poll(() => page.evaluate(() => !!previewController?.playing && !state._usingLegacyAnimation)).toBe(true);
});

test('GIF compositing handles transparency, disposal and interlaced rows like the browser decoder', async ({ page }) => {
  const fixture = gif([
    { pixels: [1, 1, 2, 2, 3, 3, 1, 1], interlace: true },
    { color: 2, w: 1, h: 1, disposal: 3 },
    { color: 3, x: 1, y: 1, w: 1, h: 1, disposal: 2 },
    { color: 1, x: 0, y: 3, w: 1, h: 1 },
  ], 2, 4);
  const result = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const ours = await InkplainerGif.decode(bytes);
    const decoder = new ImageDecoder({ data: bytes, type: 'image/gif' });
    await decoder.tracks.ready;
    const matches = [];
    for (let i = 0; i < ours.frames.length; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      const surface = document.createElement('canvas'); surface.width = 2; surface.height = 4;
      const context = surface.getContext('2d'); context.drawImage(image, 0, 0); image.close();
      matches.push(surface.toDataURL() === ours.frames[i].image.toDataURL());
    }
    decoder.close(); return matches;
  }, fixture.toString('base64'));
  expect(result).toEqual([true, true, true, true]);
});
