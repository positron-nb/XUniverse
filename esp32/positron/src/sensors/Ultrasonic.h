#pragma once
#include <Arduino.h>

// HC-SR04 measured with a pin-change interrupt instead of pulseIn(), so the
// main loop never blocks for up to 26 ms waiting for an echo.
// Distance uses the speed of sound at the *measured* air temperature.
class Ultrasonic {
 public:
  void begin();
  void update(float airTempC);  // call often; triggers at US_RATE_HZ

  bool valid = false;      // last reading in range
  float distanceCm = 0;    // median-filtered
  uint32_t timeouts = 0;   // diagnostics
  uint32_t rejects = 0;

 private:
  uint32_t lastTrigUs_ = 0;
  bool waiting_ = false;
};
