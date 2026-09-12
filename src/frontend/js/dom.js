/** Tiny DOM helpers used across the UI, so element creation stays declarative. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Create an element.
 * `props` accepts DOM properties plus the special keys `class`, `dataset`,
 * `attrs` and `on` (event listener map).
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'attrs') for (const [name, attr] of Object.entries(value)) {
      if (attr === false || attr === null || attr === undefined) continue;
      node.setAttribute(name, attr === true ? '' : String(attr));
    }
    else if (key === 'on') for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    else if (key === 'text') node.textContent = value;
    else node[key] = value;
  }
  for (const child of [children].flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Format an integer with thousands separators. */
export const formatNumber = (value) => Number(value).toLocaleString();

/** "Today", "Yesterday", or a short date. */
export function formatWhen(iso) {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const startOfDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Today, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/** True when the keyboard focus is inside a text field. */
export function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Trigger a client-side download of text or a Blob. */
export function downloadFile(filename, content, mimeType = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on the next frame so the download has started.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/** Ask the user for one or more files without leaving a stray input behind. */
export function pickFile({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, style: 'display:none' });
    document.body.append(input);
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.remove();
      resolve(multiple ? files : (files[0] ?? null));
    });
    // A cancelled picker fires no event in some browsers; clean up on focus.
    window.addEventListener('focus', () => {
      setTimeout(() => { if (input.isConnected && !input.files?.length) { input.remove(); resolve(multiple ? [] : null); } }, 400);
    }, { once: true });
    input.click();
  });
}

/** Detect the platform modifier so shortcut labels match the keyboard. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);
export const MOD_LABEL = IS_MAC ? 'Cmd' : 'Ctrl';
