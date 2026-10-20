import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../../', import.meta.url);

test('application scripts and inline editor scripts parse without a bundler', () => {
  for (const file of ['server.js', 'home.js', 'animations.js', 'animation-model.js', 'animation-editor.js', 'audio-timeline.js', 'svg-drawing.js', 'gif-animation.js', 'i18n.js', 'locales/catalog.js', 'locales/build-catalog.js']) {
    assert.doesNotThrow(() => new Script(readFileSync(new URL(file, root), 'utf8'), { filename: file }));
  }
  for (const file of ['index.html', 'studio.html', 'pages/docs.html', 'images/Coordinate Mapper Tool/Coordinate Mapper Tool.html']) {
    const html = readFileSync(new URL(file, root), 'utf8');
    for (const [index, match] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].entries()) {
      if (/\bsrc\s*=|\btype\s*=\s*['"]application\//i.test(match[1])) continue;
      assert.doesNotThrow(() => new Script(match[2], { filename: `${file}:script-${index}` }));
    }
  }
});
