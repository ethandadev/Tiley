/** Transient notifications. Errors stay until dismissed; successes fade. */

import { el, $ } from './dom.js';

const root = () => $('#toast-root');

function show(kind, title, message, problems = [], timeout) {
  const node = el('div', { class: `toast ${kind}` }, [
    el('div', { class: 'toast-content' }, [
      el('div', { class: 'toast-title', text: title }),
      message ? el('div', { class: 'muted', text: message }) : null,
      problems.length > 0 ? el('ul', {}, problems.slice(0, 6).map((problem) => el('li', { text: problem }))) : null
    ]),
    el('button', {
      class: 'button ghost small',
      text: 'Dismiss',
      attrs: { 'aria-label': 'Dismiss notification' },
      on: { click: () => node.remove() }
    })
  ]);
  root().append(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
  return node;
}

export const toastSuccess = (title, message = '') => show('success', title, message, [], 3200);
export const toastInfo = (title, message = '') => show('info', title, message, [], 4200);
export const toastWarning = (title, message = '', problems = []) => show('warning', title, message, problems, 7000);
export const toastError = (title, message = '', problems = []) => show('error', title, message, problems);

/** Show an ApiError (or any Error) without leaking internals. */
export function toastApiError(fallbackTitle, error) {
  const message = error?.message ?? 'An unexpected problem occurred.';
  return toastError(fallbackTitle, message, error?.problems ?? []);
}
