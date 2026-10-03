/**
 * interior.js — «Разрез»: из планеты вырезается октант с помощью трёх
 * плоскостей отсечения (clipIntersection), а срезы закрываются «крышками»
 * с послойной раскраской. Плоскости и крышки связаны с вращающейся
 * системой Земли; раскрытие анимируется сдвигом плоскостей от края к центру.
 */
import * as THREE from 'three';
import { INTERIOR_LAYERS } from './data.js';
import { capVertex, capFragment } from './shaders/interior.glsl.js';

const LOCAL_NORMALS = [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1)];
/** Якоря подписей на срезе z = 0: [радиус, угол в плоскости XY]. */
const LABEL_ANCHORS = { crust: [0.991, 72], mantle: [0.78, 58], outer_core: [0.38, 40], inner_core: [0.1, 20] };

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function capGeometry(axis) {
  const verts = {
    0: [0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1],
    1: [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
    2: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  }[axis];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Реальная глубина (км) по радиусу на срезе (кора на срезе утолщена). */
function realDepthKm(r) {
  if (r >= 0.982) return ((1 - r) / 0.018) * 35;
  if (r >= 0.5462) return 35 + ((0.982 - r) / (0.982 - 0.5462)) * (2890 - 35);
  return (1 - r) * 6371;
}

export class Interior {
  /**
   * @param {import('./earth.js').Earth} earth
   * @param {HTMLElement} labelsRoot — контейнер HTML-подписей
   */
  constructor(earth, labelsRoot) {
    this.earth = earth;
    this.active = false;
    this.progress = 0;
    this.target = 0;
    this.planes = LOCAL_NORMALS.map(() => new THREE.Plane(new THREE.Vector3(1, 0, 0), 1));
    this.group = new THREE.Group();
    this.group.name = 'InteriorCaps';
    this.group.visible = false;
    earth.spin.add(this.group);

    this.caps = [0, 1, 2].map((axis) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uOffset: { value: 1 }, uAxis: { value: axis }, uTime: { value: 0 }, uOpacity: { value: 1 } },
        vertexShader: capVertex,
        fragmentShader: capFragment,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(capGeometry(axis), mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });

    this.labels = INTERIOR_LAYERS.map((layer) => {
      const el = document.createElement('div');
      el.className = 'label3d';
      el.style.opacity = '0';
      el.innerHTML = `<b>${layer.name}</b><small>${layer.label}</small>`;
      labelsRoot.appendChild(el);
      const [r, deg] = LABEL_ANCHORS[layer.id];
      const a = THREE.MathUtils.degToRad(deg);
      return { el, anchor: new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), 0) };
    });

    this._q = new THREE.Quaternion();
    this._inv = new THREE.Matrix4();
    this._v = new THREE.Vector3();
  }

  toggle() {
    this.setActive(!this.active);
    return this.active;
  }

  setActive(on) {
    this.active = on;
    this.target = on ? 1 : 0;
    if (on) {
      this.group.visible = true;
      this.earth.setClippingPlanes(this.planes, true);
    }
  }

  /** Направление (мировое) на центр вырезанного октанта — для перелёта камеры. */
  viewDirection(target = new THREE.Vector3()) {
    this.earth.spin.getWorldQuaternion(this._q);
    return target.set(1, 0.85, 1).normalize().applyQuaternion(this._q);
  }

  update(dt, time, camera) {
    if (this.progress !== this.target) {
      const step = dt / 1.4;
      this.progress = this.target > this.progress ? Math.min(1, this.progress + step) : Math.max(0, this.progress - step);
    }
    if (!this.active && this.progress === 0 && this.group.visible) {
      this.group.visible = false;
      this.earth.setClippingPlanes([], false);
      for (const l of this.labels) l.el.style.opacity = '0';
    }
    if (!this.group.visible) return;

    const c = 1 - easeInOutCubic(this.progress);
    this.earth.spin.getWorldQuaternion(this._q);
    this.planes.forEach((p, i) => {
      p.normal.copy(LOCAL_NORMALS[i]).applyQuaternion(this._q);
      p.constant = c;
    });
    for (const cap of this.caps) {
      cap.material.uniforms.uOffset.value = c;
      cap.material.uniforms.uTime.value = time;
    }
    this.updateLabels(camera);
  }

  updateLabels(camera) {
    const spin = this.earth.spin;
    spin.updateWorldMatrix(true, false);
    this._inv.copy(spin.matrixWorld).invert();
    const camLocal = camera.position.clone().applyMatrix4(this._inv);
    const facing = camLocal.clone().normalize().dot(this._v.set(1, 1, 1).normalize());
    const visible = this.progress > 0.95 && camLocal.z > 0.05 && facing > 0.25;
    const w = window.innerWidth, h = window.innerHeight;
    for (const l of this.labels) {
      if (!visible) {
        l.el.style.opacity = '0';
        continue;
      }
      const p = l.anchor.clone().applyMatrix4(spin.matrixWorld).project(camera);
      const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      l.el.style.opacity = p.z < 1 ? '1' : '0';
    }
  }

  /**
   * Слой недр под лучом, если луч попадает в срез раньше поверхности.
   * @param {THREE.Ray} ray — мировой луч
   */
  pickLayer(ray) {
    if (!this.active || this.progress < 0.95) return null;
    const spin = this.earth.spin;
    spin.updateWorldMatrix(true, false);
    this._inv.copy(spin.matrixWorld).invert();
    const o = ray.origin.clone().applyMatrix4(this._inv);
    const d = ray.direction.clone().transformDirection(this._inv);
    const c = 1 - easeInOutCubic(this.progress);
    let best = null;
    for (let axis = 0; axis < 3; axis++) {
      const comp = ['x', 'y', 'z'][axis];
      if (Math.abs(d[comp]) < 1e-6) continue;
      const t = (c - o[comp]) / d[comp];
      if (t <= 0) continue;
      const p = o.clone().addScaledVector(d, t);
      const others = ['x', 'y', 'z'].filter((k) => k !== comp);
      if (p.length() > 1 || p[others[0]] < c || p[others[1]] < c) continue;
      if (!best || t < best.t) best = { t, r: p.length() };
    }
    if (!best) return null;
    // Если поверхность (вне вырезанного октанта) ближе среза — срез закрыт.
    const b = o.dot(d), cc = o.lengthSq() - 1, disc = b * b - cc;
    if (disc > 0) {
      const ts = -b - Math.sqrt(disc);
      const ps = o.clone().addScaledVector(d, ts);
      const inCut = ps.x > c && ps.y > c && ps.z > c;
      if (ts > 0 && ts < best.t && !inCut) return null;
    }
    const layer = INTERIOR_LAYERS.find((l) => best.r <= l.rOuter && best.r >= l.rInner) || INTERIOR_LAYERS[0];
    return { layer, depthKm: realDepthKm(best.r) };
  }

  dispose() {
    for (const cap of this.caps) {
      cap.geometry.dispose();
      cap.material.dispose();
    }
    for (const l of this.labels) l.el.remove();
  }
}
