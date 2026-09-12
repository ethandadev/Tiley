/**
 * Project serialisation.
 *
 * `JSON.stringify(project, null, 2)` puts every tile ID on its own line, which
 * turns a 1000 x 1000 map into a 13 MB file with a million lines. Tile rows are
 * therefore emitted compactly (one line per map row) while the rest of the
 * document stays pretty-printed and readable/diffable.
 *
 * The output is ordinary JSON — anything can read it back with JSON.parse.
 */

const ROW_INDENT = '        ';
const DATA_INDENT = '      ';

/** Placeholder that cannot appear in a real value. */
const token = (index) => `@@TILEY_MAP_DATA_${index}@@`;

export function stringifyProject(project) {
  if (!project || !Array.isArray(project.maps)) return JSON.stringify(project, null, 2);

  const grids = [];
  const shallow = {
    ...project,
    maps: project.maps.map((map, index) => {
      grids.push(map.data);
      return { ...map, data: token(index) };
    })
  };

  let text = JSON.stringify(shallow, null, 2);
  grids.forEach((grid, index) => {
    const rows = grid.map((row) => `${ROW_INDENT}[${row.join(',')}]`).join(',\n');
    const replacement = grid.length === 0 ? '[]' : `[\n${rows}\n${DATA_INDENT}]`;
    text = text.replace(`"${token(index)}"`, () => replacement);
  });
  return text;
}
