# POSITRON — demo & recording guide

Goal of the video: in under 90 seconds a viewer should understand, without narration, that
**physical electronics are controlling this digital world.** Every cut pairs a hand on a sensor
with the field responding.

## Setup (10 min, once)

**Room.** Dim, not dark: one lamp you can switch (for the LDR beat). Quiet enough that the clap is
the loudest sound. Board on a matte dark surface (black card or cloth), cables tidied toward the back.

**Board.** Powered from a power bank, on Wi-Fi (no USB cable in shot). LED connected if you have it.

**Browser.** Chrome or Edge, full-screen (`F`), `http://localhost:5173/?live`. Then:
1. `T` → run *Learn light*, set *Near/Far*, pick the *Energy* you want the piece to have
   (0.45 is natural; try 0.6 for more life on camera), adjust *Shake threshold*. `T` again to close.
2. Board flat → `C` to level it.
3. `P` presentation mode (debug/tuning hidden, cursor hidden, automatic camera). Presentation
   shows only the wordmark, the telemetry and the simulation.
4. Optional: `K` turns on captions (*HC-SR04 · 12 cm → compression 0.64*) — useful if the video
   has no narration; leave them off for a cleaner piece.
5. Check the top-right says `ESP32 · Wi-Fi ●` (in presentation it is only shown when live).

**Two recordings, edited together:**

| Track | Tool | Notes |
|---|---|---|
| Screen (with typography + captions) | **OBS** (Display Capture, 1080p60, CQP 18) or Windows **Win + Alt + R** | this is the main track |
| Screen, clean (no text) | press **V** in the app → saves `positron-….mp4` | pure canvas from the GPU, for B-roll and the thumbnail |
| Hardware | phone on a small tripod, 4K/60 if possible, exposure locked | same lighting as the screen shots; film the hands, not your face |

Tip: start the phone and OBS, then give the board one sharp shake — the pressure wave and the
visible jolt give you a sync point for the edit.

## Shot list (~65 s)

| # | Time | Hardware (phone) | Screen | Keys |
|---|---|---|---|---|
| 1 | 0–4 s | black | intro plays: POSITRON → SENSOR UNIVERSE → field is born | reload page with `?live` then `P` |
| 2 | 4–12 s | slow push-in over the breadboard | wide shot, calm field | `1` |
| 3 | 12–22 s | lift the board and **tilt** left, then right, then forward | edge-on shot: the disk slides, leans like a gyroscope, and recedes when tipped forward; caption *MPU6050 → GRAVITY* | `3` (edge) |
| 4 | 22–32 s | hand descends slowly toward the **HC-SR04** | field collapses toward the core and spins faster; the dark centre and its lensing ring grow; caption *HC-SR04 → COMPRESSION* | `2` (close) shows the core |
| 5 | 32–36 s | hand pulls away | field breathes out | |
| 6 | 36–42 s | one sharp **shake** of the board | pressure wave crosses the field from the side you shook | `4` (top) catches the ring best |
| 7 | 42–50 s | **breathe** on the DHT11 | warm plume rises through the core; caption *DHT11 → CONVECTION* | |
| 8 | 50–56 s | switch the lamp off | scene dims, only back-lit dust remains; caption *LDR → ILLUMINATION* | |
| 9 | 56–65 s | wide of the whole desk: board + screen in one frame | camera pulls back, closing title | `O` |

Keep each hardware shot and its screen response **side by side or in quick cuts** (≤ 1 s apart).
If the edit only allows one, choose split-screen: hardware left, simulation right.

## Edit

* 1080×1080 (feed) or 1080×1920 (vertical) crops both work — the field is centred.
* No music with a heavy beat; a low drone or the room sound + clap works better.
* Title card at the end is already in the app (`O`); don't add another.
* Export H.264, 1080p, 60 fps, ~12 Mbps.
* Thumbnail: a frame from the clean canvas recording (`V`) during the compression or the wave.

## LinkedIn post (draft — make it yours)

> **POSITRON — Sensor Universe**
>
> An ESP32 with five sensors driving a real-time particle simulation.
>
> Tilt the board and gravity shifts. Bring a hand close and the field collapses toward its core.
> Shake it and a pressure wave travels through it. Breathe on it and warm air rises through the core.
>
> Under the hood:
> • ESP32 firmware: MPU6050 complementary filter at 200 Hz, interrupt-timed ultrasonic with
>   temperature-compensated speed of sound, BME280 + DHT11 environment sensing, all streamed over
>   Wi-Fi/WebSocket at 30 Hz
> • Sensor fusion in the browser into one physical state (energy, gravity, compression, impulse…)
> • 65,000 particles simulated entirely on the GPU (GPGPU with Three.js) — ~2 ms per frame on an iGPU
> • Every visual behaviour maps to a sensor or a physical model — nothing is there just to look cool
>
> 2nd-year ECE project. Code: <link>
>
> #ESP32 #EmbeddedSystems #Electronics #ThreeJS #CreativeCoding #IoT #SensorFusion

## Before you hit record — checklist

- [ ] top-right shows `ESP32 · Wi-Fi ●` (not Simulation)
- [ ] `C` pressed with the board flat
- [ ] *Learn light* done; covering the LDR takes LIGHT near 0.00
- [ ] a sharp shake fires a wave, normal tilting doesn't
- [ ] presentation mode on (`P`), no cursor, no panels
- [ ] notifications off (Windows Focus), browser bookmarks bar hidden (full-screen `F`)
- [ ] phone exposure and focus locked
