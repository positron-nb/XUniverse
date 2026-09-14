#include "Environment.h"
#include <Adafruit_BME280.h>
#include <Adafruit_BMP280.h>
#include <DHT.h>
#include <Wire.h>
#include "../../config.h"

static Adafruit_BME280 bme;
static Adafruit_BMP280 bmp(&Wire);
static DHT dht(PIN_DHT, DHT11);

static uint8_t readChipId(uint8_t addr) {
  Wire.beginTransmission(addr);
  Wire.write(0xD0);
  if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom(addr, (uint8_t)1) != 1) return 0;
  return Wire.read();
}

void Environment::begin(Stream &log) {
  for (uint8_t addr : {(uint8_t)0x76, (uint8_t)0x77}) {
    uint8_t id = readChipId(addr);
    if (id == 0 || id == 0xFF) continue;
    bmeAddr = addr;
    chipId = id;
    break;
  }
  if (chipId == 0x58) {
    // BMP280 (often sold as "BME280"): temperature + pressure, no humidity.
    // Humidity then comes from the DHT11.
    isBmp = true;
    bmeOk = bmp.begin(bmeAddr, 0x58);
    if (bmeOk) {
      bmp.setSampling(Adafruit_BMP280::MODE_FORCED,
                      Adafruit_BMP280::SAMPLING_X2,   // temperature
                      Adafruit_BMP280::SAMPLING_X4,   // pressure
                      Adafruit_BMP280::FILTER_X4,
                      Adafruit_BMP280::STANDBY_MS_1);
      log.println(F("[env] BMP280 found: temperature + pressure; humidity from the DHT11"));
    }
  } else if (chipId == 0x60) {
    bmeOk = bme.begin(bmeAddr, &Wire);
    if (bmeOk) {
      // Forced mode: one measurement on request, sensor sleeps in between.
      // Continuous mode self-heats the die by ~0.5-1 degC.
      bme.setSampling(Adafruit_BME280::MODE_FORCED,
                      Adafruit_BME280::SAMPLING_X2,   // temperature
                      Adafruit_BME280::SAMPLING_X4,   // pressure (~19 ms total conversion)
                      Adafruit_BME280::SAMPLING_X1,   // humidity
                      Adafruit_BME280::FILTER_X4);
    }
  } else if (chipId != 0) {
    log.printf("[env] unknown chip id 0x%02X at 0x%02X\n", chipId, bmeAddr);
  }

  dht.begin();
  lastDht_ = millis() - DHT_PERIOD_MS + 1500;  // DHT11 needs ~1 s after power-up
  lastBme_ = millis() - BME_PERIOD_MS;
}

void Environment::update() {
  uint32_t now = millis();
  if (bmeOk && now - lastBme_ >= BME_PERIOD_MS) {
    lastBme_ = now;
    if (isBmp) {
      if (bmp.takeForcedMeasurement()) {
        t = bmp.readTemperature();
        p = bmp.readPressure() / 100.0f;
      }
    } else if (bme.takeForcedMeasurement()) {
      t = bme.readTemperature();
      rh = bme.readHumidity();
      p = bme.readPressure() / 100.0f;
    }
  }
  if (now - lastDht_ >= DHT_PERIOD_MS) {
    lastDht_ = now;
    // Blocks ~25 ms with interrupts briefly disabled; the IMU filter tolerates it
    // because it integrates using the real dt.
    float h = dht.readHumidity();
    float c = dht.readTemperature();
    if (isnan(h) || isnan(c)) {
      dhtErrors++;
      if (dhtErrors > 5 && dhtOk) dhtOk = false;
    } else {
      rh2 = h;
      t2 = c;
      dhtOk = true;
      dhtErrors = 0;
    }
  }
}
