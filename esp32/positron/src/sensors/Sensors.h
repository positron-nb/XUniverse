#pragma once
#include "AnalogFront.h"
#include "Environment.h"
#include "Imu.h"
#include "Ultrasonic.h"

// Everything the board measures, owned in one place.
struct Sensors {
  Imu imu;
  Ultrasonic us;
  AnalogFront analog;
  Environment env;
};
