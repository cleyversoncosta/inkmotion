export function compareImageData(a, b, options = {}) {
  if (!a || !b) throw new Error('Both image buffers are required.');
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Image dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const tolerance = options.pixelTolerance ?? 12;
  const dataA = a.data || a;
  const dataB = b.data || b;
  let changed = 0;
  let sumSquared = 0;
  let maxChannelDiff = 0;
  for (let i = 0; i < dataA.length; i += 4) {
    const dr = Math.abs(dataA[i] - dataB[i]);
    const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
    const da = Math.abs(dataA[i + 3] - dataB[i + 3]);
    const diff = Math.max(dr, dg, db, da);
    maxChannelDiff = Math.max(maxChannelDiff, diff);
    if (diff > tolerance) changed++;
    sumSquared += dr * dr + dg * dg + db * db + da * da;
  }
  const pixels = dataA.length / 4;
  return {
    width: a.width,
    height: a.height,
    pixels,
    changedPixels: changed,
    changedRatio: pixels ? changed / pixels : 0,
    rmse: Math.sqrt(sumSquared / Math.max(1, dataA.length)),
    maxChannelDiff,
    pass: changed / Math.max(1, pixels) <= (options.maxChangedRatio ?? 0.015),
  };
}

export function frameDelta(a, b) {
  return compareImageData(a, b, { pixelTolerance: 4, maxChangedRatio: 1 });
}

export function detectUnexpectedFreezes(frames, expectedChangingRanges, options = {}) {
  const minChangedRatio = options.minChangedRatio ?? 0.0008;
  const frozen = [];
  for (let i = 1; i < frames.length; i++) {
    const previous = frames[i - 1];
    const current = frames[i];
    const shouldChange = expectedChangingRanges.some(range =>
      current.timestampMs >= range.startMs && current.timestampMs <= range.endMs
    );
    if (!shouldChange) continue;
    const delta = frameDelta(previous.imageData, current.imageData);
    if (delta.changedRatio < minChangedRatio) {
      frozen.push({
        index: i,
        timestampMs: current.timestampMs,
        changedRatio: delta.changedRatio,
      });
    }
  }
  return frozen;
}

export function hasVisibleAlpha(imageData) {
  const data = imageData.data || imageData;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0 && data[i] < 255) return true;
  }
  return false;
}

export function countNonTransparentPixels(imageData) {
  const data = imageData.data || imageData;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) count++;
  }
  return count;
}
