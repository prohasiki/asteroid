/**
 * camera.js — «режиссёр» камеры: плавные кинематографичные перелёты
 * (сферическая интерполяция направления, логарифмическая — расстояния,
 * подъём по дуге), автовращение с паузой при взаимодействии и режим
 * «Вид с Луны» в духе снимка «Восход Земли» (Аполлон-8).
 */
import * as THREE from 'three';
import { MOON_RADIUS } from './sky.js';

export const DEFAULT_DISTANCE = 3.6;
export const DEFAULT_FOV = 40;
const MOON_FOV = 14;
const Y = new THREE.Vector3(0, 1, 0);

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraDirector {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
   * @param {{getMoonPos: () => THREE.Vector3, getSunDir: () => THREE.Vector3}} world
   */
  constructor(camera, controls, world) {
    this.camera = camera;
    this.controls = controls;
    this.world = world;
    this.mode = 'orbit'; // orbit | flight | moon
    this.flight = null;
    this.autoRotateEnabled = true;
    this.userActive = false;
    this.idle = 0;
    this.moonFov = MOON_FOV;
    this.listeners = new Set();

    controls.addEventListener('start', () => {
      this.userActive = true;
      this.idle = 0;
      controls.autoRotate = false;
    });
    controls.addEventListener('end', () => {
      this.userActive = false;
      this.idle = 0;
    });
    // В режиме «Вид с Луны» колесо/щипок меняют фокусное расстояние (телеобъектив).
    controls.domElement.addEventListener('wheel', (e) => {
      if (this.mode !== 'moon') return;
      e.preventDefault();
      this.moonFov = THREE.MathUtils.clamp(this.moonFov * (1 + e.deltaY * 0.0012), 4, 45);
    }, { passive: false });
  }

  onModeChange(fn) {
    this.listeners.add(fn);
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    for (const fn of this.listeners) fn(mode);
  }

  setAutoRotate(on) {
    this.autoRotateEnabled = on;
    this.controls.autoRotate = on && this.mode === 'orbit';
  }

  get busy() {
    return this.mode === 'flight';
  }

  /**
   * Расстояние, при котором планета целиком помещается в кадр по меньшей
   * из сторон (на телефоне в портретной ориентации — по ширине).
   */
  fitDistance() {
    const halfV = THREE.MathUtils.degToRad(DEFAULT_FOV / 2);
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    const angular = Math.min(halfV, halfH) * 0.78;
    return Math.max(DEFAULT_DISTANCE, 1 / Math.sin(angular));
  }

  /** Поза по умолчанию: три четверти освещённого диска, лёгкий взгляд сверху. */
  defaultPose() {
    const sun = this.world.getSunDir();
    const dir = sun.clone().applyAxisAngle(Y, 0.95);
    dir.y += 0.28;
    dir.normalize();
    return { position: dir.multiplyScalar(this.fitDistance()), target: new THREE.Vector3(), up: Y.clone(), fov: DEFAULT_FOV };
  }

  /** Поза «Вид с Луны»: камера у лунного лимба, Земля над горизонтом. */
  moonPose() {
    const m = this.world.getMoonPos();
    const u = m.clone().negate().normalize(); // от Луны к Земле
    const perp = Y.clone().addScaledVector(u, -u.dot(Y)).normalize();
    const position = m.clone().addScaledVector(perp, MOON_RADIUS + 0.003);
    const dist = position.length();
    const target = new THREE.Vector3().addScaledVector(perp, -dist * Math.tan((this.moonFov / 14) * 4 * THREE.MathUtils.DEG2RAD));
    return { position, target, up: perp, fov: this.moonFov };
  }

  /**
   * Перелёт камеры. endFn вызывается каждый кадр (цель может двигаться,
   * например точка на вращающейся Земле или Луна на орбите).
   */
  fly(endFn, { duration = 2.8, arc = 0.25, mode = 'orbit', onDone } = {}) {
    const cam = this.camera;
    this.flight = {
      t: 0,
      duration,
      arc,
      mode,
      onDone,
      endFn,
      p0: cam.position.clone(),
      t0: this.mode === 'moon' ? this.moonPose().target : this.controls.target.clone(),
      up0: cam.up.clone(),
      fov0: cam.fov,
    };
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.setMode('flight');
  }

  /** Перелёт к точке на поверхности (учитывает вращение Земли во время полёта). */
  flyToLatLon(earth, lat, lon, distance = 2.4, opts = {}) {
    this.fly(() => ({
      position: earth.latLonToWorld(lat, lon, distance),
      target: new THREE.Vector3(),
      up: Y.clone(),
      fov: DEFAULT_FOV,
    }), { duration: 2.6, arc: 0.18, ...opts });
  }

  flyToMoon(opts = {}) {
    this.moonFov = MOON_FOV;
    this.fly(() => this.moonPose(), { duration: 4.8, arc: 0.05, mode: 'moon', ...opts });
  }

  reset(opts = {}) {
    this.fly(() => this.defaultPose(), { duration: 2.4, arc: 0.12, mode: 'orbit', ...opts });
  }

  /** Мгновенно поставить камеру в позу по умолчанию (при запуске). */
  snapToDefault() {
    const p = this.defaultPose();
    this.camera.position.copy(p.position);
    this.camera.up.copy(p.up);
    this.controls.target.copy(p.target);
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  update(dt) {
    const cam = this.camera;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = easeInOutCubic(f.t);
      const end = f.endFn();

      const target = f.t0.clone().lerp(end.target, e);
      const d0 = Math.max(f.p0.length(), 1e-3), d1 = Math.max(end.position.length(), 1e-3);
      const dir0 = f.p0.clone().divideScalar(d0), dir1 = end.position.clone().divideScalar(d1);
      const q = new THREE.Quaternion().setFromUnitVectors(dir0, dir1);
      const qt = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), q, e);
      const dist = Math.exp(THREE.MathUtils.lerp(Math.log(d0), Math.log(d1), e)) * (1 + f.arc * Math.sin(Math.PI * e));
      cam.position.copy(dir0.applyQuaternion(qt)).multiplyScalar(dist);
      cam.up.copy(f.up0).lerp(end.up, e).normalize();
      cam.fov = THREE.MathUtils.lerp(f.fov0, end.fov, e);
      cam.updateProjectionMatrix();
      cam.lookAt(target);

      if (f.t >= 1) {
        this.flight = null;
        if (f.mode === 'orbit') {
          this.controls.target.copy(end.target);
          cam.up.copy(Y);
          this.controls.enabled = true;
          this.controls.update();
          this.controls.autoRotate = this.autoRotateEnabled;
          this.idle = 0;
        }
        this.setMode(f.mode);
        if (f.onDone) f.onDone();
      }
      return;
    }

    if (this.mode === 'moon') {
      const p = this.moonPose();
      cam.position.copy(p.position);
      cam.up.copy(p.up);
      if (Math.abs(cam.fov - p.fov) > 0.01) {
        cam.fov += (p.fov - cam.fov) * Math.min(1, dt * 6);
        cam.updateProjectionMatrix();
      }
      cam.lookAt(p.target);
      return;
    }

    // Орбитальный режим: возобновить автовращение после 6 с бездействия.
    if (!this.userActive && this.autoRotateEnabled && !this.controls.autoRotate) {
      this.idle += dt;
      if (this.idle > 6) this.controls.autoRotate = true;
    }
    this.controls.update();
  }
}
