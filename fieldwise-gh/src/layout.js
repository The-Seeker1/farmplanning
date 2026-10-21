import { polygonArea, orientedBoundingBox } from './geo.js';

export function clipHalfPlane(polygon, normalX, normalY, c) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const distA = normalX * a.x + normalY * a.y - c;
    const distB = normalX * b.x + normalY * b.y - c;
    if (distA <= 0) out.push(a);
    if ((distA < 0 && distB > 0) || (distA > 0 && distB < 0)) {
      const t = distA / (distA - distB);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export function autoPartition(polygon, items) {
  const total = polygonArea(polygon);
  if (polygon.length < 3 || total <= 0) return [];
  const clean = items.map((i) => ({ id: i.id, fraction: Math.max(0, Number(i.fraction) || 0) })).filter((i) => i.fraction > 0);
  if (!clean.length) return [];
  const sum = clean.reduce((s, i) => s + i.fraction, 0);
  const scale = sum > 1 ? 1 / sum : 1;

  const box = orientedBoundingBox(polygon);
  const dirX = Math.cos(box.angle);
  const dirY = Math.sin(box.angle);
  let lowest = Infinity;
  let highest = -Infinity;
  for (const p of polygon) {
    const t = dirX * p.x + dirY * p.y;
    if (t < lowest) lowest = t;
    if (t > highest) highest = t;
  }
  const areaBelow = (t) => {
    const c = clipHalfPlane(polygon, dirX, dirY, t);
    return c.length >= 3 ? polygonArea(c) : 0;
  };
  const cutFor = (target) => {
    let low = lowest;
    let high = highest;
    for (let k = 0; k < 60; k++) {
      const middle = (low + high) / 2;
      if (areaBelow(middle) < target) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  const strip = (t0, t1) => {
    const a = clipHalfPlane(polygon, dirX, dirY, t1);
    if (a.length < 3) return [];
    const b = clipHalfPlane(a, -dirX, -dirY, -t0);
    return b.length >= 3 ? b : [];
  };

  const out = [];
  let runningTotal = 0;
  let prevT = lowest - 1e-6;
  for (const it of clean) {
    runningTotal += it.fraction * scale;
    const t = runningTotal >= 0.999999 ? highest + 1e-6 : cutFor(runningTotal * total);
    const polygon = strip(prevT, t);
    out.push({ id: it.id, polygon, areaM2: polygon.length >= 3 ? polygonArea(polygon) : 0 });
    prevT = t;
  }
  if (runningTotal < 0.999999) {
    const polygon = strip(prevT, highest + 1e-6);
    out.push({ id: '__rest', polygon, areaM2: polygon.length >= 3 ? polygonArea(polygon) : 0 });
  }
  return out;
}

export function scanlines(polygon, angle, spacing, { inset = 0, maxRows = 500 } = {}) {
  if (polygon.length < 3 || spacing <= 0) return [];
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const rotated = polygon.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rotated) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  let step = spacing;
  if ((maxY - minY) / step > maxRows) step = (maxY - minY) / maxRows;
  const back = (x, y) => ({ x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) });
  const out = [];
  for (let y = minY + step / 2; y < maxY; y += step) {
    const xList = [];
    for (let i = 0; i < rotated.length; i++) {
      const a = rotated[i];
      const b = rotated[(i + 1) % rotated.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xList.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xList.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xList.length; k += 2) {
      const x0 = xList[k] + inset;
      const x1 = xList[k + 1] - inset;
      if (x1 - x0 > 0.5) out.push({ a: back(x0, y), b: back(x1, y) });
    }
  }
  return out;
}
