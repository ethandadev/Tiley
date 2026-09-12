/** Status bar: map, size, tile counts, cursor position and zoom. */

import { $, formatNumber } from '../dom.js';
import { state, on, activeMap, tileLabel } from '../store.js';

export function initStatusbar() {
  const nodes = {
    map: $('#status-map'),
    size: $('#status-size'),
    tiles: $('#status-tiles'),
    selected: $('#status-selected'),
    cursor: $('#status-cursor'),
    under: $('#status-under'),
    selection: $('#status-selection'),
    zoom: $('#status-zoom')
  };

  function render() {
    const map = activeMap();
    if (!map) {
      nodes.map.textContent = 'Map: —';
      nodes.size.textContent = 'Size: —';
      nodes.tiles.textContent = 'Tiles: —';
      nodes.selected.textContent = 'Selected tile: —';
      nodes.cursor.textContent = 'Cursor: —';
      nodes.under.textContent = 'Tile under cursor: —';
      nodes.selection.hidden = true;
      nodes.zoom.textContent = 'Zoom: 100%';
      return;
    }

    nodes.map.textContent = `Map: ${map.name}`;
    nodes.size.textContent = `Size: ${map.width} × ${map.height}`;
    nodes.tiles.textContent = `Cells: ${formatNumber(map.width * map.height)}`;
    nodes.selected.textContent = `Selected tile: ${tileLabel(state.selectedTileId)}`;

    const { x, y } = state.cursor;
    const inside = x >= 0 && y >= 0 && x < map.width && y < map.height;
    nodes.cursor.textContent = inside ? `Cursor: X ${x}, Y ${y}` : 'Cursor: outside map';
    nodes.under.textContent = inside ? `Tile under cursor: ${tileLabel(map.data[y][x])}` : 'Tile under cursor: —';

    if (state.selection) {
      nodes.selection.hidden = false;
      nodes.selection.textContent =
        `Selection: ${state.selection.width} × ${state.selection.height} at X ${state.selection.x}, Y ${state.selection.y}`;
    } else {
      nodes.selection.hidden = true;
    }

    nodes.zoom.textContent = `Zoom: ${Math.round(state.zoom * 100)}%`;
  }

  for (const topic of ['project', 'map', 'tiles', 'status', 'viewport', 'selection']) on(topic, render);
  render();
}
