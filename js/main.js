/**
 * main.js — точка входа: рендерер, сцена, камера, постобработка, цикл рендера.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadTextures } from './textures.js';
import { Earth } from './earth.js';
import { Sky, MOON_RADIUS } from './sky.js';
import { PostFX } from './post.js';
import { sunDirectionScene } from './astro.js';

class App {
  constructor() {
    this.container = document.getElementById('scene');
    this.clock = new THREE.Clock();
    /** Время симуляции (мс с эпохи Unix), скорость и пауза. */
    this.sim = { time: Date.now(), speed: 1, paused: false };
    this.sunDir = new THREE.Vector3(1, 0, 0);
    this.flare = { x: 0.5, y: 0.5, strength: 0 };
    this.quality = 'high';
  }

  async init() {
    this.initRenderer();
    this.initScene();
    this.post = new PostFX(this.renderer, this.scene, this.camera, { quality: this.quality });
    window.addEventListener('resize', () => this.onResize());

    const { textures, fallback } = await loadTextures(this.renderer, {
      onProgress: (e) => this.onLoadProgress(e),
      onUpgrade: (key, tex, old) => {
        if (key === 'moon') this.sky?.setMoonTexture(tex);
        else this.earth?.setTexture(key, tex);
        if (old) old.dispose();
      },
    });
    this.textures = textures;
    this.fallback = fallback;

    this.earth = new Earth(textures, { quality: this.quality });
    this.scene.add(this.earth.root);
    this.sky = new Sky({ moonTexture: textures.moon, pixelRatio: this.renderer.getPixelRatio(), quality: this.quality });
    this.scene.add(this.sky.group);

    document.body.classList.add('is-ready');
    window.__earthApp = this;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 4000);
    this.camera.position.set(0.8, 1.1, 3.6);

    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.enablePan = false;
    controls.minDistance = 1.25;
    controls.maxDistance = 40;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;
    this.controls = controls;
  }

  onLoadProgress(e) {
    const bar = document.getElementById('loader-bar');
    const text = document.getElementById('loader-text');
    if (e.type === 'item') {
      if (bar) bar.style.width = `${Math.round((e.done / e.all) * 100)}%`;
      if (text) text.textContent = `${e.label}: ${e.fallback ? 'процедурная замена' : 'загружено'}`;
    }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  /** Ближняя плоскость отсечения по расстоянию до ближайшей поверхности (точность глубины). */
  updateClipPlanes() {
    const cam = this.camera.position;
    const dEarth = cam.length() - 1;
    const dMoon = cam.distanceTo(this.sky.moonPos) - MOON_RADIUS;
    const near = THREE.MathUtils.clamp(Math.min(dEarth, dMoon) * 0.35, 0.002, 1.0);
    if (Math.abs(near - this.camera.near) / this.camera.near > 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    const dtSim = this.sim.paused ? 0 : dt * this.sim.speed;
    this.sim.time += dtSim * 1000;
    const date = new Date(this.sim.time);

    const s = sunDirectionScene(date);
    this.sunDir.set(s.x, s.y, s.z);
    this.earth.update(date, dtSim, dt, this.sunDir);

    this.controls.update();
    this.sky.update(date, time, this.camera, this.sunDir);
    this.updateClipPlanes();
    this.sky.computeSunFlare(this.camera, this.flare);
    this.post.update(time, this.flare);
    this.post.render(dt);
  }
}

const app = new App();
app.init().catch((err) => {
  console.error(err);
  const text = document.getElementById('loader-text');
  if (text) text.textContent = `Ошибка запуска: ${err.message}`;
});
