// Physics pass: dust grains in an orbiting gas.
//
// Every grain feels
//   gravity  a_g  — radial well toward its preferred orbit, plane confinement,
//                   tilt pull. Mass-independent, like real gravity.
//   drag     (u − v)/τ — coupling to the local gas flow u (orbit + turbulence +
//                   convection). τ grows with grain size: fine dust follows the
//                   flow, large motes lag, overshoot and wobble. This is what
//                   keeps neighbouring particles from moving in lock-step.
//   pressure waves (impulses from sound / shake).
//
// Injected by GPUComputationRenderer: resolution, texturePosition, textureVelocity.

uniform sampler2D tSeed;   // x: home radius  y: home height  z: class (0 disk, 1 halo, 2 accretion)  w: random
uniform float uDt;
uniform float uTime;       // simulation time (scaled by energy)
uniform vec3  uAttractor;
uniform vec3  uAxis;
uniform float uRadius;
uniform float uCompression;
uniform float uAttraction;
uniform float uOrbit;
uniform float uSpin;
uniform float uTurbulence;
uniform float uDrag;
uniform float uConvection;
uniform float uThermal;
uniform float uPattern;    // spiral pattern angle
uniform float uHorizon;    // radius of the dark centre
uniform vec3  uBodyForce;  // tilt "gravity"

float accretionLife(vec4 seed) {
  return (5.0 + seed.w * 9.0) / (0.55 + 0.45 * uAttraction);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec4 V = texture2D(textureVelocity, uv);
  vec4 seed = texture2D(tSeed, uv);
  vec3 p = P.xyz;
  vec3 v = V.xyz;

  // ── Per-grain constants (derived from the seed, stable for its lifetime) ──
  float grain = fract(seed.w * 7.31);            // same value sets the rendered size
  float g3 = grain * grain * grain;
  float tau = 0.45 + 1.4 * g3;                    // gas-coupling response time, s
  float stiff = 0.8 + 0.4 * fract(seed.w * 91.7 + seed.x * 13.1);
  float orbitK = 0.94 + 0.12 * fract(seed.w * 57.3 + 0.37);

  // ── Local frame around the attractor ──
  vec3 N = uAxis;
  vec3 d = p - uAttractor;
  float h = dot(d, N);
  vec3 q = d - h * N;
  float rho = max(length(q), 1e-3);
  vec3 er = q / rho;
  vec3 et = cross(N, er);
  float rr = max(length(d), 1e-3);

  float R = seed.x * uRadius * uCompression;
  float cls = seed.z;

  // Kepler-like orbital speed: inner matter moves faster, so compressing the
  // field spins it up — angular momentum conservation.
  float vKepler = uOrbit * 2.1 * orbitK * sqrt(uRadius * 0.5 / max(rho, 0.9 * uCompression + 0.3));
  float vt = vKepler + uSpin * 2.4;

  // A freshly (re)spawned grain enters already orbiting, so nothing stalls.
  if (P.w == 0.0) v = et * vt * (cls > 0.5 && cls < 1.5 ? 0.45 * rho / rr : 1.0);

  vec3 a = vec3(0.0);   // gravitational accelerations
  vec3 u = vec3(0.0);   // gas velocity at this point

  // Gravity supplies the centripetal pull an orbit at speed vt needs (v²/ρ);
  // the springs below only correct deviations from the preferred radius.
  // Without this, orbiting matter drifts outward and the centre empties.
  float centripetal = vt * vt / max(rho, 0.35);

  if (cls < 0.5) {
    // ── Disk ──
    a -= (centripetal + uAttraction * 1.6 * stiff * (rho - R)) * er;
    float thick = seed.y * uRadius * (0.5 + 0.5 * uCompression);
    a -= uAttraction * 2.6 * stiff * (h - thick) * N;
    // Density wave: a slowly rotating two-armed spiral modulates the gas speed,
    // so matter crowds into arms instead of the arms winding up.
    vec3 ref = abs(N.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 U = normalize(cross(ref, N));
    vec3 W = cross(N, U);
    float theta = atan(dot(q, W), dot(q, U));
    float phase = 2.0 * (theta - uPattern) - 3.2 * log(rho / uRadius + 0.05);
    u += et * (vt - sin(phase) * 0.09 * vKepler);
  } else if (cls < 1.5) {
    // ── Halo: a loose spherical atmosphere, weakly coupled. It rotates slower
    // toward its poles (speed ∝ ρ/r), so nothing is flung onto the axis.
    float polar = 0.45 * rho / rr;
    float vh = vt * polar;
    a -= vh * vh / max(rho, 0.35) * er;
    a -= uAttraction * 0.55 * stiff * (rr - R) * (d / rr);
    u += et * vh;
    tau *= 1.8;
  } else {
    // ── Accretion: matter spiralling inward, faster and hotter near the core ──
    float t = clamp(P.w / accretionLife(seed), 0.0, 1.0);
    float target = mix(R, uHorizon * 1.15, pow(t, 0.8));
    a -= (centripetal + uAttraction * 1.8 * stiff * (rho - target)) * er;
    a -= uAttraction * 3.2 * h * N;
    u += et * vt - er * vKepler * 0.12 * (0.4 + t);
  }

  // Turbulence and convection are properties of the gas, not forces on grains.
  vec3 np = p * 0.11 + vec3(0.0, uTime * 0.035 * (0.7 + 0.6 * uThermal), 0.0);
  u += curlNoise(np) * uTurbulence * 1.3;
  u += N * uConvection * 1.9 * exp(-rho * rho / (0.3 * uRadius * uRadius));

  a += (u - v) * (uDrag / tau);

  // Tilt: a uniform pull the wells resist → the field bends before it follows.
  a += uBodyForce;

  // Pressure waves: heavier grains are pushed less (inertia).
  a += waveField(p).xyz * 42.0 / (0.75 + 0.6 * g3);

  v += a * uDt;
  float sp = length(v);
  if (sp > 30.0) v *= 30.0 / sp;
  gl_FragColor = vec4(v, V.w);
}
