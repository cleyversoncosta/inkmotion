/* Conservative SVG stroke renderer. Unsupported artwork retains its original image. */
(function () {
  'use strict';
  const cache = new Map();
  const limit = 32;
  function sourceText(source) {
    if (!/^data:image\/svg\+xml[;,]/i.test(source || '')) return null;
    const comma = source.indexOf(',');
    try { return /;base64/i.test(source.slice(0, comma)) ? new TextDecoder().decode(Uint8Array.from(atob(source.slice(comma + 1)), c => c.charCodeAt(0))) : decodeURIComponent(source.slice(comma + 1)); }
    catch (_) { return null; }
  }
  function compile(source, options = {}) {
    const key = source + JSON.stringify(options);
    if (cache.has(key)) return cache.get(key);
    const text = sourceText(source);
    let result = { supported: false, reason: 'SVG source geometry is unavailable', paths: [] };
    if (text) {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg = doc.documentElement;
      const allowed = new Set(['svg', 'g', 'path', 'title', 'desc']);
      const elements = [...svg.querySelectorAll('*'), svg];
      const unsupported = elements.some(el => !allowed.has(el.localName) || (el.localName === 'svg' && el !== svg) || [...el.attributes].some(a => /^on/i.test(a.name) || /href$/i.test(a.name) || /url\s*\(/i.test(a.value)));
      if (unsupported) result.reason = 'Artwork contains unsupported SVG features; using original-image reveal';
      else {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none';
        const node = document.importNode(svg, true);
        const view = node.viewBox?.baseVal;
        const width = view?.width || parseFloat(node.getAttribute('width')) || 300;
        const height = view?.height || parseFloat(node.getAttribute('height')) || 150;
        node.setAttribute('width', width); node.setAttribute('height', height);
        host.append(node); document.body.append(host);
        try {
          const paths = [];
          for (const element of node.querySelectorAll('path')) {
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            for (let ancestor = element; ancestor && ancestor !== host; ancestor = ancestor.parentElement) {
              const effect = getComputedStyle(ancestor);
              if (effect.filter !== 'none' || effect.clipPath !== 'none' || (effect.maskImage && effect.maskImage !== 'none') || effect.mixBlendMode !== 'normal') throw new Error('SVG compositing effects use original-image reveal');
              if (ancestor !== element && Number(effect.opacity) < 1 && ancestor.querySelectorAll('path').length > 1) throw new Error('Grouped opacity uses original-image reveal to preserve compositing');
            }
            if (style.fill !== 'none' || style.stroke === 'none' || style.strokeDasharray !== 'none' || style.vectorEffect === 'non-scaling-stroke') throw new Error('Filled, dashed or non-scaling artwork uses original-image reveal');
            const d = element.getAttribute('d') || '';
            // Splitting absolute subpaths allows a real pen-up pause between disconnected strokes.
            if (d.slice(1).includes('m')) throw new Error('Relative compound subpaths use original-image reveal');
            const parts = d.match(/[Mm][^Mm]*/g) || [];
            let opacity = Number(style.strokeOpacity);
            for (let parent = element; parent && parent !== host; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity || 1);
            const matrix = element.getCTM();
            if (!matrix) throw new Error('SVG transform cannot be resolved');
            for (const data of parts) {
              const geometry = document.createElementNS('http://www.w3.org/2000/svg', 'path'); geometry.setAttribute('d', data);
              const length = geometry.getTotalLength();
              if (!length) continue;
              paths.push({ geometry, path: new Path2D(data), length, matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }, color: style.stroke, width: parseFloat(style.strokeWidth) || 1, opacity, cap: style.strokeLinecap, join: style.strokeLinejoin, miter: Number(style.strokeMiterlimit) || 4 });
            }
          }
          if (!paths.length) throw new Error('No drawable SVG stroke geometry');
          if (options.order === 'reverse') paths.reverse();
          if (options.order === 'longest-first') paths.sort((a, b) => b.length - a.length);
          result = { supported: true, width, height, paths, length: paths.reduce((sum, path) => sum + path.length, 0) };
        } catch (error) { result.reason = error.message; }
        finally { host.remove(); }
      }
    }
    cache.set(key, result);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
    return result;
  }
  function draw(out, layer, source, progress, durationMs) {
    const settings = layer.svgDrawing || {};
    const data = compile(layer.imageDataURL || layer.img?.src, settings);
    const p = InkplainerAnimation.ease(progress, settings.easing || 'linear');
    out.save(); out.globalAlpha *= layer.opacity ?? 1;
    if (!data.supported) {
      if (settings.fallback === 'fade') out.globalAlpha *= p;
      else { out.beginPath(); out.rect(layer.x, layer.y, layer.w * p, layer.h); out.clip(); }
      out.drawImage(source, layer.x, layer.y, layer.w, layer.h); out.restore();
      return { pose: null, reason: data.reason };
    }
    if (progress >= 1) { out.drawImage(source, layer.x, layer.y, layer.w, layer.h); out.restore(); return { pose: null }; }
    const pause = Math.min(Math.max(0, settings.pauseMs || 80), durationMs / Math.max(1, data.paths.length * 2));
    const drawingMs = Math.max(1, durationMs - pause * (data.paths.length - 1));
    let cursor = 0, pose = null;
    out.beginPath(); out.rect(layer.x, layer.y, layer.w, layer.h); out.clip();
    out.translate(layer.x, layer.y); out.scale(layer.w / data.width, layer.h / data.height);
    for (const path of data.paths) {
      const duration = drawingMs * path.length / data.length;
      const local = Math.max(0, Math.min(1, (p * durationMs - cursor) / duration));
      if (local > 0) {
        const m = path.matrix;
        out.save(); out.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        out.globalAlpha *= path.opacity; out.strokeStyle = path.color; out.lineWidth = path.width;
        out.lineCap = path.cap; out.lineJoin = path.join; out.miterLimit = path.miter;
        if (local < 1) { out.setLineDash([path.length, path.length]); out.lineDashOffset = path.length * (1 - local); }
        out.stroke(path.path); out.restore();
        if (local < 1) {
          const point = path.geometry.getPointAtLength(path.length * local);
          const next = path.geometry.getPointAtLength(Math.min(path.length, path.length * local + .5));
          const x = m.a * point.x + m.c * point.y + m.e, y = m.b * point.x + m.d * point.y + m.f;
          const dx = (m.a * (next.x - point.x) + m.c * (next.y - point.y)) * layer.w / data.width;
          const dy = (m.b * (next.x - point.x) + m.d * (next.y - point.y)) * layer.h / data.height;
          pose = { x: layer.x + x * layer.w / data.width, y: layer.y + y * layer.h / data.height, angle: Math.atan2(dy, dx), dir: dx < 0 ? -1 : 1, hand: layer.hand };
        }
      }
      cursor += duration + pause;
    }
    out.restore(); return { pose };
  }
  window.InkplainerSVG = { compile, draw, clear: () => cache.clear() };
})();
