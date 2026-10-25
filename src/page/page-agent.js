/**
 * Myna page agent.
 *
 * Injected into the extension's isolated world on demand. It owns the stable
 * element-reference map, accessibility tree, DOM actions, and the on-page
 * indicator. Nothing here reads cookies, storage, or page credentials.
 *
 * The IIFE is idempotent: injecting it again keeps the existing ref map.
 */
(() => {
  if (window.__myna && window.__myna.version === 1) return;

  const MAX_ELEMENTS = 10000;
  const refs = new Map(); // ref -> WeakRef(Element)
  const reverse = new WeakMap(); // Element -> ref
  let counter = 0;
  let refRoot = null;

  const ROLE_MAP = {
    a: 'link',
    button: 'button',
    select: 'combobox',
    textarea: 'textbox',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
    img: 'image',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    section: 'region',
    article: 'article',
    aside: 'complementary',
    form: 'form',
    table: 'table',
    ul: 'list',
    ol: 'list',
    li: 'listitem',
    label: 'label',
    details: 'group',
    summary: 'button',
    dialog: 'dialog',
    fieldset: 'group',
    legend: 'label',
    progress: 'progressbar',
    meter: 'meter',
    output: 'status',
    canvas: 'img'
  };

  const INPUT_ROLE = {
    button: 'button',
    submit: 'button',
    reset: 'button',
    image: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    file: 'button',
    range: 'slider',
    number: 'spinbutton',
    search: 'searchbox',
    email: 'textbox',
    tel: 'textbox',
    url: 'textbox',
    password: 'textbox',
    text: 'textbox',
    date: 'textbox',
    time: 'textbox',
    'datetime-local': 'textbox',
    month: 'textbox',
    week: 'textbox',
    color: 'button'
  };

  const SKIP_TAGS = new Set([
    'script',
    'style',
    'meta',
    'link',
    'title',
    'noscript',
    'template',
    'head'
  ]);

  const SKIP_ROLES = new Set([
    'presentation',
    'none',
    'generic',
    'emphasis',
    'strong',
    'paragraph',
    'text'
  ]);

  function truncate(text, max = 200) {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  function cleanText(text, max = 200) {
    return truncate(text, max).replace(/"/g, '\\"');
  }

  function tag(el) {
    return (el.tagName || '').toLowerCase();
  }

  function roleOf(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    const t = tag(el);
    if (t === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return INPUT_ROLE[type] || 'textbox';
    }
    return ROLE_MAP[t] || 'generic';
  }

  function isSensitive(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password' || type === 'hidden') return true;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return /\b(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year)\b/.test(
      ac
    );
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden) return false;
    if (el.closest && el.closest('[aria-hidden="true"]')) return false;
    const t = tag(el);
    if (SKIP_TAGS.has(t)) return false;
    if (typeof el.checkVisibility === 'function') {
      try {
        if (
          !el.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true
          })
        ) {
          return false;
        }
      } catch {
        /* fall through */
      }
    }
    const style = getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0' ||
      style.contentVisibility === 'hidden'
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0.5 && rect.height > 0.5;
  }

  function isInteractive(el) {
    const t = tag(el);
    if (
      [
        'a',
        'button',
        'input',
        'select',
        'textarea',
        'summary',
        'details',
        'audio',
        'video'
      ].includes(t)
    ) {
      return true;
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (
      [
        'button',
        'link',
        'checkbox',
        'radio',
        'tab',
        'menuitem',
        'menuitemcheckbox',
        'menuitemradio',
        'switch',
        'combobox',
        'textbox',
        'searchbox',
        'slider',
        'spinbutton',
        'option',
        'treeitem'
      ].includes(role)
    ) {
      return true;
    }
    if (el.isContentEditable) return true;
    if (el.hasAttribute('onclick')) return true;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) >= 0) return true;
    return false;
  }

  function isSemantic(el) {
    const role = roleOf(el);
    if (role !== 'generic' && !SKIP_ROLES.has(role)) return true;
    const t = tag(el);
    return [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'li',
      'blockquote',
      'pre',
      'code',
      'caption',
      'figcaption'
    ].includes(t);
  }

  function textOf(el, max = 400) {
    if (!el) return '';
    if (el instanceof HTMLSelectElement) {
      const selected = el.selectedOptions && el.selectedOptions[0];
      return selected ? selected.textContent || '' : '';
    }
    if (el instanceof HTMLTextAreaElement) return el.value || '';
    if (el instanceof HTMLInputElement) {
      if (isSensitive(el)) return '';
      return el.value || '';
    }
    return el.innerText || el.textContent || '';
  }

  function labelledBy(el) {
    const ids = (el.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .filter(Boolean);
    if (!ids.length) return '';
    return ids
      .map((id) => {
        const node = document.getElementById(id);
        return node ? node.innerText || node.textContent || '' : '';
      })
      .join(' ')
      .trim();
  }

  function accessibleName(el) {
    if (!el) return '';
    const by = labelledBy(el);
    if (by) return truncate(by, 200);
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return truncate(aria, 200);
    if (el.labels && el.labels.length) {
      const label = Array.from(el.labels)
        .map((item) => item.innerText || item.textContent || '')
        .join(' ')
        .trim();
      if (label) return truncate(label, 200);
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (label) {
        const value = label.innerText || label.textContent || '';
        if (value.trim()) return truncate(value, 200);
      }
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return truncate(placeholder, 200);
    const title = el.getAttribute('title');
    if (title && title.trim()) return truncate(title, 200);
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return truncate(alt, 200);
    if (el instanceof HTMLInputElement) {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') {
        return truncate(el.value || type, 200);
      }
    }
    if (el instanceof HTMLSelectElement) {
      const option = el.selectedOptions && el.selectedOptions[0];
      if (option && option.textContent) return truncate(option.textContent, 200);
    }
    const t = tag(el);
    if (['button', 'a', 'summary', 'label', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figcaption', 'caption'].includes(t)) {
      const text = el.innerText || el.textContent || '';
      if (text.trim()) return truncate(text, 200);
    }
    const direct = directText(el);
    if (direct.trim()) return truncate(direct, 200);
    return '';
  }

  function directText(el) {
    let out = '';
    for (const child of el.childNodes || []) {
      if (child.nodeType === Node.TEXT_NODE) out += child.textContent || '';
    }
    return out.trim();
  }

  function cssEscape(value) {
    if (globalThis.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function assignRef(el) {
    if (!el || el.nodeType !== 1) return null;
    const existing = reverse.get(el);
    if (existing) {
      const current = refs.get(existing);
      if (current && current.deref() === el) return existing;
    }
    const ref = `ref_${++counter}`;
    refs.set(ref, new WeakRef(el));
    reverse.set(el, ref);
    return ref;
  }

  function resolveRef(ref) {
    if (!ref) return null;
    const holder = refs.get(ref);
    if (!holder) return null;
    const el = holder.deref();
    if (!el || !el.isConnected) {
      refs.delete(ref);
      return null;
    }
    return el;
  }

  function cleanupRefs() {
    for (const [ref, holder] of refs) {
      if (!holder.deref()) refs.delete(ref);
    }
  }

  function stateAttrs(el) {
    const out = [];
    if (el.disabled) out.push('disabled');
    if (el.checked) out.push('checked');
    if (el instanceof HTMLOptionElement && el.selected) out.push('selected');
    const expanded = el.getAttribute('aria-expanded');
    if (expanded) out.push(`expanded=${expanded}`);
    const pressed = el.getAttribute('aria-pressed');
    if (pressed) out.push(`pressed=${pressed}`);
    const current = el.getAttribute('aria-current');
    if (current) out.push(`current=${current}`);
    return out;
  }

  function lineFor(el, depth, filter) {
    const role = roleOf(el);
    if (filter === 'interactive' && !isInteractive(el)) return null;
    if (filter !== 'all' && role === 'generic' && !isInteractive(el)) return null;
    if (filter === 'all' && role === 'generic' && !isInteractive(el) && !isSemantic(el)) {
      const name = accessibleName(el);
      if (!name) return null;
    }
    const name = accessibleName(el);
    const value = valueFor(el);
    if (!name && !value && !isInteractive(el) && !isSemantic(el)) return null;
    const ref = isInteractive(el) || isSemantic(el) ? assignRef(el) : null;
    const indent = '  '.repeat(depth);
    const bits = [`${indent}${role}`];
    if (name) bits.push(`"${cleanText(name, 160)}"`);
    if (ref) bits.push(`[${ref}]`);
    if (value && role !== 'link' && role !== 'button') {
      bits.push(`value="${cleanText(value, 120)}"`);
    }
    const attrs = stateAttrs(el);
    if (attrs.length) bits.push(attrs.join(' '));
    if (el instanceof HTMLInputElement) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type && type !== 'text') bits.push(`type="${type}"`);
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && !name) bits.push(`placeholder="${cleanText(placeholder, 80)}"`);
    const href = el.getAttribute('href');
    if (href && tag(el) === 'a') bits.push(`href="${cleanText(href, 220)}"`);
    return bits.join(' ');
  }

  function valueFor(el) {
    if (el instanceof HTMLInputElement) {
      if (isSensitive(el)) return el.value ? '[redacted]' : '';
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return '';
      return el.value ? truncate(el.value, 120) : '';
    }
    if (el instanceof HTMLTextAreaElement) {
      return el.value ? truncate(el.value, 120) : '';
    }
    if (el instanceof HTMLSelectElement) {
      const option = el.selectedOptions && el.selectedOptions[0];
      return option && option.textContent ? truncate(option.textContent, 120) : '';
    }
    if (el.isContentEditable) {
      const text = el.innerText || '';
      return text ? truncate(text, 120) : '';
    }
    return '';
  }

  function walk(el, depth, state) {
    if (!el || state.count >= MAX_ELEMENTS || state.stop) return;
    if (depth > state.maxDepth) return;
    if (el.nodeType !== 1) return;
    if (!state.force && !isVisible(el)) return;
    const t = tag(el);
    if (SKIP_TAGS.has(t)) return;
    if (!state.force && el.getAttribute('aria-hidden') === 'true') return;

    state.count++;
    const filter = state.filter;
    const line = lineFor(el, depth, filter);
    if (line) {
      state.lines.push(line);
      if (state.lines.length >= state.maxLines) {
        state.stop = true;
        return;
      }
    }

    let childDepth = line ? depth + 1 : depth;
    if (filter === 'interactive' && line) childDepth = depth;
    if (t === 'select' && filter === 'interactive') return;
    const children = [];
    if (el.shadowRoot) children.push(...el.shadowRoot.children);
    children.push(...el.children);
    for (const child of children) {
      walk(child, childDepth, state);
      if (state.stop) return;
    }
  }

  function tree(opts = {}) {
    cleanupRefs();
    const filter = opts.filter === 'interactive' ? 'interactive' : 'all';
    const maxDepth = Math.max(
      0,
      Math.min(40, Number(opts.depth) || 15)
    );
    const maxChars = Math.max(1000, Math.min(200000, Number(opts.max_chars) || 50000));
    const maxLines = 6000;
    const rootEl = opts.ref_id ? resolveRef(opts.ref_id) : document.body;
    if (opts.ref_id && !rootEl) {
      return {
        error: `Element ${opts.ref_id} was not found. It may have been removed. Call read_page again for fresh references.`,
        pageContent: '',
        viewport: viewport()
      };
    }
    const state = {
      lines: [],
      count: 0,
      maxDepth,
      filter,
      maxLines,
      stop: false,
      force: !!opts.ref_id
    };
    walk(rootEl, 0, state);
    let content = state.lines.join('\n');
    let truncated = false;
    let fullLength = content.length;
    if (content.length > maxChars) {
      truncated = true;
      const cut = content.lastIndexOf('\n', maxChars);
      content = content.slice(0, cut > 0 ? cut : maxChars);
      content += `\n[output truncated at ${maxChars} of ${fullLength} characters. Pass a larger max_chars, reduce depth, or focus with ref_id.]`;
    }
    if (state.count >= MAX_ELEMENTS) {
      content += `\n[stopped at ${MAX_ELEMENTS} elements. Use filter="interactive", a smaller depth, or ref_id to focus.]`;
    }
    return {
      pageContent: content,
      viewport: viewport(),
      truncated,
      fullLength,
      elementCount: state.count,
      refCount: refs.size,
      filter
    };
  }

  function collectCandidates() {
    cleanupRefs();
    const out = [];
    const state = {
      lines: [],
      count: 0,
      maxDepth: 20,
      filter: 'all',
      maxLines: 12000,
      stop: false,
      force: false,
      cb: (el) => {
        const interactive = isInteractive(el);
        const role = roleOf(el);
        if (!interactive && role === 'generic') return;
        const name = accessibleName(el);
        if (!interactive && !name) return;
        const ref = assignRef(el);
        out.push({
          ref,
          role,
          name,
          text: truncate(el.innerText || el.textContent || '', 600),
          interactive,
          href: el.getAttribute('href') || '',
          tag: tag(el)
        });
      }
    };
    walkCollect(document.body, 0, state);
    return out;
  }

  function walkCollect(el, depth, state) {
    if (!el || state.stop || depth > state.maxDepth) return;
    if (el.nodeType !== 1) return;
    if (!isVisible(el)) return;
    if (SKIP_TAGS.has(tag(el))) return;
    if (el.getAttribute('aria-hidden') === 'true') return;
    state.count++;
    state.cb?.(el);
    if (state.count >= MAX_ELEMENTS) {
      state.stop = true;
      return;
    }
    const children = [];
    if (el.shadowRoot) children.push(...el.shadowRoot.children);
    children.push(...el.children);
    for (const child of children) {
      walkCollect(child, depth + 1, state);
      if (state.stop) return;
    }
  }

  const SYNONYMS = {
    search: ['search', 'searchbox', 'find', 'query'],
    box: ['textbox', 'searchbox', 'combobox'],
    button: ['button', 'submit'],
    link: ['link', 'a'],
    field: ['textbox', 'combobox', 'checkbox', 'radio', 'spinbutton'],
    input: ['textbox', 'searchbox', 'combobox', 'checkbox'],
    email: ['email', 'textbox'],
    password: ['password', 'textbox'],
    sign: ['sign', 'login', 'log in', 'continue'],
    login: ['login', 'log in', 'sign in'],
    cart: ['cart', 'basket', 'bag'],
    buy: ['buy', 'purchase', 'add to cart'],
    price: ['price', 'cost', '$'],
    menu: ['menu', 'navigation', 'nav'],
    close: ['close', 'dismiss', 'x'],
    submit: ['submit', 'send', 'continue', 'next'],
    next: ['next', 'continue'],
    previous: ['previous', 'back'],
    tab: ['tab']
  };

  function find(query, limit = 20) {
    const raw = String(query || '').trim();
    if (!raw) return { matches: [], total: 0 };
    const candidates = collectCandidates();
    const exact = /^["“](.+)["”]$/.exec(raw);
    const needle = (exact ? exact[1] : raw).toLowerCase();
    const tokens = needle
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1);
    const scored = [];
    for (const item of candidates) {
      const haystack = `${item.role} ${item.name} ${item.text} ${item.href}`.toLowerCase();
      let score = 0;
      if (exact && item.name.toLowerCase().includes(needle)) score += 100;
      if (item.name.toLowerCase() === needle) score += 120;
      if (item.name.toLowerCase().includes(needle)) score += 60;
      if (haystack.includes(needle)) score += 25;
      for (const token of tokens) {
        if (item.name.toLowerCase().includes(token)) score += 22;
        if (item.role.toLowerCase().includes(token)) score += 16;
        if (item.text.toLowerCase().includes(token)) score += 5;
        const synonyms = SYNONYMS[token] || [];
        if (synonyms.some((syn) => item.role.toLowerCase().includes(syn))) {
          score += 12;
        }
      }
      if (item.interactive) score += 8;
      if (!score) continue;
      score -= Math.min(15, Math.floor(item.name.length / 40));
      scored.push({ ...item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const matches = [];
    for (const item of scored) {
      if (seen.has(item.ref)) continue;
      seen.add(item.ref);
      matches.push({
        ref: item.ref,
        role: item.role,
        name: truncate(item.name, 120),
        type: item.tag,
        description: item.interactive ? 'interactive' : '',
        score: item.score
      });
      if (matches.length >= limit) break;
    }
    return {
      matches,
      total: scored.length,
      truncated: scored.length > matches.length
    };
  }

  function pageText(opts = {}) {
    const maxChars = Math.max(500, Math.min(500000, Number(opts.max_chars) || 50000));
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '[class*="articleBody"]',
      '[class*="article-body"]',
      '[class*="post-content"]',
      '[class*="entry-content"]',
      '[class*="content-body"]',
      '.content',
      '#content'
    ];
    let best = null;
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const node of nodes) {
        const length = (node.innerText || '').length;
        if (!best || length > best.length) best = { node, length };
      }
      if (best && best.length > 200) break;
    }
    const root = best?.node || document.body;
    const raw = (root.innerText || '').replace(/\u00a0/g, ' ');
    const text = raw
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text || text.length < 10) {
      return {
        text: '',
        source: 'none',
        title: document.title,
        url: location.href,
        error:
          'No readable text found. The page may be canvas-based, image-only, or still loading.'
      };
    }
    let output = text;
    if (text.length > maxChars) {
      const cut = text.lastIndexOf('\n', maxChars);
      output =
        text.slice(0, cut > 0 ? cut : maxChars) +
        `\n\n[output truncated at ${maxChars} of ${text.length} characters. Pass a larger max_chars or use read_page with a ref_id to focus.]`;
    }
    return {
      text: output,
      source: tag(root) || 'body',
      title: document.title,
      url: location.href,
      length: text.length
    };
  }

  function rectOf(el) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function resolve(ref) {
    const el = resolveRef(ref);
    if (!el) {
      return {
        success: false,
        error: `No element found for ${ref}. The page may have changed; call read_page again.`
      };
    }
    if (!isVisible(el)) {
      return {
        success: false,
        error: `Element ${ref} exists but is not visible.`
      };
    }
    const rect = rectOf(el);
    return {
      success: true,
      ref,
      x: rect.x,
      y: rect.y,
      rect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      },
      tag: tag(el),
      role: roleOf(el),
      name: truncate(accessibleName(el), 160),
      href: el.getAttribute('href') || '',
      value: valueFor(el)
    };
  }

  function flashRect(rect, color = '#1f6f68') {
    const layer = ensureLayer();
    const box = document.createElement('div');
    box.className = 'flash';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${Math.max(2, rect.width)}px`;
    box.style.height = `${Math.max(2, rect.height)}px`;
    box.style.borderColor = color;
    layer.appendChild(box);
    setTimeout(() => box.remove(), 900);
  }

  function flash(ref) {
    const el = resolveRef(ref);
    if (!el) return { success: false };
    const rect = el.getBoundingClientRect();
    flashRect(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      '#1f6f68'
    );
    return { success: true };
  }

  function focus(ref) {
    const el = resolveRef(ref);
    if (!el) return { success: false, error: `No element found for ${ref}.` };
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const length = el.value.length;
      try {
        el.setSelectionRange(length, length);
      } catch {
        /* some input types do not support selection */
      }
    }
    flashRect(el.getBoundingClientRect());
    return { success: true, tag: tag(el), role: roleOf(el) };
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function dispatchInput(el) {
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function formInput(ref, value) {
    const el = resolveRef(ref);
    if (!el) {
      return {
        error: `No element found for ${ref}. Call read_page again for fresh references.`
      };
    }
    if (isSensitive(el)) {
      return {
        error:
          'Refusing to write to a password, one-time-code, or payment field. Ask the user to fill it themselves.'
      };
    }
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    const previous = valueFor(el);

    if (el instanceof HTMLSelectElement) {
      const wanted = String(value);
      const options = Array.from(el.options);
      const match = options.find(
        (option) => option.value === wanted || option.text.trim() === wanted
      );
      if (!match) {
        return {
          error: `Option "${wanted}" not found. Options: ${options
            .slice(0, 30)
            .map((option) => `"${option.text.trim()}"`)
            .join(', ')}`
        };
      }
      el.selectedIndex = match.index;
      dispatchInput(el);
      flashRect(el.getBoundingClientRect());
      return {
        output: `Selected "${truncate(match.text, 80)}" in the dropdown.`
      };
    }

    if (el instanceof HTMLInputElement) {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') {
        const next =
          typeof value === 'boolean'
            ? value
            : String(value).toLowerCase() === 'true' ||
              String(value) === '1';
        el.checked = next;
        dispatchInput(el);
        flashRect(el.getBoundingClientRect());
        return { output: `Checkbox ${next ? 'checked' : 'unchecked'}.` };
      }
      if (type === 'radio') {
        el.checked = true;
        dispatchInput(el);
        flashRect(el.getBoundingClientRect());
        return { output: 'Radio button selected.' };
      }
      if (type === 'file') {
        return {
          error:
            'File inputs cannot be set from the agent. Ask the user to choose a file.'
        };
      }
      if (type === 'range' || type === 'number') {
        const number = Number(value);
        if (!Number.isFinite(number)) {
          return { error: `${type} input needs a numeric value.` };
        }
        setNativeValue(el, String(number));
      } else {
        setNativeValue(el, String(value));
      }
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch {
        /* ignore */
      }
      dispatchInput(el);
      flashRect(el.getBoundingClientRect());
      return { output: `Set ${type || 'text'} field to "${truncate(el.value, 80)}".` };
    }

    if (el instanceof HTMLTextAreaElement) {
      setNativeValue(el, String(value));
      dispatchInput(el);
      flashRect(el.getBoundingClientRect());
      return { output: `Set textarea to "${truncate(el.value, 80)}".` };
    }

    if (el.isContentEditable) {
      el.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, String(value));
      } catch {
        ok = false;
      }
      if (!ok) {
        el.textContent = String(value);
      }
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: String(value)
        })
      );
      flashRect(el.getBoundingClientRect());
      return { output: `Set editable content to "${truncate(el.innerText, 80)}".` };
    }

    return {
      error: `${tag(el)} is not a supported form control.`,
      previous
    };
  }

  function dataUrlToFile(item) {
    const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(
      String(item.dataUrl || '')
    );
    if (!match) throw new Error(`Invalid data URL for ${item.name || 'file'}.`);
    const mime = item.mime || match[1] || 'application/octet-stream';
    const binary = atob(match[2] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], item.name || 'upload.bin', { type: mime });
  }

  function uploadFiles(ref, files) {
    const el = resolveRef(ref);
    if (!el) {
      return {
        error: `No element found for ${ref}. Call read_page again for fresh references.`
      };
    }
    if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
      return { error: `${ref} is not a file input.` };
    }
    if (!Array.isArray(files) || files.length === 0) {
      return {
        error:
          'No files are attached. Ask the user to add files with the Files button in Myna first.'
      };
    }
    try {
      const transfer = new DataTransfer();
      for (const item of files) transfer.items.add(dataUrlToFile(item));
      el.files = transfer.files;
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      flashRect(el.getBoundingClientRect());
      return {
        output: `Attached ${files.length} file${files.length === 1 ? '' : 's'} to ${ref}: ${files
          .map((item) => item.name)
          .join(', ')}`
      };
    } catch (error) {
      return { error: `Could not attach files: ${error.message || error}` };
    }
  }

  function click(ref, options = {}) {
    const el = resolveRef(ref);
    if (!el) {
      return {
        error: `No element found for ${ref}. Call read_page again for fresh references.`
      };
    }
    const rect = el.getBoundingClientRect();
    if (!isVisible(el)) {
      return { error: `Element ${ref} is not visible.` };
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const result = dispatchClick(el, x, y, options);
    flashRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    return result;
  }

  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function clickAt(x, y, options = {}) {
    const el = deepElementFromPoint(x, y);
    if (!el) return { error: `Nothing is at (${x}, ${y}).` };
    const result = dispatchClick(el, x, y, options);
    flashRect({ left: x - 8, top: y - 8, width: 16, height: 16 });
    return result;
  }

  function dispatchClick(el, x, y, options = {}) {
    const button =
      options.button === 'right' ? 2 : options.button === 'middle' ? 1 : 0;
    const detail = Math.max(1, Number(options.clickCount) || 1);
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button,
      buttons: button === 2 ? 2 : button === 1 ? 4 : 1,
      detail,
      ctrlKey: !!options.ctrlKey,
      shiftKey: !!options.shiftKey,
      altKey: !!options.altKey,
      metaKey: !!options.metaKey
    };
    if (button === 2) {
      el.dispatchEvent(new MouseEvent('contextmenu', base));
      return { success: true, output: 'Opened the context menu.' };
    }
    el.dispatchEvent(
      new PointerEvent('pointerdown', { ...base, pointerType: 'mouse' })
    );
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(
      new PointerEvent('pointerup', { ...base, pointerType: 'mouse' })
    );
    el.dispatchEvent(new MouseEvent('mouseup', base));
    if (detail >= 2) {
      el.dispatchEvent(new MouseEvent('dblclick', { ...base, detail: 2 }));
    }
    if (
      typeof el.click === 'function' &&
      !options.ctrlKey &&
      !options.shiftKey &&
      !options.altKey &&
      !options.metaKey
    ) {
      el.click();
    } else {
      el.dispatchEvent(new MouseEvent('click', base));
    }
    return {
      success: true,
      output: `Clicked at (${Math.round(x)}, ${Math.round(y)}).`,
      href: el.getAttribute && (el.getAttribute('href') || '')
    };
  }

  function hover(ref) {
    const el = resolveRef(ref);
    if (!el) return { error: `No element found for ${ref}.` };
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'mousemove']) {
      const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(
        new EventCtor(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y
        })
      );
    }
    flashRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    return { success: true, output: `Hovered ${ref}` };
  }

  function scrollToRef(ref) {
    const el = resolveRef(ref);
    if (!el) return { error: `No element found for ${ref}.` };
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    flashRect(el.getBoundingClientRect());
    return { success: true, output: `Scrolled ${ref} into view.` };
  }

  function scroll(opts = {}) {
    const direction = opts.direction || 'down';
    const amount = Math.max(1, Math.min(10, Number(opts.amount) || 3));
    const step = amount * 120;
    const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
    const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
    window.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
    return {
      success: true,
      output: `Scrolled ${direction}.`,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
  }

  function typeText(text) {
    const active = document.activeElement;
    const value = String(text ?? '');
    if (!active || active === document.body) {
      return {
        error:
          'No focused element. Pass a ref to computer→type or click the field first.'
      };
    }
    if (isSensitive(active)) {
      return {
        error:
          'Refusing to type into a password, one-time-code, or payment field. Ask the user to type it.'
      };
    }
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const start = active.selectionStart ?? active.value.length;
      const end = active.selectionEnd ?? active.value.length;
      const next = `${active.value.slice(0, start)}${value}${active.value.slice(end)}`;
      setNativeValue(active, next);
      const pos = start + value.length;
      try {
        active.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
      active.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: value
        })
      );
      return { success: true, output: `Typed ${value.length} character(s).` };
    }
    if (active.isContentEditable) {
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, value);
      } catch {
        ok = false;
      }
      if (!ok) active.textContent = `${active.textContent || ''}${value}`;
      active.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: value
        })
      );
      return { success: true, output: `Typed ${value.length} character(s).` };
    }
    return { error: `${tag(active)} is not editable.` };
  }

  function syntheticKey(combo) {
    const active = document.activeElement || document.body;
    const parts = String(combo || '').split('+').map((part) => part.trim());
    const key = parts.pop() || '';
    const mods = {
      ctrlKey: parts.some((part) => /^(ctrl|control)$/i.test(part)),
      shiftKey: parts.some((part) => /^shift$/i.test(part)),
      altKey: parts.some((part) => /^alt$/i.test(part)),
      metaKey: parts.some((part) => /^(cmd|meta|command)$/i.test(part))
    };
    const init = {
      key,
      bubbles: true,
      cancelable: true,
      composed: true,
      ...mods
    };
    active.dispatchEvent(new KeyboardEvent('keydown', init));
    if (key.length === 1) active.dispatchEvent(new KeyboardEvent('keypress', init));
    active.dispatchEvent(new KeyboardEvent('keyup', init));
    if (key === 'Enter' && active.form) {
      // Let the page decide whether Enter submits. We only dispatch events.
    }
    return { success: true, output: `Pressed ${combo}.` };
  }

  function selection() {
    const sel = window.getSelection();
    return sel ? truncate(sel.toString(), 4000) : '';
  }

  function viewport() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      pageWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body ? document.body.scrollWidth : 0
      ),
      pageHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      )
    };
  }

  function pageInfo() {
    return {
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      viewport: viewport(),
      selection: selection()
    };
  }

  /* ------------------------------------------------------------------ */
  /* On-page indicator                                                   */
  /* ------------------------------------------------------------------ */

  let indicatorHost = null;
  let indicatorShadow = null;
  let indicatorTimer = null;

  function ensureLayer() {
    if (!indicatorHost || !indicatorHost.isConnected) {
      indicatorHost = document.createElement('div');
      indicatorHost.id = '__myna_layer';
      indicatorHost.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      const shadow = indicatorHost.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .frame { position: fixed; inset: 0; border: 2px solid rgba(31,111,104,.55); box-shadow: inset 0 0 0 1px rgba(31,111,104,.15); pointer-events: none; animation: fadeIn .18s ease-out; }
          .pill { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; max-width: min(86vw, 420px); padding: 8px 14px 8px 10px; border-radius: 999px; background: #171614; color: #f6f3ee; font: 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.22); pointer-events: none; animation: rise .2s ease-out; }
          .mark { width: 18px; height: 18px; border-radius: 50%; background: #e8a33d; display: grid; place-items: center; flex: 0 0 auto; }
          .mark svg { width: 12px; height: 12px; display: block; }
          .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .dot { width: 6px; height: 6px; border-radius: 50%; background: #7fd1c7; flex: 0 0 auto; animation: pulse 1.1s ease-in-out infinite; }
          .cursor-arrow { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -2px 0 0 -2px; pointer-events: none; opacity: 0; transition: transform .42s cubic-bezier(.2,.9,.2,1), opacity .16s ease; filter: drop-shadow(0 3px 6px rgba(0,0,0,.25)); z-index: 3; }
          .cursor-arrow.is-visible { opacity: 1; }
          .cursor-arrow svg { width: 22px; height: 22px; display: block; }
          .cursor-tag { position: absolute; left: 22px; top: 15px; max-width: 180px; padding: 3px 7px; border-radius: 999px; background: #171614; color: #f6f3ee; font: 650 10px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; transform: translateY(-2px); transition: opacity .14s ease, transform .14s ease; }
          .cursor-arrow.is-active .cursor-tag { opacity: 1; transform: none; }
          .ripple { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; border: 2px solid #1f6f68; background: rgba(31,111,104,.22); pointer-events: none; animation: ripple .62s cubic-bezier(.2,.8,.2,1) forwards; }
          .keycap { position: fixed; transform: translate(-50%, -50%); padding: 5px 9px; border-radius: 7px; border: 1px solid rgba(255,255,255,.22); background: #171614; color: #f6f3ee; font: 650 11px/1.1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; box-shadow: 0 8px 20px rgba(0,0,0,.25); pointer-events: none; animation: keycap .85s ease-out forwards; }
          .scroll-hint { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 8px 11px; border-radius: 999px; background: rgba(23,22,20,.88); color: #f6f3ee; font: 650 11px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; pointer-events: none; animation: scrollHint .8s ease-out forwards; }
          .scroll-hint svg { width: 14px; height: 14px; vertical-align: -3px; margin-right: 4px; }
          .flash { position: fixed; border: 2px solid #1f6f68; border-radius: 6px; background: rgba(31,111,104,.08); pointer-events: none; animation: flash .9s ease-out forwards; }
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes rise { from { opacity: 0; transform: translate(-50%, 6px) } to { opacity: 1; transform: translate(-50%, 0) } }
          @keyframes pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
          @keyframes flash { 0% { opacity: 1 } 70% { opacity: .9 } 100% { opacity: 0 } }
          @keyframes ripple { 0% { opacity: .9; transform: scale(.5) } 100% { opacity: 0; transform: scale(3.4) } }
          @keyframes keycap { 0% { opacity: 0; transform: translate(-50%, -35%) scale(.92) } 18% { opacity: 1; transform: translate(-50%, -50%) scale(1) } 72% { opacity: 1; transform: translate(-50%, -50%) scale(1) } 100% { opacity: 0; transform: translate(-50%, -64%) scale(.98) } }
          @keyframes scrollHint { 0% { opacity: 0; transform: translate(-50%, -35%) } 18% { opacity: 1; transform: translate(-50%, -50%) } 100% { opacity: 0; transform: translate(-50%, -65%) } }
          @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
        </style>
        <div class="frame" style="display:none"></div>
        <div class="pill" style="display:none">
          <span class="mark"><svg viewBox="0 0 24 24" fill="none"><path d="M5 4h8l6 6v10H5V4Z" fill="#171614"/><path d="M13 4v6h6" fill="#f6f3ee"/><circle cx="10" cy="13" r="1.4" fill="#f6f3ee"/><path d="m15 13 4 2-4 2v-4Z" fill="#e8a33d"/></svg></span>
          <span class="dot"></span>
          <span class="label">Myna is working…</span>
        </div>
        <div class="cursor-arrow" hidden>
          <svg viewBox="0 0 24 24" fill="none"><path d="M3.5 2.8 20 11.6l-7.2 1.6-3.8 7L3.5 2.8Z" fill="#171614" stroke="#f6f3ee" stroke-width="1.2" stroke-linejoin="round"/></svg>
          <span class="cursor-tag"></span>
        </div>
      `;
      document.documentElement.appendChild(indicatorHost);
      indicatorShadow = shadow;
    }
    return indicatorShadow;
  }

  function indicator(opts = {}) {
    if (opts.show === false) {
      if (indicatorTimer) clearTimeout(indicatorTimer);
      indicatorTimer = null;
      if (indicatorHost) indicatorHost.remove();
      indicatorHost = null;
      indicatorShadow = null;
      return { success: true };
    }
    const shadow = ensureLayer();
    const label = shadow.querySelector('.label');
    if (label) label.textContent = opts.label || 'Myna is working…';
    const pill = shadow.querySelector('.pill');
    if (pill) pill.style.display = opts.hidePill ? 'none' : 'flex';
    const frame = shadow.querySelector('.frame');
    if (frame) frame.style.display = 'block';
    if (indicatorTimer) clearTimeout(indicatorTimer);
    if (opts.ttl) {
      indicatorTimer = setTimeout(() => hideIndicator(), opts.ttl);
    }
    return { success: true };
  }

  function hideIndicator() {
    if (indicatorHost) indicatorHost.remove();
    indicatorHost = null;
    indicatorShadow = null;
  }

  let cursorPosition = { x: -40, y: -40 };
  let cursorLabelTimer = null;

  function cursorTo(x, y, opts = {}) {
    const shadow = ensureLayer();
    const cursor = shadow.querySelector('.cursor-arrow');
    if (!cursor) return { success: false };
    const targetX = Number(x);
    const targetY = Number(y);
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      return { success: false };
    }
    cursor.hidden = false;
    cursor.classList.add('is-visible');
    cursor.classList.add('is-active');
    cursor.style.transition = 'none';
    cursor.style.transform = `translate3d(${cursorPosition.x}px, ${cursorPosition.y}px, 0)`;
    // Force a frame so the next transform animates from the previous point.
    void cursor.offsetWidth;
    cursor.style.transition =
      'transform .42s cubic-bezier(.2,.9,.2,1), opacity .16s ease';
    cursor.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
    cursorPosition = { x: targetX, y: targetY };
    const tag = cursor.querySelector('.cursor-tag');
    if (tag) tag.textContent = opts.label || '';
    if (cursorLabelTimer) clearTimeout(cursorLabelTimer);
    cursorLabelTimer = setTimeout(() => {
      cursor.classList.remove('is-active');
    }, opts.labelDuration || 1100);
    return { success: true };
  }

  function clickPulse(x, y) {
    const shadow = ensureLayer();
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = `${Number(x) || 0}px`;
    ripple.style.top = `${Number(y) || 0}px`;
    shadow.appendChild(ripple);
    setTimeout(() => ripple.remove(), 760);
    return { success: true };
  }

  function keyPulse(text, x, y) {
    const shadow = ensureLayer();
    const cap = document.createElement('div');
    cap.className = 'keycap';
    cap.textContent = String(text || 'key');
    cap.style.left = `${Number.isFinite(Number(x)) ? Number(x) : window.innerWidth / 2}px`;
    cap.style.top = `${Number.isFinite(Number(y)) ? Number(y) : window.innerHeight - 72}px`;
    shadow.appendChild(cap);
    setTimeout(() => cap.remove(), 950);
    return { success: true };
  }

  function scrollHint(direction = 'down') {
    const shadow = ensureLayer();
    const hint = document.createElement('div');
    hint.className = 'scroll-hint';
    const rotation =
      direction === 'up'
        ? 180
        : direction === 'left'
          ? 90
          : direction === 'right'
            ? -90
            : 0;
    hint.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${rotation}deg)"><path d="M12 4v16M6 14l6 6 6-6"/></svg><span></span>`;
    hint.querySelector('span').textContent = `Scroll ${direction}`;
    shadow.appendChild(hint);
    setTimeout(() => hint.remove(), 900);
    return { success: true };
  }

  function typingAt(x, y) {
    cursorTo(x, y, { label: 'Typing…' });
    return { success: true };
  }

  function cursor(x, y) {
    return cursorTo(x, y, { label: '' });
  }

  window.__myna = {
    version: 1,
    tree,
    text: pageText,
    find,
    resolve,
    focus,
    formInput,
    uploadFiles,
    click,
    clickAt,
    hover,
    scrollToRef,
    scroll,
    typeText,
    syntheticKey,
    selection,
    viewport,
    pageInfo,
    indicator,
    hideIndicator,
    flash,
    cursor,
    cursorTo,
    clickPulse,
    keyPulse,
    scrollHint,
    typingAt,
    cleanupRefs,
    refCount: () => refs.size
  };
})();
