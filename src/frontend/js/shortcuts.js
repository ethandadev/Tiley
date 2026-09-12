/**
 * Keyboard handling.
 *
 * Accelerators are matched against the command registry. Shortcuts are
 * suppressed while typing in a field or while a modal is open, and any
 * accelerator that matches a command calls `preventDefault` so the browser's
 * own binding (Cmd+S "save page", Cmd+D "bookmark") never fires instead.
 */

import { commands, isEnabled } from './commands.js';
import { isTypingTarget, IS_MAC } from './dom.js';
import { isModalOpen } from './modal.js';

/** Parse "Mod+Shift+S" into a matcher. */
function parseAccelerator(accelerator) {
  const parts = accelerator.split('+');
  const key = parts.pop().toLowerCase();
  return {
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key
  };
}

function matches(event, accelerator) {
  const target = parseAccelerator(accelerator);
  const modPressed = IS_MAC ? event.metaKey : event.ctrlKey;
  if (target.mod !== modPressed) return false;

  // "?" is typed with Shift on most layouts, so it declares its own rule.
  if (target.key === '?') return event.key === '?';

  if (target.shift !== event.shiftKey) return false;
  if (target.alt !== event.altKey) return false;
  // The non-Mod modifier must not be held either, or "Ctrl+Z" would fire on "Cmd+Ctrl+Z".
  if (!target.mod && (IS_MAC ? event.ctrlKey : event.metaKey)) return false;

  const key = event.key.toLowerCase();
  if (target.key === '+') return key === '+' || key === '=' || event.code === 'NumpadAdd';
  if (target.key === '-') return key === '-' || key === '_' || event.code === 'NumpadSubtract';
  if (target.key === '?') return key === '?' || (key === '/' && event.shiftKey);
  if (target.key === 'delete') return key === 'delete' || key === 'backspace';
  return key === target.key;
}

export function initShortcuts() {
  window.addEventListener('keydown', (event) => {
    // Escape still works inside dialogs (handled by the modal itself).
    if (isModalOpen()) return;
    if (isTypingTarget(event.target) && event.key !== 'Escape') return;

    for (const command of commands) {
      if (!command.accelerator || command.separator) continue;
      if (!matches(event, command.accelerator)) continue;
      event.preventDefault();
      event.stopPropagation();
      if (isEnabled(command)) command.run();
      return;
    }
  });
}
