/**
 * Modal dialogs and a small declarative form builder.
 *
 * Everything that needs user input (new project, resize, tile editor, settings)
 * is built from `openForm`, so validation display, focus handling, Escape/Enter
 * behaviour and button layout exist in exactly one place.
 */

import { el, $, clear } from './dom.js';

let openCount = 0;

/**
 * Open a modal.
 * @returns {{ close: Function, element: HTMLElement }}
 */
export function openModal({ title, body, footer, wide = false, onClose, dismissible = true }) {
  const root = $('#modal-root');
  const previouslyFocused = document.activeElement;

  const modal = el('div', { class: `modal${wide ? ' wide' : ''}`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } }, [
    el('div', { class: 'modal-header' }, [
      el('h2', { text: title }),
      dismissible ? el('button', { class: 'icon-button', text: '✕', attrs: { 'aria-label': 'Close dialog' }, on: { click: () => close() } }) : null
    ]),
    el('div', { class: 'modal-body' }, body ? [body].flat() : []),
    footer ? el('div', { class: 'modal-footer' }, [footer].flat()) : null
  ]);

  const backdrop = el('div', { class: 'modal-backdrop' }, [modal]);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop && dismissible) close();
  });

  function onKeyDown(event) {
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') trapFocus(event, modal);
  }

  backdrop.addEventListener('keydown', onKeyDown);
  root.append(backdrop);
  openCount += 1;

  // Focus the first meaningful control.
  const focusTarget = modal.querySelector('input, select, textarea, button.primary, button');
  focusTarget?.focus();

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    openCount -= 1;
    backdrop.remove();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    onClose?.(result);
  }

  return { close, element: modal, backdrop };
}

export const isModalOpen = () => openCount > 0;

function trapFocus(event, container) {
  const focusable = [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((node) => node.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------ confirm --- */

/**
 * Confirmation dialog. Resolves `true` only when the user confirms.
 * Destructive confirmations use a danger-styled button and never auto-focus it.
 */
export function confirmDialog({ title, message, details = [], confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, dismissible = true }) {
  return new Promise((resolve) => {
    const body = el('div', { class: 'modal-body-inner' }, [
      el('p', { text: message }),
      details.length > 0
        ? el('div', { class: `notice ${danger ? 'danger' : 'warning'}` }, [
            el('ul', {}, details.map((detail) => el('li', { text: detail })))
          ])
        : null
    ]);

    const cancel = el('button', { class: 'button', text: cancelLabel, on: { click: () => handle(false) } });
    const confirm = el('button', {
      class: `button ${danger ? 'danger' : 'primary'}`,
      text: confirmLabel,
      on: { click: () => handle(true) }
    });

    const { close } = openModal({ title, body, footer: [cancel, confirm], dismissible, onClose: () => resolve(settled ?? false) });
    let settled = null;
    function handle(value) {
      settled = value;
      close();
    }
    cancel.focus();
  });
}

/* --------------------------------------------------------------- forms --- */

/**
 * Build a labelled control from a field definition.
 * Supported types: text, number, select, checkbox, range, textarea, tags,
 * static (read-only content) and custom (caller-supplied node).
 */
function buildField(field, values) {
  const id = `field-${field.name}-${Math.random().toString(36).slice(2, 8)}`;
  const value = values[field.name] ?? field.value ?? '';

  if (field.type === 'custom') return field.render(values);
  if (field.type === 'static') return el('div', { class: 'notice' }, [field.content]);

  if (field.type === 'checkbox') {
    const input = el('input', { type: 'checkbox', id, checked: Boolean(value), name: field.name });
    return el('label', { class: 'checkbox-field', attrs: { for: id } }, [
      input,
      el('span', {}, [field.label, field.hint ? el('div', { class: 'field-hint', text: field.hint }) : null])
    ]);
  }

  let input;
  if (field.type === 'select') {
    input = el('select', { id, name: field.name },
      field.options.map((option) => el('option', {
        value: String(option.value),
        text: option.label,
        selected: String(option.value) === String(value)
      })));
  } else if (field.type === 'textarea') {
    input = el('textarea', { id, name: field.name, rows: field.rows ?? 3, value: String(value), placeholder: field.placeholder ?? '' });
  } else {
    input = el('input', {
      id,
      name: field.name,
      type: field.type ?? 'text',
      value: String(value),
      placeholder: field.placeholder ?? '',
      autocomplete: 'off'
    });
    if (field.type === 'number' || field.type === 'range') {
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      if (field.step !== undefined) input.step = String(field.step);
    }
  }

  return el('label', { class: 'field', attrs: { for: id } }, [
    el('span', { class: 'field-label', text: field.label }),
    input,
    field.hint ? el('span', { class: 'field-hint', text: field.hint }) : null
  ]);
}

/** Read the current values of every field in a form container. */
function readValues(container, fields) {
  const values = {};
  for (const field of fields) {
    if (field.type === 'static' || field.type === 'custom') continue;
    const input = container.querySelector(`[name="${field.name}"]`);
    if (!input) continue;
    if (field.type === 'checkbox') values[field.name] = input.checked;
    else if (field.type === 'number' || field.type === 'range') values[field.name] = input.value === '' ? NaN : Number(input.value);
    else values[field.name] = input.value;
  }
  return values;
}

/**
 * Open a form dialog.
 *
 * `validate(values)` returns an array of problem strings; a non-empty array
 * keeps the dialog open and lists the problems above the fields.
 * `onSubmit(values)` may be async and may throw to keep the dialog open.
 */
export function openForm({
  title,
  fields,
  values = {},
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  wide = false,
  intro = null,
  validate = () => [],
  onSubmit
}) {
  return new Promise((resolve) => {
    const errorBox = el('div', { class: 'notice danger', hidden: true });
    const rows = [];
    let row = null;
    for (const field of fields) {
      const node = buildField(field, values);
      if (field.half) {
        if (!row) { row = el('div', { class: 'form-row' }); rows.push(row); }
        row.append(node);
        if (row.childElementCount === 2) row = null;
      } else {
        row = null;
        rows.push(node);
      }
    }

    const form = el('form', { class: 'modal-form', on: { submit: (event) => { event.preventDefault(); submit(); } } }, [
      intro ? (typeof intro === 'string' ? el('p', { class: 'muted', text: intro }) : intro) : null,
      errorBox,
      ...rows
    ]);

    const cancel = el('button', { type: 'button', class: 'button', text: cancelLabel, on: { click: () => close() } });
    const submitButton = el('button', { type: 'submit', class: 'button primary', text: submitLabel, on: { click: (event) => { event.preventDefault(); submit(); } } });

    const modal = openModal({ title, body: form, footer: [cancel, submitButton], wide, onClose: () => resolve(result) });
    let result = null;
    let busy = false;

    async function submit() {
      if (busy) return;
      const values = readValues(form, fields);
      const problems = validate(values) ?? [];
      if (problems.length > 0) {
        showProblems(problems);
        return;
      }
      busy = true;
      submitButton.disabled = true;
      submitButton.textContent = 'Working…';
      try {
        result = (await onSubmit(values)) ?? values;
        close(result);
      } catch (error) {
        showProblems([error.message, ...(error.problems ?? [])].filter(Boolean));
      } finally {
        busy = false;
        submitButton.disabled = false;
        submitButton.textContent = submitLabel;
      }
    }

    function showProblems(problems) {
      clear(errorBox);
      errorBox.append(el('strong', { text: problems.length === 1 ? 'There is a problem:' : 'There are problems:' }));
      errorBox.append(el('ul', {}, problems.map((problem) => el('li', { text: problem }))));
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
    }

    function close() {
      modal.close();
    }
  });
}
