(() => {
  'use strict';
  const languages = ['en', 'pt', 'es'];
  let language = location.pathname.match(/^\/(en|pt|es)(?:\/|$)/)?.[1] || 'en';
  const originals = new WeakMap();
  const attributes = new WeakMap();
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  const excluded = 'script,style,svg,code,pre,textarea,[contenteditable],[data-no-translate],.layer-name,.project-name,.scene-name,.asset-name,#project-name,#audio-name,#text-editor';
  function pathWithoutLanguage(path = location.pathname) {
    return path.replace(/^\/(en|pt|es)(?=\/|$)/, '') || '/';
  }
  function url(path, lang = language) {
    if (location.protocol === 'file:' || !path || path.startsWith('#')) return path;
    const parsed = new URL(path, location.origin);
    if (parsed.origin !== location.origin) return path;
    let route = pathWithoutLanguage(parsed.pathname);
    if (route === '/index.html') route = '/';
    if (route === '/studio.html') route = '/studio';
    if (route === '/pages/docs.html') route = '/docs';
    if (!(route === '/' || route === '/docs' || route.startsWith('/studio'))) return path;
    return `/${lang}${route === '/' ? '' : route}${parsed.search}${parsed.hash}`;
  }
  function translate(value) {
    if (language === 'en' || !value) return value;
    const key = normalize(value);
    const entry = window.INKMOTION_TRANSLATIONS?.[key];
    let result = entry?.[language === 'pt' ? 0 : 1];
    if (result == null) {
      for (const [pattern, pt, es] of window.INKMOTION_PATTERNS || []) {
        const match = key.match(new RegExp(pattern));
        if (match) { result = key.replace(new RegExp(pattern), language === 'pt' ? pt : es); break; }
      }
    }
    if (result == null) return value;
    return value.replace(/\S[\s\S]*\S|\S/, result);
  }
  function translateText(node) {
    if (!node.parentElement || node.parentElement.closest(excluded)) return;
    const previous = originals.get(node);
    const source = previous && node.data === previous.result ? previous.source : node.data;
    const result = translate(source);
    originals.set(node, { source, result });
    if (node.data !== result) node.data = result;
  }
  function translateElement(element) {
    if (element.closest(excluded)) return;
    const records = attributes.get(element) || {};
    for (const name of ['title', 'placeholder', 'aria-label', 'alt', ...(element.matches('meta[name="description"]') ? ['content'] : [])]) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name);
      const source = records[name]?.result === current ? records[name].source : current;
      const result = translate(source);
      records[name] = { source, result };
      if (current !== result) element.setAttribute(name, result);
    }
    attributes.set(element, records);
    if (element.matches('a[href]')) {
      const href = element.getAttribute('href');
      const localized = url(href);
      if (localized !== href) element.setAttribute('href', localized);
    }
  }
  function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) return translateText(root);
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(excluded)) return;
    translateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) translateText(node);
      else translateElement(node);
    }
  }
  function updateLanguage(lang) {
    if (!languages.includes(lang)) return;
    language = lang;
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang;
    try { localStorage.setItem('inkmotion.language', lang); } catch (_) {}
    document.querySelectorAll('.language-select').forEach(select => { select.value = lang; });
    translateTree(document.body);
    translateTree(document.querySelector('title'));
  }
  window.i18n = { t: translate, url, path: pathWithoutLanguage, get language() { return language; } };
  // Preserve language through project history updates without reloading the editor.
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method].bind(history);
    history[method] = (state, unused, target) => original(state, unused, target == null ? target : url(String(target)));
  }
  for (const method of ['alert', 'confirm', 'prompt']) {
    const original = window[method].bind(window);
    window[method] = (message, ...args) => original(translate(String(message)), ...args);
  }
  document.documentElement.lang = language === 'pt' ? 'pt-BR' : language;
  document.addEventListener('DOMContentLoaded', () => {
    const host = document.querySelector('.home-actions, #topbar, .topbar, header, nav');
    if (host) {
      const select = document.createElement('select');
      select.className = 'language-select';
      select.dataset.noTranslate = '';
      select.setAttribute('aria-label', 'Language / Idioma');
      for (const [value, label] of [['en','English'],['pt','Português'],['es','Español']]) {
        select.add(new Option(label, value));
      }
      select.value = language;
      select.addEventListener('change', () => {
        const target = url(location.pathname + location.search + location.hash, select.value);
        history.replaceState(null, '', target);
        // The history wrapper uses the active language; set the requested URL after updating it.
        updateLanguage(select.value);
        history.replaceState(null, '', target);
      });
      host.appendChild(select);
    }
    updateLanguage(language);
    const observer = new MutationObserver(records => {
      observer.disconnect();
      for (const record of records) {
        if (record.type === 'characterData') translateText(record.target);
        else if (record.type === 'attributes') translateElement(record.target);
        else record.addedNodes.forEach(translateTree);
      }
      observe();
    });
    const observe = () => observer.observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['title','placeholder','aria-label','alt','href'] });
    observe();
    window.addEventListener('popstate', () => updateLanguage(location.pathname.match(/^\/(en|pt|es)(?:\/|$)/)?.[1] || 'en'));
  });
})();
