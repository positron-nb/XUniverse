varying vec3 vColor;
varying float vSharp;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  // In focus: a soft grain. Out of focus: a flat disc with a faint rim, like a lens.
  float grain = exp(-r2 * 4.0) * 1.25;
  float r = sqrt(r2);
  float bokeh = smoothstep(1.0, 0.82, r) * (0.8 + 0.25 * r2);
  float shape = mix(bokeh, grain, vSharp);
  gl_FragColor = vec4(vColor * shape, 1.0);
}
