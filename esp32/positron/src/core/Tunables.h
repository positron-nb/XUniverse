#pragma once
#include <Arduino.h>

// Thresholds that can be changed at runtime (serial `set <key> <value>` or the
// browser tuning panel) and are persisted in flash. Defaults come from config.h.
struct Tunables {
  float clapMargin;    // level above noise floor that triggers a clap
  float micFullScale;  // peak-to-peak ADC counts mapped to level 1.0
  float shakeG;        // |a| deviation (g) that counts as a shake

  void load();
  void save() const;
  void reset();
  // Returns false if the key is unknown or the value out of range.
  bool set(const String &key, float value);
  void print(Stream &out) const;
};

extern Tunables tune;
