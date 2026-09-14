# POSITRON — Sensor Universe

**A physical instrument connected to an abstract universe.** An ESP32 with five sensors drives a
real-time GPU simulation of 65,536 dust grains orbiting a gravitational attractor. Tilt the board
and gravity shifts. Bring a hand close and the field collapses toward its core. Shake it and a
pressure wave crosses it. Breathe on it and warm air rises through the centre. The room's light,
heat, humidity and air pressure slowly shape the atmosphere.

```
PHYSICAL WORLD → SENSORS → ESP32 → Wi-Fi / WebSocket (30 Hz) → BROWSER → FUSION → GPU PHYSICS → IMAGE
```

<!-- Add a still here: docs/hero.jpg (clean canvas capture with the V key) -->

> **Design rule.** Every visual behaviour maps to a sensor, a physical parameter or the
> simulation's own dynamics. Nothing is on screen just because it looks good. Beauty has to come
> from the behaviour.

---

## Concept

POSITRON is not a dashboard. Numbers are secondary; the sensors change the *laws* of a small
universe — its gravity, its energy, its atmosphere — and the viewer watches matter respond. The
visual language is scientific visualisation rather than interface: near-black space, lit dust,
one warm accent, restrained typography and a slow cinematic camera.

## Hardware

| Part | Role |
|---|---|
| ESP32 DevKit V1 | acquisition, filtering, Wi-Fi, WebSocket server |
| MPU6050 (accel + gyro) | board orientation, twist, shake |
| HC-SR04 ultrasonic | hand distance |
| LDR + 10 kΩ divider | room light |
| Sound module (optional, analog out) | sound amplitude, claps — enable with `HAS_MIC 1` in `config.h` |
| BME280 | temperature, humidity, pressure — the stable ambient reference |
| DHT11 | a second, *local* probe (breath, hand warmth) |
| RGB LED + 3 × 220 Ω (optional) | physical feedback computed on the board |

### Wiring

| Device | Pin | ESP32 | Notes |
|---|---|---|---|
| I²C bus | SDA / SCL | GPIO21 / GPIO22 | shared by MPU6050 (0x68) and BME280 (0x76/0x77) |
| MPU6050, BME280 | VCC | 3V3 | |
| HC-SR04 | VCC / TRIG | **3V3** / GPIO5 | resistor-free build: at 3.3 V the sensor's ECHO is 3.3 V too (best with the HC-SR04P variant) |
| HC-SR04 | ECHO | GPIO18 directly | **only while VCC is 3V3.** On 5 V, ECHO outputs 5 V and needs a 1:2 divider (10k / 20k) to GPIO18 |
| LDR module (VCC, GND, DO) | DO | GPIO35 | VCC to **3V3**; bright/dark only, threshold on the module's trimmer (`LDR_DIGITAL 1`). A bare LDR instead: 3V3 — LDR — node — 10 kΩ — GND, node → GPIO35, `LDR_DIGITAL 0` |
| Sound module (optional) | AO | GPIO36 (VP) | powered at 3.3 V so AO stays ≤ 3.3 V |
| DHT11 | DATA | GPIO4 | 10 kΩ pull-up to 3V3 |
| RGB LED | R / G / B | GPIO25 / 26 / 27 | 220 Ω each |

All analog inputs are on **ADC1** (GPIO32–39): ADC2 cannot be read while Wi-Fi is active.
Full bring-up procedure, sensor by sensor: [esp32/README.md](esp32/README.md).

## Data flow

1. **Acquisition on the ESP32**, each sensor at its natural rate:
   MPU6050 200 Hz (complementary filter → roll/pitch, shake events) · microphone 5 kHz in 20 ms
   windows on core 0 (amplitude envelope, transient-verified clap events) · HC-SR04 20 Hz,
   interrupt-timed, speed of sound corrected for air temperature · LDR 50 Hz, oversampled ·
   BME280 1 Hz in forced mode (no self-heating) · DHT11 0.5 Hz.
2. **Transport**: one JSON frame at 30 Hz over a WebSocket (or USB serial), events as sequence
   counters so a clap can never be lost or duplicated between frames.
3. **Normalization in the browser** (`Normalizer`): range calibration, median / EMA / hysteresis,
   dead zones, logarithmic light, session baselines for pressure and the DHT11, event de-duplication.
4. **Fusion** (`SimulationState`): all inputs become one physical state, each channel easing at the
   speed of its tier (below). Sensors never touch Three.js objects directly.
5. **Physics on the GPU** (`ParticleField`): velocity and position float textures, integrated with
   semi-implicit Euler.
6. **Rendering**: lit particles → final pass (lensing, core, AgX tone mapping, grain) → screen.

## Sensor mapping

| Sensor | Normalized input | Simulation parameter | What you see |
|---|---|---|---|
| MPU6050 roll | tilt, 3° dead zone, 35° clamp | attractor displacement (screen-horizontal), orbital-plane lean | the field slides and leans like a gyroscope, lagging slightly like a mass on a spring |
| MPU6050 pitch | tilt | attractor moves in **depth** + lean | tilting forward sends the field away, back brings it closer |
| MPU6050 gyro z | twist rate | angular momentum added to the orbits | twisting spins the field up or reverses it briefly |
| MPU6050 shake | event (|a| − 1 g, cooldown) | off-centre pressure wave | a disturbance from the side you shook |
| HC-SR04 | proximity (nonlinear, ≈ 1/r) | preferred-radius scale 1.0 → 0.38, well stiffness ×3, attractor "mass" | matter collapses inward and spins faster (angular momentum), the core's shadow and lensing grow |
| Microphone | envelope + clap events | spherical pressure wave, strength = loudness; ambient level → slight agitation | a ring of matter thrown outward, drawn partly back, settling in seconds |
| LDR | log-mapped 0–1 | key light, ambient light, core luminosity, exposure, ground lift | a dark room leaves only back-lit dust; light fills the field in |
| BME280 temperature | 16–36 °C → 0–1 | thermal turbulence, colour temperature of the dust | a warm room is slightly livelier and warmer in tone |
| BME280 humidity | 20–85 % → 0–1 | fraction of matter visible, atmospheric extinction, glow of the core in the haze | humid air is denser and softer |
| BME280 pressure | deviation from session baseline (±0.5 hPa) | ±5 % compression | lifting the board ~1 m loosens the field very slightly |
| DHT11 | rise above its own baseline | convection plume along the axis | breathing on it lifts warm matter through the core |
| *history* | energy over the last 30 s | heat build-up (thermal inertia) | sustained energy warms the field; it cools more slowly than it heated |
| *energy setting* | tuning panel / `Q` `E` (no hardware knob) | time scale, orbit speed, turbulence, gas drag, spontaneous events — separate curves | 0 almost still · 0.45 natural (default) · 1 turbulent with micro-events |

### Temporal hierarchy

Fast sensors drive fast events; slow sensors drive slow evolution. This is what keeps the scene
from twitching while still reacting instantly to a gesture.

| Tier | Channels | Response |
|---|---|---|
| **Fast** | sound, MPU6050 tilt / twist / shake | 0.1–0.3 s (tilt: underdamped spring, 0.55 Hz) |
| **Medium** | ultrasonic, LDR, DHT11 breath, energy setting | 0.6–1.8 s |
| **Slow** | temperature, humidity, pressure, heat build-up | 9–45 s |

Readouts follow the same rule: slow sensors glide between their real measurements (BME280 once per
second) and the last digit has hysteresis, so values never flicker.

## Physics model

Each grain is dust in an orbiting gas (`velocity.glsl`):

- **Gravity** — supplies the centripetal acceleration `v²/ρ` of its orbit, plus a spring toward its
  preferred radius and plane. Mass-independent.
- **Drag** — `(u − v) / τ` toward the local gas velocity `u` (Kepler-like orbital flow + a two-armed
  spiral density wave + curl-noise turbulence + convection). `τ` grows with grain size: fine dust
  follows the gas, large motes lag and wobble. This is why neighbouring grains never move in lock-step.
- **Classes** — disk (70 %), halo atmosphere (18 %, rotates slower toward its poles), accretion
  (12 %, spirals into the core and re-forms outside).
- **Core** — an event horizon: matter reaching it is swallowed and re-forms, leaving a small dark
  centre inside a dense, fast, bright inner ring. Its size grows with the attractor's mass.
- **Waves** — push at the front, gentle pull behind, amplitude falling with distance and time;
  heavier grains are pushed less.
- **Integration** — semi-implicit Euler (velocity pass, then position pass reading the new
  velocity), with sub-steps when energy is high. Stable without artificial damping.

## Rendering

- **Light**: forward scattering of one key light (Henyey–Greenstein) plus the core as a softened
  inverse-square source — this is what gives the centre its weight.
- **Depth**: perspective size, per-grain circle of confusion with energy conservation (real depth of
  field), humidity extinction, fade at the lens, radial dissolve at the periphery.
- **Final pass** (one pass): point-mass **gravitational lensing** around the core (a thin Einstein
  ring appears at the shadow's edge), the core's pinprick and its haze-scattered glow, AgX tone
  mapping, ground lift, vignette, film grain. No generic bloom.
- **Performance**: grains that contribute no light are culled in the vertex shader. Measured on an
  integrated Radeon 780M at 1080p: **≈ 1.5 ms per frame** for 65,536 particles. Adaptive resolution
  holds 60 fps on slower GPUs.

## Communication protocol

WebSocket on port 81 (`ws://positron.local:81`, or `ws://192.168.4.1:81` on the board's own access
point). USB serial carries the same messages as newline-delimited JSON.

**Device → browser**

```jsonc
{ "type": "hello", "v": 1, "device": "positron-esp32", "fw": "0.6.0",
  "sensors": { "mpu6050": true, "bme280": true, "dht11": true, "hcsr04": true },
  "rate": 30, "tune": { "clap_margin": 0.12, "mic_scale": 1800, "shake_g": 0.65 } }

{ "type": "frame", "v": 1, "seq": 48213, "t": 1607123,
  "mpu":   { "ax": 0.12, "ay": -0.84, "az": 0.31, "gx": 2.4, "gy": -1.2, "gz": 0.8, "roll": -69.7, "pitch": -6.9 },
  "dist":  34.2,                         // cm, null when no echo
  "light": 682,                          // ADC counts 0–4095
  "sound": null,                         // { "level", "peak" } when a sound module is fitted
  "env":   { "t": 27.4, "rh": 51.2, "p": 1008.4, "t2": 27, "rh2": 55 },   // BME280, DHT11 (null if absent)
  "ev":    { "clap": [12, 0.83], "shake": [3, 0.55] } }                  // [sequence, strength]

{ "type": "tune", "tune": { … } }       // after a threshold changed
{ "type": "pong", "t": 123456 }         // heartbeat reply
```

**Browser → device**

```jsonc
{ "type": "cmd", "cmd": "ping", "t": 123456 }                            // every 2 s
{ "type": "cmd", "cmd": "calibrate" }                                    // level the MPU6050
{ "type": "cmd", "cmd": "set", "key": "clap_margin", "value": 0.15 }     // clap_margin | mic_scale | shake_g
{ "type": "cmd", "cmd": "led", "on": false }
```

**Robustness**: malformed JSON and physically impossible readings are rejected per field (one bad
sensor never freezes the others); duplicate and out-of-order frames are dropped by sequence number,
a board reboot is recognised; the heartbeat measures round-trip time and closes half-open sockets;
the client rotates through known addresses with back-off. If data stops, gesture channels relax
smoothly to rest — the world never freezes and never fakes data.

## Software architecture

```
esp32/positron/
  positron.ino            loop: IMU, ultrasonic, environment, link, console, frames, LED
  config.h                pins, rates, thresholds
  src/sensors/            Imu (MPU6050 driver + filter), Ultrasonic, AnalogFront (LDR + optional mic task),
                          Environment (BME280 + DHT11)
  src/communication/      Link (Wi-Fi, AP fallback, mDNS, WebSocket), Packet (JSON), SerialConsole,
                          JsonLite
  src/feedback/Led        on-board RGB feedback
  src/core/               Filters, Tunables (runtime thresholds in flash)

web/src/
  config.ts               every constant, incl. response tiers
  sensors/                protocol (validation) · SimulatedSource · SensorHub (live/sim, neutral decay)
                          · Normalizer · filters
  communication/          WebSocketSource · SerialSource · LinkStats (sequence, heartbeat, jitter)
  simulation/             SimulationState (fusion) · WaveSystem · ModeBlender
    particles/            ParticleField (GPGPU) · seed · shaders (velocity, position, points, waves, noise)
  effects/                PostChain + final.glsl (lensing, core, AgX, grade)
  core/                   App (frame loop) · CinematicCamera · History (ring buffers) · Settings
                          · AdaptiveQuality · Recorder · Input · math (springs, inertial response)
  ui/                     Overlay (telemetry + micro-history) · Intro · Outro · Captions
                          · DebugPanel · TuningPanel
```

## Run it

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`. Without an ESP32 it runs in **simulation mode**: a virtual board
sends the same frames as the firmware — sensor noise, BME280 at 1 Hz, DHT11 integer steps, drift,
correlated temperature and humidity, ultrasonic dropouts, background sounds that must *not* read as
claps — and an autopilot performs gestures. With the board: `?live` (Wi-Fi) or the `U` key (USB).

| Key | Action | Key | Action |
|---|---|---|---|
| ← → ↑ ↓ | tilt the (simulated) board | `W` / `S` | hand toward / away |
| `Q` / `E` | energy setting down / up | `Space` | clap (`Shift` = extreme) |
| `X` | shake | `B` | breathe on the DHT11 |
| `N` | room light on / off | `Z` | twist (hold) |
| `A` | autopilot | `C` | level the board |
| `U` | ESP32 over USB | `M` | LIVE (Wi-Fi) ↔ simulation || `P` | presentation mode | `H` | hide all UI |
| `1`–`4` | wide / close / edge-on / top shot | `5` | automatic shots |
| `K` | captions (sensor → effect) | `O` | closing title |
| `D` | debug | `T` | tuning panel |
| `V` | record the canvas | `F` | fullscreen |

Mouse: drag to orbit, wheel to dolly. URL options: `?live` · `?ws=192.168.1.42:81` · `?debug` ·
`?nointro` · `?q=medium|low` (37k / 16k particles) · `?fixedres`. The app honours
`prefers-reduced-motion` (slower drift, no automatic shots, static grain).

## Documents

- [docs/DESIGN.md](docs/DESIGN.md) — original specification and design decisions
- [esp32/README.md](esp32/README.md) — toolchain, bring-up, Wi-Fi, tuning, LED
- [docs/DEMO.md](docs/DEMO.md) — recording guide, shot list, LinkedIn post draft

## Future improvements

- **OLED (SSD1306)** on the board showing link state and IP — no serial monitor needed on site.
- **WS2812 ring** instead of the single RGB LED: the wave travelling around the ring with the one on screen.
- **More environmental sensing**: SGP30/SCD40 (CO₂ — breath becomes a measurable gas), a thermal
  camera (MLX90640) mapping body heat into the field, a magnetometer for absolute heading.
- **Better IMU fusion**: Madgwick/Mahony filter or the MPU6050's DMP for drift-free yaw, so the
  field can rotate with the board around all three axes.
- **Custom PCB**: ESP32-S3 module, sensors on one board, proper analog front end (MAX9814 AGC mic),
  battery charging — a handheld instrument instead of a breadboard.
- **Gesture recognition**: a small on-device model (TensorFlow Lite Micro) classifying IMU
  gestures (flick, circle, tap) as new events.
- **Multi-device**: two boards as two attractors in the same universe.

Built by a 2nd-year Electronics & Communication Engineering student.
