/**
 * continents.js — контуры материков на глобусе: оверлей «Границы материков»
 * и светящаяся подсветка материка под курсором.
 */
import * as THREE from 'three';
import { LAND_SHAPES } from './data.js';
import { latLonToLocal } from './astro.js';

/** Точки контура на сфере с промежуточными точками каждые ~2°. */
function shapePoints(shape, radius) {
  const c = shape.coords;
  const n = c.length / 2 - (shape.polar ? 2 : 0); // у полярного контура пропускаем замыкание через полюс
  const pts = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lon0 = c[i * 2], lat0 = c[i * 2 + 1];
    const lon1 = c[j * 2], lat1 = c[j * 2 + 1];
    if (shape.polar && j === 0) break; // Антарктида: −180° и 180° совпадают
    const steps = Math.max(1, Math.ceil(Math.hypot(lon1 - lon0, lat1 - lat0) / 2));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const p = latLonToLocal(lat0 + (lat1 - lat0) * t, lon0 + (lon1 - lon0) * t, radius);
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
  }
  return pts;
}

export class Continents {
  /** @param {import('./earth.js').Earth} earth */
  constructor(earth) {
    this.group = new THREE.Group();
    this.group.name = 'Continents';
    earth.spin.add(this.group);

    this.bordersOn = false;
    this.bordersLevel = 0;
    this.hovered = null;
    this.hoverLevel = 0;

    this.borderMaterial = new THREE.LineBasicMaterial({ color: 0x46d4ff, transparent: true, opacity: 0, depthWrite: false });
    this.highlightMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(1.3, 2.2, 2.8),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.borders = new THREE.Group();
    this.borders.visible = false;
    this.group.add(this.borders);
    this.highlights = {};
    for (const shape of LAND_SHAPES) {
      const base = new THREE.BufferGeometry().setFromPoints(shapePoints(shape, 1.0022));
      this.borders.add(new THREE.LineLoop(base, this.borderMaterial));
      if (!this.highlights[shape.continent]) {
        const g = new THREE.Group();
        g.visible = false;
        this.highlights[shape.continent] = g;
        this.group.add(g);
      }
      // Две концентрические линии дают более «толстое» свечение (линии WebGL — 1 пиксель).
      for (const r of [1.0026, 1.0048]) {
        const geo = new THREE.BufferGeometry().setFromPoints(shapePoints(shape, r));
        this.highlights[shape.continent].add(new THREE.LineLoop(geo, this.highlightMaterial));
      }
    }
  }

  setBorders(on) {
    this.bordersOn = on;
  }

  /** Подсветить материк (id из LAND_SHAPES) или снять подсветку (null). */
  setHover(id) {
    if (id === this.hovered) return;
    if (this.hovered && this.highlights[this.hovered]) this.highlights[this.hovered].visible = false;
    this.hovered = id;
    this.hoverLevel = 0;
    if (id && this.highlights[id]) this.highlights[id].visible = true;
  }

  update(dt, time) {
    const k = 1 - Math.exp(-dt * 6);
    this.bordersLevel += ((this.bordersOn ? 1 : 0) - this.bordersLevel) * k;
    this.borders.visible = this.bordersLevel > 0.01;
    this.borderMaterial.opacity = 0.6 * this.bordersLevel;
    this.hoverLevel += ((this.hovered ? 1 : 0) - this.hoverLevel) * k;
    this.highlightMaterial.opacity = this.hoverLevel * (0.75 + 0.25 * Math.sin(time * 4));
  }

  dispose() {
    this.group.traverse((o) => o.geometry?.dispose());
    this.borderMaterial.dispose();
    this.highlightMaterial.dispose();
  }
}
