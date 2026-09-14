#include "Tunables.h"
#include <Preferences.h>
#include "../../config.h"

Tunables tune;

void Tunables::reset() {
  clapMargin = CLAP_MARGIN;
  micFullScale = MIC_FULL_SCALE;
  shakeG = IMU_SHAKE_G;
}

void Tunables::load() {
  reset();
  Preferences p;
  if (!p.begin("positron", true)) return;
  clapMargin = p.getFloat("clapMargin", clapMargin);
  micFullScale = p.getFloat("micScale", micFullScale);
  shakeG = p.getFloat("shakeG", shakeG);
  p.end();
}

void Tunables::save() const {
  Preferences p;
  p.begin("positron", false);
  p.putFloat("clapMargin", clapMargin);
  p.putFloat("micScale", micFullScale);
  p.putFloat("shakeG", shakeG);
  p.end();
}

bool Tunables::set(const String &key, float v) {
  if (key == "clap_margin" && v >= 0.02f && v <= 0.8f) clapMargin = v;
  else if (key == "mic_scale" && v >= 100 && v <= 4095) micFullScale = v;
  else if (key == "shake_g" && v >= 0.2f && v <= 3.0f) shakeG = v;
  else return false;
  save();
  return true;
}

void Tunables::print(Stream &out) const {
  out.printf("  clap_margin %.3f   mic_scale %.0f   shake_g %.2f\n", clapMargin, micFullScale, shakeG);
}
