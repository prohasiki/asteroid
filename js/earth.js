/**
 * earth.js — Земля: группа наклона оси, вращающаяся «сетка» планеты.
 * На этом этапе — базовый материал Phong; шейдеры добавляются следующим этапом.
 */
import * as THREE from 'three';
import { OBLIQUITY, gmst } from './astro.js';

export class Earth {
  /**
   * @param {Object} textures — набор текстур из textures.js
   */
  constructor(textures) {
    this.textures = textures;
    /** Корневая группа в эклиптической системе сцены. */
    this.root = new THREE.Group();
    this.root.name = 'EarthRoot';
    /** Экваториальная система: ось Y — ось вращения Земли (наклон 23,44°). */
    this.tilt = new THREE.Group();
    this.tilt.rotation.x = -OBLIQUITY;
    this.root.add(this.tilt);
    /** Вращающаяся вместе с Землёй система (поворот на GMST). */
    this.spin = new THREE.Group();
    this.tilt.add(this.spin);

    const geometry = new THREE.SphereGeometry(1, 128, 64);
    const material = new THREE.MeshPhongMaterial({
      map: textures.day,
      specularMap: textures.specular,
      specular: new THREE.Color(0x333333),
      shininess: 18,
      normalMap: textures.normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
    this.surface = new THREE.Mesh(geometry, material);
    this.surface.name = 'EarthSurface';
    this.spin.add(this.surface);
  }

  /** Обновление вращения по времени симуляции. */
  update(date) {
    this.spin.rotation.y = gmst(date);
  }

  dispose() {
    this.surface.geometry.dispose();
    this.surface.material.dispose();
  }
}
