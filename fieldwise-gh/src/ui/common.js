import { h, clear } from './dom.js';
import { SOURCES, CONFIDENCE_LABEL, sourceOf } from '../data/sources.js';

let toastArea;
export function toast(message, kind = '', milliseconds = 4500) {
  if (!toastArea) {
    toastArea = h('div', { class: 'toast-area', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastArea);
  }
  const t = h('div', { class: `toast ${kind}` }, message);
  toastArea.appendChild(t);
  setTimeout(() => t.remove(), milliseconds);
}

export function showModal(build, { dismissable = true } = {}) {
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  back.appendChild(box);
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) close();
  };
  document.addEventListener('keydown', onKey);
  if (dismissable) back.addEventListener('mousedown', (e) => e.target === back && close());
  build(box, close);
  document.body.appendChild(back);
  const first = box.querySelector('input,select,textarea,button');
  first?.focus();
  return close;
}

export function askText(title, value = '', { label = 'Name', max = 60 } = {}) {
  return new Promise((resolve) => {
    showModal((box, close) => {
      const input = h('input', { type: 'text', value, maxlength: max, 'aria-label': label });
      const done = (v) => {
        close();
        resolve(v);
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && done(input.value.trim() || null));
      box.append(h('h3', {}, title), h('div', { class: 'field' }, input), h('div', { class: 'row' }, h('button', { onclick: () => done(input.value.trim() || null) }, 'OK'), h('button', { class: 'secondary', onclick: () => done(null) }, 'Cancel')));
    });
  });
}

export function askConfirm(message, { yes = 'Yes', danger = false } = {}) {
  return new Promise((resolve) => {
    showModal((box, close) => {
      const done = (v) => {
        close();
        resolve(v);
      };
      box.append(h('p', {}, message), h('div', { class: 'row' }, h('button', { class: danger ? 'danger' : '', onclick: () => done(true) }, yes), h('button', { class: 'secondary', onclick: () => done(false) }, 'Cancel')));
    });
  });
}

export function field(label, control, hint = '') {
  const id = `f_${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function numberInput({ value, min, max, step = 'any', key, placeholder = '', onChange }) {
  const element = h('input', { type: 'number', inputmode: 'decimal', min, max, step, placeholder, 'data-key': key });
  element.value = value ?? '';
  element.addEventListener('change', () => {
    const response = element.value.trim();
    if (response === '') return onChange(null);
    const n = Number(response);
    if (!Number.isFinite(n)) return;
    onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  });
  return element;
}

export function selectInput({ value, options, key, onChange }) {
  const element = h('select', { 'data-key': key }, options.map((o) => h('option', { value: o.value ?? '' }, o.label)));
  element.value = value ?? '';
  element.addEventListener('change', () => onChange(element.value === '' ? null : element.value));
  return element;
}

export function textInput({ value, key, maxlength = 120, placeholder = '', onChange }) {
  const element = h('input', { type: 'text', maxlength, placeholder, 'data-key': key });
  element.value = value ?? '';
  element.addEventListener('change', () => onChange(element.value.trim()));
  return element;
}

export function sourceBadge(srcId, text = null) {
  const source = sourceOf(srcId);
  return h('span', { class: `badge ${source.confidence}`, title: source.title }, text || CONFIDENCE_LABEL[source.confidence]);
}

export function sourceList(ids) {
  const uniq = [...new Set(ids.flat())].filter((id) => SOURCES[id] && SOURCES[id].url);
  return h('ul', { class: 'small' }, uniq.map((id) => h('li', {}, h('a', { href: SOURCES[id].url, target: '_blank', rel: 'noopener noreferrer' }, SOURCES[id].title))));
}

export function callout(kind, ...children) {
  return h('div', { class: `callout ${kind}`, role: kind === 'bad' ? 'alert' : null }, children);
}

export function emptyState(title, text, action = null) {
  return h('div', { class: 'card tint-gold' }, h('h3', {}, title), h('p', {}, text), action);
}

export { clear };
