/** Menu bar driven entirely by the command registry. */

import { $, el, clear } from '../dom.js';
import { MENUS, menuItems, isEnabled, formatAccelerator } from '../commands.js';
import { openDropdown, closeContextMenu } from './contextMenu.js';
import { state, on } from '../store.js';
import { showProjectBrowser } from './projectBrowser.js';

export function initMenubar() {
  const menus = $('#menubar-menus');
  const projectName = $('#menubar-project-name');
  const saveStatus = $('#save-status');

  clear(menus);
  for (const menu of MENUS) {
    const button = el('button', {
      type: 'button',
      class: 'menu-button',
      text: menu,
      attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
      on: {
        click: () => {
          const items = menuItems(menu).map((command) => command.separator
            ? { separator: true }
            : {
                label: command.checkbox ? `${command.checkbox() ? '✓ ' : '   '}${command.label}` : command.label,
                shortcut: formatAccelerator(command.accelerator),
                disabled: !isEnabled(command),
                onSelect: () => command.run()
              });
          openDropdown(button, items);
        }
      }
    });
    menus.append(button);
  }

  $('#brand-home').addEventListener('click', (event) => {
    event.preventDefault();
    closeContextMenu();
    showProjectBrowser();
  });

  const SAVE_TEXT = {
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: 'Unsaved changes',
    error: 'Not saved — retry'
  };

  function renderStatus() {
    projectName.textContent = state.project ? state.project.name : 'No project';
    saveStatus.dataset.state = state.saveStatus;
    saveStatus.querySelector('.save-text').textContent = SAVE_TEXT[state.saveStatus] ?? 'Saved';
    saveStatus.title = state.lastSavedAt
      ? `Last saved ${new Date(state.lastSavedAt).toLocaleTimeString()}`
      : 'This project has not been saved yet.';
  }

  on('status', renderStatus);
  on('project', renderStatus);
  renderStatus();
}
