#include "SerialConsole.h"
#include <Wire.h>
#include "../../config.h"
#include "../core/Tunables.h"
#include "JsonLite.h"
#include "Packet.h"

static char frameBuf[640];

void SerialConsole::begin() {
  Serial.println();
  Serial.println(F("POSITRON / sensor universe - firmware " FW_VERSION));
  printInfo();
  Serial.println(F("type 'help' for commands"));
}

void SerialConsole::update() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (line_.length()) handle(line_);
      line_ = "";
    } else if (line_.length() < 128) {
      line_ += c;
    }
  }

  uint32_t now = millis();
  switch (mode_) {
    case Mode::Json:
      break;  // frames are pushed by the main loop via sendFrame()
    case Mode::Status:
      if (now - lastOut_ >= STATUS_PERIOD_MS) {
        lastOut_ = now;
        printStatus();
      }
      break;
    case Mode::Test:
      if (now - lastOut_ >= 25) {
        lastOut_ = now;
        printTest();
      }
      break;
    case Mode::Quiet:
      break;
  }
}

void SerialConsole::runCalibration() {
  Mode prev = mode_;
  mode_ = Mode::Quiet;
  s_.imu.calibrate(Serial);
  mode_ = prev;
}

void SerialConsole::handle(String line) {
  line.trim();
  // Only the command word is case-insensitive; Wi-Fi arguments are not.
  int sp = line.indexOf(' ');
  String cmd = sp < 0 ? line : line.substring(0, sp);
  String args = sp < 0 ? "" : line.substring(sp + 1);
  args.trim();
  cmd.toLowerCase();
  if (cmd == "test") {
    args.toLowerCase();
    cmd = "test " + args;
  }

  if (cmd == "wifi") {
    if (args.isEmpty()) {
      link_.printStatus(Serial);
    } else if (args == "forget") {
      link_.forgetCredentials();
    } else if (args == "ap") {
      link_.startAccessPoint();
    } else {
      int last = args.lastIndexOf(' ');
      if (last < 0) {
        Serial.println(F("usage: wifi <ssid> <password>   (open network: wifi <ssid> -)"));
      } else {
        String pass = args.substring(last + 1);
        link_.setCredentials(args.substring(0, last), pass == "-" ? "" : pass);
      }
    }
  } else if (cmd == "json") {
    mode_ = Mode::Json;
    size_t n = buildHello(frameBuf, sizeof(frameBuf), s_.imu, s_.us, s_.env, FRAME_RATE_HZ / SERIAL_FRAME_DIVIDER);
    if (n) Serial.println(frameBuf);
  } else if (cmd == "status") {
    mode_ = Mode::Status;
  } else if (cmd == "quiet") {
    mode_ = Mode::Quiet;
  } else if (cmd.startsWith("test ")) {
    test_ = cmd.substring(5);
    mode_ = Mode::Test;
  } else if (cmd == "scan") {
    mode_ = Mode::Quiet;
    scanI2c();
  } else if (cmd == "cal" || cmd == "calibrate") {
    runCalibration();
  } else if (cmd == "info") {
    printInfo();
  } else if (cmd.startsWith("{")) {
    // A command from the browser's USB link: {"type":"cmd","cmd":"..."}
    String name = jsonString(line, "cmd");
    if (name.length() && command_) command_(name, line);
  } else if (cmd == "led") {
    args.toLowerCase();
    if (command_) command_("led", args == "off" ? "{\"on\":false}" : "{\"on\":true}");
    Serial.printf("[led] %s\n", args == "off" ? "off" : "on");
  } else if (cmd == "get") {
    tune.print(Serial);
  } else if (cmd == "set") {
    int sp2 = args.indexOf(' ');
    if (sp2 < 0 || !tune.set(args.substring(0, sp2), args.substring(sp2 + 1).toFloat())) {
      Serial.println(F("usage: set clap_margin 0.02-0.8 | set mic_scale 100-4095 | set shake_g 0.2-3"));
    }
    tune.print(Serial);
  } else {
    Serial.println(F("commands: status | json | quiet | test mpu|dist|ldr|mic|env | scan | cal | info"));
    Serial.println(F("          wifi | wifi <ssid> <password> | wifi forget | wifi ap"));
    Serial.println(F("          get | set clap_margin|mic_scale|shake_g <value> | led on|off"));
  }
}

void SerialConsole::printInfo() {
  const Environment &e = s_.env;
  Serial.printf("  MPU6050  %s", s_.imu.ok() ? "ok" : "NOT FOUND - check SDA=21 SCL=22, VCC, GND");
  if (s_.imu.ok()) {
    Serial.printf(" at 0x%02X (WHO_AM_I 0x%02X%s)  +-%d g, +-%d deg/s%s", s_.imu.address(), s_.imu.whoAmI(),
                  s_.imu.whoAmI() == 0x68 ? "" : ", clone", s_.imu.accelRangeG(), s_.imu.gyroRangeDps(),
                  s_.imu.configOk() ? "" : " (settings didn't stick; scaled to match)");
  }
  Serial.println();
  if (e.bmeOk) Serial.printf("  %s   ok at 0x%02X%s\n", e.isBmp ? "BMP280" : "BME280", e.bmeAddr,
                             e.isBmp ? " (no humidity: DHT11 supplies it)" : "");
  else if (e.chipId == 0x58) Serial.println(F("  BMP280   found but failed to start"));
  else Serial.println(F("  BME280   NOT FOUND - check wiring; SDO sets address 0x76/0x77"));
  Serial.printf("  DHT11    %s\n", e.dhtOk ? "ok" : "waiting for first reading (needs 10k pull-up on DATA)");
  Serial.printf("  HC-SR04  %s\n", s_.us.valid ? "ok" : "no echo yet (nothing in range, or ECHO/divider wiring)");
  AnalogSnapshot a = s_.analog.read();
  Serial.printf("  LDR      %u counts (%s)\n", a.light,
                AnalogFront::lightIsAnalog() ? "analog light level" : "bright/dark only - DO pin");
#if HAS_MIC
  Serial.printf("  mic      bias %u counts\n", a.micDc);
#endif
  link_.printStatus(Serial);
}

void SerialConsole::printStatus() {
  const Imu &i = s_.imu;
  const Environment &e = s_.env;
  AnalogSnapshot a = s_.analog.read();
  Serial.printf("tilt r%+6.1f p%+6.1f  gyro z%+6.1f | dist %s | ldr %4u | ", i.roll, i.pitch, i.gz,
                s_.us.valid ? String(s_.us.distanceCm, 1).c_str() : "  --", a.light);
#if HAS_MIC
  Serial.printf("snd %.2f (floor %.2f) claps %lu | ", a.level, a.floor, (unsigned long)a.clapSeq);
#endif
  Serial.printf("bme %.1fC %.0f%% %.1fhPa | dht %.0fC %.0f%% | shakes %lu\n", e.t, e.rh, e.p, e.t2, e.rh2,
                (unsigned long)i.shakeSeq);
}

// Serial-Plotter format: label:value pairs separated by spaces.
void SerialConsole::printTest() {
  const Imu &i = s_.imu;
  AnalogSnapshot a = s_.analog.read();
  if (test_ == "mpu") {
    Serial.printf("roll:%.2f pitch:%.2f ax:%.3f ay:%.3f az:%.3f gz:%.1f\n", i.roll, i.pitch, i.ax, i.ay, i.az, i.gz);
  } else if (test_ == "dist") {
    Serial.printf("dist_cm:%.1f valid:%d timeouts:%lu rejects:%lu\n", s_.us.distanceCm, s_.us.valid,
                  (unsigned long)s_.us.timeouts, (unsigned long)s_.us.rejects);
  } else if (test_ == "ldr") {
    Serial.printf("ldr:%u\n", a.light);
  } else if (test_ == "mic") {
    Serial.printf("level:%.3f floor:%.3f p2p:%u dc:%u claps:%lu\n", a.level, a.floor, a.micP2P, a.micDc,
                  (unsigned long)a.clapSeq);
  } else if (test_ == "env") {
    const Environment &e = s_.env;
    Serial.printf("t:%.2f rh:%.1f p:%.2f t2:%.0f rh2:%.0f\n", e.t, e.rh, e.p, e.t2, e.rh2);
  } else {
    Serial.println(F("unknown sensor - use: test mpu|dist|ldr|mic|env"));
    mode_ = Mode::Quiet;
  }
}

void SerialConsole::scanI2c() {
  Serial.println(F("I2C scan (SDA 21, SCL 22):"));
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    // Register-0 read (write + repeated start + read): the one transfer every
    // sensor here answers. An empty write becomes a "probe" call on this ESP32
    // core that times out, and some MPU clones ignore a bare read.
    Wire.beginTransmission(addr);
    Wire.write(0x00);
    if (Wire.endTransmission(false) == 0 && Wire.requestFrom(addr, (uint8_t)1) == 1) {
      while (Wire.available()) Wire.read();
      const char *name = addr == 0x68 || addr == 0x69 ? "MPU6050" : addr == 0x76 || addr == 0x77 ? "BME280/BMP280" : "?";
      Serial.printf("  0x%02X  %s\n", addr, name);
      found++;
    }
  }
  if (!found) Serial.println(F("  nothing - check SDA/SCL, power, common ground"));
}
