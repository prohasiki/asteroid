/**
 * magnetosphere.glsl.js — силовые линии магнитного диполя и полярные сияния.
 */

export const fieldVertex = /* glsl */ `
  attribute float aL;            // нормированный параметр оболочки L (0..1)
  uniform vec3 uSunDir;
  varying float vT;
  varying float vL;
  varying float vCam;
  void main() {
    vT = uv.x;
    vL = aL;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // Солнечный ветер: поджатие с дневной стороны и вытягивание хвоста на ночной.
    float r = length(wp.xyz);
    float s = dot(wp.xyz, uSunDir);
    float k = smoothstep(1.6, 8.0, r);
    float shift = s > 0.0 ? s * 0.3 * k : s * 0.6 * k;
    wp.xyz -= uSunDir * shift;
    vCam = distance(wp.xyz, cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const fieldFragment = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying float vT;
  varying float vL;
  varying float vCam;
  void main() {
    // Импульсы бегут вдоль линий от южного полушария к северному.
    float pulse = pow(fract(vT * 6.0 - uTime * 0.22 + vL * 0.37), 10.0);
    float base = 0.1 + 0.85 * pulse;
    float ends = smoothstep(0.0, 0.05, vT) * (1.0 - smoothstep(0.95, 1.0, vT));
    float nearFade = smoothstep(0.35, 1.4, vCam); // не слепить вблизи камеры
    vec3 col = mix(vec3(0.35, 0.78, 1.0), vec3(0.72, 0.48, 1.0), vL);
    gl_FragColor = vec4(col * base * ends * nearFade * uOpacity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const auroraVertex = /* glsl */ `
  attribute float aPhi;
  attribute float aV;
  uniform float uTheta0;   // средняя коширота овала
  uniform float uShift;    // смещение овала к ночной стороне
  uniform float uNightPhi; // магнитная долгота антисолнечного направления
  uniform float uR0;
  uniform float uR1;
  uniform float uHemi;     // +1 — северный овал, −1 — южный
  varying float vPhi;
  varying float vV;
  varying vec3 vNormalW;
  void main() {
    float theta = uTheta0 + uShift * cos(aPhi - uNightPhi);
    float r = mix(uR0, uR1, aV);
    vec3 dir = vec3(sin(theta) * cos(aPhi), uHemi * cos(theta), sin(theta) * sin(aPhi));
    vPhi = aPhi;
    vV = aV;
    vNormalW = normalize(mat3(modelMatrix) * dir);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(dir * r, 1.0);
  }
`;

export const auroraFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uSunDir;
  varying float vPhi;
  varying float vV;
  varying vec3 vNormalW;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float x = vPhi / 6.2831853;
    // Складки занавеса и вертикальные лучи.
    float folds = noise(vec2(x * 24.0 + uTime * 0.05, uTime * 0.08)) * 0.65 + noise(vec2(x * 61.0 - uTime * 0.11, 3.7)) * 0.35;
    float rays = noise(vec2(x * 300.0, uTime * 0.7));
    rays = rays * rays;
    float band = 0.25 + 0.75 * smoothstep(0.3, 0.75, folds);
    float vertical = smoothstep(0.0, 0.1, vV) * (1.0 - smoothstep(0.4, 1.0, vV));

    // Цвет по высоте: фиолетовая кромка (азот), зелёный (O, 557,7 нм), красный верх (O, 630 нм).
    vec3 col = mix(vec3(0.25, 1.0, 0.52), vec3(1.0, 0.24, 0.42), smoothstep(0.35, 0.95, vV));
    col = mix(vec3(0.55, 0.35, 1.0), col, smoothstep(0.0, 0.09, vV));

    float night = 1.0 - smoothstep(-0.3, 0.15, dot(vNormalW, uSunDir));
    float I = (0.3 + 0.7 * rays) * band * vertical * (0.1 + 0.9 * night) * uIntensity;
    gl_FragColor = vec4(col * I * 2.0, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
