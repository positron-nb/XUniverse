#pragma once
#include <Arduino.h>
#include "../sensors/AnalogFront.h"
#include "../sensors/Environment.h"
#include "../sensors/Imu.h"
#include "../sensors/Ultrasonic.h"

// Builds protocol v1 messages (docs/DESIGN.md section 4) without a JSON library.
// Returns the number of bytes written (excluding the terminator).
size_t buildFrame(char *buf, size_t cap, uint32_t seq, const Imu &imu, const Ultrasonic &us,
                  const AnalogSnapshot &a, float soundPeak, const Environment &env);

// {"type":"tune","tune":{...}} — sent after a setting changes.
size_t buildTune(char *buf, size_t cap);

size_t buildHello(char *buf, size_t cap, const Imu &imu, const Ultrasonic &us, const Environment &env,
                  int rateHz);
