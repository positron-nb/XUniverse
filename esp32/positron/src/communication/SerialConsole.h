#pragma once
#include <Arduino.h>
#include "../sensors/Sensors.h"
#include "Link.h"

// USB serial: human bring-up console + protocol frames for the browser (Web Serial).
//
//   help                    list commands
//   status                  readable summary every 0.5 s (default)
//   json                    protocol v1 frames (what the browser's USB link uses)
//   quiet                   stop periodic output
//   test <sensor>           focused, Serial-Plotter friendly: mpu|dist|ldr|mic|env
//   scan                    I2C bus scan
//   cal                     MPU6050 calibration (keep still, ideally flat)
//   info                    detected hardware + network
//   wifi <ssid> <password>  join a network (saved; password is the last word)
//   wifi forget | wifi ap   erase credentials / force access-point mode
//   get | set <key> <value> runtime thresholds: clap_margin, mic_scale, shake_g (saved)
class SerialConsole {
 public:
  SerialConsole(Sensors &s, Link &link) : s_(s), link_(link) {}
  void begin();
  void update();
  void printInfo();

  // JSON commands arriving over USB go to the same handler as Wi-Fi commands.
  void onCommand(Link::CommandHandler h) { command_ = h; }

  bool wantsFrames() const { return mode_ == Mode::Json; }
  void sendFrame(const char *frame) { Serial.println(frame); }
  void runCalibration();

 private:
  enum class Mode { Status, Json, Quiet, Test };
  void handle(String line);
  void printStatus();
  void printTest();
  void scanI2c();

  Sensors &s_;
  Link &link_;
  Link::CommandHandler command_;
  Mode mode_ = Mode::Status;
  String test_;
  String line_;
  uint32_t lastOut_ = 0;
};
