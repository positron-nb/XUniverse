# POSITRON firmware — bring-up (Phase 2) and Wi-Fi link (Phase 3)

## 1. Toolchain (Arduino IDE 2)

1. **File → Preferences → Additional boards manager URLs**:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. **Boards Manager** → install **esp32 by Espressif Systems** (3.x).
3. **Library Manager** → install:
   * `Adafruit BME280 Library` (accept "install all" → pulls **Adafruit Unified Sensor** + BusIO)
   * `DHT sensor library` by Adafruit
   * `WebSockets` by **Markus Sattler** (Links2004) — *not* "ArduinoWebsockets" or "WebSockets_Generic"
4. Open `esp32/positron/positron.ino`. Board: **ESP32 Dev Module**. Upload speed 921600.
5. Serial Monitor at **115200** baud, line ending **Newline**.

> Upload fails with "Failed to connect… Timed out waiting for packet header"? Hold **BOOT** while
> "Connecting…" is shown. No COM port at all? Install the CP210x or CH340 USB driver (look at the
> chip next to the USB socket).

## 2. Wire one sensor at a time

Power off while wiring. After each step: upload once, open the Serial Monitor, run the test,
and only then add the next sensor. All grounds are common.

| # | Sensor | Connect | Test command | Pass when |
|---|---|---|---|---|
| 0 | ESP32 alone | USB only | `info` | banner prints, sensors reported as not found |
| 1 | **LDR module** (VCC/GND/DO) | VCC → **3V3**, GND, DO → GPIO35 (`LDR_DIGITAL 1`, the default). Bare LDR: 3V3 → LDR → GPIO35 → 10 kΩ → GND with `LDR_DIGITAL 0` | `test ldr` | module: `ldr` flips between 0 (dark) and 4095 (bright) as you cover it — turn the blue trimmer until it switches at your room light. If covering it gives 4095, set `LDR_DO_LOW_WHEN_BRIGHT 0` |
| 2 | **MPU6050** | VCC 3V3, GND, SDA 21, SCL 22 | `scan` → `0x68`; then `cal` (flat & still), `test mpu` | roll/pitch ≈ 0 flat; tilting 45° reads ≈ 45; no drift when still |
| 3 | **BME280** | VIN 3V3, GND, SDA 21, SCL 22 | `scan` → `0x76`/`0x77`, reset, `test env` | ~room temperature, 30–70 %, 950–1030 hPa |
| 4 | **DHT11** | VCC 3V3, DATA → GPIO4 (+10 kΩ to 3V3 if bare 4-pin part), GND | `test env` | `t2`/`rh2` update every 2 s; breathing on it raises `rh2` by 10–30 |
| 5 | **HC-SR04** | VCC → **3V3**, GND, TRIG → GPIO5, ECHO → GPIO18 directly | `test dist` | hand at 10/30/60 cm reads within ~1 cm; `timeouts` only grows when nothing is in front |
| — | *Sound (optional)* | VCC 3V3, GND, AO → GPIO36 (VP); set `HAS_MIC 1` in config.h | `test mic` | `dc` ≈ 1500–2300 (mid-scale), `level` rises with noise, a clap increments `claps` but talking doesn't |

**Resistor-free on 3.3 V.** Powered from 3V3, the HC-SR04's ECHO can't exceed 3.3 V, so it goes
straight to GPIO18. Some classic HC-SR04s range poorly at 3.3 V (the HC-SR04P is designed for it):
if `test dist` shows frequent timeouts or jumps with a hand clearly in front, power it from
**VIN (5 V)** instead — and then ECHO **must** go through a 1:2 divider (e.g. 10k from ECHO to the
node, 20k from the node to GND, node → GPIO18). Never 5 V on VCC with ECHO wired directly.

Without a sound module leave `HAS_MIC 0` (the default): a floating GPIO36 reads noise that
would look like claps. Pressure waves then come from shaking the board.

Finally run `status` for everything at once, then `json` to see the exact protocol frames.

## 3. See it in the simulation (USB, no Wi-Fi yet)

1. Close the Arduino Serial Monitor (only one program can own the COM port).
2. `cd web && npm run dev`, open it in **Chrome or Edge**.
3. Press **U** → pick the ESP32's COM port. The top-right changes to `ESP32 · USB ●`.
4. Press **D** to see raw and normalized values. Press **C** with the board flat to level it.

Unplug the cable and the scene falls back to simulation within 1.5 s.

## 4. Wireless link (Phase 3)

The board joins your Wi-Fi and serves protocol frames at 30 Hz on a WebSocket, port 81.

1. In the Serial Monitor type (password is the last word; SSIDs may contain spaces):
   ```
   wifi MyNetwork mypassword
   ```
   Credentials are saved in flash. Alternative: copy `secrets.example.h` → `secrets.h`.
2. The monitor prints:
   ```
   [link] connected, IP 192.168.1.42  (RSSI -54 dBm)
   [link] browser: ws://positron.local:81  or  ?ws=192.168.1.42:81
   ```
3. In the browser press **M** (LIVE) — or open `http://localhost:5173/?live`.
   It tries `positron.local`, then `192.168.4.1`, then whatever worked last time. If mDNS
   doesn't resolve on your PC, use the printed IP: `http://localhost:5173/?live&ws=192.168.1.42:81`.
   The address that works is remembered.
4. Unplug USB and power the board from a power bank — it is now wireless.

**No router / demo venue:** if the network can't be joined within 12 s (or none is configured) the
board starts its own access point **POSITRON** (password `positron`). Join it from the laptop and
open `?live` — it connects to `192.168.4.1:81`. Force it with `wifi ap`; erase credentials with
`wifi forget`; show state with `wifi` or `info`.

What the link does:
* every browser gets a `hello` on connect (firmware version, which sensors were found)
* frames are broadcast to every connected browser; the USB port can stream at the same time
* browser **C** key → `{"type":"cmd","cmd":"calibrate"}` → the board re-levels the MPU6050
* the browser sends `{"cmd":"ping","t":…}` every 2 s and the board answers `{"type":"pong","t":…}`
  (round-trip time in the debug panel; a half-open socket is closed and reopened)
* WebSocket-level heartbeat pings drop browsers that vanished; the browser reconnects with
  back-off, and if frames stop for 1.5 s it shows *Signal lost* and relaxes the field to rest
  (it does not switch to fake simulated data while in LIVE mode)

| Symptom | Cause / fix |
|---|---|
| `could not join Wi-Fi` | wrong password, or the network is **5 GHz only** — the ESP32 needs 2.4 GHz |
| Connected, but browser stays "Searching" | PC on a guest / isolated network, or mDNS blocked → use `?ws=<IP>:81` |
| Works on `http://localhost` but not from a deployed https page | browsers block `ws://` from https pages — serve the app over http |
| Stutter, `jitter` in the debug panel > 30 ms | weak signal (RSSI below −75 dBm): move closer; Wi-Fi sleep is already disabled |
| LDR frozen after Phase 3 | it's wired to an ADC2 pin — must be GPIO32–39 |

## 5. Tuning against your hardware (Phase 4)

Nothing needs recompiling. Open the browser with the board connected and press **T**.

1. **Learn light (10 s)** — during the countdown cover the LDR with a finger, then shine a light
   on it. The range is written automatically. Set the field's **Energy** with its slider (or `Q`/`E`).
2. Hold a hand where "maximum compression" should be → **Near = now**; where the field should
   be fully open → **Far = now**.
3. **Device** sliders change thresholds *on the board* (saved to its flash, echoed back):
   clap threshold, mic full scale, shake threshold. Same from the serial monitor:
   `get`, `set clap_margin 0.15`, `set mic_scale 1200`, `set shake_g 0.8`.
4. **Response** sliders shape how strongly the field reacts (tilt travel, max compression, wave
   strength, brightness, depth of field).
5. **Copy JSON** puts every browser setting on the clipboard — paste it to me, or into
   `web/src/config.ts` to make it the default.

Browser settings live in the browser's local storage (per machine); **Reset** restores defaults.

| Symptom | Change |
|---|---|
| Claps not detected | lower *Clap threshold*, or turn the module's gain trimmer up |
| Talking/music triggers claps | raise *Clap threshold* (or lower `CLAP_CONFIRM_MS` in config.h) |
| Sound `level` saturates at 1.0 | raise *Mic full scale* |
| Shake triggers on normal tilts | raise *Shake threshold* |
| Light never reaches 0 / 1 | *Learn light* |
| Tilt response too subtle / wild | *Tilt travel* |

## 6. RGB LED feedback (Phase 5, optional)

| LED leg | Connect |
|---|---|
| R | GPIO25 — 220 Ω — R |
| G | GPIO26 — 220 Ω — G |
| B | GPIO27 — 220 Ω — B |
| common | **GND** (common cathode, default) — or **3V3** for common anode, then set `LED_COMMON_ANODE 1` in config.h |

The longest leg is the common one. The board drives the LED itself (no browser latency):

| State | LED |
|---|---|
| calm | slow warm-white breathing — 8 s period with no browser, 5 s when one is connected |
| clap / shake | short flash (white / amber); an extreme clap flashes muted red |

Serial `led off` / `led on`, or `{"type":"cmd","cmd":"led","on":false}` from the browser.
Colours are gamma-corrected so the fade looks even. If it is bright when it should be dark, you
have a common-anode LED — set `LED_COMMON_ANODE 1`.

## Firmware layout

```
positron/
  positron.ino             setup/loop (core 1)
  config.h                 pins, rates, thresholds
  src/core/Filters.h       EMA, median-of-3
  src/core/Tunables.*      runtime thresholds (clap, mic scale, shake), saved in flash
  src/communication/JsonLite.h  field extraction for browser commands
  src/sensors/Imu.*        MPU6050 raw driver, calibration (saved to flash), complementary filter, shake
  src/sensors/Ultrasonic.* interrupt-timed HC-SR04, temperature-compensated speed of sound
  src/sensors/AnalogFront.* core-0 task: LDR; mic 5 kHz amplitude + clap detector when HAS_MIC
  src/sensors/Environment.* BME280 (forced mode) + DHT11, BMP280 detection
  secrets.example.h        optional compile-time Wi-Fi credentials
  src/communication/Link.*          Wi-Fi (station → AP fallback), mDNS, WebSocket server
  src/communication/Packet.*        protocol v1 JSON builder
  src/communication/SerialConsole.* bring-up console + JSON stream
  src/feedback/Led.*                RGB LED: breathing, energy, event flashes
```
