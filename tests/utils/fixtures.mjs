export const FIXTURE_SIZES = [1, 10, 50, 100, 200];

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function createLayerDescriptors(count, seed = 12345) {
  const rand = mulberry32(seed + count);
  const styles = [
    'scanner',
    'chunkjump',
    'scribble',
    'contour',
    'outlinechunks',
    'outlinefill',
    'illustfill',
    'outlineonly',
    'spec-text',
    'spec-human',
  ];
  const kinds = ['transparent-png', 'jpeg', 'svg', 'text'];
  const layers = [];
  for (let i = 0; i < count; i++) {
    const w = 90 + Math.floor(rand() * 150);
    const h = 70 + Math.floor(rand() * 130);
    layers.push({
      id: i + 1,
      name: `Fixture Layer ${i + 1}`,
      kind: kinds[i % kinds.length],
      x: Math.floor(rand() * 820),
      y: Math.floor(rand() * 430),
      w,
      h,
      opacity: i % 9 === 0 ? 0.58 : 1,
      visible: true,
      animOrder: i % 6 === 0 ? 1 : i % 6 === 1 ? 1 : Math.floor(i / 4) + 2,
      groupId: i % 11 === 0 ? 'group-alpha' : null,
      animStyle: styles[i % styles.length],
      hand: i % 3 === 0 ? 'ghost' : 'custom1',
      speed: 25 + (i % 70),
      handSpeed: 4 + (i % 10),
      chunks: 12 + (i % 40),
      specChunks: 18 + (i % 45),
      outlineDetect: 35 + (i % 50),
      outlineAlgorithm: i % 2 ? 'classic' : 'sobel',
      outlineStrokeStyle: i % 3 ? 'default' : 'charcoal',
      textDrawStyle: i % 2 ? 'reveal' : 'outline-fill',
      reviewDuration: i % 5 === 0 ? 0.2 : 0,
      zIndex: i,
      color: colorForIndex(i),
    });
  }
  return layers;
}

export function createProjectFixture(count, seed = 12345) {
  return {
    name: `Inkplainer deterministic ${count}`,
    canvasW: 1280,
    canvasH: 720,
    canvasBg: { type: 'solid', val: 'transparent' },
    layers: createLayerDescriptors(count, seed),
  };
}

export function colorForIndex(index) {
  const hue = (index * 47) % 360;
  return `hsl(${hue}, 72%, 52%)`;
}

export function svgDataUri(layer) {
  const fill = encodeURIComponent(layer.color || '#268bd2');
  const stroke = encodeURIComponent('#111111');
  const text = encodeURIComponent(String(layer.id));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layer.w}" height="${layer.h}" viewBox="0 0 ${layer.w} ${layer.h}">
    <rect width="100%" height="100%" fill="${fill}" opacity="0.82"/>
    <circle cx="${layer.w * 0.68}" cy="${layer.h * 0.38}" r="${Math.min(layer.w, layer.h) * 0.22}" fill="white" opacity="0.62"/>
    <path d="M10 ${layer.h - 14} C ${layer.w * 0.34} 8, ${layer.w * 0.62} ${layer.h - 8}, ${layer.w - 10} 16" fill="none" stroke="${stroke}" stroke-width="6" stroke-linecap="round"/>
    <text x="14" y="28" font-family="sans-serif" font-size="20" font-weight="700" fill="${stroke}">${text}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function expectedTimelineBreakpoints(timeline) {
  const points = new Set([0, timeline.durationMs]);
  for (const group of timeline.groups) {
    points.add(group.startMs);
    points.add(group.endMs);
    points.add(Math.round((group.startMs + group.endMs) / 2));
  }
  return [...points].sort((a, b) => a - b);
}
