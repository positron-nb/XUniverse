// Final pass — everything between the HDR particle buffer and the screen:
//   1. gravitational lensing around the core (point lens, screen space)
//   2. the core: a pinprick of light + its glow scattered by humidity haze
//   3. exposure + AgX tone mapping, sRGB encoding
//   4. ground lift, lens vignette, film grain
// One pass instead of three; each step exists for a physical reason.

uniform sampler2D tDiffuse;
uniform vec2  uResolution;
uniform float uTime;
uniform vec2  uCore;        // core position, uv
uniform float uCoreDepthOk; // 1 when the core is in front of the camera
uniform float uEinstein;    // Einstein radius, fraction of screen height (∝ attractor mass)
uniform float uShadow;      // radius of the dark centre, fraction of screen height
uniform float uCoreGlow;    // haze-scattered core light
uniform float uCorePin;     // the core point itself
uniform float uGlowRadius;
uniform vec3  uGround;
uniform float uGrain;
uniform float uGrainAnimated;
uniform float uVignette;
varying vec2 vUv;

const vec3 CORE_COLOR = vec3(1.0, 0.88, 0.72);

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 toPx = vec2(aspect, 1.0);

  // ── 1. Lensing: a point mass maps image position θ to source β = θ(1 − θE²/θ²).
  vec2 d = (vUv - uCore) * toPx;
  float r = length(d) + 1e-5;
  float bend = uCoreDepthOk * uEinstein * uEinstein / (r * r);
  vec2 src = uCore + d * (1.0 - min(bend, 1.0)) / toPx;
  vec3 col = texture2D(tDiffuse, src).rgb;
  // Inside the shadow the mapping folds over itself — keep it dark instead.
  float shadow = mix(1.0, smoothstep(uShadow * 0.8, uShadow * 1.3, r), uCoreDepthOk);
  col *= shadow;

  // ── 2. The core: extremely small, restrained, and a faint haze of its light.
  float pin = exp(-(r * r) / (0.0016 * 0.0016)) * uCorePin;
  float glow = exp(-r / uGlowRadius) * uCoreGlow;
  col += CORE_COLOR * (pin + glow) * uCoreDepthOk;

  // ── 3. Tone mapping (AgX, same curve three.js uses) and sRGB encoding.
  col = AgXToneMapping(col);
  col = sRGBTransferOETF(vec4(col, 1.0)).rgb;

  // ── 4. Ground, vignette, grain (display space).
  vec2 q = (vUv - 0.5) * toPx;
  float rv = length(q);
  col += uGround * (1.0 - 0.8 * rv);
  col *= 1.0 - uVignette * smoothstep(0.3, 1.05, rv);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float n = hash(vUv * uResolution + fract(uTime * 7.13) * 311.0 * uGrainAnimated) - 0.5;
  col += n * uGrain * (0.4 + 2.4 * luma * (1.0 - luma));   // strongest in the mid-tones, like film
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
