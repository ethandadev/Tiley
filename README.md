# Tiley

A fast, production-ready **numerical tilemap editor** for 2D games.

Tiley lets you paint tilemaps visually while keeping a plain grid of integers as
the single source of truth. Tile images are only a visual representation of
those numbers, so what you export is exactly what your game engine reads:

```text
0, 0, 0, 1, 1
0, 0, 2, 2, 1
0, 3, 3, 2, 1
```

It runs locally as a Node.js server with a browser-based editor, and stores
everything as readable JSON on your own disk.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running the application](#running-the-application)
- [A five-minute tour](#a-five-minute-tour)
- [Project structure](#project-structure)
- [Data format](#data-format)
- [Export formats](#export-formats)
- [Import](#import)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Server API](#server-api)
- [Development](#development)
- [Testing](#testing)
- [Production deployment](#production-deployment)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)

---

## Features

**Projects**
- Create, open, save, save-as, rename, duplicate and delete projects
- Project browser with search, metadata and a recent-projects list
  (entries can be forgotten without deleting the project)
- Autosave, an explicit save status indicator, and crash recovery
- Schema versioning with automatic migration of older project files

**Maps**
- Multiple maps per project — levels, dungeons, towns — each with its own
  size, tile size, tile dictionary and metadata
- Create, rename, duplicate, reorder, delete and switch between maps
- Resize with a 9-way anchor, a live count of the cells that would be
  discarded, and a confirmation before anything destructive

**Tiles**
- Reusable **tile dictionaries** shared across maps and projects
- Unlimited tiles with numeric ID, name, image, description, tags and metadata
- Create, edit, duplicate, delete, change ID, replace image
- PNG / JPEG / WebP uploads, validated by file signature
- Search, tag filters, sorting by ID or name, adjustable thumbnails
- Import and export dictionaries as standalone JSON files
- Missing tile IDs are shown as an explicit placeholder and are **never**
  silently replaced; a resolver offers to define them or rewrite them

**Editing**
- Canvas renderer that stays responsive at 1000 × 1000 and beyond
- Pencil, Eraser, Fill (iterative flood fill), Line, Rectangle, Eyedropper and
  rectangular Select with copy / cut / paste / duplicate
- Undo and redo with a deep history that stores diffs rather than map copies
- Zoom, pan, fit to screen, centre, reset zoom, toggleable grid
- Right-click context menus on the map, the palette and the map list

**Export / import**
- TXT, CSV (with an optional header), per-map JSON, whole-project JSON, PNG
- Import TXT, CSV and JSON tilemaps, whole projects and tile dictionaries,
  with precise validation errors instead of silent corruption

---

## Requirements

- **Node.js 18 or newer** (tested on Node 18, 20, 22 and 26)
- A modern browser: Chrome, Edge, Firefox or Safari

No database, no build step, no bundler.

---

## Installation

```bash
npm install
```

## Running the application

```bash
npm start
```

Then open **http://127.0.0.1:4173**.

During development, restart automatically on file changes:

```bash
npm run dev
```

Configure the host and port with environment variables:

```bash
PORT=5173 HOST=127.0.0.1 npm start
```

---

## A five-minute tour

1. **New project** — give it a name, a map size (for example 64 × 64) and a tile
   size in pixels (for example 32 × 32).
2. **Create a tile dictionary** — *Project ▸ Tile dictionaries ▸ New dictionary*.
   Tick "assign it to the current map".
3. **Add tiles** — the **+** button in the tile palette. Give each tile a number
   (`0`, `1`, `2` …), a name, and optionally an image and some tags.
4. **Paint** — click a tile in the palette, then draw on the map. Try the Fill
   tool (`F`), the Rectangle tool (`R`) and the Eyedropper (`I`).
5. **Export** — `Ctrl/Cmd + E`, choose **Text (.txt)**, and you have a numeric
   tilemap ready for your engine.

---

## Project structure

```text
tiley/
├── package.json
├── server.js                 Entry point: boots the HTTP server
├── README.md
├── projects/                 One folder per project (created at runtime)
│   └── <project-id>/
│       ├── project.json      The saved project
│       └── recovery.json     Autosaved snapshot of unsaved work
├── assets/
│   ├── icon.svg              Application icon
│   └── tiles/                Uploaded tile images (server-generated names)
├── data/
│   ├── dictionaries/         Tile dictionaries, one JSON file each
│   ├── settings.json         Application settings
│   └── recents.json          Recent-project list
├── src/
│   ├── backend/
│   │   ├── app.js            Express wiring, static mounts, security headers
│   │   ├── routes/           projects, dictionaries, assets, settings
│   │   ├── services/         All persistence and domain logic
│   │   └── middleware/       Async handler, central error handler
│   ├── shared/               Used by BOTH the server and the browser
│   │   ├── constants.js      Limits, tools, defaults
│   │   ├── tilemap.js        Pure grid operations (fill, resize, line …)
│   │   ├── schema.js         Validation and migration
│   │   ├── exporters.js      TXT / CSV / JSON writers
│   │   └── importers.js      Parsers with precise error messages
│   ├── utils/                Paths, safe storage, errors, ids, serialisation
│   └── frontend/
│       ├── index.html
│       ├── css/              theme.css (tokens), layout.css, components.css
│       └── js/
│           ├── main.js       Bootstrap
│           ├── store.js      State + topic-based events
│           ├── renderer.js   Canvas rendering
│           ├── tools.js      Pointer interaction
│           ├── editorActions.js  Every mutation of tile data
│           ├── history.js    Undo / redo
│           ├── commands.js   The single registry of user actions
│           └── views/        Panels, dialogs, menus
└── tests/                    Node test-runner suites
```

The frontend is served from `/frontend` and the shared modules from `/shared`,
so an import such as `../../shared/tilemap.js` resolves identically in the
browser and on disk. That is what lets the test suite exercise the very modules
the editor runs, rather than a copy of them.

---

## Data format

### Project (`projects/<id>/project.json`)

```json
{
  "formatVersion": 2,
  "id": "my-rpg-8c4851b6",
  "name": "My RPG",
  "description": "",
  "createdAt": "2026-09-12T00:40:35.075Z",
  "updatedAt": "2026-09-12T00:42:11.004Z",
  "activeMapId": "map-1351048d21464f44",
  "maps": [
    {
      "id": "map-1351048d21464f44",
      "name": "Overworld",
      "width": 3,
      "height": 3,
      "tileWidth": 32,
      "tileHeight": 32,
      "defaultTile": 0,
      "dictionaryId": "overworld-tiles-ff32f6a8",
      "metadata": {},
      "data": [
        [0,0,0],
        [0,1,0],
        [0,0,0]
      ]
    }
  ]
}
```

Tile rows are written one line per map row. A 1000 × 1000 map is about 2 MB;
fully indented JSON would be 13 MB of one-number-per-line.

### Tile dictionary (`data/dictionaries/<id>.json`)

```json
{
  "formatVersion": 1,
  "id": "overworld-tiles-ff32f6a8",
  "name": "RPG Overworld",
  "description": "",
  "createdAt": "2026-09-12T00:40:59.709Z",
  "updatedAt": "2026-09-12T00:41:02.117Z",
  "tiles": [
    {
      "id": 0,
      "name": "Grass",
      "image": "be71d6221ede7c4ff32c41dc.png",
      "description": "",
      "tags": ["terrain", "outdoor"],
      "metadata": {}
    }
  ]
}
```

`image` is the file name of an asset in `assets/tiles/`. Dictionaries live
outside projects so the same set of tiles can be shared by several maps and
several projects, and exported as a standalone file.

### Versioning and migration

Every document carries a `formatVersion`. Older projects are migrated when they
are opened and written back once:

| Version | Change |
| ------- | ------ |
| 1 | Single-map projects with tiles embedded in the project file |
| 2 | Multiple maps per project; tiles moved into shared dictionaries. Migration converts the single map and promotes the inline tiles into a new dictionary. |

A project from a *newer* format version is refused with a clear message rather
than being partially loaded.

---

## Export formats

### TXT

Each map row is a line; each tile is separated by a comma and exactly one space.
No brackets, quotes, row numbers, headers, metadata or trailing whitespace.

Given `[[0,1,2],[3,4,5],[6,7,8]]`:

```text
0, 1, 2
3, 4, 5
6, 7, 8
```

### CSV

```csv
0,1,2
3,4,5
6,7,8
```

A column header row (`x0,x1,x2`) is only added if you choose the
"CSV with a column header row" option.

### JSON (one map)

Map dimensions, tile size, tile dictionary, project metadata and the tile data:

```json
{
  "formatVersion": 2,
  "generator": "Tiley",
  "exportedAt": "2026-09-12T01:15:00.000Z",
  "project": { "id": "my-rpg-8c4851b6", "name": "My RPG", "description": "" },
  "map": {
    "id": "map-1351048d21464f44",
    "name": "Overworld",
    "size": { "width": 3, "height": 3 },
    "tileSize": { "width": 32, "height": 32 },
    "defaultTile": 0,
    "metadata": {}
  },
  "tiles": { "0": { "name": "Grass", "image": "grass.png", "description": "", "tags": [], "metadata": {} } },
  "dictionary": { "id": "overworld-tiles-ff32f6a8", "name": "RPG Overworld" },
  "data": [[0,0,0],[0,1,0],[0,0,0]]
}
```

### JSON (whole project)

Every map plus the dictionaries they use — the format accepted by
*File ▸ Import project from JSON*.

### PNG

The map rendered at 1:1 tile size using the tile images. Tiles with no image are
drawn in their palette colour; IDs missing from the dictionary are drawn as a
translucent red placeholder.

---

## Import

| Source | What is checked |
| ------ | --------------- |
| TXT / CSV tilemap | Every value is a whole number; every row has the same width; the size is reported and the map is resized to fit if you agree |
| JSON map | Same grid validation, plus a readable JSON parse error if the file is malformed |
| JSON project | Full schema validation and migration; bundled dictionaries are imported too |
| Tile dictionary | Duplicate and non-integer IDs are reported; unusable entries are skipped and listed |

Errors name the exact place, for example:

```text
Line 18, column 24 contains "x", which is not a whole number.
Row 18 contains 24 tiles, but the expected width is 25.
```

Tile IDs that are not defined in the current dictionary are imported unchanged
and shown as missing tiles — the numbers are never rewritten behind your back.

---

## Keyboard shortcuts

`Mod` is **Ctrl** on Windows and Linux, **Cmd** on macOS.
The full list is also in the application under *Help ▸ Keyboard shortcuts*.

**Tools**

| Shortcut | Action |
| -------- | ------ |
| `P` | Pencil |
| `E` | Eraser |
| `F` | Fill |
| `L` | Line |
| `R` | Rectangle |
| `I` | Eyedropper |
| `S` | Select |

**File and edit**

| Shortcut | Action |
| -------- | ------ |
| `Mod + N` | New project |
| `Mod + O` | Project browser |
| `Mod + S` | Save |
| `Mod + Shift + S` | Save as |
| `Mod + Z` | Undo |
| `Mod + Shift + Z` / `Mod + Y` | Redo |
| `Mod + X` / `Mod + C` / `Mod + V` | Cut / copy / paste selection |
| `Mod + D` | Duplicate selection |
| `Mod + A` | Select the whole map |
| `Delete` | Erase the selected cells |
| `Escape` | Cancel the current operation or clear the selection |

**View and project**

| Shortcut | Action |
| -------- | ------ |
| `+` / `-` | Zoom in / out |
| `Mod + 0` | Reset zoom to 100% |
| `Shift + F` | Fit the map to the screen |
| `G` | Toggle the grid |
| `Mod + R` | Resize map |
| `Mod + K` | Tile dictionaries |
| `Mod + E` | Export |
| `Mod + Shift + E` | Quick export in the default format |
| `Mod + ,` | Settings |
| `?` | Keyboard shortcuts |

**Mouse**

| Input | Action |
| ----- | ------ |
| Left drag | Apply the current tool |
| Middle drag, or `Space` + drag | Pan |
| Wheel / pinch | Zoom about the pointer |
| `Shift` / `Alt` + wheel | Pan horizontally / vertically |
| Right click | Context menu |
| `Shift` while dragging a rectangle | Outline instead of filled |

While a selection is active, the drawing tools only affect cells inside it.

---

## Server API

All endpoints return JSON. Errors have the shape
`{ "error": { "message": "...", "code": "...", "problems": ["..."] } }`;
stack traces are logged server-side and never sent to the browser.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/projects?q=` | List projects (optionally filtered) |
| `POST` | `/api/projects` | Create a project |
| `POST` | `/api/projects/import` | Import a project document |
| `GET` | `/api/projects/recents` | Recent projects |
| `DELETE` | `/api/projects/recents/:id` | Forget a recent entry (keeps the project) |
| `GET` | `/api/projects/:id` | Load a project (migrating it if needed) |
| `PUT` | `/api/projects/:id` | Save a project (validated before writing) |
| `PATCH` | `/api/projects/:id` | Rename a project |
| `DELETE` | `/api/projects/:id` | Delete a project |
| `POST` | `/api/projects/:id/duplicate` | Duplicate a project |
| `GET/POST/DELETE` | `/api/projects/:id/recovery` | Read, write or discard the recovery snapshot |
| `GET` | `/api/projects/:id/maps` | List maps (without tile data) |
| `POST` | `/api/projects/:id/maps` | Add a map |
| `PUT` | `/api/projects/:id/maps/:mapId` | Rename, resize or re-point a map |
| `DELETE` | `/api/projects/:id/maps/:mapId` | Delete a map |
| `GET` | `/api/dictionaries` | List tile dictionaries |
| `POST` | `/api/dictionaries` | Create a dictionary |
| `POST` | `/api/dictionaries/import` | Import a dictionary file |
| `GET` | `/api/dictionaries/:id` | Load a dictionary |
| `PUT` | `/api/dictionaries/:id` | Replace name, description or tile list |
| `PATCH` | `/api/dictionaries/:id` | Rename |
| `POST` | `/api/dictionaries/:id/duplicate` | Duplicate |
| `DELETE` | `/api/dictionaries/:id` | Delete |
| `POST` | `/api/dictionaries/:id/tiles` | Add a tile |
| `PUT` | `/api/dictionaries/:id/tiles/:tileId` | Edit a tile (including its ID) |
| `DELETE` | `/api/dictionaries/:id/tiles/:tileId` | Delete a tile |
| `GET` | `/api/assets` | List uploaded tile images |
| `POST` | `/api/assets` | Upload an image (multipart field `image`) |
| `DELETE` | `/api/assets/:id` | Delete an image |
| `GET/PUT` | `/api/settings` | Read and update settings |
| `POST` | `/api/settings/reset` | Restore default settings |

There is no general-purpose filesystem endpoint: the browser can only reach the
application's own `projects/`, `data/` and `assets/` directories, through these
routes.

---

## Development

```bash
npm run dev     # restart on change
npm test        # run the test suite
```

There is no build step — the browser loads the ES modules directly, so an edit
is visible after a refresh.

Conventions worth knowing before changing the code:

- **`src/shared` must stay dependency-free.** It runs in Node and in the
  browser; anything touching `fs` or the DOM belongs elsewhere.
- **All tile-data mutations go through `editorActions.js`**, which is where undo
  recording, selection clipping and dirty-marking live.
- **All user actions are declared in `commands.js`.** The menus, the keyboard
  handler and the shortcut sheet are generated from it, so a shortcut shown in a
  menu is by construction the one that runs.
- **Every path the server touches is built in `utils/paths.js`** via
  `resolveWithin`, which guarantees it stays inside the data directories.

## Testing

```bash
npm test
```

The suite (Node's built-in test runner, no extra dependencies) covers:

- **Tilemap** — creating, painting, erasing, flood fill (including a 1000 × 1000
  fill that would overflow a recursive implementation), lines, rectangles,
  resizing with every anchor, copy/paste, and rejection of invalid map data
- **Editor** — undo/redo including multi-cell strokes, selection clipping,
  clipboard operations, resize undo, and the packed representation used for very
  large edits — tested against the real editor modules
- **Projects** — create, save, load, rename, duplicate, delete, recent-project
  handling, recovery snapshots, schema validation and version migration
- **Dictionaries** — tile creation, duplicate IDs, deletion, import/export and
  missing-tile handling
- **Export** — that TXT output is exactly `0, 1, 2\n3, 4, 5\n6, 7, 8` and CSV is
  valid comma-separated data with no added metadata
- **Import** — precise error messages for ragged rows, non-integer values,
  blank lines and dimension mismatches
- **API and security** — path-traversal attempts, uploads that only claim to be
  images, oversized and unsupported files, malformed JSON bodies

Tests create documents with a unique prefix and delete them afterwards.

## Production deployment

Tiley is a local-first desktop-style tool: it has no authentication and assumes
the person using it owns the files. Run it on `127.0.0.1` (the default).

To run it as a long-lived service on a machine you control:

```bash
npm ci --omit=dev
PORT=4173 HOST=127.0.0.1 NODE_ENV=production node server.js
```

A minimal `systemd` unit:

```ini
[Service]
WorkingDirectory=/opt/tiley
ExecStart=/usr/bin/node server.js
Environment=PORT=4173 HOST=127.0.0.1 NODE_ENV=production
Restart=on-failure
```

If you expose it beyond your own machine, put it behind a reverse proxy that
provides TLS **and** authentication, and back up `projects/`, `data/` and
`assets/` — they are the whole application state.

## Security notes

- Uploaded files are validated by magic bytes, not by their name or declared
  type; the client's filename is discarded and replaced with a random one
- Uploads are capped at 8 MB and served with a fixed content type and
  `X-Content-Type-Options: nosniff`, so nothing uploaded can be executed
- Every path is contained inside the application's data directories; traversal
  attempts are rejected before any filesystem call
- Project and dictionary documents are validated before writing and after
  reading; damaged files produce a readable error, never a crash
- Writes are atomic (temporary file plus rename) and serialised per file, so a
  crash or two concurrent saves cannot leave a half-written project
- A conservative Content-Security-Policy keeps the editor to its own origin

## Troubleshooting

**`Port 4173 is already in use`**
Start on another port: `PORT=5173 npm start`.

**"Tiley could not reach the local server"**
The Node process stopped. Restart it with `npm start`; your work is recoverable
(see below).

**"A recovered version is available" when opening a project**
Tiley saves a snapshot of unsaved changes every few seconds. Choose *Restore* to
load it, or *Discard* to open the last explicitly saved version. The saved
project file is never overwritten without your confirmation.

**My whole map is drawn as red "missing" tiles**
The map's dictionary has no definition for those IDs. Use *Resolve missing
tiles* in the palette to define them, or point the map at the right dictionary.
The numbers in the map are unchanged.

**A project shows as "damaged" in the browser**
The JSON file failed validation. The card lists the specific problems. The file
is left untouched so you can fix it by hand; `project.json` is ordinary JSON.

**Editing feels slow on a very large map**
Zoom in: below about four pixels per cell the editor switches to a fast
pixel-per-cell overview mode, which redraws the whole visible map every frame.
At normal editing zoom levels only the visible cells are drawn.

**Uploads are rejected**
Tile images must really be PNG, JPEG or WebP and 8 MB or smaller. A renamed file
(for example a `.gif` saved as `.png`) is refused by the signature check.

---

## Licence

MIT.
