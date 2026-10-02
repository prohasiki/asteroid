/**
 * magnetosphere.js — магнитное поле Земли: силовые линии диполя
 * r = L·cos²λ (ось наклонена к геомагнитному полюсу 80,8° с.ш., 72,8° з.д.)
 * и полярные сияния в авроральных овалах обоих полушарий.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { latLonToLocal } from './astro.js';
import { fieldVertex, fieldFragment, auroraVertex, auroraFragment } from './shaders/magnetosphere.glsl.js';

/** Геомагнитный северный полюс (ось диполя), модель WMM2025. */
export const GEOMAGNETIC_POLE = { lat: 80.8, lon: -72.8 };
const L_SHELLS = [1.6, 2.2, 3.0, 4.2, 5.8, 7.6];
const LONGITUDES = 10;
const Y = new THREE.Vector3(0, 1, 0);

function buildFieldGeometry() {
  const parts = [];
  L_SHELLS.forEach((L, li) => {
    const lam0 = Math.acos(Math.sqrt(1.012 / L));
    for (let k = 0; k < LONGITUDES; k++) {
      const phi = (k / LONGITUDES) * Math.PI * 2 + li * 0.21;
      const pts = [];
      for (let i = 0; i <= 64; i++) {
        const lam = -lam0 + (2 * lam0 * i) / 64;
        const r = L * Math.cos(lam) ** 2;
        pts.push(new THREE.Vector3(r * Math.cos(lam) * Math.cos(phi), r * Math.sin(lam), r * Math.cos(lam) * Math.sin(phi)));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 96, 0.0022 + 0.0007 * li, 5, false);
      const count = geo.attributes.position.count;
      geo.setAttribute('aL', new THREE.Float32BufferAttribute(new Float32Array(count).fill(li / (L_SHELLS.length - 1)), 1));
      parts.push(geo);
    }
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

function buildAuroraGeometry(segments = 360, rows = 3) {
  const count = (segments + 1) * rows;
  const pos = new Float32Array(count * 3);
  const phi = new Float32Array(count);
  const v = new Float32Array(count);
  let n = 0;
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j < rows; j++) {
      phi[n] = (i / segments) * Math.PI * 2;
      v[n] = j / (rows - 1);
      n++;
    }
  }
  const index = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j, b = (i + 1) * rows + j;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhi', new THREE.BufferAttribute(phi, 1));
  geo.setAttribute('aV', new THREE.BufferAttribute(v, 1));
  geo.setIndex(index);
  return geo;
}

export class Magnetosphere {
  /** @param {import('./earth.js').Earth} earth */
  constructor(earth) {
    this.earth = earth;
    this.group = new THREE.Group();
    this.group.name = 'Magnetosphere';
    const axis = latLonToLocal(GEOMAGNETIC_POLE.lat, GEOMAGNETIC_POLE.lon);
    this.group.quaternion.setFromUnitVectors(Y, new THREE.Vector3(axis.x, axis.y, axis.z));
    earth.spin.add(this.group);

    this.fieldOn = false;
    this.fieldLevel = 0;
    this.auroraOn = true;
    this.auroraLevel = 1;
    this.boost = 0; // временное усиление сияний (кнопка в разделе)

    this.fieldMaterial = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: fieldVertex,
      fragmentShader: fieldFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.field = new THREE.Mesh(buildFieldGeometry(), this.fieldMaterial);
    this.field.visible = false;
    this.field.frustumCulled = false;
    this.group.add(this.field);

    const auroraGeo = buildAuroraGeometry();
    this.auroras = [1, -1].map((hemi) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTheta0: { value: THREE.MathUtils.degToRad(20) },
          uShift: { value: THREE.MathUtils.degToRad(5) },
          uNightPhi: { value: 0 },
          uR0: { value: 1.0157 },
          uR1: { value: 1.05 },
          uHemi: { value: hemi },
          uTime: { value: 0 },
          uIntensity: { value: 1 },
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        },
        vertexShader: auroraVertex,
        fragmentShader: auroraFragment,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(auroraGeo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      return mesh;
    });

    this._q = new THREE.Quaternion();
    this._d = new THREE.Vector3();
  }

  setField(on) {
    this.fieldOn = on;
  }

  setAurora(on) {
    this.auroraOn = on;
  }

  /** Кратковременно усилить сияния (как во время магнитной бури). */
  storm(seconds = 12) {
    this.boost = seconds;
    this.auroraOn = true;
  }

  update(time, dt, sunDir) {
    const k = 1 - Math.exp(-dt * 4);
    this.fieldLevel += ((this.fieldOn ? 1 : 0) - this.fieldLevel) * k;
    this.auroraLevel += ((this.auroraOn ? 1 : 0) - this.auroraLevel) * k;
    this.boost = Math.max(0, this.boost - dt);

    this.field.visible = this.fieldLevel > 0.01;
    this.fieldMaterial.uniforms.uOpacity.value = this.fieldLevel;
    this.fieldMaterial.uniforms.uTime.value = time;
    this.fieldMaterial.uniforms.uSunDir.value.copy(sunDir);

    // Магнитная долгота антисолнечной точки — овалы смещены на ночную сторону.
    this.group.getWorldQuaternion(this._q).invert();
    this._d.copy(sunDir).negate().applyQuaternion(this._q);
    const nightPhi = Math.atan2(this._d.z, this._d.x);
    const intensity = this.auroraLevel * (1 + Math.min(this.boost, 3) * 0.25);
    for (const a of this.auroras) {
      const u = a.material.uniforms;
      u.uTime.value = time;
      u.uNightPhi.value = nightPhi;
      u.uIntensity.value = intensity;
      u.uSunDir.value.copy(sunDir);
      a.visible = this.auroraLevel > 0.01;
    }
  }

  dispose() {
    this.field.geometry.dispose();
    this.fieldMaterial.dispose();
    this.auroras[0].geometry.dispose();
    for (const a of this.auroras) a.material.dispose();
  }
}
