/**
 * Tile image cache.
 *
 * Two things are cached per image URL:
 *   - the decoded `Image`, drawn directly when cells are large enough;
 *   - a single average colour, used when the map is zoomed far out and drawing
 *     thousands of scaled bitmaps would be both slow and unreadable.
 *
 * Loads are deduplicated and a repaint is requested when an image arrives.
 */

const images = new Map();   // url -> { image, status, color }
const listeners = new Set();

export function onImagesChanged(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function notify() {
  for (const handler of listeners) handler();
}

/** Average colour of an image, computed once by downscaling it to 1x1. */
function averageColor(image) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null;
    return [r, g, b];
  } catch {
    return null;
  }
}

/** Look up a cached entry, starting a load if this URL is new. */
export function getImageEntry(url) {
  if (!url) return null;
  const existing = images.get(url);
  if (existing) return existing;

  const entry = { image: null, status: 'loading', color: null };
  images.set(url, entry);

  const image = new Image();
  image.decoding = 'async';
  image.addEventListener('load', () => {
    entry.image = image;
    entry.status = 'ready';
    entry.color = averageColor(image);
    notify();
  });
  image.addEventListener('error', () => {
    entry.status = 'error';
    notify();
  });
  image.src = url;
  return entry;
}

/** Warm the cache for a whole dictionary. */
export function preloadDictionary(dictionary) {
  for (const tile of dictionary?.tiles ?? []) {
    if (tile.image) getImageEntry(tileImageUrl(tile));
  }
}

/** Resolve a tile's stored asset id to a servable URL. */
export function tileImageUrl(tile) {
  if (!tile?.image) return null;
  return tile.image.startsWith('/') ? tile.image : `/assets/tiles/${tile.image}`;
}

/**
 * Deterministic fallback colour for tiles that have no image yet.
 * The hue is offset away from red, which is reserved for missing tiles.
 */
export function fallbackColor(tileId) {
  const hue = (tileId * 47 + 150) % 360;
  return `hsl(${hue} 42% 44%)`;
}

export function clearImageCache() {
  images.clear();
}
