/**
 * atmosphere.glsl.js — рассеяние Рэлея и Ми по упрощённой модели
 * Шона О'Нила (GPU Gems 2, гл. 16, «Accurate Atmospheric Scattering»).
 *
 * Модель рассчитана на толщину атмосферы 2,5 % радиуса и масштаб высоты
 * 25 % толщины; функция scaleFn — его полиномиальная аппроксимация
 * оптической глубины. Расчёт выполняется во фрагментном шейдере
 * (а не в вершинном, как в оригинале) — это даёт гладкий ореол.
 *
 * Центр планеты — начало мировых координат.
 */

/** Общие униформы и функции: используются оболочкой неба и шейдером поверхности. */
export const atmosphereCommon = /* glsl */ `
  uniform vec3 uSunDir;          // единичный вектор на Солнце (мировые координаты)
  uniform float uInnerRadius;    // радиус планеты (1.0)
  uniform float uOuterRadius;    // радиус верхней границы атмосферы (1.025)
  uniform vec3 uInvWavelength;   // 1 / λ^4 для R, G, B
  uniform float uKrESun;         // Kr * ESun
  uniform float uKmESun;         // Km * ESun
  uniform float uKr4PI;          // Kr * 4π
  uniform float uKm4PI;          // Km * 4π
  uniform float uScale;          // 1 / (outer - inner)
  uniform float uScaleDepth;     // 0.25
  uniform float uScaleOverScaleDepth;

  #ifndef ATMO_SAMPLES
    #define ATMO_SAMPLES 4
  #endif

  float scaleFn(float fCos) {
    float x = 1.0 - fCos;
    return uScaleDepth * exp(-0.00287 + x * (0.459 + x * (3.83 + x * (-6.80 + x * 5.25))));
  }

  // Ближняя точка пересечения луча с верхней границей атмосферы (0, если камера внутри).
  float atmoNear(vec3 ro, vec3 rd) {
    float B = 2.0 * dot(ro, rd);
    float C = dot(ro, ro) - uOuterRadius * uOuterRadius;
    float det = max(0.0, B * B - 4.0 * C);
    return max(0.0, 0.5 * (-B - sqrt(det)));
  }

  // Рассеяние на пути «камера → точка поверхности» (GroundFromSpace).
  // inscatter — добавочный свет атмосферы, transmit — ослабление солнечного света.
  void groundScatter(vec3 pos, out vec3 inscatter, out vec3 transmit) {
    vec3 cam = cameraPosition;
    vec3 ray = pos - cam;
    float far = length(ray);
    ray /= far;
    float near = atmoNear(cam, ray);
    vec3 start = cam + ray * near;
    far = max(far - near, 0.0);

    vec3 n = normalize(pos);
    float topDepth = exp(-1.0 / uScaleDepth);
    float camScale = scaleFn(max(dot(-ray, n), 0.0));
    float lightScale = scaleFn(dot(uSunDir, n));
    float camOffset = topDepth * camScale;
    float temp = lightScale + camScale;

    float sampleLength = far / float(ATMO_SAMPLES);
    float scaledLength = sampleLength * uScale;
    vec3 sampleRay = ray * sampleLength;
    vec3 p = start + sampleRay * 0.5;
    vec3 front = vec3(0.0);
    vec3 att = vec3(1.0);
    for (int i = 0; i < ATMO_SAMPLES; i++) {
      float h = length(p);
      float depth = exp(uScaleOverScaleDepth * (uInnerRadius - h));
      float scatter = depth * temp - camOffset;
      att = exp(-clamp(scatter, 0.0, 60.0) * (uInvWavelength * uKr4PI + uKm4PI));
      front += att * (depth * scaledLength);
      p += sampleRay;
    }
    inscatter = front * (uInvWavelength * uKrESun + uKmESun);
    transmit = att;
  }

  // Рассеяние вдоль луча от камеры до точки pos на оболочке неба (SkyFromSpace).
  // rayleigh / mie — цвета до умножения на фазовые функции.
  void skyScatter(vec3 pos, out vec3 rayleigh, out vec3 mie) {
    vec3 cam = cameraPosition;
    vec3 ray = pos - cam;
    float far = length(ray);
    ray /= far;
    float near = atmoNear(cam, ray);
    vec3 start = cam + ray * near;
    far = max(far - near, 0.0);

    float startHeight = length(start);
    float startAngle = dot(ray, start) / startHeight;
    float startDepth = exp(uScaleOverScaleDepth * (uInnerRadius - startHeight));
    float startOffset = startDepth * scaleFn(startAngle);

    float sampleLength = far / float(ATMO_SAMPLES);
    float scaledLength = sampleLength * uScale;
    vec3 sampleRay = ray * sampleLength;
    vec3 p = start + sampleRay * 0.5;
    vec3 front = vec3(0.0);
    for (int i = 0; i < ATMO_SAMPLES; i++) {
      float h = length(p);
      float depth = exp(uScaleOverScaleDepth * (uInnerRadius - h));
      float lightAngle = dot(uSunDir, p) / h;
      float cameraAngle = dot(ray, p) / h;
      float scatter = startOffset + depth * (scaleFn(lightAngle) - scaleFn(cameraAngle));
      vec3 att = exp(-clamp(scatter, 0.0, 60.0) * (uInvWavelength * uKr4PI + uKm4PI));
      front += att * (depth * scaledLength);
      p += sampleRay;
    }
    rayleigh = front * (uInvWavelength * uKrESun);
    mie = front * uKmESun;
  }
`;

export const atmosphereVertex = /* glsl */ `
  #include <clipping_planes_pars_vertex>
  varying vec3 vPosW;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vPosW = worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
  }
`;

export const atmosphereFragment = /* glsl */ `
  ${atmosphereCommon}
  #include <clipping_planes_pars_fragment>
  uniform float uMieG;         // асимметрия рассеяния Ми (0.95)
  uniform float uIntensity;    // общий множитель яркости ореола
  varying vec3 vPosW;

  void main() {
    #include <clipping_planes_fragment>
    vec3 rayleigh, mie;
    skyScatter(vPosW, rayleigh, mie);

    vec3 viewDir = normalize(vPosW - cameraPosition);
    float mu = dot(uSunDir, viewDir);
    float g = uMieG, g2 = g * g;
    float rayleighPhase = 0.75 * (1.0 + mu * mu);
    float miePhase = 1.5 * ((1.0 - g2) / (2.0 + g2)) * (1.0 + mu * mu) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);

    vec3 color = (rayleighPhase * rayleigh + miePhase * mie) * uIntensity;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
