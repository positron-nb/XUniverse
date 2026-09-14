#pragma once
#include <math.h>

// Exponential moving average with a time constant, independent of call rate.
struct Ema {
  float value = 0;
  bool primed = false;
  float push(float x, float dtSec, float tauSec) {
    if (!primed) { value = x; primed = true; return value; }
    float k = 1.0f - expf(-dtSec / tauSec);
    value += (x - value) * k;
    return value;
  }
};

// Median of the last 3 samples — removes single spikes with no lag penalty.
struct Median3 {
  float b[3] = {0, 0, 0};
  int n = 0;
  float push(float x) {
    b[0] = b[1]; b[1] = b[2]; b[2] = x;
    if (n < 3) n++;
    if (n < 3) return x;
    float a = b[0], c = b[1], d = b[2];
    if (a > c) { float t = a; a = c; c = t; }
    if (c > d) { c = d; }
    return a > c ? a : c;
  }
  void clear() { n = 0; }
};
