const { test, expect } = require('@playwright/test');
const APP_URL = new URL('/en/studio', process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:18083').href;

async function installFixture(page, count) {
  await page.evaluate(async ({ count }) => {
    function colorForIndex(index) {
      return `hsl(${(index * 47) % 360}, 72%, 52%)`;
    }
    function makeCanvasLayer(layer) {
      const c = document.createElement('canvas');
      c.width = layer.w;
      c.height = layer.h;
      const ctx = c.getContext('2d');
      if (layer.kind === 'transparent-png') {
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.fillStyle = layer.color;
        ctx.globalAlpha = 0.72;
        ctx.beginPath();
        ctx.arc(c.width * 0.5, c.height * 0.5, Math.min(c.width, c.height) * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 5;
        ctx.stroke();
      } else if (layer.kind === 'jpeg') {
        ctx.fillStyle = '#f8f8f8';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = layer.color;
        ctx.fillRect(8, 8, c.width - 16, c.height - 16);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, c.height * 0.6, c.width, c.height * 0.4);
      } else if (layer.kind === 'text') {
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.fillStyle = layer.color;
        ctx.font = '700 32px sans-serif';
        ctx.fillText(`Text ${layer.id}`, 8, Math.min(c.height - 12, 44));
      } else {
        ctx.fillStyle = layer.color;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(8, c.height - 12);
        ctx.bezierCurveTo(c.width * 0.25, 8, c.width * 0.7, c.height - 8, c.width - 8, 16);
        ctx.stroke();
      }
      const img = new Image();
      img.src = c.toDataURL(layer.kind === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
      return new Promise(resolve => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
      });
    }
    const styles = ['scanner', 'chunkjump', 'scribble', 'contour', 'outlinechunks', 'outlinefill', 'illustfill', 'outlineonly', 'spec-text'];
    const kinds = ['transparent-png', 'jpeg', 'svg', 'text'];
    const layers = [];
    for (let i = 0; i < count; i++) {
      const layer = {
        id: i + 1,
        name: `Browser Fixture ${i + 1}`,
        kind: kinds[i % kinds.length],
        x: 40 + ((i * 73) % 900),
        y: 40 + ((i * 41) % 470),
        w: 90 + ((i * 17) % 120),
        h: 70 + ((i * 19) % 110),
        opacity: i % 7 === 0 ? 0.62 : 1,
        visible: true,
        animOrder: i % 4 < 2 ? Math.floor(i / 4) + 1 : Math.floor(i / 3) + 2,
        groupId: i % 9 === 0 ? 'test-group' : null,
        animStyle: styles[i % styles.length],
        hand: 'ghost',
        speed: 30 + (i % 40),
        handSpeed: 6,
        chunks: 12 + (i % 30),
        specChunks: 18 + (i % 40),
        reviewDuration: 0,
        color: colorForIndex(i),
      };
      layer.img = await makeCanvasLayer(layer);
      layers.push(layer);
    }
    window.state.canvasW = 1280;
    window.state.canvasH = 720;
    window.state.canvasBg = { type: 'solid', val: 'transparent' };
    window.state.layers = layers;
    window.state.selectedLayerId = layers[0]?.id || null;
    window.initCanvas(1280, 720);
    window.InkplainerRenderer.dispose();
    await window.InkplainerRenderer.prepareAssets();
    await window.InkplainerRenderer.compileTimeline();
  }, { count });
}

async function getFrameStats(page, timestampMs) {
  return page.evaluate((timestampMs) => {
    const canvas = document.getElementById('main-canvas');
    window.renderFrameAt(timestampMs, canvas);
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let alpha = 0;
    let semiAlpha = 0;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) alpha++;
      if (data[i + 3] > 0 && data[i + 3] < 255) semiAlpha++;
      hash ^= data[i] + (data[i + 1] << 8) + (data[i + 2] << 16) + (data[i + 3] << 24);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return { width: canvas.width, height: canvas.height, alpha, semiAlpha, hash };
  }, timestampMs);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => { throw err; });
  await page.addInitScript(() => localStorage.setItem('wb_onboarding_done_v1', '1'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto(APP_URL);
  await page.waitForFunction(() => window.state && window.InkplainerRenderer && window.renderFrameAt);
});

for (const interactionType of ['move', 'resize']) {
test(`canvas dragging (${interactionType}) batches pointer events and caches stationary layers`, async ({ page }) => {
  await installFixture(page, 50);
  const result = await page.evaluate(interactionType => {
    state.infiniteCanvas = false;
    const layer = state.layers[20];
    state.selectedLayerId = layer.id;
    const originalX = layer.x;
    const originalY = layer.y;
    const originalWidth = layer.w;
    _interact = { type: interactionType, handle: 'e', startX: layer.x, startY: layer.y,
      orig: { x: layer.x, y: layer.y, w: layer.w, h: layer.h } };
    let draws = 0;
    const originalDraw = drawEditorLayer;
    drawEditorLayer = (...args) => { draws++; return originalDraw(...args); };
    const rect = canvas.getBoundingClientRect();
    const pointer = offset => ({ clientX: rect.left + (originalX + offset) * rect.width / state.canvasW,
      clientY: rect.top + originalY * rect.width / state.canvasW, shiftKey: false });
    handleCanvasPointerMove(pointer(1));
    draws = 0;
    for (let i = 2; i <= 30; i++) queueCanvasPointerMove(pointer(i));
    const drawsBeforeFlush = draws;
    flushCanvasPointerMove();
    const dragDraws = draws;
    const cached = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // Mouseup must apply the last queued movement, even before the next frame.
    queueCanvasPointerMove(pointer(30));
    document.dispatchEvent(new MouseEvent('mouseup'));
    redrawLayersOnCanvas();
    const full = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let maxDifference = 0;
    for (let i = 0; i < full.length; i++) maxDifference = Math.max(maxDifference, Math.abs(full[i] - cached[i]));
    drawEditorLayer = originalDraw;
    return { drawsBeforeFlush, dragDraws, displacement: interactionType === 'move' ? layer.x - originalX : layer.w - originalWidth,
      maxDifference, released: _interact === null && _interactionFrame === null };
  }, interactionType);
  expect(result.drawsBeforeFlush).toBe(0);
  expect(result.dragDraws).toBe(1);
  expect(result.displacement).toBeCloseTo(30);
  // Intermediate surfaces introduce small 8-bit alpha rounding differences.
  expect(result.maxDifference).toBeLessThanOrEqual(4);
  expect(result.released).toBe(true);
});
}

test('renderFrameAt is deterministic and supports random-access seeking', async ({ page }) => {
  await installFixture(page, 10);
  const duration = await page.evaluate(() => window.InkplainerRenderer.getDuration());
  const sequence = [10000, 1000, 60000, 0, 30000].map(t => Math.max(0, Math.min(t, duration)));
  const frames = [];
  for (const timestamp of sequence) frames.push(await getFrameStats(page, timestamp));
  const repeat = await getFrameStats(page, sequence[1]);
  expect(repeat.hash).toBe(frames[1].hash);
  expect(frames.at(-1).alpha).toBeGreaterThan(frames[0].alpha);
});

test('final frame contains all visible completed layers and preserves transparency', async ({ page }) => {
  await installFixture(page, 50);
  const duration = await page.evaluate(() => window.InkplainerRenderer.getDuration());
  const finalFrame = await getFrameStats(page, duration);
  expect(finalFrame.width).toBe(1280);
  expect(finalFrame.height).toBe(720);
  expect(finalFrame.alpha).toBeGreaterThan(1000);
  expect(finalFrame.semiAlpha).toBeGreaterThan(0);
});

test('compiled timeline exposes deterministic layer metadata', async ({ page }) => {
  await installFixture(page, 10);
  const timeline = await page.evaluate(() => window.InkplainerRenderer.compileTimeline());
  expect(timeline.durationMs).toBeGreaterThan(0);
  expect(timeline.items.length).toBe(10);
  const firstGroup = timeline.groups[0];
  expect(firstGroup.items.length).toBeGreaterThan(1);
  expect(new Set(firstGroup.items.map(item => item.startMs)).size).toBe(1);
  expect(new Set(firstGroup.items.map(item => item.endMs)).size).toBe(1);
  for (const item of timeline.items) {
    expect(item.bounds.w).toBeGreaterThan(0);
    expect(item.opacity).toBeGreaterThan(0);
    expect(item.revealStyle).toBeTruthy();
    expect(item.animationParams.speed).toBeGreaterThan(0);
  }
});

test('renderFrameAt preserves layer order at overlapping pixels', async ({ page }) => {
  const pixel = await page.evaluate(async () => {
    function imageFor(color) {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 80, 80);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      return new Promise(resolve => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
      });
    }
    const red = await imageFor('#ff0000');
    const blue = await imageFor('#0000ff');
    window.state.canvasW = 240;
    window.state.canvasH = 180;
    window.state.canvasBg = { type: 'solid', val: 'transparent' };
    window.state.layers = [
      { id: 1, name: 'bottom', img: red, x: 50, y: 40, w: 80, h: 80, opacity: 1, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 0, hand: 'ghost' },
      { id: 2, name: 'top', img: blue, x: 50, y: 40, w: 80, h: 80, opacity: 1, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 0, hand: 'ghost' },
    ];
    window.initCanvas(240, 180);
    window.InkplainerRenderer.dispose();
    await window.InkplainerRenderer.prepareAssets();
    await window.InkplainerRenderer.compileTimeline();
    const canvas = document.getElementById('main-canvas');
    window.renderFrameAt(window.InkplainerRenderer.getDuration(), canvas);
    return [...canvas.getContext('2d').getImageData(70, 60, 1, 1).data];
  });
  expect(pixel[2]).toBeGreaterThan(240);
  expect(pixel[0]).toBeLessThan(20);
});

test('public renderFrameAt is side-effect free for playback progress', async ({ page }) => {
  await installFixture(page, 10);
  const result = await page.evaluate(() => {
    const duration = window.InkplainerRenderer.getDuration();
    const canvas = document.createElement('canvas');
    window.state._animProgress = 0.314;
    window.renderFrameAt(duration * 0.5, canvas);
    const first = window.state._animProgress;
    window.renderFrameAt(duration * 0.1, canvas);
    return { first, second: window.state._animProgress, width: canvas.width, height: canvas.height };
  });
  expect(result.first).toBeCloseTo(0.314, 5);
  expect(result.second).toBeCloseTo(0.314, 5);
  expect(result.width).toBe(1280);
  expect(result.height).toBe(720);
});

test('preview controller seek latency is bounded for large fixture', async ({ page }) => {
  await installFixture(page, 100);
  const result = await page.evaluate(async () => {
    const controller = window.previewController || window.ensurePreviewController?.();
    const duration = window.InkplainerRenderer.getDuration();
    const start = performance.now();
    await controller.seek(duration * 0.8);
    return {
      latencyMs: performance.now() - start,
      progress: window.state._animProgress,
      status: document.getElementById('preview-status')?.textContent || '',
    };
  });
  expect(result.progress).toBeGreaterThan(0.75);
  expect(result.latencyMs).toBeLessThan(1000);
});

test('renderer capability detection exposes safe fallbacks', async ({ page }) => {
  const capabilities = await page.evaluate(() => window.InkplainerRenderer.getCapabilities());
  expect(typeof capabilities.worker).toBe('boolean');
  expect(typeof capabilities.offscreenCanvas).toBe('boolean');
  expect(typeof capabilities.videoEncoder).toBe('boolean');
  expect(typeof capabilities.workerOffscreenCanvas).toBe('boolean');
});

test('asset manager reuses duplicate decoded image sources', async ({ page }) => {
  const diagnostics = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(10, 10, 76, 44);
    const src = c.toDataURL('image/png');
    function load() {
      const img = new Image();
      img.src = src;
      return new Promise(resolve => { img.onload = () => resolve(img); });
    }
    const imgA = await load();
    const imgB = await load();
    window.InkplainerAssets.dispose();
    window.state.canvasW = 320;
    window.state.canvasH = 180;
    window.state.canvasBg = { type: 'solid', val: 'transparent' };
    window.state.layers = [
      { id: 101, name: 'dup-a', img: imgA, x: 0, y: 0, w: 96, h: 64, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, hand: 'ghost' },
      { id: 102, name: 'dup-b', img: imgB, x: 120, y: 0, w: 96, h: 64, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, hand: 'ghost' },
    ];
    window.InkplainerRenderer.dispose();
    await window.InkplainerRenderer.prepareAssets();
    return window.InkplainerRenderer.getAssetDiagnostics();
  });
  expect(diagnostics.loadedAssetCount).toBe(1);
  expect(diagnostics.decodedAssetCount).toBe(1);
  expect(diagnostics.cacheHitRatio).toBeGreaterThanOrEqual(0);
});

test('asset preparation rejects broken required image references', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,not-a-valid-png';
    window.state.canvasW = 320;
    window.state.canvasH = 180;
    window.state.canvasBg = { type: 'solid', val: 'transparent' };
    window.state.layers = [
      { id: 201, name: 'broken', img, x: 0, y: 0, w: 80, h: 80, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, hand: 'ghost' },
    ];
    window.InkplainerRenderer.dispose();
    try {
      await window.InkplainerRenderer.prepareAssets();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error.message,
        failedAssetCount: window.InkplainerRenderer.getAssetDiagnostics().failedAssetCount,
      };
    }
  });
  expect(result.ok).toBe(false);
  expect(result.message).toContain('Unable to decode');
  expect(result.failedAssetCount).toBeGreaterThan(0);
});

test('asset manager dispose releases decoded cache between repeated preparations', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makeImg(index) {
      const c = document.createElement('canvas');
      c.width = 72 + index;
      c.height = 72 + index;
      const ctx = c.getContext('2d');
      ctx.fillStyle = `hsl(${index * 20}, 70%, 50%)`;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      return new Promise(resolve => { img.onload = () => resolve(img); });
    }
    window.InkplainerAssets.dispose();
    window.state.canvasW = 640;
    window.state.canvasH = 360;
    window.state.canvasBg = { type: 'solid', val: 'transparent' };
    window.state.layers = [];
    for (let i = 0; i < 12; i++) {
      window.state.layers.push({
        id: 300 + i,
        name: `asset-${i}`,
        img: await makeImg(i),
        x: i * 10,
        y: i * 6,
        w: 72,
        h: 72,
        visible: true,
        animOrder: i < 6 ? 1 : 2,
        animStyle: 'scanner',
        speed: 80,
        hand: 'ghost',
      });
    }
    window.InkplainerRenderer.dispose();
    await window.InkplainerRenderer.prepareAssets();
    const first = window.InkplainerRenderer.getAssetDiagnostics();
    window.InkplainerAssets.dispose();
    const afterDispose = window.InkplainerRenderer.getAssetDiagnostics();
    await window.InkplainerRenderer.prepareAssets();
    const second = window.InkplainerRenderer.getAssetDiagnostics();
    return { first, afterDispose, second };
  });
  expect(result.first.loadedAssetCount).toBe(12);
  expect(result.afterDispose.loadedAssetCount).toBe(0);
  expect(result.afterDispose.decodedAssetCount).toBe(0);
  expect(result.second.loadedAssetCount).toBe(12);
  expect(result.second.decodedAssetCount).toBe(12);
});

test('cropped image preview uses the refreshed cropped asset', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(400, 220);
    window.state.layers = [];
    window.state.canvasBg = { type: 'solid', val: 'transparent' };

    const source = document.createElement('canvas');
    source.width = 200;
    source.height = 100;
    const sourceCtx = source.getContext('2d');
    sourceCtx.fillStyle = '#ff0000';
    sourceCtx.fillRect(0, 0, 100, 100);
    sourceCtx.fillStyle = '#0000ff';
    sourceCtx.fillRect(100, 0, 100, 100);

    const img = new Image();
    img.src = source.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });

    window.addLayer(img, 'Crop Asset');
    const layer = window.state.layers.at(-1);
    layer.x = 50;
    layer.y = 60;
    layer.w = 200;
    layer.h = 100;
    layer.baseW = 200;
    layer.baseH = 100;
    layer.resizePct = 100;
    layer.animStyle = 'scanner';
    layer.hand = 'ghost';
    layer.speed = 100;
    layer.reviewDuration = 1;
    layer.stopTime = 0;

    const firstAssetId = layer.assetId;
    await window.ensurePreviewController().prepare();
    window.state.selectedLayerId = layer.id;
    window.activateCropTool();
    _cropState.rect = { x: 150, y: 60, w: 100, h: 100 };
    window.confirmCrop();

    await new Promise(resolve => {
      const started = performance.now();
      const poll = () => {
        if (layer.img !== img && layer.img.complete) resolve();
        else if (performance.now() - started > 2000) resolve();
        else requestAnimationFrame(poll);
      };
      poll();
    });

    const controller = window.ensurePreviewController();
    await controller.prepare();
    const frame = document.createElement('canvas');
    const timestamp = Math.max(1000, controller.durationMs || window.InkplainerRenderer.getDuration());
    controller.renderer.renderFrameAt(timestamp, frame, { includeHand: false });
    const pixel = [...frame.getContext('2d').getImageData(200, 110, 1, 1).data];
    return {
      firstAssetId,
      nextAssetId: layer.assetId,
      naturalWidth: layer.img.naturalWidth,
      naturalHeight: layer.img.naturalHeight,
      width: layer.w,
      height: layer.h,
      pixel,
    };
  });
  expect(result.nextAssetId).not.toBe(result.firstAssetId);
  expect(result.naturalWidth).toBe(100);
  expect(result.naturalHeight).toBe(100);
  expect(result.width).toBe(100);
  expect(result.height).toBe(100);
  expect(result.pixel[2]).toBeGreaterThan(200);
  expect(result.pixel[0]).toBeLessThan(80);
});

test('playback control can be repositioned and persists its location', async ({ page }) => {
  await installFixture(page, 1);
  const result = await page.evaluate(async () => {
    window.launchStudio?.({ updateUrl: false });
    localStorage.removeItem('inkplainer.playbarPosition.v1');
    window.restorePlaybarPosition?.();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const playbar = document.getElementById('playbar');
    const area = document.getElementById('canvas-area');
    const canvas = document.getElementById('canvas-wrapper');
    const before = playbar.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const interactiveTargetIgnored = (() => {
      const button = document.getElementById('play-pause-btn');
      const event = new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: before.left + 12,
        clientY: before.top + 12,
        pointerId: 11,
      });
      button.dispatchEvent(event);
      return !playbar.classList.contains('dragging');
    })();
    window.applyPlaybarPosition({
      x: Math.max(8, canvasRect.left + 44),
      y: Math.max(8, canvasRect.bottom + 18),
    });
    const after = playbar.getBoundingClientRect();
    area.scrollTop = 200;
    area.scrollLeft = 160;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const afterScroll = playbar.getBoundingClientRect();
    window.applyPlaybarPosition({ x: 99999, y: 99999 }, false);
    const clamped = playbar.getBoundingClientRect();
    const saved = JSON.parse(localStorage.getItem('inkplainer.playbarPosition.v1') || 'null');
    return {
      before: { left: before.left, top: before.top },
      after: { left: after.left, top: after.top },
      canvasBottom: canvasRect.bottom,
      parentTag: playbar.parentElement?.tagName,
      position: getComputedStyle(playbar).position,
      hasHandle: !!playbar.querySelector('[data-playbar-drag-handle]'),
      interactiveTargetIgnored,
      role: playbar.getAttribute('role'),
      clampedInside:
        clamped.right <= window.innerWidth + 0.5 &&
        clamped.bottom <= window.innerHeight + 0.5 &&
        clamped.left >= -0.5 &&
        clamped.top >= -0.5,
      fixedDuringScroll:
        Math.abs(afterScroll.left - after.left) < 0.5 &&
        Math.abs(afterScroll.top - after.top) < 0.5,
      saved,
    };
  });
  expect(result.parentTag).toBe('BODY');
  expect(result.position).toBe('fixed');
  expect(result.hasHandle).toBe(true);
  expect(result.interactiveTargetIgnored).toBe(true);
  expect(result.role).toBe('toolbar');
  expect(result.clampedInside).toBe(true);
  expect(result.fixedDuringScroll).toBe(true);
  expect(result.after.top).toBeGreaterThanOrEqual(result.canvasBottom);
  expect(result.saved).toBeTruthy();
  expect(result.saved.xRatio).toBeGreaterThanOrEqual(0);
  expect(result.saved.yRatio).toBeGreaterThanOrEqual(0);
});

test('floating playbar supports audio-only playback and audio progress', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.launchStudio?.({ updateUrl: false });
    window.initCanvas(640, 360);
    window.state.layers = [];
    window.state.audio = {
      name: 'Narration.mp3',
      dataURL: 'data:audio/mpeg;base64,AAAA',
      type: 'audio/mpeg',
    };
    let player = document.getElementById('project-audio-player');
    let paused = true;
    window.renderAudioControls();
    player = document.getElementById('project-audio-player');
    Object.defineProperty(player, 'duration', { configurable: true, get: () => 10 });
    Object.defineProperty(player, 'paused', { configurable: true, get: () => paused });
    Object.defineProperty(player, 'ended', { configurable: true, get: () => false });
    player.play = () => {
      paused = false;
      player.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
    player.pause = () => {
      paused = true;
      player.dispatchEvent(new Event('pause'));
    };
    const disabledBefore = document.getElementById('play-pause-btn').disabled;
    window.togglePlay();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const playingAfterToggle = !paused;
    player.currentTime = 5;
    window.syncPlaybarProgressToAudio();
    const progressAtHalf = window.state._animProgress;
    const timeAtHalf = document.getElementById('time-display').textContent;
    await window.stopPreviewPlayback();
    const pausedAfterStop = paused;
    const currentTimeAfterStop = player.currentTime;
    player.currentTime = 7;
    window.restartAnim();
    await new Promise(resolve => requestAnimationFrame(resolve));
    return {
      disabledBefore,
      playingAfterToggle,
      progressAtHalf,
      timeAtHalf,
      pausedAfterStop,
      currentTimeAfterStop,
      playingAfterRestart: !paused,
      currentTimeAfterRestart: player.currentTime,
      statePlaying: window.state.playing,
    };
  });
  expect(result.disabledBefore).toBe(false);
  expect(result.playingAfterToggle).toBe(true);
  expect(result.progressAtHalf).toBe(0.5);
  expect(result.timeAtHalf).toBe('00:05');
  expect(result.pausedAfterStop).toBe(true);
  expect(result.currentTimeAfterStop).toBe(0);
  expect(result.playingAfterRestart).toBe(true);
  expect(result.currentTimeAfterRestart).toBe(0);
  expect(result.statePlaying).toBe(true);
});

test('pause button pauses audio after visual preview has finished', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.launchStudio?.({ updateUrl: false });
    window.initCanvas(640, 360);
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.state.layers = [];
    window.addLayer(img, 'Visual');
    window.state.audio = {
      name: 'Narration.mp3',
      dataURL: 'data:audio/mpeg;base64,AAAA',
      type: 'audio/mpeg',
    };
    const player = document.getElementById('project-audio-player');
    let paused = false;
    let pauseCalls = 0;
    Object.defineProperty(player, 'duration', { configurable: true, get: () => 10 });
    Object.defineProperty(player, 'paused', { configurable: true, get: () => paused });
    Object.defineProperty(player, 'ended', { configurable: true, get: () => false });
    player.pause = () => {
      paused = true;
      pauseCalls++;
      player.dispatchEvent(new Event('pause'));
    };
    player.play = () => {
      paused = false;
      player.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
    window.renderAudioControls();
    const controller = window.ensurePreviewController();
    controller.playing = false;
    window.state.playing = false;
    window.togglePlay();
    return {
      paused,
      pauseCalls,
      controllerPlaying: controller.playing,
      statePlaying: window.state.playing,
    };
  });
  expect(result.paused).toBe(true);
  expect(result.pauseCalls).toBe(1);
  expect(result.controllerPlaying).toBe(false);
  expect(result.statePlaying).toBe(false);
});

test('animate sidebar groups presets and hand controls with audio moved to timeline', async ({ page }) => {
  const state = await page.evaluate(() => {
    const pane = document.getElementById('sidebar-pane-animation');
    return {
      labels: [...pane.querySelectorAll(':scope > .animate-group-label')].map(el => el.textContent.trim()),
      cards: [...pane.querySelectorAll(':scope > .card')].map(card => ({
        title: card.querySelector('.card-header-label')?.textContent.trim(),
        collapsed: card.classList.contains('collapsed'),
      })),
      handParentId: [...pane.querySelectorAll(':scope > .card')]
        .find(card => card.querySelector('.card-header-label')?.textContent.trim() === 'Hand Style')
        ?.parentElement?.id,
      handInsideBottomBar: !!document.querySelector('#bottom-bar .bb-hand-section'),
      waveformParentId: document.querySelector('.playback-card')?.parentElement?.id,
      waveformAfterScenes: document.getElementById('scene-thumbs')?.nextElementSibling?.classList.contains('playback-card') || false,
      waveformHasOnlyProgress: !!document.querySelector('.playback-card #audio-spectrum') && !document.querySelector('.playback-card .audio-row'),
      audioControlsParentId: document.getElementById('audio-controls-panel')?.parentElement?.id,
      audioControlsInsideSidebar: !!document.querySelector('#sidebar #audio-controls-panel .audio-row'),
    };
  });
  expect(state.labels).toEqual(['Presets', 'Drawing hand']);
  expect(state.cards.length).toBeGreaterThanOrEqual(4);
  expect(state.cards.filter(card => !card.collapsed).map(card => card.title)).toEqual(['Settings Presets', 'Hand Style']);
  expect(state.handParentId).toBe('sidebar-pane-animation');
  expect(state.handInsideBottomBar).toBe(false);
  expect(state.waveformParentId).toBe('scene-scroll');
  expect(state.waveformAfterScenes).toBe(true);
  expect(state.waveformHasOnlyProgress).toBe(true);
  expect(state.audioControlsParentId).toBe('sidebar');
  await expect(page.locator('#audio-controls-panel')).toBeHidden();
  await expect(page.locator('.playback-card')).toBeHidden();
  expect(state.audioControlsInsideSidebar).toBe(true);
});

test('sidebar visibility persists independently across refreshes', async ({ page }) => {
  const left = page.locator('#studio-sidebar-toggle');
  const right = page.locator('#layers-panel-toggle');
  await left.click();
  await page.reload();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(left).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#right-panel')).toBeVisible();
  await right.click();
  await expect(page.locator('#right-panel')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('inkmotion.sidebar-visibility.v1')))).toEqual({ studioHidden: true, layersHidden: true });
  await page.reload();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#right-panel')).toBeHidden();
  await expect(right).toHaveAttribute('aria-expanded', 'false');
  await left.click();
  await page.reload();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#right-panel')).toBeHidden();
  await right.click();
  await page.reload();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#right-panel')).toBeVisible();
  await expect(left).toHaveAttribute('aria-expanded', 'true');
  await expect(right).toHaveAttribute('aria-expanded', 'true');
});

test('layer inspector groups controls and preserves review and size editing', async ({ page }) => {
  await installFixture(page, 3);
  await page.evaluate(() => {
    state.layers[0].name = 'Product illustration';
    state.layers[1].name = 'Supporting artwork';
    state.layers[2].name = 'Closing title';
    selectLayer(state.layers[0].id);
    document.getElementById('right-panel').scrollTop = 0;
  });
  const settings = page.locator('.layer-item.selected .layer-settings');
  await expect(page.locator('.layers-heading h2')).toHaveText('Layers');
  await expect(settings.locator('.layer-inspector-card')).toHaveCount(3);
  const stop = settings.locator('.layer-review-panel input[onchange*="setLayerStopTime"]');
  await stop.fill('4'); await stop.press('Tab');
  expect(await page.evaluate(() => getSelectedLayer().stopTime)).toBe(4);
  const width = settings.getByLabel('Width (px)', { exact: true });
  await width.fill('240'); await width.press('Tab');
  expect(await page.evaluate(() => Math.round(getSelectedLayer().w))).toBe(240);
  await page.evaluate(() => { document.getElementById('right-panel').scrollTop = 0; });
  await page.screenshot({ path: 'test-results/layers-panel-redesign.png' });
});

test('element-only animation options live in the selected layer settings', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    async function addLayer(color, name) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      window.addLayer(img, name);
      return window.state.layers.find(layer => layer.name === name);
    }
    const first = await addLayer('#ef4444', 'First');
    const second = await addLayer('#2563eb', 'Second');
    first.animStyle = 'scanner';
    second.animStyle = 'scanner';
    window.selectLayer(first.id);
    const sidebarLabels = [...document.querySelectorAll('#sidebar-pane-animation > .animate-group-label')]
      .map(el => el.textContent.trim());
    const sourceCardsVisible = [...document.querySelectorAll('#sidebar-pane-animation > .element-only-source')]
      .some(el => getComputedStyle(el).display !== 'none');
    const settings = document.getElementById(`ls-${first.id}`);
    const hasLayerAnimation = !!settings && settings.textContent.includes('Animation') && settings.textContent.includes('Drawing Style');
    settings.querySelector('.layer-choice[onclick*="outlinefill"]')?.click();
    const afterOutline = {
      first: first.animStyle,
      second: second.animStyle,
      hasStrokeControls: !!document.getElementById(`ls-${first.id}`)?.textContent.includes('Stroke Style'),
    };
    document.getElementById(`ls-${first.id}`)
      ?.querySelector('.layer-choice[onclick*="blueprint"]')
      ?.click();
    return {
      sidebarLabels,
      sourceCardsVisible,
      hasLayerAnimation,
      afterOutline,
      firstStroke: first.outlineStrokeStyle,
      secondStroke: second.outlineStrokeStyle || null,
    };
  });
  expect(result.sidebarLabels).toEqual(['Presets', 'Drawing hand']);
  expect(result.sourceCardsVisible).toBe(false);
  expect(result.hasLayerAnimation).toBe(true);
  expect(result.afterOutline).toEqual({
    first: 'outlinefill',
    second: 'scanner',
    hasStrokeControls: true,
  });
  expect(result.firstStroke).toBe('blueprint');
  expect(result.secondStroke).toBeNull();
});

test('layer animation, subject order, and drawing styles compile from layer controls', async ({ page }) => {
  const styles = [
    'scanner',
    'contour',
    'outlinechunks',
    'chunkjump',
    'spec-human',
    'spec-animal',
    'spec-portrait',
    'spec-vehicle',
    'spec-building',
    'spec-landscape',
    'spec-spiral',
    'outlinefill',
    'illustfill',
    'outlineonly',
    'spec-text',
  ];
  const result = await page.evaluate(async (styles) => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 90;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(12, 12, 96, 66);
    ctx.fillStyle = '#f97316';
    ctx.fillRect(28, 28, 64, 34);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Styled Layer');
    const layer = window.state.layers.find(item => item.name === 'Styled Layer');
    layer.x = 80;
    layer.y = 60;
    layer.w = 180;
    layer.h = 140;
    layer.reviewDuration = 1;
    layer.hand = 'ghost';
    window.addLayer(img, 'Unaffected Layer');
    const other = window.state.layers.find(item => item.name === 'Unaffected Layer');
    other.animStyle = 'scanner';
    other.hand = 'ghost';
    other.reviewDuration = 1;
    window.selectLayer(layer.id);

    const checks = [];
    let expectedActiveStyle = layer.animStyle;
    for (const style of styles) {
      const settings = document.getElementById(`ls-${layer.id}`);
      const button = settings?.querySelector(`.layer-choice[onclick*="'${style}'"]`);
      if (!button) {
        checks.push({ style, missingButton: true });
        continue;
      }
      button.click();
      const isSubjectOrder = style.startsWith('spec-') && style !== 'spec-text';
      if (!isSubjectOrder) expectedActiveStyle = style;
      const controller = window.ensurePreviewController();
      await controller.prepare();
      const item = controller.renderer.timeline.items.find(entry => entry.layerId === layer.id);
      const frame = document.createElement('canvas');
      controller.renderer.renderFrameAt(Math.max(1, (item.startMs || 0) + (item.animationDurationMs || 1000) * 0.5), frame, { includeHand: false });
      const data = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height).data;
      let alpha = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) alpha++;
      checks.push({
        style,
        isSubjectOrder,
        expectedActiveStyle,
        layerStyle: layer.animStyle,
        subjectStyle: layer.subjectAnimStyle,
        otherStyle: other.animStyle,
        compiledStyle: item?.style,
        compiledSubjectOrder: item?.subjectOrderStyle,
        duration: item?.durationMs || 0,
        alpha,
      });
    }
    return checks;
  }, styles);
  for (const check of result) {
    expect(check.missingButton, check.style).toBeFalsy();
    if (check.isSubjectOrder) {
      expect(check.layerStyle, check.style).toBe(check.expectedActiveStyle);
      expect(check.subjectStyle, check.style).toBe(check.style);
      expect(check.compiledStyle, check.style).toBe(check.expectedActiveStyle);
      expect(check.compiledSubjectOrder, check.style).toBe(check.style);
    } else {
      expect(check.layerStyle, check.style).toBe(check.style);
      expect(check.compiledStyle, check.style).toBe(check.style);
    }
    expect(check.otherStyle, check.style).toBe('scanner');
    expect(check.duration, check.style).toBeGreaterThan(0);
    expect(check.alpha, check.style).toBeGreaterThan(0);
  }
});

test('contour layer style renders an edge phase before fill reveal', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(360, 240);
    window.state.layers = [];
    window.state.canvasBg = { type: 'solid', val: 'transparent' };
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 90;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#111827';
    ctx.fillRect(12, 12, 96, 66);
    ctx.fillStyle = '#f97316';
    ctx.fillRect(32, 30, 56, 28);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Contour Check');
    const layer = window.state.layers.at(-1);
    layer.x = 80;
    layer.y = 60;
    layer.w = 180;
    layer.h = 135;
    layer.hand = 'ghost';
    layer.reviewDuration = 1;
    window.selectLayer(layer.id);
    document.getElementById(`ls-${layer.id}`).querySelector('.layer-choice[onclick*="contour"]').click();
    document.getElementById(`ls-${layer.id}`).querySelector('.layer-choice[onclick*="spec-building"]').click();

    const controller = window.ensurePreviewController();
    await controller.prepare();
    const item = controller.renderer.timeline.items.find(entry => entry.layerId === layer.id);
    const frame = document.createElement('canvas');
    controller.renderer.renderFrameAt(item.startMs + item.animationDurationMs * 0.2, frame, { includeHand: false });
    const fctx = frame.getContext('2d');
    function maxAlpha(x, y, w, h) {
      const data = fctx.getImageData(x, y, w, h).data;
      let max = 0;
      for (let i = 3; i < data.length; i += 4) max = Math.max(max, data[i]);
      return max;
    }
    const edgeAlpha = maxAlpha(94, 74, 110, 16);
    const center = [...fctx.getImageData(170, 128, 1, 1).data];
    controller.renderer.renderFrameAt(item.startMs + item.animationDurationMs * 0.7, frame, { includeHand: false });
    const filledCenter = [...fctx.getImageData(170, 128, 1, 1).data];
    return {
      compiledStyle: item.style,
      subjectOrderStyle: item.subjectOrderStyle,
      layerStyle: layer.animStyle,
      subjectStyle: layer.subjectAnimStyle,
      edgeAlpha,
      centerAlpha: center[3],
      filledCenterAlpha: filledCenter[3],
    };
  });
  expect(result.compiledStyle).toBe('contour');
  expect(result.layerStyle).toBe('contour');
  expect(result.subjectStyle).toBe('spec-building');
  expect(result.subjectOrderStyle).toBe('spec-building');
  expect(result.edgeAlpha).toBeGreaterThan(0);
  expect(result.centerAlpha).toBe(0);
  expect(result.filledCenterAlpha).toBeGreaterThan(0);
});

test('subject order styles follow their described reveal order', async ({ page }) => {
  const result = await page.evaluate(() => {
    const renderer = window.ensurePreviewController().renderer;
    const cols = 5;
    const rows = 5;
    const point = index => ({ c: index % cols, r: Math.floor(index / cols) });
    const first = style => point(renderer.getChunkOrder(style, cols, rows)[0]);
    const firstFive = style => renderer.getChunkOrder(style, cols, rows).slice(0, 5).map(point);
    return {
      human: first('spec-human'),
      animal: first('spec-animal'),
      portrait: first('spec-portrait'),
      vehicle: first('spec-vehicle'),
      building: first('spec-building'),
      landscape: first('spec-landscape'),
      spiral: first('spec-spiral'),
      vehicleFirstFive: firstFive('spec-vehicle'),
    };
  });
  expect(result.human.r).toBe(0);
  expect(result.human.c).toBe(2);
  expect(result.animal.c).toBe(0);
  expect(result.portrait).toEqual({ c: 2, r: 2 });
  expect(result.vehicle.c).toBe(0);
  expect(result.vehicleFirstFive.every(tile => tile.r < 4)).toBe(true);
  expect(result.building.r).toBe(4);
  expect(result.landscape.r).toBe(0);
  expect(result.spiral).toEqual({ c: 2, r: 2 });
});

test('selected subject order shows a layer hint describing the order', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Subject Hint');
    const layer = window.state.layers.at(-1);
    window.selectLayer(layer.id);
    document.getElementById(`ls-${layer.id}`).querySelector('.layer-choice[onclick*="spec-spiral"]').click();
    const spiralHint = document.getElementById(`ls-${layer.id}`).querySelector('.layer-subject-hint')?.textContent || '';
    document.getElementById(`ls-${layer.id}`).querySelector('.layer-choice[onclick*="spec-building"]').click();
    const buildingHint = document.getElementById(`ls-${layer.id}`).querySelector('.layer-subject-hint')?.textContent || '';
    return { spiralHint, buildingHint };
  });
  expect(result.spiralHint).toContain('Spiral - Centre outward');
  expect(result.spiralHint).toContain('Radiates from the visual centre');
  expect(result.buildingHint).toContain('Building - Foundation up');
  expect(result.buildingHint).toContain('Starts at the base');
});

test('layer sections show the selected option beside each section title', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Section Values');
    const layer = window.state.layers.at(-1);
    window.selectLayer(layer.id);
    const values = () => [...document.querySelectorAll(`#ls-${layer.id} .layer-section-heading`)]
      .map(row => ({
        title: row.querySelector('.section-label')?.textContent.trim(),
        value: row.querySelector('.layer-section-value')?.textContent.trim(),
      }));
    document.getElementById(`ls-${layer.id}`).querySelector('.layer-choice[onclick*="contour"]').click();
    const contour = values();
    document.getElementById(`ls-${layer.id}`).querySelector('.layer-choice[onclick*="spec-spiral"]').click();
    const spiral = values();
    document.getElementById(`ls-${layer.id}`).querySelector('.layer-choice[onclick*="outlinefill"]').click();
    document.getElementById(`ls-${layer.id}`).querySelector('.layer-choice[onclick*="blueprint"]').click();
    const outline = values();
    const selectedLabels = [...document.querySelectorAll(`#ls-${layer.id} .layer-choice.selected`)]
      .map(btn => btn.textContent.trim());
    return { contour, spiral, outline, selectedLabels };
  });
  expect(result.contour.find(row => row.title === 'Animation')?.value).toBe('Contour');
  expect(result.contour.find(row => row.title === 'Subject Order')?.value).toBe('Human');
  expect(result.spiral.find(row => row.title === 'Subject Order')?.value).toBe('Spiral');
  expect(result.outline.find(row => row.title === 'Animation')?.value).toBe('Contour');
  expect(result.outline.find(row => row.title === 'Subject Order')?.value).toBe('Spiral');
  expect(result.outline.find(row => row.title === 'Drawing Style')?.value).toBe('Outline Fill');
  expect(result.outline.find(row => row.title === 'Stroke Style')?.value).toBe('Blueprint');
  expect(result.selectedLabels).toEqual(expect.arrayContaining(['Contour', 'Spiral', 'Outline Fill', 'Blueprint']));
});

test('scene timeline widths follow seconds ruler scale', async ({ page }) => {
  const metrics = await page.evaluate(() => {
    window.initCanvas(1280, 720);
    const pages = [
      {
        id: 101,
        name: 'Short',
        previewDataURL: null,
        layers: [
          { id: 1, name: 'short', x: 0, y: 0, w: 80, h: 60, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 0 },
        ],
      },
      {
        id: 102,
        name: 'Long',
        previewDataURL: null,
        layers: [
          { id: 2, name: 'long', x: 0, y: 0, w: 800, h: 800, visible: true, animOrder: 1, animStyle: 'illustfill', speed: 20, reviewDuration: 60 },
        ],
      },
    ];
    window.state.pages = pages;
    window.state.activePageId = pages[0].id;
    window.state.layers = pages[0].layers;
    window.state.audio = { name: 'long.wav', type: 'audio/wav', dataURL: 'data:audio/wav;base64,AAAA' };
    window.renderAudioControls();
    const player = document.getElementById('project-audio-player');
    Object.defineProperty(player, 'duration', { configurable: true, get: () => 180 });
    player.currentTime = 90;
    window.renderSceneThumbs();
    window.syncPlaybarProgressToAudio();
    const thumbs = [...document.querySelectorAll('.scene-thumb')].map(el => parseFloat(el.style.getPropertyValue('--scene-width')));
    const rulerWidth = parseFloat(document.getElementById('scene-ruler-inner').style.width);
    const stripWidth = parseFloat(document.getElementById('scene-thumbs').style.minWidth);
    const scroll = document.getElementById('scene-scroll');
    const playhead = document.getElementById('scene-playhead');
    const playheadLeft = parseFloat(playhead.style.left);
    const totalText = document.getElementById('scene-total-duration').textContent;
    return {
      thumbs,
      rulerWidth,
      stripWidth,
      playheadLeft,
      playheadTime: playhead.dataset.time,
      majorTicks: document.querySelectorAll('.scene-ruler-tick.major').length,
      labels: [...document.querySelectorAll('.scene-ruler-label')].map(el => el.textContent.trim()),
      totalText,
      scrollOverflowX: getComputedStyle(scroll).overflowX,
      outerOverflowX: getComputedStyle(document.getElementById('scene-timeline')).overflowX,
      trackWiderThanViewport: scroll.clientWidth > 0 ? scroll.scrollWidth > scroll.clientWidth : stripWidth > 1000,
      scrollChildIds: [...scroll.children].map(child => child.id || child.className),
    };
  });
  expect(metrics.thumbs).toHaveLength(2);
  expect(metrics.thumbs[1]).toBeGreaterThan(metrics.thumbs[0] * 4);
  expect(metrics.rulerWidth).toBeGreaterThanOrEqual(metrics.stripWidth);
  expect(metrics.scrollOverflowX).toBe('visible');
  expect(metrics.outerOverflowX).toBe('auto');
  expect(metrics.trackWiderThanViewport).toBe(true);
  expect(metrics.rulerWidth).toBeGreaterThanOrEqual(180 * 44);
  expect(metrics.playheadLeft).toBe(90 * 44);
  expect(metrics.playheadTime).toBe('01:30');
  expect(metrics.majorTicks).toBeGreaterThan(10);
  expect(metrics.labels).toEqual(expect.arrayContaining(['00:00', '01:00', '02:00', '03:00']));
  expect(metrics.totalText).toContain('03:00');
  expect(metrics.scrollChildIds).toEqual(expect.arrayContaining(['scene-ruler', 'scene-thumbs', 'scene-playhead']));
});

test('scene timeline zoom controls rescale scenes ruler and playhead', async ({ page }) => {
  const metrics = await page.evaluate(() => {
    window.initCanvas(1280, 720);
    window.state.sceneTimelineZoom = 1;
    window.state.pages = [{
      id: 901,
      name: 'Zoomable',
      previewDataURL: null,
      layers: [
        { id: 1, name: 'timed', x: 0, y: 0, w: 120, h: 90, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 20 },
      ],
    }];
    window.state.activePageId = 901;
    window.state.layers = window.state.pages[0].layers;
    window.renderSceneThumbs();
    const beforeWidth = parseFloat(document.querySelector('.scene-thumb').style.getPropertyValue('--scene-width'));
    const beforeRuler = parseFloat(document.getElementById('scene-ruler-inner').style.width);

    window.setSceneTimelineZoom(2);
    window.updateTimelinePlayhead(10);
    const afterWidth = parseFloat(document.querySelector('.scene-thumb').style.getPropertyValue('--scene-width'));
    const afterRuler = parseFloat(document.getElementById('scene-ruler-inner').style.width);

    return {
      beforeWidth,
      beforeRuler,
      afterWidth,
      afterRuler,
      zoomText: document.getElementById('scene-zoom-value')?.textContent,
      playheadLeft: parseFloat(document.getElementById('scene-playhead').style.left),
      pxPerSecond: window.getSceneTimelinePxPerSecond(),
    };
  });

  expect(metrics.beforeWidth).toBe(20 * 44);
  expect(metrics.afterWidth).toBe(20 * 88);
  expect(metrics.afterRuler).toBeGreaterThan(metrics.beforeRuler);
  expect(metrics.zoomText).toBe('200%');
  expect(metrics.pxPerSecond).toBe(88);
  expect(metrics.playheadLeft).toBe(10 * 88);
});

test('scene timeline stays visible at the bottom while the canvas area scrolls', async ({ page }) => {
  const metrics = await page.evaluate(async () => {
    window.launchStudio?.({ updateUrl: false });
    window.initCanvas(1280, 720);
    window.toggleInfiniteCanvas(true);
    window.state.canvasW = 3600;
    window.state.canvasH = 2200;
    window.syncInfiniteCanvasUI();
    window.fitCanvas();
    window.renderSceneThumbs();
    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.style.width = '2600px';
    wrapper.style.height = '1800px';
    await new Promise(requestAnimationFrame);
    const area = document.getElementById('canvas-area');
    const timeline = document.getElementById('scene-timeline');
    area.scrollTop = Math.max(0, area.scrollHeight - area.clientHeight);
    area.scrollLeft = Math.max(0, area.scrollWidth - area.clientWidth);
    await new Promise(requestAnimationFrame);
    const areaRect = area.getBoundingClientRect();
    const timelineRect = timeline.getBoundingClientRect();
    return {
      position: getComputedStyle(timeline).position,
      overflowY: getComputedStyle(area).overflowY,
      scrollTop: area.scrollTop,
      scrollLeft: area.scrollLeft,
      bottomGap: areaRect.bottom - timelineRect.bottom,
      areaCenter: (areaRect.left + areaRect.right) / 2,
      timelineCenter: (timelineRect.left + timelineRect.right) / 2,
      timelineTop: timelineRect.top,
      areaBottom: areaRect.bottom,
      areaTop: areaRect.top,
    };
  });

  expect(metrics.position).toBe('sticky');
  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollTop).toBeGreaterThan(0);
  expect(metrics.scrollLeft).toBeGreaterThan(0);
  expect(Math.abs(metrics.timelineCenter - metrics.areaCenter)).toBeLessThanOrEqual(1);
  expect(metrics.bottomGap).toBeGreaterThanOrEqual(8);
  expect(metrics.bottomGap).toBeLessThanOrEqual(24);
  expect(metrics.timelineTop).toBeGreaterThan(metrics.areaTop);
  expect(metrics.timelineTop).toBeLessThan(metrics.areaBottom);
});

test('infinite canvas mode expands workspace while preserving the camera frame', async ({ page }) => {
  const metrics = await page.evaluate(async () => {
    function makeImage(color) {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 60;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      return new Promise(resolve => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
      });
    }
    const img = await makeImage('#2563eb');
    window.state.layers = [{
      id: 701,
      name: 'Infinite layer',
      img,
      x: 100,
      y: 80,
      w: 160,
      h: 120,
      visible: true,
      animOrder: 1,
      animStyle: 'scanner',
      hand: 'ghost',
      speed: 60,
      opacity: 1,
    }];
    window.state.selectedLayerId = 701;
    window.initCanvas(1280, 720);
    window.toggleInfiniteCanvas(true);
    await new Promise(requestAnimationFrame);
    const frame = window.getCameraFrameSize();
    const layer = window.state.layers[0];
    const area = document.getElementById('canvas-area');
    const wrapper = document.getElementById('canvas-wrapper');
    const cameraFrame = document.getElementById('camera-frame');
    return {
      infiniteCanvas: window.state.infiniteCanvas,
      canvasW: window.state.canvasW,
      canvasH: window.state.canvasH,
      cameraW: frame.w,
      cameraH: frame.h,
      cameraX: window.state.cameraX,
      cameraY: window.state.cameraY,
      layerX: layer.x,
      layerY: layer.y,
      areaScrollable: getComputedStyle(area).overflowX === 'auto' || getComputedStyle(area).overflowY === 'auto',
      wrapperClass: wrapper.classList.contains('infinite-canvas'),
      toggleChecked: document.getElementById('infinite-canvas-toggle').checked,
      cameraFrameDisplay: getComputedStyle(cameraFrame).display,
      readout: document.getElementById('bb-size-readout').textContent,
    };
  });
  expect(metrics.infiniteCanvas).toBe(true);
  expect(metrics.cameraW).toBe(1280);
  expect(metrics.cameraH).toBe(720);
  expect(metrics.canvasW).toBeGreaterThanOrEqual(metrics.cameraW);
  expect(metrics.canvasH).toBeGreaterThanOrEqual(metrics.cameraH);
  expect(metrics.layerX).toBe(100 + metrics.cameraX);
  expect(metrics.layerY).toBe(80 + metrics.cameraY);
  expect(metrics.areaScrollable).toBe(true);
  expect(metrics.wrapperClass).toBe(true);
  expect(metrics.toggleChecked).toBe(true);
  expect(metrics.cameraFrameDisplay).toBe('block');
  expect(metrics.readout).toContain('camera');
});

test('infinite canvas deterministic renderer camera follows the active revealed layer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makeImage(color) {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      return new Promise(resolve => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
      });
    }
    const red = await makeImage('#dc2626');
    const blue = await makeImage('#2563eb');
    window.state.canvasW = 1600;
    window.state.canvasH = 900;
    window.state.cameraW = 640;
    window.state.cameraH = 360;
    window.state.cameraX = 0;
    window.state.cameraY = 0;
    window.state.infiniteCanvas = true;
    window.state.cameraFollow = true;
    window.state.canvasBg = { type: 'solid', val: 'transparent' };
    window.state.layers = [
      { id: 801, name: 'Red', img: red, x: 20, y: 120, w: 120, h: 120, visible: true, animOrder: 1, animStyle: 'scanner', hand: 'ghost', speed: 90, opacity: 1 },
      { id: 802, name: 'Blue', img: blue, x: 1220, y: 130, w: 130, h: 130, visible: true, animOrder: 2, animStyle: 'scanner', hand: 'ghost', speed: 90, opacity: 1 },
    ];
    window.initCanvas(1600, 900);
    window.InkplainerRenderer.dispose();
    await window.InkplainerRenderer.prepareAssets();
    const timeline = window.InkplainerRenderer.compileTimeline();
    const blueItem = timeline.items.find(item => item.layer.id === 802);
    const frame = document.createElement('canvas');
    window.InkplainerRenderer.renderFrameAt(blueItem.startMs + blueItem.animationDurationMs * 0.8, frame, { includeHand: false });
    const ctx = frame.getContext('2d');
    const data = ctx.getImageData(0, 0, frame.width, frame.height).data;
    let bluePixels = 0;
    let redPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 2] > 160 && data[i] < 80) bluePixels++;
      if (data[i] > 160 && data[i + 2] < 80) redPixels++;
    }
    const camera = window.getCameraFrameRectAt(blueItem.startMs + blueItem.animationDurationMs * 0.8, timeline, window.state);
    return { width: frame.width, height: frame.height, bluePixels, redPixels, cameraX: camera.x };
  });
  expect(result.width).toBe(640);
  expect(result.height).toBe(360);
  expect(result.cameraX).toBeGreaterThan(700);
  expect(result.bluePixels).toBeGreaterThan(1000);
  expect(result.redPixels).toBe(0);
});

test('infinite canvas camera eases between revealed layer targets', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makeImage(color) {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      return new Promise(resolve => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
      });
    }
    const red = await makeImage('#dc2626');
    const blue = await makeImage('#2563eb');
    window.state.canvasW = 1800;
    window.state.canvasH = 900;
    window.state.cameraW = 640;
    window.state.cameraH = 360;
    window.state.cameraX = 0;
    window.state.cameraY = 0;
    window.state.infiniteCanvas = true;
    window.state.cameraFollow = true;
    window.state.layers = [
      { id: 811, name: 'Left', img: red, x: 40, y: 120, w: 120, h: 120, visible: true, animOrder: 1, animStyle: 'scanner', hand: 'ghost', speed: 90, opacity: 1 },
      { id: 812, name: 'Right', img: blue, x: 1300, y: 130, w: 130, h: 130, visible: true, animOrder: 2, animStyle: 'scanner', hand: 'ghost', speed: 90, opacity: 1 },
    ];
    window.initCanvas(1800, 900);
    window.InkplainerRenderer.dispose();
    await window.InkplainerRenderer.prepareAssets();
    const timeline = window.InkplainerRenderer.compileTimeline();
    const blueItem = timeline.items.find(item => item.layer.id === 812);
    const atStart = window.getCameraFrameRectAt(blueItem.startMs, timeline, window.state);
    const during = window.getCameraFrameRectAt(blueItem.startMs + 180, timeline, window.state);
    const later = window.getCameraFrameRectAt(blueItem.startMs + 900, timeline, window.state);
    return { atStartX: atStart.x, duringX: during.x, laterX: later.x };
  });
  expect(result.atStartX).toBeLessThan(100);
  expect(result.duringX).toBeGreaterThan(result.atStartX);
  expect(result.duringX).toBeLessThan(result.laterX);
  expect(result.laterX).toBeGreaterThan(900);
});

test('export duration and size use animation length and infinite camera frame', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function wavDataURL(durationSeconds) {
      const sampleRate = 8000;
      const samples = Math.floor(sampleRate * durationSeconds);
      const buffer = new ArrayBuffer(44 + samples * 2);
      const view = new DataView(buffer);
      const write = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
      };
      write(0, 'RIFF');
      view.setUint32(4, 36 + samples * 2, true);
      write(8, 'WAVE');
      write(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      write(36, 'data');
      view.setUint32(40, samples * 2, true);
      let binary = '';
      new Uint8Array(buffer).forEach(byte => { binary += String.fromCharCode(byte); });
      return `data:audio/wav;base64,${btoa(binary)}`;
    }
    const img = await new Promise(resolve => {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      c.getContext('2d').fillRect(0, 0, 80, 80);
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(image);
      image.src = c.toDataURL('image/png');
    });
    window.state.canvasW = 2200;
    window.state.canvasH = 1400;
    window.state.cameraW = 1280;
    window.state.cameraH = 720;
    window.state.infiniteCanvas = true;
    window.state.layers = [
      { id: 881, name: 'Short scene', img, x: 40, y: 40, w: 80, h: 80, visible: true, animOrder: 1, animStyle: 'scanner', hand: 'ghost', speed: 100, reviewDuration: 0 },
    ];
    window.state.exportQuality = 'balanced';
    window.state.exportAdvanced = { resolution: 'source', fps: 30, bitrateMbps: 8, codec: 'auto' };
    window.state.audio = { name: 'long.wav', type: 'audio/wav', dataURL: wavDataURL(4) };
    window.renderAudioControls();
    await new Promise(resolve => setTimeout(resolve, 200));
    const controller = window.ensurePreviewController();
    await controller.prepare();
    const durationMs = await window.getExportDurationMs(controller);
    const settings = window.getExportSettings();
    return { animationMs: controller.durationMs, durationMs, width: settings.width, height: settings.height };
  });
  expect(result.animationMs).toBeLessThan(4000);
  expect(result.durationMs).toBe(result.animationMs);
  expect(Math.ceil((result.durationMs / 1000) * 30)).toBeLessThan(120);
  expect(result.width).toBe(1280);
  expect(result.height).toBe(720);
});

test('infinite canvas export renderer avoids full-workspace frame buffers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const originalCreateElement = document.createElement.bind(document);
    const canvasSizes = [];
    document.createElement = function patchedCreateElement(tagName, options) {
      const el = originalCreateElement(tagName, options);
      if (String(tagName).toLowerCase() === 'canvas') {
        const record = { width: 0, height: 0 };
        canvasSizes.push(record);
        const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
        const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
        Object.defineProperty(el, 'width', {
          configurable: true,
          get() { return widthDescriptor.get.call(this); },
          set(value) { record.width = Number(value) || 0; widthDescriptor.set.call(this, value); },
        });
        Object.defineProperty(el, 'height', {
          configurable: true,
          get() { return heightDescriptor.get.call(this); },
          set(value) { record.height = Number(value) || 0; heightDescriptor.set.call(this, value); },
        });
      }
      return el;
    };
    try {
      const img = await new Promise(resolve => {
        const c = originalCreateElement('canvas');
        c.width = 80;
        c.height = 80;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, 80, 80);
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(image);
        image.src = c.toDataURL('image/png');
      });
      window.state.canvasW = 9000;
      window.state.canvasH = 6000;
      window.state.cameraW = 1280;
      window.state.cameraH = 720;
      window.state.cameraX = 6200;
      window.state.cameraY = 4100;
      window.state.infiniteCanvas = true;
      window.state.cameraFollow = true;
      window.state.layers = [
        { id: 891, name: 'Huge workspace', img, x: 6400, y: 4300, w: 220, h: 180, visible: true, animOrder: 1, animStyle: 'scanner', hand: 'ghost', speed: 80, opacity: 1 },
      ];
      window.initCanvas(9000, 6000);
      window.InkplainerRenderer.dispose();
      await window.InkplainerRenderer.prepareAssets();
      window.InkplainerRenderer.compileTimeline();
      const frame = originalCreateElement('canvas');
      window.InkplainerRenderer.renderFrameAt(400, frame, { includeHand: false });
      const hugeCanvases = canvasSizes.filter(size => size.width >= 9000 || size.height >= 6000);
      return {
        frameW: frame.width,
        frameH: frame.height,
        created: canvasSizes.length,
        hugeCount: hugeCanvases.length,
        maxArea: Math.max(0, ...canvasSizes.map(size => size.width * size.height)),
      };
    } finally {
      document.createElement = originalCreateElement;
    }
  });
  expect(result.frameW).toBe(1280);
  expect(result.frameH).toBe(720);
  expect(result.hugeCount).toBe(0);
  expect(result.maxArea).toBeLessThan(9000 * 6000);
});

test('export video button opens export banner for an authenticated user', async ({ page }) => {
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, options) => input === '/api/auth/me'
      ? Promise.resolve(new Response(JSON.stringify({ user: { id: 'export-test', email: 'test@example.invalid' } }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, options);
  });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, options) => input === '/api/auth/me'
      ? Promise.resolve(new Response(JSON.stringify({ user: { id: 'export-test', email: 'test@example.invalid' } }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, options);
  });
  const result = await page.evaluate(async () => {
    window.currentUser = null;
    window.launchStudio?.({ updateUrl: false });
    window.toggleInfiniteCanvas?.(true);
    const area = document.getElementById('canvas-area');
    const wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) {
      wrapper.style.width = '2600px';
      wrapper.style.height = '1800px';
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (area) {
      area.scrollLeft = 900;
      area.scrollTop = 700;
    }
    await window.openExportBanner();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const banner = document.getElementById('export-banner');
    const rect = banner.getBoundingClientRect();
    return {
      bannerActive: banner?.classList.contains('active'),
      authActive: document.getElementById('auth-modal')?.classList.contains('active'),
      startDisabled: document.getElementById('start-recording-btn')?.disabled,
      controlsDisplay: getComputedStyle(document.getElementById('export-banner-controls')).display,
      position: getComputedStyle(banner).position,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      viewportCenterX: window.innerWidth / 2,
      viewportCenterY: window.innerHeight / 2,
    };
  });
  expect(result.bannerActive).toBe(true);
  expect(result.authActive).toBe(false);
  expect(result.startDisabled).toBe(false);
  expect(result.controlsDisplay).not.toBe('none');
  expect(result.position).toBe('fixed');
  expect(Math.abs(result.centerX - result.viewportCenterX)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.centerY - result.viewportCenterY)).toBeLessThanOrEqual(1);
});

test('export with project audio falls back to real-time WebM when FFmpeg muxing fails', async ({ page }) => {
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, options) => input === '/api/auth/me'
      ? Promise.resolve(new Response(JSON.stringify({ user: { id: 'export-test', email: 'test@example.invalid' } }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, options);
  });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, options) => input === '/api/auth/me'
      ? Promise.resolve(new Response(JSON.stringify({ user: { id: 'export-test', email: 'test@example.invalid' } }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, options);
  });
  const result = await page.evaluate(async () => {
    window.state.exportFormat = 'webm';
    window.state.audio = {
      name: 'voice.wav',
      type: 'audio/wav',
      dataURL: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    };
    let downloaded = false;
    let downloadedExt = '';
    const originalRecordWebM = window.recordWebM;
    const originalMux = window.processExportWithFFmpeg;
    const originalFallback = window.recordWebMWithAudioRealtime;
    const originalDownload = window.downloadExportBlob;
    window.recordWebM = async () => ({
      blob: new Blob(['video'], { type: 'video/webm' }),
      ext: 'webm',
      mime: 'video/webm',
      profile: { videoDurationMs: 1000 },
    });
    window.processExportWithFFmpeg = async () => {
      throw new Error('mux exploded');
    };
    window.recordWebMWithAudioRealtime = async () => ({
      blob: new Blob(['combined'], { type: 'video/webm' }),
      ext: 'webm',
      mime: 'video/webm',
      profile: { videoDurationMs: 1000, audioMuxed: true, audioFallback: 'test' },
    });
    window.downloadExportBlob = (_blob, ext) => {
      downloaded = true;
      downloadedExt = ext;
    };
    try {
      await window.startRecording();
      return {
        downloaded,
        downloadedExt,
        successActive: document.getElementById('export-success')?.classList.contains('active'),
      };
    } finally {
      window.recordWebM = originalRecordWebM;
      window.processExportWithFFmpeg = originalMux;
      window.recordWebMWithAudioRealtime = originalFallback;
      window.downloadExportBlob = originalDownload;
      window.state.audio = null;
    }
  });
  expect(result.downloaded).toBe(true);
  expect(result.downloadedExt).toBe('webm');
  expect(result.successActive).toBe(true);
});

test('MP4 export with project audio falls back to combined WebM when FFmpeg worker fails', async ({ page }) => {
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, options) => input === '/api/auth/me'
      ? Promise.resolve(new Response(JSON.stringify({ user: { id: 'export-test', email: 'test@example.invalid' } }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, options);
  });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, options) => input === '/api/auth/me'
      ? Promise.resolve(new Response(JSON.stringify({ user: { id: 'export-test', email: 'test@example.invalid' } }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, options);
  });
  const result = await page.evaluate(async () => {
    window.state.exportFormat = 'mp4';
    window.state.audio = {
      name: 'voice.wav',
      type: 'audio/wav',
      dataURL: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    };
    let downloaded = false;
    let downloadedExt = '';
    const originalRecordMP4 = window.recordMP4;
    const originalMux = window.processExportWithFFmpeg;
    const originalFallback = window.recordWebMWithAudioRealtime;
    const originalDownload = window.downloadExportBlob;
    window.recordMP4 = async () => ({
      blob: new Blob(['video'], { type: 'video/mp4' }),
      ext: 'mp4',
      mime: 'video/mp4',
      profile: { videoDurationMs: 1000 },
    });
    window.processExportWithFFmpeg = async () => {
      throw new Error("Failed to construct 'Worker'");
    };
    window.recordWebMWithAudioRealtime = async () => ({
      blob: new Blob(['combined'], { type: 'video/webm' }),
      ext: 'webm',
      mime: 'video/webm',
      profile: { videoDurationMs: 1000, audioMuxed: true, audioFallback: 'test' },
    });
    window.downloadExportBlob = (_blob, ext) => {
      downloaded = true;
      downloadedExt = ext;
    };
    try {
      await window.startRecording();
      return {
        downloaded,
        downloadedExt,
        successActive: document.getElementById('export-success')?.classList.contains('active'),
      };
    } finally {
      window.recordMP4 = originalRecordMP4;
      window.processExportWithFFmpeg = originalMux;
      window.recordWebMWithAudioRealtime = originalFallback;
      window.downloadExportBlob = originalDownload;
      window.state.exportFormat = 'webm';
      window.state.audio = null;
    }
  });
  expect(result.downloaded).toBe(true);
  expect(result.downloadedExt).toBe('webm');
  expect(result.successActive).toBe(true);
});

test('export with project audio keeps an error visible when all audio muxing fails', async ({ page }) => {
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, options) => input === '/api/auth/me'
      ? Promise.resolve(new Response(JSON.stringify({ user: { id: 'export-test', email: 'test@example.invalid' } }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, options);
  });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, options) => input === '/api/auth/me'
      ? Promise.resolve(new Response(JSON.stringify({ user: { id: 'export-test', email: 'test@example.invalid' } }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, options);
  });
  const result = await page.evaluate(async () => {
    window.state.exportFormat = 'webm';
    window.state.audio = {
      name: 'voice.wav',
      type: 'audio/wav',
      dataURL: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    };
    let downloaded = false;
    const originalRecordWebM = window.recordWebM;
    const originalMux = window.processExportWithFFmpeg;
    const originalFallback = window.recordWebMWithAudioRealtime;
    const originalDownload = window.downloadExportBlob;
    window.recordWebM = async () => ({
      blob: new Blob(['video'], { type: 'video/webm' }),
      ext: 'webm',
      mime: 'video/webm',
      profile: { videoDurationMs: 1000 },
    });
    window.processExportWithFFmpeg = async () => {
      throw new Error('mux exploded');
    };
    window.recordWebMWithAudioRealtime = async () => {
      throw new Error('fallback exploded');
    };
    window.downloadExportBlob = () => {
      downloaded = true;
    };
    try {
      await window.startRecording();
      return {
        downloaded,
        progress: document.getElementById('export-progress-text')?.textContent || '',
        progressActive: document.getElementById('export-progress-container')?.classList.contains('active'),
        controlsDisplay: getComputedStyle(document.getElementById('export-banner-controls')).display,
      };
    } finally {
      window.recordWebM = originalRecordWebM;
      window.processExportWithFFmpeg = originalMux;
      window.recordWebMWithAudioRealtime = originalFallback;
      window.downloadExportBlob = originalDownload;
      window.state.audio = null;
    }
  });
  expect(result.downloaded).toBe(false);
  expect(result.progress).toContain('Export failed: fallback exploded');
  expect(result.progressActive).toBe(true);
  expect(result.controlsDisplay).not.toBe('none');
});

test('infinite canvas grows when layers move beyond the current workspace', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makeImage(color) {
      const c = document.createElement('canvas');
      c.width = 60;
      c.height = 60;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      return new Promise(resolve => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
      });
    }
    const img = await makeImage('#16a34a');
    window.state.layers = [{
      id: 821,
      name: 'Mover',
      img,
      x: 100,
      y: 80,
      w: 120,
      h: 120,
      visible: true,
      animOrder: 1,
      animStyle: 'scanner',
      hand: 'ghost',
      speed: 60,
      opacity: 1,
    }];
    window.state.selectedLayerId = 821;
    window.initCanvas(1280, 720);
    window.toggleInfiniteCanvas(true);
    const before = { w: window.state.canvasW, h: window.state.canvasH };
    const layer = window.state.layers[0];
    layer.x = before.w + 140;
    layer.y = before.h + 90;
    window.ensureInfiniteCanvasContainsLayers();
    const afterRightBottom = { w: window.state.canvasW, h: window.state.canvasH, x: layer.x, y: layer.y };
    layer.x = -260;
    layer.y = -180;
    const expansion = window.ensureInfiniteCanvasContainsLayers();
    return {
      before,
      afterRightBottom,
      finalW: window.state.canvasW,
      finalH: window.state.canvasH,
      finalX: layer.x,
      finalY: layer.y,
      cameraX: window.state.cameraX,
      cameraY: window.state.cameraY,
      shiftX: expansion.shiftX,
      shiftY: expansion.shiftY,
      frame: window.getCameraFrameSize(),
    };
  });
  expect(result.afterRightBottom.w).toBeGreaterThan(result.before.w);
  expect(result.afterRightBottom.h).toBeGreaterThan(result.before.h);
  expect(result.finalW).toBeGreaterThanOrEqual(result.afterRightBottom.w);
  expect(result.finalH).toBeGreaterThanOrEqual(result.afterRightBottom.h);
  expect(result.finalX).toBeGreaterThanOrEqual(0);
  expect(result.finalY).toBeGreaterThanOrEqual(0);
  expect(result.shiftX).toBeGreaterThan(0);
  expect(result.shiftY).toBeGreaterThan(0);
  expect(result.cameraX).toBeGreaterThan(0);
  expect(result.cameraY).toBeGreaterThan(0);
});

test('infinite canvas grows during a real drag beyond the white workspace edge', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makeImage(color) {
      const c = document.createElement('canvas');
      c.width = 60;
      c.height = 60;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      return new Promise(resolve => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
      });
    }
    const img = await makeImage('#0f766e');
    window.state.layers = [{
      id: 831,
      name: 'Drag grow',
      img,
      x: 100,
      y: 100,
      w: 120,
      h: 120,
      visible: true,
      animOrder: 1,
      animStyle: 'scanner',
      hand: 'ghost',
      speed: 60,
      opacity: 1,
    }];
    window.state.selectedLayerId = 831;
    window.initCanvas(1280, 720);
    window.toggleInfiniteCanvas(true);
    await new Promise(requestAnimationFrame);
    const before = { w: window.state.canvasW, h: window.state.canvasH };
    const canvas = document.getElementById('main-canvas');
    const rect0 = canvas.getBoundingClientRect();
    if (!rect0.width || !rect0.height) {
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: before.w, height: before.h, right: before.w, bottom: before.h, x: 0, y: 0, toJSON() {} });
      document.getElementById('select-canvas').getBoundingClientRect = canvas.getBoundingClientRect;
    }
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / before.w;
    const layer = window.state.layers[0];
    const startX = rect.left + (layer.x + layer.w / 2) * scale;
    const startY = rect.top + (layer.y + layer.h / 2) * scale;
    document.getElementById('select-canvas').dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      clientX: startX,
      clientY: startY,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: rect.left + (before.w + 360) * scale,
      clientY: rect.top + (before.h + 260) * scale,
    }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    return {
      before,
      afterW: window.state.canvasW,
      afterH: window.state.canvasH,
      layerX: layer.x,
      layerY: layer.y,
      cameraShadow: getComputedStyle(document.getElementById('camera-frame')).boxShadow,
    };
  });
  expect(result.afterW).toBeGreaterThan(result.before.w);
  expect(result.afterH).toBeGreaterThan(result.before.h);
  expect(result.layerX).toBeGreaterThan(result.before.w);
  expect(result.layerY).toBeGreaterThan(result.before.h);
  expect(result.cameraShadow).toBe('none');
});

test('infinite canvas restores editor workspace size after preview pause', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makeImage(color) {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      return new Promise(resolve => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
      });
    }
    const img = await makeImage('#7c3aed');
    window.state.layers = [{
      id: 841,
      name: 'Preview restore',
      img,
      x: 100,
      y: 100,
      w: 120,
      h: 120,
      visible: true,
      animOrder: 1,
      animStyle: 'scanner',
      hand: 'ghost',
      speed: 60,
      opacity: 1,
    }];
    window.state.selectedLayerId = 841;
    window.initCanvas(1280, 720);
    window.toggleInfiniteCanvas(true);
    const layer = window.state.layers[0];
    layer.x = window.state.canvasW + 120;
    layer.y = window.state.canvasH + 80;
    window.ensureInfiniteCanvasContainsLayers();
    const workspace = { w: window.state.canvasW, h: window.state.canvasH };
    const frame = window.getCameraFrameSize();
    const controller = window.ensurePreviewController();
    await controller.prepare();
    await controller.play();
    await new Promise(resolve => setTimeout(resolve, 80));
    const during = {
      w: document.getElementById('main-canvas').width,
      h: document.getElementById('main-canvas').height,
    };
    controller.pause();
    const after = {
      w: document.getElementById('main-canvas').width,
      h: document.getElementById('main-canvas').height,
      layerW: layer.w,
      layerH: layer.h,
    };
    return { workspace, frame, during, after };
  });
  expect(result.workspace.w).toBeGreaterThan(result.frame.w);
  expect(result.workspace.h).toBeGreaterThan(result.frame.h);
  expect(result.during.w).toBe(result.frame.w);
  expect(result.during.h).toBe(result.frame.h);
  expect(result.after.w).toBe(result.workspace.w);
  expect(result.after.h).toBe(result.workspace.h);
  expect(result.after.layerW).toBe(120);
  expect(result.after.layerH).toBe(120);
});

test('clicking the scene seconds ruler selects the project preview start time', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(1280, 720);
    window.state.sceneTimelineZoom = 1;
    window.state.pages = [
      {
        id: 1201,
        name: 'First',
        previewDataURL: null,
        layers: [
          { id: 1, name: 'first', x: 0, y: 0, w: 120, h: 90, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 10 },
        ],
      },
      {
        id: 1202,
        name: 'Second',
        previewDataURL: null,
        layers: [
          { id: 2, name: 'second', x: 0, y: 0, w: 120, h: 90, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 10 },
        ],
      },
    ];
    window.state.activePageId = 1201;
    window.state.layers = window.state.pages[0].layers;
    window.state.audio = { name: 'track.wav', type: 'audio/wav', dataURL: 'data:audio/wav;base64,AAAA' };
    window.renderAudioControls();
    const player = document.getElementById('project-audio-player');
    Object.defineProperty(player, 'duration', { configurable: true, get: () => 30 });
    window.renderSceneThumbs();

    const ruler = document.getElementById('scene-ruler');
    const inner = document.getElementById('scene-ruler-inner');
    inner.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 2000,
      bottom: 24,
      width: 2000,
      height: 24,
      toJSON() { return this; },
    });
    ruler.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 15 * 44,
      clientY: 8,
    }));
    await new Promise(resolve => setTimeout(resolve, 80));

    return {
      activePageId: window.state.activePageId,
      timelineStartSeconds: window.state.timelineStartSeconds,
      audioTime: player.currentTime,
      playheadLeft: parseFloat(document.getElementById('scene-playhead').style.left),
      playheadTime: document.getElementById('scene-playhead').dataset.time,
    };
  });

  expect(result.activePageId).toBe(1202);
  expect(result.timelineStartSeconds).toBe(15);
  expect(result.audioTime).toBe(15);
  expect(result.playheadLeft).toBe(15 * 44);
  expect(result.playheadTime).toBe('00:15');
});

test('preview from selected timeline time starts at scene offset and audio offset', async ({ page }) => {
  const result = await page.evaluate(() => {
    const originalPlayProjectPageAt = window.playProjectPageAt;
    try {
      window.initCanvas(1280, 720);
      window.state.pages = [
        {
          id: 1301,
          name: 'First',
          previewDataURL: null,
          layers: [
            { id: 1, name: 'first', x: 0, y: 0, w: 120, h: 90, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 10 },
          ],
        },
        {
          id: 1302,
          name: 'Second',
          previewDataURL: null,
          layers: [
            { id: 2, name: 'second', x: 0, y: 0, w: 120, h: 90, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 10 },
          ],
        },
      ];
      window.state.activePageId = 1301;
      window.state.layers = window.state.pages[0].layers;
      window.state.timelineStartSeconds = 16.5;
      let calledIndex = null;
      window.playProjectPageAt = index => { calledIndex = index; };
      window.playFromSelectedScene();
      return {
        calledIndex,
        playback: window.state._projectPlayback,
      };
    } finally {
      window.playProjectPageAt = originalPlayProjectPageAt;
      window.state._projectPlayback = null;
    }
  });

  expect(result.calledIndex).toBe(1);
  expect(result.playback.startIndex).toBe(1);
  expect(result.playback.audioOffset).toBe(16.5);
  expect(result.playback.firstSceneOffsetMs).toBe(6500);
});

test('sidebar preview starts from the first scene even when a timeline start is selected', async ({ page }) => {
  const result = await page.evaluate(() => {
    const originalPlayProjectPageAt = window.playProjectPageAt;
    try {
      window.initCanvas(1280, 720);
      window.state.pages = [
        {
          id: 1351,
          name: 'First',
          previewDataURL: null,
          layers: [
            { id: 1, name: 'first', x: 0, y: 0, w: 120, h: 90, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 10 },
          ],
        },
        {
          id: 1352,
          name: 'Second',
          previewDataURL: null,
          layers: [
            { id: 2, name: 'second', x: 0, y: 0, w: 120, h: 90, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 10 },
          ],
        },
      ];
      window.state.activePageId = 1352;
      window.state.layers = window.state.pages[1].layers;
      window.state.timelineStartSeconds = 16.5;
      let calledIndex = null;
      window.playProjectPageAt = index => { calledIndex = index; };
      window.playProjectFromBeginning();
      return {
        calledIndex,
        timelineStartSeconds: window.state.timelineStartSeconds,
        playback: window.state._projectPlayback,
      };
    } finally {
      window.playProjectPageAt = originalPlayProjectPageAt;
      window.state._projectPlayback = null;
    }
  });

  expect(result.calledIndex).toBe(0);
  expect(result.timelineStartSeconds).toBe(0);
  expect(result.playback.startIndex).toBe(0);
  expect(result.playback.audioOffset).toBe(0);
  expect(result.playback.firstSceneOffsetMs).toBe(0);
});

test('restart and play controls start from the selected timeline frame', async ({ page }) => {
  const result = await page.evaluate(() => {
    const originalPlayProjectPageAt = window.playProjectPageAt;
    try {
      window.initCanvas(1280, 720);
      window.state.pages = [
        {
          id: 1361,
          name: 'First',
          previewDataURL: null,
          layers: [
            { id: 1, name: 'first', x: 0, y: 0, w: 120, h: 90, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 10 },
          ],
        },
        {
          id: 1362,
          name: 'Second',
          previewDataURL: null,
          layers: [
            { id: 2, name: 'second', x: 0, y: 0, w: 120, h: 90, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 10 },
          ],
        },
      ];
      window.state.activePageId = 1361;
      window.state.layers = window.state.pages[0].layers;

      let restartIndex = null;
      window.state.timelineStartSeconds = 16.5;
      window.playProjectPageAt = index => { restartIndex = index; };
      window.restartAnim();
      const restartPlayback = { ...window.state._projectPlayback };

      let playIndex = null;
      window.state._projectPlayback = null;
      window.state.playing = false;
      window.state.timelineStartSeconds = 16.5;
      window.playProjectPageAt = index => { playIndex = index; };
      window.togglePlay();
      const playPlayback = { ...window.state._projectPlayback };

      return { restartIndex, restartPlayback, playIndex, playPlayback };
    } finally {
      window.playProjectPageAt = originalPlayProjectPageAt;
      window.state._projectPlayback = null;
    }
  });

  expect(result.restartIndex).toBe(1);
  expect(result.restartPlayback.audioOffset).toBe(16.5);
  expect(result.restartPlayback.firstSceneOffsetMs).toBe(6500);
  expect(result.playIndex).toBe(1);
  expect(result.playPlayback.audioOffset).toBe(16.5);
  expect(result.playPlayback.firstSceneOffsetMs).toBe(6500);
});

test('project playback restores and starts the next scene automatically', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    const makeDataURL = color => {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 60;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    };
    const first = makeDataURL('#ef4444');
    const second = makeDataURL('#2563eb');
    window.state.pages = [
      {
        id: 1401,
        name: 'First',
        canvasW: 640,
        canvasH: 360,
        canvasBg: { type: 'solid', val: '#ffffff' },
        _currentRatio: '16:9',
        _currentRes: 720,
        layers: [{
          id: 1,
          name: 'First Layer',
          imageDataURL: first,
          x: 10,
          y: 10,
          w: 80,
          h: 60,
          visible: true,
          opacity: 1,
          animOrder: 1,
          animStyle: 'scanner',
          speed: 80,
          reviewDuration: 1,
        }],
        selectedLayerId: 1,
        groups: [],
      },
      {
        id: 1402,
        name: 'Second',
        canvasW: 640,
        canvasH: 360,
        canvasBg: { type: 'solid', val: '#ffffff' },
        _currentRatio: '16:9',
        _currentRes: 720,
        layers: [{
          id: 2,
          name: 'Second Layer',
          imageDataURL: second,
          x: 20,
          y: 20,
          w: 80,
          h: 60,
          visible: true,
          opacity: 1,
          animOrder: 1,
          animStyle: 'scanner',
          speed: 80,
          reviewDuration: 1,
        }],
        selectedLayerId: 2,
        groups: [],
      },
    ];
    window.state.activePageId = 1401;
    await new Promise(resolve => window.restoreEditorState(window.state.pages[0], resolve));
    const originalGenerate = window.generate;
    let generatedLayerName = null;
    try {
      window.generate = () => {
        generatedLayerName = window.state.layers[0]?.name || null;
      };
      window.state._projectPlayback = {
        active: true,
        index: 0,
        startIndex: 0,
        audioStarted: false,
        audioOffset: 0,
        firstSceneOffsetMs: 0,
      };
      window.handleProjectSceneFinished();
      await new Promise(resolve => setTimeout(resolve, 220));
      const pixel = [...document.getElementById('main-canvas').getContext('2d').getImageData(30, 30, 1, 1).data];
      return {
        activePageId: window.state.activePageId,
        layerName: window.state.layers[0]?.name,
        selectedLayerId: window.state.selectedLayerId,
        generatedLayerName,
        pixel,
      };
    } finally {
      window.generate = originalGenerate;
      window.state._projectPlayback = null;
    }
  });

  expect(result.activePageId).toBe(1402);
  expect(result.layerName).toBe('Second Layer');
  // Scene restoration deliberately clears selection; it does not affect playback.
  expect(result.selectedLayerId).toBeNull();
  expect(result.generatedLayerName).toBe('Second Layer');
  expect(result.pixel[2]).toBeGreaterThan(180);
});

test('project playback automatically renders the next scene without manual scene click', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    const makeDataURL = color => {
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 80;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      return new Promise(resolve => {
        img.onload = () => resolve(img.src);
        img.onerror = () => resolve(img.src);
      });
    };
    const first = await makeDataURL('#ef4444');
    const second = await makeDataURL('#2563eb');
    const baseScene = {
      canvasW: 640,
      canvasH: 360,
      canvasBg: { type: 'solid', val: '#ffffff' },
      _currentRatio: '16:9',
      _currentRes: 720,
      groups: [],
      animStyle: 'scanner',
      hand: 'custom1',
      zigzag: true,
    };
    window.state.pages = [
      {
        ...baseScene,
        id: 1501,
        name: 'First',
        layers: [{
          id: 1,
          name: 'First Layer',
          imageDataURL: first,
          x: 10,
          y: 10,
          w: 100,
          h: 80,
          visible: true,
          opacity: 1,
          animOrder: 1,
          animStyle: 'scanner',
          speed: 100,
          reviewDuration: 0.1,
        }],
        selectedLayerId: 1,
      },
      {
        ...baseScene,
        id: 1502,
        name: 'Second',
        layers: [{
          id: 2,
          name: 'Second Layer',
          imageDataURL: second,
          x: 20,
          y: 20,
          w: 100,
          h: 80,
          visible: true,
          opacity: 1,
          animOrder: 1,
          animStyle: 'scanner',
          speed: 100,
          reviewDuration: 0.1,
        }],
        selectedLayerId: 2,
      },
    ];
    window.state.activePageId = 1501;
    await new Promise(resolve => window.restoreEditorState(window.state.pages[0], resolve));
    window.state._projectPlayback = {
      active: true,
      index: 0,
      startIndex: 0,
      audioStarted: false,
      audioOffset: 0,
      firstSceneOffsetMs: 0,
    };
    window.handleProjectSceneFinished();
    await new Promise(resolve => {
      const started = performance.now();
      const poll = () => {
        if (window.state.activePageId === 1502 && window.state.playing && (window.state._activeSlots?.length || 0) > 0) resolve();
        else if (performance.now() - started > 3000) resolve();
        else requestAnimationFrame(poll);
      };
      poll();
    });
    const beforePixel = [...document.getElementById('main-canvas').getContext('2d').getImageData(30, 30, 1, 1).data];
    await new Promise(resolve => setTimeout(resolve, 250));
    const afterPixel = [...document.getElementById('main-canvas').getContext('2d').getImageData(30, 30, 1, 1).data];
    window.resetAnim();
    window.state._projectPlayback = null;
    return {
      activePageId: window.state.activePageId,
      layerName: window.state.layers[0]?.name,
      playing: window.state.playing,
      activeSlots: window.state._activeSlots?.length || 0,
      beforePixel,
      afterPixel,
    };
  });

  expect(result.activePageId).toBe(1502);
  expect(result.layerName).toBe('Second Layer');
  expect(result.beforePixel[2] + result.afterPixel[2]).toBeGreaterThan(120);
});

test('scene seconds ruler expands when audio duration loads later', async ({ page }) => {
  const metrics = await page.evaluate(() => {
    window.initCanvas(1280, 720);
    window.state.pages = [{
      id: 701,
      name: 'Short Scene',
      previewDataURL: null,
      layers: [
        { id: 1, name: 'short', x: 0, y: 0, w: 100, h: 80, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 5 },
      ],
    }];
    window.state.activePageId = 701;
    window.state.layers = window.state.pages[0].layers;
    window.renderSceneThumbs();
    const beforeWidth = parseFloat(document.getElementById('scene-ruler-inner').style.width);
    window.state.audio = { name: 'late.wav', type: 'audio/wav', dataURL: 'data:audio/wav;base64,AAAA' };
    window.renderAudioControls();
    const player = document.getElementById('project-audio-player');
    Object.defineProperty(player, 'duration', { configurable: true, get: () => 120 });
    player.onloadedmetadata();
    const afterWidth = parseFloat(document.getElementById('scene-ruler-inner').style.width);
    return {
      beforeWidth,
      afterWidth,
      totalText: document.getElementById('scene-total-duration').textContent,
      lastLabel: [...document.querySelectorAll('.scene-ruler-label')].at(-1)?.textContent.trim(),
    };
  });
  expect(metrics.afterWidth).toBeGreaterThan(metrics.beforeWidth);
  expect(metrics.afterWidth).toBeGreaterThanOrEqual(120 * 44);
  expect(metrics.totalText).toContain('02:00');
  expect(metrics.lastLabel).toBe('02:00');
});

test('scene duration uses review duration and stop time fields', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.initCanvas(1280, 720);
    window.state.pages = [
      {
        id: 301,
        name: 'Review Only',
        previewDataURL: null,
        layers: [
          { id: 1, name: 'slow', x: 0, y: 0, w: 900, h: 900, visible: true, animOrder: 1, animStyle: 'illustfill', speed: 20, reviewDuration: 9, stopTime: 3 },
        ],
      },
    ];
    window.state.activePageId = 301;
    window.state.layers = window.state.pages[0].layers;
    window.renderSceneThumbs();
    const thumb = document.querySelector('.scene-thumb');
    return {
      duration: window.getSceneDurationSeconds(window.state.pages[0]),
      label: document.querySelector('.scene-thumb-duration')?.textContent.trim(),
      width: parseFloat(thumb?.style.getPropertyValue('--scene-width')),
    };
  });
  expect(result.duration).toBe(12);
  expect(result.label).toBe('12s');
  expect(result.width).toBe(12 * 44);
});

test('scene miniature stays capped inside long duration scene block', async ({ page }) => {
  const metrics = await page.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:140px;display:block;z-index:-1;';
    host.innerHTML = `
      <div class="scene-thumb" style="--scene-width:640px">
        <div class="scene-thumb-preview"></div>
        <div class="scene-thumb-footer"><span class="scene-thumb-name">Long scene</span></div>
      </div>`;
    document.body.appendChild(host);
    const thumb = host.querySelector('.scene-thumb');
    const preview = host.querySelector('.scene-thumb-preview');
    const result = {
      thumbWidth: thumb.getBoundingClientRect().width,
      previewWidth: preview.getBoundingClientRect().width,
      previewHeight: preview.getBoundingClientRect().height,
    };
    host.remove();
    return result;
  });
  expect(metrics.thumbWidth).toBeGreaterThan(600);
  expect(metrics.previewWidth).toBeLessThanOrEqual(114);
  expect(metrics.previewHeight).toBeLessThanOrEqual(66);
});

test('newly added canvas objects default to five second review duration', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2274ff';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Default Review');
    const layer = window.state.layers.at(-1);
    const settings = document.getElementById(`ls-${layer?.id}`);
    const reviewInput = settings
      ? [...settings.querySelectorAll('input[type="number"]')].find(input => input.max === '60')
      : null;
    return {
      reviewDuration: layer?.reviewDuration,
      durationText: reviewInput?.value || null,
    };
  });
  expect(result.reviewDuration).toBe(5);
  expect(result.durationText).toBe('5');
});

test('adding uploaded image keeps focus on content tab', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    window.switchSidebarTab('content');
    window.switchTab('upload');
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#23a455';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Uploaded Image');
    return {
      activeSidebarTab: document.querySelector('.sidebar-tab-btn.active')?.id,
      contentActive: document.getElementById('sidebar-pane-content')?.classList.contains('active') || false,
      uploadActive: document.querySelector('.tab-btn.active')?.textContent.trim(),
      selectedLayerName: window.getSelectedLayer()?.name,
    };
  });
  expect(result.activeSidebarTab).toBe('stab-content');
  expect(result.contentActive).toBe(true);
  expect(result.uploadActive).toBe('Images');
  expect(result.selectedLayerName).toBe('Uploaded Image');
});

test('pasting a copied image adds it to reusable content', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    window.state.assets = [];
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(0, 0, c.width, c.height);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'clipboard.png', { type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(file);
    const keyEvent = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(keyEvent);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    document.dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 80));
    return {
      keyPrevented: keyEvent.defaultPrevented,
      prevented: event.defaultPrevented,
      assets: window.state.assets.map(asset => asset.name),
      layerName: window.getSelectedLayer()?.name,
      contentActive: document.getElementById('sidebar-pane-content')?.classList.contains('active') || false,
      uploadVisible: getComputedStyle(document.getElementById('upload-panel')).display !== 'none',
      assetCards: document.querySelectorAll('#asset-library-list .asset-item').length,
    };
  });
  expect(result.keyPrevented).toBe(false);
  expect(result.prevented).toBe(true);
  expect(result.assets).toContain('Pasted Image');
  expect(result.layerName).toBe('Pasted Image');
  expect(result.contentActive).toBe(true);
  expect(result.uploadVisible).toBe(true);
  expect(result.assetCards).toBe(1);
});

test('pasting copied image html into upload area adds reusable content', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    window.state.assets = [];
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(0, 0, c.width, c.height);
    const src = c.toDataURL('image/png');
    const data = new DataTransfer();
    data.setData('text/html', `<img src="${src}">`);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    const dropZone = document.getElementById('drop-zone');
    dropZone.focus();
    dropZone.dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 80));
    return {
      prevented: event.defaultPrevented,
      tabIndex: dropZone.getAttribute('tabindex'),
      assetCount: window.state.assets.length,
      layerName: window.getSelectedLayer()?.name,
      thumbSrc: document.querySelector('#asset-library-list .asset-item img')?.getAttribute('src') || '',
    };
  });
  expect(result.prevented).toBe(true);
  expect(result.tabIndex).toBe('0');
  expect(result.assetCount).toBe(1);
  expect(result.layerName).toBe('Pasted Image');
  expect(result.thumbSrc).toContain('data:image/png');
});

test('cut layer can be pasted into another scene', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    window.state.groups = [];
    window.state.pages = [{ id: 1001, name: 'Scene 1', ...window.serializeEditorState() }];
    window.state.activePageId = 1001;

    const c = document.createElement('canvas');
    c.width = 72;
    c.height = 54;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });

    window.addLayer(img, 'Scene Transfer');
    const originalId = window.state.selectedLayerId;
    const originalPageId = window.state.activePageId;
    window.cutSelectedLayer();
    const sceneOneCountAfterCut = window.state.layers.length;

    window.createPage();
    const secondPageId = window.state.activePageId;
    await window.pasteCopiedLayer();
    window.persistActivePageToMemory();

    return {
      originalId,
      originalPageId,
      secondPageId,
      activeLayerCount: window.state.layers.length,
      activeLayerName: window.getSelectedLayer()?.name,
      activeLayerId: window.state.selectedLayerId,
      sceneOneCountAfterCut,
      sceneOneStoredCount: window.state.pages.find(p => p.id === originalPageId)?.layers.length,
      sceneTwoStoredCount: window.state.pages.find(p => p.id === secondPageId)?.layers.length,
    };
  });

  expect(result.sceneOneCountAfterCut).toBe(0);
  expect(result.sceneOneStoredCount).toBe(0);
  expect(result.activeLayerCount).toBe(1);
  expect(result.sceneTwoStoredCount).toBe(1);
  expect(result.activeLayerName).toBe('Scene Transfer Copy');
  expect(result.activeLayerId).not.toBe(result.originalId);
  expect(result.secondPageId).not.toBe(result.originalPageId);
});

test('ctrl-v after cutting a layer prefers the cut layer over stale system clipboard image', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    window.state.groups = [];
    window.state.assets = [];
    window.state.pages = [{ id: 1101, name: 'Scene 1', ...window.serializeEditorState() }];
    window.state.activePageId = 1101;

    const makeImage = async (color, w = 72, h = 54) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      return img;
    };

    window.addLayer(await makeImage('#ef4444'), 'Cut Priority');
    const originalId = window.state.selectedLayerId;
    window.cutSelectedLayer();
    window.createPage();

    const staleCanvas = document.createElement('canvas');
    staleCanvas.width = 30;
    staleCanvas.height = 30;
    staleCanvas.getContext('2d').fillRect(0, 0, staleCanvas.width, staleCanvas.height);
    const staleBlob = await new Promise(resolve => staleCanvas.toBlob(resolve, 'image/png'));
    const staleFile = new File([staleBlob], 'stale-system-clipboard.png', { type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(staleFile);

    const keyEvent = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(keyEvent);
    const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', { value: data });
    document.dispatchEvent(pasteEvent);
    await new Promise(resolve => setTimeout(resolve, 120));

    return {
      keyPrevented: keyEvent.defaultPrevented,
      pastePrevented: pasteEvent.defaultPrevented,
      originalId,
      layerNames: window.state.layers.map(layer => layer.name),
      selectedLayerName: window.getSelectedLayer()?.name,
      selectedLayerId: window.state.selectedLayerId,
      assetNames: window.state.assets.map(asset => asset.name),
    };
  });

  expect(result.keyPrevented).toBe(false);
  expect(result.pastePrevented).toBe(true);
  expect(result.layerNames).toEqual(['Cut Priority Copy']);
  expect(result.selectedLayerName).toBe('Cut Priority Copy');
  expect(result.selectedLayerId).not.toBe(result.originalId);
  expect(result.assetNames).not.toContain('Pasted Image');
});

test('external search can add an Iconify icon to reusable content', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    window.state.assets = [];
    const originalFetch = window.fetch;
    window.fetch = async url => {
      const value = String(url);
      if (value.includes('api.iconify.design/search')) {
        return new Response(JSON.stringify({ icons: ['mdi:home', 'lucide:star'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value.includes('api.iconify.design/mdi/home.svg')) {
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#111827" d="M3 11L12 3l9 8v10H3z"/></svg>', {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        });
      }
      return originalFetch(url);
    };
    window.switchTab('search');
    document.getElementById('external-search-query').value = 'home';
    document.getElementById('external-search-source').value = 'icons';
    await window.searchExternalAssets();
    const first = document.querySelector('#external-search-results [data-external-id]');
    first.click();
    await new Promise(resolve => setTimeout(resolve, 120));
    window.fetch = originalFetch;
    return {
      searchVisible: getComputedStyle(document.getElementById('search-panel')).display !== 'none',
      uploadHidden: getComputedStyle(document.getElementById('upload-panel')).display === 'none',
      resultCount: document.querySelectorAll('#external-search-results .external-result').length,
      assets: window.state.assets.map(asset => asset.name),
      selectedLayerName: window.getSelectedLayer()?.name,
      status: document.getElementById('external-search-status').textContent,
    };
  });
  expect(result.searchVisible).toBe(true);
  expect(result.uploadHidden).toBe(true);
  expect(result.resultCount).toBe(2);
  expect(result.assets).toContain('mdi:home');
  expect(result.selectedLayerName).toBe('mdi:home');
  expect(result.status).toContain('added');
});

test('layer selection can preserve collapsed settings when explicitly requested', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const makeImage = async color => {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 60;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      return img;
    };
    window.addLayer(await makeImage('#ef4444'), 'First');
    window.addLayer(await makeImage('#2563eb'), 'Second');
    const ids = window.state.layers.map(layer => layer.id);
    ids.forEach(id => {
      const layer = window.getLayerById(id);
      if (window.layerSettingsOpen(layer)) window.toggleLayerSettings(id);
    });
    window.selectLayer(ids[0], { openSettings: false });
    return {
      selectedId: window.state.selectedLayerId,
      collapsedFlags: ids.map(id => window.getLayerById(id).settingsCollapsed),
      openSettings: ids.map(id => document.getElementById(`ls-${id}`)?.classList.contains('open') || false),
      collapseButtons: document.querySelectorAll('.layer-collapse-btn').length,
    };
  });
  expect(result.selectedId).toBeTruthy();
  expect(result.collapsedFlags).toEqual([true, true]);
  expect(result.openSettings).toEqual([false, false]);
  expect(result.collapseButtons).toBe(2);
  await page.evaluate(() => selectLayer(state.selectedLayerId));
  expect(await page.evaluate(() => layerSettingsOpen(getSelectedLayer()))).toBe(true);
});

test('new image layers are inserted at the bottom and selected settings open', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    async function addImage(color, name) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      window.addLayer(img, name);
    }
    await addImage('#ef4444', 'First image');
    await addImage('#2563eb', 'Second image');
    const names = window.state.layers.map(layer => layer.name);
    const listNames = [...document.querySelectorAll('.layer-item .layer-name')].map(el => el.textContent.trim());
    const collapsed = window.state.layers.map(layer => ({
      name: layer.name,
      stored: layer.settingsCollapsed,
      open: window.layerSettingsOpen(layer),
      selected: layer.id === window.state.selectedLayerId,
    }));
    return { names, listNames, collapsed };
  });
  expect(result.names).toEqual(['Second image', 'First image']);
  expect(result.listNames).toEqual(['First image', 'Second image']);
  expect(result.collapsed).toEqual([
    { name: 'Second image', stored: false, open: true, selected: true },
    { name: 'First image', stored: true, open: false, selected: false },
  ]);
});

test('review duration input only stores whole seconds', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6b4cff';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Whole Seconds');
    const layer = window.state.layers.at(-1);
    window.setLayerReviewDuration(layer.id, '2.7');
    const settings = document.getElementById(`ls-${layer.id}`);
    const reviewInput = settings
      ? [...settings.querySelectorAll('input[type="number"]')].find(input => input.max === '60')
      : null;
    return {
      stored: layer.reviewDuration,
      inputValue: reviewInput?.value,
      inputStep: reviewInput?.step,
    };
  });
  expect(result.stored).toBe(3);
  expect(result.inputValue).toBe('3');
  expect(result.inputStep).toBe('1');
});

test('stop time input stores whole seconds and delays the next layer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff9f1c';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Stop Time');
    const layer = window.state.layers.at(-1);
    layer.reviewDuration = 5;
    const nextLayer = { ...layer, id: layer.id + 1, name: 'Next', animOrder: layer.animOrder + 1, reviewDuration: 4, stopTime: 9 };
    window.state.layers.push(nextLayer);
    window.setLayerStopTime(layer.id, '2.7');
    const settings = document.getElementById(`ls-${layer.id}`);
    const numberInputs = settings ? [...settings.querySelectorAll('input[type="number"]')] : [];
    const stopInput = numberInputs.find(input => input.getAttribute('onchange')?.includes('setLayerStopTime'));
    return {
      stored: layer.stopTime,
      inputValue: stopInput?.value,
      inputStep: stopInput?.step,
      sceneDuration: window.getSceneDurationSeconds({ layers: [layer, nextLayer] }),
      expectedDuration: layer.reviewDuration + layer.stopTime + nextLayer.reviewDuration + nextLayer.stopTime,
      groupReviewDelayMs: window.getGroupReviewDelayMs([layer]),
    };
  });
  expect(result.stored).toBe(3);
  expect(result.inputValue).toBe('3');
  expect(result.inputStep).toBe('1');
  expect(result.sceneDuration).toBeCloseTo(result.expectedDuration, 5);
  expect(result.groupReviewDelayMs).toBe(3000);
});

test('animation style, hand, and presets apply to every layer in the scene', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    async function addColoredLayer(color, name) {
      const c = document.createElement('canvas');
      c.width = 70;
      c.height = 50;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      window.addLayer(img, name);
      return window.state.layers.find(layer => layer.name === name);
    }
    await addColoredLayer('#ef4444', 'One');
    await addColoredLayer('#22c55e', 'Two');
    await addColoredLayer('#3b82f6', 'Three');
    window.state.layers[0].animStyle = 'scanner';
    window.state.layers[1].animStyle = 'chunkjump';
    window.state.layers[2].animStyle = 'outlinefill';
    window.state.layers.forEach(layer => { layer.hand = 'custom1'; });

    window.selectAnim(document.querySelector('.anim-opt[data-anim="illustfill"]'));
    const afterAnim = window.state.layers.map(layer => layer.animStyle);

    window.bbSelectHand(document.querySelector('.bb-hand-pill[data-hand="ghost"]'));
    const afterHand = window.state.layers.map(layer => layer.hand);

    window.applyPreset({
      animStyle: 'scanner',
      hand: 'custom2',
      zigzag: false,
      speed: 77,
      handSpeed: 12,
      outlineDetect: 61,
      outlineAlgorithm: 'adaptive',
      outlineStrokeStyle: 'blueprint',
      colorStyle: 'watercolor',
      textAnimDir: 'rtl',
      textDrawStyle: 'outline-fill',
    }, 'test-preset');
    return {
      afterAnim,
      afterHand,
      afterPreset: window.state.layers.map(layer => ({
        animStyle: layer.animStyle,
        hand: layer.hand,
        zigzag: layer.zigzag,
        speed: layer.speed,
        handSpeed: layer.handSpeed,
        outlineDetect: layer.outlineDetect,
        outlineAlgorithm: layer.outlineAlgorithm,
        outlineStrokeStyle: layer.outlineStrokeStyle,
        colorStyle: layer.colorStyle,
        textAnimDir: layer.textAnimDir,
        textDrawStyle: layer.textDrawStyle,
      })),
    };
  });
  expect(new Set(result.afterAnim)).toEqual(new Set(['illustfill']));
  expect(new Set(result.afterHand)).toEqual(new Set(['ghost']));
  for (const layer of result.afterPreset) {
    expect(layer).toMatchObject({
      animStyle: 'scanner',
      hand: 'custom2',
      zigzag: false,
      speed: 77,
      handSpeed: 12,
      outlineDetect: 61,
      outlineAlgorithm: 'adaptive',
      outlineStrokeStyle: 'blueprint',
      colorStyle: 'watercolor',
      textAnimDir: 'rtl',
      textDrawStyle: 'outline-fill',
    });
  }
});

test('changing hand style invalidates and refreshes the preview renderer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Hand Refresh');
    const layer = window.state.layers.at(-1);
    layer.animStyle = 'scanner';
    layer.hand = 'custom1';

    const originalLoadCustomHandImages = loadCustomHandImages;
    let loadCalls = 0;
    loadCustomHandImages = () => {
      loadCalls++;
      return Promise.resolve([]);
    };

    const controller = window.ensurePreviewController();
    await controller.prepare();
    let invalidations = 0;
    const originalInvalidate = controller.invalidate.bind(controller);
    controller.invalidate = function() {
      invalidations++;
      return originalInvalidate();
    };
    try {
      window.bbSelectHand(document.querySelector('.bb-hand-pill[data-hand="custom2"]'));
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        stateHand: window.state.hand,
        layerHands: window.state.layers.map(item => item.hand),
        selectedPill: document.querySelector('.bb-hand-pill.selected')?.dataset.hand,
        loadCalls,
        invalidations,
        playDisabled: document.getElementById('play-pause-btn').disabled,
      };
    } finally {
      controller.invalidate = originalInvalidate;
      loadCustomHandImages = originalLoadCustomHandImages;
    }
  });
  expect(result.stateHand).toBe('custom2');
  expect(new Set(result.layerHands)).toEqual(new Set(['custom2']));
  expect(result.selectedPill).toBe('custom2');
  expect(result.loadCalls).toBe(1);
  expect(result.invalidations).toBeGreaterThan(0);
  expect(result.playDisabled).toBe(false);
});

test('custom hand choices render distinct loaded sprites', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    await loadCustomHandImages();
    function renderHand(style) {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      const calls = [];
      const originalDrawImage = ctx.drawImage.bind(ctx);
      ctx.drawImage = function(source, ...args) {
        calls.push({
          src: source?.currentSrc || source?.src || '',
          width: source?.naturalWidth || source?.width || 0,
          height: source?.naturalHeight || source?.height || 0,
          args,
        });
        return originalDrawImage(source, ...args);
      };
      window.drawHand(ctx, 320, 40, 1, style, { glide: false });
      return calls.at(-1) || null;
    }
    return {
      hand1: renderHand('custom1'),
      hand2: renderHand('custom2'),
    };
  });
  expect(result.hand1.src).toContain('hand1-720p.png');
  expect(result.hand2.src).toContain('hand2-720p.png');
  expect(result.hand1.src).not.toBe(result.hand2.src);
  expect(result.hand1.width).toBeGreaterThan(0);
  expect(result.hand2.width).toBeGreaterThan(0);
});

test('generate preview uses the legacy animation engine for style fidelity', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 180;
    c.height = 140;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#111111';
    ctx.font = '700 28px sans-serif';
    ctx.fillText('Draw', 24, 72);
    ctx.strokeStyle = '#12a879';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(20, 115);
    ctx.bezierCurveTo(70, 20, 120, 150, 165, 42);
    ctx.stroke();
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Live Engine');
    const layer = window.state.layers.at(-1);
    layer.speed = 20;
    layer.animStyle = 'scanner';
    layer.hand = 'ghost';
    layer.reviewDuration = 4;
    window.generate();
    await new Promise(resolve => {
      const started = performance.now();
      const poll = () => {
        if ((window.state._usingLegacyAnimation && window.state.playing && (window.state._activeSlots?.length || 0) > 0) || performance.now() - started > 2500) resolve();
        else requestAnimationFrame(poll);
      };
      poll();
    });
    const controller = window.ensurePreviewController();
    const result = {
      usingLegacy: window.state._usingLegacyAnimation,
      playing: window.state.playing,
      activeSlots: window.state._activeSlots?.length || 0,
      previewPlaying: controller.playing,
      renderingVisible: document.getElementById('topbar-buffer')?.classList.contains('visible') || false,
    };
    window.resetAnim();
    return result;
  });
  expect(result.usingLegacy).toBe(true);
  expect(result.playing).toBe(true);
  expect(result.activeSlots).toBeGreaterThan(0);
  expect(result.previewPlaying).toBe(false);
  expect(result.renderingVisible).toBe(false);
});

test('missing hand sprite falls back without drawing red image-missing text', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.initCanvas(640, 360);
    const previousCustom1 = customHandImages.custom1;
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    const labels = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      labels.push(String(text));
      return originalFillText.call(this, text, ...args);
    };
    try {
      customHandImages.custom1 = {};
      window.drawHand(ctx, 110, 90, 1, 'custom1', { glide: false });
    } finally {
      customHandImages.custom1 = previousCustom1;
      CanvasRenderingContext2D.prototype.fillText = originalFillText;
    }
    return {
      labels,
      hasInk: ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0),
    };
  });
  expect(result.labels.join(' ')).not.toContain('image missing');
  expect(result.hasInk).toBe(true);
});

test('project preview starts selected scene without restoring it first', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const originalRestore = window.restoreEditorState;
    const originalGenerate = window.generate;
    let restoreCalls = 0;
    let generateCalls = 0;
    try {
      window.state.pages = [
        { id: 701, name: 'Scene 1', layers: [{ id: 1, name: 'Layer 1', imageDataURL: 'data:image/png;base64,x' }], previewDataURL: null },
        { id: 702, name: 'Scene 2', layers: [], previewDataURL: null },
      ];
      window.state.activePageId = 701;
      window.state.layers = [{ id: 1, name: 'Live Layer', visible: true }];
      window.restoreEditorState = function(savedState, done) {
        restoreCalls++;
        if (typeof done === 'function') done();
      };
      window.generate = function() {
        generateCalls++;
      };
      window.playFromSelectedScene();
      return {
        restoreCalls,
        generateCalls,
        playbackIndex: window.state._projectPlayback?.index,
      };
    } finally {
      window.restoreEditorState = originalRestore;
      window.generate = originalGenerate;
      window.state._projectPlayback = null;
    }
  });
  expect(result.restoreCalls).toBe(0);
  expect(result.generateCalls).toBe(1);
  expect(result.playbackIndex).toBe(0);
});

test('email auth opened inside studio returns to the studio route', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    const originalLoadStudioRouteProject = window.loadStudioRouteProject;
    let loadCalls = 0;
    try {
      await window.initDB();
      await window.createNewProject({ open: true, updateUrl: false, syncAccount: false });
      await new Promise(resolve => setTimeout(resolve, 200));
      document.body.classList.remove('home-mode');
      window.loadStudioRouteProject = async () => { loadCalls++; };
      window.fetch = async (...args) => {
        const [url] = args;
        if (String(url).includes('/api/auth/login')) {
          return new Response(JSON.stringify({
            user: { id: 'user-1', email: 'studio@example.com', name: 'Studio User' },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch.apply(window, args);
      };

      window.showAuthModal('login');
      document.getElementById('auth-email').value = 'studio@example.com';
      document.getElementById('auth-password').value = 'password123';
      const rememberedBeforeSubmit = localStorage.getItem('inkmotion.authReturnTo.v1');
      await window.submitAuthForm({ preventDefault() {} });
      return {
        pathname: window.location.pathname,
        homeMode: document.body.classList.contains('home-mode'),
        modalOpen: document.getElementById('auth-modal')?.classList.contains('active') || false,
        rememberedBeforeSubmit,
        rememberedAfterSubmit: localStorage.getItem('inkmotion.authReturnTo.v1'),
        loadCalls,
      };
    } finally {
      window.fetch = originalFetch;
      window.loadStudioRouteProject = originalLoadStudioRouteProject;
      localStorage.removeItem('inkmotion.authReturnTo.v1');
    }
  });
  expect(result.homeMode).toBe(false);
  expect(result.modalOpen).toBe(false);
  expect(result.rememberedBeforeSubmit).toBe('/en/studio');
  expect(result.pathname).toBe('/en/studio');
  expect(result.rememberedAfterSubmit).toBeNull();
  expect(result.loadCalls).toBe(0);
});

test('playFromSelectedScene starts visible preview and clears rendering indicator', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 140;
    c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#161616';
    ctx.fillRect(18, 18, 104, 84);
    ctx.fillStyle = '#29c786';
    ctx.beginPath();
    ctx.arc(70, 60, 28, 0, Math.PI * 2);
    ctx.fill();
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Preview Start');
    const activeLayer = window.state.layers.at(-1);
    activeLayer.animStyle = 'scanner';
    activeLayer.speed = 1;
    activeLayer.reviewDuration = 5;
    window.state.pages = [{
      id: 801,
      name: 'Scene 1',
      ...window.serializeEditorState(),
    }];
    window.state.activePageId = 801;
    window.playFromSelectedScene();
    await new Promise(resolve => {
      const started = performance.now();
      const poll = () => {
        if ((window.state._usingLegacyAnimation && window.state.playing && (window.state._activeSlots?.length || 0) > 0) || performance.now() - started > 2500) resolve();
        else requestAnimationFrame(poll);
      };
      poll();
    });
    const controller = window.ensurePreviewController();
    return {
      playing: window.state.playing,
      activeSlots: window.state._activeSlots?.length || 0,
      previewPlaying: controller.playing,
      usingLegacy: window.state._usingLegacyAnimation,
      renderingVisible: document.getElementById('topbar-buffer')?.classList.contains('visible') || false,
      progress: window.state._animProgress || 0,
    };
  });
  expect(result.playing).toBe(true);
  expect(result.activeSlots).toBeGreaterThan(0);
  expect(result.previewPlaying).toBe(false);
  expect(result.usingLegacy).toBe(true);
  expect(result.renderingVisible).toBe(false);
  expect(result.progress).toBeGreaterThanOrEqual(0);
});

test('generate waits for animation engine instead of throwing reference error', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(10, 10, 60, 40);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Engine Wait');
    const originalEngine = window.AnimationEngine;
    let referenceError = false;
    try {
      window.AnimationEngine = null;
      window._animationEngineLoadPromise = Promise.resolve(originalEngine);
      window.generate();
      await new Promise(resolve => setTimeout(resolve, 80));
    } catch (err) {
      referenceError = /AnimationEngine is not defined/.test(String(err?.message || err));
    } finally {
      window.AnimationEngine = originalEngine;
      window.resetAnim();
    }
    return {
      referenceError,
      renderingVisible: document.getElementById('topbar-buffer')?.classList.contains('visible') || false,
    };
  });
  expect(result.referenceError).toBe(false);
  expect(result.renderingVisible).toBe(false);
});

test('review duration controls live preview animation pacing', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 180;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#151515';
    ctx.fillRect(20, 20, 180, 130);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Timed Preview');
    const layer = window.state.layers.at(-1);
    layer.animStyle = 'scanner';
    layer.speed = 40;
    layer.reviewDuration = 15;
    window._generateNow();
    await new Promise(resolve => setTimeout(resolve, 120));
    const slot = window.state._activeSlots?.[0];
    const result = {
      previewDurationMs: slot?.previewDurationMs,
      tickIntervalMs: slot?.tickIntervalMs,
      slotRuntimeMs: slot ? Math.round(slot.deadlineAt - slot.startedAt) : null,
      groupReviewHoldMs: window.getGroupReviewHoldMs([layer]),
      groupReviewDelayMs: window.getGroupReviewDelayMs([layer]),
      playing: window.state.playing,
    };
    window.resetAnim();
    return result;
  });
  expect(result.previewDurationMs).toBe(15000);
  expect(result.slotRuntimeMs).toBe(15000);
  expect(result.tickIntervalMs).toBeGreaterThan(16);
  expect(result.groupReviewHoldMs).toBe(0);
  expect(result.groupReviewDelayMs).toBe(0);
  expect(result.playing).toBe(true);
});

test('live preview does not advance a layer before its review duration deadline', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(10, 10, 44, 28);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Exact Timing');
    const layer = window.state.layers.at(-1);
    layer.animStyle = 'scanner';
    layer.speed = 100;
    layer.reviewDuration = 5;
    window._generateNow();
    await new Promise(resolve => setTimeout(resolve, 140));
    const slot = window.state._activeSlots?.[0];
    try {
      window.state._currentSlot = slot;
      window.finishAnim();
      return {
        doneAfterEarlyFinish: slot?.done,
        holding: !!slot?.holdingUntil,
        remainingMs: slot ? Math.max(0, Math.round(slot.deadlineAt - performance.now())) : null,
        runtimeMs: slot ? Math.round(slot.deadlineAt - slot.startedAt) : null,
      };
    } finally {
      window.state._currentSlot = null;
      window.resetAnim();
    }
  });
  expect(result.doneAfterEarlyFinish).toBe(false);
  expect(result.holding).toBe(true);
  expect(result.remainingMs).toBeGreaterThan(4000);
  expect(result.runtimeMs).toBe(5000);
});

test('sequential live preview groups start at configured review duration boundaries', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];

    async function makeImage(color, name) {
      const c = document.createElement('canvas');
      c.width = 60;
      c.height = 44;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      window.addLayer(img, name);
      return window.state.layers.find(layer => layer.name === name);
    }

    const first = await makeImage('#f97316', 'First');
    const second = await makeImage('#2563eb', 'Second');
    first.animOrder = 1;
    first.animStyle = 'scanner';
    first.speed = 100;
    first.reviewDuration = 5;
    first.stopTime = 0;
    second.animOrder = 2;
    second.animStyle = 'scanner';
    second.speed = 100;
    second.reviewDuration = 5;
    second.stopTime = 0;

    const starts = [];
    const originalRunGroupAt = window._runGroupAt;
    window._runGroupAt = function(gpos) {
      starts.push({ gpos, at: performance.now() });
      return originalRunGroupAt(gpos);
    };
    try {
      window._generateNow();
      await new Promise(resolve => setTimeout(resolve, 180));
      const firstSlot = window.state._activeSlots?.[0];
      const firstStart = firstSlot?.startedAt;
      const firstDeadline = firstSlot?.deadlineAt;
      if (!firstSlot) return { error: 'missing first slot' };
      window.state._currentSlot = firstSlot;
      window.finishAnim();
      window.state._currentSlot = null;
      await new Promise(resolve => setTimeout(resolve, 5100));
      return {
        firstRuntimeMs: Math.round(firstDeadline - firstStart),
        secondStartDeltaMs: starts[1] ? Math.round(starts[1].at - firstStart) : null,
        starts,
      };
    } finally {
      window._runGroupAt = originalRunGroupAt;
      window.resetAnim();
    }
  });
  expect(result.error).toBeUndefined();
  expect(result.firstRuntimeMs).toBe(5000);
  expect(result.secondStartDeltaMs).toBeGreaterThanOrEqual(4950);
  expect(result.secondStartDeltaMs).toBeLessThan(5300);
});

test('final stop time is included before live preview completes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Final Stop');
    const layer = window.state.layers.at(-1);
    layer.animStyle = 'scanner';
    layer.speed = 100;
    layer.reviewDuration = 1;
    layer.stopTime = 1;

    const originalAllDone = window._allLayersDone;
    let completedAt = null;
    window._allLayersDone = function(...args) {
      completedAt = performance.now();
      return originalAllDone.apply(this, args);
    };
    try {
      window._generateNow();
      await new Promise(resolve => setTimeout(resolve, 130));
      const slot = window.state._activeSlots?.[0];
      const startedAt = slot?.startedAt;
      window.state._currentSlot = slot;
      window.finishAnim();
      window.state._currentSlot = null;
      await new Promise(resolve => {
        const poll = () => {
          if (completedAt || performance.now() - startedAt > 2600) resolve();
          else setTimeout(poll, 25);
        };
        poll();
      });
      return {
        elapsedMs: completedAt && startedAt ? Math.round(completedAt - startedAt) : null,
        done: window.state.done,
      };
    } finally {
      window._allLayersDone = originalAllDone;
      window.state._currentSlot = null;
      window.resetAnim();
    }
  });
  expect(result.done).toBe(true);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(1950);
  expect(result.elapsedMs).toBeLessThan(2350);
});

test('throttled live preview does not clear hand between timed ticks', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 180;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#151515';
    ctx.fillRect(20, 20, 180, 130);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    window.addLayer(img, 'Hand Hold');
    const layer = window.state.layers.at(-1);
    layer.animStyle = 'scanner';
    layer.speed = 40;
    layer.reviewDuration = 15;
    window._generateNow();
    await new Promise(resolve => setTimeout(resolve, 120));
    const slot = window.state._activeSlots?.[0];
    slot.tickIntervalMs = 1000;
    slot._nextTickAt = performance.now() + 1000;
    const handCanvas = document.getElementById('main-canvas').nextSibling;
    const originalClear = CanvasRenderingContext2D.prototype.clearRect;
    let clearCalls = 0;
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
      if (this.canvas === handCanvas) clearCalls++;
      return originalClear.apply(this, args);
    };
    try {
      window.AnimationEngine._tickAllSlots();
    } finally {
      CanvasRenderingContext2D.prototype.clearRect = originalClear;
      window.resetAnim();
    }
    return { clearCalls };
  });
  expect(result.clearCalls).toBe(0);
});

test('layer animation order is read-only and follows drag reorder', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.initCanvas(640, 360);
    window.state.layers = [];
    window.state.selectedLayerId = null;

    async function makeImage(color) {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      return img;
    }

    window.addLayer(await makeImage('#ef4444'), 'Bottom');
    window.addLayer(await makeImage('#2563eb'), 'Top');
    window.renderLayerList();

    const firstInput = document.querySelector('.layer-item input[title*="drag and drop"]');
    const topItem = document.querySelector('.layer-item[data-id="2"]');
    const handle = topItem.querySelector('.layer-drag-handle');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: 100 });
    handle.dispatchEvent(down);
    if (typeof document.onmousemove === 'function') {
      document.onmousemove(new MouseEvent('mousemove', { bubbles: true, clientY: 170 }));
    }
    if (typeof document.onmouseup === 'function') {
      document.onmouseup(new MouseEvent('mouseup', { bubbles: true, clientY: 170 }));
    }

    window._generateNow();
    const previewQueueIds = (window.state._animQueue || window.getAnimOrder()).map(layer => layer.id);
    window.resetAnim();

    return {
      readOnly: firstInput?.readOnly,
      hasInlineOrderInput: !!document.querySelector('[oninput^="setLayerOrder"]'),
      stackIds: window.state.layers.map(layer => layer.id),
      visibleListIds: [...document.querySelectorAll('.layer-item')].map(item => Number(item.dataset.id)),
      orderById: Object.fromEntries(window.state.layers.map(layer => [layer.id, layer.animOrder])),
      animIds: window.getAnimOrder().map(layer => layer.id),
      previewQueueIds,
      renderedOrders: [...document.querySelectorAll('.layer-item input[title*="drag and drop"]')].map(input => input.value),
    };
  });

  expect(result.readOnly).toBe(true);
  expect(result.hasInlineOrderInput).toBe(false);
  expect(result.stackIds).toEqual([2, 1]);
  expect(result.visibleListIds).toEqual([1, 2]);
  expect(result.orderById).toEqual({ '1': 1, '2': 2 });
  expect(result.animIds).toEqual([1, 2]);
  expect(result.previewQueueIds).toEqual([1, 2]);
  expect(result.renderedOrders).toEqual(['1', '2']);
});

test('multiple audio clips can be uploaded, moved, trimmed, mixed and removed', async ({ page }) => {
  const samples = 8000, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI / 10) * 6000), 44 + i * 2);
  await expect(page.locator('#motion-editor .motion-scroll')).toBeVisible();
  await expect(page.locator('#audio-controls-panel')).toBeHidden();
  await expect(page.locator('.playback-card')).toBeHidden();
  await page.locator('#audio-input').setInputFiles([
    { name: 'first.wav', mimeType: 'audio/wav', buffer: wav },
    { name: 'second.wav', mimeType: 'audio/wav', buffer: wav },
  ]);
  await expect(page.locator('.audio-track')).toHaveCount(2);
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  const overlapPeak = await page.evaluate(async () => {
    const ctx = new AudioContext();
    const mix = await ctx.decodeAudioData(await (await fetch(state.audio.dataURL)).arrayBuffer());
    const values = mix.getChannelData(0).subarray(1000, 2000);
    const peak = Math.max(...values); await ctx.close(); return peak;
  });
  expect(overlapPeak).toBeGreaterThan(0.3);
  const clip = page.getByRole('button', { name: 'Audio clip second.wav', exact: true });
  await clip.scrollIntoViewIfNeeded();
  const box = await clip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2); await page.mouse.up();
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  await expect(page.getByLabel('Audio start (ms)', { exact: true })).toHaveCount(0);
  await clip.scrollIntoViewIfNeeded();
  const edge = await clip.locator('.motion-resize:not(.audio-trim-start)').boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 - 40, edge.y + edge.height / 2);
  await page.mouse.up();
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  const result = await page.evaluate(async () => {
    const snapshot = getCurrentProjectSnapshot();
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await (await fetch(state.audio.dataURL)).arrayBuffer());
    const data = buffer.getChannelData(0), rate = buffer.sampleRate;
    const peak = seconds => { let max = 0; for (let i = Math.floor(seconds * rate); i < (seconds + 0.05) * rate; i++) max = Math.max(max, Math.abs(data[i] || 0)); return max; };
    await ctx.close();
    return { clips: snapshot.audioClips.map(c => ({ start: c.startMs, duration: c.durationMs })), peaks: [peak(0.2), peak(1.4), peak(2.2), peak(2.7)] };
  });
  expect(result.clips).toEqual([{ start: 0, duration: 1000 }, { start: 2000, duration: 500 }]);
  expect(result.peaks[0]).toBeGreaterThan(0.1); expect(result.peaks[1]).toBeLessThan(0.001);
  expect(result.peaks[2]).toBeGreaterThan(0.1); expect(result.peaks[3]).toBeLessThan(0.001);
  await page.getByRole('button', { name: 'Remove audio first.wav', exact: true }).click();
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  await clip.scrollIntoViewIfNeeded();
  const scrollPosition = await page.locator('#scene-timeline').evaluate(el => el.scrollTop);
  await clip.click();
  await expect(page.getByRole('dialog', { name: 'Audio settings for second.wav' })).toBeVisible();
  expect(await page.locator('#scene-timeline').evaluate(el => el.scrollTop)).toBe(scrollPosition);
  await page.keyboard.press('Escape');
  await expect(page.locator('.audio-selection-controls')).toHaveCount(0);
  await clip.click();
  await expect(page.getByRole('dialog', { name: 'Audio settings for second.wav' })).toBeVisible();
  const speed = page.getByLabel('Audio speed (×)', { exact: true });
  const volume = page.getByLabel('Audio volume (%)', { exact: true });
  await speed.fill('0.5'); await speed.press('Tab');
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  expect(await page.evaluate(() => state.audioClips[0].durationMs)).toBe(1000);
  await speed.fill('2'); await speed.press('Tab');
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  await volume.fill('50'); await volume.press('Tab');
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  const adjusted = await page.evaluate(async () => {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await (await fetch(state.audio.dataURL)).arrayBuffer());
    const data = buffer.getChannelData(0), rate = buffer.sampleRate;
    const peak = seconds => Math.max(...data.subarray(Math.floor(seconds * rate), Math.floor((seconds + 0.02) * rate)));
    const result = { clip: getCurrentProjectSnapshot().audioClips[0], audible: peak(2.1), after: peak(2.3) };
    await ctx.close(); return result;
  });
  expect(adjusted.clip).toMatchObject({ speed: 2, volume: 0.5, durationMs: 250, startMs: 2000 });
  expect(adjusted.audible).toBeGreaterThan(0.08);
  expect(adjusted.audible).toBeLessThan(0.1);
  expect(adjusted.after).toBeLessThan(0.001);
  await page.getByRole('button', { name: 'Remove audio second.wav', exact: true }).click();
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  await expect(page.locator('.audio-track')).toHaveCount(0);
  await expect(page.locator('.audio-selection-controls')).toHaveCount(0);
  expect(await page.evaluate(() => state.audio)).toBeNull();
});

test('audio continues after scene playback reaches the end', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.state.pages = [{ id: 1, layers: [] }];
    window.state._projectPlayback = { active: true, index: 0, audioStarted: true, audioOffset: 0 };
    window.state.audio = { name: 'audio.wav', dataURL: 'data:audio/wav;base64,AAAA', type: 'audio/wav' };
    const audio = document.getElementById('project-audio-player');
    let pauseCalls = 0;
    audio.pause = () => { pauseCalls++; };
    window.handleProjectSceneFinished();
    return {
      pauseCalls,
      playback: window.state._projectPlayback,
    };
  });
  expect(result.pauseCalls).toBe(0);
  expect(result.playback).toBeNull();
});
