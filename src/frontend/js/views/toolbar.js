/**
 * Tool strip. Buttons are generated from the shared EDITOR_TOOLS list so the
 * toolbar, the menus and the keyboard shortcuts can never drift apart.
 */

import { el, clear, $, MOD_LABEL } from '../dom.js';
import { EDITOR_TOOLS } from '../../../shared/constants.js';
import { state, setTool, on, activeMap } from '../store.js';
import { undo, redo, canUndo, canRedo } from '../history.js';
import { requestRender, viewportSize } from '../renderer.js';
import { fitToScreen } from '../viewport.js';
import { emit } from '../store.js';

const TOOL_ICONS = {
  pencil: '✏️', eraser: '🧽', fill: '🪣', line: '📏',
  rectangle: '▭', eyedropper: '💧', select: '⬚'
};

export function initToolbar() {
  const toolbar = $('#toolbar');

  const render = () => {
    clear(toolbar);

    for (const tool of EDITOR_TOOLS) {
      toolbar.append(el('button', {
        type: 'button',
        class: 'tool-button',
        attrs: {
          'aria-pressed': String(state.tool === tool.id),
          title: `${tool.label} (${tool.key.toUpperCase()}) — ${tool.hint}`
        },
        on: { click: () => setTool(tool.id) }
      }, [
        el('span', { class: 'tool-icon', text: TOOL_ICONS[tool.id] ?? '•', attrs: { 'aria-hidden': 'true' } }),
        el('span', { text: tool.label })
      ]));
    }

    toolbar.append(el('span', { class: 'toolbar-separator', attrs: { role: 'separator' } }));

    toolbar.append(actionButton('Undo', `Undo (${MOD_LABEL} + Z)`, !canUndo(), () => { undo(); requestRender(); }));
    toolbar.append(actionButton('Redo', `Redo (${MOD_LABEL} + Shift + Z)`, !canRedo(), () => { redo(); requestRender(); }));

    toolbar.append(el('span', { class: 'toolbar-separator', attrs: { role: 'separator' } }));

    const gridButton = el('button', {
      type: 'button',
      class: 'tool-button',
      attrs: { 'aria-pressed': String(state.showGrid), title: 'Show grid (G)' },
      on: {
        click: () => {
          state.showGrid = !state.showGrid;
          emit('viewport');
          requestRender();
          render();
        }
      }
    }, [el('span', { class: 'tool-icon', text: '#', attrs: { 'aria-hidden': 'true' } }), el('span', { text: 'Grid' })]);
    toolbar.append(gridButton);

    toolbar.append(actionButton('Fit to screen', 'Fit the whole map in view (Shift + F)', !activeMap(), () => {
      const map = activeMap();
      const { width, height } = viewportSize();
      if (map) fitToScreen(map, width, height);
    }));
  };

  const actionButton = (label, title, disabled, onClick) => el('button', {
    type: 'button',
    class: 'button small',
    text: label,
    disabled,
    attrs: { title },
    on: { click: onClick }
  });

  on('tool', render);
  on('status', render);
  on('project', render);
  render();
}
