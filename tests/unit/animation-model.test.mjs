import test from 'node:test';
import assert from 'node:assert/strict';
import model from '../../animation-model.js';

test('keyframes clamp boundaries, resolve duplicates and interpolate easing deterministically', () => {
  const keys = [{ timeMs: 0, value: 0, easing: 'ease-in' }, { timeMs: 1000, value: 100 }];
  assert.equal(model.evaluate(keys, -1, 5), 0);
  assert.equal(model.evaluate(keys, 500, 5), 25);
  assert.equal(model.evaluate(keys, 2000, 5), 100);
  assert.equal(model.evaluate([...keys, { timeMs: 0, value: 10 }], 0, 5), 10);
  for (const name of ['linear', 'ease-in', 'ease-out', 'ease-in-out']) {
    assert.equal(model.ease(0, name), 0); assert.equal(model.ease(1, name), 1);
    assert.ok(Math.abs(model.ease(.999999, name) - 1) < .00001);
  }
});
test('overlapping objects evaluate independently using clip local time without mutation', () => {
  const a = { x: 10, y: 20, clip: { startMs: 200 }, keyframes: { x: [{ timeMs: 0, value: 10 }, { timeMs: 1000, value: 110 }] } };
  const b = { x: 0, clip: { startMs: 0 }, keyframes: { opacity: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }] } };
  const before = JSON.stringify([a, b]);
  assert.equal(model.objectAt(a, 700).x, 60); assert.equal(model.objectAt(b, 700).opacity, .7);
  const pose = model.objectAt(a, 700); model.objectAt(a, 50); assert.deepEqual(model.objectAt(a, 700), pose);
  assert.equal(JSON.stringify([a, b]), before);
});
test('camera transforms invert correctly with negative world coordinates and arbitrary zoom', () => {
  for (const zoom of [.01, .5, 1, 5]) {
    const camera = { x: -120, y: 456, zoom }, point = { x: 333, y: -70 };
    const restored = model.screenToWorld(model.worldToScreen(point, camera, 1280, 720), camera, 1280, 720);
    assert.ok(Math.abs(restored.x - point.x) < 1e-8); assert.ok(Math.abs(restored.y - point.y) < 1e-8);
  }
});
test('legacy migration is versioned, idempotent, preserves data and rejects future versions', () => {
  const legacy = { layers: [{ id: 8, imageDataURL: 'data:image/png;base64,test', textProps: { text: 'Hello' }, animStyle: 'scribble' }] };
  const before = JSON.stringify(legacy), migrated = model.migrate(legacy);
  assert.equal(migrated.documentVersion, 2); assert.equal(migrated.pages[0].layers[0].id, 8);
  assert.deepEqual(model.migrate(migrated), migrated); assert.equal(JSON.stringify(legacy), before);
  assert.deepEqual(JSON.parse(JSON.stringify(migrated)), migrated);
  assert.throws(() => model.migrate({ documentVersion: 3 }), /future/);
});
test('presets have stable final states and path keys preserve supplied control points', () => {
  const layer = { x: 50, y: 60, w: 100, opacity: .8 };
  for (const name of ['fade', 'slide', 'pop', 'zoom', 'rotate']) {
    const result = model.objectAt({ ...layer, keyframes: model.preset(name, layer, 1000) }, 1000);
    assert.equal(result.x, 50); assert.equal(result.scaleX, 1); assert.equal(result.rotation, 0); assert.equal(result.opacity, .8);
  }
  const keys = model.preset('path', layer, 1000, [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 50, y: 60 }]);
  assert.equal(model.evaluate(keys.y, 500, 0), 20);
});

test('camera fit includes scale and rotation without changing object geometry', () => {
  const layer = { x: 20, y: 30, w: 200, h: 100, transform: { scaleX: 2, scaleY: 1, rotation: 90 } };
  const before = JSON.stringify(layer);
  const camera = model.fitCamera([layer], 800, 600, 0);
  assert.equal(camera.x, 220); assert.equal(camera.y, 80); assert.equal(camera.zoom, 1.5);
  assert.equal(JSON.stringify(layer), before);
});
