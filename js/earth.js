/**
 * earth.js — Земля: поверхность, облака и атмосфера на собственных шейдерах.
 *
 * Иерархия:
 *   root  (эклиптическая система сцены, центр Земли в начале координат)
 *    ├─ tilt  (поворот на −23,44° вокруг X: локальная ось Y = ось вращения)
 *    │   └─ spin  (поворот на GMST: «вращающаяся» система, связанная с корой)
 *    │       ├─ surface   — сфера R = 1
 *    │       └─ clouds    — сфера R = 1.006 со своим дрейфом
 *    └─ atmosphere — оболочка R = 1.025 (BackSide, аддитивное смешивание)
 */
import * as THREE from 'three';
import { OBLIQUITY, gmst, latLonToLocal, localToLatLon } from './astro.js';
import { earthVertex, earthFragment } from './shaders/earth.glsl.js';
import { cloudsVertex, cloudsFragment } from './shaders/clouds.glsl.js';
import { atmosphereVertex, atmosphereFragment } from './shaders/atmosphere.glsl.js';

/** Параметры качества: сегменты сфер и число выборок рассеяния. */
export const EARTH_QUALITY = {
  high: { segments: [192, 96], groundSamples: 4, skySamples: 6 },
  medium: { segments: [128, 64], groundSamples: 3, skySamples: 4 },
  low: { segments: [80, 40], groundSamples: 2, skySamples: 3 },
};

/** Облака дрейфуют относительно поверхности: один оборот примерно за 12 суток. */
const CLOUD_DRIFT = (Math.PI * 2) / (12 * 86400);
export const CLOUD_RADIUS = 1.006;
export const ATMOSPHERE_RADIUS = 1.025;

/** Общие униформы модели рассеяния О'Нила (Kr, Km, ESun, длины волн). */
export function createAtmosphereUniforms(sunDir) {
  const inner = 1.0, outer = ATMOSPHERE_RADIUS, scaleDepth = 0.25;
  const Kr = 0.0025, Km = 0.0010, ESun = 20.0;
  const wl = [0.650, 0.570, 0.475]; // мкм
  return {
    uSunDir: { value: sunDir },
    uInnerRadius: { value: inner },
    uOuterRadius: { value: outer },
    uInvWavelength: { value: new THREE.Vector3(1 / wl[0] ** 4, 1 / wl[1] ** 4, 1 / wl[2] ** 4) },
    uKrESun: { value: Kr * ESun },
    uKmESun: { value: Km * ESun },
    uKr4PI: { value: Kr * 4 * Math.PI },
    uKm4PI: { value: Km * 4 * Math.PI },
    uScale: { value: 1 / (outer - inner) },
    uScaleDepth: { value: scaleDepth },
    uScaleOverScaleDepth: { value: 1 / (outer - inner) / scaleDepth },
  };
}

export class Earth {
  /**
   * @param {Object} textures — day, night, specular, normal, clouds
   * @param {{quality?: 'high'|'medium'|'low'}} options
   */
  constructor(textures, { quality = 'high' } = {}) {
    this.textures = textures;
    this.quality = quality;
    this.sunDir = new THREE.Vector3(1, 0, 0);

    this.root = new THREE.Group();
    this.root.name = 'EarthRoot';
    this.tilt = new THREE.Group();
    this.tilt.rotation.x = -OBLIQUITY;
    this.root.add(this.tilt);
    this.spin = new THREE.Group();
    this.tilt.add(this.spin);

    /** Текущие и целевые значения слоёв/оверлеев (для плавных переходов). */
    this.layers = { clouds: 1, atmosphere: 1, lights: 1 };
    this.layerTargets = { ...this.layers };
    this.overlays = { grid: 0, tropics: 0, timezones: 0, climate: 0 };
    this.overlayTargets = { ...this.overlays };
    this.cloudDrift = 0;

    const q = EARTH_QUALITY[quality];
    const atmo = createAtmosphereUniforms(this.sunDir);
    this.atmoUniforms = atmo;

    this.surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...atmo,
        uDayMap: { value: textures.day },
        uNightMap: { value: textures.night },
        uSpecMap: { value: textures.specular },
        uNormalMap: { value: textures.normal },
        uCloudMap: { value: textures.clouds },
        uNormalScale: { value: 0.9 },
        uCloudShift: { value: 0 },
        uCloudShadow: { value: 1 },
        uCityLights: { value: 1.7 },
        uSpecular: { value: 6.0 },
        uSunPower: { value: 1.9 },
        uHaze: { value: 1.0 },
        uRim: { value: 0.35 },
        uGrid: { value: 0 },
        uTropics: { value: 0 },
        uTimeZones: { value: 0 },
        uClimate: { value: 0 },
      },
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
      defines: { ATMO_SAMPLES: q.groundSamples },
      extensions: { derivatives: true },
      clipping: true,
    });
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(1, q.segments[0], q.segments[1]), this.surfaceMaterial);
    this.surface.name = 'EarthSurface';
    this.spin.add(this.surface);

    this.cloudsMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCloudMap: { value: textures.clouds },
        uNightMap: { value: textures.night },
        uSunDir: atmo.uSunDir,
        uOpacity: { value: 0.95 },
        uGroundShift: { value: 0 },
        uCityLights: { value: 1 },
      },
      vertexShader: cloudsVertex,
      fragmentShader: cloudsFragment,
      transparent: true,
      depthWrite: false,
      clipping: true,
    });
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(CLOUD_RADIUS, q.segments[0], q.segments[1]),
      this.cloudsMaterial,
    );
    this.clouds.name = 'Clouds';
    this.clouds.renderOrder = 1;
    this.spin.add(this.clouds);

    this.atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: { ...atmo, uMieG: { value: 0.95 }, uIntensity: { value: 1.0 } },
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      defines: { ATMO_SAMPLES: q.skySamples },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(ATMOSPHERE_RADIUS, q.segments[0], q.segments[1]),
      this.atmosphereMaterial,
    );
    this.atmosphere.name = 'Atmosphere';
    this.atmosphere.renderOrder = 2;
    this.root.add(this.atmosphere);

    this._inv = new THREE.Matrix4();
  }

  /** Заменить текстуру (например, когда настоящая пришла с CDN после таймаута). */
  setTexture(key, tex) {
    const s = this.surfaceMaterial.uniforms, c = this.cloudsMaterial.uniforms;
    if (key === 'day') s.uDayMap.value = tex;
    if (key === 'night') { s.uNightMap.value = tex; c.uNightMap.value = tex; }
    if (key === 'specular') s.uSpecMap.value = tex;
    if (key === 'normal') s.uNormalMap.value = tex;
    if (key === 'clouds') { s.uCloudMap.value = tex; c.uCloudMap.value = tex; }
    this.textures[key] = tex;
  }

  /** Включить/выключить слой: clouds | atmosphere | lights. */
  setLayer(name, on) {
    if (name in this.layerTargets) this.layerTargets[name] = on ? 1 : 0;
  }

  /** Включить/выключить оверлей: grid | tropics | timezones | climate. */
  setOverlay(name, on) {
    if (name in this.overlayTargets) this.overlayTargets[name] = on ? 1 : 0;
  }

  /** Плоскости отсечения (разрез планеты) для поверхности и облаков. */
  setClippingPlanes(planes) {
    this.surfaceMaterial.clippingPlanes = planes;
    this.cloudsMaterial.clippingPlanes = planes;
    this.surfaceMaterial.needsUpdate = true;
    this.cloudsMaterial.needsUpdate = true;
  }

  setQuality(level) {
    const q = EARTH_QUALITY[level];
    if (!q || level === this.quality) return;
    this.quality = level;
    const swap = (mesh, r) => {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.SphereGeometry(r, q.segments[0], q.segments[1]);
    };
    swap(this.surface, 1);
    swap(this.clouds, CLOUD_RADIUS);
    swap(this.atmosphere, ATMOSPHERE_RADIUS);
    this.surfaceMaterial.defines.ATMO_SAMPLES = q.groundSamples;
    this.atmosphereMaterial.defines.ATMO_SAMPLES = q.skySamples;
    this.surfaceMaterial.needsUpdate = true;
    this.atmosphereMaterial.needsUpdate = true;
  }

  /**
   * @param {Date} date — момент симуляции
   * @param {number} dtSim — шаг симуляции, с
   * @param {number} dtReal — реальный шаг кадра, с
   * @param {THREE.Vector3} sunDir — направление на Солнце
   */
  update(date, dtSim, dtReal, sunDir) {
    this.sunDir.copy(sunDir);
    this.spin.rotation.y = gmst(date);

    this.cloudDrift = (this.cloudDrift + dtSim * CLOUD_DRIFT) % (Math.PI * 2);
    this.clouds.rotation.y = this.cloudDrift;
    const shift = -this.cloudDrift / (Math.PI * 2);

    const k = 1 - Math.exp(-dtReal * 5);
    for (const key of Object.keys(this.layers)) this.layers[key] += (this.layerTargets[key] - this.layers[key]) * k;
    for (const key of Object.keys(this.overlays)) this.overlays[key] += (this.overlayTargets[key] - this.overlays[key]) * k;

    const s = this.surfaceMaterial.uniforms;
    const c = this.cloudsMaterial.uniforms;
    s.uCloudShift.value = shift;
    c.uGroundShift.value = -shift;
    s.uCloudShadow.value = this.layers.clouds;
    c.uOpacity.value = 0.95 * this.layers.clouds;
    this.clouds.visible = this.layers.clouds > 0.01;
    s.uHaze.value = 0.42 * this.layers.atmosphere;
    s.uRim.value = 0.25 * this.layers.atmosphere;
    this.atmosphereMaterial.uniforms.uIntensity.value = 0.8 * this.layers.atmosphere;
    this.atmosphere.visible = this.layers.atmosphere > 0.01;
    s.uCityLights.value = 2.2 * this.layers.lights;
    c.uCityLights.value = this.layers.lights;
    s.uGrid.value = this.overlays.grid;
    s.uTropics.value = this.overlays.tropics;
    s.uTimeZones.value = this.overlays.timezones;
    s.uClimate.value = this.overlays.climate;
  }

  /** Географические координаты → мировая позиция (с учётом наклона и вращения). */
  latLonToWorld(lat, lon, radius = 1, target = new THREE.Vector3()) {
    const p = latLonToLocal(lat, lon, radius);
    this.spin.updateWorldMatrix(true, false);
    return target.set(p.x, p.y, p.z).applyMatrix4(this.spin.matrixWorld);
  }

  /** Мировая точка → широта/долгота (градусы). */
  worldToLatLon(point) {
    this.spin.updateWorldMatrix(true, false);
    this._inv.copy(this.spin.matrixWorld).invert();
    const p = point.clone().applyMatrix4(this._inv);
    return localToLatLon(p.x, p.y, p.z);
  }

  dispose() {
    for (const mesh of [this.surface, this.clouds, this.atmosphere]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
