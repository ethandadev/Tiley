/**
 * Right-click menus.
 *
 * One menu is open at a time; it closes on selection, Escape, scroll, or any
 * click outside. Items are plain objects so callers stay declarative:
 *   { label, onSelect, disabled?, danger?, separator?, shortcut? }
 */

import { el, $ } from '../dom.js';

let current = null;

export function closeContextMenu() {
  if (!current) return;
  current.remove();
  current = null;
  document.removeEventListener('mousedown', onDocumentDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('blur', closeContextMenu);
}

function onDocumentDown(event) {
  if (current && !current.contains(event.target)) closeContextMenu();
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeContextMenu();
  }
}

/**
 * Open a menu at the pointer position (or at explicit coordinates).
 * The menu is nudged back on screen if it would overflow the window.
 */
export function openContextMenu(event, items) {
  closeContextMenu();
  const x = event.clientX ?? event.x ?? 0;
  const y = event.clientY ?? event.y ?? 0;

  const menu = el('div', { class: 'dropdown context-menu', attrs: { role: 'menu' } });
  for (const item of items) {
    if (item.separator) {
      menu.append(el('div', { class: 'dropdown-separator', attrs: { role: 'separator' } }));
      continue;
    }
    menu.append(el('button', {
      type: 'button',
      class: 'dropdown-item',
      disabled: Boolean(item.disabled),
      style: item.danger ? 'color: var(--danger)' : '',
      attrs: { role: 'menuitem' },
      on: {
        click: () => {
          closeContextMenu();
          item.onSelect?.();
        }
      }
    }, [
      el('span', { text: item.label }),
      item.shortcut ? el('span', { class: 'shortcut', text: item.shortcut }) : null
    ]));
  }

  $('#context-menu-root').append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;

  current = menu;
  document.addEventListener('mousedown', onDocumentDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', closeContextMenu);
  menu.querySelector('button:not([disabled])')?.focus();
}

/**
 * Dropdown anchored under a button (used by the menu bar).
 * Returns a close function.
 */
export function openDropdown(anchor, items) {
  closeContextMenu();
  const rect = anchor.getBoundingClientRect();
  openContextMenu({ clientX: rect.left, clientY: rect.bottom + 2 }, items);
  return closeContextMenu;
}
