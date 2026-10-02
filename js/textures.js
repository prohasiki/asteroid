/**
 * textures.js — загрузка текстур NASA Blue Marble с CDN и процедурные
 * запасные текстуры (canvas), если CDN недоступен или отвечает слишком долго.
 *
 * Загрузка идёт через THREE.LoadingManager; у каждой текстуры есть таймаут.
 * Если настоящая текстура приходит после таймаута, она «на лету» заменяет
 * запасную (колбэк onUpgrade).
 */
import * as THREE from 'three';
import { LAND_SHAPES, INNER_WATERS, CITIES } from './data.js';

export const TEXTURE_BASE_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/planets/';

export const TEXTURE_LIST = [
  { key: 'day', file: 'earth_atmos_2048.jpg', label: 'Дневная поверхность (NASA Blue Marble)', srgb: true },
  { key: 'normal', file: 'earth_normal_2048.jpg', label: 'Рельеф (normal map)', srgb: false },
  { key: 'specular', file: 'earth_specular_2048.jpg', label: 'Маска океанов (specular)', srgb: false },
  { key: 'night', file: 'earth_lights_2048.png', label: 'Ночные огни городов', srgb: true },
  { key: 'clouds', file: 'earth_clouds_1024.png', label: 'Облачный покров', srgb: false },
  { key: 'moon', file: 'moon_1024.jpg', label: 'Поверхность Луны', srgb: true },
];

/* ------------------------------------------------------------------ */
/*  Шум и вспомогательные функции                                      */
/* ------------------------------------------------------------------ */

/** Детерминированный ГПСЧ mulberry32. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Value noise, бесшовный по оси X с периодом period. */
function valueNoise(x, y, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const ix0 = ((x0 % period) + period) % period;
  const ix1 = (ix0 + 1) % period;
  const a = hash2(ix0, y0, seed), b = hash2(ix1, y0, seed);
  const c = hash2(ix0, y0 + 1, seed), d = hash2(ix1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Фрактальный шум (fBm). u ∈ [0,1) по долготе, v ∈ [0,1] по широте. */
function fbm(u, v, base, seed, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    const p = base * f;
    sum += amp * valueNoise(u * p, v * p * 0.5, p, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

/* ------------------------------------------------------------------ */
/*  Маска суши                                                         */
/* ------------------------------------------------------------------ */

let maskCache = null;

/** Растровая маска суши 2048×1024: land (0/255) и ice (ледники Антарктиды и Гренландии). */
function getLandMask() {
  if (maskCache) return maskCache;
  const W = 2048, H = 1024;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const X = (lon) => ((lon + 180) / 360) * W;
  const Y = (lat) => ((90 - lat) / 180) * H;
  const path = (coords, shift) => {
    g.beginPath();
    for (let i = 0; i < coords.length; i += 2) {
      const x = X(coords[i] + shift), y = Y(coords[i + 1]);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  };
  for (const s of LAND_SHAPES) {
    const ice = s.continent === 'antarctica' || s.name === 'Гренландия';
    g.fillStyle = ice ? '#ffff00' : '#ff0000';
    for (const shift of [0, -360, 360]) { path(s.coords, shift); g.fill(); }
  }
  g.fillStyle = '#000';
  for (const w of INNER_WATERS) { path(w.coords, 0); g.fill(); }
  const data = g.getImageData(0, 0, W, H).data;
  const land = new Uint8Array(W * H), ice = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    land[i] = data[i * 4] > 127 ? 255 : 0;
    ice[i] = data[i * 4 + 1] > 127 ? 255 : 0;
  }
  // Размытая маска (близость берега) в 512×256 — для мелководья и рельефа.
  const bw = 512, bh = 256;
  let blur = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let s = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) s += land[(y * 4 + dy) * W + x * 4 + dx];
      blur[y * bw + x] = s / (16 * 255);
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let s = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= bh) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const xx = (x + dx + bw) % bw;
            s += blur[yy * bw + xx];
            n++;
          }
        }
        out[y * bw + x] = s / n;
      }
    }
    blur = out;
  }
  maskCache = { W, H, land, ice, blur, bw, bh };
  return maskCache;
}

function sampleBlur(m, u, v) {
  const x = u * m.bw - 0.5, y = v * m.bh - 0.5;
  const x0 = Math.floor(x), y0 = Math.max(0, Math.min(m.bh - 1, Math.floor(y)));
  const y1 = Math.min(m.bh - 1, y0 + 1);
  const fx = x - x0, fy = clamp01(y - y0);
  const xa = (x0 + m.bw) % m.bw, xb = (x0 + 1 + m.bw) % m.bw;
  const a = m.blur[y0 * m.bw + xa], b = m.blur[y0 * m.bw + xb];
  const c = m.blur[y1 * m.bw + xa], d = m.blur[y1 * m.bw + xb];
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

/* Области пустынь и влажных лесов: [lonMin, latMin, lonMax, latMax]. */
const DESERTS = [
  [-17, 14, 35, 31], [35, 13, 59, 31], [52, 25, 70, 36], [52, 36, 68, 45], [68, 23, 75, 30],
  [75, 36, 112, 45], [12, -29, 26, -17], [114, -32, 146, -19], [-72, -28, -68, -17], [-117, 24, -103, 37],
];
const RAINFORESTS = [[-78, -14, -45, 6], [8, -6, 31, 6], [94, -9, 152, 10], [72, 8, 80, 20]];

function regionWeight(boxes, lon, lat, edge) {
  let w = 0;
  for (const [x0, y0, x1, y1] of boxes) {
    const dx = Math.min(lon - x0, x1 - lon), dy = Math.min(lat - y0, y1 - lat);
    const d = Math.min(dx, dy);
    if (d > -edge) w = Math.max(w, smooth(-edge, edge, d));
  }
  return w;
}

/* ------------------------------------------------------------------ */
/*  Генераторы запасных текстур                                        */
/* ------------------------------------------------------------------ */

/* Палитра растительных зон по «эффективной» широте: [широта, r, g, b]. */
const BIOME_STOPS = [
  [0, 30, 66, 30], [9, 36, 74, 32], [15, 92, 98, 50], [22, 150, 132, 86], [30, 128, 116, 72],
  [38, 92, 100, 58], [47, 52, 80, 42], [58, 40, 66, 38], [64, 96, 96, 76], [70, 140, 136, 120], [76, 222, 226, 232],
];

function biomeColor(latE) {
  const s = BIOME_STOPS;
  if (latE <= s[0][0]) return s[0];
  for (let k = 1; k < s.length; k++) {
    if (latE <= s[k][0]) {
      const a = s[k - 1], b = s[k];
      const t = smooth(0, 1, (latE - a[0]) / (b[0] - a[0]));
      return [0, mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t)];
    }
  }
  return s[s.length - 1];
}

function genDay() {
  const m = getLandMask();
  const W = 2048, H = 1024;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const lat = 90 - v * 180;
    const alat = Math.abs(lat);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const lon = u * 360 - 180;
      const i = y * W + x;
      const n = fbm(u, v, 16, 7, 4);
      let r, gg, b;
      if (m.land[i]) {
        if (m.ice[i]) {
          const s = 0.86 + n * 0.14;
          r = 230 * s; gg = 236 * s; b = 244 * s;
        } else {
          // Растительные зоны с «размытыми» шумом границами.
          const n2 = fbm(u, v, 9, 11, 3);
          const latE = alat + (n2 - 0.5) * 16;
          const base = biomeColor(latE);
          let cr = base[1], cg = base[2], cb = base[3];
          const n3 = fbm(u, v, 22, 13, 3);
          // Границы пустынь и лесов искажаются шумом, чтобы не было прямоугольников.
          const lonW = lon + (n3 - 0.5) * 26 + (n2 - 0.5) * 14, latW = lat + (n3 - 0.5) * 18;
          const desert = smooth(0.4, 0.62, regionWeight(DESERTS, lonW, latW, 6) * 0.8 + (n3 - 0.5) * 0.35 + 0.1);
          const sand = 0.85 + n3 * 0.3;
          cr = mix(cr, 206 * sand, desert); cg = mix(cg, 170 * sand, desert); cb = mix(cb, 116 * sand, desert);
          const forest = smooth(0.35, 0.7, regionWeight(RAINFORESTS, lonW, latW, 6) + (n2 - 0.5) * 0.4);
          cr = mix(cr, 24, forest * 0.85); cg = mix(cg, 58, forest * 0.85); cb = mix(cb, 24, forest * 0.85);
          // Нагорья: крупномасштабный шум «высоты» даёт буро-серые тона.
          const highland = smooth(0.6, 0.8, fbm(u, v, 7, 17, 3)) * 0.4;
          cr = mix(cr, 128, highland); cg = mix(cg, 116, highland); cb = mix(cb, 98, highland);
          const relief = 0.8 + n * 0.4;
          r = cr * relief; gg = cg * relief; b = cb * relief;
        }
      } else {
        const coast = sampleBlur(m, u, v);
        const depth = 0.75 + n * 0.35;
        r = mix(6, 30, coast * coast) * depth;
        gg = mix(26, 92, coast * coast) * depth;
        b = mix(64, 134, coast * coast) * depth;
        if (alat > 78) { // морской лёд Арктики и Антарктики
          const iceW = smooth(78, 84, alat) * smooth(0.3, 0.6, n);
          r = mix(r, 215, iceW); gg = mix(gg, 225, iceW); b = mix(b, 235, iceW);
        }
      }
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function genSpecular() {
  const m = getLandMask();
  const W = 1024, H = 512;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lat = 90 - ((y + 0.5) / H) * 180;
      let s = m.land[y * 2 * m.W + x * 2] ? 0 : 255;
      if (Math.abs(lat) > 80) s *= 0.4;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = s;
      img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function genNormal() {
  const m = getLandMask();
  const W = 1024, H = 512;
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const coast = sampleBlur(m, u, v);
      const ridged = 1 - Math.abs(fbm(u, v, 24, 19, 4) * 2 - 1);
      h[y * W + x] = coast * (0.25 + ridged * ridged * 0.75);
    }
  }
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const k = 6.0;
  for (let y = 0; y < H; y++) {
    const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xl = (x - 1 + W) % W, xr = (x + 1) % W;
      const dx = (h[y * W + xr] - h[y * W + xl]) * k;
      const dy = (h[yu * W + x] - h[yd * W + x]) * k;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function genNight() {
  const m = getLandMask();
  const W = 2048, H = 1024;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const rnd = mulberry32(2024);
  const X = (lon) => ((((lon + 180) % 360) + 360) % 360 / 360) * W;
  const Y = (lat) => ((90 - lat) / 180) * H;
  g.globalCompositeOperation = 'lighter';
  // Редкие огни посёлков на обжитой суше.
  for (let k = 0; k < 60000; k++) {
    const u = rnd(), v = 0.2 + rnd() * 0.55;
    const x = Math.floor(u * W), y = Math.floor(v * H);
    if (!m.land[y * W + x] || m.ice[y * W + x]) continue;
    const lat = 90 - v * 180, lon = u * 360 - 180;
    if (regionWeight(DESERTS, lon, lat, 2) > 0.5 || regionWeight(RAINFORESTS, lon, lat, 2) > 0.5) continue;
    const dens = fbm(u, v, 12, 77, 3);
    if (dens < 0.55) continue;
    const a = (dens - 0.55) * 1.6 * (0.3 + rnd() * 0.7);
    g.fillStyle = `rgba(255, ${190 + Math.floor(rnd() * 40)}, 120, ${a.toFixed(3)})`;
    g.fillRect(x, y, 1, 1);
  }
  // Агломерации: свечение и россыпь кварталов.
  for (const [, lat, lon, pop] of CITIES) {
    const size = 0.25 + Math.sqrt(pop) * 0.32; // градусы
    const cx = X(lon), cy = Y(lat);
    const rad = (size / 360) * W * 2.2;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grd.addColorStop(0, 'rgba(255, 214, 150, 0.85)');
    grd.addColorStop(0.35, 'rgba(255, 170, 90, 0.25)');
    grd.addColorStop(1, 'rgba(255, 140, 60, 0)');
    g.fillStyle = grd;
    g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    const count = Math.floor(60 + pop * 55);
    for (let k = 0; k < count; k++) {
      const ang = rnd() * Math.PI * 2;
      const spread = k % 3 === 0 ? 3.2 : 1.6; // треть точек — пригороды и дороги
      const dist = Math.abs((rnd() + rnd() + rnd() - 1.5) / 1.5) * size * spread;
      const lo = lon + (Math.cos(ang) * dist) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      const la = lat + Math.sin(ang) * dist;
      g.fillStyle = `rgba(255, ${200 + Math.floor(rnd() * 40)}, ${120 + Math.floor(rnd() * 60)}, ${(0.35 + rnd() * 0.6).toFixed(2)})`;
      g.fillRect(X(lo), Y(la), 1 + (rnd() < 0.2 ? 1 : 0), 1);
    }
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

function genClouds() {
  const W = 1024, H = 512;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const lat = 90 - v * 180;
    const alat = Math.abs(lat);
    const env = 0.5 + 0.12 * Math.exp(-((lat / 6) ** 2)) - 0.1 * Math.exp(-(((alat - 24) / 8) ** 2))
      + 0.12 * Math.exp(-(((alat - 56) / 11) ** 2));
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      // Деформация координат (domain warping) — вихревая структура облаков.
      const wu = u + (fbm(u, v, 8, 301, 3) - 0.5) * 0.09;
      const wv = v + (fbm(u, v, 8, 302, 3) - 0.5) * 0.06;
      const n = fbm(((wu % 1) + 1) % 1, wv, 24, 303, 6);
      // Крупные области ясного неба между облачными системами.
      const clear = smooth(0.3, 0.56, fbm(u, v, 9, 305, 3) + (env - 0.5) * 0.4);
      const cov = smooth(0.46, 0.7, n * 0.8 + env * 0.3) * clear;
      const fine = 0.8 + fbm(u, v, 64, 304, 2) * 0.4;
      const val = Math.min(255, cov * fine * 255);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* Лунные моря: [широта, долгота, радиус °, затемнение]. */
const MARIA = [
  [33, -16, 17, 0.42], [28, 17, 10, 0.45], [8.5, 31, 12, 0.45], [17, 59, 8, 0.5], [-7.8, 51.3, 9, 0.42],
  [-21, -17, 10, 0.38], [18, -57, 28, 0.36], [56, 1, 14, 0.3], [-13, -38, 8, 0.35], [-24, -39, 5, 0.3],
  [-15, 35, 6, 0.38], [21, 58, 4, 0.35], [-29, 86, 7, 0.3], [2, -6, 5, 0.3],
];

function genMoon() {
  const W = 1024, H = 512;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const lat = 90 - v * 180;
    const coslat = Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const lon = u * 360 - 180;
      let val = 0.64 + (fbm(u, v, 14, 501, 5) - 0.5) * 0.3;
      const edgeNoise = 0.8 + fbm(u, v, 20, 502, 3) * 0.5;
      for (const [mla, mlo, mr, k] of MARIA) {
        if (Math.abs(lat - mla) > mr * 1.4) continue;
        let dlo = lon - mlo;
        dlo = ((dlo + 540) % 360) - 180;
        const dd = Math.hypot(dlo * coslat, lat - mla);
        const edge = mr * edgeNoise;
        if (dd < edge) val *= 1 - k * smooth(edge, edge * 0.55, dd);
      }
      const i = (y * W + x) * 4;
      const s = Math.max(0, Math.min(255, val * 255));
      img.data[i] = s; img.data[i + 1] = s * 0.98; img.data[i + 2] = s * 0.95; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Кратеры: тёмное дно и мягкий светлый вал (альбедо, без «пузырей»).
  const rnd = mulberry32(99);
  for (let k = 0; k < 520; k++) {
    const x = rnd() * W, y = 24 + rnd() * (H - 48);
    const r = Math.pow(rnd(), 4) * 16 + 1.0;
    const grd = g.createRadialGradient(x, y, 0, x, y, r * 1.25);
    grd.addColorStop(0, 'rgba(70,68,66,0.16)');
    grd.addColorStop(0.62, 'rgba(70,68,66,0.10)');
    grd.addColorStop(0.8, 'rgba(225,222,215,0.16)');
    grd.addColorStop(1, 'rgba(225,222,215,0)');
    g.fillStyle = grd;
    g.fillRect(x - r * 1.25, y - r * 1.25, r * 2.5, r * 2.5);
  }
  // Яркие лучевые кратеры Тихо и Коперник.
  for (const [lat, lon, r] of [[-43.3, -11.2, 18], [9.6, -20.1, 12]]) {
    const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,250,0.9)');
    grd.addColorStop(1, 'rgba(255,255,250,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

const GENERATORS = { day: genDay, normal: genNormal, specular: genSpecular, night: genNight, clouds: genClouds, moon: genMoon };

/* ------------------------------------------------------------------ */
/*  Загрузка                                                           */
/* ------------------------------------------------------------------ */

function configure(tex, item, maxAniso) {
  tex.colorSpace = item.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Создать процедурную текстуру по ключу (используется и тестами). */
export function createFallbackTexture(key) {
  const canvas = GENERATORS[key]();
  const tex = new THREE.CanvasTexture(canvas);
  tex.userData.procedural = true;
  return tex;
}

/**
 * Загрузить все текстуры.
 * @param {THREE.WebGLRenderer} renderer
 * @param {{timeoutMs?:number, baseUrl?:string, onProgress?:Function, onUpgrade?:Function}} opts
 * @returns {Promise<{textures:Object, fallback:Object}>}
 */
export function loadTextures(renderer, opts = {}) {
  const { timeoutMs = 10000, baseUrl = TEXTURE_BASE_URL, onProgress = () => {}, onUpgrade = () => {} } = opts;
  const manager = new THREE.LoadingManager();
  const loader = new THREE.TextureLoader(manager);
  loader.setCrossOrigin('anonymous');
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const result = { textures: {}, fallback: {}, reasons: {} };
  const total = TEXTURE_LIST.length;
  let done = 0;
  let genQueue = Promise.resolve();

  manager.onProgress = (url, loaded, itemsTotal) => {
    onProgress({ type: 'network', url, loaded, total: itemsTotal, done, all: total });
  };

  const tasks = TEXTURE_LIST.map((item) => new Promise((resolve) => {
    let state = 'loading'; // loading → generating → fallback | loaded
    let lateTexture = null; // текстура, пришедшая во время генерации запасной
    const settle = (tex, isFallback, reason) => {
      configure(tex, item, maxAniso);
      result.textures[item.key] = tex;
      result.fallback[item.key] = isFallback;
      result.reasons[item.key] = reason;
      done += 1;
      onProgress({ type: 'item', key: item.key, label: item.label, fallback: isFallback, reason, done, all: total });
      resolve();
    };
    const fallback = (reason) => {
      if (state !== 'loading') return;
      state = 'generating';
      clearTimeout(timer);
      // Генерация тяжёлая — выполняем по очереди, уступая кадр интерфейсу.
      genQueue = genQueue.then(async () => {
        await yieldFrame();
        if (lateTexture) {
          state = 'loaded';
          settle(lateTexture, false, 'cdn-late');
          return;
        }
        state = 'fallback';
        let tex;
        try {
          tex = createFallbackTexture(item.key);
        } catch (err) {
          console.warn('Не удалось создать процедурную текстуру', item.key, err);
          tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
        }
        settle(tex, true, reason);
      });
    };
    const timer = setTimeout(() => fallback('timeout'), timeoutMs);
    loader.load(
      baseUrl + item.file,
      (tex) => {
        if (state === 'loading') {
          state = 'loaded';
          clearTimeout(timer);
          settle(tex, false, 'cdn');
        } else if (state === 'generating') {
          lateTexture = tex;
        } else if (state === 'fallback') {
          // Настоящая текстура пришла после таймаута — заменяем запасную.
          configure(tex, item, maxAniso);
          const old = result.textures[item.key];
          result.textures[item.key] = tex;
          result.fallback[item.key] = false;
          onUpgrade(item.key, tex, old);
        } else {
          tex.dispose();
        }
      },
      undefined,
      () => fallback('error'),
    );
  }));

  return Promise.all(tasks).then(() => result);
}
