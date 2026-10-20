export function compileTimeline(project) {
  const visible = (project.layers || []).filter(layer => layer.visible !== false);
  const ordered = [
    ...visible.filter(layer => layer.animOrder !== null && layer.animOrder !== undefined)
      .sort((a, b) => a.animOrder - b.animOrder),
    ...visible.filter(layer => layer.animOrder === null || layer.animOrder === undefined),
  ];
  const groupMap = new Map();
  for (const layer of ordered) {
    const key = layer.animOrder ?? `__${layer.id}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(layer);
  }
  const groups = [];
  let cursor = 0;
  const groupedLayers = [...groupMap.values()];
  for (let groupIndex = 0; groupIndex < groupedLayers.length; groupIndex++) {
    const layers = groupedLayers[groupIndex];
    const items = layers.map(layer => compileLayer(project, layer));
    const animationDurationMs = Math.max(1, ...items.map(item => item.durationMs));
    const reviewHoldMs = 0;
    const durationMs = animationDurationMs + reviewHoldMs;
    const reviewMs = Math.max(0, ...layers.map(layer => Number(layer.stopTime || 0) * 1000));
    for (const item of items) {
      item.startMs = cursor;
      item.animationEndMs = cursor + animationDurationMs;
      item.endMs = cursor + durationMs;
      item.animationDurationMs = animationDurationMs;
      item.reviewHoldMs = reviewHoldMs;
      item.groupDurationMs = durationMs;
    }
    groups.push({ startMs: cursor, endMs: cursor + durationMs, durationMs, animationDurationMs, reviewHoldMs, reviewMs, items });
    cursor += durationMs + reviewMs;
  }
  return { groups, items: groups.flatMap(group => group.items), durationMs: Math.max(1, cursor) };
}

export function compileLayer(project, layer) {
  const bounds = {
    x: Math.round(layer.x || 0),
    y: Math.round(layer.y || 0),
    w: Math.max(1, Math.round(layer.w || 1)),
    h: Math.max(1, Math.round(layer.h || 1)),
  };
  const style = layer.animStyle || 'scanner';
  const speed = Math.max(1, Number(layer.speed ?? 40));
  const complexity = Math.sqrt(bounds.w * bounds.h);
  const styleWeight = {
    scanner: 0.8,
    chunkjump: 0.9,
    scribble: 1.15,
    contour: 1.35,
    outlinechunks: 1.35,
    outlinefill: 1.55,
    illustfill: 1.7,
    outlineonly: 1.45,
    'spec-text': 1.25,
  }[style] || (style.startsWith('spec-') ? 1.35 : 1);
  const naturalDurationMs = Math.max(450, Math.min(18000, (complexity * 18 * styleWeight) / (speed / 40)));
  const reviewMs = Math.max(0, Math.min(60, Number(layer.reviewDuration || 0))) * 1000;
  const durationMs = reviewMs > 0 ? reviewMs : naturalDurationMs;
  return { layer, bounds, style, durationMs, naturalDurationMs, reviewMs, startMs: 0, animationEndMs: durationMs, endMs: durationMs };
}

export function activeLayersAt(timeline, timestampMs) {
  return timeline.items.filter(item => timestampMs > item.startMs && timestampMs < item.endMs);
}

export function completedLayersAt(timeline, timestampMs) {
  return timeline.items.filter(item => timestampMs >= item.endMs);
}
