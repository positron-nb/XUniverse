#pragma once
#include <Arduino.h>

// Tiny field extraction for the small, flat command messages the browser sends:
//   {"type":"cmd","cmd":"set","key":"clap_margin","value":0.1}
inline String jsonString(const String &json, const char *key) {
  String k = String('"') + key + '"';
  int i = json.indexOf(k);
  if (i < 0) return "";
  int a = json.indexOf('"', json.indexOf(':', i + k.length()) + 1);
  int b = json.indexOf('"', a + 1);
  return a < 0 || b < 0 ? "" : json.substring(a + 1, b);
}

// The raw characters of a numeric field, e.g. a timestamp echoed back verbatim
// (a float would lose precision on large millisecond values).
inline String jsonRawNumber(const String &json, const char *key) {
  String k = String('"') + key + '"';
  int i = json.indexOf(k);
  if (i < 0) return "";
  int c = json.indexOf(':', i + k.length());
  if (c < 0) return "";
  int a = c + 1;
  while (a < (int)json.length() && json[a] == ' ') a++;
  int b = a;
  while (b < (int)json.length() && (isDigit(json[b]) || json[b] == '.' || json[b] == '-')) b++;
  return json.substring(a, b);
}

inline float jsonNumber(const String &json, const char *key, float fallback = NAN) {
  String k = String('"') + key + '"';
  int i = json.indexOf(k);
  if (i < 0) return fallback;
  int c = json.indexOf(':', i + k.length());
  if (c < 0) return fallback;
  return json.substring(c + 1).toFloat();
}
