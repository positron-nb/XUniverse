// ─────────────────────────────────────────────────────────────────────────────
// POSITRON firmware configuration — pins, rates and thresholds in one place.
// Pin plan: docs/DESIGN.md §3
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#define FW_VERSION "0.6.5"
#define DEVICE_NAME "positron-esp32"

// ── Pins ────────────────────────────────────────────────────────────────────
#define PIN_I2C_SDA 21
#define PIN_I2C_SCL 22
#define PIN_US_TRIG 5
#define PIN_US_ECHO 18   // through the 1k/2k divider — never direct!
#define PIN_DHT 4
#define PIN_LDR 35       // ADC1_CH7
#define PIN_MIC 36       // ADC1_CH0 (VP)
// Only ADC1 pins (32–39) may be used for analog: ADC2 is unavailable with Wi-Fi.

// LDR hardware on PIN_LDR is detected automatically:
//   • an LDR module's DO pin (comparator output) → bright / dark only
//   • an analog light voltage — a bare LDR divider, or a wire from the LDR
//     module's own LDR leg (no extra resistor needed) → a smooth light level
// LDR_DIGITAL sets the starting assumption (1 = DO until analog values appear).
#define LDR_DIGITAL 1
// Most LM393 LDR modules pull DO LOW when it is bright. Set to 0 if yours is the opposite
// (the field gets darker when you shine a light on it).
#define LDR_DO_LOW_WHEN_BRIGHT 1

// ── Optional RGB LED (Phase 5) ──────────────────────────────────────────────
// 220–330 Ω in series with each colour. Harmless if nothing is connected.
#define LED_ENABLED 1
#define PIN_LED_R 25
#define PIN_LED_G 26
#define PIN_LED_B 27
#define LED_COMMON_ANODE 0   // 1 if the LED's common leg goes to 3V3 instead of GND

// ── Bus / serial ────────────────────────────────────────────────────────────
#define SERIAL_BAUD 460800   // fast enough for every frame over USB (Serial Monitor: 460800)
#define I2C_CLOCK_HZ 400000

// ── Rates ───────────────────────────────────────────────────────────────────
#define IMU_RATE_HZ 200
#define US_RATE_HZ 20
#define BME_PERIOD_MS 1000   // forced mode: avoids self-heating of continuous mode
#define DHT_PERIOD_MS 2000   // DHT11 cannot be read faster than ~1 Hz
#define FRAME_RATE_HZ 30       // protocol frames (WebSocket)
#define SERIAL_FRAME_DIVIDER 1 // USB gets every frame (30 Hz; ~10 kB/s, well within 460800 baud)
#define STATUS_PERIOD_MS 500

// ── Network (Phase 3) ───────────────────────────────────────────────────────
// Credentials: serial command `wifi <ssid> <password>` (saved in flash), or
// secrets.h (copy secrets.example.h). With none, the board starts its own AP.
#define MDNS_NAME "positron"          // → ws://positron.local:81
#define WS_PORT 81
#define AP_SSID "POSITRON"
#define AP_PASS "positron"            // ≥ 8 characters; AP address is 192.168.4.1
#define WIFI_CONNECT_TIMEOUT_MS 12000

// ── MPU6050 ─────────────────────────────────────────────────────────────────
#define IMU_ADDR 0x68            // 0x69 if AD0 is pulled high
#define IMU_COMP_ALPHA 0.98f     // complementary filter: gyro share
#define IMU_SHAKE_G 0.65f        // |a| deviation from 1 g that counts as a shake
#define IMU_SHAKE_COOLDOWN_MS 600

// ── HC-SR04 ─────────────────────────────────────────────────────────────────
#define US_MIN_CM 2.0f
#define US_MAX_CM 400.0f
#define US_TIMEOUT_US 26000      // ≈ 4.4 m round trip

// ── Sound ───────────────────────────────────────────────────────────────────
// Set to 1 only when a sound module is wired to PIN_MIC. With nothing
// connected the pin floats and its noise would read as claps, so the firmware
// skips the microphone entirely and reports "sound": null.
#define HAS_MIC 0
#define MIC_SAMPLE_US 200        // 5 kHz sampling
#define MIC_WINDOW_MS 20         // analysis window (also the LDR rate: 50 Hz)
#define MIC_FULL_SCALE 1800.0f   // peak-to-peak ADC counts that map to level 1.0
#define MIC_RELEASE_MS 90.0f     // envelope release time constant
#define CLAP_MARGIN 0.12f        // level above the adaptive noise floor to trigger
#define CLAP_CONFIRM_MS 150      // a clap must decay within this time (rejects voice/music)
#define CLAP_COOLDOWN_MS 250

// ── Analog controls ─────────────────────────────────────────────────────────
#define ANALOG_OVERSAMPLE 8
