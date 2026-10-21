import { makeProjection, polygonCentroid, rectPolygon, fromFeet } from './geo.js';

export const DEFAULT_ORIGIN = { lat: 39.0473, lon: -95.6752 };

export function landPoint(land) {
  if (land?.boundary?.length >= 3 && land.origin) {
    const projection = makeProjection(land.origin);
    return projection.toLatLon(polygonCentroid(land.boundary));
  }
  if (land?.location) return { lat: land.location.lat, lon: land.location.lon };
  if (land?.origin) return { ...land.origin };
  return null;
}

export function rectangleBoundary(lengthFt, widthFt) {
  const l = Number(lengthFt);
  const w = Number(widthFt);
  if (!(l >= 10 && w >= 10 && l <= 40000 && w <= 40000)) throw new Error('Enter a length and width between 10 ft and 40,000 ft.');
  return rectPolygon(fromFeet(l), fromFeet(w));
}

export function mergeSoilReading(current, reading) {
  const next = { ...current };
  for (const k of ['ph', 'om', 'texture', 'drainage', 'slopePct', 'depthIn', 'sand', 'silt', 'clay']) {
    if (reading[k] !== null && reading[k] !== undefined) next[k] = reading[k];
  }
  next.source = reading.source;
  next.mapUnit = reading.mapUnit || '';
  next.notes = reading.notes || [];
  return next;
}

export function recenterOrigin(land, target) {
  if (!land.boundary?.length) return { ...target };
  const centroid = polygonCentroid(land.boundary);
  const earthRadius = 6378137;
  const startLat = target.lat - (centroid.y / earthRadius) * (180 / Math.PI);
  const cosLat = Math.cos((startLat * Math.PI) / 180);
  return { lat: startLat, lon: target.lon - (centroid.x / (earthRadius * cosLat)) * (180 / Math.PI) };
}
