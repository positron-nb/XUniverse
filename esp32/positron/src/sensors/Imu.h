#pragma once
#include <Arduino.h>

// MPU6050 driven directly over I²C (no library): ±4 g, ±500 °/s, 44 Hz DLPF,
// 200 Hz sampling, complementary filter for roll/pitch, shake detection.
class Imu {
 public:
  bool begin();
  void update();  // call often; samples at IMU_RATE_HZ

  // Keep the board still: measures gyro bias (and accel offset if flat), saves to flash.
  bool calibrate(Stream &log);

  bool ok() const { return present_; }
  uint8_t whoAmI() const { return who_; }
  uint8_t address() const { return addr_; }
  /** Full-scale ranges actually in effect (read back from the chip). */
  int accelRangeG() const { return (int)(32768.0f / accLsb_ + 0.5f); }
  int gyroRangeDps() const { return (int)(32768.0f / gyrLsb_ + 0.5f); }
  bool configOk() const { return configOk_; }

  float ax = 0, ay = 0, az = 1;  // g
  float gx = 0, gy = 0, gz = 0;  // °/s, bias removed
  float roll = 0, pitch = 0;     // °
  float tempC = 0;               // die temperature (diagnostic only)

  uint32_t shakeSeq = 0;
  float shakeStrength = 0;

 private:
  bool probe(uint8_t addr);
  int readReg(uint8_t reg);
  bool writeVerified(uint8_t reg, uint8_t val);
  bool readRaw(int16_t out[7]);
  void writeReg(uint8_t reg, uint8_t val);
  void loadCalibration();
  void seedFromGravity();

  bool present_ = false;
  uint8_t who_ = 0;
  uint8_t addr_ = 0x68;
  // Counts per g and per deg/s, read back from the chip's range registers.
  float accLsb_ = 8192.0f;
  float gyrLsb_ = 65.5f;
  bool configOk_ = false;
  uint32_t lastProbeMs_ = 0;
  uint32_t lastUs_ = 0;
  uint32_t lastShakeMs_ = 0;
  float gBias_[3] = {0, 0, 0};
  float aOff_[3] = {0, 0, 0};
};
