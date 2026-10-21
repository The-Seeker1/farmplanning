import { SLOPE_WORD_PCT } from './scene.js';
import { pointInPolygon } from './geo.js';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_SIDE = 1024;

export function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function rgbToHsv(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === red) hue = ((green - blue) / d) % 6;
    else if (max === green) hue = (blue - red) / d + 2;
    else hue = (red - green) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: max === 0 ? 0 : d / max, v: max };
}

export function classifyPixel(r, g, b, { kind = 'ground', yFrac = 0.5 } = {}) {
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.13) return null;
  if (kind === 'ground' && h >= 185 && h <= 255 && s < 0.65 && v > 0.82) return null;
  if (kind === 'ground' && yFrac < 0.45) {
    if (h >= 185 && h <= 255 && s < 0.65 && v > 0.55) return null;
    if (s < 0.14 && v > 0.72) return null;
  }
  if (h >= 175 && h <= 255 && s > 0.22 && v < 0.78) return 'water';
  if (h >= 65 && h <= 170 && s > 0.15) return v < 0.36 ? 'trees' : 'grass';
  if (h >= 40 && h < 65 && s > 0.18) return 'grass';
  if (h >= 6 && h < 40 && s >= 0.16 && v >= 0.2) return 'bare_soil';
  if (s < 0.16) return kind === 'ground' ? 'other' : 'buildings';
  return 'other';
}

export function classifyColors(data, width, height, { kind = 'ground', mask = null, step = 2 } = {}) {
  const counts = {};
  let total = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * width + x;
      if (mask && !mask[i]) continue;
      const k = i * 4;
      if (data[k + 3] < 128) continue;
      const coverType = classifyPixel(data[k], data[k + 1], data[k + 2], { kind, yFrac: y / height });
      if (!coverType) continue;
      counts[coverType] = (counts[coverType] || 0) + 1;
      total++;
    }
  }
  const landCover = Object.entries(counts)
    .map(([coverType, n]) => ({ cls: coverType, pct: Math.round((n / total) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct);
  return { landCover, classifiedPixels: total };
}

export function baselineAnalysis(data, width, height, options = {}) {
  const { landCover, classifiedPixels } = classifyColors(data, width, height, options);
  const enough = classifiedPixels > 200;
  return {
    landCover: enough ? landCover : [],
    vegetationCondition: 'unknown',
    slope: 'unknown',
    drainage: 'unknown',
    erosionSigns: false,
    standingWater: false,
    weeds: [],
    observations: enough
      ? ['Land cover was estimated from colors only. It cannot tell crops from pasture, and shadows or season change the result.']
      : ['Too little of the photo could be classified (mostly sky or shadow). Try a photo that shows more ground.'],
    confidence: 'low',
  };
}

export async function prepareImage(file, { maxSide = MAX_SIDE } = {}) {
  if (!file || file.size === 0) throw new Error('That file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That photo is larger than 15 MB. Choose a smaller one.');
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffImageType(head)) throw new Error('Only JPEG, PNG or WebP photos are supported.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That photo could not be read. It may be damaged.');
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, w, height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { canvas, width: w, height: height, dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
}

export async function analyzeOffline(prepared, kind = 'ground', mask = null) {
  const context = prepared.canvas.getContext('2d', { willReadFrequently: true });
  const img = context.getImageData(0, 0, prepared.width, prepared.height);
  const base = baselineAnalysis(img.data, prepared.width, prepared.height, { kind, mask });
  return { analysis: base, engine: 'baseline' };
}

export async function fetchAerial(boundaryLatLon, { size = 640 } = {}) {
  const lats = boundaryLatLon.map((p) => p.lat);
  const lons = boundaryLatLon.map((p) => p.lon);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);
  const padLat = (maxLat - minLat) * 0.08 + 1e-5;
  const padLon = (maxLon - minLon) * 0.08 + 1e-5;
  minLat -= padLat; maxLat += padLat; minLon -= padLon; maxLon += padLon;
  if (maxLat - minLat > 0.06 || maxLon - minLon > 0.08) throw new Error('That area is too large for an aerial sample. Draw a smaller boundary.');
  const aspect = (maxLon - minLon) / (maxLat - minLat);
  const w = aspect >= 1 ? size : Math.max(64, Math.round(size * aspect));
  const height = aspect >= 1 ? Math.max(64, Math.round(size / aspect)) : size;
  const url = `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=${minLon.toFixed(6)},${minLat.toFixed(6)},${maxLon.toFixed(6)},${maxLat.toFixed(6)}&bboxSR=4326&imageSR=4326&size=${w},${height}&format=jpgpng&f=image`;
  const img = await new Promise((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = 'anonymous';
    element.referrerPolicy = 'no-referrer';
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('The aerial image service did not respond. Try again later or upload a photo instead.'));
    element.src = url;
    setTimeout(() => reject(new Error('The aerial image service timed out.')), 25000);
  });
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(img, 0, 0, w, height);
  try {
    context.getImageData(0, 0, 1, 1);
  } catch {
    throw new Error('The browser blocked reading the aerial image (the service does not allow it). Upload a photo or screenshot instead.');
  }
  const mask = new Uint8Array(w * height);
  for (let y = 0; y < height; y++) {
    const lat = maxLat - ((y + 0.5) / height) * (maxLat - minLat);
    for (let x = 0; x < w; x++) {
      const lon = minLon + ((x + 0.5) / w) * (maxLon - minLon);
      if (pointInPolygon({ x: lon, y: lat }, boundaryLatLon.map((p) => ({ x: p.lon, y: p.lat })))) mask[y * w + x] = 1;
    }
  }
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { canvas, width: w, height: height, dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', mask };
}

const DRAINAGE_FROM_WORD = { well: 'well', moderate: 'moderate', poor: 'somewhat_poor' };

export function suggestedEdits(analysis, land) {
  const out = [];
  const soil = land?.soil || {};
  if (analysis.slope && analysis.slope !== 'unknown') {
    const percent = SLOPE_WORD_PCT[analysis.slope];
    if (percent != null && soil.slopePct !== percent) {
      out.push({ id: 'slope', label: `Set slope to about ${percent}% (photo looks ${analysis.slope})`, apply: (d) => { d.land.soil.slopePct = percent; } });
    }
  }
  if (analysis.drainage && analysis.drainage !== 'unknown') {
    const coverType = DRAINAGE_FROM_WORD[analysis.drainage];
    if (coverType && soil.drainage !== coverType) {
      out.push({ id: 'drainage', label: `Set drainage to "${coverType.replace('_', ' ')}" (photo suggests ${analysis.drainage})`, apply: (d) => { d.land.soil.drainage = coverType; } });
    }
  }
  if (analysis.standingWater && soil.drainage !== 'poor' && soil.drainage !== 'very_poor' && soil.drainage !== 'somewhat_poor') {
    out.push({ id: 'wet', label: 'Mark drainage "somewhat poor" (standing water visible)', apply: (d) => { d.land.soil.drainage = 'somewhat_poor'; } });
  }
  return out;
}
