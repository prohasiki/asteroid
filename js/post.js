/**
 * post.js — постобработка: RenderPass → UnrealBloom (HDR) → OutputPass
 * (ACES + sRGB) → кинематографичный проход (аберрация, блики, виньетка, зерно).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { cinematicVertex, cinematicFragment } from './shaders/post.glsl.js';

export const POST_QUALITY = {
  high: { bloom: true, bloomScale: 1.0, grain: 0.03, aberration: 0.0032, vignette: 0.45 },
  medium: { bloom: true, bloomScale: 0.5, grain: 0.025, aberration: 0.0024, vignette: 0.45 },
  low: { bloom: false, bloomScale: 0.5, grain: 0.0, aberration: 0.0, vignette: 0.35 },
};

export class PostFX {
  constructor(renderer, scene, camera, { quality = 'high' } = {}) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.size = size.clone();
    this.bloomScale = 1;

    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x * pr, size.y * pr), 0.55, 0.55, 0.82);
    this.outputPass = new OutputPass();
    this.cinematic = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(size.x * pr, size.y * pr) },
        uTime: { value: 0 },
        uVignette: { value: 0.45 },
        uGrain: { value: 0.03 },
        uAberration: { value: 0.003 },
        uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
        uFlare: { value: 0 },
      },
      vertexShader: cinematicVertex,
      fragmentShader: cinematicFragment,
    });
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.cinematic);
    this.setQuality(quality);
  }

  setQuality(level) {
    const q = POST_QUALITY[level];
    if (!q) return;
    this.quality = level;
    this.bloomPass.enabled = q.bloom;
    this.bloomScale = q.bloomScale;
    const u = this.cinematic.uniforms;
    u.uGrain.value = q.grain;
    u.uAberration.value = q.aberration;
    u.uVignette.value = q.vignette;
    this.setSize(this.size.x, this.size.y);
  }

  setSize(w, h) {
    this.size.set(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.bloomPass.setSize(Math.max(1, Math.round(w * pr * this.bloomScale)), Math.max(1, Math.round(h * pr * this.bloomScale)));
    this.cinematic.uniforms.uResolution.value.set(w * pr, h * pr);
  }

  /** @param {{x:number,y:number,strength:number}} flare */
  update(time, flare) {
    const u = this.cinematic.uniforms;
    u.uTime.value = time;
    u.uSunPos.value.set(flare.x, flare.y);
    u.uFlare.value = flare.strength * 0.85;
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloomPass.dispose();
    this.outputPass.dispose();
    this.cinematic.dispose?.();
  }
}
