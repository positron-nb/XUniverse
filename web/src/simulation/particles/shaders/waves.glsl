// Pressure waves shared by the physics and render passes.
// uWaveA[i] = (origin.xyz, startTime)  uWaveB[i] = (strength, extreme, -, -)
//
// Profile: a strong push at the leading edge and a gentle pull behind it, so
// matter is thrown outward, then drawn partly back — a real pressure pulse
// rather than an explosion. Amplitude falls with distance (spreading) and time.

#define WAVE_SLOTS 4
uniform vec4 uWaveA[WAVE_SLOTS];
uniform vec4 uWaveB[WAVE_SLOTS];
uniform float uClock;
uniform float uWaveSpeed;
uniform float uWaveWidth;

// xyz: radial push (signed), w: extreme share (red tint on the brightest front).
vec4 waveField(vec3 p) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < WAVE_SLOTS; i++) {
    float age = uClock - uWaveA[i].w;
    if (age < 0.0 || age > 3.2) continue;
    vec3 d = p - uWaveA[i].xyz;
    float dist = length(d) + 1e-4;
    float front = uWaveSpeed * age;
    float x = (dist - front) / (uWaveWidth * (1.0 + age * 0.6));
    float gauss = exp(-x * x);
    float amp = uWaveB[i].x * exp(-age * 0.9) / (1.0 + dist / 5.5);
    acc.xyz += d / dist * gauss * (1.0 + 0.9 * x) * amp;
    acc.w += gauss * amp * uWaveB[i].y;
  }
  return acc;
}

// Local compression of the medium by passing wavefronts (for brightness).
float waveDensity(vec3 p) {
  float c = 0.0;
  for (int i = 0; i < WAVE_SLOTS; i++) {
    float age = uClock - uWaveA[i].w;
    if (age < 0.0 || age > 3.2) continue;
    float dist = length(p - uWaveA[i].xyz) + 1e-4;
    float x = (dist - uWaveSpeed * age) / (uWaveWidth * (1.0 + age * 0.6));
    c += exp(-x * x) * max(0.0, 0.4 + x) * uWaveB[i].x * exp(-age * 0.9) / (1.0 + dist / 5.5);
  }
  return c;
}
