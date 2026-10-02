/**
 * moon.glsl.js — Луна: закон Ломмеля–Зеелигера (полнолуние без потемнения
 * к краю), рельеф из градиента яркости текстуры (выборка в пространстве
 * текстуры с билинейной фильтрацией — гладко при любом увеличении) и
 * пепельный свет — отражённый Землёй солнечный свет на ночной стороне.
 */

export const moonVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vTangentW;
  varying vec3 vPosW;
  varying vec3 vPosL;
  void main() {
    vUv = uv;
    vPosL = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vPosW = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    // Касательная «на восток» (рост u): Y × p, инвариантна к повороту сферы вокруг Y.
    vec3 e = vec3(position.z, 0.0, -position.x);
    float el = length(e);
    vTangentW = normalize(mat3(modelMatrix) * (el > 1e-6 ? e / el : vec3(1.0, 0.0, 0.0)));
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const moonFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uTexel;         // размер текселя (1/ширина, 1/высота)
  uniform vec3 uSunDir;
  uniform vec3 uEarthPos;
  uniform float uEarthshine;   // доля освещённой Земли, видимой с Луны
  uniform float uBump;
  uniform float uSunPower;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vTangentW;
  varying vec3 vPosW;
  varying vec3 vPosL;

  float height(vec2 uv) { return dot(texture2D(uMap, uv).rgb, vec3(0.3333)); }

  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  // Мелкая процедурная детализация реголита для крупных планов.
  // Октава гасится, если её период меньше ~2 пикселей (без алиасинга).
  float detail(vec3 p, float fw) {
    float s = 0.0, a = 0.5, f = 1.0;
    for (int i = 0; i < 5; i++) {
      float w = 1.0 - smoothstep(0.2, 0.5, fw * f);
      s += a * w * (noise3(p * f) - 0.5);
      f *= 2.17;
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 albedo = texture2D(uMap, vUv).rgb;
    vec3 N = normalize(vNormalW);
    vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
    vec3 B = cross(N, T);

    // Градиент «высоты» центральными разностями в пространстве текстуры.
    vec2 d = uTexel * 1.5;
    float hx = height(vUv + vec2(d.x, 0.0)) - height(vUv - vec2(d.x, 0.0));
    float hy = height(vUv + vec2(0.0, d.y)) - height(vUv - vec2(0.0, d.y));
    // Детализация проявляется, когда тексель текстуры занимает больше пикселя.
    float texelsPerPixel = fwidth(vUv.x) / uTexel.x;
    float dw = smoothstep(1.2, 0.3, texelsPerPixel);
    if (dw > 0.001) {
      vec3 q = normalize(vPosL) * 260.0;
      float fw = length(fwidth(q));
      float dn = detail(q, fw);
      float e = 0.3;
      float dx = detail(q + T * e, fw) - dn;
      float dy = detail(q + B * e, fw) - dn;
      hx += dx * 0.12 * dw;
      hy += dy * 0.12 * dw;
      albedo *= 1.0 + dn * 0.16 * dw;
    }
    vec3 Nb = normalize(N - (T * hx + B * hy) * uBump);

    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vPosW);
    float mu0 = max(dot(Nb, L), 0.0);
    float mu = max(dot(N, V), 0.0);
    float lommel = 2.0 * mu0 / (mu0 + mu + 1e-4);
    float shade = mix(mu0, lommel, 0.65) * smoothstep(-0.02, 0.06, dot(N, L));
    vec3 col = albedo * shade * uSunPower;

    // Пепельный свет Луны: подсветка ночной стороны отражённым светом Земли.
    vec3 toEarth = normalize(uEarthPos - vPosW);
    float e = max(dot(N, toEarth), 0.0);
    col += albedo * vec3(0.32, 0.42, 0.62) * e * uEarthshine * 0.035 * (1.0 - smoothstep(-0.1, 0.1, dot(N, L)));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
