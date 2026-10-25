/** Inline icon set. All paths are original and static. */

const PATHS = {
  bird: `<path d="M5.2 14.6c-1.8 1.6-3 3.8-3.3 5.2 1.8-.2 4.2-1.1 5.9-2.8Z" fill="currentColor" stroke="none"/><ellipse cx="11.6" cy="12.6" rx="6.2" ry="6.6" fill="currentColor" stroke="none"/><circle cx="15.2" cy="7.4" r="4.6" fill="currentColor" stroke="none"/><path d="M19.2 6.4 23.3 8l-4.1 1.6Z" fill="var(--beak, #df9a31)" stroke="none"/><circle cx="16.5" cy="6.4" r="1.4" fill="var(--surface, #f6f3ed)" stroke="none"/><circle cx="16.9" cy="6.5" r=".65" fill="currentColor" stroke="none"/><path d="M9.4 10.6c1.7.4 3 2 3 3.9 0 .9-.2 1.7-.6 2.4-2-1.1-3.4-3.2-3.4-5.5 0-.3 0-.5.1-.8Z" fill="var(--accent, #1f6f68)" stroke="none"/>`,
  history: `<path d="M3.5 12a8.5 8.5 0 1 0 2.3-5.7"/><path d="M3.5 4.5V9h4.5"/><path d="M12 7.5V12l3 1.8"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  settings: `<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M19.4 13.6a7.7 7.7 0 0 0 0-3.2l1.7-1.3-1.8-3.1-2 .8a7.8 7.8 0 0 0-2.8-1.6L14.2 3h-3.6l-.3 2.2A7.8 7.8 0 0 0 7.5 6.8l-2-.8-1.8 3.1 1.7 1.3a7.7 7.7 0 0 0 0 3.2l-1.7 1.3 1.8 3.1 2-.8a7.8 7.8 0 0 0 2.8 1.6l.3 2.2h3.6l.3-2.2a7.8 7.8 0 0 0 2.8-1.6l2 .8 1.8-3.1-1.7-1.3Z"/>`,
  globe: `<circle cx="12" cy="12" r="8.5"/><path d="M3.8 12h16.4M12 3.5c2.2 2.2 3.3 5.1 3.3 8.5S14.2 18.3 12 20.5C9.8 18.3 8.7 15.4 8.7 12S9.8 5.7 12 3.5Z"/>`,
  paperclip: `<path d="m9.5 12.8 5.1-5.1a3.1 3.1 0 0 1 4.4 4.4l-7 7a5 5 0 0 1-7.1-7.1l7-7"/>`,
  page: `<path d="M6 3.5h8l4 4v13H6v-17Z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>`,
  camera: `<path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v10H4v-10Z"/><circle cx="12" cy="13.2" r="3.1"/>`,
  "arrow-up": `<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>`,
  stop: `<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>`,
  "chevron-down": `<path d="m6.5 9.5 5.5 5 5.5-5"/>`,
  down: `<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>`,
  x: `<path d="m6 6 12 12M18 6 6 18"/>`,
  sparkles: `<path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2L6.5 8.5l4.2-1.3L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/>`,
  search: `<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.3 4.3"/>`,
  form: `<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h8M8 13h5M8 17h3"/>`,
  terminal: `<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m7.5 9 3 3-3 3M13 15h4"/>`,
  columns: `<rect x="3.5" y="4.5" width="7" height="15" rx="2"/><rect x="13.5" y="4.5" width="7" height="15" rx="2"/>`,
  eye: `<path d="M2.8 12S6.3 5.8 12 5.8 21.2 12 21.2 12 17.7 18.2 12 18.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="3"/>`,
  click: `<path d="m5.5 3.5 13 7.8-5.6 1.4-2.8 5.3-4.6-14.5Z"/>`,
  navigate: `<circle cx="12" cy="12" r="8.5"/><path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4 5.4-2.2Z"/>`,
  tabs: `<rect x="4" y="6" width="13" height="13" rx="2.3"/><path d="M8 6V4.8A1.8 1.8 0 0 1 9.8 3h8.4A1.8 1.8 0 0 1 20 4.8v8.4a1.8 1.8 0 0 1-1.8 1.8H17"/>`,
  code: `<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14"/>`,
  server: `<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4"/>`,
  plan: `<path d="M8 6h11M8 12h11M8 18h11"/><path d="m4 5.5.8.8L6.2 4.8M4 11.5l.8.8L6.2 10.8M4 17.5l.8.8L6.2 16.8"/>`,
  check: `<path d="m5 12.5 4.2 4.2L19 7"/>`,
  alert: `<path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9v4.5M12 17h.01"/>`,
  trash: `<path d="M4.5 6.5h15M9 6.5V4h6v2.5M6.5 6.5l.8 13h9.4l.8-13M10 10v6M14 10v6"/>`,
  copy: `<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>`,
  refresh: `<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4.5V9h-4.5"/>`,
  shield: `<path d="M12 3.5 19 6v6c0 4.2-2.8 7.2-7 8.5-4.2-1.3-7-4.3-7-8.5V6l7-2.5Z"/><path d="m9 12 2 2 4-4"/>`,
  key: `<circle cx="8" cy="15.5" r="3.5"/><path d="m10.5 13 7-7M15 6l3 3M13 8l2 2"/>`,
  external: `<path d="M14 4h6v6M20 4l-8 8"/><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>`,
  info: `<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>`,
  keyboard: `<rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8"/>`,
  cursor: `<path d="m6 3.5 12 7.2-5.2 1.3-2.6 4.9L6 3.5Z"/>`,
  download: `<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 20h15"/>`,
  upload: `<path d="M12 20V9M7.5 13.5 12 9l4.5 4.5M4.5 4h15"/>`,
  dots: `<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/>`,
  edit: `<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>`
};

export function iconMarkup(name, className = '') {
  const body = PATHS[name] || PATHS.info;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function initIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const name = el.getAttribute('data-icon');
    if (!name) continue;
    el.innerHTML = iconMarkup(name);
  }
}

export function icon(name) {
  const span = document.createElement('span');
  span.setAttribute('data-icon', name);
  span.innerHTML = iconMarkup(name);
  return span;
}
