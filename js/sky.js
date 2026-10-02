/**
 * sky.js — окружение Земли: звёзды и Млечный Путь, Солнце, Луна, МКС.
 *
 *  • Небесная сфера ориентирована в экваториальной системе и «следует»
 *    за камерой (бесконечно далёкий фон без параллакса).
 *  • Луна: реальное положение (ряды Миуса), наклон орбиты 5,14° заложен
 *    в формулах, приливный захват (видимая сторона всегда к Земле),
 *    фазы получаются автоматически из освещения Солнцем.
 *  • МКС: круговая орбита 51,64°, ~415 км, ~92,9 мин.
 */
import * as THREE from 'three';
import {
  OBLIQUITY, DEG, EARTH_RADIUS_KM, MOON_RADIUS_KM, ISS_ORBIT,
  moonPositionScene, moonPhase, moonPosition, issPositionECI, eciFromElements, eciToLocal, subSatellitePoint,
} from './astro.js';
import { BRIGHT_STARS } from './data.js';
import { mulberry32 } from './textures.js';
import { starsVertex, starsFragment, milkyWayVertex, milkyWayFragment } from './shaders/stars.glsl.js';
import { billboardVertex, sunFragment, pointGlowVertex, pointGlowFragment } from './shaders/sun.glsl.js';
import { moonVertex, moonFragment } from './shaders/moon.glsl.js';

export const MOON_RADIUS = MOON_RADIUS_KM / EARTH_RADIUS_KM;
const SKY_RADIUS = 1500;
const SUN_DISTANCE = 1200;
const SUN_QUAD_HALF_ANGLE = 10 * DEG;
const MAX_STARS = 14000;

export const SKY_QUALITY = {
  high: { stars: 14000, mwOctaves: 5 },
  medium: { stars: 10000, mwOctaves: 4 },
  low: { stars: 6000, mwOctaves: 3 },
};

/** Направление по прямому восхождению/склонению в экваториальной системе сцены. */
function eqLocal(raDeg, decDeg) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  const x = Math.cos(dec) * Math.cos(ra), y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
  return new THREE.Vector3(x, z, -y);
}

/** Цвет абсолютно чёрного тела по температуре (аппроксимация Таннера Хелланда). */
export function kelvinToRGB(kelvin) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

function gaussian(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Геометрия звёзд: сначала реальные яркие звёзды, затем процедурные. */
function buildStarGeometry() {
  const rnd = mulberry32(4242);
  const total = BRIGHT_STARS.length + MAX_STARS;
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const size = new Float32Array(total);
  const phase = new Float32Array(total);
  const ngp = eqLocal(192.859, 27.128);
  const gc = eqLocal(266.405, -28.936);
  gc.sub(ngp.clone().multiplyScalar(gc.dot(ngp))).normalize();
  const gy = new THREE.Vector3().crossVectors(ngp, gc);

  let i = 0;
  const put = (dir, mag, temp) => {
    pos[i * 3] = dir.x * SKY_RADIUS;
    pos[i * 3 + 1] = dir.y * SKY_RADIUS;
    pos[i * 3 + 2] = dir.z * SKY_RADIUS;
    const bright = Math.min(6, Math.max(0.07, Math.pow(10, -0.4 * (mag - 2.6))));
    const [r, g, b] = kelvinToRGB(temp);
    col[i * 3] = r * bright;
    col[i * 3 + 1] = g * bright;
    col[i * 3 + 2] = b * bright;
    size[i] = 1.6 + Math.max(0, Math.min(1, (6.5 - mag) / 7.5)) * 4.4;
    phase[i] = rnd();
    i++;
  };

  for (const [, ra, dec, mag, temp] of BRIGHT_STARS) put(eqLocal(ra, dec), mag, temp);

  // Спектральные классы видимых звёзд: M, K, G, F, A, B, O-B.
  const TEMPS = [[3300, 0.14], [4400, 0.30], [5800, 0.22], [6800, 0.14], [9000, 0.12], [15000, 0.05], [25000, 0.03]];
  const pickTemp = () => {
    let u = rnd(), acc = 0;
    for (const [t, w] of TEMPS) {
      acc += w;
      if (u <= acc) return t * (0.9 + rnd() * 0.2);
    }
    return 5800;
  };
  // Распределение блеска: N(<m) ∝ 10^(0.45 m).
  const k = 0.45, a0 = Math.pow(10, k * 1.0), a1 = Math.pow(10, k * 7.2);
  for (let s = 0; s < MAX_STARS; s++) {
    let dir;
    if (rnd() < 0.38) {
      // Концентрация к плоскости Галактики, толще у балджа.
      const l = (rnd() * 2 - 1) * Math.PI;
      const b = gaussian(rnd) * 0.12 * (1 + 0.9 * Math.exp(-((l / 0.6) ** 2)));
      dir = gc.clone().multiplyScalar(Math.cos(b) * Math.cos(l))
        .addScaledVector(gy, Math.cos(b) * Math.sin(l))
        .addScaledVector(ngp, Math.sin(b));
    } else {
      const z = rnd() * 2 - 1, ph = rnd() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
      dir = new THREE.Vector3(rr * Math.cos(ph), z, rr * Math.sin(ph));
    }
    put(dir.normalize(), Math.log10(a0 + rnd() * (a1 - a0)) / k, pickTemp());
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SKY_RADIUS * 1.01);
  return geo;
}

export class Sky {
  /**
   * @param {{moonTexture: THREE.Texture, pixelRatio: number, quality?: string}} opts
   */
  constructor({ moonTexture, pixelRatio = 1, quality = 'high' }) {
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'Sky';
    this.sunDir = new THREE.Vector3(1, 0, 0);
    this.moonPos = new THREE.Vector3(60, 0, 0);
    this.moonInfo = null;
    this.issInfo = null;
    this._tmp = new THREE.Vector3();

    // --- Небесная сфера (экваториальная ориентация, следует за камерой) ---
    this.celestial = new THREE.Group();
    this.celestial.rotation.x = -OBLIQUITY;
    this.group.add(this.celestial);

    const q = SKY_QUALITY[quality];
    this.milkyWayMaterial = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0.035 } },
      vertexShader: milkyWayVertex,
      fragmentShader: milkyWayFragment,
      defines: { MW_OCTAVES: q.mwOctaves },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.milkyWay = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS * 1.05, 64, 32), this.milkyWayMaterial);
    this.milkyWay.renderOrder = -10;
    this.milkyWay.frustumCulled = false;
    this.celestial.add(this.milkyWay);

    this.starsMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uScale: { value: 1 }, uOpacity: { value: 1 } },
      vertexShader: starsVertex,
      fragmentShader: starsFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.stars = new THREE.Points(buildStarGeometry(), this.starsMaterial);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.stars.geometry.setDrawRange(0, BRIGHT_STARS.length + q.stars);
    this.celestial.add(this.stars);

    // --- Солнце ---
    this.sunMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDisc: { value: Math.tan(0.42 * DEG) / Math.tan(SUN_QUAD_HALF_ANGLE) },
        uIntensity: { value: 1 },
      },
      vertexShader: billboardVertex,
      fragmentShader: sunFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.sunMaterial);
    this.sun.frustumCulled = false;
    this.sun.renderOrder = -5;
    this.group.add(this.sun);

    // --- Луна ---
    const moonGeo = new THREE.SphereGeometry(MOON_RADIUS, 96, 48);
    moonGeo.rotateY(-Math.PI / 2); // центр видимой стороны (долгота 0°) → +Z
    this.moonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: moonTexture },
        uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
        uSunDir: { value: this.sunDir },
        uEarthPos: { value: new THREE.Vector3(0, 0, 0) },
        uEarthshine: { value: 0.5 },
        uBump: { value: 2.2 },
        uSunPower: { value: 2.0 },
      },
      vertexShader: moonVertex,
      fragmentShader: moonFragment,
      extensions: { derivatives: true },
    });
    this.setMoonTexture(moonTexture);
    this.moon = new THREE.Mesh(moonGeo, this.moonMaterial);
    this.moon.name = 'Moon';
    this.group.add(this.moon);

    this.moonOrbit = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.moonOrbit.frustumCulled = false;
    this.moonOrbitBuiltAt = -Infinity;
    this.group.add(this.moonOrbit);

    // --- МКС ---
    this.equatorial = new THREE.Group();
    this.equatorial.rotation.x = -OBLIQUITY;
    this.group.add(this.equatorial);
    this.issPlane = new THREE.Group();
    this.equatorial.add(this.issPlane);
    const rIss = 1 + ISS_ORBIT.altitudeKm / EARTH_RADIUS_KM;
    const orbitPts = [];
    for (let k = 0; k < 160; k++) {
      const p = eciToLocal(eciFromElements(rIss, ISS_ORBIT.inclination, 0, (k / 160) * Math.PI * 2));
      orbitPts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    this.issOrbit = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(orbitPts),
      new THREE.LineBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    this.issPlane.add(this.issOrbit);

    const issGeo = new THREE.BufferGeometry();
    issGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    this.issMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: 14 },
        uPixelRatio: { value: pixelRatio },
        uColor: { value: new THREE.Color(1.0, 0.9, 0.7).multiplyScalar(2.2) },
        uTime: { value: 0 },
        uIntensity: { value: 1 },
      },
      vertexShader: pointGlowVertex,
      fragmentShader: pointGlowFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.iss = new THREE.Points(issGeo, this.issMaterial);
    this.iss.name = 'ISS';
    this.iss.frustumCulled = false;
    this.equatorial.add(this.iss);
  }

  setPixelRatio(pr) {
    this.starsMaterial.uniforms.uPixelRatio.value = pr;
    this.issMaterial.uniforms.uPixelRatio.value = pr;
  }

  /** Слои: stars | milkyway | moonOrbit | iss | issOrbit */
  setLayer(name, on) {
    const map = { stars: this.stars, milkyway: this.milkyWay, moonOrbit: this.moonOrbit, iss: this.iss, issOrbit: this.issOrbit };
    if (map[name]) map[name].visible = on;
  }

  setQuality(level) {
    const q = SKY_QUALITY[level];
    if (!q || level === this.quality) return;
    this.quality = level;
    this.stars.geometry.setDrawRange(0, BRIGHT_STARS.length + q.stars);
    this.milkyWayMaterial.defines.MW_OCTAVES = q.mwOctaves;
    this.milkyWayMaterial.needsUpdate = true;
  }

  setMoonTexture(tex) {
    const u = this.moonMaterial.uniforms;
    u.uMap.value = tex;
    const img = tex.image;
    if (img && img.width) u.uTexel.value.set(1 / img.width, 1 / img.height);
  }

  /** Перестроить линию орбиты Луны по реальным положениям за сидерический месяц. */
  rebuildMoonOrbit(date) {
    const pts = [];
    const center = date.getTime();
    const span = 27.32 * 86400000;
    for (let k = 0; k <= 240; k++) {
      const p = moonPositionScene(new Date(center + (k / 240 - 0.5) * span));
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    this.moonOrbit.geometry.dispose();
    this.moonOrbit.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.moonOrbitBuiltAt = center;
  }

  /**
   * @param {Date} date
   * @param {number} time — реальное время, с (анимации)
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} sunDir
   */
  update(date, time, camera, sunDir) {
    this.sunDir.copy(sunDir);
    this.celestial.position.copy(camera.position);
    this.starsMaterial.uniforms.uTime.value = time;
    this.sunMaterial.uniforms.uTime.value = time;
    this.issMaterial.uniforms.uTime.value = time;

    // Орбиты проявляются, когда камера отдаляется (у Земли они не мешают).
    const camDist = camera.position.length();
    this.moonOrbit.material.opacity = 0.2 * THREE.MathUtils.smoothstep(camDist, 6, 18);
    this.issOrbit.material.opacity = 0.26 * (1 - THREE.MathUtils.smoothstep(camDist, 5, 9));

    // Солнце — билборд на «бесконечности» с постоянным угловым размером.
    this.sun.position.copy(camera.position).addScaledVector(sunDir, SUN_DISTANCE);
    this.sun.quaternion.copy(camera.quaternion);
    this.sun.scale.setScalar(2 * SUN_DISTANCE * Math.tan(SUN_QUAD_HALF_ANGLE));

    // Луна: положение, приливный захват, пепельный свет.
    const mp = moonPositionScene(date);
    this.moonPos.set(mp.x, mp.y, mp.z);
    this.moon.position.copy(this.moonPos);
    this.moon.lookAt(0, 0, 0);
    const phase = moonPhase(date);
    this.moonMaterial.uniforms.uEarthshine.value = 1 - phase.illumination;
    this.moonInfo = { ...phase, distanceKm: moonPosition(date).distKm };
    if (Math.abs(date.getTime() - this.moonOrbitBuiltAt) > 0.5 * 86400000) this.rebuildMoonOrbit(date);

    // МКС.
    const p = issPositionECI(date);
    const l = eciToLocal(p);
    this.iss.position.set(l.x, l.y, l.z);
    // Видимый размер точки МКС уменьшается с расстоянием камеры.
    const issDist = camera.position.distanceTo(this.getIssWorldPosition(this._tmp));
    this.issMaterial.uniforms.uSize.value = THREE.MathUtils.clamp(40 / Math.max(issDist, 0.1), 2.5, 14);
    this.issMaterial.uniforms.uIntensity.value = 1 - THREE.MathUtils.smoothstep(issDist, 12, 30);
    this.issPlane.rotation.y = p.raan;
    this.issInfo = { ...subSatellitePoint(p, date), altitudeKm: ISS_ORBIT.altitudeKm };
  }

  /** Мировая позиция МКС. */
  getIssWorldPosition(target = new THREE.Vector3()) {
    return this.iss.getWorldPosition(target);
  }

  /**
   * Видимость Солнца для бликов объектива: положение на экране (0..1)
   * и сила с учётом поля зрения и заслонения Землёй/Луной.
   */
  computeSunFlare(camera, out = { x: 0.5, y: 0.5, strength: 0 }) {
    const C = camera.position;
    const S = this.sunDir;
    const forward = this._tmp.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (forward.dot(S) <= 0.05) {
      out.strength = 0;
      return out;
    }
    const p = C.clone().addScaledVector(S, SUN_DISTANCE).project(camera);
    out.x = p.x * 0.5 + 0.5;
    out.y = p.y * 0.5 + 0.5;
    const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
    const frustum = 1 - THREE.MathUtils.smoothstep(edge, 0.95, 1.3);
    const occ = this.occlusion(C, S, new THREE.Vector3(0, 0, 0), 1.015) * this.occlusion(C, S, this.moonPos, MOON_RADIUS);
    out.strength = frustum * occ;
    return out;
  }

  /** 0 — светило закрыто сферой (center, radius), 1 — полностью открыто. */
  occlusion(C, S, center, radius) {
    const D = center.clone().sub(C);
    const dist = D.length();
    if (dist <= radius) return 0;
    const alpha = Math.asin(Math.min(1, radius / dist));
    const theta = Math.acos(THREE.MathUtils.clamp(D.dot(S) / dist, -1, 1));
    return THREE.MathUtils.smoothstep(theta, alpha - 0.002, alpha + 0.025);
  }

  dispose() {
    for (const obj of [this.milkyWay, this.stars, this.sun, this.moon, this.moonOrbit, this.issOrbit, this.iss]) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
  }
}
