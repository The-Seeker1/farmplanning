const SVG_NS = 'http://www.w3.org/2000/svg';
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction']);

export function safeUrl(u) {
  try {
    const url = new URL(u, 'https://placeholder.invalid/');
    return url.protocol === 'https:' || url.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

function append(element, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) child.forEach((c) => append(element, c));
  else if (child instanceof Node) element.appendChild(child);
  else element.appendChild(document.createTextNode(String(child)));
}

function applyProps(element, props, isSvg) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'innerHTML' || k === 'outerHTML' || k === 'srcdoc') throw new Error(`dom.h: ${k} is not allowed`);
    if (k === 'class') element.setAttribute('class', v);
    else if (k === 'dataset') Object.assign(element.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(element.style, v);
    else if (k.startsWith('on')) {
      if (typeof v !== 'function') throw new Error(`dom.h: ${k} must be a function`);
      element.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (URL_ATTRS.has(k)) {
      const ok = safeUrl(String(v));
      if (ok) element.setAttribute(k, ok);
    } else if (!isSvg && (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'indeterminate')) element[k] = v;
    else element.setAttribute(k, v === true ? '' : String(v));
  }
}

export function h(tag, props, ...children) {
  const element = document.createElement(tag);
  applyProps(element, props, false);
  children.forEach((c) => append(element, c));
  return element;
}

export function s(tag, props, ...children) {
  const element = document.createElementNS(SVG_NS, tag);
  applyProps(element, props, true);
  children.forEach((c) => append(element, c));
  return element;
}

export function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
  return element;
}

export const money = (n, d = 0) => {
  if (!Number.isFinite(n)) return '-';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
export const num = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '-');
export const pct = (n, d = 0) => (Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : '-');

export function debounce(listener, milliseconds) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => listener(...a), milliseconds);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    listener(...a);
  };
  return d;
}

export function downloadText(filename, text, mimeType = 'application/json') {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
