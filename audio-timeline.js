/* Project audio clips. A rendered WAV keeps preview and all export paths in sync. */
(() => {
  'use strict';
  const buffers = new Map();
  const imports = new Set(), failedMigrations = new Set();
  let rebuilding = 0;
  let context, revision = 0, selected = null, dragging = false, pending = Promise.resolve();
  const speedOf = clip => Math.max(0.25, Math.min(4, Number(clip.speed) || 1));
  let popup = null, popupClip = null, popupAnchor = null;
  function closePopup() {
    // Commit an edited number before removing its focused input on outside click.
    if (popup?.contains(document.activeElement)) document.activeElement.blur();
    popup?.remove(); popup = null; popupClip = null; popupAnchor = null;
  }
  function selectClip(clip, element) {
    closePopup(); selected = clip; popupAnchor = element.getBoundingClientRect();
    document.querySelectorAll('.audio-track').forEach(row => {
      const active = row.dataset.audioId === clip.id;
      row.classList.toggle('selected', active);
      row.querySelector('.audio-clip')?.setAttribute('aria-pressed', String(active));
    });
    renderPopup();
  }
  document.addEventListener('pointerdown', event => {
    if (popup && !popup.contains(event.target)) closePopup();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePopup(); });
  window.addEventListener('resize', closePopup);
  // Browser auto-scrolling a clip into view can finish after its click event.
  // Follow the selected clip instead of immediately dismissing its new popup.
  document.addEventListener('scroll', () => { if (popup) positionPopup(); }, true);
  function positionPopup() {
    if (!popup || !popupAnchor) return;
    const row = [...document.querySelectorAll('.audio-track')].find(el => el.dataset.audioId === selected?.id);
    const anchor = row?.querySelector('.audio-clip');
    const rect = anchor?.getBoundingClientRect() || popupAnchor;
    const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - box.width - 8))}px`;
    const top = rect.top - box.height - 8;
    popup.style.top = `${Math.max(8, top >= 8 ? Math.min(top, innerHeight - box.height - 8) : Math.min(rect.bottom + 8, innerHeight - box.height - 8))}px`;
  }
  const input = document.getElementById('audio-input');
  const read = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  async function decode(clip) {
    if (!buffers.has(clip.dataURL)) {
      context ||= new AudioContext();
      const pending = fetch(clip.dataURL).then(r => r.arrayBuffer()).then(bytes => context.decodeAudioData(bytes));
      buffers.set(clip.dataURL, pending);
      pending.catch(() => buffers.delete(clip.dataURL));
    }
    return buffers.get(clip.dataURL);
  }
  function clips() { return state.audioClips ||= []; }
  function refresh() { window.InkplainerTimeline?.refresh(); }
  async function migrate() {
    if (clips().length || !state.audio?.dataURL) return;
    const old = state.audio;
    const buffer = await decode(old);
    if (state.audio !== old || clips().length) return;
    clips().push({ ...old, id: crypto.randomUUID(), startMs: 0, offsetMs: 0, durationMs: buffer.duration * 1000, sourceDurationMs: buffer.duration * 1000, volume: 1 });
  }
  async function wav(buffer) {
    const frames = buffer.length, channels = buffer.numberOfChannels;
    const bytes = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(bytes);
    const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
    const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
    for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(44 + (i * channels + c) * 2, sample * (sample < 0 ? 32768 : 32767), true);
    }
    return read(new Blob([bytes], { type: 'audio/wav' }));
  }
  function commit() {
    rebuilding++;
    pending = rebuild().finally(() => { rebuilding--; });
    return pending;
  }
  async function rebuild() {
    const version = ++revision, source = clips(), snapshot = source.map(c => ({ ...c }));
    stopProjectAudio();
    const decoded = await Promise.all(snapshot.map(decode));
    let audio = null;
    if (snapshot.length) {
      const seconds = Math.max(getProjectDurationSeconds(), ...snapshot.map(c => (c.startMs + c.durationMs) / 1000), 0.01);
      const mix = new OfflineAudioContext(2, Math.ceil(seconds * 44100), 44100);
      snapshot.forEach((clip, i) => {
        const node = mix.createBufferSource(), gain = mix.createGain();
        node.buffer = decoded[i]; gain.gain.value = clip.volume ?? 1;
        node.playbackRate.value = speedOf(clip);
        node.connect(gain).connect(mix.destination);
        node.start(clip.startMs / 1000, clip.offsetMs / 1000, clip.durationMs * speedOf(clip) / 1000);
      });
      audio = { name: 'Timeline audio.wav', type: 'audio/wav', dataURL: await wav(await mix.startRendering()) };
    }
    if (version !== revision || source !== state.audioClips) return;
    state.audio = audio;
    renderAudioControls();
    refresh();
    saveProjectNow();
  }
  function report(error) { console.error(error); alert('Unable to prepare audio. Please use a supported audio file or a shorter clip.'); }
  function upload(files) {
    const job = importFiles(files);
    imports.add(job);
    job.finally(() => imports.delete(job)).catch(() => {});
    return job;
  }
  async function ready() {
    let current;
    do {
      current = pending;
      await Promise.all([current, ...imports]);
    } while (current !== pending || imports.size);
  }
  function restore() {
    revision++;
    pending = Promise.resolve();
    closePopup(); selected = null;
    if (clips().length) commit().catch(report);
  }
  async function importFiles(files) {
    try { await migrate(); } catch (error) {
      if (state.audio?.dataURL) failedMigrations.add(state.audio.dataURL);
      console.warn('Existing audio could not be decoded; importing new files', error);
    }
    const destination = clips();
    const startMs = (getSceneStartSeconds(getActivePageIndex()) * 1000) + (window.InkplainerTimeline?.timeMs || 0);
    const added = [], failures = [];
    for (const file of files) {
      try {
        const clip = { id: crypto.randomUUID(), name: file.name, type: file.type, dataURL: await read(file), startMs, offsetMs: 0, volume: 1 };
        const buffer = await decode(clip);
        clip.durationMs = clip.sourceDurationMs = buffer.duration * 1000;
        added.push(clip);
      } catch { failures.push(file.name); }
    }
    if (destination !== state.audioClips) return;
    destination.push(...added);
    refresh();
    if (added.length) await commit();
    if (failures.length) alert(`Could not read: ${failures.join(', ')}`);
  }
  input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; upload(files).catch(report); });
  function renderPopup() {
    const all = clips();
    if (popup && !all.includes(popupClip)) closePopup();
    if (all.includes(selected) && popupAnchor && !popup) {
      const controls = document.createElement('div'); controls.className = 'audio-selection-controls';
      controls.setAttribute('role', 'dialog'); controls.setAttribute('aria-label', `Audio settings for ${selected.name}`);
      controls.addEventListener('keydown', event => event.stopPropagation());
      controls.addEventListener('keydown', event => { if (event.key === 'Escape') closePopup(); });
      for (const [key, text, min, max, step, value] of [
        ['volume', 'Audio volume (%)', 0, 200, 10, (selected.volume ?? 1) * 100],
        ['speed', 'Audio speed (×)', 0.25, 4, 0.25, speedOf(selected)],
      ]) {
        const clip = selected, label = document.createElement('label'), field = document.createElement('input');
        label.textContent = text; field.type = 'number'; field.min = min; field.max = max; field.step = step; field.value = value;
        field.onchange = () => {
          if (!Number.isFinite(field.valueAsNumber)) { field.value = key === 'speed' ? speedOf(clip) : (clip.volume ?? 1) * 100; return; }
          const next = Math.max(min, Math.min(max, field.valueAsNumber));
          if (key === 'speed') { clip.durationMs = clip.durationMs * speedOf(clip) / next; clip.speed = next; }
          else clip.volume = next / 100;
          field.value = next;
          commit().catch(report);
        };
        label.append(field); controls.append(label);
      }
      document.body.append(controls); popup = controls; popupClip = selected;
      positionPopup();
    }
  }
  function render(host, zoom, { width, tickStep, formatTime }) {
    if (dragging) return;
    const all = clips();
    const legacyURL = state.audio?.dataURL;
    if (!all.length && legacyURL && !rebuilding && !failedMigrations.has(legacyURL)) {
      migrate().then(refresh).catch(error => {
        failedMigrations.add(legacyURL);
        console.warn('Unable to load legacy audio into the timeline', error);
      });
    }
    const tools = document.createElement('div'); tools.className = 'audio-timeline-tools';
    const add = document.createElement('button'); add.textContent = '+ Add audio'; add.onclick = () => input.click();
    const hint = document.createElement('span'); hint.textContent = 'Project audio · Drop multiple files here · Drag clips or trim their edges';
    tools.append(add, hint); host.append(tools);
    host.ondragover = e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
    host.ondrop = e => { e.preventDefault(); upload([...e.dataTransfer.files]).catch(report); };
    renderPopup();
    const ruler = document.createElement('div'); ruler.className = 'motion-ruler';
    const heading = document.createElement('span'); heading.className = 'motion-label'; heading.textContent = 'Project time';
    const scale = document.createElement('div'); scale.className = 'audio-lane'; scale.style.width = `${width}px`;
    for (let s = 0; s * zoom < width; s += tickStep) { const tick = document.createElement('span'); tick.className = 'motion-tick'; tick.style.left = `${s * zoom}px`; tick.textContent = formatTime(s * 1000); scale.append(tick); }
    ruler.append(heading, scale); host.append(ruler);
    for (const clip of all) {
      const row = document.createElement('div'); row.className = 'motion-track audio-track'; row.dataset.audioId = clip.id;
      row.classList.toggle('selected', selected === clip);
      const label = document.createElement('div'); label.className = 'motion-label';
      const name = document.createElement('button'); name.className = 'motion-name'; name.textContent = clip.name; name.title = clip.name;
      name.onclick = () => selectClip(clip, name);
      const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', `Remove audio ${clip.name}`);
      remove.onclick = () => { state.audioClips = clips().filter(c => c.id !== clip.id); commit().catch(report); refresh(); };
      label.append(name, remove);
      const lane = document.createElement('div'); lane.className = 'audio-lane'; lane.style.width = `${width}px`;
      const block = document.createElement('button'); block.className = 'motion-clip audio-clip'; block.setAttribute('aria-label', `Audio clip ${clip.name}`);
      block.setAttribute('aria-pressed', String(selected === clip));
      block.onclick = event => { if (event.detail === 0) selectClip(clip, block); };
      block.title = `${clip.name} — drag to move, drag edges to trim`;
      const paint = () => { block.style.left = `${clip.startMs * zoom / 1000}px`; block.style.width = `${Math.max(8, clip.durationMs * zoom / 1000)}px`; };
      paint();
      const wave = document.createElement('canvas'); wave.width = 600; wave.height = 24; block.append(wave);
      decode(clip).then(buffer => {
        const ctx = wave.getContext('2d');
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
        ctx.fillStyle = '#ffffffbb';
        const start = Math.floor(clip.offsetMs * buffer.sampleRate / 1000), length = Math.floor(clip.durationMs * speedOf(clip) * buffer.sampleRate / 1000);
        for (let x = 0; x < 600; x += 2) {
          let peak = 0; const from = start + Math.floor(x / 600 * length), end = Math.min(buffer.length, start + Math.ceil((x + 2) / 600 * length));
          for (const data of channels) for (let i = from; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
          ctx.fillRect(x, 12 - peak * 11, 1, Math.max(1, peak * 22));
        }
      }).catch(report);
      const left = document.createElement('span'), right = document.createElement('span');
      left.className = 'motion-resize audio-trim-start'; right.className = 'motion-resize'; block.append(left, right);
      let gesture;
      block.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); stopProjectAudio(); selected = clip; dragging = true; gesture = { x: e.clientX, original: { ...clip }, edge: e.target === left ? 'left' : e.target === right ? 'right' : 'move' }; block.setPointerCapture(e.pointerId); };
      block.onpointermove = e => {
        if (!gesture) return;
        const { original: o, edge } = gesture;
        const frame = 1000 / (state.fps || 30), delta = Number((Math.round((e.clientX - gesture.x) * 1000 / zoom / frame) * frame).toFixed(3));
        if (edge === 'move') clip.startMs = Math.max(0, o.startMs + delta);
        if (edge === 'right') clip.durationMs = Math.max(1, Math.min((o.sourceDurationMs - o.offsetMs) / speedOf(o), o.durationMs + delta));
        if (edge === 'left') { const d = Math.max(-o.offsetMs / speedOf(o), -o.startMs, Math.min(o.durationMs - 1, delta)); clip.startMs = o.startMs + d; clip.offsetMs = o.offsetMs + d * speedOf(o); clip.durationMs = o.durationMs - d; }
        paint();
      };
      const finish = () => {
        if (!gesture) return;
        const original = gesture.original;
        const changed = clip.startMs !== original.startMs || clip.offsetMs !== original.offsetMs || clip.durationMs !== original.durationMs;
        gesture = null; dragging = false;
        selectClip(clip, block);
        if (changed) { refresh(); commit().catch(report); }
      };
      block.onpointerup = finish; block.onpointercancel = finish; block.onlostpointercapture = finish;
      lane.append(block); row.append(label, lane); host.append(row);
    }
  }
  window.InkplainerAudioTimeline = { render, upload, commit, restore, ready, get dragging() { return dragging; } };
})();
