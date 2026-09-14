#include "Link.h"
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include "../../config.h"
#include "JsonLite.h"

#if __has_include("../../secrets.h")
#include "../../secrets.h"
#endif

static WebSocketsServer ws(WS_PORT);
static Link::HelloBuilder helloBuilder;
static Link::CommandHandler commandHandler;
static Stream *logOut = nullptr;
static char helloBuf[512];

static String commandName(const String &json) { return jsonString(json, "cmd"); }

static void onWsEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      IPAddress ip = ws.remoteIP(num);
      if (logOut) logOut->printf("[link] browser %u connected from %s\n", num, ip.toString().c_str());
      size_t n = helloBuilder ? helloBuilder(helloBuf, sizeof(helloBuf)) : 0;
      if (n) ws.sendTXT(num, helloBuf, n);
      break;
    }
    case WStype_DISCONNECTED:
      if (logOut) logOut->printf("[link] browser %u disconnected\n", num);
      break;
    case WStype_TEXT: {
      String json;
      json.reserve(length);
      for (size_t i = 0; i < length && i < 256; i++) json += (char)payload[i];
      String cmd = commandName(json);
      if (cmd.length() && commandHandler) commandHandler(cmd, json);
      break;
    }
    default:
      break;
  }
}

void Link::begin(Stream &log, HelloBuilder hello, CommandHandler onCommand) {
  log_ = logOut = &log;
  helloBuilder = hello;
  commandHandler = onCommand;

  Preferences p;
  if (p.begin("positron", true)) {
    ssid_ = p.getString("ssid", "");
    pass_ = p.getString("pass", "");
    p.end();
  }
#ifdef WIFI_SSID
  if (ssid_.isEmpty()) {
    ssid_ = WIFI_SSID;
    pass_ = WIFI_PASS;
  }
#endif

  WiFi.persistent(false);  // we store credentials ourselves
  WiFi.setHostname(MDNS_NAME);
  if (ssid_.isEmpty()) {
    log.println(F("[link] no Wi-Fi credentials - starting access point"));
    startAccessPoint();
  } else {
    connectStation();
  }
}

void Link::connectStation() {
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // modem sleep adds 50-100 ms latency spikes
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid_.c_str(), pass_.c_str());
  state_ = State::Connecting;
  since_ = millis();
  log_->printf("[link] connecting to \"%s\"...\n", ssid_.c_str());
}

void Link::startAccessPoint() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  WiFi.setSleep(false);
  state_ = State::AccessPoint;
  log_->printf("[link] access point \"%s\" (password \"%s\") - ws://%s:%d\n", AP_SSID, AP_PASS,
               WiFi.softAPIP().toString().c_str(), WS_PORT);
  startServices();
}

void Link::startServices() {
  if (!wsStarted_) {
    ws.begin();
    ws.onEvent(onWsEvent);
    ws.enableHeartbeat(15000, 3000, 2);  // drop browsers that vanished without closing
    wsStarted_ = true;
  }
  MDNS.end();
  if (MDNS.begin(MDNS_NAME)) {
    MDNS.addService("ws", "tcp", WS_PORT);
  }
}

void Link::update() {
  if (state_ == State::Connecting) {
    if (WiFi.status() == WL_CONNECTED) {
      state_ = State::Station;
      wasConnected_ = true;
      log_->printf("[link] connected, IP %s  (RSSI %d dBm)\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
      log_->printf("[link] browser: ws://%s.local:%d  or  ?ws=%s:%d\n", MDNS_NAME, WS_PORT,
                   WiFi.localIP().toString().c_str(), WS_PORT);
      startServices();
    } else if (millis() - since_ > WIFI_CONNECT_TIMEOUT_MS) {
      log_->println(F("[link] could not join Wi-Fi (wrong password? 5 GHz-only network?)"));
      startAccessPoint();
    }
  } else if (state_ == State::Station) {
    bool up = WiFi.status() == WL_CONNECTED;
    if (up != wasConnected_) {
      wasConnected_ = up;
      if (up) {
        log_->printf("[link] reconnected, IP %s\n", WiFi.localIP().toString().c_str());
        startServices();
      } else {
        log_->println(F("[link] Wi-Fi lost - reconnecting"));
      }
    }
  }
  if (wsStarted_) ws.loop();
}

void Link::broadcast(const char *msg, size_t len) {
  if (wsStarted_ && ws.connectedClients() > 0) ws.broadcastTXT(msg, len);
}

uint8_t Link::clients() const { return wsStarted_ ? ws.connectedClients() : 0; }

void Link::setCredentials(const String &ssid, const String &pass) {
  ssid_ = ssid;
  pass_ = pass;
  Preferences p;
  p.begin("positron", false);
  p.putString("ssid", ssid);
  p.putString("pass", pass);
  p.end();
  connectStation();
}

void Link::forgetCredentials() {
  Preferences p;
  p.begin("positron", false);
  p.remove("ssid");
  p.remove("pass");
  p.end();
  ssid_ = pass_ = "";
  log_->println(F("[link] credentials erased"));
  startAccessPoint();
}

void Link::printStatus(Stream &out) {
  const char *names[] = {"off", "connecting", "station", "access point"};
  out.printf("  Wi-Fi    %s", names[(int)state_]);
  if (state_ == State::Station)
    out.printf("  \"%s\"  IP %s  RSSI %d dBm", ssid_.c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
  if (state_ == State::AccessPoint) out.printf("  \"%s\"  IP %s", AP_SSID, WiFi.softAPIP().toString().c_str());
  out.printf("  | ws :%d  clients %u\n", WS_PORT, clients());
}
