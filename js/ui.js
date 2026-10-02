/**
 * ui.js — интерфейс: иконки, экран загрузки, вкладки энциклопедии,
 * рендер разделов (счётчики, диаграммы, таблицы), HUD, карточки,
 * уведомления, панели управления и мобильные «шторки».
 */
import { SECTIONS, LAYER_TOGGLES } from './data.js';
import { formatCoords, formatLat, formatLon } from './geo.js';

/* ------------------------------------------------------------------ */
/*  Line-art иконки (viewBox 24×24, обводка currentColor)              */
/* ------------------------------------------------------------------ */
const ICONS = {
  planet: '<circle cx="12" cy="12" r="6.5"/><path d="M3.5 15.5c-1.6 2.3 1.1 3.6 5.8 2.4 4.4-1.1 9.6-4.6 11.6-7.6 1.7-2.5-.6-3.9-5-3"/>',
  core: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3v9h9"/>',
  atmosphere: '<path d="M3 9c3-2 6 2 9 0s6-2 9 0"/><path d="M3 14c3-2 6 2 9 0s6-2 9 0"/><path d="M3 19c3-2 6 2 9 0s6-2 9 0"/><path d="M12 3v2"/>',
  water: '<path d="M12 3.5c3.5 4.4 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.5-6.2 6-10.6Z"/><path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.4"/>',
  continents: '<circle cx="12" cy="12" r="9"/><path d="M7 7.5c1.5.5 2.5 1.8 2 3.2-.4 1.2-2 1.4-2 3 0 1.3 1.3 2 1.3 3.6M14 4c-.4 1.6.6 2.6 2 2.8 1.6.2 2.6 1.4 2.2 3-.5 1.8-2.6 1.6-3.2 3.3-.4 1.3.6 2.6.2 4"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 4h3.5v8a2.5 2.5 0 0 0 5 0V4H18"/><path d="M6 8h3.5M14.5 8H18"/>',
  climate: '<path d="M10 14.8V5a2 2 0 1 1 4 0v9.8a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/><path d="M18 5h2M18 9h2"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  numbers: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  play: '<path d="M7 5l12 7-12 7V5Z"/>',
  realtime: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/><path d="M3 12h2M19 12h2"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/>',
  shot: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/><path d="M17.5 10.5h.01"/>',
  'sound-on': '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4v-5Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  'sound-off': '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4v-5Z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v3M8 20h8M9.5 17h5"/>',
  quiz: '<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M10 9a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1M12 13.5h.01"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  game: '<path d="M6 9h12a4 4 0 0 1 3.8 5.2l-.9 2.8a2.2 2.2 0 0 1-3.9.6L15.6 16H8.4L7 17.6a2.2 2.2 0 0 1-3.9-.6l-.9-2.8A4 4 0 0 1 6 9Z"/><path d="M8 11.5v3M6.5 13h3M15.5 12.5h.01M17.5 13.5h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5Z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".6"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  rocket: '<path d="M12 2.5c3.5 2 5 5.5 5 9.5l-2.5 4h-5L7 12c0-4 1.5-7.5 5-9.5Z"/><circle cx="12" cy="9" r="1.8"/><path d="M9.5 16l-2 4 4.5-2M14.5 16l2 4-4.5-2"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2Z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  fire: '<path d="M12 21c4 0 7-2.8 7-6.6 0-3.6-2.4-5.5-3.6-8.4-.6 2-1.6 3-3 3.4.4-2.8-.8-5.6-3.4-6.9.3 3.3-1.4 5-3 6.8A8 8 0 0 0 5 14.4C5 18.2 8 21 12 21Z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  ice: '<path d="M12 2v20M4 6.5l16 11M20 6.5l-16 11"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"/>',
};

export function icon(name) {
  const body = ICONS[name];
  return body ? `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>` : '';
}

/** Вставить иконки в элементы с атрибутами data-icon / data-icon-left. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone === el.dataset.icon) return;
    el.querySelector(':scope > svg')?.remove();
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.dataset.iconDone = el.dataset.icon;
  });
  root.querySelectorAll('[data-icon-left]').forEach((el) => {
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.iconLeft));
    el.dataset.iconDone = '1';
  });
}

/* ------------------------------------------------------------------ */
/*  Форматирование                                                     */
/* ------------------------------------------------------------------ */
const pad = (n, l = 2) => String(n).padStart(l, '0');

export function formatNumber(v, decimals = 0) {
  return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatDateUTC(d) {
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function formatDateLong(d) {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const attr = (o) => esc(JSON.stringify(o ?? null));

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* ------------------------------------------------------------------ */
/*  Класс интерфейса                                                    */
/* ------------------------------------------------------------------ */
export class UI {
  /**
   * @param {Object} app — приложение (main.js), предоставляющее методы управления
   */
  constructor(app) {
    this.app = app;
    this.visited = new Set();
    this.currentSection = null;
    this.hudTimer = 0;
    this.cardTimer = null;
    const $ = (id) => document.getElementById(id);
    this.el = {
      loaderBar: $('loader-bar'), loaderText: $('loader-text'), loaderPercent: $('loader-percent'), loaderItems: $('loader-items'),
      tabs: $('section-tabs'), content: $('section-content'), exploreCount: $('explore-count'), exploreBar: $('explore-bar'),
      hudDate: $('hud-date'), hudSpeed: $('hud-speed'), hudSun: $('hud-sun'), hudCoords: $('hud-coords'), hudRegion: $('hud-region'),
      hudAlt: $('hud-alt'), hudPerf: $('hud-perf'), dateSlider: $('date-slider'), timeSlider: $('time-slider'),
      dateValue: $('date-value'), timeValue: $('time-value'), subsolar: $('subsolar-info'), layerToggles: $('layer-toggles'),
      card: $('info-card'), toasts: $('toasts'), achievements: $('achievements'), achCount: $('ach-count'),
      qualityInfo: $('quality-info'), bestScores: $('best-scores'), soundBtn: $('btn-sound'),
    };
    hydrateIcons();
    this.buildTabs();
    this.buildLayerToggles();
    this.bindControls();
    this.bindSheets();
  }

  /* ---------------- Экран загрузки ---------------- */

  loaderProgress(e) {
    if (e.type !== 'item') return;
    const pct = Math.round((e.done / e.all) * 100);
    this.el.loaderBar.style.width = `${pct}%`;
    this.el.loaderPercent.textContent = `${pct}%`;
    this.el.loaderText.textContent = e.fallback
      ? 'CDN недоступен — используются процедурные текстуры'
      : 'Загрузка текстур NASA Blue Marble…';
    const li = document.createElement('li');
    li.className = e.fallback ? 'fallback' : 'ok';
    li.textContent = `${e.label} — ${e.fallback ? 'процедурная замена' : 'загружено с CDN'}`;
    this.el.loaderItems.appendChild(li);
  }

  loaderStatus(text) {
    this.el.loaderText.textContent = text;
  }

  /* ---------------- Вкладки и разделы ---------------- */

  buildTabs() {
    this.el.tabs.innerHTML = SECTIONS.map((s) => `
      <button class="tab" type="button" role="tab" data-section="${s.id}" title="${esc(s.title)}">
        ${icon(s.icon)}<span>${esc(s.short)}</span>
      </button>`).join('');
    this.el.tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-section]');
      if (btn) this.openSection(btn.dataset.section);
    });
    this.updateExplore();
  }

  openSection(id) {
    const sec = SECTIONS.find((s) => s.id === id);
    if (!sec) return;
    this.currentSection = id;
    this.el.tabs.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.section === id;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.renderSection(sec);
    if (!this.visited.has(id)) {
      this.visited.add(id);
      this.el.tabs.querySelector(`[data-section="${id}"]`)?.classList.add('visited');
      this.updateExplore();
    }
    this.app.onSectionOpen?.(id, this.visited.size, SECTIONS.length);
  }

  updateExplore() {
    const n = this.visited.size, total = SECTIONS.length;
    this.el.exploreCount.textContent = `${n}/${total}`;
    this.el.exploreBar.style.width = `${(n / total) * 100}%`;
  }

  /** Восстановить отметки «изучено» (из сохранённого прогресса). */
  setVisited(ids) {
    for (const id of ids) {
      if (!SECTIONS.some((s) => s.id === id)) continue;
      this.visited.add(id);
      this.el.tabs.querySelector(`[data-section="${id}"]`)?.classList.add('visited');
    }
    this.updateExplore();
  }

  renderSection(sec) {
    let i = 0;
    const next = () => i++;
    const html = [
      `<h3 class="section-title reveal" style="--i:${next()}">${esc(sec.title)}</h3>`,
      sec.lead ? `<p class="section-lead reveal" style="--i:${next()}">${sec.lead}</p>` : '',
      ...sec.blocks.map((b) => this.renderBlock(b, next)),
    ];
    const c = this.el.content;
    c.innerHTML = html.join('');
    c.scrollTop = 0;
    hydrateIcons(c);
    c.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => {
        this.app.handleAction(el.dataset.action, JSON.parse(el.dataset.payload || 'null'));
        this.app.audio?.click();
      });
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.animateCounters(c);
      this.animateCharts(c);
    }));
  }

  renderBlock(b, next) {
    const title = b.title ? `<div class="block-title">${esc(b.title)}</div>` : '';
    let inner = '';
    switch (b.type) {
      case 'stats':
        inner = `<div class="stats">${b.items.map((s) => {
          const value = s.text != null
            ? esc(s.text)
            : `<span data-count="${s.value}" data-decimals="${s.decimals ?? 0}">0</span>${s.suffix ? esc(s.suffix) : ''}`;
          return `<div class="stat${s.wide ? ' wide' : ''}"><span class="stat-label">${esc(s.label)}</span>`
            + `<span class="stat-value">${value}</span>${s.unit ? `<span class="stat-unit">${esc(s.unit)}</span>` : ''}`
            + `${s.note ? `<span class="stat-note">${esc(s.note)}</span>` : ''}</div>`;
        }).join('')}</div>`;
        break;
      case 'text':
        inner = `<div class="text">${b.paragraphs.map((p) => `<p class="reveal" style="--i:${next()}">${p}</p>`).join('')}</div>`;
        break;
      case 'list':
        inner = `<ul class="list">${b.items.map((t) => `<li class="reveal" style="--i:${next()}">${t}</li>`).join('')}</ul>`;
        break;
      case 'facts':
        inner = `<div class="facts">${b.items.map((t, k) => `<div class="fact reveal" style="--i:${next()}"><span class="fact-num">${pad(k + 1)}</span><span>${t}</span></div>`).join('')}</div>`;
        break;
      case 'layers':
        inner = `<div class="layers-chart">${b.items.map((l) => `
          <div class="layer-row reveal" style="--i:${next()}">
            <span class="swatch" style="background:${l.color}"></span>
            <span><b>${esc(l.name)}</b><small>${l.desc}</small></span>
            <span class="range">${esc(l.range)}</span>
          </div>`).join('')}</div>`;
        break;
      case 'donut':
        inner = this.renderDonut(b);
        break;
      case 'bars':
        inner = `<div class="bars">${b.items.map((r) => `
          <div class="bar-row"><div class="bar-head"><span>${esc(r.label)}</span><span>${esc(r.display)}</span></div>
          <div class="bar-track"><div class="bar-fill" data-width="${Math.max(0.8, (r.value / b.max) * 100)}" style="background:${r.color || 'linear-gradient(90deg,#46d4ff,#8f7bff)'}"></div></div></div>`).join('')}</div>`;
        break;
      case 'table':
        inner = `<table class="table"><thead><tr>${b.columns.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r, k) => {
          const act = b.actions?.[k];
          return `<tr${act ? ` class="clickable" data-action="${act.action}" data-payload="${attr(act.payload)}" title="Показать на глобусе"` : ''}>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`;
        }).join('')}</tbody></table>`;
        break;
      case 'actions':
        inner = `<div class="btn-grid">${b.items.map((a) => `<button class="btn${a.accent ? ' btn-accent' : ''}" type="button" data-action="${a.action}" data-payload="${attr(a.payload)}" data-icon-left="${a.icon || 'eye'}">${esc(a.label)}</button>`).join('')}</div>`;
        break;
      case 'chips':
        inner = `<div class="chips">${b.items.map((c) => `<button class="chip${c.color ? ' legend-chip' : ''}" type="button" data-action="${c.action}" data-payload="${attr(c.payload)}">${c.color ? `<i style="background:${c.color}"></i>` : ''}${esc(c.label)}</button>`).join('')}</div>`;
        break;
      case 'legend':
        inner = `<div class="chips">${b.items.map((c) => `<span class="chip legend-chip"><i style="background:${c.color}"></i>${esc(c.label)}</span>`).join('')}</div>`;
        break;
      default:
        inner = '';
    }
    return `<div class="block reveal" style="--i:${next()}">${title}${inner}${b.note ? `<p class="hint">${b.note}</p>` : ''}</div>`;
  }

  renderDonut(b) {
    const r = 46, C = 2 * Math.PI * r;
    let acc = 0;
    const total = b.items.reduce((s, it) => s + it.value, 0);
    const segs = b.items.map((it) => {
      const len = (it.value / total) * C;
      const seg = `<circle cx="60" cy="60" r="${r}" stroke="${it.color}" stroke-width="16" fill="none"
        stroke-dasharray="0 ${C.toFixed(2)}" data-dash="${Math.max(len - 1.2, 0.6).toFixed(2)} ${(C - Math.max(len - 1.2, 0.6)).toFixed(2)}"
        stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 60 60)"/>`;
      acc += len;
      return seg;
    }).join('');
    const legend = b.items.map((it) => `<div class="legend-row"><i style="background:${it.color}"></i><span>${esc(it.label)}</span><span>${esc(it.display ?? formatNumber(it.value, 2) + '%')}</span></div>`).join('');
    return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 120 120" width="130" height="130">
      <circle cx="60" cy="60" r="${r}" stroke="rgba(255,255,255,.06)" stroke-width="16" fill="none"/>${segs}
      <text x="60" y="56" text-anchor="middle" fill="#e6f6ff" font-family="Orbitron, sans-serif" font-size="12">${esc(b.centerTop || '')}</text>
      <text x="60" y="72" text-anchor="middle" fill="#8ea3c4" font-size="8.5">${esc(b.centerBottom || '')}</text>
      </svg><div class="legend">${legend}</div></div>`;
  }

  animateCounters(root) {
    const els = [...root.querySelectorAll('[data-count]')];
    const start = performance.now();
    const dur = 1400;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = easeOutCubic(t);
      for (const el of els) {
        const v = parseFloat(el.dataset.count);
        el.textContent = formatNumber(v * e, parseInt(el.dataset.decimals, 10) || 0);
      }
      if (t < 1 && els.length && root.contains(els[0])) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  animateCharts(root) {
    root.querySelectorAll('circle[data-dash]').forEach((c) => c.setAttribute('stroke-dasharray', c.dataset.dash));
    root.querySelectorAll('.bar-fill[data-width]').forEach((b) => { b.style.width = `${b.dataset.width}%`; });
  }

  /* ---------------- Слои ---------------- */

  buildLayerToggles() {
    this.el.layerToggles.innerHTML = LAYER_TOGGLES.map((l) => (l.group
      ? `<div class="toggle-sep">${esc(l.group)}</div>`
      : `<label class="toggle"><input type="checkbox" data-layer="${l.id}"${l.on ? ' checked' : ''}><span class="toggle-ui"></span>${esc(l.label)}${l.color ? `<span class="swatch" style="background:${l.color}"></span>` : ''}</label>`)).join('');
    this.el.layerToggles.addEventListener('change', (e) => {
      const input = e.target.closest('input[data-layer]');
      if (!input) return;
      this.app.setLayer(input.dataset.layer, input.checked);
      this.app.audio?.toggle(input.checked);
    });
  }

  setLayerChecked(id, on) {
    const input = this.el.layerToggles.querySelector(`input[data-layer="${id}"]`);
    if (input) input.checked = on;
  }

  /* ---------------- Кнопки и клавиатура ---------------- */

  bindControls() {
    const app = this.app;
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    document.getElementById('speed-buttons').addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (b) app.setSpeed(Number(b.dataset.speed));
    });
    on('ctrl-pause', () => app.handleAction('pause'));
    on('ctrl-realtime', () => app.handleAction('realtime'));
    on('ctrl-reset', () => app.handleAction('reset'));
    on('ctrl-moon', () => app.handleAction('moonView'));
    on('ctrl-cut', () => app.handleAction('cut'));
    on('ctrl-screenshot', () => app.handleAction('screenshot'));
    on('ctrl-quiz', () => app.handleAction('quiz'));
    on('ctrl-find', () => app.handleAction('find'));
    on('btn-sound', () => app.toggleSound());
    on('btn-fullscreen', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.();
    });
    document.getElementById('opt-autorotate').addEventListener('change', (e) => app.setAutoRotate(e.target.checked));
    document.getElementById('quality-buttons').addEventListener('click', (e) => {
      const b = e.target.closest('[data-quality]');
      if (b) app.setQualityMode(b.dataset.quality);
    });
    document.querySelector('.toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const map = { reset: 'reset', pause: 'pause', realtime: 'realtime', moon: 'moonView', screenshot: 'screenshot' };
      app.handleAction(map[b.dataset.action]);
    });

    const ds = this.el.dateSlider, ts = this.el.timeSlider;
    const onSlide = () => app.setSimFromSliders(Number(ds.value), Number(ts.value));
    for (const s of [ds, ts]) {
      s.addEventListener('input', onSlide);
      s.addEventListener('pointerdown', () => { this.sliding = true; });
      s.addEventListener('pointerup', () => { this.sliding = false; });
      s.addEventListener('change', () => { this.sliding = false; });
    }

    window.addEventListener('keydown', (e) => {
      if (e.target.matches?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (app.quiz?.active) return; // у викторины свои клавиши
      if (e.code === 'Space') { e.preventDefault(); app.handleAction('pause'); }
      else if (e.code === 'KeyR') app.handleAction('reset');
      else if (e.code === 'KeyM') app.handleAction('moonView');
      else if (e.code === 'KeyP') app.handleAction('screenshot');
      else if (e.key === 'Escape') { this.hideCard(); app.handleAction('escape'); }
      else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) app.setSpeed([1, 100, 1000, 10000][Number(e.code.slice(-1)) - 1]);
    });
  }

  bindSheets() {
    document.querySelectorAll('[data-open-sheet]').forEach((b) => b.addEventListener('click', () => this.toggleSheet(b.dataset.openSheet)));
    document.querySelectorAll('[data-close-sheet]').forEach((b) => b.addEventListener('click', () => this.closeSheets()));
  }

  toggleSheet(id) {
    const panel = document.getElementById(id);
    const open = !panel.classList.contains('open');
    this.closeSheets();
    if (open) panel.classList.add('open');
  }

  closeSheets() {
    document.querySelectorAll('.panel.open').forEach((p) => p.classList.remove('open'));
  }

  /* ---------------- Время ---------------- */

  /** @param {{speed:number, paused:boolean, date:Date, dayOffset:number, minuteOfDay:number}} s */
  updateTimeControls(s) {
    document.querySelectorAll('#speed-buttons [data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === s.speed));
    if (this.lastPaused !== s.paused) {
      this.lastPaused = s.paused;
      const pb = document.getElementById('ctrl-pause');
      pb.innerHTML = `${icon(s.paused ? 'play' : 'pause')}${s.paused ? 'Продолжить' : 'Пауза'}`;
      pb.classList.toggle('active', s.paused);
      const tb = document.querySelector('.toolbar [data-action="pause"]');
      tb.innerHTML = `${icon(s.paused ? 'play' : 'pause')}<span>${s.paused ? 'Пуск' : 'Пауза'}</span>`;
      tb.classList.toggle('active', s.paused);
    }
    if (!this.sliding) {
      this.el.dateSlider.value = s.dayOffset;
      this.el.timeSlider.value = s.minuteOfDay;
    }
    this.el.dateValue.textContent = formatDateLong(s.date);
    this.el.timeValue.textContent = `${pad(s.date.getUTCHours())}:${pad(s.date.getUTCMinutes())}`;
  }

  /* ---------------- HUD ---------------- */

  updateHud(s) {
    this.el.hudDate.textContent = formatDateUTC(s.date);
    this.el.hudSpeed.textContent = s.paused ? 'ПАУЗА' : `×${formatNumber(s.speed)}`;
    this.el.hudSun.textContent = `☉ ${formatLat(s.subsolar.lat)} · ${formatLon(s.subsolar.lon)}`;
    if (s.hover) {
      this.el.hudCoords.textContent = formatCoords(s.hover.lat, s.hover.lon);
      this.el.hudRegion.textContent = s.hover.label;
    } else {
      this.el.hudCoords.textContent = '—';
      this.el.hudRegion.textContent = s.mode === 'moon' ? 'Вид с Луны: колесо — зум телеобъектива' : 'Наведите курсор на планету';
    }
    this.el.hudAlt.textContent = s.mode === 'moon'
      ? `${formatNumber(Math.round(s.earthDistanceKm))} км до Земли`
      : `${formatNumber(Math.round(s.altitudeKm))} км`;
    this.el.hudPerf.textContent = `${s.fps} FPS · ${s.qualityLabel}`;
    if (s.moon) {
      this.el.subsolar.textContent = `Подсолнечная точка: ${formatLat(s.subsolar.lat)}, ${formatLon(s.subsolar.lon)}. `
        + `Луна: ${s.moon.name.toLowerCase()}, освещено ${Math.round(s.moon.illumination * 100)}%, `
        + `${formatNumber(Math.round(s.moon.distanceKm))} км.`;
    }
  }

  setQualityButtons(mode, effective) {
    document.querySelectorAll('#quality-buttons [data-quality]').forEach((b) => b.classList.toggle('active', b.dataset.quality === mode));
    const names = { high: 'High', medium: 'Medium', low: 'Low' };
    this.el.qualityInfo.textContent = mode === 'auto'
      ? `Автоматический режим по FPS. Сейчас: ${names[effective]}.`
      : `Фиксированное качество: ${names[effective]}.`;
  }

  setSoundState(on) {
    const b = this.el.soundBtn;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? 'Звук (включён)' : 'Звук (выключен)';
    b.dataset.icon = on ? 'sound-on' : 'sound-off';
    hydrateIcons(b.parentElement);
  }

  setButtonActive(selector, on) {
    document.querySelectorAll(selector).forEach((b) => b.classList.toggle('active', on));
  }

  setBestScores(text) {
    this.el.bestScores.textContent = text;
  }

  /* ---------------- Карточки ---------------- */

  placeCard(x, y) {
    const card = this.el.card;
    const w = card.offsetWidth || 300, h = card.offsetHeight || 220;
    let left = x + 22, top = y - h / 2;
    if (left + w > window.innerWidth - 16) left = x - w - 22;
    left = Math.max(16, Math.min(left, window.innerWidth - w - 16));
    top = Math.max(90, Math.min(top, window.innerHeight - h - 110));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  showCard(html, x, y, cls = '') {
    const card = this.el.card;
    card.className = `info-card glass ${cls}`;
    card.innerHTML = `<button class="icon-btn card-close" type="button" title="Закрыть" data-icon="close"></button>${html}`;
    hydrateIcons(card);
    card.querySelector('.card-close').addEventListener('click', () => this.hideCard());
    card.querySelectorAll('[data-action]').forEach((el) => el.addEventListener('click', () => {
      this.app.handleAction(el.dataset.action, JSON.parse(el.dataset.payload || 'null'));
    }));
    this.placeCard(x, y);
    clearTimeout(this.cardTimer);
  }

  hideCard() {
    this.el.card.classList.add('hidden');
  }

  /** Карточка точки на глобусе. */
  showPointCard(info, x, y) {
    const rows = [
      ['Регион', info.regionLabel],
      info.city ? ['Ближайший город', `${info.city.name}, ${formatNumber(Math.round(info.city.distanceKm))} км`] : null,
      ['Солнце над горизонтом', `${formatNumber(info.sunElevation, 1)}°`],
      ['Освещённость', info.dayState],
      ['Местное солнечное время', info.localTime],
      ['Номинальный пояс', info.utcOffset],
    ].filter(Boolean);
    this.showCard(`
      <h4 class="gradient-text">${esc(info.title)}</h4>
      <div class="coords">${esc(formatCoords(info.lat, info.lon))}</div>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="card-actions">
        <button class="btn" type="button" data-action="flyTo" data-payload="${attr({ lat: info.lat, lon: info.lon, dist: 1.9 })}" data-icon-left="target">Приблизить</button>
        ${info.continent ? `<button class="btn btn-accent" type="button" data-action="continent" data-payload="${attr({ id: info.continent })}" data-icon-left="continents">О материке</button>` : ''}
      </div>`, x, y);
  }

  /** Карточка материка. */
  showContinentCard(c, x, y) {
    this.showCard(`
      <h4 class="gradient-text">${esc(c.name)}</h4>
      <div class="coords">${esc(c.tagline)}</div>
      <dl>
        <dt>Площадь</dt><dd>${esc(c.area)}</dd>
        <dt>Население</dt><dd>${esc(c.population)}</dd>
        <dt>Высшая точка</dt><dd>${esc(c.highest)}</dd>
        <dt>Низшая точка</dt><dd>${esc(c.lowest)}</dd>
        <dt>Государств</dt><dd>${esc(c.countries)}</dd>
      </dl>
      <ul class="card-facts">${c.facts.map((f) => `<li>${f}</li>`).join('')}</ul>`, x, y, 'continent');
  }

  /** Карточка Луны. */
  showMoonCard(m, x, y) {
    this.showCard(`
      <h4 class="gradient-text">Луна</h4>
      <div class="coords">${esc(m.name)} · освещено ${Math.round(m.illumination * 100)}%</div>
      <dl>
        <dt>Возраст Луны</dt><dd>${formatNumber(m.ageDays, 1)} сут</dd>
        <dt>Расстояние</dt><dd>${formatNumber(Math.round(m.distanceKm))} км</dd>
        <dt>Радиус</dt><dd>1 737,4 км</dd>
        <dt>Наклон орбиты</dt><dd>5,14° к эклиптике</dd>
      </dl>
      <div class="card-actions"><button class="btn btn-accent" type="button" data-action="moonView" data-icon-left="moon">Вид с Луны</button></div>`, x, y);
  }

  /* ---------------- Уведомления и достижения ---------------- */

  toast({ title, text = '', iconName = 'trophy', kind = 'achievement', duration = 4200 }) {
    const el = document.createElement('div');
    el.className = `toast${kind === 'info' ? ' info' : ''}`;
    el.innerHTML = `<div class="toast-icon">${icon(iconName)}</div><div><b>${esc(title)}</b><small>${esc(text)}</small></div>`;
    this.el.toasts.appendChild(el);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 650);
    }, duration);
  }

  renderAchievements(list, unlocked) {
    this.el.achievements.innerHTML = list.map((a) => `
      <li class="ach${unlocked.has(a.id) ? ' done' : ''}">
        <span class="ach-icon">${icon(a.icon)}</span>
        <span><b>${esc(a.title)}</b><small>${esc(a.desc)}</small></span>
      </li>`).join('');
    this.el.achCount.textContent = `${unlocked.size}/${list.length}`;
  }
}
