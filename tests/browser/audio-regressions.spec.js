const { test, expect } = require('@playwright/test');

function tone(rightOnly = false) {
  const channels = rightOnly ? 2 : 1;
  const buffer = Buffer.alloc(44 + 16000 * channels);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000 * channels, 28); buffer.writeUInt16LE(2 * channels, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(16000 * channels, 40);
  for (let i = 0; i < 8000; i++) buffer.writeInt16LE(Math.round(4000 * Math.sin(i / 10)), 44 + (i * channels + channels - 1) * 2);
  return buffer.toString('base64');
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wb_onboarding_done_v1', '1'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.goto('/en/studio');
  await page.waitForFunction(() => window.InkplainerAudioTimeline && currentProjectId && !_pagesRestoring);
});

test('first file upload paints a waveform and plays without adding another clip', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#audio-input').setInputFiles({ name: 'first.wav', mimeType: 'audio/wav', buffer: Buffer.from(tone(), 'base64') });
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  await expect(page.locator('.audio-track')).toHaveCount(1);
  await expect.poll(() => page.locator('.audio-clip canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return data.filter((value, index) => index % 4 === 3 && value > 0).length;
  })).toBeGreaterThan(600);
  // The play button continuously pulses; click its center without waiting for animation stability.
  const button = await page.locator('#play-pause-btn').boundingBox();
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  await expect.poll(() => page.evaluate(() => {
    const player = document.getElementById('project-audio-player');
    return !player.paused && player.currentTime > 0;
  })).toBe(true);
  expect(errors).toEqual([]);
});

test('first stereo upload displays sound from the right channel in its waveform', async ({ page }) => {
  await page.locator('#audio-input').setInputFiles({ name: 'stereo.wav', mimeType: 'audio/wav', buffer: Buffer.from(tone(true), 'base64') });
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  await expect.poll(() => page.locator('.audio-clip canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return data.filter((value, index) => index % 4 === 3 && value > 0).length;
  })).toBeGreaterThan(600);
});

test('audio readiness waits for imports and keeps the last mix until the next one is ready', async ({ page }) => {
  const result = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const api = InkplainerAudioTimeline;
    const originalRead = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) { setTimeout(() => originalRead.call(this, blob), 100); };
    try {
      const upload = api.upload([new File([bytes], 'tone.wav', { type: 'audio/wav' })]);
      let ready = false;
      const waited = api.ready().then(() => { ready = true; });
      await new Promise(resolve => setTimeout(resolve, 20));
      const premature = ready;
      await upload; await waited;
      const previous = state.audio;
      state.audioClips[0].volume = 0.5;
      const rebuilding = api.commit();
      const retained = state.audio === previous;
      await rebuilding;
      return { premature, retained, replaced: state.audio !== previous, count: state.audioClips.length };
    } finally { FileReader.prototype.readAsDataURL = originalRead; }
  }, tone());
  expect(result).toEqual({ premature: false, retained: true, replaced: true, count: 1 });
});

test('play waits for the first audio import before starting sound', async ({ page }) => {
  await page.evaluate(base64 => {
    const originalRead = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) { setTimeout(() => originalRead.call(this, blob), 300); };
    window.firstAudioUpload = InkplainerAudioTimeline.upload([
      new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'pending.wav', { type: 'audio/wav' }),
    ]);
  }, tone());
  await page.keyboard.press('Space');
  await page.evaluate(() => window.firstAudioUpload);
  await expect.poll(() => page.evaluate(() => {
    const audio = document.getElementById('project-audio-player');
    return !audio.paused && audio.currentTime > 0;
  })).toBe(true);
});

test('saved audio clips rebuild a missing mix after reload', async ({ page }) => {
  await page.evaluate(async base64 => {
    await InkplainerAudioTimeline.upload([new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'saved.wav', { type: 'audio/wav' })]);
    state.audioClips[0].speed = 2;
    state.audioClips[0].durationMs = 500;
    state.audioClips[0].volume = 0.4;
    state.audio = null;
    saveProjectNow();
  }, tone());
  await expect.poll(() => page.evaluate(() => new Promise(resolve => {
    const request = db.transaction('projects').objectStore('projects').get(currentProjectId);
    request.onsuccess = () => resolve(request.result?.state.audioClips?.[0]?.speed);
  }))).toBe(2);
  await page.reload();
  await page.waitForFunction(() => state.audio?.dataURL && state.audioClips?.length === 1);
  expect(await page.evaluate(() => ({ speed: state.audioClips[0].speed, volume: state.audioClips[0].volume, duration: state.audioClips[0].durationMs })))
    .toEqual({ speed: 2, volume: 0.4, duration: 500 });
});

test('clicking outside audio settings saves the edited volume', async ({ page }) => {
  await page.evaluate(async base64 => {
    await InkplainerAudioTimeline.upload([new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'popup.wav', { type: 'audio/wav' })]);
  }, tone());
  await page.getByRole('button', { name: 'Audio clip popup.wav', exact: true }).click();
  await page.getByLabel('Audio volume (%)', { exact: true }).fill('35');
  await page.locator('#scene-total-duration').click();
  await expect(page.locator('.audio-selection-controls')).toHaveCount(0);
  await page.evaluate(() => InkplainerAudioTimeline.ready());
  expect(await page.evaluate(() => state.audioClips[0].volume)).toBe(0.35);
});

test('invalid legacy audio does not block importing a replacement', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.evaluate(async base64 => {
    state.audio = { name: 'broken.wav', dataURL: 'data:audio/wav;base64,AAAA' };
    InkplainerTimeline.refresh();
    await InkplainerAudioTimeline.upload([new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'replacement.wav', { type: 'audio/wav' })]);
    await InkplainerAudioTimeline.ready();
  }, tone());
  expect(await page.evaluate(() => state.audioClips.map(c => c.name))).toEqual(['replacement.wav']);
  expect(dialogs).toEqual([]);
});
