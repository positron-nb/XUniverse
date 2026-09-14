// Integration pass (semi-implicit Euler: reads the velocity computed this step).
// Respawns grains that escaped, fell through the horizon, or finished accreting.
// w channel = age in simulation seconds (0 marks a fresh spawn for the velocity pass).

uniform sampler2D tSeed;
uniform float uDt;
uniform float uTime;
uniform vec3  uAttractor;
uniform vec3  uAxis;
uniform float uRadius;
uniform float uCompression;
uniform float uAttraction;
uniform float uHorizon;
// Frame carry: when the attractor moves or the field compresses, most matter
// moves with it at once (uCarry ≈ 0.75); the rest lags through the physics.
uniform vec3  uCarryFrom;   // attractor position before this step
uniform float uCarryScale;  // compression ratio applied this step
uniform float uCarry;

float accretionLife(vec4 seed) {
  return (5.0 + seed.w * 9.0) / (0.55 + 0.45 * uAttraction);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec3 v = texture2D(textureVelocity, uv).xyz;
  vec4 seed = texture2D(tSeed, uv);

  vec3 carried = uAttractor + (P.xyz - uCarryFrom) * uCarryScale;
  vec3 p = mix(P.xyz, carried, uCarry) + v * uDt;
  float age = P.w + uDt;

  float cls = seed.z;
  float dist = length(p - uAttractor);
  bool escaped = dist > uRadius * 4.0 || p.x != p.x;
  bool swallowed = dist < uHorizon;
  bool accreted = cls > 1.5 && age > accretionLife(seed);

  if (escaped || swallowed || accreted) {
    vec3 N = uAxis;
    vec3 ref = abs(N.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 U = normalize(cross(ref, N));
    vec3 W = cross(N, U);
    float a = 6.2831853 * hash11(seed.w * 97.1 + uTime);
    vec3 dir = cos(a) * U + sin(a) * W;
    float R = seed.x * uRadius * uCompression;
    if (cls > 0.5 && cls < 1.5) {
      // Halo re-forms anywhere on its shell.
      float z = hash11(seed.w * 41.3 + uTime * 1.7) * 2.0 - 1.0;
      p = uAttractor + (dir * sqrt(1.0 - z * z) + N * z) * R;
    } else {
      p = uAttractor + dir * R + N * seed.y * uRadius;
    }
    age = 0.0;
  }
  gl_FragColor = vec4(p, age);
}
