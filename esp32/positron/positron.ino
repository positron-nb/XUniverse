// POSITRON / sensor universe - ESP32 firmware
//
// Board: "ESP32 Dev Module" (arduino-esp32 core 3.x)
// Libraries: Adafruit BME280 Library, Adafruit Unified Sensor, DHT sensor library,
//            WebSockets (by Markus Sattler / Links2004)
//
// Core 0: Wi-Fi stack + AnalogFront task (LDR; microphone 5 kHz when HAS_MIC)
// Core 1: this loop - IMU 200 Hz, ultrasonic 20 Hz, environment, frames, serial, WebSocket

#include <Wire.h>
#include "config.h"
#include "src/core/Tunables.h"
#include "src/communication/JsonLite.h"
#include "src/communication/Link.h"
#include "src/communication/Packet.h"
#include "src/communication/SerialConsole.h"
#include "src/feedback/Led.h"
#include "src/sensors/Sensors.h"

Sensors sensors;
Link netLink;
SerialConsole console(sensors, netLink);
Led led;

static char frame[640];
static uint32_t frameSeq = 0;
static uint32_t lastFrameUs = 0;

void handleCommand(const String &cmd, const String &json);

// If the ESP32 reset in the middle of an I2C transfer, a sensor (still powered)
// may be holding SDA low, waiting for clock pulses that never came. Clocking SCL
// up to 9 times lets it finish its byte and release the bus; a STOP resets it.
static void recoverI2cBus() {
  pinMode(PIN_I2C_SDA, INPUT_PULLUP);
  pinMode(PIN_I2C_SCL, INPUT_PULLUP);
  delayMicroseconds(10);
  if (digitalRead(PIN_I2C_SDA) == HIGH) return;  // bus is free
  pinMode(PIN_I2C_SCL, OUTPUT_OPEN_DRAIN);
  for (int i = 0; i < 9 && digitalRead(PIN_I2C_SDA) == LOW; i++) {
    digitalWrite(PIN_I2C_SCL, LOW);
    delayMicroseconds(5);
    digitalWrite(PIN_I2C_SCL, HIGH);
    delayMicroseconds(5);
  }
  pinMode(PIN_I2C_SDA, OUTPUT_OPEN_DRAIN);  // STOP: SDA rises while SCL is high
  digitalWrite(PIN_I2C_SDA, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_I2C_SDA, HIGH);
  delayMicroseconds(5);
  pinMode(PIN_I2C_SDA, INPUT);
  pinMode(PIN_I2C_SCL, INPUT);
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(300);
  recoverI2cBus();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_CLOCK_HZ);
  // Sensor transfers take well under 1 ms; a short timeout keeps a missing
  // device from stalling the loop.
  Wire.setTimeOut(20);
  tune.load();  // before the sensor tasks start reading thresholds

  sensors.imu.begin();
  sensors.env.begin(Serial);
  sensors.us.begin();
  sensors.analog.begin();
  delay(100);  // let the analog task fill its first windows

  netLink.begin(
      Serial,
      [](char *buf, size_t cap) { return buildHello(buf, cap, sensors.imu, sensors.us, sensors.env, FRAME_RATE_HZ); },
      handleCommand);
  console.onCommand(handleCommand);
  led.begin();
  console.begin();
}

// Commands from the browser, over Wi-Fi or USB.
void handleCommand(const String &cmd, const String &json) {
  if (cmd == "ping") {
    // Heartbeat: echo the browser's timestamp so it can measure round-trip time.
    String t = jsonRawNumber(json, "t");
    if (t.length()) {
      int n = snprintf(frame, sizeof(frame), "{\"type\":\"pong\",\"t\":%s}", t.c_str());
      netLink.broadcast(frame, n);
      if (console.wantsFrames()) console.sendFrame(frame);
    }
  } else if (cmd == "calibrate") {
    console.runCalibration();
  } else if (cmd == "set") {
    if (tune.set(jsonString(json, "key"), jsonNumber(json, "value"))) {
      // Echo the accepted values so every open browser shows the truth.
      size_t n = buildTune(frame, sizeof(frame));
      if (n) {
        netLink.broadcast(frame, n);
        if (console.wantsFrames()) console.sendFrame(frame);
      }
    }
  } else if (cmd == "led") {
    // {"type":"cmd","cmd":"led","on":true|false}
    led.setEnabled(json.indexOf("false") < 0);
  }
}

// One frame is built per tick and shared by every output, so the sound peak
// and event counters are consistent whichever link the browser uses.
static void emitFrame() {
  uint32_t now = micros();
  if (now - lastFrameUs < 1000000UL / FRAME_RATE_HZ) return;
  lastFrameUs = now;

  bool usb = console.wantsFrames() && frameSeq % SERIAL_FRAME_DIVIDER == 0;
  bool wifi = netLink.clients() > 0;
  if (!usb && !wifi) {
    frameSeq++;
    return;
  }
  AnalogSnapshot a = sensors.analog.read();
  size_t n = buildFrame(frame, sizeof(frame), frameSeq++, sensors.imu, sensors.us, a, sensors.analog.takePeak(),
                        sensors.env);
  if (!n) return;
  if (wifi) netLink.broadcast(frame, n);
  if (usb) console.sendFrame(frame);
}

void loop() {
  sensors.imu.update();
  sensors.us.update(sensors.env.airTemp());
  sensors.env.update();
  netLink.update();
  console.update();
  emitFrame();

  AnalogSnapshot a = sensors.analog.read();
  led.update(a.clapSeq, a.clapStrength, sensors.imu.shakeSeq, sensors.imu.shakeStrength,
             netLink.clients() > 0);
}
