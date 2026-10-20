# Inkplainer Validation Report

Date: 2026-10-10

## Coverage Summary

Automated coverage now includes:

- Deterministic fixture generation for 1, 10, 50, 100, and 200 layer projects.
- Timeline grouping and duration checks for sequential and parallel animation orders.
- Random-access timestamp state checks.
- Completed-layer monotonicity checks.
- Image-difference metrics with compression-aware tolerance.
- Freeze detection for repeated frames during expected motion windows.
- Transparency detection.
- Browser rendering tests for `renderFrameAt()`.
- Preview seek latency validation on a 100-layer fixture.
- Renderer capability detection validation.
- FFprobe capability detection.

## Latest Test Results

Command:

```sh
npm run test:all
```

Result:

- Static server check: passed.
- Unit validation: 8 passed, 0 failed.
- Chromium browser validation: 4 passed, 0 failed.

## Export Correctness

The validation utilities include FFprobe integration for:

- Container parsing.
- Resolution checks.
- Frame-rate checks.
- Packet count checks.
- Monotonic video timestamp checks.
- Codec identification.

The current automated run verified FFprobe availability but did not perform a full browser video export/decode pass. Export E2E specs can now be added on top of `probeVideo()` once CI has a stable export destination and codec policy.

## Browser Compatibility Matrix

| Browser | Rendering tests | WebCodecs expectation | Fallback expectation |
| --- | ---: | --- | --- |
| Chromium / Chrome | Passed | Available in secure contexts | WebM/MediaRecorder fallback remains available |
| Edge | Not run locally | Expected similar to Chromium | WebM fallback |
| Firefox | Not run locally | Do not assume MP4 WebCodecs | WebM fallback |
| Safari | Not run locally | Do not assume MP4 WebCodecs | WebM fallback where supported |

Unsupported browser features are not treated as application bugs when the app exposes a safe fallback through `InkplainerRenderer.getCapabilities()`.

## Performance Benchmark Table

| Check | Fixture | Latest result |
| --- | ---: | ---: |
| Preview seek latency | 100 layers | Passed under 1000 ms |
| Browser render determinism | 10 layers | Passed |
| Final frame visibility/transparency | 50 layers | Passed |
| Full test suite wall time | 12 tests | About 7 seconds locally |

For full export throughput measurements, run:

```js
await runExportBenchmarkMatrix()
```

## Known Limitations

- Browser video export/decode E2E tests are scaffolded by utility code but not yet enabled as a mandatory test because they require a stable browser codec path and output-file capture policy.
- Cross-browser tests currently run only Chromium locally.
- Memory tests currently validate hooks and capability surfaces; strict leak thresholds should be calibrated after collecting baseline data on CI hardware.
- The deterministic renderer used by preview/export validates timestamp rendering and final compositing, but complex legacy drawing styles still use deterministic preview approximations rather than a full stroke-for-stroke port of every algorithm.

## Unresolved Issues

- Add mandatory MP4/WebM export E2E tests once CI codec support is fixed.
- Add decoded-frame visual comparison between exported video frames and `renderFrameAt()` references.
- Add repeated-export memory thresholds after baseline collection.
