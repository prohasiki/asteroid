/**
 * astro.js — астрономические расчёты без зависимостей от Three.js.
 *
 * Системы координат сцены (единица длины — средний радиус Земли, 6371 км):
 *  • «Эклиптическая» система сцены: +Y — северный полюс эклиптики,
 *    +X — точка весеннего равноденствия, +Z = X × Y.
 *    Эклиптические координаты (x, y, z) переводятся в сцену как (x, z, −y).
 *  • «Экваториальная» система (внутри группы наклона Земли, повёрнутой на −ε
 *    вокруг оси X): экваториальные (x, y, z) → локальные (x, z, −y).
 *    Сетка Земли поворачивается вокруг локальной оси Y на угол GMST.
 *
 * Формулы: упрощённые ряды из «Astronomical Almanac» и Ж. Миуса
 * (точность для Солнца ~0,01°, для Луны ~0,3°), чего достаточно
 * для корректной картины дня/ночи и фаз Луны.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
/** Наклон земной оси к плоскости орбиты (градусы и радианы). */
export const OBLIQUITY_DEG = 23.44;
export const OBLIQUITY = OBLIQUITY_DEG * DEG;
export const EARTH_RADIUS_KM = 6371.0;
export const MOON_RADIUS_KM = 1737.4;
export const SYNODIC_MONTH = 29.530589; // сут
export const SIDEREAL_DAY_S = 86164.0905; // звёздные сутки, с

const TWO_PI = Math.PI * 2;

/** Нормализация угла в диапазон [0, 2π). */
export function normalizeRad(a) {
  a %= TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/** Нормализация долготы в градусах в диапазон [−180, 180). */
export function wrapLonDeg(lon) {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  if (l === -180 && lon > 0) l = 180;
  return l;
}

/** Юлианская дата для объекта Date (UTC). */
export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Среднее гринвичское звёздное время (радианы). */
export function gmst(date) {
  const d = julianDate(date) - 2451545.0;
  const T = d / 36525;
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000;
  return normalizeRad(deg * DEG);
}

/**
 * Положение Солнца. Возвращает эклиптическую долготу, прямое восхождение,
 * склонение, расстояние (а.е.), уравнение времени и подсолнечную точку.
 */
export function sunPosition(date) {
  const d = julianDate(date) - 2451545.0;
  const g = normalizeRad((357.529 + 0.98560028 * d) * DEG); // средняя аномалия
  const qDeg = 280.459 + 0.98564736 * d; // средняя долгота
  const L = normalizeRad((qDeg + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG);
  const distAU = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  const eps = OBLIQUITY;
  const ra = normalizeRad(Math.atan2(Math.cos(eps) * Math.sin(L), Math.cos(L)));
  const dec = Math.asin(Math.sin(eps) * Math.sin(L));

  // Уравнение времени (минуты): разность среднего и истинного Солнца.
  let eqDeg = normalizeRad(qDeg * DEG) * RAD - ra * RAD;
  eqDeg = ((eqDeg + 180) % 360 + 360) % 360 - 180;
  const eqTimeMin = eqDeg * 4;

  // Подсолнечная точка: местный часовой угол Солнца равен нулю.
  const subLat = dec * RAD;
  const subLon = wrapLonDeg((ra - gmst(date)) * RAD);

  return { eclLon: L, eclLat: 0, ra, dec, distAU, eqTimeMin, subLat, subLon };
}

/**
 * Геоцентрическое положение Луны (эклиптика даты).
 * Возвращает долготу, широту (рад), расстояние в км и в радиусах Земли.
 */
export function moonPosition(date) {
  const T = (julianDate(date) - 2451545.0) / 36525;
  const s = (a, b) => Math.sin((a + b * T) * DEG);
  const c = (a, b) => Math.cos((a + b * T) * DEG);

  const lonDeg = 218.32 + 481267.881 * T
    + 6.29 * s(134.9, 477198.85) - 1.27 * s(259.2, -413335.38)
    + 0.66 * s(235.7, 890534.23) + 0.21 * s(269.9, 954397.70)
    - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.6, 966404.05);
  const latDeg = 5.13 * s(93.3, 483202.03) + 0.28 * s(228.2, 960400.87)
    - 0.28 * s(318.3, 6003.18) - 0.17 * s(217.6, -407332.20);
  const parDeg = 0.9508 + 0.0518 * c(134.9, 477198.85) + 0.0095 * c(259.2, -413335.38)
    + 0.0078 * c(235.7, 890534.23) + 0.0028 * c(269.9, 954397.70);

  const lon = normalizeRad(lonDeg * DEG);
  const lat = latDeg * DEG;
  const distKm = 6378.14 / Math.sin(parDeg * DEG);
  return { eclLon: lon, eclLat: lat, distKm, distR: distKm / EARTH_RADIUS_KM };
}

/** Фаза Луны: доля освещённого диска, возраст, название. */
export function moonPhase(date) {
  const sun = sunPosition(date);
  const moon = moonPosition(date);
  const elongDeg = ((moon.eclLon - sun.eclLon) * RAD % 360 + 360) % 360; // 0..360
  const cosE = Math.cos(moon.eclLat) * Math.cos(moon.eclLon - sun.eclLon);
  const illumination = (1 - cosE) / 2;
  const ageDays = (elongDeg / 360) * SYNODIC_MONTH;
  const waxing = elongDeg < 180;
  let name;
  if (elongDeg < 6 || elongDeg >= 354) name = 'Новолуние';
  else if (elongDeg < 84) name = 'Растущий серп';
  else if (elongDeg < 96) name = 'Первая четверть';
  else if (elongDeg < 174) name = 'Растущая Луна';
  else if (elongDeg < 186) name = 'Полнолуние';
  else if (elongDeg < 264) name = 'Убывающая Луна';
  else if (elongDeg < 276) name = 'Последняя четверть';
  else name = 'Убывающий серп';
  return { illumination, ageDays, waxing, name, elongDeg };
}

/** Перевод эклиптических сферических координат в систему сцены. */
export function eclipticToScene(lon, lat, r = 1) {
  const cl = Math.cos(lat);
  return { x: r * cl * Math.cos(lon), y: r * Math.sin(lat), z: -r * cl * Math.sin(lon) };
}

/** Единичный вектор на Солнце в системе сцены. */
export function sunDirectionScene(date) {
  const sp = sunPosition(date);
  return eclipticToScene(sp.eclLon, 0, 1);
}

/** Положение Луны в системе сцены (в радиусах Земли). */
export function moonPositionScene(date) {
  const mp = moonPosition(date);
  return eclipticToScene(mp.eclLon, mp.eclLat, mp.distR);
}

/**
 * Модель орбиты МКС: круговая орбита, наклонение 51,64°, высота ~415 км,
 * период ~92,9 мин, прецессия восходящего узла ≈ −5°/сут.
 * Положение условное (без TLE), но параметры орбиты реальные.
 */
export const ISS_ORBIT = {
  altitudeKm: 415,
  inclination: 51.64 * DEG,
  periodMin: 92.9,
  nodalRateDegPerDay: -5.0,
  epoch: Date.UTC(2026, 0, 1, 0, 0, 0),
  raan0: 120 * DEG,
  u0: 0,
};

/** Положение МКС в экваториальной системе (ECI, радиусы Земли). */
export function issPositionECI(date, orbit = ISS_ORBIT) {
  const r = 1 + orbit.altitudeKm / EARTH_RADIUS_KM;
  const dtMin = (date.getTime() - orbit.epoch) / 60000;
  const u = orbit.u0 + (TWO_PI * dtMin) / orbit.periodMin;
  const raan = orbit.raan0 + (orbit.nodalRateDegPerDay * DEG * dtMin) / 1440;
  return eciFromElements(r, orbit.inclination, raan, u);
}

/** Точка круговой орбиты по элементам (r, i, Ω, u) в ECI. */
export function eciFromElements(r, inc, raan, u) {
  const cu = Math.cos(u), su = Math.sin(u);
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const ci = Math.cos(inc), si = Math.sin(inc);
  return {
    x: r * (cu * cO - su * ci * sO),
    y: r * (cu * sO + su * ci * cO),
    z: r * (su * si),
    raan,
    u,
  };
}

/** Перевод ECI → локальные координаты экваториальной группы сцены. */
export function eciToLocal(p) {
  return { x: p.x, y: p.z, z: -p.y };
}

/** Подспутниковая точка (широта/долгота, градусы) по позиции ECI. */
export function subSatellitePoint(p, date) {
  const r = Math.hypot(p.x, p.y, p.z);
  const lat = Math.asin(p.z / r) * RAD;
  const lon = wrapLonDeg((Math.atan2(p.y, p.x) - gmst(date)) * RAD);
  return { lat, lon };
}

/**
 * Перевод географических координат в локальные координаты сетки Земли
 * (до поворота на GMST): долгота λ → (cos λ, 0, −sin λ) на экваторе.
 */
export function latLonToLocal(latDeg, lonDeg, r = 1) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  const cl = Math.cos(la);
  return { x: r * cl * Math.cos(lo), y: r * Math.sin(la), z: -r * cl * Math.sin(lo) };
}

/** Обратное преобразование: локальная точка сетки → широта/долгота. */
export function localToLatLon(x, y, z) {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / r))) * RAD, lon: Math.atan2(-z, x) * RAD };
}
