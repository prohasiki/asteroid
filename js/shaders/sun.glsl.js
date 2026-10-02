/**
 * sun.glsl.js — Солнце (билборд с диском, потемнением к краю, короной
 * и лучами) и светящаяся точка МКС. Значения цвета HDR (> 1) для bloom.
 */

export const billboardVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const sunFragment = /* glsl */ `
  uniform float uTime;
  uniform float uDisc;        // радиус диска в долях половины квадрата
  uniform float uIntensity;   // общий множитель (видимость)
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);

    // Диск с потемнением к краю (закон потемнения к лимбу, u ≈ 0,6).
    float x = clamp(r / uDisc, 0.0, 1.0);
    float mu = sqrt(max(0.0, 1.0 - x * x));
    float disc = 1.0 - smoothstep(uDisc * 0.94, uDisc, r);
    vec3 col = vec3(1.0, 0.95, 0.86) * disc * (0.4 + 0.6 * mu) * 28.0;

    // Корона и рассеянное свечение.
    float rr = max(r - uDisc * 0.9, 0.0);
    col += vec3(1.0, 0.86, 0.62) * (exp(-rr * 9.0) * 3.2 + exp(-rr * 2.6) * 0.45);

    // Дифракционные лучи: несколько медленно вращающихся гармоник.
    float rays = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float freq = 4.0 + fk * 3.0;
      float ph = hash(fk * 13.1) * 6.2831 + uTime * (0.02 + 0.01 * fk) * (mod(fk, 2.0) * 2.0 - 1.0);
      rays += pow(0.5 + 0.5 * cos(a * freq + ph), 24.0 + fk * 8.0) * (0.9 - fk * 0.15);
    }
    col += vec3(1.0, 0.9, 0.74) * rays * exp(-rr * 3.2) * 1.4;

    // Мягкое затухание к краю квадрата.
    col *= 1.0 - smoothstep(0.82, 1.0, r);
    gl_FragColor = vec4(col * uIntensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const pointGlowVertex = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio;
  }
`;

export const pointGlowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float pulse = 0.75 + 0.25 * sin(uTime * 3.0);
    float a = (exp(-d * d * 14.0) * 2.2 + exp(-d * 4.0) * 0.5 * pulse) * uIntensity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
