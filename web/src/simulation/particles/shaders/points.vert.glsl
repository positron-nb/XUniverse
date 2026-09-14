// Render pass: particles as lit dust.
//  • Light: forward scattering of one key light (Henyey–Greenstein) plus the
//    core itself as a softened inverse-square source — inner matter is lit by
//    the centre, which is what gives the centre its visual weight.
//  • Depth: perspective size, a real circle of confusion (energy-conserving),
//    atmospheric extinction behind focus, a fade for grains passing the lens,
//    and a radial falloff so the periphery dissolves into darkness.

attribute vec2 reference;

uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tSeed;
uniform float uPixelScale;   // px per world unit at depth 1
uniform float uSize;
uniform float uFocus;
uniform float uAperture;
uniform vec3  uLightDir;     // direction light travels
uniform float uKeyLight;
uniform float uAmbient;
uniform float uCoreLight;    // core luminosity (energy, mass)
uniform float uDensity;
uniform float uHaze;
uniform float uThermal;
uniform float uEnergy;
uniform float uReveal;
uniform vec3  uAttractor;
uniform float uRadius;
uniform float uCompression;
uniform float uGain;

varying vec3 vColor;
varying float vSharp;

const vec3 DUST_COOL = vec3(0.78, 0.80, 0.84);
const vec3 DUST_WARM = vec3(0.90, 0.84, 0.76);
const vec3 CORE_LIT  = vec3(1.00, 0.86, 0.68);
const vec3 AMBER     = vec3(0.79, 0.57, 0.29);
const vec3 ATMOS     = vec3(0.36, 0.44, 0.53);
const vec3 EXTREME   = vec3(0.71, 0.28, 0.23);

float phaseHG(float cosT, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * cosT, 1.5));
}

void main() {
  vec4 P = texture2D(tPos, reference);
  vec3 vel = texture2D(tVel, reference).xyz;
  vec4 seed = texture2D(tSeed, reference);

  vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.1);

  // ── Size & focus ──
  float grain = fract(seed.w * 7.31);
  float size = uSize * (0.55 + 1.6 * grain * grain * grain);
  float px = size * uPixelScale / depth;
  float coc = min(abs(depth - uFocus) * uAperture * uPixelScale / depth, 22.0);
  float s = max(px, 1.0);
  float total = sqrt(s * s + coc * coc);
  gl_PointSize = total + 1.0;
  vSharp = s / total;
  float energy = (px * px) / (total * total);   // defocused grains spread the same light

  // ── Light ──
  vec3 toCam = normalize(cameraPosition - P.xyz);
  float key = uKeyLight * (phaseHG(dot(uLightDir, toCam), 0.55) * 6.0 + 0.25);
  float rr = length(P.xyz - uAttractor);
  float rc = uRadius * uCompression * 0.26;
  // A compressed core already packs more grains per pixel; per-grain core light
  // is reduced accordingly so dense matter stays grainy instead of burning to white.
  float core = uCoreLight * rc * rc / (rr * rr + rc * rc) * (0.4 + 0.6 * uCompression);
  // Compressed matter at a passing wavefront scatters more.
  float wave = waveDensity(P.xyz);
  float light = (key + core + uAmbient) * (1.0 + wave * 1.6);

  // ── Colour: temperature, core light, kinetic energy, atmosphere, extremes ──
  vec3 col = mix(DUST_COOL, DUST_WARM, uThermal);
  col = mix(col, CORE_LIT, clamp(core / (key + core + 1e-3), 0.0, 1.0) * 0.55);
  float speed = length(vel);
  col = mix(col, AMBER, smoothstep(2.5, 8.0, speed) * (0.12 + 0.3 * uEnergy));
  float rDist = rr / uRadius;
  float outer = seed.z > 0.5 && seed.z < 1.5 ? 1.0 : smoothstep(0.9, 1.6, rDist);
  col = mix(col, ATMOS, outer * (0.35 + 0.35 * uHaze));
  col = mix(col, EXTREME, clamp(waveField(P.xyz).w * 1.6, 0.0, 0.7));

  // ── Depth & falloff ──
  float fog = exp(-max(depth - uFocus * 0.8, 0.0) * uHaze * 0.06);   // humidity extinction
  col = mix(ATMOS * 0.35, col, fog);
  float periphery = 1.0 / (1.0 + pow(rDist / 1.25, 4.0));          // dissolve into darkness
  float nearLens = smoothstep(0.16, 0.5, depth / uFocus);           // grains brushing the lens
  float gate = smoothstep(uDensity + 0.04, uDensity - 0.04, seed.w); // humidity → visible matter

  vColor = col * light * energy * fog * periphery * nearLens * gate * uReveal * uGain;

  // Grains that contribute no light (humidity-gated, faded at the lens or the
  // periphery) are culled before rasterisation instead of drawing empty quads.
  if (max(vColor.r, max(vColor.g, vColor.b)) < 2e-4) {
    gl_PointSize = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
}
