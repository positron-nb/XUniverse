#include "Imu.h"
#include <Preferences.h>
#include <Wire.h>
#include "../../config.h"
#include "../core/Tunables.h"

static const float RAD2DEG = 57.29578f;

void Imu::writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr_);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

int Imu::readReg(uint8_t reg) {
  Wire.beginTransmission(addr_);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom(addr_, (uint8_t)1) != 1) return -1;
  return Wire.read();
}

// Some clone chips occasionally ignore a write, so each setting is written
// until it reads back correctly (a few tries).
bool Imu::writeVerified(uint8_t reg, uint8_t val) {
  for (int i = 0; i < 4; i++) {
    writeReg(reg, val);
    delay(2);
    if (readReg(reg) == val) return true;
  }
  return false;
}

// WHO_AM_I at one address. Genuine parts answer 0x68; common clones answer
// 0x70 / 0x72 / 0x98 and work the same.
bool Imu::probe(uint8_t addr) {
  Wire.beginTransmission(addr);
  Wire.write(0x75);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, (uint8_t)1) != 1) return false;
  uint8_t id = Wire.read();
  if (id == 0x00 || id == 0xFF) return false;
  who_ = id;
  addr_ = addr;
  return true;
}

bool Imu::begin() {
  lastProbeMs_ = millis();
  // AD0 low → 0x68 (usual), AD0 high → 0x69. Two tries each: a sensor that was
  // mid-transfer when the ESP32 reset can miss the first one.
  present_ = false;
  for (int attempt = 0; attempt < 2 && !present_; attempt++) {
    present_ = probe(IMU_ADDR) || probe(IMU_ADDR ^ 1);
    if (!present_) delay(5);
  }
  if (!present_) return false;

  writeVerified(0x6B, 0x01);  // wake, clock = gyro X PLL
  delay(50);
  writeVerified(0x1A, 0x03);  // DLPF 44 Hz
  writeVerified(0x19, 0x04);  // 1 kHz / (1 + 4) = 200 Hz
  configOk_ = writeVerified(0x1B, 0x08) &  // gyro +-500 deg/s
              writeVerified(0x1C, 0x08);   // accel +-4 g

  // Scale from what the chip is actually set to, not what we asked for: if a
  // setting didn't stick, readings are still correct (1 g stays 1 g).
  int g = readReg(0x1B), a = readReg(0x1C);
  if (a >= 0) accLsb_ = 16384.0f / (1 << ((a >> 3) & 3));
  if (g >= 0) gyrLsb_ = 131.0f / (1 << ((g >> 3) & 3));
  loadCalibration();
  seedFromGravity();
  lastUs_ = micros();
  return true;
}

// Start the filter from gravity so it doesn't slowly swing in from 0.
void Imu::seedFromGravity() {
  int16_t r[7];
  if (!readRaw(r)) return;
  ax = r[0] / accLsb_ - aOff_[0];
  ay = r[1] / accLsb_ - aOff_[1];
  az = r[2] / accLsb_ - aOff_[2];
  roll = atan2f(ay, az) * RAD2DEG;
  pitch = atan2f(-ax, sqrtf(ay * ay + az * az)) * RAD2DEG;
}

bool Imu::readRaw(int16_t out[7]) {
  Wire.beginTransmission(addr_);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr_, (uint8_t)14) != 14) return false;
  for (int i = 0; i < 7; i++) {
    int16_t hi = Wire.read();
    out[i] = (hi << 8) | Wire.read();
  }
  return true;
}

void Imu::update() {
  if (!present_) {
    // Not found (yet): look again every 2 s, so a late-starting or re-plugged
    // sensor is picked up without rebooting.
    if (millis() - lastProbeMs_ > 2000 && begin()) {
      Serial.printf("[imu] MPU6050 found at 0x%02X (WHO_AM_I 0x%02X)\n", addr_, who_);
    }
    return;
  }
  uint32_t now = micros();
  if (now - lastUs_ < 1000000UL / IMU_RATE_HZ) return;
  float dt = (now - lastUs_) * 1e-6f;
  lastUs_ = now;
  if (dt > 0.1f) dt = 0.1f;  // after a long blocking call (DHT read, etc.)

  int16_t r[7];
  if (!readRaw(r)) return;
  ax = r[0] / accLsb_ - aOff_[0];
  ay = r[1] / accLsb_ - aOff_[1];
  az = r[2] / accLsb_ - aOff_[2];
  tempC = r[3] / 340.0f + 36.53f;
  gx = r[4] / gyrLsb_ - gBias_[0];
  gy = r[5] / gyrLsb_ - gBias_[1];
  gz = r[6] / gyrLsb_ - gBias_[2];

  // Complementary filter: gyro for fast motion, gravity to cancel drift.
  // Gravity is trusted much less while the board is being accelerated.
  float mag = sqrtf(ax * ax + ay * ay + az * az);
  float accRoll = atan2f(ay, az) * RAD2DEG;
  float accPitch = atan2f(-ax, sqrtf(ay * ay + az * az)) * RAD2DEG;
  float trust = fabsf(mag - 1.0f) < 0.15f ? 1.0f - IMU_COMP_ALPHA : 0.002f;
  roll = (1 - trust) * (roll + gx * dt) + trust * accRoll;
  pitch = (1 - trust) * (pitch + gy * dt) + trust * accPitch;

  // Shake: a jolt far from 1 g, with a cooldown so one shake = one event.
  float jolt = fabsf(mag - 1.0f);
  uint32_t ms = millis();
  if (jolt > tune.shakeG && ms - lastShakeMs_ > IMU_SHAKE_COOLDOWN_MS) {
    lastShakeMs_ = ms;
    shakeStrength = fminf(1.0f, jolt / 2.0f);
    shakeSeq++;
  }
}

bool Imu::calibrate(Stream &log) {
  if (!present_) return false;
  log.println(F("[imu] calibrating - keep the board still..."));
  const int N = 200;  // 1 s: short enough that the browser link doesn't time out
  double sum[6] = {0};
  float minG = 1e9, maxG = -1e9;
  int16_t r[7];
  for (int i = 0; i < N; i++) {
    if (!readRaw(r)) return false;
    for (int k = 0; k < 3; k++) sum[k] += r[k] / accLsb_;
    for (int k = 0; k < 3; k++) sum[3 + k] += r[4 + k] / gyrLsb_;
    float g = r[4] / gyrLsb_;
    minG = fminf(minG, g);
    maxG = fmaxf(maxG, g);
    delay(5);
  }
  if (maxG - minG > 4.0f) {
    log.println(F("[imu] moved during calibration - try again"));
    return false;
  }
  for (int k = 0; k < 3; k++) gBias_[k] = sum[3 + k] / N;
  float mz = sum[2] / N;
  if (fabsf(mz - 1.0f) < 0.1f) {  // only correct accel offsets when lying flat
    aOff_[0] = sum[0] / N;
    aOff_[1] = sum[1] / N;
    aOff_[2] = mz - 1.0f;
  } else {
    log.println(F("[imu] board not flat: gyro bias only"));
  }
  Preferences p;
  p.begin("positron", false);
  p.putBytes("gbias", gBias_, sizeof(gBias_));
  p.putBytes("aoff", aOff_, sizeof(aOff_));
  p.end();
  seedFromGravity();
  log.printf("[imu] gyro bias %.2f %.2f %.2f  accel offset %.3f %.3f %.3f - saved\n",
             gBias_[0], gBias_[1], gBias_[2], aOff_[0], aOff_[1], aOff_[2]);
  return true;
}

void Imu::loadCalibration() {
  Preferences p;
  if (!p.begin("positron", true)) return;  // nothing saved yet
  if (p.getBytesLength("gbias") == sizeof(gBias_)) p.getBytes("gbias", gBias_, sizeof(gBias_));
  if (p.getBytesLength("aoff") == sizeof(aOff_)) p.getBytes("aoff", aOff_, sizeof(aOff_));
  p.end();
}
