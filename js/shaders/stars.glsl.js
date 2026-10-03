/**
 * stars.glsl.js — звёзды (точки с цветовой температурой и мерцанием)
 * и процедурный Млечный Путь на небесной сфере.
 *
 * Небесная сфера ориентирована в экваториальной системе; Млечный Путь
 * строится в галактических координатах: северный галактический полюс
 * α = 192,859°, δ = +27,128°, центр Галактики α = 266,405°, δ = −28,936° (J2000).
 */

export const starsVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScale;
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Лёгкое мерцание: у каждой звезды своя частота и фаза.
    vTwinkle = 0.82 + 0.18 * sin(uTime * (0.7 + aPhase * 2.3) + aPhase * 37.0);
    vColor = aColor;
    gl_PointSize = max(1.0, aSize * uPixelRatio * uScale);
  }
`;

export const starsFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float core = exp(-d * d * 9.0);
    float halo = exp(-d * 4.5) * 0.22;
    float a = (core + halo) * vTwinkle * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const milkyWayVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const milkyWayFragment = /* glsl */ `
  uniform float uIntensity;
  varying vec3 vDir;

  #ifndef MW_OCTAVES
    #define MW_OCTAVES 5
  #endif

  // Направления в экваториальной системе сцены: (x, z, −y) от (x, y, z) ECI.
  vec3 eqDir(float raDeg, float decDeg) {
    float ra = radians(raDeg), dec = radians(decDeg);
    vec3 e = vec3(cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec));
    return vec3(e.x, e.z, -e.y);
  }

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < MW_OCTAVES; i++) {
      s += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 ngp = eqDir(192.859, 27.128);
    vec3 gc = eqDir(266.405, -28.936);
    gc = normalize(gc - ngp * dot(gc, ngp));
    vec3 gy = cross(ngp, gc);

    float b = asin(clamp(dot(d, ngp), -1.0, 1.0));            // галактическая широта
    float l = atan(dot(d, gy), dot(d, gc));                     // галактическая долгота
    float bulge = exp(-pow(l / 0.55, 2.0));                     // балдж у центра Галактики
    float width = 0.09 + 0.10 * bulge + 0.025 * cos(l * 2.0);
    float band = exp(-pow(b / width, 2.0));
    float glow = exp(-pow(b / (width * 2.5), 2.0)) * 0.08;

    float n = fbm(d * 7.0);
    float fine = fbm(d * 23.0 + 3.1);
    // Тёмные пылевые прожилки (Большой Разлом) вдоль плоскости.
    float dust = smoothstep(0.45, 0.75, fbm(d * 11.0 + 7.7)) * exp(-pow(b / (width * 0.45), 2.0));

    float clumps = smoothstep(0.35, 0.85, n);
    float intensity = (band * (0.25 + 1.1 * clumps) * (0.6 + 0.4 * fine) + glow) * (0.35 + 1.0 * bulge);
    intensity *= 1.0 - dust * 0.75;

    vec3 warm = vec3(1.0, 0.82, 0.62);
    vec3 cool = vec3(0.62, 0.72, 1.0);
    vec3 color = mix(cool, warm, bulge * 0.8 + n * 0.2) * intensity;
    // Очень слабое общее свечение неба (зодиакальный свет и далёкие галактики).
    color += vec3(0.004, 0.005, 0.009) * (0.6 + 0.4 * fine);

    gl_FragColor = vec4(color * uIntensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
