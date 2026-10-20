/* GIF89a frame decoding, independent of browser image-animation clocks. */
(() => {
  'use strict';
  const records = new WeakMap();
  const source = image => typeof image === 'string' ? image : image?.src || '';
  const isGif = image => {
    const src = source(image);
    return src.startsWith('data:')
      ? /^data:(?:image\/gif[;,]|[^,]*;base64,R0lGOD)/i.test(src.slice(0, 100))
      : /\.gif(?:$|[?#])/i.test(src);
  };

  function unpack(data, minimum, count) {
    if (minimum < 2 || minimum > 8) throw new Error('Invalid GIF code size');
    const clear = 1 << minimum, end = clear + 1;
    let table, size, next, previous, bit = 0, written = 0;
    const output = new Uint8Array(count);
    const reset = () => { table = Array.from({ length: clear }, (_, i) => [i]); size = minimum + 1; next = end + 1; previous = null; };
    reset();
    while (bit + size <= data.length * 8) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === end) break;
      const entry = table[code] || (code === next && previous ? [...previous, previous[0]] : null);
      if (!entry || written + entry.length > count) throw new Error('Invalid GIF image data');
      output.set(entry, written); written += entry.length;
      if (previous && next < 4096) {
        table[next++] = [...previous, entry[0]];
        if (next === 1 << size && size < 12) size++;
      }
      previous = entry;
    }
    if (written !== count) throw new Error('Incomplete GIF image data');
    return output;
  }

  async function decode(bytes) {
    let p = 0;
    const take = n => { if (p + n > bytes.length) throw new Error('Incomplete GIF file'); const part = bytes.subarray(p, p + n); p += n; return part; };
    const byte = () => take(1)[0];
    const word = () => { const b = take(2); return b[0] | b[1] << 8; };
    const blocks = () => { const parts = []; let n; while ((n = byte())) parts.push(...take(n)); return new Uint8Array(parts); };
    if (!/^GIF8[79]a$/.test(String.fromCharCode(...take(6)))) throw new Error('Not a GIF file');
    const width = word(), height = word(), packed = byte(), background = byte(); byte();
    if (!width || !height || width * height > 16777216) throw new Error('GIF dimensions are too large');
    const globalTable = packed & 128 ? take(3 * (1 << ((packed & 7) + 1))) : null;
    const surface = document.createElement('canvas'); surface.width = width; surface.height = height;
    const ctx = surface.getContext('2d', { willReadFrequently: true });
    const frames = [];
    let durationMs = 0, loops = 1, control = { disposal: 0, delay: 100, transparent: -1 };
    while (p < bytes.length) {
      const marker = byte();
      if (marker === 0x3b) break;
      if (marker === 0x21) {
        const kind = byte();
        if (kind === 0xf9) {
          if (byte() !== 4) throw new Error('Invalid GIF control block');
          const flags = byte(), delay = word(), transparent = byte(); byte();
          control = { disposal: (flags >> 2) & 7, delay: delay < 2 ? 100 : delay * 10, transparent: flags & 1 ? transparent : -1 };
        } else if (kind === 0xff) {
          const name = String.fromCharCode(...take(byte())), extension = blocks();
          if (/^(NETSCAPE2.0|ANIMEXTS1.0)$/.test(name) && extension[0] === 1) {
            const repeats = extension[1] | extension[2] << 8; loops = repeats ? repeats + 1 : Infinity;
          }
        } else { blocks(); if (kind === 0x01) control = { disposal: 0, delay: 100, transparent: -1 }; }
        continue;
      }
      if (marker !== 0x2c) throw new Error('Invalid GIF block');
      const x = word(), y = word(), w = word(), h = word(), flags = byte();
      if (!w || !h || w * h > 16777216) throw new Error('Invalid GIF frame dimensions');
      if ((frames.length + 1) * width * height * 4 > 256 * 1024 * 1024) throw new Error('GIF is too large to animate. Use a smaller GIF.');
      const palette = flags & 128 ? take(3 * (1 << ((flags & 7) + 1))) : globalTable;
      if (!palette) throw new Error('GIF has no color table');
      const minimum = byte(), pixels = unpack(blocks(), minimum, w * h);
      const clearBackground = () => {
        ctx.clearRect(x, y, w, h);
        if (control.transparent < 0 && globalTable) {
          ctx.fillStyle = `rgb(${globalTable[background * 3]},${globalTable[background * 3 + 1]},${globalTable[background * 3 + 2]})`;
          ctx.fillRect(x, y, w, h);
        }
      };
      if (!frames.length && control.transparent < 0 && globalTable) {
        ctx.fillStyle = `rgb(${globalTable[background * 3]},${globalTable[background * 3 + 1]},${globalTable[background * 3 + 2]})`;
        ctx.fillRect(0, 0, width, height);
      }
      const previous = control.disposal === 3 ? ctx.getImageData(0, 0, width, height) : null;
      const patch = ctx.createImageData(w, h), rows = [];
      if (flags & 64) {
        for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let row = start; row < h; row += step) rows.push(row);
      } else for (let row = 0; row < h; row++) rows.push(row);
      for (let i = 0; i < pixels.length; i++) {
        const color = pixels[i];
        if (color === control.transparent) continue;
        if (color * 3 + 2 >= palette.length) throw new Error('Invalid GIF color');
        const offset = (rows[Math.floor(i / w)] * w + i % w) * 4;
        patch.data.set(palette.subarray(color * 3, color * 3 + 3), offset); patch.data[offset + 3] = 255;
      }
      const tile = document.createElement('canvas'); tile.width = w; tile.height = h;
      tile.getContext('2d').putImageData(patch, 0, 0); ctx.drawImage(tile, x, y);
      const frame = document.createElement('canvas'); frame.width = width; frame.height = height;
      frame.getContext('2d').drawImage(surface, 0, 0);
      durationMs += control.delay; frames.push({ image: frame, endMs: durationMs });
      if (control.disposal === 2) clearBackground();
      else if (previous) ctx.putImageData(previous, 0, 0);
      control = { disposal: 0, delay: 100, transparent: -1 };
      if (frames.length % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!frames.length) throw new Error('GIF has no frames');
    return { frames, durationMs, loops };
  }

  function prepare(image) {
    if (!isGif(image)) return Promise.resolve(null);
    const src = source(image);
    let record = records.get(image);
    if (record?.src === src) return record.promise;
    record = { src, animation: null, error: null }; records.set(image, record);
    record.promise = (async () => {
      const response = await fetch(src);
      if (!response.ok) throw new Error('Could not load GIF');
      record.animation = await decode(new Uint8Array(await response.arrayBuffer()));
      record.startedAt = performance.now();
      return record.animation;
    })().catch(error => { record.error = error; throw error; });
    return record.promise;
  }
  function frame(image, timeMs) {
    const animation = records.get(image)?.animation;
    if (!animation) return image;
    const { frames, durationMs, loops } = animation;
    const time = Math.max(0, timeMs ?? (performance.now() - records.get(image).startedAt));
    if (time >= durationMs * loops) return frames.at(-1).image;
    const local = time % durationMs;
    return (frames.find(item => local < item.endMs) || frames.at(-1)).image;
  }
  window.InkplainerGif = { isGif, prepare, frame, decode };
})();
