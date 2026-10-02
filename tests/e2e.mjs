#!/usr/bin/env node
/**
 * tests/e2e.mjs — сквозная проверка в headless Chromium (Playwright, WebGL через SwiftShader).
 *
 *   node tests/e2e.mjs                 # проверки + скриншоты с процедурными текстурами
 *   node tests/e2e.mjs --nasa          # скриншоты с изображениями NASA из npm-пакета three-globe
 *   node tests/e2e.mjs --no-screenshots
 *   node tests/e2e.mjs --nasa --screenshots-only   # только скриншоты
 *
 * Зависимости (three@0.160.0, playwright@1.56.1, при --nasa — three-globe) ставятся
 * только во временную папку .test-deps (она в .gitignore). Import map в index.html
 * подменяется на локальный three.js только на время теста (см. tests/serve.mjs).
 * CDN с текстурами и Google Fonts в тесте заблокированы — так проверяются запасные текстуры.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPS = path.join(ROOT, '.test-deps');
const OUT = path.join(ROOT, 'tests', 'output');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const args = new Set(process.argv.slice(2));
const NASA = args.has('--nasa');
const SCREENSHOTS = !args.has('--no-screenshots');
const CHECKS = !args.has('--screenshots-only');
const PORT = Number(process.env.E2E_PORT || 8811);
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const BLOCKED = /cdn\.jsdelivr\.net\/gh\/|fonts\.googleapis\.com|fonts\.gstatic\.com/;

/* ---------- Временные зависимости ---------- */
function ensureDeps() {
  const specs = ['three@0.160.0', 'playwright@1.56.1'];
  if (NASA) specs.push('three-globe@2.45.3');
  const missing = specs.filter((s) => !fs.existsSync(path.join(DEPS, 'node_modules', s.slice(0, s.lastIndexOf('@')), 'package.json')));
  if (!missing.length) return;
  fs.mkdirSync(DEPS, { recursive: true });
  if (!fs.existsSync(path.join(DEPS, 'package.json'))) {
    fs.writeFileSync(path.join(DEPS, 'package.json'), JSON.stringify({ name: 'earth-test-deps', private: true }, null, 2));
  }
  console.log(`Установка временных зависимостей: ${missing.join(', ')}`);
  execSync(`npm install --no-audit --no-fund ${missing.join(' ')}`, { cwd: DEPS, stdio: 'inherit' });
}

ensureDeps();
const { chromium } = await import(pathToFileURL(path.join(DEPS, 'node_modules', 'playwright', 'index.mjs')).href);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

/* ---------- Мини-фреймворк проверок ---------- */
const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '', ms: Date.now() - t0 });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message, ms: Date.now() - t0 });
    console.log(`  ✘ ${name} — ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/* ---------- Браузер ---------- */
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const server = await startServer({ port: PORT, rewriteImportMap: true });

const NASA_IMG = path.join(DEPS, 'node_modules', 'three-globe', 'example');
const NORMAL_FROM_TOPOLOGY = path.join(DEPS, 'normal-from-topology.png');
const SUBSTITUTES = {
  'earth_atmos_2048.jpg': path.join(NASA_IMG, 'img', 'earth-blue-marble.jpg'),
  'earth_lights_2048.png': path.join(NASA_IMG, 'img', 'earth-night.jpg'),
  'earth_specular_2048.jpg': path.join(NASA_IMG, 'img', 'earth-water.png'),
  'earth_clouds_1024.png': path.join(NASA_IMG, 'clouds', 'clouds.png'),
  'earth_normal_2048.jpg': NORMAL_FROM_TOPOLOGY,
};

async function newPage({ width, height, nasa = false, mobile = false, dsf = 1 }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    isMobile: mobile,
    hasTouch: mobile,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const log = { errors: [], warnings: [], network: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const url = m.location()?.url || '';
    const entry = `${m.text()}${url ? ` (${url})` : ''}`;
    if (BLOCKED.test(url) || (/Failed to load resource/.test(m.text()) && /ERR_INTERNET_DISCONNECTED|ERR_CERT/.test(m.text()))) log.network.push(entry);
    else if (m.type() === 'error') log.errors.push(entry);
    else log.warnings.push(entry);
  });
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  await page.route(BLOCKED, (route) => {
    const name = route.request().url().split('/').pop();
    if (nasa && SUBSTITUTES[name] && fs.existsSync(SUBSTITUTES[name])) {
      return route.fulfill({ path: SUBSTITUTES[name], headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return route.abort('internetdisconnected');
  });
  return { context, page, log };
}

const frames = (page, n = 2) => page.evaluate((count) => new Promise((resolve) => {
  let k = 0;
  const step = () => (++k >= count ? resolve() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);

async function boot(page) {
  await page.goto(BASE);
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 180000 });
  await page.evaluate(() => {
    const a = window.__earthApp;
    a.setQualityMode('low');
    a.setAutoRotate(false);
    document.getElementById('opt-autorotate').checked = false;
  });
}

/** Нормаль-карта из карты высот three-globe (только для режима --nasa). */
async function buildNormalMap() {
  if (fs.existsSync(NORMAL_FROM_TOPOLOGY)) return;
  const { context, page } = await newPage({ width: 400, height: 300 });
  await page.goto(`http://127.0.0.1:${PORT}/css/style.css`);
  const dataUrl = await page.evaluate(async () => {
    const img = new Image();
    img.src = '/.test-deps/node_modules/three-globe/example/img/earth-topology.png';
    await img.decode();
    const W = img.width, H = img.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const src = g.getImageData(0, 0, W, H).data;
    const h = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
    const out = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (h(x + 1, y) - h(x - 1, y)) * 4, dy = (h(x, Math.max(0, y - 1)) - h(x, Math.min(H - 1, y + 1))) * 4;
        const len = Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
        out.data[i] = (-dx / len * 0.5 + 0.5) * 255;
        out.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
        out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
        out.data[i + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(NORMAL_FROM_TOPOLOGY, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await context.close();
}

/* ====================================================================== */
/*  1. Функциональные проверки (десктоп 1280×720, CDN заблокирован)        */
/* ====================================================================== */
if (CHECKS) {
console.log('\nДесктоп 1280×720, CDN текстур и шрифтов заблокирован:');
const desk = await newPage({ width: 1280, height: 720 });
const { page } = desk;

await check('Страница загружается, модули стартуют', async () => {
  const t0 = Date.now();
  await boot(page);
  const booted = await page.evaluate(() => window.__earthBooted === true && !!window.__earthApp);
  assert(booted, 'приложение не инициализировалось');
  return `готово за ${((Date.now() - t0) / 1000).toFixed(1)} с`;
});

await check('WebGL-контекст создан', async () => {
  const info = await page.evaluate(() => {
    const gl = window.__earthApp.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      lost: gl.isContextLost(),
    };
  });
  assert(!info.lost, 'контекст потерян');
  return `${info.webgl2 ? 'WebGL2' : 'WebGL1'}, ${info.renderer}`;
});

await check('Запасные текстуры срабатывают при недоступном CDN', async () => {
  const r = await page.evaluate(() => ({
    fallback: window.__earthApp.fallback,
    items: [...document.querySelectorAll('#loader-items li')].map((li) => li.className),
    procedural: Object.values(window.__earthApp.textures).filter((t) => t.userData?.procedural).length,
  }));
  const keys = Object.keys(r.fallback);
  assert(keys.length === 6 && keys.every((k) => r.fallback[k]), `не все текстуры заменены: ${JSON.stringify(r.fallback)}`);
  assert(r.items.length === 6 && r.items.every((c) => c === 'fallback'), 'экран загрузки не показал статусы');
  assert(r.procedural === 6, 'текстуры не процедурные');
  return '6/6 процедурных текстур (день, ночь, облака, рельеф, океаны, Луна)';
});

await check('Солнце и день/ночь соответствуют текущему моменту', async () => {
  const r = await page.evaluate(async () => {
    const a = window.__earthApp;
    const astro = await import('/js/astro.js');
    const drift = Math.abs(a.sim.time - Date.now());
    // Подсолнечная точка по 3D-сцене (направление на Солнце + наклон оси + вращение по GMST)…
    const ll = a.earth.worldToLatLon(a.sunDir.clone());
    // …и по астрономическим формулам (склонение и прямое восхождение Солнца).
    const sp = astro.sunPosition(new Date(a.sim.time));
    return { drift, lat: ll.lat, lon: ll.lon, subLat: sp.subLat, subLon: sp.subLon, hud: document.getElementById('hud-sun').textContent };
  });
  const dLon = Math.abs(((r.lon - r.subLon + 540) % 360) - 180);
  assert(r.drift < 120000, `время симуляции отстаёт на ${r.drift} мс`);
  assert(Math.abs(r.lat - r.subLat) < 0.05 && dLon < 0.05, `сцена (${r.lat}, ${r.lon}) ≠ формулы (${r.subLat}, ${r.subLon})`);
  return `подсолнечная точка ${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}° — совпадает с расчётом · HUD: ${r.hud}`;
});

await check('Вкладки энциклопедии переключаются (9 разделов)', async () => {
  const ids = await page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.dataset.section));
  assert(ids.length === 9, `вкладок: ${ids.length}`);
  for (const id of ids) {
    await page.click(`.tab[data-section="${id}"]`);
    const ok = await page.evaluate((sid) => document.querySelector(`.tab[data-section="${sid}"]`).classList.contains('active')
      && document.querySelector('#section-content .section-title')?.textContent.length > 3, id);
    assert(ok, `раздел ${id} не открылся`);
  }
  const count = await page.textContent('#explore-count');
  assert(count === '9/9', `прогресс изучения: ${count}`);
  return `разделы: ${ids.join(', ')}; прогресс ${count}`;
});

await check('Клик по глобусу возвращает корректные координаты (Москва)', async () => {
  const target = { lat: 55.7558, lon: 37.6173 };
  await page.evaluate(({ lat, lon }) => {
    const a = window.__earthApp;
    a.sim.paused = true;
    const p = a.earth.latLonToWorld(lat, lon, 3);
    a.camera.position.copy(p);
    a.controls.target.set(0, 0, 0);
    a.camera.lookAt(0, 0, 0);
    a.controls.update();
  }, target);
  await frames(page, 2);
  const vp = page.viewportSize();
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const a = window.__earthApp;
    const hit = a.pickEarth(window.innerWidth / 2, window.innerHeight / 2);
    return { hit, card: document.getElementById('info-card').innerText, hidden: document.getElementById('info-card').classList.contains('hidden') };
  });
  const dLat = Math.abs(r.hit.lat - target.lat), dLon = Math.abs(r.hit.lon - target.lon);
  assert(dLat < 0.1 && dLon < 0.1, `ошибка координат: Δφ=${dLat.toFixed(3)}°, Δλ=${dLon.toFixed(3)}°`);
  assert(!r.hidden && /Евразия/.test(r.card) && /Москва/.test(r.card) && /с\.ш\./.test(r.card), `карточка: ${r.card}`);
  return `φ=${r.hit.lat.toFixed(4)}°, λ=${r.hit.lon.toFixed(4)}° (Δ < 0,1°); карточка: «${r.card.split('\n').slice(0, 2).join(' · ')}»`;
});

await check('Обратная проекция точки клика совпадает с курсором', async () => {
  const r = await page.evaluate(() => {
    const a = window.__earthApp;
    const pts = [[0.42, 0.45], [0.55, 0.6], [0.5, 0.35]].map(([fx, fy]) => {
      const x = fx * window.innerWidth, y = fy * window.innerHeight;
      const hit = a.pickEarth(x, y);
      if (!hit) return null;
      const s = a.earth.latLonToWorld(hit.lat, hit.lon, 1).project(a.camera);
      return Math.hypot((s.x * 0.5 + 0.5) * window.innerWidth - x, (-s.y * 0.5 + 0.5) * window.innerHeight - y);
    });
    return pts;
  });
  assert(r.every((d) => d != null && d < 0.5), `расхождение: ${JSON.stringify(r)}`);
  return `максимальное расхождение ${Math.max(...r).toFixed(4)} px`;
});

await check('Регион определяется для океана (Тихий океан)', async () => {
  const r = await page.evaluate(() => window.__earthApp.describePoint(0, -150));
  assert(r.title === 'Тихий океан', `получено: ${r.title}`);
  return `${r.title}, ${r.dayState}, местное время ${r.localTime}, ${r.utcOffset}`;
});

await check('HUD показывает координаты под курсором и высоту камеры', async () => {
  const vp = page.viewportSize();
  await page.mouse.move(vp.width / 2 + 10, vp.height / 2 + 5);
  await page.waitForFunction(() => /с\.ш\.|ю\.ш\./.test(document.getElementById('hud-coords').textContent), null, { timeout: 30000 });
  const r = await page.evaluate(() => ({ coords: document.getElementById('hud-coords').textContent, alt: document.getElementById('hud-alt').textContent }));
  assert(/км/.test(r.alt), `высота: ${r.alt}`);
  return `${r.coords} · ${r.alt}`;
});

await check('Управление временем: скорости, пауза, реальное время, ползунки', async () => {
  await page.click('#speed-buttons [data-speed="10000"]');
  let s = await page.evaluate(() => window.__earthApp.sim);
  assert(s.speed === 10000 && !s.paused, 'скорость 10 000× не включилась');
  await page.click('#ctrl-pause');
  s = await page.evaluate(() => window.__earthApp.sim);
  assert(s.paused, 'пауза не сработала');
  await page.click('#ctrl-realtime');
  s = await page.evaluate(() => ({ ...window.__earthApp.sim, now: Date.now() }));
  assert(s.speed === 1 && !s.paused && Math.abs(s.time - s.now) < 5000, 'реальное время не восстановилось');
  await page.evaluate(() => {
    const el = document.getElementById('date-slider');
    el.value = '-100';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  s = await page.evaluate(() => ({ ...window.__earthApp.sim, now: Date.now() }));
  const days = Math.round((s.now - s.time) / 86400000);
  assert(days >= 99 && days <= 101, `сдвиг даты: ${days} сут`);
  await page.click('#ctrl-realtime');
  return 'скорости 1×…10 000×, пауза, «Реальное время», ползунок даты (−100 сут)';
});

await check('Все слои и оверлеи переключаются без ошибок', async () => {
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-layer]')].map((i) => i.dataset.layer));
  for (const id of ids) {
    await page.evaluate((lid) => {
      const input = document.querySelector(`[data-layer="${lid}"]`);
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, id);
  }
  await page.evaluate(() => ['grid', 'tropics', 'timezones', 'borders', 'climate', 'magnetic'].forEach((l) => window.__earthApp.setLayer(l, true)));
  await frames(page, 2);
  await page.evaluate(() => ['grid', 'tropics', 'timezones', 'borders', 'climate', 'magnetic'].forEach((l) => window.__earthApp.setLayer(l, false)));
  return `${ids.length} переключателей: ${ids.join(', ')}`;
});

await check('Разрез, вид с Луны, сброс вида', async () => {
  await page.click('#ctrl-cut');
  await page.waitForFunction(() => window.__earthApp.interior.progress >= 1, null, { timeout: 120000 });
  const cut = await page.evaluate(() => window.__earthApp.interior.active);
  assert(cut, 'разрез не включился');
  await page.click('#ctrl-cut');
  await page.click('#ctrl-moon');
  await page.waitForFunction(() => window.__earthApp.director.mode === 'moon', null, { timeout: 180000 });
  const d = await page.evaluate(() => window.__earthApp.camera.position.distanceTo(window.__earthApp.sky.moonPos));
  assert(d < 0.5, `камера далеко от Луны: ${d}`);
  await page.click('#ctrl-reset');
  await page.waitForFunction(() => window.__earthApp.director.mode === 'orbit', null, { timeout: 180000 });
  return `разрез открыт и закрыт; камера у Луны (${d.toFixed(3)} R⊕ от центра Луны) и вернулась`;
});

await check('Скриншот сохраняется в PNG', async () => {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#ctrl-screenshot')]);
  const file = path.join(OUT, download.suggestedFilename());
  await download.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 8).toString('hex');
  assert(head === '89504e470d0a1a0a', 'файл не PNG');
  return `${download.suggestedFilename()} (${Math.round(fs.statSync(file).size / 1024)} КБ)`;
});

await check('Викторина проходится от начала до конца (таймер, 15 вопросов, ранг)', async () => {
  await page.click('#ctrl-quiz');
  await page.waitForSelector('#quiz:not(.hidden) .answer');
  // Первый вопрос: ждём истечения таймера (20 с), проверяем «Время вышло».
  await page.waitForFunction(() => /Время вышло/.test(document.getElementById('quiz-explain')?.textContent || ''), null, { timeout: 60000 });
  let answered = 1;
  await page.click('[data-quiz="next"]');
  for (let i = 1; i < 15; i++) {
    await page.waitForSelector('.answer:not([disabled])');
    const n = await page.$$eval('.answer', (b) => b.length);
    assert(n === 4, `вариантов ответа: ${n}`);
    await page.click(`.answer[data-i="${i % 4}"]`);
    await page.waitForSelector('#quiz-explain .quiz-explain');
    answered++;
    await page.click('[data-quiz="next"]');
  }
  await page.waitForSelector('.rank');
  const r = await page.evaluate(() => ({
    rank: document.querySelector('.rank').textContent,
    score: document.querySelector('.score-big').textContent,
    correct: window.__earthApp.quiz.correct,
  }));
  assert(['Новичок', 'Исследователь', 'Астронавт'].includes(r.rank), `ранг: ${r.rank}`);
  await page.click('[data-quiz="close"]');
  return `${answered} ответов, верных ${r.correct}/15, ${r.score} очков, ранг «${r.rank}»`;
});

await check('«Найди на глобусе»: клик, ошибка в км по гаверсинусам, дуга', async () => {
  await page.evaluate(() => window.__earthApp.handleAction('find'));
  await page.waitForSelector('#findgame:not(.hidden) .fg-target');
  await page.waitForFunction(() => window.__earthApp.director.mode === 'orbit', null, { timeout: 180000 });
  const vp = page.viewportSize();
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForSelector('#findgame .fg-result');
  const r = await page.evaluate(async () => {
    const g = window.__earthApp.findGame;
    const { haversineKm } = await import('/js/geo.js');
    const last = g.results[g.results.length - 1];
    const hit = window.__earthApp.markers.items.filter((i) => i.type === 'arc').length;
    return { last, text: document.querySelector('#findgame .fg-result').textContent, arcs: hit, check: haversineKm(0, 0, 0, 90) };
  });
  assert(r.last && r.last.km > 0 && /км/.test(r.text), `результат: ${r.text}`);
  assert(r.arcs === 1, 'дуга не нарисована');
  assert(Math.abs(r.check - 10007.5) < 1, `формула гаверсинусов: четверть экватора = ${r.check}`);
  await page.click('[data-fg="next"]');
  await page.click('[data-fg="close"]');
  return `${r.last.name}: ${r.text.trim()}`;
});

await check('Достижения открываются и сохраняются', async () => {
  const r = await page.evaluate(() => ({
    unlocked: [...window.__earthApp.progress.unlocked],
    stored: JSON.parse(localStorage.getItem('planet-earth-3d:v1') || '{}').achievements || [],
  }));
  assert(r.unlocked.length >= 5, `открыто: ${r.unlocked.join(', ')}`);
  assert(r.stored.length === r.unlocked.length, 'не сохранено в localStorage');
  return `${r.unlocked.length}: ${r.unlocked.join(', ')}`;
});

await check('Звук включается и выключается (Web Audio)', async () => {
  await page.click('#btn-sound');
  let r = await page.evaluate(() => ({ on: window.__earthApp.audio.enabled, state: window.__earthApp.audio.ctx?.state }));
  assert(r.on, 'звук не включился');
  await page.click('#btn-sound');
  r = await page.evaluate(() => ({ on: window.__earthApp.audio.enabled }));
  assert(!r.on, 'звук не выключился');
  return 'AudioContext создан по клику, эмбиент включён и выключен';
});

await check('Изменение размера окна обрабатывается', async () => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.waitForTimeout(400);
  await frames(page, 2);
  const r = await page.evaluate(() => {
    const a = window.__earthApp;
    const c = a.renderer.domElement;
    return { w: c.clientWidth, h: c.clientHeight, aspect: a.camera.aspect };
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  assert(r.w === 1024 && r.h === 640 && Math.abs(r.aspect - 1.6) < 1e-6, JSON.stringify(r));
  return `canvas ${r.w}×${r.h}, aspect ${r.aspect}`;
});

await check('Консоль без ошибок', async () => {
  const { errors, warnings, network } = desk.log;
  fs.writeFileSync(path.join(OUT, 'console-desktop.json'), JSON.stringify(desk.log, null, 2));
  assert(errors.length === 0, `ошибки: ${errors.join(' | ')}`);
  return `ошибок 0, предупреждений ${warnings.length}, ожидаемых сетевых отказов (CDN/шрифты заблокированы) ${network.length}`;
});

if (SCREENSHOTS) {
  await page.evaluate(() => {
    const a = window.__earthApp;
    a.sim.paused = false;
    a.setQualityMode('high');
    a.director.snapToDefault();
    a.ui.openSection('atmosphere');
    document.getElementById('hud-perf').style.visibility = 'hidden';
  });
  await frames(page, 4);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-fallback.png') });
}
await desk.context.close();

/* ====================================================================== */
/*  2. Мобильная версия 390×844                                            */
/* ====================================================================== */
console.log('\nТелефон 390×844 (touch):');
const mob = await newPage({ width: 390, height: 844, mobile: true });
await check('Мобильная версия: глобус по центру, панели выдвигаются снизу', async () => {
  await boot(mob.page);
  const r = await mob.page.evaluate(() => {
    const a = window.__earthApp;
    const s = a.camera.position.clone().multiplyScalar(0).project(a.camera);
    const nav = getComputedStyle(document.querySelector('.mobile-nav')).display;
    return { cx: (s.x * 0.5 + 0.5) * innerWidth, cy: (-s.y * 0.5 + 0.5) * innerHeight, nav };
  });
  assert(Math.abs(r.cx - 195) < 2 && Math.abs(r.cy - 422) < 2, `центр планеты на экране: ${r.cx}, ${r.cy}`);
  assert(r.nav !== 'none', 'нет мобильной навигации');
  await mob.page.tap('[data-open-sheet="panel-left"]');
  await mob.page.waitForTimeout(800);
  const open = await mob.page.evaluate(() => document.getElementById('panel-left').classList.contains('open'));
  assert(open, 'панель не открылась');
  await mob.page.tap('#panel-left [data-close-sheet]');
  await mob.page.waitForTimeout(400);
  const closed = await mob.page.evaluate(() => !document.getElementById('panel-left').classList.contains('open'));
  assert(closed, 'панель не закрылась');
  await mob.page.tap('body', { position: { x: 195, y: 380 } });
  await mob.page.waitForTimeout(500);
  const card = await mob.page.evaluate(() => !document.getElementById('info-card').classList.contains('hidden'));
  assert(card, 'тап по глобусу не показал карточку');
  assert(mob.log.errors.length === 0, `ошибки: ${mob.log.errors.join(' | ')}`);
  return `центр глобуса (${r.cx.toFixed(0)}, ${r.cy.toFixed(0)}); шторка открывается/закрывается; тап по глобусу → карточка`;
});
if (SCREENSHOTS && !NASA) {
  await mob.page.evaluate(() => {
    window.__earthApp.ui.hideCard();
    window.__earthApp.setQualityMode('high');
    document.getElementById('hud-perf').style.visibility = 'hidden';
  });
  await frames(mob.page, 4);
  await mob.page.screenshot({ path: path.join(SHOTS, 'mobile-fallback.png') });
}
await mob.context.close();
} // CHECKS

/* ====================================================================== */
/*  3. Скриншоты для README и PR                                           */
/* ====================================================================== */
async function prepareShot(page) {
  await boot(page);
  await page.evaluate(() => {
    const a = window.__earthApp;
    a.setQualityMode('high');
    document.getElementById('hud-perf').style.visibility = 'hidden';
    document.querySelectorAll('.toast').forEach((t) => t.remove());
  });
}

async function shot(page, file, setup, frameCount = 5) {
  if (setup) await page.evaluate(setup);
  await frames(page, frameCount);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await frames(page, 1);
  await page.screenshot({ path: path.join(SHOTS, file) });
  console.log(`  📷 docs/screenshots/${file}`);
}

if (SCREENSHOTS) {
  console.log(`\nСкриншоты (${NASA ? 'изображения NASA из npm-пакета three-globe' : 'процедурные текстуры'}):`);
  if (NASA) await buildNormalMap();

  const d = await newPage({ width: 1920, height: 1080, nasa: NASA });
  await prepareShot(d.page);
  await shot(d.page, 'desktop.png', () => {
    const a = window.__earthApp;
    a.director.snapToDefault();
    a.ui.openSection('atmosphere');
  }, 6);
  await d.context.close();

  const m = await newPage({ width: 390, height: 844, nasa: NASA, mobile: true, dsf: 2 });
  await prepareShot(m.page);
  await shot(m.page, 'mobile.png', () => window.__earthApp.director.snapToDefault(), 4);
  await m.context.close();

  const g = await newPage({ width: 1600, height: 900, nasa: NASA });
  await prepareShot(g.page);
  await shot(g.page, 'cutaway.png', () => {
    const a = window.__earthApp;
    a.interior.setActive(true);
    a.interior.progress = 1;
    a.ui.openSection('interior');
    a.camera.position.copy(a.interior.viewDirection().multiplyScalar(3.3));
    a.controls.target.set(0, 0, 0);
    a.controls.update();
  }, 6);
  await shot(g.page, 'magnetosphere.png', () => {
    const a = window.__earthApp;
    a.interior.setActive(false);
    a.interior.progress = 0;
    a.ui.openSection('magnetic');
    a.setLayer('magnetic', true);
    a.magneto.fieldLevel = 1;
    const side = a.sunDir.clone().cross(new a.camera.up.constructor(0, 1, 0)).normalize();
    a.camera.position.copy(side.multiplyScalar(9).add(a.sunDir.clone().multiplyScalar(-1.5)).setY(2.2));
    a.controls.target.set(0, 0, 0);
    a.controls.update();
  }, 6);
  await shot(g.page, 'night-aurora.png', () => {
    const a = window.__earthApp;
    a.setLayer('magnetic', false);
    a.magneto.fieldLevel = 0;
    a.magneto.storm(60);
    a.ui.openSection('numbers');
    const dir = a.sunDir.clone().negate().applyAxisAngle(new a.camera.up.constructor(0, 1, 0), 0.5);
    dir.y += 0.9;
    a.camera.position.copy(dir.normalize().multiplyScalar(2.6));
    a.controls.target.set(0, 0, 0);
    a.controls.update();
  }, 6);
  await shot(g.page, 'moon-view.png', () => {
    const a = window.__earthApp;
    a.ui.openSection('moon');
    a.director.moonFov = 14;
    a.controls.enabled = false;
    a.director.setMode('moon');
  }, 6);
  await shot(g.page, 'quiz.png', () => {
    const a = window.__earthApp;
    a.director.setMode('orbit');
    a.controls.enabled = true;
    a.director.snapToDefault();
    a.handleAction('quiz');
  }, 4);
  await shot(g.page, 'findgame.png', () => {
    const a = window.__earthApp;
    a.quiz.close();
    a.handleAction('find');
    a.director.flight = null;
    a.director.setMode('orbit');
    a.controls.enabled = true;
    const t = a.findGame.target;
    a.findGame.guess(t.lat + 6, t.lon - 9);
    a.director.flight = null;
    a.director.setMode('orbit');
    a.controls.enabled = true;
    const mid = a.earth.latLonToWorld(t.lat + 3, t.lon - 4.5, 2.4);
    a.camera.position.copy(mid);
    a.controls.target.set(0, 0, 0);
    a.controls.update();
    a.markers.items.forEach((it) => { it.born = -10; });
  }, 6);
  await g.context.close();
}

/* ====================================================================== */
/*  Отчёт                                                                  */
/* ====================================================================== */
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
const report = { date: new Date().toISOString(), nasaScreenshots: NASA, passed: results.length - failed.length, failed: failed.length, results };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const md = ['| Проверка | Результат | Детали |', '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${String(r.detail).replace(/\|/g, '/')} |`)].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md + '\n');
console.log(`\nИтог: ${report.passed} из ${results.length} проверок пройдено.`);
process.exit(failed.length ? 1 : 0);
