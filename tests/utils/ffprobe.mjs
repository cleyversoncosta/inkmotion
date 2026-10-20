import { spawnSync } from 'node:child_process';

export function ffprobeAvailable() {
  const result = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
  return result.status === 0;
}

export function probeVideo(filePath) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_streams',
    '-show_format',
    '-show_packets',
    '-select_streams', 'v:0',
    '-of', 'json',
    filePath,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(result.stderr || `ffprobe failed for ${filePath}`);
  }
  return JSON.parse(result.stdout);
}

export function validateProbe(probe, expected = {}) {
  const stream = (probe.streams || [])[0];
  if (!stream) throw new Error('No video stream found.');
  const width = Number(stream.width);
  const height = Number(stream.height);
  if (expected.width && width !== expected.width) throw new Error(`Width mismatch: ${width} !== ${expected.width}`);
  if (expected.height && height !== expected.height) throw new Error(`Height mismatch: ${height} !== ${expected.height}`);
  const fps = parseRate(stream.avg_frame_rate || stream.r_frame_rate);
  if (expected.fps && Math.abs(fps - expected.fps) > 0.5) throw new Error(`FPS mismatch: ${fps} !== ${expected.fps}`);
  const packets = probe.packets || [];
  let lastPts = -Infinity;
  for (const packet of packets) {
    const pts = Number(packet.pts_time ?? packet.dts_time ?? packet.pts ?? packet.dts);
    if (!Number.isFinite(pts)) continue;
    if (pts < lastPts) throw new Error(`Non-monotonic video timestamp: ${pts} after ${lastPts}`);
    lastPts = pts;
  }
  if (expected.minPackets && packets.length < expected.minPackets) {
    throw new Error(`Too few video packets: ${packets.length} < ${expected.minPackets}`);
  }
  return {
    width,
    height,
    fps,
    duration: Number(stream.duration || probe.format?.duration || 0),
    packetCount: packets.length,
    codec: stream.codec_name,
  };
}

function parseRate(rate) {
  if (!rate || rate === '0/0') return 0;
  const [n, d] = String(rate).split('/').map(Number);
  return d ? n / d : n;
}
