import test from 'node:test';
import assert from 'node:assert/strict';
import { compareImageData, detectUnexpectedFreezes, hasVisibleAlpha } from '../utils/visual.mjs';
import { ffprobeAvailable } from '../utils/ffprobe.mjs';

function image(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = fn(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

test('image comparison tolerates compression noise but catches regressions', () => {
  const base = image(16, 16, (x, y) => [x * 4, y * 4, 120, 255]);
  const noisy = image(16, 16, (x, y) => [x * 4 + 2, y * 4 + 1, 121, 255]);
  const broken = image(16, 16, () => [255, 0, 0, 255]);
  assert.equal(compareImageData(base, noisy, { pixelTolerance: 4, maxChangedRatio: 0.01 }).pass, true);
  assert.equal(compareImageData(base, broken, { pixelTolerance: 4, maxChangedRatio: 0.01 }).pass, false);
});

test('freeze detector flags repeated frames only when timeline expects motion', () => {
  const a = image(8, 8, () => [0, 0, 0, 255]);
  const b = image(8, 8, (x) => [x > 3 ? 255 : 0, 0, 0, 255]);
  const frames = [
    { timestampMs: 0, imageData: a },
    { timestampMs: 100, imageData: a },
    { timestampMs: 200, imageData: b },
  ];
  const frozen = detectUnexpectedFreezes(frames, [{ startMs: 0, endMs: 500 }]);
  assert.equal(frozen.length, 1);
  assert.equal(frozen[0].timestampMs, 100);
});

test('alpha validator detects transparent and semi-transparent content', () => {
  const transparent = image(4, 4, (x, y) => [20, 40, 60, x === y ? 128 : 255]);
  assert.equal(hasVisibleAlpha(transparent), true);
});

test('ffprobe capability is reported without treating absence as app failure', () => {
  assert.equal(typeof ffprobeAvailable(), 'boolean');
});
