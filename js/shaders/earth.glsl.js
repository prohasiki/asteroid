/**
 * earth.glsl.js — шейдер поверхности Земли.
 *
 *  • день/ночь по терминатору с мягкой сумеречной полосой;
 *  • ослабление и покраснение солнечного света в атмосфере (модель О'Нила);
 *  • огни городов только на ночной стороне, гаснущие к терминатору;
 *  • зеркальный блик Солнца на океанах (GGX) по маске specular;
 *  • рельеф по normal map в касательном базисе «восток — север — нормаль»;
 *  • мягкие тени облаков (выборка, смещённая к Солнцу);
 *  • голубой край диска (Френель + рассеяние);
 *  • оверлеи: сетка, экватор и тропики, часовые пояса, климатические пояса.
 */
import { atmosphereCommon } from './atmosphere.glsl.js';

export const earthVertex = /* glsl */ `
  #include <clipping_planes_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vTangentW;
  varying vec3 vPosW;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vPosW = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    // Касательная «на восток»: производная позиции по долготе.
    vec3 e = vec3(position.z, 0.0, -position.x);
    float el = length(e);
    vec3 east = el > 1e-6 ? e / el : vec3(1.0, 0.0, 0.0);
    vTangentW = normalize(mat3(modelMatrix) * east);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
  }
`;

export const earthFragment = /* glsl */ `
  ${atmosphereCommon}
  #include <clipping_planes_pars_fragment>

  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform sampler2D uSpecMap;
  uniform sampler2D uNormalMap;
  uniform sampler2D uCloudMap;
  uniform float uNormalScale;   // сила рельефа
  uniform float uCloudShift;    // сдвиг текстуры облаков относительно поверхности (доли u)
  uniform float uCloudShadow;   // 0..1 — сила теней облаков
  uniform float uCityLights;    // яркость огней городов
  uniform float uSpecular;      // сила блика океана
  uniform float uSunPower;      // интенсивность прямого солнечного света
  uniform float uHaze;          // сила атмосферной дымки над диском
  uniform float uRim;           // голубая кайма по краю диска
  uniform float uGrid;          // оверлеи (0..1, плавно анимируются)
  uniform float uTropics;
  uniform float uTimeZones;
  uniform float uClimate;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vTangentW;
  varying vec3 vPosW;

  const float PI = 3.141592653589793;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  float D_GGX(float NdH, float a) {
    float a2 = a * a;
    float d = NdH * NdH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
  }

  float V_SmithGGX(float NdV, float NdL, float a) {
    float a2 = a * a;
    float gv = NdL * sqrt(NdV * NdV * (1.0 - a2) + a2);
    float gl = NdV * sqrt(NdL * NdL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-5);
  }

  // Сглаженная линия сетки: расстояние до ближайшего кратного spacing.
  float gridLine(float coord, float spacing, float width) {
    float d = abs(fract(coord / spacing + 0.5) - 0.5) * spacing;
    float w = fwidth(coord) * width;
    return 1.0 - smoothstep(w * 0.5, w * 1.5, d);
  }

  float lineAt(float coord, float value, float width) {
    float d = abs(coord - value);
    float w = fwidth(coord) * width;
    return 1.0 - smoothstep(w * 0.5, w * 1.5, d);
  }

  // Климатические пояса по Б. П. Алисову (упрощённо, по широте).
  vec3 climateColor(float a) {
    vec3 c = vec3(0.10, 0.62, 0.30);
    c = mix(c, vec3(0.55, 0.80, 0.25), smoothstep(5.0, 7.0, a));
    c = mix(c, vec3(0.98, 0.72, 0.15), smoothstep(17.0, 19.0, a));
    c = mix(c, vec3(1.00, 0.45, 0.25), smoothstep(29.0, 31.0, a));
    c = mix(c, vec3(0.20, 0.72, 0.62), smoothstep(39.0, 41.0, a));
    c = mix(c, vec3(0.35, 0.60, 0.95), smoothstep(61.0, 63.0, a));
    c = mix(c, vec3(0.90, 0.96, 1.00), smoothstep(69.0, 71.0, a));
    return c;
  }

  void main() {
    #include <clipping_planes_fragment>

    vec3 N = normalize(vNormalW);
    vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
    vec3 B = cross(N, T); // направление на север
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vPosW);

    // Рельеф: normal map в базисе (восток, север, нормаль).
    vec3 tn = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
    tn.xy *= uNormalScale;
    vec3 Nm = normalize(T * tn.x + B * tn.y + N * max(tn.z, 0.2));

    float NdL = dot(N, L);
    float NmdL = dot(Nm, L);
    float NdV = max(dot(N, V), 1e-3);

    float latDeg = vUv.y * 180.0 - 90.0;
    float lonDeg = vUv.x * 360.0 - 180.0;
    float cosLat = max(cos(radians(latDeg)), 0.05);

    // Тени облаков: облако, закрывающее Солнце, сдвинуто к Солнцу по касательной.
    vec2 sunT = vec2(dot(L, T), dot(L, B));
    vec2 offs = sunT * (0.012 / max(NdL, 0.2));
    vec2 shadowUv = vec2(vUv.x + uCloudShift + offs.x / (2.0 * PI * cosLat), clamp(vUv.y + offs.y / PI, 0.0, 1.0));
    vec4 cs = texture2D(uCloudMap, shadowUv);
    float cloudShadow = 1.0 - uCloudShadow * 0.6 * smoothstep(0.08, 0.9, min(luma(cs.rgb), cs.a));
    vec4 ca = texture2D(uCloudMap, vec2(vUv.x + uCloudShift, vUv.y));
    float cloudAbove = smoothstep(0.08, 0.9, min(luma(ca.rgb), ca.a)) * step(0.001, uCloudShadow);

    vec3 albedo = texture2D(uDayMap, vUv).rgb;
    float ocean = texture2D(uSpecMap, vUv).r;

    // Атмосфера: добавочное рассеяние и ослабление солнечного света.
    vec3 inscatter, transmit;
    groundScatter(vPosW, inscatter, transmit);

    // Прямой свет: рельеф не освещает поверхность за терминатором.
    float lambert = max(NmdL, 0.0) * smoothstep(-0.03, 0.1, NdL);
    vec3 direct = albedo * lambert * cloudShadow * transmit * uSunPower;

    // Сумеречная полоса: рассеянный свет неба тёплого оттенка у терминатора.
    float twilight = smoothstep(-0.14, 0.0, NdL) * (1.0 - smoothstep(0.0, 0.14, NdL));
    direct += albedo * vec3(0.9, 0.42, 0.22) * twilight * 0.08 * uSunPower;

    // Солнечный блик на воде (GGX), суша блика не даёт.
    vec3 H = normalize(L + V);
    float NdH = max(dot(N, H), 0.0);
    float VdH = max(dot(V, H), 0.0);
    float rough = 0.14;
    float D = D_GGX(NdH, rough);
    float Vis = V_SmithGGX(NdV, max(NdL, 0.0), rough);
    float F = 0.02 + 0.98 * pow(1.0 - VdH, 5.0);
    vec3 glint = vec3(D * Vis * F * max(NdL, 0.0)) * ocean * uSpecular * cloudShadow * transmit * uSunPower;

    // Огни городов: только ночью, тёплые, с затуханием к терминатору и под облаками.
    vec3 lightsTex = texture2D(uNightMap, vUv).rgb;
    // Порог отсекает тусклый фон суши, если он есть в ночной карте.
    lightsTex *= smoothstep(0.012, 0.07, luma(lightsTex));
    float night = 1.0 - smoothstep(-0.16, 0.06, NdL);
    vec3 lights = pow(lightsTex, vec3(1.1)) * vec3(1.0, 0.76, 0.48) * night * (1.0 - cloudAbove * 0.65) * uCityLights;

    // Едва заметная подсветка ночной стороны (свет Луны и звёзд).
    vec3 ambient = albedo * vec3(0.010, 0.014, 0.024) * (1.0 - smoothstep(-0.2, 0.1, NdL));

    vec3 color = direct + glint + lights + ambient + inscatter * uHaze;

    // Эффект Френеля: к краю диска планета голубеет (только на освещённой стороне).
    float fres = pow(1.0 - NdV, 4.0);
    color += vec3(0.28, 0.55, 1.0) * fres * smoothstep(-0.25, 0.45, NdL) * uRim;

    // --- Оверлеи ---
    if (uClimate > 0.001) {
      vec3 cz = climateColor(abs(latDeg));
      float vis = 0.3 + 0.7 * smoothstep(-0.25, 0.25, NdL);
      color = mix(color, cz * vis * 0.9, uClimate * mix(0.22, 0.5, 1.0 - ocean));
    }
    if (uTimeZones > 0.001) {
      float zone = floor((lonDeg + 7.5) / 15.0);
      float odd = mod(zone, 2.0);
      color = mix(color, color * (odd > 0.5 ? 1.35 : 0.8) + vec3(0.01, 0.02, 0.05) * odd, uTimeZones * 0.6);
      color += vec3(1.0, 0.68, 0.25) * gridLine(lonDeg + 7.5, 15.0, 1.3) * uTimeZones * 0.7;
    }
    if (uGrid > 0.001) {
      float g = max(gridLine(latDeg, 15.0, 1.0), gridLine(lonDeg, 15.0, 1.0));
      color += vec3(0.55, 0.8, 1.0) * g * uGrid * 0.5;
    }
    if (uTropics > 0.001) {
      float eq = lineAt(latDeg, 0.0, 2.4);
      float tr = max(lineAt(latDeg, 23.44, 1.9), lineAt(latDeg, -23.44, 1.9));
      float pc = max(lineAt(latDeg, 66.56, 1.9), lineAt(latDeg, -66.56, 1.9));
      color += (vec3(1.0, 0.35, 0.25) * eq + vec3(1.0, 0.82, 0.25) * tr + vec3(0.35, 0.9, 1.0) * pc) * uTropics;
    }

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
