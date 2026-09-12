/** Reference sheet of every shortcut, generated from the command registry. */

import { el } from '../dom.js';
import { openModal } from '../modal.js';
import { commands, formatAccelerator, MENUS } from '../commands.js';
import { EDITOR_TOOLS } from '../../../shared/constants.js';

export function openShortcutsDialog() {
  const rows = commands.filter((command) => command.accelerator && command.label);

  const grouped = MENUS.map((menu) => ({
    title: menu,
    items: rows.filter((command) => command.menu === menu)
  })).filter((group) => group.items.length > 0);

  grouped.push({
    title: 'Tools',
    items: EDITOR_TOOLS.map((tool) => ({ label: `${tool.label} — ${tool.hint}`, accelerator: tool.key.toUpperCase() }))
  });

  grouped.push({
    title: 'Mouse',
    items: [
      { label: 'Paint / apply the current tool', accelerator: 'Left drag' },
      { label: 'Pan the map', accelerator: 'Middle drag or Space + drag' },
      { label: 'Zoom about the pointer', accelerator: 'Wheel / pinch' },
      { label: 'Pan horizontally / vertically', accelerator: 'Shift or Alt + wheel' },
      { label: 'Context menu', accelerator: 'Right click' },
      { label: 'Outline instead of filled rectangle', accelerator: 'Shift while dragging' }
    ]
  });

  const body = el('div', {}, grouped.map((group) => el('section', { style: 'margin-bottom:14px' }, [
    el('h2', { text: group.title, style: 'margin-bottom:6px' }),
    el('table', { class: 'list-table' }, [
      el('tbody', {}, group.items.map((item) => el('tr', {}, [
        el('td', { text: item.label }),
        el('td', { style: 'text-align:right; font-family: var(--font-mono); white-space:nowrap', text: formatAccelerator(item.accelerator) })
      ])))
    ])
  ])));

  const dialog = openModal({
    title: 'Keyboard shortcuts',
    wide: true,
    body,
    footer: [el('button', { class: 'button primary', text: 'Close', on: { click: () => dialog.close() } })]
  });
}
