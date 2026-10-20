(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const properties = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'];
  function ease(value, name = 'linear') {
    const t = clamp(value, 0, 1);
    if (name === 'ease-in') return t * t;
    if (name === 'ease-out') return 1 - (1 - t) ** 2;
    if (name === 'ease-in-out') return t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    return t;
  }
  function evaluate(keys, time, fallback) {
    const sorted = (keys || []).filter(k => Number.isFinite(k.timeMs) && Number.isFinite(k.value))
      .map((key, index) => ({ ...key, index })).sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);
    if (!sorted.length) return fallback;
    // Last key wins for duplicate timestamps, including the first boundary.
    let before = sorted[0];
    for (const key of sorted) {
      if (key.timeMs <= time) before = key;
      else {
        if (time < before.timeMs) return before.value;
        const t = ease((time - before.timeMs) / (key.timeMs - before.timeMs), before.easing);
        return before.value + (key.value - before.value) * t;
      }
    }
    return before.value;
  }
  function objectAt(layer, timeMs) {
    const transform = layer.transform || {};
    const defaults = { x: number(layer.x), y: number(layer.y), scaleX: 1, scaleY: 1, rotation: 0, opacity: number(layer.opacity, 1), ...transform };
    const localTime = timeMs - number(layer.clip?.startMs);
    const result = {};
    properties.forEach(property => { result[property] = evaluate(layer.keyframes?.[property], localTime, defaults[property]); });
    result.opacity = clamp(result.opacity, 0, 1);
    return result;
  }
  function cameraAt(camera, timeMs, width, height) {
    const base = camera || {};
    return {
      x: evaluate(base.keyframes?.x, timeMs, number(base.x, width / 2)),
      y: evaluate(base.keyframes?.y, timeMs, number(base.y, height / 2)),
      zoom: Math.max(.01, evaluate(base.keyframes?.zoom, timeMs, number(base.zoom, 1))),
    };
  }
  function worldToScreen(point, camera, width, height) {
    return { x: (point.x - camera.x) * camera.zoom + width / 2, y: (point.y - camera.y) * camera.zoom + height / 2 };
  }
  function screenToWorld(point, camera, width, height) {
    return { x: (point.x - width / 2) / camera.zoom + camera.x, y: (point.y - height / 2) / camera.zoom + camera.y };
  }
  function fitCamera(layers, width, height, padding = 32, timeMs = 0) {
    const visible = layers.filter(layer => layer.visible !== false);
    if (!visible.length) return { x: width / 2, y: height / 2, zoom: 1 };
    const corners = visible.flatMap(layer => {
      const pose = objectAt(layer, timeMs), w = layer.w * pose.scaleX, h = layer.h * pose.scaleY;
      const cx = pose.x + w / 2, cy = pose.y + h / 2, angle = pose.rotation * Math.PI / 180;
      return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: cx + x * Math.cos(angle) - y * Math.sin(angle), y: cy + x * Math.sin(angle) + y * Math.cos(angle) }));
    });
    const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
    const right = Math.max(...corners.map(p => p.x)), bottom = Math.max(...corners.map(p => p.y));
    return { x: (left + right) / 2, y: (top + bottom) / 2, zoom: Math.max(.01, Math.min(width / Math.max(1, right - left + padding * 2), height / Math.max(1, bottom - top + padding * 2))) };
  }
  function preset(name, layer, durationMs = 1000, path = []) {
    const key = (from, to) => [{ timeMs: 0, value: from, easing: 'ease-in-out' }, { timeMs: durationMs, value: to }];
    const x = number(layer.x), y = number(layer.y);
    if (name === 'fade') return { opacity: key(0, number(layer.opacity, 1)) };
    if (name === 'slide') return { x: key(x - number(layer.w, 100), x) };
    if (name === 'rotate') return { rotation: key(-180, 0) };
    if (name === 'pop') return { scaleX: [{ timeMs: 0, value: .01 }, { timeMs: durationMs * .7, value: 1.15 }, { timeMs: durationMs, value: 1 }], scaleY: [{ timeMs: 0, value: .01 }, { timeMs: durationMs * .7, value: 1.15 }, { timeMs: durationMs, value: 1 }] };
    if (name === 'zoom') return { scaleX: key(.25, 1), scaleY: key(.25, 1) };
    if (name === 'path' && path.length > 1) return Object.fromEntries(['x', 'y'].map(p => [p, path.map((point, i) => ({ timeMs: durationMs * i / (path.length - 1), value: point[p], easing: 'linear' }))]));
    return {};
  }
  function migrate(input) {
    if (number(input.documentVersion) > 2) throw new Error('Unsupported future project version');
    const project = clone(input);
    project.documentVersion = 2;
    project.fps = clamp(number(project.fps, 30), 1, 120);
    project.pages = (project.pages?.length ? project.pages : [{ ...clone(input), id: 1, name: 'Scene 1' }]).map((scene, index) => ({
      ...scene, id: scene.id ?? index + 1, layers: (scene.layers || []).map((layer, i) => ({
        ...layer, id: layer.id ?? i + 1, objectId: layer.objectId || `${scene.id ?? index}:object-${layer.id ?? i + 1}`,
        zIndex: layer.zIndex ?? i, visible: layer.visible !== false, opacity: number(layer.opacity, 1),
      })),
    }));
    project.activePageId = project.pages.some(scene => scene.id === project.activePageId) ? project.activePageId : project.pages[0].id;
    return project;
  }
  const api = { properties, ease, evaluate, objectAt, cameraAt, worldToScreen, screenToWorld, fitCamera, preset, migrate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InkplainerAnimation = api;
})(typeof window !== 'undefined' ? window : globalThis);
