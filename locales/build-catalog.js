const fs = require('node:fs');

const repairs = new Map([
  ['Ã¡', 'á'], ['Ã©', 'é'], ['Ã­', 'í'], ['Ã³', 'ó'], ['Ãº', 'ú'],
  ['Ã±', 'ñ'], ['Ã£', 'ã'], ['Ãµ', 'õ'], ['Ã§', 'ç'], ['Ã‰', 'É'],
  ['Ãš', 'Ú'], ['Ã‘', 'Ñ'], ['Ã“', 'Ó'], ['Â·', '·'], ['â€”', '—'],
  ['â€“', '–'], ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€', '”'],
  ['â€¦', '…'], ['â†’', '→'], ['â†', '←'], ['â†“', '↓'], ['â†‘', '↑'],
  ['âœ“', '✓'], ['âœ', '✏'], ['âš ', '⚠'], ['â–¶', '▶'], ['â–¼', '▼'],
  ['â–­', '▭'], ['âŠž', '⊞'], ['ðŸŒ«', '🌫'],
]);
const repair = value => {
  for (const [broken, fixed] of repairs) value = value.replaceAll(broken, fixed);
  return value;
};
const translations = {};
for (const source of ['ui.tsv', 'docs.tsv']) {
  for (const line of fs.readFileSync(`${__dirname}/${source}`, 'utf8').split(/\r?\n/)) {
    const [key, portuguese, spanish] = line.split('\t');
    if (key && portuguese && spanish) translations[repair(key)] = [repair(portuguese), repair(spanish)];
  }
}
Object.assign(translations, {
  'InkMotion Studio — Whiteboard Animation Workspace': [
    'InkMotion Studio — Espaço de Animação de Quadro Branco',
    'InkMotion Studio — Espacio de Animación de Pizarra',
  ],
  'InkMotion Studio is a focused whiteboard animation workspace for building multi-scene explainer videos with reusable media, audio, and project accounts.': [
    'O InkMotion Studio é um espaço de animação de quadro branco para criar vídeos explicativos com várias cenas, mídia reutilizável, áudio e contas de projeto.',
    'InkMotion Studio es un espacio de animación de pizarra para crear videos explicativos con varias escenas, recursos reutilizables, audio y cuentas de proyecto.',
  ],
  'Full documentation for Inkplainer. Learn how to use layers, animation styles, drawing controls, export settings, and everything else the app offers.': [
    'Documentação completa do Inkplainer. Aprenda a usar camadas, estilos de animação, controles de desenho, configurações de exportação e todos os recursos do aplicativo.',
    'Documentación completa de Inkplainer. Aprende a usar capas, estilos de animación, controles de dibujo, ajustes de exportación y todas las funciones de la aplicación.',
  ],
});
fs.writeFileSync(`${__dirname}/catalog.js`, `window.INKMOTION_TRANSLATIONS = ${JSON.stringify(translations)};\n`);
console.log(`Built locale catalog with ${Object.keys(translations).length} entries.`);
