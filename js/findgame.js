/**
 * findgame.js — игра «Найди на глобусе»: игрок щёлкает по названному объекту,
 * ошибка считается по формуле гаверсинусов, на глобусе рисуется дуга
 * большого круга между щелчком и правильным местом.
 */
import { FIND_TARGETS } from './data.js';
import { haversineKm } from './geo.js';
import { latLonToLocal, localToLatLon } from './astro.js';
import { formatNumber, hydrateIcons, plural } from './ui.js';

const POINTS = ['очко', 'очка', 'очков'];

const ROUNDS = 10;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Очки за раунд: 1000 при точном попадании, плавно убывают с расстоянием. */
export function scoreForDistance(km) {
  return Math.max(0, Math.round(1000 * Math.exp(-km / 1200)));
}

function verdictFor(km) {
  if (km < 100) return 'Снайперская точность!';
  if (km < 500) return 'Отлично!';
  if (km < 1500) return 'Неплохо.';
  if (km < 4000) return 'Близко, но не то.';
  return 'Далековато…';
}

/** Середина дуги большого круга (для наведения камеры). */
function midpoint(lat1, lon1, lat2, lon2) {
  const a = latLonToLocal(lat1, lon1), b = latLonToLocal(lat2, lon2);
  const x = a.x + b.x, y = a.y + b.y, z = a.z + b.z;
  if (Math.hypot(x, y, z) < 1e-6) return { lat: lat1, lon: lon1 };
  return localToLatLon(x, y, z);
}

export class FindGame {
  /**
   * @param {{root:HTMLElement, app:Object}} opts — app предоставляет earth, director, markers, audio, progress
   */
  constructor({ root, app }) {
    this.root = root;
    this.app = app;
    this.active = false;
    this.awaitingNext = false;
  }

  start() {
    const pool = [...FIND_TARGETS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.targets = pool.slice(0, ROUNDS);
    this.round = 0;
    this.score = 0;
    this.results = [];
    this.active = true;
    this.app.markers.clear();
    this.app.ui.hideCard();
    this.app.director.reset();
    this.root.classList.remove('hidden');
    this.renderPrompt();
  }

  close() {
    this.active = false;
    this.awaitingNext = false;
    this.root.classList.add('hidden');
    this.app.markers.clear();
  }

  get target() {
    return this.targets[this.round];
  }

  bindButtons() {
    hydrateIcons(this.root);
    this.root.querySelectorAll('[data-fg]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.fg;
      if (act === 'close') this.close();
      else if (act === 'skip') this.skip();
      else if (act === 'next') this.next();
      else if (act === 'again') this.start();
      this.app.audio?.click();
    }));
  }

  renderPrompt() {
    this.awaitingNext = false;
    const t = this.target;
    this.root.innerHTML = `
      <div class="fg-label">Раунд ${this.round + 1}/${ROUNDS} · очки: ${formatNumber(this.score)}</div>
      <div class="fg-label" style="margin-top:6px">Найдите на глобусе</div>
      <div class="fg-target gradient-text">${esc(t.name)}</div>
      <div class="fg-hint">${esc(t.hint)}. Щёлкните по планете в этом месте.</div>
      <div class="fg-row">
        <button class="btn" type="button" data-fg="skip" data-icon-left="play">Пропустить</button>
        <button class="btn" type="button" data-fg="close" data-icon-left="close">Завершить</button>
      </div>`;
    this.bindButtons();
  }

  /** Ход игрока: щелчок по глобусу в точке (lat, lon). */
  guess(lat, lon) {
    if (!this.active || this.awaitingNext) return;
    const t = this.target;
    const km = haversineKm(lat, lon, t.lat, t.lon);
    const pts = scoreForDistance(km);
    this.score += pts;
    this.results.push({ name: t.name, km, pts });
    this.showResult(lat, lon, km, pts);
    if (km < 100) this.app.progress?.unlock('sniper');
    if (km < 1500) this.app.audio?.success();
    else this.app.audio?.error();
  }

  skip() {
    if (!this.active || this.awaitingNext) return;
    this.results.push({ name: this.target.name, km: null, pts: 0 });
    this.showResult(null, null, null, 0);
  }

  showResult(lat, lon, km, pts) {
    const t = this.target;
    const m = this.app.markers;
    m.addPin(t.lat, t.lon, { color: '#ffb347', size: 18 });
    if (lat != null) {
      m.addPin(lat, lon, { color: '#46d4ff', size: 14 });
      m.addArc(lat, lon, t.lat, t.lon, { color: '#ff8a5c', duration: 1.4 });
      const mid = midpoint(lat, lon, t.lat, t.lon);
      this.app.director.flyToLatLon(this.app.earth, mid.lat, mid.lon, 2.1 + Math.min(2.6, km / 3500), { duration: 2.0 });
    } else {
      this.app.director.flyToLatLon(this.app.earth, t.lat, t.lon, 2.4, { duration: 2.0 });
    }
    this.awaitingNext = true;
    const last = this.round + 1 >= ROUNDS;
    this.root.innerHTML = `
      <div class="fg-label">Раунд ${this.round + 1}/${ROUNDS} · очки: ${formatNumber(this.score)}</div>
      <div class="fg-target gradient-text">${esc(t.name)}</div>
      <div class="fg-result">${km == null
        ? 'Пропущено — правильное место отмечено оранжевой меткой.'
        : `${verdictFor(km)} Ошибка: <b>${formatNumber(Math.round(km))} км</b> · <b>+${formatNumber(pts)}</b> ${plural(pts, POINTS)}`}</div>
      <div class="fg-row">
        <button class="btn btn-accent" type="button" data-fg="next" data-icon-left="play">${last ? 'Итоги' : 'Следующий объект'}</button>
        <button class="btn" type="button" data-fg="close" data-icon-left="close">Завершить</button>
      </div>`;
    this.bindButtons();
  }

  next() {
    this.app.markers.clear();
    this.round += 1;
    if (this.round >= ROUNDS) this.finish();
    else {
      this.app.director.reset({ duration: 1.6 });
      this.renderPrompt();
    }
  }

  finish() {
    this.awaitingNext = true;
    const guessed = this.results.filter((r) => r.km != null);
    const avg = guessed.length ? guessed.reduce((s, r) => s + r.km, 0) / guessed.length : null;
    const best = guessed.length ? guessed.reduce((a, r) => (r.km < a.km ? r : a)) : null;
    const record = this.app.progress?.recordFind(this.score);
    this.root.innerHTML = `
      <div class="fg-label">Игра окончена${record ? ' · новый рекорд!' : ''}</div>
      <div class="fg-target gradient-text">${formatNumber(this.score)} ${plural(this.score, POINTS)}</div>
      <div class="fg-result">
        ${avg != null ? `Средняя ошибка: <b>${formatNumber(Math.round(avg))} км</b>` : 'Нет ни одного ответа'}
        ${best ? `<br>Точнее всего: ${esc(best.name)} — ${formatNumber(Math.round(best.km))} км` : ''}
      </div>
      <div class="fg-row">
        <button class="btn btn-accent" type="button" data-fg="again" data-icon-left="reset">Сыграть ещё</button>
        <button class="btn" type="button" data-fg="close" data-icon-left="close">Закрыть</button>
      </div>`;
    this.bindButtons();
    this.app.director.reset();
    this.app.progress?.unlock('globetrotter');
  }
}
