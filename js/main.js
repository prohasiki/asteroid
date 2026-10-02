/**
 * main.js — точка входа: сцена, камера, постобработка, цикл рендера,
 * связь 3D-мира с интерфейсом (HUD, клики по глобусу, управление временем).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadTextures } from './textures.js';
import { Earth } from './earth.js';
import { Sky, MOON_RADIUS } from './sky.js';
import { PostFX } from './post.js';
import { CameraDirector } from './camera.js';
import { UI, plural } from './ui.js';
import { Interior } from './interior.js';
import { Magnetosphere } from './magnetosphere.js';
import { Continents } from './continents.js';
import { Markers } from './markers.js';
import { Quiz } from './quiz.js';
import { FindGame } from './findgame.js';
import { Progress } from './achievements.js';
import { AudioEngine } from './audio.js';
import { CONTINENT_NAMES, CONTINENTS } from './data.js';
import { sunDirectionScene, sunPosition, RAD, EARTH_RADIUS_KM } from './astro.js';
import { regionAt, nearestCity, localSolarTime, nominalUtcOffset, formatUtcOffset, formatCoords } from './geo.js';

window.__earthBooted = true;

const DAY_MS = 86400000;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** SVG-иконка фазы Луны (вид из Северного полушария). */
function moonPhaseSVG(illumination, waxing) {
  const R = 30;
  const rx = Math.abs(1 - 2 * illumination) * R;
  const sweep = illumination > 0.5 ? 1 : 0;
  const path = `M 0 ${-R} A ${R} ${R} 0 0 1 0 ${R} A ${rx.toFixed(2)} ${R} 0 0 ${sweep} 0 ${-R} Z`;
  return `<svg viewBox="-34 -34 68 68" aria-hidden="true"><circle r="${R}" fill="#18202e" stroke="rgba(160,190,230,.25)"/>`
    + `<path d="${path}" fill="#efe9dc" transform="scale(${waxing ? 1 : -1},1)"/></svg>`;
}
const QUALITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const PIXEL_RATIO = { high: 2, medium: 1.5, low: 1 };

class App {
  constructor() {
    this.container = document.getElementById('scene');
    this.clock = new THREE.Clock();
    /** Время симуляции (мс с эпохи Unix), скорость и пауза. */
    this.sim = { time: Date.now(), speed: 1, paused: false };
    this.sunDir = new THREE.Vector3(1, 0, 0);
    this.flare = { x: 0.5, y: 0.5, strength: 0 };
    const weak = window.matchMedia('(max-width: 768px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
    this.quality = weak ? 'medium' : 'high';
    this.qualityMode = 'auto';
    this.pointer = { x: 0, y: 0, inside: false, downX: 0, downY: 0, downT: 0 };
    this.hover = null;
    this.raycaster = new THREE.Raycaster();
    this.fps = 60;
    this.frames = 0;
    this.fpsTime = 0;
    this.hudTime = 0;
    this.frameIndex = 0;
  }

  async init() {
    this.initRenderer();
    this.initScene();
    this.post = new PostFX(this.renderer, this.scene, this.camera, { quality: this.quality });
    this.ui = new UI(this);
    window.addEventListener('resize', () => this.onResize());

    const { textures, fallback } = await loadTextures(this.renderer, {
      onProgress: (e) => this.ui.loaderProgress(e),
      onUpgrade: (key, tex, old) => {
        if (key === 'moon') this.sky?.setMoonTexture(tex);
        else this.earth?.setTexture(key, tex);
        if (old) old.dispose();
      },
    });
    this.textures = textures;
    this.fallback = fallback;
    this.ui.loaderStatus('Сборка сцены…');

    this.earth = new Earth(textures, { quality: this.quality });
    this.scene.add(this.earth.root);
    this.sky = new Sky({ moonTexture: textures.moon, pixelRatio: this.renderer.getPixelRatio(), quality: this.quality });
    this.scene.add(this.sky.group);
    this.interior = new Interior(this.earth, document.getElementById('labels'));
    this.magneto = new Magnetosphere(this.earth);
    this.continents = new Continents(this.earth);
    this.markers = new Markers(this.earth, this.renderer.getPixelRatio());
    this.selectedContinent = null;
    this.visitedContinents = new Set();

    this.audio = new AudioEngine();
    this.progress = new Progress(this.ui);
    this.progress.audio = this.audio;
    this.quiz = new Quiz({
      root: document.getElementById('quiz'),
      card: document.getElementById('quiz-card'),
      audio: this.audio,
      onCombo: () => this.progress.unlock('combo5'),
      onFinish: (r) => {
        const record = this.progress.recordQuiz(r.score);
        this.progress.unlock('quiz_done');
        if (r.rank === 'Астронавт') this.progress.unlock('astronaut');
        if (record) this.ui.toast({ title: 'Новый рекорд викторины', text: `${r.score.toLocaleString('ru-RU')} ${plural(r.score, ['очко', 'очка', 'очков'])}`, iconName: 'star', kind: 'info' });
      },
    });
    this.findGame = new FindGame({ root: document.getElementById('findgame'), app: this });

    this.director = new CameraDirector(this.camera, this.controls, {
      getMoonPos: () => this.sky.moonPos,
      getSunDir: () => this.sunDir,
    });
    this.director.onModeChange((mode) => this.onCameraMode(mode));
    this.updateSun(new Date(this.sim.time));
    this.sky.update(new Date(this.sim.time), 0, this.camera, this.sunDir);
    this.director.snapToDefault();

    this.bindPointer();
    this.setQualityMode('auto');
    this.ui.openSection('basics');

    document.body.classList.add('is-ready');
    window.__earthApp = this;
    if (Object.values(fallback).some(Boolean)) {
      this.ui.toast({ title: 'Офлайн-режим текстур', text: 'CDN недоступен: используются процедурные текстуры.', iconName: 'planet', kind: 'info', duration: 6000 });
    }
    this.renderer.setAnimationLoop(() => this.frame());
  }

  initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[this.quality]));
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
    this.camera.position.set(0, 0, 3.6);

    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.enablePan = false;
    controls.minDistance = 1.25;
    controls.maxDistance = 200;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;
    this.controls = controls;
  }

  /* ---------------- Указатель и клики ---------------- */

  bindPointer() {
    const el = this.renderer.domElement;
    const p = this.pointer;
    el.addEventListener('pointermove', (e) => { p.x = e.clientX; p.y = e.clientY; p.inside = true; });
    el.addEventListener('pointerleave', () => { p.inside = false; });
    el.addEventListener('pointerdown', (e) => {
      p.downX = e.clientX;
      p.downY = e.clientY;
      p.downT = performance.now();
      this.ui.closeSheets();
    });
    el.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - p.downX, e.clientY - p.downY);
      if (moved < 6 && performance.now() - p.downT < 650) this.onClick(e.clientX, e.clientY);
    });
  }

  rayFromScreen(x, y) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  /** Аналитическое пересечение луча со сферой; возвращает расстояние или null. */
  static raySphere(ray, center, radius) {
    const oc = ray.origin.clone().sub(center);
    const b = oc.dot(ray.direction);
    const c = oc.lengthSq() - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? t : null;
  }

  /** Точка глобуса под экранной координатой: { point, lat, lon, distance } или null. */
  pickEarth(x, y) {
    const ray = this.rayFromScreen(x, y);
    const t = App.raySphere(ray, new THREE.Vector3(), 1);
    if (t == null) return null;
    const point = ray.at(t, new THREE.Vector3());
    return { point, distance: t, ...this.earth.worldToLatLon(point) };
  }

  pickMoon(x, y) {
    const ray = this.rayFromScreen(x, y);
    return App.raySphere(ray, this.sky.moonPos, MOON_RADIUS * 1.05);
  }

  onClick(x, y) {
    if (this.findGame?.active) {
      const hit = this.pickEarth(x, y);
      if (hit) this.findGame.guess(hit.lat, hit.lon);
      return;
    }
    const hit = this.pickEarth(x, y);
    const tMoon = this.pickMoon(x, y);
    if (tMoon != null && (!hit || tMoon < hit.distance)) {
      this.ui.showMoonCard(this.sky.moonInfo, x, y);
      this.audio?.click();
      return;
    }
    const cut = this.interior.pickLayer(this.rayFromScreen(x, y));
    if (cut) {
      this.ui.showLayerCard(cut.layer, cut.depthKm, x, y);
      this.audio?.click();
      return;
    }
    if (!hit) {
      this.ui.hideCard();
      return;
    }
    const info = this.describePoint(hit.lat, hit.lon);
    this.markers.addPin(hit.lat, hit.lon, { color: '#46d4ff', ttl: 8, size: 14 });
    if (this.ui.currentSection === 'continents' && info.continent) this.showContinent(info.continent);
    else this.ui.showPointCard(info, x, y);
    this.progress.unlock('first_contact');
    this.audio?.click();
  }

  /** Подробности о точке поверхности для карточки и HUD. */
  describePoint(lat, lon) {
    const region = regionAt(lat, lon);
    const date = new Date(this.sim.time);
    const n = this.earth.latLonToWorld(lat, lon, 1).normalize();
    const sunElevation = Math.asin(THREE.MathUtils.clamp(n.dot(this.sunDir), -1, 1)) * RAD;
    let dayState = 'Ночь';
    if (sunElevation > 0) dayState = 'День';
    else if (sunElevation > -6) dayState = 'Гражданские сумерки';
    else if (sunElevation > -12) dayState = 'Навигационные сумерки';
    else if (sunElevation > -18) dayState = 'Астрономические сумерки';
    const continentName = region.continent ? CONTINENT_NAMES[region.continent] : null;
    let title, regionLabel;
    if (region.kind === 'land') {
      title = region.island || continentName;
      regionLabel = region.island ? `${region.island} (${continentName})` : continentName;
    } else {
      title = region.name;
      regionLabel = region.ocean && region.ocean !== region.name ? `${region.name}, ${region.ocean}` : region.name;
    }
    const city = nearestCity(lat, lon);
    return {
      lat, lon, title, regionLabel, continent: region.continent,
      city: city && city.distanceKm < 2500 ? city : null,
      sunElevation, dayState,
      localTime: localSolarTime(date, lon),
      utcOffset: formatUtcOffset(nominalUtcOffset(lon)),
    };
  }

  updateHover() {
    const p = this.pointer;
    if (!p.inside || this.director.busy) {
      this.hover = null;
      this.continents.setHover(this.selectedContinent);
      return;
    }
    const cut = this.interior.pickLayer(this.rayFromScreen(p.x, p.y));
    if (cut) {
      this.hover = { title: cut.layer.name, label: `Глубина ≈ ${Math.round(cut.depthKm).toLocaleString('ru-RU')} км · ${cut.layer.range}` };
      this.continents.setHover(null);
      return;
    }
    const hit = this.pickEarth(p.x, p.y);
    if (!hit) {
      this.hover = null;
      this.continents.setHover(this.selectedContinent);
      return;
    }
    const region = regionAt(hit.lat, hit.lon);
    const name = region.kind === 'land'
      ? (region.island ? `${region.island} · ${CONTINENT_NAMES[region.continent]}` : CONTINENT_NAMES[region.continent])
      : region.name;
    const time = localSolarTime(new Date(this.sim.time), hit.lon);
    this.hover = {
      title: formatCoords(hit.lat, hit.lon),
      label: `${name} · ${time} местн. · ${formatUtcOffset(nominalUtcOffset(hit.lon))}`,
    };
    this.continents.setHover(region.kind === 'land' ? region.continent : this.selectedContinent);
  }

  /* ---------------- Контент: разрез, материки, магнитосфера ---------------- */

  toggleCut() {
    if (this.director.mode === 'moon') this.director.reset();
    const on = this.interior.toggle();
    this.ui.setButtonActive('#ctrl-cut', on);
    if (on) {
      this.director.fly(() => ({
        position: this.interior.viewDirection().multiplyScalar(this.director.fitDistance() * 0.95),
        target: new THREE.Vector3(),
        up: Y_AXIS.clone(),
        fov: 40,
      }), { duration: 2.4, arc: 0.1 });
      if (this.ui.currentSection !== 'interior') this.ui.openSection('interior');
      this.progress.unlock('geologist');
      this.audio?.whoosh();
    }
    return on;
  }

  showContinent(id) {
    const c = CONTINENTS[id];
    if (!c) return;
    const [lat, lon] = c.center;
    this.selectedContinent = id;
    this.continents.setHover(id);
    this.director.flyToLatLon(this.earth, lat, lon, id === 'eurasia' ? 3.1 : 2.7);
    const w = window.innerWidth, h = window.innerHeight;
    this.ui.showContinentCard(c, w / 2 + Math.min(260, w * 0.18), h / 2);
    this.visitedContinents.add(id);
    if (this.visitedContinents.size >= 6) this.progress.unlock('cartographer');
    this.audio?.whoosh();
    clearTimeout(this.selectTimer);
    this.selectTimer = setTimeout(() => { this.selectedContinent = null; }, 9000);
  }

  /** Текст для «живых» блоков разделов. */
  liveInfo(key) {
    if (key === 'moon' && this.sky?.moonInfo) {
      const m = this.sky.moonInfo;
      return `${moonPhaseSVG(m.illumination, m.waxing)}<div><b>${m.name}</b>освещено ${Math.round(m.illumination * 100)}% · возраст ${m.ageDays.toFixed(1).replace('.', ',')} сут<br>расстояние ${Math.round(m.distanceKm).toLocaleString('ru-RU')} км</div>`;
    }
    return '';
  }

  /* ---------------- Время ---------------- */

  setSpeed(speed) {
    this.sim.speed = speed;
    this.sim.paused = false;
    this.audio?.click();
    if (speed >= 10000) this.progress.unlock('time_lord');
  }

  /** Вызывается интерфейсом при открытии раздела энциклопедии. */
  onSectionOpen(id, count, total) {
    this.progress?.markVisited(id, count, total);
  }

  togglePause() {
    this.sim.paused = !this.sim.paused;
    this.audio?.click();
  }

  realTime() {
    this.sim.time = Date.now();
    this.sim.speed = 1;
    this.sim.paused = false;
    this.ui.toast({ title: 'Реальное время', text: 'Освещённость Земли соответствует текущему моменту.', iconName: 'realtime', kind: 'info', duration: 2600 });
  }

  todayStartUTC() {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  setSimFromSliders(dayOffset, minuteOfDay) {
    this.sim.time = this.todayStartUTC() + dayOffset * DAY_MS + minuteOfDay * 60000;
  }

  timeState() {
    const d = new Date(this.sim.time);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return {
      speed: this.sim.speed,
      paused: this.sim.paused,
      date: d,
      dayOffset: Math.round((dayStart - this.todayStartUTC()) / DAY_MS),
      minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
    };
  }

  /* ---------------- Слои, качество, режимы ---------------- */

  setLayer(name, on) {
    if (['clouds', 'atmosphere', 'lights'].includes(name)) this.earth.setLayer(name, on);
    else if (['grid', 'tropics', 'timezones', 'climate'].includes(name)) this.earth.setOverlay(name, on);
    else if (['stars', 'milkyway', 'moonOrbit'].includes(name)) this.sky.setLayer(name, on);
    else if (name === 'iss') {
      this.sky.setLayer('iss', on);
      this.sky.setLayer('issOrbit', on);
    } else if (name === 'borders') this.continents.setBorders(on);
    else if (name === 'magnetic') {
      this.magneto.setField(on);
      if (on) this.progress.unlock('aurora_hunter');
    }
    else if (name === 'aurora') this.magneto.setAurora(on);
    this.ui.setLayerChecked(name, on);
  }

  setAutoRotate(on) {
    this.director.setAutoRotate(on);
  }

  setQualityMode(mode) {
    this.qualityMode = mode;
    this.applyQuality(mode === 'auto' ? this.quality : mode);
    this.ui.setQualityButtons(mode, this.quality);
  }

  applyQuality(level) {
    this.quality = level;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[level]));
    this.earth?.setQuality(level);
    this.sky?.setQuality(level);
    this.sky?.setPixelRatio(this.renderer.getPixelRatio());
    this.markers?.setPixelRatio(this.renderer.getPixelRatio());
    this.post.setQuality(level);
    this.onResize();
    this.ui?.setQualityButtons(this.qualityMode, level);
  }

  onCameraMode(mode) {
    this.ui.setButtonActive('#ctrl-moon, .toolbar [data-action="moon"]', mode === 'moon');
    if (mode === 'moon') {
      this.sky.moonOrbit.visible = false;
    } else if (mode === 'orbit') {
      this.sky.moonOrbit.visible = document.querySelector('input[data-layer="moonOrbit"]')?.checked ?? true;
    }
  }

  toggleSound() {
    const on = this.audio.toggleEnabled();
    this.ui.setSoundState(on);
    if (!on && !this.audio.supported) {
      this.ui.toast({ title: 'Звук недоступен', text: 'Браузер не поддерживает Web Audio API.', iconName: 'sound-off', kind: 'info' });
    }
  }

  screenshot() {
    this.post.render(0);
    const canvas = this.renderer.domElement;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date(this.sim.time).toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = url;
      a.download = `planet-earth-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }, 'image/png');
    this.ui.toast({ title: 'Снимок сохранён', text: 'PNG-файл с текущим видом планеты.', iconName: 'shot', kind: 'info', duration: 2600 });
    this.progress.unlock('photographer');
  }

  /** Единая точка обработки действий интерфейса. */
  handleAction(action, payload) {
    switch (action) {
      case 'reset':
        this.ui.hideCard();
        this.director.reset();
        break;
      case 'pause':
        this.togglePause();
        break;
      case 'realtime':
        this.realTime();
        break;
      case 'speed':
        this.setSpeed(Number(payload) || 1);
        break;
      case 'moonView':
        this.ui.hideCard();
        if (this.director.mode === 'moon') this.director.reset();
        else {
          this.director.flyToMoon();
          this.progress.unlock('lunatic');
          this.audio?.whoosh();
        }
        break;
      case 'screenshot':
        this.screenshot();
        break;
      case 'flyTo':
        this.director.flyToLatLon(this.earth, payload.lat, payload.lon, payload.dist ?? 2.2);
        break;
      case 'layer':
        this.setLayer(payload.name, payload.on ?? true);
        break;
      case 'escape':
        if (this.findGame.active) this.findGame.close();
        else if (this.director.mode === 'moon') this.director.reset();
        break;
      case 'quiz':
        this.findGame.close();
        this.ui.closeSheets();
        this.ui.hideCard();
        this.quiz.start();
        break;
      case 'find':
        this.quiz.close();
        this.ui.closeSheets();
        this.findGame.start();
        break;
      case 'cut':
        this.toggleCut();
        break;
      case 'continent':
        this.showContinent(payload.id);
        break;
      case 'mariana':
        this.director.flyToLatLon(this.earth, 11.35, 142.2, 1.7);
        this.markers.addPin(11.35, 142.2, { color: '#ff6b6b', ttl: 25, size: 18 });
        this.ui.toast({ title: 'Бездна Челленджера', text: 'Глубина ≈ 10 935 м, давление более 1 070 атм.', iconName: 'water', kind: 'info' });
        this.progress.unlock('deep_diver');
        this.audio?.whoosh();
        break;
      case 'aurora': {
        this.setLayer('aurora', true);
        this.magneto.storm(16);
        this.progress.unlock('aurora_hunter');
        const sp = sunPosition(new Date(this.sim.time));
        this.director.flyToLatLon(this.earth, 62, sp.subLon + 180, 2.2);
        this.ui.toast({ title: 'Магнитная буря', text: 'Сияния ярче всего на ночной стороне в авроральных овалах.', iconName: 'star', kind: 'info' });
        break;
      }
      case 'moonOrbit':
        this.setLayer('moonOrbit', true);
        this.director.fly(() => ({ position: new THREE.Vector3(0.0, 1.0, 0.42).normalize().multiplyScalar(170), target: new THREE.Vector3(), up: new THREE.Vector3(0, 0, -1), fov: 40 }), { duration: 3.2, arc: 0.05 });
        break;
      default:
        break;
    }
  }

  /* ---------------- Кадр ---------------- */

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  updateSun(date) {
    const s = sunDirectionScene(date);
    this.sunDir.set(s.x, s.y, s.z);
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
    this.frameIndex++;

    this.updateSun(date);
    this.earth.update(date, dtSim, dt, this.sunDir);
    this.director.update(dt);
    this.sky.update(date, time, this.camera, this.sunDir);
    this.updateClipPlanes();
    if (this.frameIndex % 2 === 0) this.updateHover();
    this.interior.update(dt, time, this.camera);
    this.magneto.update(time, dt, this.sunDir);
    this.continents.update(dt, time);
    this.markers.update(dt, time);

    this.sky.computeSunFlare(this.camera, this.flare);
    this.post.update(time, this.flare);
    this.post.render(dt);

    this.frames++;
    if (time - this.fpsTime >= 1) {
      this.fps = Math.round(this.frames / (time - this.fpsTime));
      this.frames = 0;
      this.fpsTime = time;
    }
    if (time - this.hudTime > 0.12) {
      this.hudTime = time;
      const sp = sunPosition(date);
      const camDist = this.camera.position.length();
      this.ui.updateHud({
        date,
        speed: this.sim.speed,
        paused: this.sim.paused,
        subsolar: { lat: sp.subLat, lon: sp.subLon },
        hover: this.hover,
        mode: this.director.mode,
        altitudeKm: (camDist - 1) * EARTH_RADIUS_KM,
        earthDistanceKm: camDist * EARTH_RADIUS_KM,
        fps: this.fps,
        qualityLabel: `${QUALITY_LABEL[this.quality]}${this.qualityMode === 'auto' ? ' · авто' : ''}`,
        moon: this.sky.moonInfo,
      });
      this.ui.updateTimeControls(this.timeState());
    }
  }
}

const app = new App();
app.init().catch((err) => {
  console.error(err);
  const text = document.getElementById('loader-text');
  if (text) text.textContent = `Ошибка запуска: ${err.message}`;
  document.body.classList.add('boot-failed');
});
