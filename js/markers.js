/**
 * markers.js — метки на поверхности (светящаяся точка + пульсирующее кольцо)
 * и анимированные дуги большого круга между точками (для игры «Найди на глобусе»).
 * Все объекты привязаны к вращающейся системе Земли.
 */
import * as THREE from 'three';
import { latLonToLocal } from './astro.js';
import { greatCirclePoints } from './geo.js';
import { pointGlowVertex, pointGlowFragment } from './shaders/sun.glsl.js';

const Z = new THREE.Vector3(0, 0, 1);

export class Markers {
  constructor(earth, pixelRatio = 1) {
    this.group = new THREE.Group();
    this.group.name = 'Markers';
    earth.spin.add(this.group);
    this.pixelRatio = pixelRatio;
    this.items = [];
    this.ringGeometry = new THREE.RingGeometry(0.82, 1, 48);
    this.time = 0;
  }

  setPixelRatio(pr) {
    this.pixelRatio = pr;
    for (const it of this.items) if (it.glow) it.glow.material.uniforms.uPixelRatio.value = pr;
  }

  /** Метка в точке (lat, lon). ttl — время жизни, с. */
  addPin(lat, lon, { color = '#ffb347', ttl = Infinity, size = 16 } = {}) {
    const p = latLonToLocal(lat, lon, 1.0035);
    const pos = new THREE.Vector3(p.x, p.y, p.z);
    const c = new THREE.Color(color);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([pos.x, pos.y, pos.z]), 3));
    const glow = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: size },
        uPixelRatio: { value: this.pixelRatio },
        uColor: { value: c.clone().multiplyScalar(2.4) },
        uTime: { value: 0 },
        uIntensity: { value: 1 },
      },
      vertexShader: pointGlowVertex,
      fragmentShader: pointGlowFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }));
    glow.frustumCulled = false;

    const ring = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
      color: c.clone().multiplyScalar(1.6),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    ring.position.copy(pos);
    ring.quaternion.setFromUnitVectors(Z, pos.clone().normalize());
    ring.scale.setScalar(0.02);

    this.group.add(glow, ring);
    const item = { type: 'pin', glow, ring, born: this.time, ttl };
    this.items.push(item);
    return item;
  }

  /** Дуга большого круга, «прорисовывающаяся» за duration секунд. */
  addArc(lat1, lon1, lat2, lon2, { color = '#46d4ff', duration = 1.3, ttl = Infinity } = {}) {
    const d = Math.acos(Math.max(-1, Math.min(1,
      Math.sin(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180))));
    const lift = Math.min(0.3, 0.012 + d * 0.09);
    const pts = greatCirclePoints(lat1, lon1, lat2, lon2, 160, 1.004, lift).map((q) => new THREE.Vector3(q.x, q.y, q.z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(2.2),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    line.frustumCulled = false;
    this.group.add(line);
    const item = { type: 'arc', line, count: pts.length, born: this.time, duration, ttl, mid: pts[Math.floor(pts.length / 2)] };
    this.items.push(item);
    return item;
  }

  remove(item) {
    const objs = item.type === 'pin' ? [item.glow, item.ring] : [item.line];
    for (const o of objs) {
      this.group.remove(o);
      if (o.geometry !== this.ringGeometry) o.geometry.dispose();
      o.material.dispose();
    }
    this.items = this.items.filter((x) => x !== item);
  }

  clear() {
    for (const it of [...this.items]) this.remove(it);
  }

  update(dt, time) {
    this.time += dt;
    for (const it of [...this.items]) {
      const age = this.time - it.born;
      if (age > it.ttl) {
        this.remove(it);
        continue;
      }
      const fade = Number.isFinite(it.ttl) ? 1 - THREE.MathUtils.smoothstep(age, it.ttl - 0.8, it.ttl) : 1;
      if (it.type === 'pin') {
        const pulse = (age * 0.8) % 1;
        it.ring.scale.setScalar(0.012 + pulse * 0.05);
        it.ring.material.opacity = (1 - pulse) * 0.9 * fade;
        it.glow.material.uniforms.uTime.value = time;
        it.glow.material.uniforms.uIntensity.value = fade;
      } else {
        const t = Math.min(1, age / it.duration);
        const e = 1 - Math.pow(1 - t, 3);
        it.line.geometry.setDrawRange(0, Math.max(2, Math.floor(e * it.count)));
        it.line.material.opacity = 0.95 * fade;
      }
    }
  }

  dispose() {
    this.clear();
    this.ringGeometry.dispose();
  }
}
