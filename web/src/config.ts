/**
 * Every tunable constant lives here, so behaviour can be re-tuned against real
 * hardware (Phase 4) without touching the simulation code.
 */

const params = new URLSearchParams(location.search);

export const CONFIG = {
  device: {
    /** Tried after ?ws=host:port and the last address that worked. */
    hosts: ['positron.local:81', '192.168.4.1:81'],
    reconnectMinMs: 1000,
    reconnectMaxMs: 8000,
    /** No frame for this long → signal lost; inputs relax toward neutral. */
    staleMs: 1500,
    /** App-level heartbeat (ping → pong) for round-trip time and dead-link detection. */
    heartbeatMs: 2000,
    heartbeatTimeoutMs: 6000,
  },

  quality: {
    /**
     * Particle texture side: 256² = 65k (default), ?q=medium → 37k, ?q=low → 16k.
     * Measured on a Radeon 780M iGPU at 1080p: 65k ≈ 1.8 ms/frame, 37k ≈ 1.6 ms.
     */
    textureSize: params.get('q') === 'low' ? 128 : params.get('q') === 'medium' ? 192 : 256,
    maxPixelRatio: 2,
  },

  // ─── Sensor ranges & filters ─────────────────────────────────────────────
  adcMax: 4095,

  light: {
    /** LDR divider: counts → log-ish illumination. */
    darkCounts: 120,
    brightCounts: 3600,
    emaTau: 0.8,
  },

  distance: {
    minCm: 2,
    maxCm: 400,
    /** Nearest meaningful hand distance and the distance where the field is fully open. */
    nearCm: 5,
    farCm: 90,
    // The firmware already applies a median-of-3; keep browser filtering light.
    medianWindow: 3,
    emaTau: 0.06,
    /** Keep the last valid reading this long before relaxing to "absent". */
    holdMs: 600,
  },

  mpu: {
    deadZoneDeg: 3,
    maxTiltDeg: 35,
    // Roll/pitch arrive already fused at 200 Hz on the board; just take the edge off.
    emaTau: 0.03,
    /** Complementary filter blend when the device doesn't send roll/pitch. */
    gyroWeight: 0.96,
    shakeThresholdG: 0.55,
    shakeCooldownMs: 600,
  },

  sound: {
    /** Fallback browser-side clap detector (device normally sends clap events). */
    floorTau: 3,
    thresholdOverFloor: 0.22,
    cooldownMs: 280,
  },

  env: {
    tempMin: 16,
    tempMax: 36,
    humMin: 20,
    humMax: 85,
    /** Pressure is read relative to a slow baseline: ±span hPa → full effect. */
    pressureSpan: 0.5,
    pressureBaselineTau: 240,
    /** DHT11 local-probe baselines (breath / hand warmth detection). */
    dhtBaselineTau: 45,
    breathHumSpan: 12,
    breathTempSpan: 3,
  },

  // ─── Response tiers (seconds) ────────────────────────────────────────────
  // Fast sensors drive fast events, slow sensors drive slow evolution. This is
  // what keeps the scene from twitching: the environment drifts, gestures react.
  response: {
    fast: {
      /** Tilt → attractor: a mass on a spring — quick, with a hint of weight. */
      tiltHz: 1.5,
      tiltDamping: 0.85,
      twist: 0.12,
      sound: 0.1,
      axis: 0.25,
    },
    medium: {
      energy: 0.5,
      compression: 0.2,
      illumination: 0.6,
      convection: 1.0,
    },
    slow: {
      thermal: 9,
      humidity: 10,
      pressure: 12,
      /** Heat build-up from sustained energy (thermal inertia of the field). */
      heatUp: 25,
      heatDown: 45,
    },
  },

  history: {
    /** Samples per second and seconds kept for every tracked channel. */
    rateHz: 2,
    seconds: 120,
  },

  field: {
    /** World-unit radius of the neutral disk. */
    radius: 9,
    /** Compression at hand-close and with nothing in range (nonlinear between). */
    compressionNear: 0.38,
    compressionFar: 1.0,
    /** Radial well stiffness at far / near. */
    attractionFar: 1.0,
    attractionNear: 3.0,
    /** Attractor displacement at max tilt, world units. */
    tiltTravel: 4.2,
    /** Share of forward/back tilt that moves the field in depth (toward the viewer). */
    tiltDepth: 0.65,
    /** Orbital-plane lean as a fraction of physical tilt. */
    axisLean: 0.55,
  },

  waves: {
    slots: 4,
    speed: 11,
    width: 1.6,
    /** Strength above which the wavefront carries the red "extreme" tint. */
    extreme: 0.85,
    /** Spontaneous micro-events per second at full overdrive. */
    spontaneousRate: 0.45,
  },

  camera: {
    distance: 26,
    fov: 38,
    driftSpeed: 0.012, // rad/s azimuth
    parallax: 0.05, // rad at screen edge
    damping: 2.5,
  },
} as const;

export type Config = typeof CONFIG;
