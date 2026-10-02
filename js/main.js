/**
 * main.js — точка входа: рендерер, сцена, камера, постобработка, цикл рендера.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadTextures } from './textures.js';
import { Earth } from './earth.js';
import { sunDirectionScene } from './astro.js';

class App {
  constructor() {
    this.container = document.getElementById('scene');
    this.clock = new THREE.Clock();
    /** Время симуляции (мс с эпохи Unix), скорость и пауза. */
    this.sim = { time: Date.now(), speed: 1, paused: false };
    this.sunDir = new THREE.Vector3(1, 0, 0);
  }

  async init() {
    this.initRenderer();
    this.initScene();
    this.initPost();
    window.addEventListener('resize', () => this.onResize());

    const { textures, fallback } = await loadTextures(this.renderer, {
      onProgress: (e) => this.onLoadProgress(e),
      onUpgrade: (key, tex, old) => {
        if (this.earth) this.earth.setTexture(key, tex);
        if (old) old.dispose();
      },
    });
    this.textures = textures;
    this.fallback = fallback;

    this.earth = new Earth(textures);
    this.scene.add(this.earth.root);

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

    this.sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
    this.scene.add(this.sunLight);
    this.scene.add(new THREE.AmbientLight(0x223344, 0.08));
  }

  initPost() {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 0.85);
    composer.addPass(this.bloomPass);
    composer.addPass(new OutputPass());
    this.composer = composer;
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
    this.composer.setSize(w, h);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const dtSim = this.sim.paused ? 0 : dt * this.sim.speed;
    this.sim.time += dtSim * 1000;
    const date = new Date(this.sim.time);

    const s = sunDirectionScene(date);
    this.sunDir.set(s.x, s.y, s.z);
    this.sunLight.position.copy(this.sunDir).multiplyScalar(50);
    this.earth.update(date, dtSim, dt, this.sunDir);

    this.controls.update();
    this.composer.render();
  }
}

const app = new App();
app.init().catch((err) => {
  console.error(err);
  const text = document.getElementById('loader-text');
  if (text) text.textContent = `Ошибка запуска: ${err.message}`;
});
