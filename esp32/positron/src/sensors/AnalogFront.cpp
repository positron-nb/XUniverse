#include "AnalogFront.h"
#include "../../config.h"
#include "../core/Tunables.h"

static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static AnalogSnapshot shared;

void AnalogFront::begin() {
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);  // full 0..3.3 V range
  pinMode(PIN_LDR, INPUT);
#if HAS_MIC
  pinMode(PIN_MIC, INPUT);
#endif
  xTaskCreatePinnedToCore(taskEntry, "analog", 4096, this, 1, nullptr, 0);
}

AnalogSnapshot AnalogFront::read() {
  portENTER_CRITICAL(&mux);
  AnalogSnapshot s = shared;
  portEXIT_CRITICAL(&mux);
  return s;
}

float AnalogFront::takePeak() {
  portENTER_CRITICAL(&mux);
  float p = shared.peak;
  shared.peak = shared.level;
  portEXIT_CRITICAL(&mux);
  return p;
}

void AnalogFront::taskEntry(void *self) { static_cast<AnalogFront *>(self)->run(); }

[[maybe_unused]] static uint16_t oversample(int pin) {
  uint32_t sum = 0;
  for (int i = 0; i < ANALOG_OVERSAMPLE; i++) sum += analogRead(pin);
  return sum / ANALOG_OVERSAMPLE;
}

// Light in ADC counts. Works with whatever is wired to PIN_LDR:
//  • an LDR module's DO pin (comparator: only ever ~0 or ~4095) → bright/dark,
//    corrected for the module's inverted logic, reported as 4095 / 0;
//  • an analog light voltage (bare LDR divider, or the module's LDR leg) →
//    the level itself. Detected by sustained mid-range readings, which a
//    comparator output never produces.
static bool ldrAnalog = !LDR_DIGITAL;
static uint8_t midWindows = 0;

static uint16_t readLight() {
  uint16_t raw = oversample(PIN_LDR);
  if (!ldrAnalog) {
    bool mid = raw > 250 && raw < 3850;
    if (mid) {
      if (++midWindows > 25) ldrAnalog = true;  // ~0.5 s of genuine in-between values
    } else if (midWindows > 0) {
      midWindows--;
    }
  }
  if (ldrAnalog) return raw;
  bool high = raw > 2048;
  bool bright = LDR_DO_LOW_WHEN_BRIGHT ? !high : high;
  return bright ? 4095 : 0;
}

bool AnalogFront::lightIsAnalog() { return ldrAnalog; }

void AnalogFront::run() {
#if !HAS_MIC
  // No microphone: just the light sensor at 50 Hz.
  for (;;) {
    uint16_t light = readLight();
    portENTER_CRITICAL(&mux);
    shared.light = light;
    portEXIT_CRITICAL(&mux);
    vTaskDelay(pdMS_TO_TICKS(MIC_WINDOW_MS));
  }
#endif
  const float windowSec = MIC_WINDOW_MS / 1000.0f;
  const float releaseK = 1.0f - expf(-MIC_WINDOW_MS / MIC_RELEASE_MS);
  float envelope = 0;
  float noiseFloor = 0.03f;
  bool armed = true;
  float pendingPeak = 0;       // clap candidate awaiting decay confirmation
  uint32_t pendingSince = 0;
  uint32_t lastClap = 0;
  uint32_t clapSeq = 0;
  float clapStrength = 0;

  for (;;) {
    // ── Sample one window of audio ───────────────────────────────────────
    uint16_t lo = 4095, hi = 0;
    uint32_t sum = 0;
    int n = 0;
    uint32_t start = micros();
    uint32_t next = start;
    while (micros() - start < MIC_WINDOW_MS * 1000UL) {
      while ((int32_t)(micros() - next) < 0) {}
      next += MIC_SAMPLE_US;
      uint16_t v = analogRead(PIN_MIC);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
      n++;
    }
    uint16_t p2p = hi - lo;
    float level = fminf(1.0f, p2p / tune.micFullScale);
    const float margin = tune.clapMargin;

    // Envelope: instant attack, exponential release.
    envelope = level > envelope ? level : envelope + (level - envelope) * releaseK;

    // Adaptive noise floor, learned only from quiet windows so a clap can't raise it.
    if (level < noiseFloor + margin * 0.5f) noiseFloor += (level - noiseFloor) * (windowSec / 3.0f);

    // ── Clap detection: threshold → peak → must decay quickly → cooldown ──
    uint32_t now = millis();
    float excess = level - noiseFloor;
    if (!armed && excess < margin * 0.4f && pendingPeak == 0) armed = true;
    if (armed && excess > margin && now - lastClap > CLAP_COOLDOWN_MS) {
      armed = false;
      pendingPeak = level;
      pendingSince = now;
    }
    if (pendingPeak > 0) {
      if (level > pendingPeak) pendingPeak = level;
      float decayed = noiseFloor + (pendingPeak - noiseFloor) * 0.4f;
      if (level < decayed) {
        // Transient confirmed: a clap/knock, not speech or music.
        clapStrength = fminf(1.0f, (pendingPeak - noiseFloor) / (1.0f - noiseFloor + 1e-3f));
        clapSeq++;
        lastClap = now;
        pendingPeak = 0;
      } else if (now - pendingSince > CLAP_CONFIRM_MS) {
        pendingPeak = 0;  // sustained sound — reject
      }
    }

    // ── Light sensor, once per window ─────────────────────────────────────
    uint16_t light = readLight();

    portENTER_CRITICAL(&mux);
    shared.light = light;
    shared.level = envelope;
    if (envelope > shared.peak) shared.peak = envelope;
    shared.floor = noiseFloor;
    shared.micDc = n ? sum / n : 0;
    shared.micP2P = p2p;
    shared.clapSeq = clapSeq;
    shared.clapStrength = clapStrength;
    portEXIT_CRITICAL(&mux);

    vTaskDelay(1);  // let the idle task (and Wi-Fi in Phase 3) run
  }
}
