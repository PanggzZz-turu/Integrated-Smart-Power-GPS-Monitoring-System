/*
 * ========================================
 * WATTSCOPE - ESP32 Real Sensor Publisher
 * Koneksi: SIM800L (Utama) + WiFi (Fallback)
 * ========================================
 *
 * LOGIKA KONEKSI:
 * --------------
 * 1. Boot → Coba SIM800L dulu (maks 3x percobaan)
 * 2. Jika SIM800L gagal → Fallback ke WiFi
 * 3. WiFi aktif → data tetap terkirim via WiFi
 * 4. Background task retry SIM800L terus setiap 60 detik
 * 5. Begitu SIM800L berhasil → WiFi dimatikan, pindah ke SIM800L
 *
 * PIN CONFIGURATION:
 * ------------------
 * GPS Module:
 *   TX  → GPIO 25
 *   RX  → GPIO 26
 *
 * SIM800L:
 *   TX  → GPIO 16
 *   RX  → GPIO 17
 *
 * Sensor Tegangan FZ0430:
 *   S1 (Solar)   → GPIO 34
 *   S2 (Turbin)  → GPIO 35
 *
 * Sensor Arus ACS712-30A:
 *   S1 (Solar)   → GPIO 32
 *   S2 (Turbin)  → GPIO 33
 *
 * Sensor Magnet (Pintu/Anti-Theft):
 *   S   → GPIO 13
 * ========================================
 */

#include <HardwareSerial.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

// ========================================
// PIN DEFINITIONS
// ========================================
#define GPS_TX_PIN        25
#define GPS_RX_PIN        26
#define SIM800L_TX_PIN    16
#define SIM800L_RX_PIN    17
#define VOLT_SOLAR_PIN    34
#define VOLT_TURBINE_PIN  35
#define CURR_SOLAR_PIN    32
#define CURR_TURBINE_PIN  33
#define MAGNET_PIN        13

// ========================================
// WIFI CREDENTIALS (Fallback)
// ========================================
const char* wifi_ssid     = "Hotspot_Tekfis_Kantin";
const char* wifi_password = "tekfis1965";

// ========================================
// HIVEMQ CLOUD CREDENTIALS
// ========================================
const char* mqtt_server    = "9de252096f4146cb844e4b835206298f.s1.eu.hivemq.cloud";
const int   mqtt_port_wifi = 8883;  // TLS untuk WiFi
const int   mqtt_port_sim  = 1883;  // Non-TLS untuk SIM800L
const char* mqtt_user      = "Testlog";
const char* mqtt_pass      = "Test123456";

// ========================================
// MQTT TOPICS
// ========================================
const char* topic_solar    = "wattscope/sensor/solar";
const char* topic_turbine  = "wattscope/sensor/turbine";
const char* topic_gps      = "wattscope/gps";
const char* topic_status   = "wattscope/status";
const char* topic_security = "wattscope/security";

// ========================================
// ENUM: Mode Koneksi Aktif
// ========================================
enum ConnMode { CONN_NONE, CONN_WIFI, CONN_SIM800L };
ConnMode activeConn = CONN_NONE;

// ========================================
// TIMING CONFIGURATION
// ========================================
unsigned long lastSensorUpdate  = 0;
unsigned long lastGPSUpdate     = 0;
unsigned long lastStatusUpdate  = 0;
unsigned long lastSimRetry      = 0;

const unsigned long sensorInterval   = 2000;   // 2 detik
const unsigned long gpsInterval      = 5000;   // 5 detik
const unsigned long statusInterval   = 30000;  // 30 detik
const unsigned long simRetryInterval = 60000;  // Retry SIM800L tiap 60 detik

// ========================================
// KALIBRASI SENSOR
// ========================================
const float VOLT_CALIBRATION   = 7.576;
const float ADC_REF            = 3.3;
const int   ADC_RESOLUTION     = 4096;
const float ACS712_SENSITIVITY = 0.066;
const float ACS712_OFFSET      = 1.65;
const int   ACS712_SAMPLES     = 500;

// ========================================
// VARIABEL GLOBAL
// ========================================
HardwareSerial SerialGPS(1);
HardwareSerial SerialSIM(2);
TinyGPSPlus gps;

WiFiClientSecure wifiClient;
PubSubClient mqttWifi(wifiClient);

bool simReady   = false;
bool gprsReady  = false;
bool mqttSimOk  = false;
bool mqttWifiOk = false;

bool lastMagnetState = HIGH;
bool doorAlarm       = false;

// ========================================
// FUNGSI: Baca Tegangan FZ0430
// ========================================
float readVoltage(int pin) {
  int raw = analogRead(pin);
  float adcVoltage = (raw / (float)ADC_RESOLUTION) * ADC_REF;
  return adcVoltage * VOLT_CALIBRATION;
}

// ========================================
// FUNGSI: Baca Arus ACS712-30A
// ========================================
float readCurrent(int pin) {
  long sum = 0;
  for (int i = 0; i < ACS712_SAMPLES; i++) sum += analogRead(pin);
  float avgRaw  = sum / (float)ACS712_SAMPLES;
  float adcVolt = (avgRaw / (float)ADC_RESOLUTION) * ADC_REF;
  float current = (adcVolt - ACS712_OFFSET) / ACS712_SENSITIVITY;
  if (current < 0)   current = -current;
  if (current < 0.1) current = 0.0;
  return current;
}

// ========================================
// FUNGSI: Kirim AT Command ke SIM800L
// ========================================
String sendAT(const char* cmd, unsigned long timeout = 2000, const char* expected = "OK") {
  SerialSIM.println(cmd);
  String response = "";
  unsigned long start = millis();
  while (millis() - start < timeout) {
    while (SerialSIM.available()) response += (char)SerialSIM.read();
    if (response.indexOf(expected) != -1) break;
  }
  Serial.print("AT >> "); Serial.print(cmd);
  Serial.print(" | "); Serial.println(response);
  return response;
}

// ========================================
// FUNGSI: Init SIM800L
// ========================================
bool initSIM800L() {
  Serial.println("🔌 Mencoba SIM800L...");
  for (int i = 0; i < 3; i++) {
    if (sendAT("AT").indexOf("OK") != -1) {
      Serial.println("✅ SIM800L merespons!");
      sendAT("ATE0");
      sendAT("AT+CMEE=2");
      sendAT("AT+CPIN?", 3000, "READY");
      Serial.print("📶 Jaringan GSM");
      for (int j = 0; j < 15; j++) {
        String r = sendAT("AT+CREG?", 2000);
        if (r.indexOf("+CREG: 0,1") != -1 || r.indexOf("+CREG: 0,5") != -1) {
          Serial.println(" ✅"); return true;
        }
        Serial.print("."); delay(1500);
      }
      Serial.println(" ❌"); return false;
    }
    delay(1000);
  }
  Serial.println("❌ SIM800L tidak merespons!");
  return false;
}

// ========================================
// FUNGSI: Koneksi GPRS XL/AXIS
// ========================================
bool connectGPRS() {
  Serial.println("🌐 Konek GPRS XL/AXIS...");
  sendAT("AT+SAPBR=3,1,\"Contype\",\"GPRS\"");
  sendAT("AT+SAPBR=3,1,\"APN\",\"internet\"");
  sendAT("AT+SAPBR=3,1,\"USER\",\"\"");
  sendAT("AT+SAPBR=3,1,\"PWD\",\"\"");
  String r = sendAT("AT+SAPBR=1,1", 10000, "OK");
  if (r.indexOf("ERROR") != -1) { Serial.println("❌ GPRS gagal!"); return false; }
  sendAT("AT+CIPMUX=0");
  sendAT("AT+CIPMODE=0");
  sendAT("AT+CSTT=\"internet\",\"\",\"\"");
  sendAT("AT+CIICR", 5000);
  sendAT("AT+CIFSR", 3000);
  Serial.println("✅ GPRS Terhubung!");
  return true;
}

// ========================================
// FUNGSI: Koneksi MQTT via SIM800L
// ========================================
bool connectMQTT_SIM() {
  Serial.println("📡 MQTT via SIM800L...");
  String cmd = "AT+CIPSTART=\"TCP\",\"";
  cmd += mqtt_server; cmd += "\","; cmd += mqtt_port_sim;
  if (sendAT(cmd.c_str(), 10000, "CONNECT OK").indexOf("CONNECT OK") == -1) {
    Serial.println("❌ TCP gagal!"); return false;
  }

  String clientId = "ESP32_WATTSCOPE_SIM";
  String userStr  = String(mqtt_user);
  String passStr  = String(mqtt_pass);
  int payloadLen  = 2 + clientId.length() + 2 + userStr.length() + 2 + passStr.length();
  int remainLen   = 10 + payloadLen;

  uint8_t buf[200]; int idx = 0;
  buf[idx++] = 0x10; buf[idx++] = remainLen;
  buf[idx++] = 0x00; buf[idx++] = 0x04;
  buf[idx++] = 'M'; buf[idx++] = 'Q'; buf[idx++] = 'T'; buf[idx++] = 'T';
  buf[idx++] = 0x04; buf[idx++] = 0xC2;
  buf[idx++] = 0x00; buf[idx++] = 0x3C;
  buf[idx++] = 0x00; buf[idx++] = clientId.length();
  for (int i = 0; i < (int)clientId.length(); i++) buf[idx++] = clientId[i];
  buf[idx++] = 0x00; buf[idx++] = userStr.length();
  for (int i = 0; i < (int)userStr.length(); i++) buf[idx++] = userStr[i];
  buf[idx++] = 0x00; buf[idx++] = passStr.length();
  for (int i = 0; i < (int)passStr.length(); i++) buf[idx++] = passStr[i];

  String sendCmd = "AT+CIPSEND="; sendCmd += idx;
  sendAT(sendCmd.c_str(), 2000, ">");
  SerialSIM.write(buf, idx);
  delay(2000);

  String resp = "";
  unsigned long t = millis();
  while (millis() - t < 3000) {
    while (SerialSIM.available()) resp += (char)SerialSIM.read();
  }
  if (resp.indexOf('\x20') != -1) { Serial.println("✅ MQTT SIM800L terhubung!"); return true; }
  Serial.println("❌ MQTT SIM800L gagal!"); return false;
}

// ========================================
// FUNGSI: Publish via SIM800L
// ========================================
bool mqttPublish_SIM(const char* topic, const char* payload) {
  int topicLen   = strlen(topic);
  int payloadLen = strlen(payload);
  int remainLen  = 2 + topicLen + payloadLen;
  uint8_t buf[512]; int idx = 0;
  buf[idx++] = 0x30; buf[idx++] = remainLen;
  buf[idx++] = (topicLen >> 8) & 0xFF; buf[idx++] = topicLen & 0xFF;
  for (int i = 0; i < topicLen; i++) buf[idx++] = topic[i];
  for (int i = 0; i < payloadLen; i++) buf[idx++] = payload[i];
  String sendCmd = "AT+CIPSEND="; sendCmd += idx;
  if (sendAT(sendCmd.c_str(), 2000, ">").indexOf(">") == -1) return false;
  SerialSIM.write(buf, idx);
  delay(300);
  return true;
}

// ========================================
// FUNGSI: Koneksi WiFi + MQTT (Fallback)
// ========================================
bool connectWiFi_MQTT() {
  Serial.println("📶 Mencoba WiFi fallback...");
  WiFi.begin(wifi_ssid, wifi_password);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500); Serial.print("."); tries++;
  }
  if (WiFi.status() != WL_CONNECTED) { Serial.println("\n❌ WiFi gagal!"); return false; }
  Serial.println("\n✅ WiFi: " + WiFi.localIP().toString());

  wifiClient.setInsecure();
  mqttWifi.setServer(mqtt_server, mqtt_port_wifi);
  mqttWifi.setKeepAlive(60);

  String clientId = "ESP32_WATTSCOPE_WIFI_" + String(random(0xffff), HEX);
  if (mqttWifi.connect(clientId.c_str(), mqtt_user, mqtt_pass)) {
    Serial.println("✅ MQTT WiFi terhubung!"); return true;
  }
  Serial.println("❌ MQTT WiFi gagal! rc=" + String(mqttWifi.state()));
  return false;
}

// ========================================
// FUNGSI: Publish via WiFi
// ========================================
bool mqttPublish_WiFi(const char* topic, const char* payload) {
  if (!mqttWifi.connected()) {
    String clientId = "ESP32_WATTSCOPE_WIFI_" + String(random(0xffff), HEX);
    if (!mqttWifi.connect(clientId.c_str(), mqtt_user, mqtt_pass)) {
      mqttWifiOk = false; return false;
    }
  }
  return mqttWifi.publish(topic, payload);
}

// ========================================
// FUNGSI: Publish Otomatis (pilih jalur aktif)
// ========================================
bool mqttPublish(const char* topic, const char* payload) {
  if (activeConn == CONN_SIM800L) return mqttPublish_SIM(topic, payload);
  if (activeConn == CONN_WIFI)    { mqttWifi.loop(); return mqttPublish_WiFi(topic, payload); }
  return false;
}

// ========================================
// FUNGSI: Retry SIM800L di Background
// ========================================
void retrySIM800L() {
  Serial.println("\n🔄 [BACKGROUND] Retry SIM800L...");
  sendAT("AT+CIPCLOSE", 2000);
  sendAT("AT+CIPSHUT", 3000);

  simReady  = initSIM800L();
  if (!simReady)  { Serial.println("🔄 SIM gagal, lanjut WiFi..."); return; }
  gprsReady = connectGPRS();
  if (!gprsReady) { Serial.println("🔄 GPRS gagal, lanjut WiFi..."); return; }
  mqttSimOk = connectMQTT_SIM();
  if (!mqttSimOk) { Serial.println("🔄 MQTT SIM gagal, lanjut WiFi..."); return; }

  // ✅ SIM800L berhasil! Matikan WiFi
  Serial.println("🎉 SIM800L OK! Beralih dari WiFi ke SIM800L...");
  activeConn = CONN_SIM800L;

  if (WiFi.status() == WL_CONNECTED) {
    mqttWifi.disconnect();
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    Serial.println("📴 WiFi dimatikan — SIM800L aktif sebagai koneksi utama");
  }

  // Kirim notifikasi perpindahan koneksi
  JsonDocument doc;
  doc["event"]       = "CONN_SWITCHED";
  doc["message"]     = "Beralih ke SIM800L, WiFi dimatikan";
  doc["active_conn"] = "SIM800L";
  doc["timestamp"]   = millis() / 1000;
  char buf[200]; serializeJson(doc, buf);
  mqttPublish_SIM(topic_status, buf);
}

// ========================================
// FUNGSI: Publish Data Sensor
// ========================================
void publishSensorData(const char* topic, int voltPin, int currPin, const char* label) {
  float voltage = readVoltage(voltPin);
  float ampere  = readCurrent(currPin);
  float power   = voltage * ampere;

  JsonDocument doc;
  doc["voltage"]     = round(voltage * 100) / 100.0;
  doc["ampere"]      = round(ampere * 100) / 100.0;
  doc["power"]       = round(power * 100) / 100.0;
  doc["active_conn"] = (activeConn == CONN_SIM800L) ? "SIM800L" : "WiFi";
  doc["timestamp"]   = millis() / 1000;

  char jsonBuffer[256]; serializeJson(doc, jsonBuffer);
  if (mqttPublish(topic, jsonBuffer)) {
    Serial.printf("📤 [%s] %s\n", label, jsonBuffer);
  } else {
    Serial.printf("❌ Gagal publish %s\n", label);
  }
}

// ========================================
// FUNGSI: Publish GPS
// ========================================
void publishGPSData() {
  while (SerialGPS.available()) gps.encode(SerialGPS.read());

  JsonDocument doc;
  if (gps.location.isValid() && gps.location.age() < 5000) {
    doc["latitude"]  = gps.location.lat();
    doc["longitude"] = gps.location.lng();
    doc["valid"]     = true;
  } else {
    doc["latitude"]  = -7.2837547;
    doc["longitude"] = 112.7961404;
    doc["valid"]     = false;
  }
  if (gps.speed.isValid())      doc["speed_kmh"]  = round(gps.speed.kmph() * 10) / 10.0;
  if (gps.satellites.isValid()) doc["satellites"] = gps.satellites.value();
  doc["timestamp"] = millis() / 1000;

  char jsonBuffer[300]; serializeJson(doc, jsonBuffer);
  if (mqttPublish(topic_gps, jsonBuffer)) {
    Serial.print("📍 [GPS] "); Serial.println(jsonBuffer);
  }
}

// ========================================
// FUNGSI: Publish Status
// ========================================
void publishStatus() {
  JsonDocument doc;
  doc["online"]      = true;
  doc["active_conn"] = (activeConn == CONN_SIM800L) ? "SIM800L" : "WiFi";
  doc["uptime"]      = millis() / 1000;
  doc["free_heap"]   = ESP.getFreeHeap();
  doc["gps_valid"]   = gps.location.isValid();
  doc["door_alarm"]  = doorAlarm;
  if (activeConn == CONN_WIFI) doc["wifi_rssi"] = WiFi.RSSI();
  doc["timestamp"]   = millis() / 1000;

  char jsonBuffer[300]; serializeJson(doc, jsonBuffer);
  if (mqttPublish(topic_status, jsonBuffer)) {
    Serial.print("✅ [STATUS] "); Serial.println(jsonBuffer);
  }
}

// ========================================
// FUNGSI: Cek Sensor Magnet (Anti-Theft)
// ========================================
void checkMagnetSensor() {
  bool currentState = digitalRead(MAGNET_PIN);

  if (lastMagnetState == HIGH && currentState == LOW) {
    doorAlarm = true;
    Serial.println("🚨 ALARM! Pintu terbuka - Potensi Pencurian!");
    JsonDocument doc;
    doc["event"]       = "DOOR_OPENED";
    doc["alarm"]       = true;
    doc["message"]     = "Pintu terbuka - potensi pencurian!";
    doc["active_conn"] = (activeConn == CONN_SIM800L) ? "SIM800L" : "WiFi";
    doc["timestamp"]   = millis() / 1000;
    char buf[200]; serializeJson(doc, buf);
    mqttPublish(topic_security, buf);
  }

  if (lastMagnetState == LOW && currentState == HIGH) {
    doorAlarm = false;
    Serial.println("✅ Pintu tertutup - Alarm direset");
    JsonDocument doc;
    doc["event"]     = "DOOR_CLOSED";
    doc["alarm"]     = false;
    doc["message"]   = "Pintu tertutup - kondisi aman";
    doc["timestamp"] = millis() / 1000;
    char buf[200]; serializeJson(doc, buf);
    mqttPublish(topic_security, buf);
  }

  lastMagnetState = currentState;
}

// ========================================
// FUNGSI: MQTT Keep-Alive SIM800L
// ========================================
void mqttPingReq_SIM() {
  uint8_t ping[] = {0xC0, 0x00};
  if (sendAT("AT+CIPSEND=2", 2000, ">").indexOf(">") != -1) {
    SerialSIM.write(ping, 2);
  }
}

// ========================================
// SETUP
// ========================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("🔋 WATTSCOPE - Dual Connection Mode");
  Serial.println("   SIM800L (Utama) + WiFi (Fallback)");
  Serial.println("========================================\n");

  pinMode(MAGNET_PIN, INPUT_PULLUP);
  lastMagnetState = digitalRead(MAGNET_PIN);
  analogReadResolution(12);

  SerialGPS.begin(9600, SERIAL_8N1, GPS_TX_PIN, GPS_RX_PIN);
  SerialSIM.begin(9600, SERIAL_8N1, SIM800L_TX_PIN, SIM800L_RX_PIN);
  delay(2000);

  // ── Tahap 1: Coba SIM800L ──
  Serial.println("[ TAHAP 1 ] Mencoba SIM800L sebagai koneksi utama...");
  simReady  = initSIM800L();
  if (simReady)  gprsReady = connectGPRS();
  if (gprsReady) mqttSimOk = connectMQTT_SIM();

  if (mqttSimOk) {
    activeConn = CONN_SIM800L;
    Serial.println("\n🎉 Koneksi utama: SIM800L aktif!\n");
  } else {
    // ── Tahap 2: Fallback ke WiFi ──
    Serial.println("\n[ TAHAP 2 ] SIM800L gagal → Fallback ke WiFi...");
    mqttWifiOk = connectWiFi_MQTT();
    if (mqttWifiOk) {
      activeConn = CONN_WIFI;
      Serial.println("\n⚠️  Koneksi fallback: WiFi aktif");
      Serial.println("    SIM800L akan di-retry tiap 60 detik...\n");
    } else {
      activeConn = CONN_NONE;
      Serial.println("\n❌ Semua koneksi gagal! Cek hardware...\n");
    }
  }

  if (activeConn != CONN_NONE) {
    publishStatus();
    Serial.println("📡 Topics aktif:");
    Serial.println("   - " + String(topic_solar));
    Serial.println("   - " + String(topic_turbine));
    Serial.println("   - " + String(topic_gps));
    Serial.println("   - " + String(topic_status));
    Serial.println("   - " + String(topic_security));
    Serial.println("\n🚀 Sistem siap!\n");
  }
}

// ========================================
// LOOP
// ========================================
void loop() {
  unsigned long currentMillis = millis();

  // Baca GPS terus-menerus
  while (SerialGPS.available()) gps.encode(SerialGPS.read());

  // Cek sensor magnet (prioritas tertinggi)
  checkMagnetSensor();

  // Jika tidak ada koneksi sama sekali, coba reconnect
  if (activeConn == CONN_NONE) {
    Serial.println("⚠️  Tidak ada koneksi! Mencoba ulang...");
    delay(5000);
    simReady  = initSIM800L();
    if (simReady)  gprsReady = connectGPRS();
    if (gprsReady) mqttSimOk = connectMQTT_SIM();
    if (mqttSimOk) {
      activeConn = CONN_SIM800L;
    } else {
      mqttWifiOk = connectWiFi_MQTT();
      if (mqttWifiOk) activeConn = CONN_WIFI;
    }
    return;
  }

  // ── Background Retry SIM800L (hanya saat pakai WiFi) ──
  if (activeConn == CONN_WIFI) {
    mqttWifi.loop();  // Jaga koneksi MQTT WiFi tetap hidup

    if (currentMillis - lastSimRetry >= simRetryInterval) {
      lastSimRetry = currentMillis;
      retrySIM800L();
      // Jika berhasil, activeConn sudah berubah ke CONN_SIM800L di dalam fungsi
    }
  }

  // ── Publish Sensor Solar + Turbin setiap 2 detik ──
  if (currentMillis - lastSensorUpdate >= sensorInterval) {
    lastSensorUpdate = currentMillis;
    publishSensorData(topic_solar,   VOLT_SOLAR_PIN,   CURR_SOLAR_PIN,   "SOLAR");
    delay(100);
    publishSensorData(topic_turbine, VOLT_TURBINE_PIN, CURR_TURBINE_PIN, "TURBINE");
  }

  // ── Publish GPS setiap 5 detik ──
  if (currentMillis - lastGPSUpdate >= gpsInterval) {
    lastGPSUpdate = currentMillis;
    publishGPSData();
  }

  // ── Publish Status + Keep-Alive setiap 30 detik ──
  if (currentMillis - lastStatusUpdate >= statusInterval) {
    lastStatusUpdate = currentMillis;
    publishStatus();
    if (activeConn == CONN_SIM800L) mqttPingReq_SIM();
  }
}
