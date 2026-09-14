#include "Packet.h"
#include "../../config.h"
#include "../core/Tunables.h"

#define TUNE_FMT "{\"clap_margin\":%.3f,\"mic_scale\":%.0f,\"shake_g\":%.2f}"

// Appends a number, or null when the value is missing.
static int num(char *p, size_t cap, float v, int decimals) {
  if (isnan(v)) return snprintf(p, cap, "null");
  return snprintf(p, cap, "%.*f", decimals, v);
}

#define APPEND(...)                                   \
  do {                                                \
    int w = snprintf(buf + n, cap - n, __VA_ARGS__);  \
    if (w < 0 || (size_t)w >= cap - n) return 0;      \
    n += w;                                           \
  } while (0)

#define APPEND_NUM(v, d)                              \
  do {                                                \
    int w = num(buf + n, cap - n, (v), (d));          \
    if (w < 0 || (size_t)w >= cap - n) return 0;      \
    n += w;                                           \
  } while (0)

size_t buildFrame(char *buf, size_t cap, uint32_t seq, const Imu &imu, const Ultrasonic &us,
                  const AnalogSnapshot &a, float soundPeak, const Environment &env) {
  size_t n = 0;
  APPEND("{\"type\":\"frame\",\"v\":1,\"seq\":%lu,\"t\":%lu,", (unsigned long)seq, (unsigned long)millis());
  if (imu.ok()) {
    APPEND("\"mpu\":{\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f,\"gx\":%.2f,\"gy\":%.2f,\"gz\":%.2f,"
           "\"roll\":%.2f,\"pitch\":%.2f},",
           imu.ax, imu.ay, imu.az, imu.gx, imu.gy, imu.gz, imu.roll, imu.pitch);
  } else {
    APPEND("\"mpu\":null,");
  }
  APPEND("\"dist\":");
  APPEND_NUM(us.valid ? us.distanceCm : NAN, 1);
  APPEND(",\"light\":%u,", a.light);
#if HAS_MIC
  APPEND("\"sound\":{\"level\":%.3f,\"peak\":%.3f},", a.level, soundPeak);
#else
  (void)soundPeak;
  APPEND("\"sound\":null,");
#endif
  APPEND("\"env\":{\"t\":");
  APPEND_NUM(env.t, 2);
  APPEND(",\"rh\":");
  APPEND_NUM(env.rh, 1);
  APPEND(",\"p\":");
  APPEND_NUM(env.p, 2);
  APPEND(",\"t2\":");
  APPEND_NUM(env.t2, 0);
  APPEND(",\"rh2\":");
  APPEND_NUM(env.rh2, 0);
  APPEND("},\"ev\":{\"clap\":[%lu,%.2f],\"shake\":[%lu,%.2f]}}", (unsigned long)a.clapSeq, a.clapStrength,
         (unsigned long)imu.shakeSeq, imu.shakeStrength);
  return n;
}

size_t buildHello(char *buf, size_t cap, const Imu &imu, const Ultrasonic &us, const Environment &env,
                  int rateHz) {
  size_t n = 0;
  APPEND("{\"type\":\"hello\",\"v\":1,\"device\":\"%s\",\"fw\":\"%s\",\"sensors\":{"
         "\"mpu6050\":%s,\"%s\":%s,\"dht11\":%s,\"hcsr04\":%s,\"mic\":%s},\"rate\":%d}",
         DEVICE_NAME, FW_VERSION, imu.ok() ? "true" : "false", env.isBmp ? "bmp280" : "bme280",
         env.bmeOk ? "true" : "false",
         env.dhtOk ? "true" : "false", us.timeouts < 20 || us.valid ? "true" : "false",
         HAS_MIC ? "true" : "false", rateHz);
  n--;  // drop the closing brace and append the current device tunables
  APPEND(",\"tune\":" TUNE_FMT "}", tune.clapMargin, tune.micFullScale, tune.shakeG);
  return n;
}

size_t buildTune(char *buf, size_t cap) {
  size_t n = 0;
  APPEND("{\"type\":\"tune\",\"tune\":" TUNE_FMT "}", tune.clapMargin, tune.micFullScale, tune.shakeG);
  return n;
}
