# Export Performance Notes

Inkplainer now records export profiling data through `window.InkplainerPerformance`.
Each export logs a collapsed console table with:

- Asset/font readiness time
- Animation preprocessing and per-layer setup time
- Per-frame rendering time
- Layer compositing time
- Canvas readback/writeback overhead
- `VideoFrame` construction time
- Encoder queue backpressure skips and peak queue depth
- Encoder flush time
- Muxing and audio muxing time
- Final memory snapshot when supported by the browser

## Presets

- Fast: 720p, 30 FPS, 3 Mbps
- Balanced: 1080p, 30 FPS, 6 Mbps
- High Quality: 1080p, 60 FPS, 10 Mbps
- Maximum Quality: 4K, 30 FPS, 24 Mbps

Advanced controls can override resolution, FPS, codec preference, and bitrate.
MP4 exports intentionally keep H.264 for container compatibility; VP9 preference is used by WebM/MediaRecorder when the browser supports it.

## Benchmark Matrix

Open the app in a browser with DevTools open, then run:

```js
await runExportBenchmarkMatrix()
```

The benchmark covers 10, 50, 100, and 200 synthetic image layers at:

- 720p / 30 FPS
- 1080p / 30 FPS
- 1080p / 60 FPS
- 1440p / 30 FPS
- 4K / 30 FPS

It reports total duration, rendered frames per second, peak memory when available, and:

```js
exportSpeedRatio = videoDuration / exportDuration
```

These are measured results for the current browser and hardware, not promised targets.

## Tradeoffs

The current optimization pass keeps Canvas 2D as the primary renderer and adds a deterministic timestamp renderer for preview and MP4 export. It adds bounded canvas reuse, scaling presets, encoder probing, and instrumentation before deeper worker or GPU changes. WebGL/WebGPU is not introduced because the measured bottleneck needs to justify that complexity first.

## Preview Pipeline

Preview playback now uses `PreviewController` with the shared timestamp renderer:

- `play`, `pause`, `restart`, `seek`, playback speed, timestamp, duration, and frame scheduling are isolated from the legacy animation loop.
- Seeking renders the requested timestamp directly with `renderFrameAt(timestampMs, canvas)`.
- Project assets and timeline data are prepared separately from playback and reused while the project signature is unchanged.
- MP4 export renders frames from timestamps in a deterministic loop instead of sampling `requestAnimationFrame` playback.

Capability detection is exposed through:

```js
InkplainerRenderer.getCapabilities()
```

This reports worker, OffscreenCanvas, WebCodecs, and worker OffscreenCanvas support so worker/GPU paths can be enabled only where they are actually available.

## Offline Export Engine

Video export now uses an offline frame-by-frame engine:

- `totalFrames = ceil(durationSeconds * fps)`.
- Frame timestamps are generated from integer frame indices in microseconds.
- Each frame is rendered with the deterministic renderer before encoding.
- Export does not depend on `requestAnimationFrame`, live playback speed, tab scheduling, or wall-clock animation time.
- Encoder backpressure is bounded through `VideoEncoder.encodeQueueSize`; no frames are dropped when rendering is slower than the target FPS.
- MP4 uses `mp4-muxer` with H.264 where supported.
- WebM uses `webm-muxer` with VP9 by default and AV1 when explicitly selected and supported.
- The export UI exposes frame count, percentage, elapsed time, estimated remaining time, output size, FPS, and codec status.
- Cancellation closes encoder resources and releases temporary canvas buffers.
