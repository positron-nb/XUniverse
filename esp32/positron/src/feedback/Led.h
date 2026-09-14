#pragma once
#include <Arduino.h>

// Physical feedback on an RGB LED, computed on the board itself so it has no
// network latency and works without a browser:
//   calm            slow warm-white breathing (slower still when no browser is connected)
//   clap / shake    a short flash; an extreme clap flashes muted red
// Same palette as the screen: warm white, amber, red only for extremes.
class Led {
 public:
  void begin();
  // Event counters from the sensors, and whether a browser is connected.
  void update(uint32_t clapSeq, float clapStrength, uint32_t shakeSeq, float shakeStrength, bool browserConnected);
  void setEnabled(bool on);
  bool enabled() const { return enabled_; }

 private:
  void write(float r, float g, float b);

  bool enabled_ = true;
  uint32_t lastUs_ = 0;
  uint32_t lastClap_ = 0, lastShake_ = 0;
  bool primed_ = false;
  float flash_ = 0;
  float flashR_ = 1, flashG_ = 1, flashB_ = 1;
  float phase_ = 0;
};
