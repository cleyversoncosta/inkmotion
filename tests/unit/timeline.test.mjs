import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_SIZES, createProjectFixture, expectedTimelineBreakpoints } from '../utils/fixtures.mjs';
import { activeLayersAt, compileTimeline, completedLayersAt } from '../utils/timeline.mjs';

test('fixture generator creates required deterministic project sizes', () => {
  for (const size of FIXTURE_SIZES) {
    const first = createProjectFixture(size);
    const second = createProjectFixture(size);
    assert.equal(first.layers.length, size);
    assert.deepEqual(first, second);
    assert.ok(first.layers.some(layer => layer.kind === 'transparent-png') || size === 1);
    assert.ok(first.layers.some(layer => layer.kind === 'svg') || size < 3);
    assert.ok(first.layers.some(layer => layer.kind === 'text') || size < 4);
  }
});

test('timeline preserves simultaneous animation order groups', () => {
  const project = createProjectFixture(10);
  const timeline = compileTimeline(project);
  assert.ok(timeline.durationMs > 0);
  assert.ok(timeline.groups.length < project.layers.length);
  const firstGroup = timeline.groups[0];
  assert.ok(firstGroup.items.length >= 2);
  const starts = new Set(firstGroup.items.map(item => item.startMs));
  const ends = new Set(firstGroup.items.map(item => item.endMs));
  assert.equal(starts.size, 1);
  assert.equal(ends.size, 1);
});

test('completed layers remain completed when seeking forward', () => {
  const timeline = compileTimeline(createProjectFixture(50));
  const points = expectedTimelineBreakpoints(timeline);
  let previousCompleted = 0;
  for (const point of points) {
    const completed = completedLayersAt(timeline, point).length;
    assert.ok(completed >= previousCompleted, `completed layer count regressed at ${point}`);
    previousCompleted = completed;
  }
});

test('stop time delays the next animation group after review duration', () => {
  const project = {
    layers: [
      { id: 1, x: 0, y: 0, w: 100, h: 100, visible: true, animOrder: 1, animStyle: 'scanner', speed: 80, reviewDuration: 5, stopTime: 2 },
      { id: 2, x: 0, y: 0, w: 100, h: 100, visible: true, animOrder: 2, animStyle: 'scanner', speed: 80, reviewDuration: 4, stopTime: 9 },
    ],
  };
  const timeline = compileTimeline(project);
  assert.equal(timeline.groups[0].animationDurationMs, 5000);
  assert.equal(timeline.groups[0].reviewHoldMs, 0);
  assert.equal(timeline.groups[0].durationMs, 5000);
  assert.equal(timeline.groups[0].reviewMs, 2000);
  assert.equal(timeline.groups[1].startMs, 7000);
  assert.equal(timeline.groups[1].reviewMs, 9000);
  assert.equal(timeline.durationMs, 20000);
});

test('random access timestamps identify active and completed states without replay', () => {
  const timeline = compileTimeline(createProjectFixture(100));
  const timestamps = [
    10000,
    1000,
    60000,
    0,
    30000,
    timeline.durationMs,
  ].map(t => Math.max(0, Math.min(t, timeline.durationMs)));
  for (const timestamp of timestamps) {
    const active = activeLayersAt(timeline, timestamp);
    const completed = completedLayersAt(timeline, timestamp);
    assert.ok(active.length + completed.length <= timeline.items.length);
    if (timestamp === 0) assert.equal(completed.length, 0);
    if (timestamp === timeline.durationMs) assert.equal(completed.length, timeline.items.length);
  }
});
