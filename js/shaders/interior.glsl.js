/**
 * interior.glsl.js — «крышки» разреза планеты. Каждая крышка — квадрат
 * в плоскости x = c, y = c или z = c (c — смещение плоскостей отсечения,
 * анимируется от 1 до 0 при раскрытии). Цвет зависит от радиуса:
 * кора, верхняя и нижняя мантия, жидкое внешнее ядро, твёрдое внутреннее.
 */

export const capVertex = /* glsl */ `
  uniform float uOffset;
  uniform int uAxis;          // 0 — плоскость x = c, 1 — y = c, 2 — z = c
  varying vec3 vLocal;
  void main() {
    vec3 p = position;
    if (uAxis == 0) p.x = uOffset;
    else if (uAxis == 1) p.y = uOffset;
    else p.z = uOffset;
    vLocal = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const capFragment = /* glsl */ `
  uniform float uOffset;
  uniform int uAxis;
  uniform float uTime;
  uniform float uOpacity;
  varying vec3 vLocal;

  // Границы (доли радиуса Земли).
  const float R_INNER = 0.1917;   // внутреннее ядро
  const float R_OUTER = 0.5462;   // внешнее ядро
  const float R_LOWER = 0.8964;   // граница нижней и верхней мантии (660 км)
  const float R_CRUST = 0.982;    // подошва коры (утолщена для наглядности)

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; }
    return s;
  }

  float boundary(float r, float edge, float w) {
    return 1.0 - smoothstep(0.0, w, abs(r - edge));
  }

  void main() {
    vec3 p = vLocal;
    float r = length(p);
    // Видна только часть плоскости внутри сферы и внутри вырезанного октанта.
    vec2 q = uAxis == 0 ? p.yz : (uAxis == 1 ? p.xz : p.xy);
    // Небольшое перекрытие с отсечённой поверхностью убирает щели по линии среза.
    if (r > 1.0015 || q.x < uOffset - 0.0015 || q.y < uOffset - 0.0015) discard;

    float ang = atan(q.y, q.x);
    vec2 polar = vec2(ang * 3.0, r * 9.0);
    vec3 col;
    if (r < R_INNER) {
      // Твёрдое внутреннее ядро: раскалённое добела.
      float t = r / R_INNER;
      col = mix(vec3(3.2, 3.0, 2.2), vec3(2.2, 1.6, 0.7), t * t);
      col *= 0.9 + 0.1 * fbm(q * 40.0 + uTime * 0.05);
    } else if (r < R_OUTER) {
      // Жидкое внешнее ядро: медленные конвективные потоки.
      float t = (r - R_INNER) / (R_OUTER - R_INNER);
      float flow = fbm(vec2(ang * 4.0 + uTime * 0.12, r * 14.0 - uTime * 0.2));
      col = mix(vec3(2.0, 1.15, 0.35), vec3(1.25, 0.5, 0.12), t);
      col *= 0.75 + 0.5 * flow;
    } else if (r < R_CRUST) {
      // Мантия: от тёмно-красной у ядра к оранжево-бурой у коры, ячейки конвекции.
      float t = (r - R_OUTER) / (R_CRUST - R_OUTER);
      float cells = fbm(polar + vec2(uTime * 0.02, 0.0));
      col = mix(vec3(1.05, 0.28, 0.08), vec3(0.62, 0.22, 0.1), t);
      col *= 0.8 + 0.4 * cells;
      col = mix(col, col * 0.75, boundary(r, R_LOWER, 0.004));
    } else {
      // Кора: камень.
      float n = fbm(q * 80.0);
      col = mix(vec3(0.42, 0.33, 0.26), vec3(0.58, 0.48, 0.38), n);
    }
    // Тонкие светлые линии на границах слоёв.
    float lines = max(max(boundary(r, R_INNER, 0.003), boundary(r, R_OUTER, 0.003)), boundary(r, R_CRUST, 0.002));
    col = mix(col, vec3(1.6, 1.5, 1.3), lines * 0.6);
    // Лёгкая виньетка к краю сферы.
    col *= 0.85 + 0.15 * (1.0 - r);

    gl_FragColor = vec4(col, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
