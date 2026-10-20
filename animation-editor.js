/* Scene timeline UI. Project fields live on state; transient interaction stays here. */
(function () {
  'use strict';
  const model = window.InkplainerAnimation;
  const panel = document.createElement('section');
  panel.className = 'motion-editor';
  panel.id = 'motion-editor';
  panel.setAttribute('aria-label', 'Timeline and keyframes');
  panel.innerHTML = `
    <div class="motion-toolbar">
      <button data-action="play">Play / pause</button><button data-action="back" aria-label="Previous frame">◀</button><button data-action="next" aria-label="Next frame">▶</button>
      <button data-action="edit">Edit canvas</button><output id="motion-time">0 ms</output>
      <label>FPS <input id="motion-fps" type="number" min="1" max="120" value="30"></label>
      <label>Zoom <input id="motion-zoom" type="range" min="20" max="240" value="80"></label>
      <label>Scene ms <input id="motion-duration" type="number" min="1" step="100"></label>
      <button data-action="duplicate">Duplicate scene</button><button data-action="earlier">Scene ←</button><button data-action="later">Scene →</button>
    </div><div class="motion-scroll" tabindex="0" aria-label="Object animation tracks"></div>
    <div class="motion-inspector">
      <label>Clip start ms <input id="motion-clip-start" type="number" min="0" step="1"></label>
      <label>Clip duration ms <input id="motion-clip-duration" type="number" min="1" step="1"></label>
      <label>Target <select id="motion-target"><option value="object">Selected object</option><option value="camera">Camera</option></select></label>
      <label>Property <select id="motion-property"></select></label>
      <label>Time ms <input id="motion-key-time" type="number" min="0" value="0"></label>
      <label>Value <input id="motion-key-value" type="number" step="any" value="0"></label>
      <label>Easing <select id="motion-easing"><option>linear</option><option>ease-in</option><option>ease-out</option><option>ease-in-out</option></select></label>
      <button data-action="key">Set keyframe</button><button data-action="remove-key">Delete keyframe</button>
      <label>Preset <select id="motion-preset"><option>fade</option><option>slide</option><option>pop</option><option>zoom</option><option>rotate</option><option>path</option></select></label>
      <button data-action="preset">Apply preset</button>
      <label>Path x,y;… <input id="motion-path" type="text" placeholder="0,0;100,80;200,0"></label>
      <button data-action="fit-object">Camera fit object</button><button data-action="fit-scene">Camera fit scene</button><button data-action="reset-camera">Reset camera</button>
    </div><div class="motion-keys" aria-label="Keyframes"></div>
    <div class="motion-inspector"><label>SVG order <select id="motion-svg-order"><option value="document">Document</option><option value="reverse">Reverse</option><option value="longest-first">Longest first</option></select></label>
    <label>Pen-up pause ms <input id="motion-svg-pause" type="number" min="0" value="80"></label>
    <label>Stroke units/s (0 = clip timing) <input id="motion-svg-speed" type="number" min="0" value="0"></label>
    <label>SVG fallback <select id="motion-svg-fallback"><option value="wipe">Wipe</option><option value="fade">Fade</option></select></label>
    <button data-action="svg">Use SVG strokes</button><button data-action="svg-legacy">Legacy drawing</button><output id="motion-svg-status"></output></div>`;
  document.getElementById('scene-timeline').append(panel);
  const sceneTimeline = document.getElementById('scene-timeline');
  sceneTimeline.querySelector('.scene-timeline-header').append(sceneTimeline.querySelector('.scene-timeline-add'));
  // Keep controls and their existing IDs intact while arranging them by task.
  function section(title, description, selectors) {
    const group = document.createElement('fieldset');
    group.className = 'motion-section';
    const legend = document.createElement('legend'); legend.textContent = title;
    const hint = document.createElement('p'); hint.className = 'motion-hint'; hint.textContent = description;
    const fields = document.createElement('div'); fields.className = 'motion-fields';
    for (const selector of selectors) {
      const control = panel.querySelector(selector);
      if (control) fields.append(control.closest('label') || control);
    }
    group.append(legend, hint, fields);
    return group;
  }
  const action = name => `[data-action="${name}"]`;
  const transport = section('Playback', 'Preview the scene or return to editing.', ['play', 'back', 'next', 'edit'].map(action).concat('#motion-time'));
  const sceneSettings = section('Scene', 'Set timing and organize your scenes.', ['#motion-fps', '#motion-duration', ...['duplicate', 'earlier', 'later'].map(action)]);
  const timelineTools = document.createElement('div'); timelineTools.className = 'motion-timeline-tools';
  const timelineLabel = document.createElement('span'); timelineLabel.textContent = 'Object tracks';
  timelineTools.append(timelineLabel, panel.querySelector('#motion-zoom').closest('label'));
  const inspector = document.createElement('div'); inspector.className = 'motion-sections';
  const clipSection = section('Clip timing', 'Select a track, then drag its clip or enter exact times.', ['#motion-clip-start', '#motion-clip-duration']);
  clipSection.classList.add('motion-section-hidden');
  const keySection = section('Keyframes', 'Set a property value at a specific point in time.', ['#motion-target', '#motion-property', '#motion-key-time', '#motion-key-value', '#motion-easing', action('key'), action('remove-key')]);
  keySection.append(panel.querySelector('.motion-keys'));
  const presets = section('Motion presets', 'Apply a ready-made animation to the selected object.', ['#motion-preset', action('preset'), '#motion-path']);
  const camera = section('Camera framing', 'Move the view without moving your objects.', ['fit-object', 'fit-scene', 'reset-camera'].map(action));
  const svg = section('SVG drawing', 'Trace supported strokes or choose how other artwork is revealed.', ['#motion-svg-order', '#motion-svg-pause', '#motion-svg-speed', '#motion-svg-fallback', action('svg'), action('svg-legacy'), '#motion-svg-status']);
  inspector.append(clipSection, presets, keySection, camera, svg);
  const toolbar = panel.querySelector('.motion-toolbar'); toolbar.replaceChildren(transport, sceneSettings);
  panel.querySelectorAll('.motion-inspector').forEach(element => element.remove());
  panel.querySelector('.motion-scroll').before(timelineTools);
  panel.append(inspector);
  const labels = { fps: 'Frame rate', duration: 'Duration (ms)', zoom: 'Timeline zoom', 'clip-start': 'Start (ms)', 'clip-duration': 'Duration (ms)', 'key-time': 'Key time (ms)', path: 'Path points (x,y)', 'svg-order': 'Stroke order', 'svg-pause': 'Pause (ms)', 'svg-speed': 'Speed (units/s)', 'svg-fallback': 'Fallback reveal' };
  for (const [id, label] of Object.entries(labels)) panel.querySelector(`#motion-${id}`).closest('label').firstChild.textContent = label;
  const help = {
    play: 'Play or pause the current scene. Shortcut: Space when this panel has focus.',
    back: 'Step backward by one frame at the project frame rate. Shortcut: Left arrow.',
    next: 'Step forward by one frame at the project frame rate. Shortcut: Right arrow.',
    edit: 'Stop preview and show editable objects at their base positions. Edit animated values in Keyframes.',
    duplicate: 'Copy the active scene, including its objects, animation tracks and camera settings. Undo is supported.',
    earlier: 'Move the active scene one position earlier in the project.', later: 'Move the active scene one position later in the project.',
    key: 'Add or replace the selected property keyframe at the entered time. Changes support undo and redo.',
    'remove-key': 'Delete the selected property keyframe at the entered time. Other keyframes remain unchanged.',
    'fit-object': 'Center and zoom the camera to frame the selected object at the playhead. Replaces existing camera movement.',
    'fit-scene': 'Frame all visible objects at the playhead. Replaces existing camera movement.',
    'reset-camera': 'Remove virtual camera framing and camera keyframes. Object positions are unchanged.',
    svg: 'Apply these SVG settings to the selected object. Supported strokes follow their actual paths; unsupported artwork uses the chosen fallback.',
    'svg-legacy': 'Disable SVG path tracing for this object and return to its existing drawing style.',
    fps: 'Project frames per second, from 1 to 120. Controls frame stepping and clip drag snapping; export has its own frame-rate setting.',
    duration: 'Minimum scene length in milliseconds (1000 ms = 1 second). Clips that end later extend the scene automatically.',
    zoom: 'Change how much timeline space represents one second. Scroll horizontally to reach later clips. This does not change playback speed.',
    'clip-start': 'When the selected object animation begins, measured from the scene start in milliseconds.',
    'clip-duration': 'How long the selected object animation takes, in milliseconds. The object remains visible when it finishes.',
    target: 'Choose whether keyframes change the selected object or the virtual camera.',
    property: 'Object x/y are canvas pixels, scaleX/scaleY are multipliers (1 = original), rotation is degrees, and opacity is 0–1. Camera zoom is a multiplier.',
    'key-time': 'Object keys use time from the clip start. Camera keys use time from the scene start. Enter milliseconds, or click an existing key below.',
    'key-value': 'The property value to reach at this key time. Position uses pixels, rotation uses degrees, opacity uses 0–1 and scale/zoom use multipliers.',
    easing: 'Linear keeps a constant rate. Ease-in accelerates, ease-out slows down, and ease-in-out does both. Applies from this key to the next; also used when applying SVG settings.',
    preset: 'Choose fade, slide, pop, zoom, rotate or movement along a path. Use Apply preset to update the selected object.',
    path: 'For the path preset, enter at least two canvas positions separated by semicolons, for example 0,0;100,80;200,0. The object follows straight segments between points.',
    'svg-order': 'Trace paths in document order, reverse order or longest-first order. Apply with Use SVG strokes.',
    'svg-pause': 'Pause between disconnected strokes in milliseconds. Pauses are limited to fit the clip. Apply with Use SVG strokes.',
    'svg-speed': 'SVG geometry units drawn per second. A positive value recalculates the clip duration; 0 keeps the current clip timing. Apply with Use SVG strokes.',
    'svg-fallback': 'Wipe reveals the original image from left to right; Fade increases its opacity. Used for fills and SVG features that cannot be faithfully traced.',
  };
  // Separate preset selector guidance from the action's destructive-property explanation.
  help['apply-preset'] = 'Apply this preset over the clip duration. Replaces keys for its animated properties and switches the drawing reveal to instant. Undo is available.';
  const tooltip = document.createElement('div'); tooltip.id = 'motion-tooltip'; tooltip.className = 'motion-tooltip'; tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true; document.body.append(tooltip);
  function explain(element, text) { element.dataset.tooltip = text; element.setAttribute('aria-description', text); }
  panel.querySelectorAll('[data-action]').forEach(button => explain(button, help[button.dataset.action === 'preset' ? 'apply-preset' : button.dataset.action]));
  panel.querySelectorAll('input[id], select[id]').forEach(input => explain(input, help[input.id.replace('motion-', '')]));
  explain(panel.querySelector('.motion-scroll'), 'Each row is an object. Drag a clip to change its start, drag its right edge to resize, or drag on the time ruler to scrub. Track controls select, hide or lock objects.');
  explain(panel.querySelector('#motion-time'), 'Current project playhead position in minutes and seconds.');
  let tooltipOwner = null;
  function hideTooltip() { tooltip.hidden = true; tooltipOwner?.removeAttribute('aria-describedby'); tooltipOwner = null; }
  function showTooltip(event) {
    const element = event.target.closest('[data-tooltip]');
    if (!element || !panel.contains(element) || !element.dataset.tooltip) return;
    hideTooltip(); tooltipOwner = element; tooltip.textContent = element.dataset.tooltip; tooltip.hidden = false;
    element.setAttribute('aria-describedby', tooltip.id);
    const rect = element.getBoundingClientRect();
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
    tooltip.style.top = `${Math.max(8, rect.top >= height + 12 ? rect.top - height - 8 : Math.min(innerHeight - height - 8, rect.bottom + 8))}px`;
  }
  panel.addEventListener('pointerover', showTooltip); panel.addEventListener('focusin', showTooltip);
  panel.addEventListener('pointerout', hideTooltip); panel.addEventListener('focusout', hideTooltip);
  panel.addEventListener('pointerdown', hideTooltip); panel.addEventListener('scroll', hideTooltip, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
  window.addEventListener('resize', hideTooltip);
  const $ = id => panel.querySelector(`#motion-${id}`);
  const scroll = panel.querySelector('.motion-scroll');
  let time = 0, zoom = 80, drag = null, seekFrame = null, previewing = false;
  let refreshPending = false;
  const copy = value => JSON.parse(JSON.stringify(value));
  const formatTime = ms => { const seconds = Math.floor(Math.max(0, ms) / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
  const sceneStartMs = () => getSceneStartSeconds(getActivePageIndex()) * 1000;
  function editSelection(layer) {
    if (seekFrame !== null) { cancelAnimationFrame(seekFrame); seekFrame = null; }
    controller().pause(); stopProjectAudio(); previewing = false;
    selectLayer(layer.id, { openSettings: false });
    redrawLayersOnCanvas(); drawSelectionHandles();
  }
  function controller() { return ensurePreviewController(); }
  function timeline() { return controller().renderer.compileTimeline(); }
  function enableTracks() {
    state.fps ||= 30;
    const compiled = timeline();
    state.sceneDurationMs ||= compiled.durationMs;
    compiled.items.forEach(item => {
      if (!item.layer.clip) item.layer.clip = { startMs: item.startMs, durationMs: item.animationDurationMs };
    });
    state.layers.forEach((layer, i) => {
      layer.objectId ||= crypto.randomUUID();
      layer.zIndex = i;
    });
  }
  function changed(preview = true) {
    const c = controller();
    c.completedLayerIds.clear();
    c.durationMs = c.renderer.compileTimeline().durationMs;
    scheduleAutoSave();
    renderLayerList();
    if (preview) seek(time); else redrawLayersOnCanvas();
  }
  function seek(timestamp) {
    time = Math.max(0, timestamp);
    previewing = true;
    stopProjectAudio();
    if (seekFrame !== null) return;
    seekFrame = requestAnimationFrame(() => {
      seekFrame = null;
      const c = controller();
      time = Math.min(time, c.renderer.compileTimeline().durationMs);
      c.timestampMs = time;
      c.completedLayerIds.clear();
      c.renderer.renderFrameAt(time, canvas, { includeHand: true, compositeHand: true, handContext: null });
      sctx.clearRect(0, 0, selectCanvas.width, selectCanvas.height);
      updateCursor();
    });
  }
  function updateCursor() {
    const audio = document.getElementById('project-audio-player');
    const seconds = audio && !audio.paused ? audio.currentTime : getSceneStartSeconds(getActivePageIndex()) + time / 1000;
    $('time').textContent = formatTime(seconds * 1000);
    panel.querySelectorAll('.motion-cursor, .audio-cursor').forEach(el => { el.style.left = `${seconds * zoom}px`; });
  }
  function target() {
    return $('target').value === 'camera' ? state.virtualCamera : getSelectedLayer();
  }
  function updateProperties() {
    $('property').replaceChildren(...($('target').value === 'camera' ? ['x', 'y', 'zoom'] : model.properties).map(name => new Option(name, name)));
    renderKeys();
  }
  function renderKeys() {
    const container = panel.querySelector('.motion-keys');
    container.replaceChildren();
    const property = $('property').value;
    for (const key of target()?.keyframes?.[property] || []) {
      const button = document.createElement('button');
      button.textContent = `◆ ${key.timeMs} ms: ${key.value}`;
      explain(button, `Load this ${property} keyframe into the fields and seek to its time. Change the fields and choose Set keyframe to update it.`);
      button.onclick = () => {
        $('key-time').value = key.timeMs; $('key-value').value = key.value; $('easing').value = key.easing || 'linear';
        seek(key.timeMs + ($('target').value === 'object' ? Number(getSelectedLayer()?.clip?.startMs || 0) : 0));
      };
      container.append(button);
    }
  }
  function refresh() {
    syncSceneCreationControls();
    if (drag || window.InkplainerAudioTimeline?.dragging || _pagesRestoring || _undoRestoring) return;
    const compiled = timeline();
    const duration = Math.max(getProjectDurationSeconds() * 1000, sceneStartMs() + compiled.durationMs, ...(state.audioClips || []).map(clip => clip.startMs + clip.durationMs));
    const width = Math.max(400, duration * zoom / 1000 + 100);
    const tickStep = Math.max(1, Math.ceil(60 / zoom));
    panel.style.setProperty('--motion-second-width', `${zoom}px`);
    updateRangeFill($('zoom'));
    scroll.replaceChildren();
    const ruler = document.createElement('div'); ruler.className = 'motion-ruler';
    const label = document.createElement('span'); label.className = 'motion-label'; label.textContent = 'Project time'; ruler.append(label);
    const lane = document.createElement('div'); lane.className = 'motion-lane'; lane.style.width = `${width}px`;
    for (let second = 0; second * zoom < width; second += tickStep) {
      const tick = document.createElement('span'); tick.className = 'motion-tick'; tick.style.left = `${second * zoom}px`; tick.textContent = formatTime(second * 1000); lane.append(tick);
    }
    lane.onpointerdown = event => { controller().pause({ restore: false }); lane.setPointerCapture(event.pointerId); seek((event.clientX - lane.getBoundingClientRect().left) * 1000 / zoom - sceneStartMs()); };
    lane.onpointermove = event => { if (lane.hasPointerCapture(event.pointerId)) seek((event.clientX - lane.getBoundingClientRect().left) * 1000 / zoom - sceneStartMs()); };
    ruler.append(lane); scroll.append(ruler);
    // Match the top-to-bottom order of the object layer list.
    for (const layer of [...state.layers].reverse()) {
      const item = compiled.items.find(entry => entry.layer === layer);
      const clip = layer.clip || { startMs: item?.startMs || 0, durationMs: item?.animationDurationMs || 5000 };
      const row = document.createElement('div'); row.className = `motion-track${layer.id === state.selectedLayerId ? ' selected' : ''}`;
      const heading = document.createElement('div'); heading.className = 'motion-label';
      const name = document.createElement('button'); name.className = 'motion-name'; name.textContent = layer.name; name.onclick = () => editSelection(layer);
      explain(name, `Select ${layer.name} on the canvas and timeline to edit its clip and keyframes.`);
      heading.append(name);
      for (const [key, text] of [['visible', layer.visible === false ? '○' : '●'], ['locked', layer.locked ? '🔒' : '◇']]) {
        const button = document.createElement('button'); button.textContent = text; button.setAttribute('aria-label', `${key === 'visible' ? 'Toggle visibility' : 'Toggle lock'} ${layer.name}`);
        explain(button, key === 'visible' ? 'Show or hide this object in the canvas, preview and export. Its animation settings are retained.' : 'Lock or unlock this track to prevent clip dragging and canvas manipulation.');
        button.onclick = () => { pushUndoSnapshot(); layer[key] = key === 'visible' ? layer.visible === false : !layer.locked; changed(); }; heading.append(button);
      }
      const track = document.createElement('div'); track.className = 'motion-lane'; track.style.width = `${width}px`;
      const block = document.createElement('button'); block.className = 'motion-clip'; block.dataset.layerId = layer.id;
      block.setAttribute('aria-label', `Animation clip ${layer.name}`); block.style.left = `${(sceneStartMs() + clip.startMs) * zoom / 1000}px`; block.style.width = `${clip.durationMs * zoom / 1000}px`;
      explain(block, 'Drag to change when this animation starts. Drag its right edge to change duration. Timing snaps to project frames.');
      block.textContent = formatTime(clip.durationMs);
      block.onclick = event => { if (event.detail === 0) editSelection(layer); };
      const resize = document.createElement('span'); resize.className = 'motion-resize'; resize.setAttribute('aria-label', 'Resize duration'); block.append(resize);
      block.onpointerdown = event => {
        if (layer.locked || event.button !== 0) return;
        event.preventDefault(); controller().pause({ restore: false });
        editSelection(layer);
        drag = { layer, block, x: event.clientX, initial: { ...clip }, resize: event.target === resize, moved: false };
        block.setPointerCapture(event.pointerId);
      };
      block.onpointermove = event => {
        if (!drag || drag.block !== block) return;
        if (!drag.moved) {
          if (Math.abs(event.clientX - drag.x) < 3) return;
          pushUndoSnapshot(); enableTracks(); drag.moved = true;
        }
        const delta = (event.clientX - drag.x) * 1000 / zoom;
        const snap = value => Math.round(value * state.fps / 1000) * 1000 / state.fps;
        if (drag.resize) layer.clip.durationMs = Math.max(1000 / state.fps, snap(drag.initial.durationMs + delta));
        else layer.clip.startMs = Math.max(0, snap(drag.initial.startMs + delta));
        block.style.left = `${(sceneStartMs() + layer.clip.startMs) * zoom / 1000}px`; block.style.width = `${layer.clip.durationMs * zoom / 1000}px`;
      };
      const finish = () => { if (!drag || drag.block !== block) return; const moved = drag.moved; drag = null; if (moved) changed(false); else refresh(); };
      block.onpointerup = finish; block.onpointercancel = finish;
      track.append(block); row.append(heading, track); scroll.append(row);
    }
    window.InkplainerAudioTimeline?.render(scroll, zoom, { width, tickStep, formatTime });
    panel.querySelectorAll('.audio-lane').forEach(lane => { const cursor = document.createElement('span'); cursor.className = 'audio-cursor'; lane.append(cursor); });
    panel.querySelectorAll('.motion-lane').forEach(lane => { const cursor = document.createElement('span'); cursor.className = 'motion-cursor'; lane.append(cursor); });
    $('fps').value = state.fps || 30; $('duration').value = state.sceneDurationMs || compiled.durationMs;
    const selected = getSelectedLayer();
    const selectedItem = compiled.items.find(item => item.layer === selected);
    $('clip-start').value = selected?.clip?.startMs ?? selectedItem?.startMs ?? 0;
    $('clip-duration').value = selected?.clip?.durationMs ?? selectedItem?.animationDurationMs ?? 1000;
    updateCursor(); renderKeys();
  }
  function queueRefresh() {
    if (refreshPending) return;
    refreshPending = true;
    requestAnimationFrame(() => { refreshPending = false; refresh(); });
  }
  $('zoom').oninput = () => { zoom = Number($('zoom').value); refresh(); };
  $('fps').onchange = () => { pushUndoSnapshot(); state.fps = Math.max(1, Math.min(120, Number($('fps').value) || 30)); (state.pages || []).forEach(scene => { scene.fps = state.fps; }); changed(false); };
  $('duration').onchange = () => { pushUndoSnapshot(); enableTracks(); state.sceneDurationMs = Math.max(1, Number($('duration').value) || 1); changed(); };
  for (const [id, property, min] of [['clip-start', 'startMs', 0], ['clip-duration', 'durationMs', 1]]) {
    $(id).onchange = () => { const layer = getSelectedLayer(); if (!layer || layer.locked) return; pushUndoSnapshot(); enableTracks(); layer.clip[property] = Math.max(min, Number($(id).value) || min); changed(); };
  }
  $('target').onchange = updateProperties; $('property').onchange = renderKeys;
  panel.addEventListener('click', async event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'play') { previewing = true; const c = controller(); if (c.playing) { c.pause({ restore: false }); stopProjectAudio(); } else { state._usingLegacyAnimation = false; await c.play(); playProjectAudio(getSceneStartSeconds(getActivePageIndex()) + c.timestampMs / 1000); } return; }
    if (action === 'back' || action === 'next') { controller().pause({ restore: false }); seek(time + (action === 'back' ? -1 : 1) * 1000 / (state.fps || 30)); return; }
    if (action === 'edit') { stopProjectAudio(); controller().pause(); previewing = false; redrawLayersOnCanvas(); drawSelectionHandles(); return; }
    if (action === 'duplicate' || action === 'earlier' || action === 'later') {
      if (_pagesRestoring || (action === 'duplicate' && state.infiniteCanvas)) return;
      pushUndoSnapshot(); persistActivePageToMemory();
      const index = getActivePageIndex();
      if (action === 'duplicate') {
        const scene = copy(state.pages[index]); scene.id = Date.now(); scene.name += ' copy';
        scene.layers.forEach(layer => { layer.objectId = crypto.randomUUID(); });
        state.pages.splice(index + 1, 0, scene); switchPage(scene.id);
      } else {
        const to = Math.max(0, Math.min(state.pages.length - 1, index + (action === 'earlier' ? -1 : 1)));
        const [scene] = state.pages.splice(index, 1); state.pages.splice(to, 0, scene);
      }
      renderPagesList(); scheduleAutoSave(); return;
    }
    const layer = getSelectedLayer();
    if (['preset', 'fit-object', 'svg', 'svg-legacy'].includes(action) && !layer) { showToast('Select an object first'); return; }
    if (['preset', 'svg', 'svg-legacy'].includes(action) && layer.locked) { showToast('Unlock the object first'); return; }
    if (['key', 'remove-key'].includes(action) && $('target').value === 'object' && (!layer || layer.locked)) { showToast('Select an unlocked object first'); return; }
    let path;
    if (action === 'preset' && $('preset').value === 'path') {
      path = $('path').value.split(';').map(point => { const [x, y] = point.split(',').map(Number); return { x, y }; });
      if (path.length < 2 || path.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) { showToast('Enter at least two x,y points separated by semicolons'); return; }
    }
    pushUndoSnapshot(); enableTracks();
    if (action === 'key' || action === 'remove-key') {
      if ($('target').value === 'camera') state.virtualCamera ||= model.cameraAt(null, 0, state.canvasW, state.canvasH);
      const object = target(), property = $('property').value, keyTime = Math.max(0, Number($('key-time').value) || 0);
      object.keyframes ||= {}; object.keyframes[property] = (object.keyframes[property] || []).filter(key => key.timeMs !== keyTime);
      if (action === 'key') object.keyframes[property].push({ timeMs: keyTime, value: Number($('key-value').value) || 0, easing: $('easing').value });
      object.keyframes[property].sort((a, b) => a.timeMs - b.timeMs);
    } else if (action === 'svg') {
      layer.svgDrawing = { enabled: true, order: $('svg-order').value, pauseMs: Math.max(0, Number($('svg-pause').value) || 0), speed: Math.max(0, Number($('svg-speed').value) || 0), fallback: $('svg-fallback').value, easing: $('easing').value };
      const data = InkplainerSVG.compile(layer.imageDataURL || layer.img.src, layer.svgDrawing);
      $('svg-status').textContent = data.supported ? `${data.paths.length} drawable strokes` : data.reason;
      if (data.supported && layer.svgDrawing.speed > 0) layer.clip.durationMs = data.length / layer.svgDrawing.speed * 1000 + layer.svgDrawing.pauseMs * (data.paths.length - 1);
      layer.reviewStrategy = 'draw';
    } else if (action === 'svg-legacy') delete layer.svgDrawing;
    else if (action === 'preset') {
      layer.keyframes = { ...layer.keyframes, ...model.preset($('preset').value, layer, layer.clip.durationMs, path) };
      layer.reviewStrategy = 'instant';
    } else if (action === 'fit-object' || action === 'fit-scene') state.virtualCamera = model.fitCamera(action === 'fit-object' ? [layer] : state.layers, state.canvasW, state.canvasH, 32, time);
    else if (action === 'reset-camera') state.virtualCamera = null;
    changed();
  });
  // Scrub preview is read-only; return to the editable workspace before pointer gestures.
  selectCanvas.addEventListener('mousedown', () => {
    if (previewing && !state.playing) { previewing = false; redrawLayersOnCanvas(); drawSelectionHandles(); }
  }, true);
  panel.addEventListener('keydown', event => {
    if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); panel.querySelector('[data-action="play"]').click(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); panel.querySelector(`[data-action="${event.key === 'ArrowLeft' ? 'back' : 'next'}"]`).click(); }
  });
  const originalRenderList = renderLayerList;
  renderLayerList = function (...args) { const result = originalRenderList(...args); queueRefresh(); return result; };
  function playbackTick() { if (previewController?.playing) time = previewController.timestampMs; updateCursor(); requestAnimationFrame(playbackTick); }
  updateProperties(); queueRefresh(); requestAnimationFrame(playbackTick);
  window.InkplainerTimeline = { refresh, seek, enableTracks, get timeMs() { return time; } };
})();
