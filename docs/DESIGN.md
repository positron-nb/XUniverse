# POSITRON — Sensor Universe · Design Specification

> Physical world → sensors → ESP32 → Wi-Fi/WebSocket → browser → GPU particle simulation.
> Every visual behaviour must trace back to a sensor, a physical parameter, or the simulation's own dynamics.

---

## 1. System architecture

```
 ┌──────────────────────── PHYSICAL ─────────────────────────┐
 │ MPU6050  BME280        (I²C bus, 3.3 V)                    │
 │ HC-SR04  (TRIG out, ECHO via divider)                      │
 │ POT  LDR  MIC          (ADC1 only — ADC2 dies with Wi-Fi)  │
 │ DHT11                  (1-wire style, 3.3 V)               │
 └──────────────┬─────────────────────────────────────────────┘
                ▼
 ┌──────────────────────── ESP32 FIRMWARE ────────────────────┐
 │ acquisition tasks (own rates)                              │
 │   MPU 200 Hz → complementary filter → roll/pitch, shake    │
 │   MIC 8 kHz window → envelope, peak, clap events (seq'd)   │
 │   HC-SR04 20 Hz → reject/median                            │
 │   POT/LDR 50 Hz → oversample + EMA                         │
 │   BME280 2 Hz · DHT11 0.5 Hz                               │
 │ snapshot → JSON frame @ 30 Hz → WebSocket server :81       │
 └──────────────┬─────────────────────────────────────────────┘
                ▼  ws://positron.local:81   (fallback AP "POSITRON")
 ┌──────────────────────── BROWSER ───────────────────────────┐
 │ SensorHub ── LIVE: WebSocketSource | SIM: SimulatedSource  │
 │     │ raw packets (identical schema from both)             │
 │     ▼                                                      │
 │ Normalizer  (calibration, filters, event dedupe)           │
 │     ▼                                                      │
 │ FieldState  (sensor fusion → one physical state, damped    │
 │              per channel at render rate)                   │
 │     ▼                         ▼                            │
 │ WaveSystem (impulses)    ModeBlender (calm/disturbance/…)  │
 │     ▼                                                      │
 │ ParticleField — GPGPU: velocity + position float textures  │
 │     ▼                                                      │
 │ Points shader (scattering light, DOF, haze) → PostChain    │
 │ (HDR → AgX tone map → grain/vignette) → screen             │
 │ UI: Intro · Overlay typography · DebugPanel                │
 └────────────────────────────────────────────────────────────┘
```

Sensor rate (30 Hz) and render rate (60 Hz+) are decoupled: packets update *targets*; the
render loop eases toward them with per-channel time constants.

---

## 2. Sensor → visual mapping

| Sensor | Signal | Internal state | Simulation behaviour | Visual result |
|---|---|---|---|---|
| **MPU6050 accel** | roll / pitch (complementary filter, ±3° dead zone, clamp 35°) | `gravity` vector | Attractor centre is displaced in the camera's screen plane; a weak uniform body force pulls the field the same way | Tilt left → the whole field slides & bends left, orbits become eccentric |
| **MPU6050 accel+gyro** | orientation | `axis` | Orbital plane normal leans with the board | The disk visibly re-orients like a gyroscope |
| **MPU6050 gyro z** | twist rate | `spin` | Adds angular momentum to orbital target speed | Twisting the board spins the field up / reverses it briefly |
| **MPU6050** | shake (|a|−1 g high-passed, event) | `impulse` | Off-centre pressure wave + short turbulence burst | Field shudders from the side you shook |
| **HC-SR04** | distance 2–400 cm, median-5, hold/timeout | `compression`, `attraction` | Preferred orbital radii scaled 0.42×–1.25× (nonlinear); radial spring stiffens as you approach | Hand close → field contracts into a dense bright core; hand away → it breathes out |
| **Potentiometer** | 0–1 with hysteresis | `energy` → timeScale, orbit, turbulence, event rate (separate curves) | 0 % near-frozen drift · 50 % natural · 100 % turbulent with spontaneous micro-waves | Feels like turning up the temperature of the universe |
| **LDR** | log-mapped light 0–1 | `illumination` | Key-light intensity for forward-scattering on dust, exposure, background lift, slight calm in dark | Dark room: only particles back-lit by the virtual light show; bright room: the field fills in |
| **Sound** | envelope level + clap events (seq, strength) | `impulse` | Spherical pressure wave from the core, speed/width fixed, strength ∝ amplitude; ambient level adds tiny agitation | Clap → a ring of displaced matter races outward; extreme claps tint only the wavefront red |
| **BME280 T** | °C (stable) | `thermal` | Turbulence gain ×0.8–1.3, particle colour temperature cool→warm | Warm room = slightly warmer, livelier dust |
| **BME280 RH** | % | `density`, `haze` | Fraction of visible particles, depth haze / atmospheric extinction | Humid = denser, softer, more atmospheric |
| **BME280 P** | hPa relative to a slow session baseline (±0.5 hPa) | `pressure` | ±5 % extra compression | Lift the board ~1 m and the field subtly loosens (0.12 hPa/m) |
| **DHT11** | T/RH as a *second, local* probe | `convection` | RH/T rise above the BME baseline = breath/hand → up-draft current along the field axis | Breathe on the DHT11 → a slow warm plume rises through the field |

Mode states are **emergent labels**, not screens: `calm` (default), `disturbance` (active waves),
`gravity` (tilt/compression away from neutral), `overdrive` (energy > 0.7), `environment`
(convection/haze/pressure deviating). Weights blend continuously; the UI shows the dominant one.

---

## 3. Hardware wiring / pin plan (ESP32 DevKit V1, 30/38-pin)

| Device | Pin (device) | ESP32 | Notes |
|---|---|---|---|
| **I²C bus** | SDA / SCL | **GPIO21 / GPIO22** | Shared; most breakout boards already have 4.7–10 k pull-ups |
| MPU6050 (GY-521) | VCC, GND, SDA, SCL | 3V3, GND, 21, 22 | Addr 0x68 (AD0→GND). If flaky at 3.3 V, GY-521 VCC may go to 5 V (on-board LDO; pull-ups sit on its 3.3 V rail) — verify on your board first |
| BME280 | VIN, GND, SDA, SCL | 3V3, GND, 21, 22 | Addr 0x76 (SDO→GND) or 0x77. **Check chip ID: 0x60 = BME280, 0x58 = BMP280 (no humidity!)** |
| **HC-SR04** | VCC | **5 V (VIN)** | Needs 5 V to range reliably |
| | TRIG | GPIO5 | 3.3 V is a valid HIGH for the HC-SR04 input |
| | ECHO | GPIO18 **via divider** | ECHO outputs 5 V. Divider: ECHO —1 kΩ— node —2 kΩ— GND; node → GPIO18 (5 × 2/3 = 3.33 V). Or use HC-SR04P (3.3 V part) |
| **Potentiometer 10 k** | ends / wiper | 3V3 & GND / **GPIO34** | Never put 5 V across the pot. 100 nF wiper→GND recommended |
| **LDR** | divider | **GPIO35** | 3V3 — LDR — node — 10 kΩ — GND; node → 35 (brighter = higher voltage). 100 nF to GND |
| **Sound module** | VCC, GND, AO | 3V3, GND, **GPIO36 (VP)** | Power at 3.3 V so AO can't exceed 3.3 V. DO pin unused (we measure amplitude) |
| **DHT11** | VCC, DATA, GND | 3V3, **GPIO4**, GND | 10 k DATA→3V3 pull-up (bare 4-pin part; modules have it) |
| *(optional)* RGB LED | R, G, B | GPIO25 / 26 / 27 | 220–330 Ω each, LEDC PWM, reserved for Phase 5 |

Rules applied:
* **Analog inputs only on ADC1 (GPIO32–39).** ADC2 cannot be read while Wi-Fi is on.
* GPIO34–39 are input-only — perfect for sensors.
* Avoid strapping pins 0, 2, 12, 15 and flash pins 6–11.
* Use `analogReadMilliVolts()` (factory-calibrated) and 11 dB attenuation; the ESP32 ADC is nonlinear near 0 V and 3.3 V, which is why the pot mapping has soft end-zones.
* Common ground for everything. The 5 V rail only feeds the HC-SR04 (and optionally the GY-521).

```
            ESP32 DevKit
          ┌────────────┐
   3V3 ───┤3V3     VIN ├─── 5V ──── HC-SR04 VCC
   GND ───┤GND     GND ├─── GND (common)
          │         D5 ├──────────── HC-SR04 TRIG
          │        D18 ├──┬── 1k ─── HC-SR04 ECHO
          │            │  └── 2k ─── GND
          │        D21 ├──── SDA ── MPU6050, BME280
          │        D22 ├──── SCL ── MPU6050, BME280
          │         D4 ├──── DHT11 DATA (+10k to 3V3)
          │        D34 ├──── POT wiper
          │        D35 ├──── LDR/10k node
          │   D36 (VP) ├──── MIC AO
          └────────────┘
```

---

## 4. Communication protocol

Transport: ESP32 runs a WebSocket server on **port 81**, reachable at `ws://positron.local:81`
(mDNS) or its IP. If station Wi-Fi fails it starts an access point `POSITRON` (`ws://192.168.4.1:81`).
Serve the web app over **http** (Vite dev server) — an https page cannot open `ws://`.

**Device → browser**, text JSON, schema version `v: 1`.

`hello` (once per connection):
```json
{ "type": "hello", "v": 1, "device": "positron-esp32", "fw": "0.2.0",
  "sensors": { "mpu6050": true, "bme280": true, "dht11": true, "hcsr04": true },
  "rate": 30 }
```

`frame` (30 Hz):
```json
{ "type": "frame", "v": 1, "seq": 48213, "t": 1607123,
  "mpu":   { "ax": 0.12, "ay": -0.84, "az": 0.31, "gx": 2.4, "gy": -1.2, "gz": 0.8,
             "roll": -69.7, "pitch": -6.9 },
  "dist":  34.2,
  "light": 682,
  "pot":   2180,
  "sound": { "level": 0.24, "peak": 0.41 },
  "env":   { "t": 27.4, "rh": 51.2, "p": 1008.4, "t2": 27, "rh2": 55 },
  "ev":    { "clap": [12, 0.83], "shake": [3, 0.55] } }
```

| Field | Unit | Notes |
|---|---|---|
| `seq` | – | increments per frame; browser detects drops/packet rate |
| `t` | ms since boot | used for dt between frames |
| `mpu.a*` | g, calibrated | `g*` °/s bias-removed; `roll/pitch` from the on-device 200 Hz filter |
| `dist` | cm | `null` when invalid/timeout |
| `light`, `pot` | ADC counts 0–4095 | normalised in the browser (calibration lives in one place) |
| `sound.level` | 0–1 envelope | `peak` = max over the frame interval |
| `env` | °C, %RH, hPa | `t/rh/p` from BME280, `t2/rh2` from DHT11; any may be `null` |
| `ev.*` | `[seq, strength]` | event counters — the browser fires an event when `seq` changes, so an event is never lost between frames or duplicated |

**Browser → device**: `{"type":"cmd","cmd":"calibrate"}` (zero MPU at rest),
`{"type":"cmd","cmd":"set","key":"clap_margin","value":0.15}` (keys: `clap_margin`, `mic_scale`,
`shake_g`; the device replies `{"type":"tune","tune":{…}}`),
`{"type":"cmd","cmd":"led","r":0,"g":0,"b":0}` (Phase 5).

Bandwidth ≈ 350 B × 30 Hz ≈ 10 kB/s. The simulated source emits exactly this schema.

---

## 5. Software architecture

| Layer | Module | Responsibility |
|---|---|---|
| config | `config.ts` | every tunable constant (ranges, curves, time constants, quality) |
| sensors | `protocol.ts` | packet types + validation |
| | `SimulatedSource.ts` | physically plausible fake device (noise, quantisation, DHT11 1 °C steps, autopilot gestures, keyboard) |
| | `SensorHub.ts` | chooses LIVE / SIM, auto-fallback, packet-rate stats |
| | `filters.ts`, `Normalizer.ts` | EMA, median, hysteresis, dead zone, log maps, baselines, event dedupe, fallback clap detector |
| communication | `WebSocketSource.ts` | connect, reconnect with back-off, parse, send commands |
| simulation | `FieldState.ts` | sensor fusion → physical state, per-channel critical damping |
| | `WaveSystem.ts` | impulse queue (4 slots) → shader uniforms; energy-driven spontaneous events |
| | `ModeBlender.ts` | continuous mode weights |
| | `particles/*` | GPGPU physics (velocity/position textures), seed structure, render shaders |
| effects | `PostChain.ts` | HDR target → tone mapping → grain/vignette |
| core | `App.ts`, `CinematicCamera.ts`, `Input.ts`, `math.ts` | loop, camera, input |
| ui | `Intro.ts`, `Overlay.ts`, `DebugPanel.ts` | typography only |

### Particle physics (per particle, in `velocity.glsl`)
With attractor **A**, field axis **N**, particle offset **d = p − A**, in-plane radius *ρ*, height *h*:
* radial well: `F = −k(ρ − R₀·compression)` toward its own preferred radius (structure, not a blob)
* plane confinement: `F = −k_z (h − h₀·thickness) N`
* orbit: tangential velocity driven toward a Kepler-like `v_t ∝ orbit·√(R_ref/ρ) + spin`
* stream class follows dipole field lines (the "flowing field lines" in the structure)
* halo class sits in a loose spherical shell (the atmosphere; haze/density act here most)
* turbulence: curl noise (divergence-free → looks like fluid, not jitter)
* waves: Gaussian shell `exp(−((|p−O|−c·τ)/w)²)` pushes radially, decays with τ
* convection: up-draft along N weighted by closeness to the axis
* damping, time-scaled integration, respawn if escaped

---

## 6. Visual design specification

* **Ground**: `#0a0a0b` near-black with a very slight charcoal lift (illumination-driven), vignette.
* **Matter**: warm off-white dust `#d9d3ca`; particles are 1–3 px, never glowing sprites.
  Brightness comes from **Henyey–Greenstein forward scattering** relative to one key light — so
  the look is lit dust, not LEDs.
* **Colour budget**: amber `#c9914a` for kinetic energy (fast particles only, max ~35 % mix);
  muted blue `#5d6f86` for the outer atmosphere / haze; red `#b5483a` only on the wavefront of an
  extreme impulse. Everything else is grey scale.
* **Depth**: in-shader depth of field (circle of confusion enlarges the point and conserves its
  energy → real bokeh, no blur pass), atmospheric extinction with distance (humidity).
* **Post**: HDR render target → AgX tone mapping → film grain (~3 %) + vignette. No bloom in
  Phase 1; bloom will only be added if it measurably improves the core (Phase 4).
* **Typography**: Inter 300/400 for words (wide tracking, uppercase, 10–11 px), IBM Plex Mono 300
  for numbers with tabular figures. Text at ~55 % opacity; four corners, generous margins, no boxes.
* **Motion**: nothing snaps. Camera azimuth drifts ~0.7°/s, elevation and distance breathe on
  long periods, mouse parallax ≤ 3°, all critically damped.
* **Startup**: black → "POSITRON" fades in → "SENSOR UNIVERSE" → the field is born from a point
  as compression releases (the physics does the reveal).

### Phase 4 decisions

**Post-processing — pmndrs/postprocessing evaluated, not adopted.** Each candidate effect was
checked against the design rule (keep only what has a physical reason):

| Effect | Verdict | Reason |
|---|---|---|
| Bloom | rejected | turns the dense core into a glowing blob — the "LED" look we are avoiding. Brightness already comes from scattering + HDR roll-off (AgX) |
| Depth of field (screen-space) | rejected | the point shader already renders a true per-particle circle of confusion, sharper and cheaper than a blur pass on sparse points |
| SSAO | rejected | no surfaces to occlude — additive dust has no ambient occlusion |
| Chromatic aberration, glitch, scanlines | rejected | pure style, no relation to a sensor |
| Tone mapping, grain, vignette | kept | built-in chain (EffectComposer → AgX → one grade pass) already does this in 3 passes |

Adding the library would cost a dependency and full-screen passes for nothing visible.

**Performance (Radeon 780M iGPU, measured with a GPU sync):** 37k particles ≈ 1.6 ms/frame at
1080p, 6.8 ms at 4K; 65k ≈ 1.8 ms at 1080p. Default raised to 65k (brightness normalised by
count so exposure is unchanged). Adaptive resolution scales the pixel ratio 0.6–2 to hold the
refresh rate on weaker GPUs; particle count never changes at runtime because it defines the physics.

**Calibration moved to runtime.** Ranges (pot, LDR, hand distance) are learned in the browser
from live data; device thresholds (clap, mic scale, shake) are set over the link with
`{"type":"cmd","cmd":"set","key":…, "value":…}` and echoed back as `{"type":"tune",…}`
(also included in `hello`). Both persist — the board in flash, the browser in local storage.

### Hardware revision: potentiometer removed

The potentiometer was removed from the build. Energy is now a setting (tuning panel slider, `Q`/`E`
keys, default 0.45) that the field eases toward exactly as it did toward the knob; heat build-up
from energy history is unchanged. GPIO34 is free. The sound module is optional too (`HAS_MIC`),
so without it pressure waves come from shaking the board.

### Polish upgrade decisions

| Change | Why |
|---|---|
| Semi-implicit Euler (manual ping-pong instead of `GPUComputationRenderer.compute()`) | the position pass read the previous velocity; the explicit integrator needed heavy artificial damping, which deadened motion |
| Gravity supplies `v²/ρ`; springs only correct deviations | without it orbiting matter drifted outward and the centre emptied — the old "hole" was a physics error, not a design |
| Gas drag with size-dependent response time replaces fixed damping | grains of different size now move differently (Stokes coupling), which removes synchronised motion |
| Accretion class replaces the dipole streams | the streams converged on the axis as a bright vertical line; accretion fills the centre with dense, fast, hot matter |
| Event horizon + point-lens remap in the final pass | "a subtle central attractor" with a physical meaning: its mass is the hand distance, and it bends the light of the matter behind it |
| Haze-scattered core glow instead of bloom | the only glow in the image is the core's light in humid air — a reason, not an effect |
| Response tiers (fast / medium / slow) made explicit in `config.response` | a believable system reacts fast to gestures and evolves slowly with the room |
| LIVE mode relaxes to neutral on signal loss instead of switching to the autopilot | never fake data in a live demo; never freeze either |
| One type family (Inter, tabular figures) | numbers align like instrumentation; one less download |
| Invisible grains culled in the vertex shader | the humidity gate and fades hid 20–45 % of grains that still rasterised; frame time 3.5 → 1.5 ms |

---

## 7. Folder structure

```
XUniverse/                     (project root = /positron)
├─ README.md
├─ docs/DESIGN.md              this file
├─ esp32/                      Phase 2–3
│  └─ positron/
│     ├─ positron.ino          setup/loop, scheduler
│     ├─ config.h              pins, rates, Wi-Fi
│     ├─ sensors/              mpu.*, env.*, ultrasonic.*, analog.*, sound.*
│     └─ communication/        wifi.*, ws_server.*, packet.*
└─ web/
   ├─ index.html
   ├─ package.json
   └─ src/
      ├─ main.ts   config.ts   styles.css
      ├─ core/            App, CinematicCamera, Input, math
      ├─ sensors/         protocol, SimulatedSource, SensorHub, Normalizer, filters
      ├─ communication/   WebSocketSource
      ├─ simulation/      FieldState, WaveSystem, ModeBlender
      │  └─ particles/    ParticleField, seed, shaders/*.glsl
      ├─ effects/         PostChain, shaders/grade.glsl
      └─ ui/              Intro, Overlay, DebugPanel
```

---

## 8. Development phases

| Phase | Scope | Done when |
|---|---|---|
| **1 · Digital universe (no hardware)** | Web app, GPGPU particle field, fusion state, simulated device with autopilot + keyboard, waves, camera, startup, overlay, debug panel, post chain | `npm run dev` shows a living field that reacts to simulated sensors at 60 fps |
| **2 · Hardware bring-up** | Breadboard wiring, firmware sensor drivers + filters, per-sensor serial test mode, calibration | Serial monitor prints clean, stable frames with all sensors |
| **3 · Live link** | Wi-Fi (STA + AP fallback), mDNS, WebSocket server, protocol, LIVE/SIM switch, auto-fallback, calibrate command | Tilting the real board moves the field |
| **4 · Tuning & visuals** | Re-tune curves on real data, post-processing evaluation (pmndrs), quality tiers, profiling | Every mapping feels natural; 60 fps on a laptop iGPU |
| **5 · Presentation** | Presentation/record mode, camera choreography, optional RGB LED feedback, README, demo script | LinkedIn video recorded |
