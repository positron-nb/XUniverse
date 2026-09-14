#pragma once
#include <Arduino.h>

// BME280 (stable ambient reference, forced mode to avoid self-heating) and
// DHT11 (a second, local probe - breath / hand warmth).
class Environment {
 public:
  void begin(Stream &log);
  void update();

  bool bmeOk = false;       // the barometric sensor (BME280 or BMP280) is running
  bool isBmp = false;       // it is a BMP280: no humidity
  uint8_t bmeAddr = 0;
  uint8_t chipId = 0;       // 0x60 = BME280, 0x58 = BMP280 (no humidity)
  bool dhtOk = false;

  float t = NAN, rh = NAN, p = NAN;  // BME280: degC, %, hPa
  float t2 = NAN, rh2 = NAN;         // DHT11:  degC, %
  uint32_t dhtErrors = 0;

  // Best available air temperature (for the ultrasonic speed of sound).
  float airTemp() const { return !isnan(t) ? t : !isnan(t2) ? t2 : 20.0f; }

 private:
  uint32_t lastBme_ = 0;
  uint32_t lastDht_ = 0;
};
