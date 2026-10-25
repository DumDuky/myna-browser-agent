/**
 * Small, safe Markdown renderer for chat messages.
 *
 * It intentionally does not support raw HTML. Every piece of model output is
 * inserted as text nodes or as elements we create ourselves.
 */

const SAFE_LINK = /^(https?:|mailto:)/i;

export function renderMarkdown(container, markdown, { streaming = false } = {}) {
  if (!container) return;
  container.textContent = '';
  const source = String(markdown ?? '').replace(/\r\n/g, '\n');
  const blocks = splitBlocks(source);
  for (const block of blocks) {
    container.appendChild(renderBlock(block, { streaming }));
  }
  if (!source.trim() && streaming) {
    const caret = document.createElement('span');
    caret.className = 'stream-caret';
    caret.setAttribute('aria-hidden', 'true');
    container.appendChild(caret);
  }
}

function splitBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      const fence = line.trim().slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      const closed = i < lines.length;
      if (closed) i++;
      blocks.push({
        type: 'code',
        lang: fence.split(/\s+/)[0] || '',
        code: code.join('\n'),
        closed
      });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^ {0,3}(#{1,6})\s+/.test(line)) {
      const match = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
      blocks.push({ type: 'heading', level: match[1].length, text: match[2] });
      i++;
      continue;
    }
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    if (/^ {0,3}>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^ {0,3}>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^ {0,3}>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }
    if (isTableStart(lines, i)) {
      const table = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        table.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'table', lines: table });
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const match = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        items.push(match ? match[1] : '');
        i++;
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
        ) {
          items[items.length - 1] += `\n${lines[i].trim()}`;
          i++;
        }
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i].trim()) {
      if (
        /^```/.test(lines[i].trim()) ||
        /^ {0,3}(#{1,6})\s+/.test(lines[i]) ||
        /^ {0,3}>\s?/.test(lines[i]) ||
        /^\s*([-*+]|\d+\.)\s+/.test(lines[i]) ||
        isTableStart(lines, i)
      ) {
        break;
      }
      paragraph.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

function isTableStart(lines, i) {
  if (i + 1 >= lines.length) return false;
  return (
    lines[i].includes('|') &&
    /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1] || '')
  );
}

function renderBlock(block, { streaming }) {
  switch (block.type) {
    case 'code':
      return renderCodeBlock(block, streaming);
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.level));
      const el = document.createElement(`h${level}`);
      el.className = `md-heading md-h${level}`;
      appendInline(el, block.text);
      return el;
    }
    case 'hr': {
      const hr = document.createElement('hr');
      hr.className = 'md-hr';
      return hr;
    }
    case 'quote': {
      const quote = document.createElement('blockquote');
      quote.className = 'md-quote';
      const inner = document.createElement('div');
      renderMarkdown(inner, block.text, { streaming });
      quote.appendChild(inner);
      return quote;
    }
    case 'list':
      return renderList(block);
    case 'table':
      return renderTable(block);
    case 'paragraph':
    default: {
      const p = document.createElement('p');
      p.className = 'md-p';
      appendInline(p, block.text);
      return p;
    }
  }
}

function renderList(block) {
  const list = document.createElement(block.ordered ? 'ol' : 'ul');
  list.className = 'md-list';
  for (const raw of block.items) {
    const li = document.createElement('li');
    const task = /^\[( |x|X)\]\s+/.exec(raw);
    if (task) {
      const label = document.createElement('label');
      label.className = 'md-task';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.disabled = true;
      input.checked = task[1].toLowerCase() === 'x';
      label.appendChild(input);
      appendInline(label, raw.slice(task[0].length));
      li.appendChild(label);
    } else {
      appendInline(li, raw);
    }
    list.appendChild(li);
  }
  return list;
}

function renderTable(block) {
  const rows = block.lines.map((line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim())
  );
  const table = document.createElement('div');
  table.className = 'md-table-wrap';
  const el = document.createElement('table');
  el.className = 'md-table';
  rows.forEach((row, index) => {
    if (index === 1 && row.every((cell) => /^:?-{2,}:?$/.test(cell))) return;
    const tr = document.createElement('tr');
    for (const cell of row) {
      const tag = index === 0 ? 'th' : 'td';
      const td = document.createElement(tag);
      appendInline(td, cell);
      tr.appendChild(td);
    }
    el.appendChild(tr);
  });
  table.appendChild(el);
  return table;
}

function renderCodeBlock(block, streaming) {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-code';
  const header = document.createElement('div');
  header.className = 'md-code-head';
  const lang = document.createElement('span');
  lang.className = 'md-code-lang';
  lang.textContent = block.lang || 'code';
  header.appendChild(lang);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'md-copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(block.code);
      copy.textContent = 'Copied';
      setTimeout(() => {
        copy.textContent = 'Copy';
      }, 1200);
    } catch {
      copy.textContent = 'Copy failed';
    }
  });
  header.appendChild(copy);
  const pre = document.createElement('pre');
  pre.className = 'md-pre';
  const code = document.createElement('code');
  code.textContent = block.code;
  if (block.lang) code.dataset.lang = block.lang;
  pre.appendChild(code);
  wrapper.appendChild(header);
  wrapper.appendChild(pre);
  if (!block.closed && streaming) wrapper.dataset.streaming = 'true';
  return wrapper;
}

const INLINE_RE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g;

function appendInline(parent, text) {
  const source = String(text || '');
  let last = 0;
  const re = new RegExp(INLINE_RE.source, 'g');
  let match;
  while ((match = re.exec(source))) {
    if (match.index > last) {
      parent.appendChild(document.createTextNode(source.slice(last, match.index)));
    }
    const token = match[0];
    parent.appendChild(renderInlineToken(token, parent));
    last = match.index + token.length;
  }
  if (last < source.length) {
    parent.appendChild(document.createTextNode(source.slice(last)));
  }
}

function renderInlineToken(token, parent) {
  if (token.startsWith('`') && token.endsWith('`')) {
    const code = document.createElement('code');
    code.className = 'md-inline-code';
    code.textContent = token.slice(1, -1);
    return code;
  }
  if (
    (token.startsWith('**') && token.endsWith('**')) ||
    (token.startsWith('__') && token.endsWith('__'))
  ) {
    const strong = document.createElement('strong');
    appendInline(strong, token.slice(2, -2));
    return strong;
  }
  if (token.startsWith('~~') && token.endsWith('~~')) {
    const del = document.createElement('del');
    appendInline(del, token.slice(2, -2));
    return del;
  }
  if (
    (token.startsWith('*') && token.endsWith('*')) ||
    (token.startsWith('_') && token.endsWith('_'))
  ) {
    const em = document.createElement('em');
    appendInline(em, token.slice(1, -1));
    return em;
  }
  const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
  if (link) {
    return renderLink(link[1], link[2]);
  }
  if (/^https?:\/\//i.test(token)) {
    return renderLink(token, token);
  }
  return document.createTextNode(token);
}

function renderLink(label, href) {
  if (!SAFE_LINK.test(href)) {
    const span = document.createElement('span');
    span.textContent = label;
    return span;
  }
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  appendInline(a, label);
  return a;
}

export function markdownToPlainText(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
    )
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}
