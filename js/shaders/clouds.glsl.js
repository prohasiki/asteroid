/**
 * clouds.glsl.js — облачный слой на отдельной сфере.
 * Днём облака белые, у терминатора — розово-оранжевые, ночью почти
 * невидимы, но снизу слегка подсвечены огнями городов.
 */

export const cloudsVertex = /* glsl */ `
  #include <clipping_planes_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vPosW = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
  }
`;

export const cloudsFragment = /* glsl */ `
  #include <clipping_planes_pars_fragment>
  uniform sampler2D uCloudMap;
  uniform sampler2D uNightMap;
  uniform vec3 uSunDir;
  uniform float uOpacity;
  uniform float uGroundShift;   // сдвиг u от облаков к поверхности (для огней под облаками)
  uniform float uCityLights;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    #include <clipping_planes_fragment>
    vec4 ct = texture2D(uCloudMap, vUv);
    // Покрытие: работает и для PNG с альфа-каналом, и для серых карт.
    float c = smoothstep(0.08, 0.92, min(dot(ct.rgb, vec3(0.2126, 0.7152, 0.0722)), ct.a));
    if (c < 0.004) discard;

    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vPosW);
    float NdL = dot(N, L);

    float lit = smoothstep(-0.16, 0.2, NdL);
    vec3 sunCol = mix(vec3(1.0, 0.42, 0.24), vec3(1.0, 0.98, 0.96), smoothstep(-0.04, 0.22, NdL));
    float diffuse = clamp(NdL * 0.55 + 0.45, 0.0, 1.0) * lit;
    // Плотные облака чуть темнее снизу — грубая аппроксимация самозатенения.
    vec3 col = sunCol * diffuse * mix(1.08, 0.82, c * c);

    // Ночью облака подсвечены снизу огнями городов.
    vec3 lights = texture2D(uNightMap, vec2(vUv.x + uGroundShift, vUv.y)).rgb;
    float night = 1.0 - smoothstep(-0.2, 0.04, NdL);
    col += lights * vec3(1.0, 0.72, 0.45) * night * 0.55 * uCityLights;
    col += vec3(0.010, 0.014, 0.024) * night;

    float rim = 1.0 - max(dot(N, V), 0.0);
    float alpha = c * uOpacity * (1.0 - 0.45 * pow(rim, 3.0));
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
