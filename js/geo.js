/**
 * geo.js — географические утилиты: определение региона по координатам,
 * формула гаверсинусов, дуги большого круга, форматирование координат.
 */
import { LAND_SHAPES, INNER_WATERS, SEAS, CITIES } from './data.js';
import { DEG, RAD, latLonToLocal } from './astro.js';

export const EARTH_R_KM = 6371.0;

/** Ограничивающий прямоугольник контура (для быстрого отсечения). */
function bbox(coords) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
    minLon = Math.min(minLon, coords[i]);
    maxLon = Math.max(maxLon, coords[i]);
    minLat = Math.min(minLat, coords[i + 1]);
    maxLat = Math.max(maxLat, coords[i + 1]);
  }
  return { minLon, maxLon, minLat, maxLat };
}

const LAND = LAND_SHAPES.map((s) => ({ ...s, box: bbox(s.coords) }));
// Острова проверяем раньше материков, чтобы вернуть их собственное имя.
LAND.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1));
const WATERS = INNER_WATERS.map((w) => ({ ...w, box: bbox(w.coords) }));

/** Тест «точка в многоугольнике» (правило чётности пересечений). */
export function pointInPolygon(lon, lat, coords) {
  let inside = false;
  const n = coords.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = coords[i], yi = coords[i + 1];
    const xj = coords[j], yj = coords[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Проверка с учётом контуров, заходящих за ±180°. */
function inShape(lon, lat, shape) {
  const b = shape.box;
  if (lat < b.minLat || lat > b.maxLat) return false;
  for (const shift of [0, 360, -360]) {
    const L = lon + shift;
    if (L >= b.minLon && L <= b.maxLon && pointInPolygon(L, lat, shape.coords)) return true;
  }
  return false;
}

/** Внутренний водоём (Каспий, Чёрное море, крупные озёра) или null. */
export function innerWaterAt(lat, lon) {
  for (const w of WATERS) if (inShape(lon, lat, w)) return w.name;
  return null;
}

/** Суша под точкой: { continent, name } или null для воды. */
export function landAt(lat, lon) {
  if (innerWaterAt(lat, lon)) return null;
  for (const s of LAND) if (inShape(lon, lat, s)) return { continent: s.continent, name: s.name };
  return null;
}

/** Долгота границы Тихого и Атлантического океанов (западное побережье Америк). */
const PACIFIC_ATLANTIC_DIVIDE = [
  [-56, -67.3], [-55, -72], [-45, -75.5], [-30, -71.6], [-18, -70.3], [-5, -81.0], [0, -80.0],
  [8, -78.0], [9, -79.6], [10, -85.5], [13, -88.0], [15.5, -93.5], [16.2, -95.0], [18.5, -103.0],
  [23, -110.0], [32, -117.3], [40, -124.3], [48, -124.7], [55, -131.0], [60, -146.0], [65.6, -168.1],
  [67, -168.5],
];

function divideLon(lat) {
  const t = PACIFIC_ATLANTIC_DIVIDE;
  if (lat <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (lat <= t[i][0]) {
      const [la0, lo0] = t[i - 1];
      const [la1, lo1] = t[i];
      return lo0 + ((lat - la0) / (la1 - la0)) * (lo1 - lo0);
    }
  }
  return t[t.length - 1][1];
}

/** Название океана по координатам (упрощённые границы МГО). */
export function oceanAt(lat, lon) {
  if (lat > 66) return 'Северный Ледовитый океан';
  if (lat < -60) return 'Южный океан';
  if (lon >= 20 && lon <= 147) {
    if (lat < -8 || (lon < 100 && lat < 31)) return 'Индийский океан';
    if (lon >= 100) return 'Тихий океан';
    return 'Атлантический океан';
  }
  if (lon > 147) return 'Тихий океан';
  return lon < divideLon(lat) ? 'Тихий океан' : 'Атлантический океан';
}

/** Название моря по таблице прямоугольников или null. */
export function seaAt(lat, lon) {
  for (const s of SEAS) {
    const [x0, y0, x1, y1] = s.box;
    if (lat < y0 || lat > y1) continue;
    if ((lon >= x0 && lon <= x1) || (lon + 360 >= x0 && lon + 360 <= x1)) return s.name;
  }
  return null;
}

/**
 * Регион под точкой.
 * @returns {{kind:'land'|'water', name:string, continent:string|null, island:string|null, ocean:string|null}}
 */
export function regionAt(lat, lon) {
  const inner = innerWaterAt(lat, lon);
  if (inner) return { kind: 'water', name: inner, continent: null, island: null, ocean: null };
  const land = landAt(lat, lon);
  if (land) return { kind: 'land', name: land.name || null, continent: land.continent, island: land.name, ocean: null };
  const ocean = oceanAt(lat, lon);
  const sea = seaAt(lat, lon);
  return { kind: 'water', name: sea || ocean, continent: null, island: null, ocean };
}

/** Расстояние по поверхности Земли (формула гаверсинусов), км. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG;
  const dp = (lat2 - lat1) * DEG, dl = (lon2 - lon1) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Точки дуги большого круга в локальных координатах сетки Земли.
 * @param {number} lift — подъём середины дуги над поверхностью (в радиусах Земли)
 */
export function greatCirclePoints(lat1, lon1, lat2, lon2, segments = 96, radius = 1.004, lift = 0) {
  const a = latLonToLocal(lat1, lon1, 1);
  const b = latLonToLocal(lat2, lon2, 1);
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const s = Math.sin(omega);
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let wa = 1 - t, wb = t;
    if (s > 1e-6) {
      wa = Math.sin((1 - t) * omega) / s;
      wb = Math.sin(t * omega) / s;
    }
    const x = a.x * wa + b.x * wb, y = a.y * wa + b.y * wb, z = a.z * wa + b.z * wb;
    const len = Math.hypot(x, y, z) || 1;
    const r = radius + lift * Math.sin(Math.PI * t);
    pts.push({ x: (x / len) * r, y: (y / len) * r, z: (z / len) * r });
  }
  return pts;
}

/** Ближайший крупный город и расстояние до него. */
export function nearestCity(lat, lon) {
  let best = null, bestD = Infinity;
  for (const [name, la, lo, pop] of CITIES) {
    const d = haversineKm(lat, lon, la, lo);
    if (d < bestD) { bestD = d; best = { name, lat: la, lon: lo, pop }; }
  }
  return best ? { ...best, distanceKm: bestD } : null;
}

function dm(value) {
  const v = Math.abs(value);
  let d = Math.floor(v);
  let m = Math.round((v - d) * 60);
  if (m === 60) { d += 1; m = 0; }
  return `${d}°${String(m).padStart(2, '0')}′`;
}

export function formatLat(lat) {
  return `${dm(lat)} ${lat >= 0 ? 'с.ш.' : 'ю.ш.'}`;
}

export function formatLon(lon) {
  return `${dm(lon)} ${lon >= 0 ? 'в.д.' : 'з.д.'}`;
}

export function formatCoords(lat, lon) {
  return `${formatLat(lat)}, ${formatLon(lon)}`;
}

/** Номинальный часовой пояс по долготе (без учёта политических границ). */
export function nominalUtcOffset(lon) {
  return Math.max(-12, Math.min(12, Math.round(lon / 15)));
}

export function formatUtcOffset(h) {
  return h === 0 ? 'UTC±0' : `UTC${h > 0 ? '+' : '−'}${Math.abs(h)}`;
}

/** Местное среднее солнечное время для долготы, «ЧЧ:ММ». */
export function localSolarTime(date, lon) {
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let m = (utcMin + lon * 4) % 1440;
  if (m < 0) m += 1440;
  const h = Math.floor(m / 60), mm = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export { RAD };
