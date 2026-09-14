#include "Led.h"
#include "../../config.h"

static const int LED_FREQ = 5000;
static const int LED_BITS = 10;
static const int LED_MAX = (1 << LED_BITS) - 1;

void Led::begin() {
#if LED_ENABLED
  // arduino-esp32 3.x LEDC API
  ledcAttach(PIN_LED_R, LED_FREQ, LED_BITS);
  ledcAttach(PIN_LED_G, LED_FREQ, LED_BITS);
  ledcAttach(PIN_LED_B, LED_FREQ, LED_BITS);
  write(0, 0, 0);
#endif
  lastUs_ = micros();
}

void Led::setEnabled(bool on) {
  enabled_ = on;
  if (!on) write(0, 0, 0);
}

// Perceptual (gamma 2.2) brightness → PWM duty.
static uint32_t duty(float v) {
  v = constrain(v, 0.0f, 1.0f);
  uint32_t d = (uint32_t)(powf(v, 2.2f) * LED_MAX + 0.5f);
#if LED_COMMON_ANODE
  d = LED_MAX - d;
#endif
  return d;
}

void Led::write(float r, float g, float b) {
#if LED_ENABLED
  ledcWrite(PIN_LED_R, duty(r));
  ledcWrite(PIN_LED_G, duty(g));
  ledcWrite(PIN_LED_B, duty(b));
#endif
}

void Led::update(uint32_t clapSeq, float clapStrength, uint32_t shakeSeq, float shakeStrength,
                 bool browserConnected) {
  uint32_t now = micros();
  if (now - lastUs_ < 20000) return;  // 50 Hz is plenty for an LED
  float dt = (now - lastUs_) * 1e-6f;
  lastUs_ = now;
  if (!enabled_) return;

  // Events: first counters seen are only recorded (no flash at boot).
  if (!primed_) {
    lastClap_ = clapSeq;
    lastShake_ = shakeSeq;
    primed_ = true;
  }
  if (clapSeq != lastClap_) {
    lastClap_ = clapSeq;
    flash_ = fmaxf(flash_, 0.35f + 0.65f * clapStrength);
    bool extreme = clapStrength >= 0.85f;
    flashR_ = 1.0f;
    flashG_ = extreme ? 0.16f : 0.92f;
    flashB_ = extreme ? 0.08f : 0.85f;
  }
  if (shakeSeq != lastShake_) {
    lastShake_ = shakeSeq;
    flash_ = fmaxf(flash_, 0.3f + 0.5f * shakeStrength);
    flashR_ = 1.0f; flashG_ = 0.55f; flashB_ = 0.16f;  // amber
  }
  flash_ *= expf(-dt / 0.16f);

  // Calm breathing in warm white: 5 s period with a browser, 8 s when idle.
  phase_ += dt * 6.2832f / (browserConnected ? 5.0f : 8.0f);
  if (phase_ > 6.2832f) phase_ -= 6.2832f;
  float breath = 0.5f - 0.5f * cosf(phase_);
  float intensity = 0.06f + 0.14f * breath;

  write(intensity + flashR_ * flash_, 0.75f * intensity + flashG_ * flash_, 0.47f * intensity + flashB_ * flash_);
}
