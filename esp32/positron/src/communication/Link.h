#pragma once
#include <Arduino.h>
#include <functional>

// Wi-Fi + mDNS + WebSocket server.
//   station mode with saved credentials → on failure, access point "POSITRON"
//   ws://positron.local:81  (or the printed IP; 192.168.4.1 in AP mode)
// Frames are broadcast to every connected browser; each new client gets a hello.
class Link {
 public:
  enum class State { Off, Connecting, Station, AccessPoint };

  using HelloBuilder = std::function<size_t(char *, size_t)>;
  using CommandHandler = std::function<void(const String &cmd, const String &json)>;

  void begin(Stream &log, HelloBuilder hello, CommandHandler onCommand);
  void update();
  void broadcast(const char *msg, size_t len);

  // Save new station credentials and reconnect.
  void setCredentials(const String &ssid, const String &pass);
  void forgetCredentials();
  void startAccessPoint();
  void printStatus(Stream &out);

  State state() const { return state_; }
  uint8_t clients() const;

 private:
  void connectStation();
  void startServices();

  Stream *log_ = nullptr;
  State state_ = State::Off;
  String ssid_, pass_;
  uint32_t since_ = 0;
  bool wsStarted_ = false;
  bool wasConnected_ = false;
};
