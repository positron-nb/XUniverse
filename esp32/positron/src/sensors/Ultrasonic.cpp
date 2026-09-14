#include "Ultrasonic.h"
#include "../../config.h"
#include "../core/Filters.h"

static volatile uint32_t riseUs = 0;
static volatile uint32_t pulseUs = 0;
static volatile bool fresh = false;
static Median3 median;

static void IRAM_ATTR onEcho() {
  uint32_t now = micros();
  if (digitalRead(PIN_US_ECHO)) {
    riseUs = now;
  } else if (riseUs) {
    pulseUs = now - riseUs;
    fresh = true;
  }
}

void Ultrasonic::begin() {
  pinMode(PIN_US_TRIG, OUTPUT);
  digitalWrite(PIN_US_TRIG, LOW);
  pinMode(PIN_US_ECHO, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_US_ECHO), onEcho, CHANGE);
}

void Ultrasonic::update(float airTempC) {
  uint32_t now = micros();

  if (waiting_ && fresh) {
    noInterrupts();
    uint32_t us = pulseUs;
    fresh = false;
    interrupts();
    waiting_ = false;
    // c = 331.3 + 0.606 T  m/s ; distance = time * c / 2
    float c = 331.3f + 0.606f * airTempC;
    float cm = us * c * 0.5f * 1e-4f;
    if (cm >= US_MIN_CM && cm <= US_MAX_CM) {
      distanceCm = median.push(cm);
      valid = true;
    } else {
      rejects++;
      valid = false;
    }
  } else if (waiting_ && now - lastTrigUs_ > US_TIMEOUT_US + 2000) {
    // Nothing in range (open space) or the echo line is disconnected.
    waiting_ = false;
    timeouts++;
    valid = false;
    median.clear();
  }

  if (!waiting_ && now - lastTrigUs_ >= 1000000UL / US_RATE_HZ) {
    lastTrigUs_ = now;
    riseUs = 0;
    fresh = false;
    waiting_ = true;
    digitalWrite(PIN_US_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_US_TRIG, LOW);
  }
}
