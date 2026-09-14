#pragma once
#include <Arduino.h>

// Owns the ADC. A FreeRTOS task on core 0 samples the microphone at 5 kHz in
// 20 ms windows (amplitude, not HIGH/LOW), detects claps, and reads the LDR
// (oversampled) once per window. Other code only reads snapshots.
struct AnalogSnapshot {
  uint16_t light = 0;      // ADC counts
  float level = 0;         // sound envelope 0..1
  float peak = 0;          // max window level since the last takePeak()
  float floor = 0;         // adaptive noise floor 0..1
  uint16_t micDc = 0;      // DC bias of the mic output (should be ~mid-scale)
  uint16_t micP2P = 0;     // last window peak-to-peak, counts
  uint32_t clapSeq = 0;
  float clapStrength = 0;
};

class AnalogFront {
 public:
  void begin();
  AnalogSnapshot read();  // thread-safe copy
  float takePeak();       // returns and resets the frame peak
  static bool lightIsAnalog();  // false: bright/dark (module DO); true: light level

 private:
  static void taskEntry(void *self);
  void run();
};
