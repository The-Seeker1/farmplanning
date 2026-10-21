export const M2_PER_ACRE = 4046.8564224;
export const FT_PER_M = 3.280839895;

export const toAcres = (squareMeters) => squareMeters / M2_PER_ACRE;
export const toFeet = (m) => m * FT_PER_M;
export const fromFeet = (feet) => feet / FT_PER_M;

const R_EARTH = 6378137;
const toRadians = (d) => (d * Math.PI) / 180;
const toDegrees = (r) => (r * 180) / Math.PI;

export function makeProjection(origin) {
  const startLat = toRadians(origin.lat);
  const cosLat = Math.cos(startLat);
  return {
    origin,
    toLocal({ lat, lon }) {
      return { x: R_EARTH * toRadians(lon - origin.lon) * cosLat, y: R_EARTH * toRadians(lat - origin.lat) };
    },
    toLatLon({ x, y }) {
      return { lat: origin.lat + toDegrees(y / R_EARTH), lon: origin.lon + toDegrees(x / (R_EARTH * cosLat)) };
    },
  };
}

export function signedArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const polygonArea = (points) => (points.length < 3 ? 0 : Math.abs(signedArea(points)));

export function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

export const polygonPerimeter = (points) =>
  points.length < 2 ? 0 : polylineLength(points) + Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y);

export function polygonCentroid(points) {
  const a = signedArea(points);
  if (Math.abs(a) < 1e-9) {
    const n = points.length || 1;
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
  }
  let centerX = 0;
  let centerY = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p.x * q.y - q.x * p.y;
    centerX += (p.x + q.x) * f;
    centerY += (p.y + q.y) * f;
  }
  return { x: centerX / (6 * a), y: centerY / (6 * a) };
}

export function bbox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function convexHull(points) {
  const shapePoints = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (shapePoints.length <= 2) return shapePoints;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of shapePoints) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = shapePoints.length - 1; i >= 0; i--) {
    const p = shapePoints[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function orientedBoundingBox(points) {
  if (points.length < 3) return { length: 0, width: 0, angle: 0, center: points[0] || { x: 0, y: 0 }, corners: [] };
  const hull = convexHull(points);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    const theta = Math.atan2(q.y - p.y, q.x - p.x);
    const c = Math.cos(-theta);
    const s = Math.sin(-theta);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const h of hull) {
      const rx = h.x * c - h.y * s;
      const ry = h.x * s + h.y * c;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (!best || w * h < best.area - 1e-9) best = { area: w * h, theta, minX, maxX, minY, maxY, w, h };
  }
  const { theta, minX, maxX, minY, maxY } = best;
  const back = (x, y) => ({
    x: x * Math.cos(theta) - y * Math.sin(theta),
    y: x * Math.sin(theta) + y * Math.cos(theta),
  });
  const corners = [back(minX, minY), back(maxX, minY), back(maxX, maxY), back(minX, maxY)];
  const center = back((minX + maxX) / 2, (minY + maxY) / 2);
  const longIsW = best.w >= best.h;
  let angle = longIsW ? theta : theta + Math.PI / 2;
  angle = ((angle % Math.PI) + Math.PI) % Math.PI;
  return { length: Math.max(best.w, best.h), width: Math.min(best.w, best.h), angle, center, corners };
}

export function fieldDimensions(points) {
  const area = polygonArea(points);
  const perim = polygonPerimeter(points);
  const box = orientedBoundingBox(points);
  const half = perim / 2;
  const discriminant = half * half - 4 * area;
  let equivalent = null;
  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    equivalent = { length: (half + root) / 2, width: (half - root) / 2 };
  }
  return {
    areaM2: area,
    acres: toAcres(area),
    perimeterM: perim,
    perimeterFt: toFeet(perim),
    boxLengthFt: toFeet(box.length),
    boxWidthFt: toFeet(box.width),
    boxAngle: box.angle,
    boxFill: box.length * box.width > 0 ? area / (box.length * box.width) : 0,
    equivLengthFt: equivalent ? toFeet(equivalent.length) : null,
    equivWidthFt: equivalent ? toFeet(equivalent.width) : null,
    box,
  };
}

export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segIntersect(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

export function isSimplePolygon(points) {
  const n = points.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segIntersect(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function fencePosts(line, spacingM, closed = false) {
  const points = closed ? [...line, line[0]] : line;
  const posts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) continue;
    const spans = Math.max(1, Math.ceil(length / spacingM - 1e-9));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    for (let k = 0; k < spans; k++) {
      const t = k / spans;
      posts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle, corner: k === 0 });
    }
  }
  const last = points[points.length - 1];
  if (!closed && last) posts.push({ x: last.x, y: last.y, angle: posts.length ? posts[posts.length - 1].angle : 0, corner: true });
  return posts;
}

export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scatterInPolygon(polygon, n, seed = 7) {
  if (n <= 0 || polygon.length < 3) return [];
  const random = seededRng(seed);
  const box = bbox(polygon);
  const area = polygonArea(polygon);
  const cell = Math.sqrt(area / n) || 1;
  const out = [];
  for (let y = box.minY + cell / 2; y < box.maxY + cell / 2; y += cell) {
    for (let x = box.minX + cell / 2; x < box.maxX + cell / 2; x += cell) {
      const p = { x: x + (random() - 0.5) * cell * 0.7, y: y + (random() - 0.5) * cell * 0.7 };
      if (pointInPolygon(p, polygon)) out.push(p);
    }
  }
  let guard = 0;
  while (out.length < n && guard++ < n * 200) {
    const p = { x: box.minX + random() * box.width, y: box.minY + random() * box.height };
    if (pointInPolygon(p, polygon)) out.push(p);
  }
  if (out.length > n) {
    const step = out.length / n;
    return Array.from({ length: n }, (_, i) => out[Math.floor(i * step)]);
  }
  return out;
}

export function rectPolygon(lengthM, widthM, centerX = 0, centerY = 0) {
  const halfLength = lengthM / 2;
  const halfWidth = widthM / 2;
  return [
    { x: centerX - halfLength, y: centerY - halfWidth },
    { x: centerX + halfLength, y: centerY - halfWidth },
    { x: centerX + halfLength, y: centerY + halfWidth },
    { x: centerX - halfLength, y: centerY + halfWidth },
  ];
}

export function ensureCCW(points) {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

export function sanitizePoint(p, limit = 50000) {
  const x = Number(p?.x);
  const y = Number(p?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > limit || Math.abs(y) > limit) return null;
  return { x, y };
}
