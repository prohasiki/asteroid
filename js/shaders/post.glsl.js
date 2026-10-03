/**
 * post.glsl.js — финальный «кинематографичный» проход (после OutputPass,
 * в пространстве дисплея): хроматическая аберрация по краям, блики
 * объектива от Солнца (призраки, ореол, анаморфный штрих), виньетка, зерно.
 */

export const cinematicVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const cinematicFragment = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uAberration;
  uniform vec2 uSunPos;     // положение Солнца на экране (0..1)
  uniform float uFlare;     // сила бликов (с учётом видимости Солнца)
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 ghost(vec2 uv, vec2 center, float radius, vec3 tint, float aspect) {
    vec2 d = (uv - center) * vec2(aspect, 1.0);
    float r = length(d) / radius;
    float disc = (1.0 - smoothstep(0.72, 1.0, r)) * (0.5 + 0.5 * smoothstep(0.15, 0.95, r));
    return tint * disc;
  }

  void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;
    float aspect = uResolution.x / uResolution.y;

    // Хроматическая аберрация растёт квадратично к краям кадра.
    float r2 = dot(c, c) * 4.0;
    vec2 off = c * r2 * uAberration;
    vec3 col;
    col.r = texture2D(tDiffuse, uv + off).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - off).b;

    if (uFlare > 0.001) {
      vec2 axis = uSunPos - 0.5;
      vec3 fl = vec3(0.0);
      fl += ghost(uv, 0.5 - axis * 0.42, 0.034, vec3(0.16, 0.38, 0.26), aspect);
      fl += ghost(uv, 0.5 - axis * 0.72, 0.062, vec3(0.26, 0.16, 0.40), aspect);
      fl += ghost(uv, 0.5 - axis * 1.12, 0.105, vec3(0.10, 0.18, 0.36), aspect);
      fl += ghost(uv, 0.5 + axis * 0.32, 0.024, vec3(0.40, 0.28, 0.14), aspect);
      fl += ghost(uv, 0.5 - axis * 0.12, 0.016, vec3(0.30, 0.34, 0.48), aspect);
      vec2 ds = (uv - uSunPos) * vec2(aspect, 1.0);
      float rs = length(ds);
      fl += vec3(0.30, 0.50, 0.85) * (1.0 - smoothstep(0.0, 0.012, abs(rs - 0.23))) * 0.28;
      fl += vec3(0.45, 0.65, 1.0) * exp(-abs(ds.y) * 240.0) * exp(-abs(ds.x) * 2.4) * 0.55;
      fl += vec3(1.0, 0.9, 0.75) * exp(-rs * 5.0) * 0.07;
      col += fl * uFlare;
    }

    // Лёгкая виньетка.
    float v = length(c) * 1.4142;
    col *= mix(1.0, 1.0 - v * v * 0.85, uVignette);

    // Минимальное плёночное зерно.
    float g = hash(uv * uResolution + fract(uTime * 7.31) * 113.0) - 0.5;
    col += g * uGrain;

    gl_FragColor = vec4(col, 1.0);
  }
`;
