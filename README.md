# ⚡ WATTSCOPE — IoT Energy Monitoring System

<p align="center">
  <img src="https://img.shields.io/badge/ESP32-Firmware-blue?style=for-the-badge&logo=espressif" />
  <img src="https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi" />
  <img src="https://img.shields.io/badge/MQTT-HiveMQ_Cloud-purple?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Dashboard-Web_App-orange?style=for-the-badge" />
</p>

<p align="center">
  Sistem monitoring energi terbarukan berbasis IoT secara <strong>real-time</strong>.<br/>
  Memantau Panel Surya & Turbin Angin, GPS tracking, dan deteksi keamanan via MQTT.
</p>

---

## 📑 Daftar Isi

- [Gambaran Umum](#-gambaran-umum)
- [Arsitektur Sistem](#-arsitektur-sistem)
- [Fitur](#-fitur)
- [Komponen Hardware](#-komponen-hardware)
- [Konfigurasi Pin ESP32](#-konfigurasi-pin-esp32)
- [Struktur Proyek](#-struktur-proyek)
- [Instalasi & Setup](#-instalasi--setup)
  - [1. Firmware ESP32](#1-firmware-esp32)
  - [2. Backend Server](#2-backend-server)
  - [3. Web Dashboard](#3-web-dashboard)
- [Konfigurasi MQTT](#-konfigurasi-mqtt)
- [MQTT Topics](#-mqtt-topics)
- [Kalibrasi Sensor](#-kalibrasi-sensor)
- [Konsumsi Daya & Baterai](#-konsumsi-daya--baterai)
- [Troubleshooting](#-troubleshooting)

---

## 🔍 Gambaran Umum
Proyek Integrated Smart Power & GPS Monitoring System ini bertujuan untuk menghadirkan solusi terpadu dalam pemantauan daya sekaligus peningkatan keamanan pada sistem energi terdistribusi. Sistem ini menggabungkan sensor daya untuk membaca arus, tegangan, serta estimasi konsumsi energi secara real-time, kemudian mengirimkan data tersebut ke platform monitoring berbasis IoT.
Untuk aspek keamanan, perangkat dilengkapi modul GPS yang memungkinkan pelacakan lokasi secara kontinu sehingga mencegah pencurian atau pemindahan aset tanpa izin. Informasi daya, status keamanan, dan posisi perangkat divisualisasikan secara terpusat sehingga memudahkan pengguna dalam melakukan pengawasan, analisis performa, serta respons cepat terhadap potensi gangguan.
Dengan integrasi ini, menghadirkan sistem energi yang lebih aman, efisien, dan mudah dikelola — mulai dari pemantauan performa Panel Surya dan Turbin Angin, hingga deteksi anomali keamanan berbasis sensor magnet secara real-time.

---

## 🏗 Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────┐
│                      ESP32 (Edge Device)                │
│  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐  │
│  │FZ0430 x2 │  │ACS712 x2 │  │GPS Neo-6│  │ Magnet  │  │
│  │(Tegangan)│  │  (Arus)  │  │         │  │ Sensor  │  │
│  └────┬─────┘  └────┬─────┘  └────┬────┘  └────┬────┘  │
│       └─────────────┴─────────────┴─────────────┘       │
│                          │                              │
│               ┌──────────▼──────────┐                   │
│               │  SIM800L (Utama)    │                   │
│               │  WiFi   (Fallback)  │                   │
│               └──────────┬──────────┘                   │
└──────────────────────────┼──────────────────────────────┘
                           │ MQTT (TLS/SSL)
                           ▼
              ┌────────────────────────┐
              │   HiveMQ Cloud Broker  │
              └───────────┬────────────┘
                          │ MQTT Subscribe
                          ▼
              ┌────────────────────────┐
              │   FastAPI Backend      │
              │   (Python + WebSocket) │
              └───────────┬────────────┘
                          │ WebSocket
                          ▼
              ┌────────────────────────┐
              │   Web Dashboard        │
              │   (HTML/CSS/JS)        │
              └────────────────────────┘
```

---

## ✨ Fitur

| Fitur | Deskripsi |
|---|---|
| 📊 **Monitoring Real-time** | Data tegangan, arus, dan daya dari panel surya & turbin angin |
| 📍 **GPS Tracking** | Lokasi perangkat ditampilkan di peta interaktif (Leaflet.js) |
| 🔒 **Anti-Theft Detection** | Sensor magnet mendeteksi pintu terbuka dan mengirim alarm |
| 📶 **Dual Connection** | SIM800L GPRS sebagai koneksi utama, WiFi sebagai fallback otomatis |
| 📈 **Grafik Historis** | Visualisasi data dalam grafik real-time (Chart.js) |
| 📋 **Activity Log** | Log semua aktivitas sistem dengan timestamp |
| 🔄 **Auto Reconnect** | Sistem otomatis reconnect jika koneksi terputus |
| 🔋 **Hemat Daya** | Desain untuk operasi baterai Li-Ion 3.7V |

---

## 🔧 Komponen Hardware

| Komponen | Spesifikasi | Fungsi |
|---|---|---|
| **ESP32** | DevKit v1 / v4 | Mikrokontroler utama |
| **SIM800L** | GSM/GPRS Module | Koneksi internet utama (XL/AXIS) |
| **GPS Module** | Neo-6M / Neo-7M | Pelacak lokasi real-time |
| **Sensor Tegangan** | FZ0430 (maks 25V DC) | Baca tegangan solar & turbin |
| **Sensor Arus** | ACS712-30A | Baca arus solar & turbin |
| **Sensor Magnet** | Reed Switch / Hall Sensor | Deteksi keamanan pintu |
| **Baterai** | Li-Ion 3.7V 2000mAh | Sumber daya portabel |
| **Charger** | TP4056 (direkomendasikan) | Modul pengisian baterai |

---

## 📌 Konfigurasi Pin ESP32

```
ESP32 GPIO   │  Komponen              │  Keterangan
─────────────┼────────────────────────┼──────────────────────────
GPIO 25      │  GPS TX                │  Data dari GPS ke ESP32
GPIO 26      │  GPS RX                │  Data dari ESP32 ke GPS
GPIO 16      │  SIM800L TX            │  Data dari SIM ke ESP32
GPIO 17      │  SIM800L RX            │  Data dari ESP32 ke SIM
GPIO 34      │  FZ0430 S1 (Solar)     │  Baca tegangan panel surya
GPIO 35      │  FZ0430 S2 (Turbin)    │  Baca tegangan turbin angin
GPIO 32      │  ACS712 S1 (Solar)     │  Baca arus panel surya
GPIO 33      │  ACS712 S2 (Turbin)    │  Baca arus turbin angin
GPIO 13      │  Sensor Magnet         │  Deteksi pintu (INPUT_PULLUP)
```

> ⚠️ **Perhatian:** GPIO 34 & 35 adalah **input-only**, tidak memiliki pull-up internal. Maksimal input 3.3V — pastikan tidak melebihi batas ini.

> ⚠️ **SIM800L Power:** Membutuhkan arus hingga 2A saat transmisi. Gunakan power supply **3.7V–4.2V terpisah** (baterai Li-Ion), bukan dari pin 3.3V ESP32. Tambahkan kapasitor **1000µF** di jalur power SIM800L.

---

## 📁 Struktur Proyek

```
wattscope/
│
├── firmware/
│   └── wattscope_esp32.ino      # Firmware ESP32 (Arduino IDE)
│
├── backend/
│   ├── main.py                  # FastAPI backend server
│   └── requirements.txt         # Python dependencies
│
└── dashboard/
    ├── index.html               # Halaman utama dashboard
    ├── style.css                # Styling mobile-first
    └── script.js                # Logic WebSocket & Chart.js
```

---

## 🚀 Instalasi & Setup

### 1. Firmware ESP32

**Persyaratan:**
- Arduino IDE 2.x
- ESP32 Board Package

**Library yang dibutuhkan** (install via Library Manager):
```
TinyGPSPlus       by Mikal Hart
ArduinoJson       by Benoit Blanchon  (v7)
PubSubClient      by Nick O'Leary
```

**Langkah:**
1. Buka `main.cpp` di Arduino IDE
2. Sesuaikan kredensial WiFi fallback jika diperlukan:
   ```cpp
   const char* wifi_ssid     = "NAMA_WIFI_ANDA";
   const char* wifi_password = "PASSWORD_WIFI";
   ```
3. Pastikan kartu SIM XL/AXIS aktif dan memiliki kuota data
4. Upload ke ESP32 (Board: `ESP32 Dev Module`, Upload Speed: `115200`)
5. Buka Serial Monitor pada baud rate **115200** untuk memonitor log

**Urutan log normal saat boot:**
```
[ TAHAP 1 ] Mencoba SIM800L sebagai koneksi utama...
✅ SIM800L merespons!
✅ Terdaftar di jaringan!
✅ GPRS Terhubung!
✅ MQTT SIM800L terhubung!
🎉 Koneksi utama: SIM800L aktif!
🚀 Sistem siap!
```

---

### 2. Backend Server

**Persyaratan:**
- Python 3.9+

**Instalasi:**
```bash
# Clone repository
git clone https://github.com/username/wattscope.git
cd wattscope/backend

# Install dependencies
pip install fastapi uvicorn paho-mqtt

# Jalankan server
python main.py
```

Server akan berjalan di:
- **API:** `http://localhost:8000`
- **WebSocket:** `ws://localhost:8000/ws`
- **Docs:** `http://localhost:8000/docs`

---

### 3. Web Dashboard

Dashboard adalah aplikasi web statis, cukup buka file `index.html` di browser, atau jalankan via web server lokal:

```bash
cd wattscope/dashboard

# Menggunakan Python HTTP server
python -m http.server 3000
```

Lalu buka `http://localhost:3000` di browser.

> 💡 Pastikan backend server sudah berjalan sebelum membuka dashboard agar WebSocket bisa terhubung.

---

## 📡 Konfigurasi MQTT

Proyek ini menggunakan **HiveMQ Cloud** sebagai broker MQTT dengan koneksi SSL/TLS.

| Parameter | Value |
|---|---|
| Broker | `9de252096f4146cb844e4b835206298f.s1.eu.hivemq.cloud` |
| Port (TLS) | `8883` |
| Port (Non-TLS) | `1883` |
| Username | `Testlog` |
| Password | `Test123456` |

> 🔐 **Catatan Keamanan:** Ganti username dan password MQTT sebelum deployment ke lingkungan produksi. Kredensial di atas hanya untuk keperluan development/testing.

---

## 📨 MQTT Topics

| Topic | Publisher | Subscriber | Isi Data |
|---|---|---|---|
| `wattscope/sensor/solar` | ESP32 | Backend | `{voltage, ampere, power, timestamp}` |
| `wattscope/sensor/turbine` | ESP32 | Backend | `{voltage, ampere, power, timestamp}` |
| `wattscope/gps` | ESP32 | Backend | `{latitude, longitude, speed_kmh, satellites, valid, timestamp}` |
| `wattscope/status` | ESP32 | Backend | `{online, active_conn, uptime, free_heap, gps_valid, door_alarm}` |
| `wattscope/security` | ESP32 | Backend | `{event, alarm, message, timestamp}` |

**Contoh payload `wattscope/sensor/solar`:**
```json
{
  "voltage": 12.45,
  "ampere": 3.20,
  "power": 39.84,
  "active_conn": "SIM800L",
  "timestamp": 3621
}
```

**Contoh payload `wattscope/security` saat alarm:**
```json
{
  "event": "DOOR_OPENED",
  "alarm": true,
  "message": "Pintu terbuka - potensi pencurian!",
  "active_conn": "SIM800L",
  "timestamp": 5120
}
```

---

## 🎛 Kalibrasi Sensor

### Sensor Tegangan FZ0430

Nilai default `VOLT_CALIBRATION = 7.576` adalah nilai teoritis (25V / 3.3V). Untuk hasil akurat, lakukan kalibrasi manual:

1. Hubungkan sumber tegangan yang sudah diketahui nilainya
2. Ukur tegangan nyata dengan multimeter
3. Baca nilai yang ditampilkan ESP32 via Serial Monitor
4. Hitung faktor baru: `faktor_baru = tegangan_multimeter / tegangan_terbaca`
5. Update nilai di kode:
   ```cpp
   const float VOLT_CALIBRATION = 7.576; // Ganti dengan nilai hasil kalibrasi
   ```

### Sensor Arus ACS712-30A

Nilai offset `ACS712_OFFSET = 1.65` bisa bergeser tergantung suplai VCC:

1. Matikan semua beban (arus = 0)
2. Baca nilai ADC dari pin sensor via Serial Monitor
3. Konversi: `offset = (raw_adc / 4096.0) * 3.3`
4. Update nilai di kode:
   ```cpp
   const float ACS712_OFFSET = 1.65; // Ganti dengan nilai hasil kalibrasi
   ```

---

## 🔋 Konsumsi Daya & Baterai

Estimasi konsumsi sistem dalam operasi normal:

| Kondisi | Konsumsi |
|---|---|
| Semua aktif (transmit) | ~510 mA |
| Idle antar siklus | ~43 mA |
| Rata-rata per jam | ~277 mA |

**Estimasi daya tahan baterai:**

| Kapasitas Baterai | Estimasi Daya Tahan |
|---|---|
| 1× 2000 mAh | ~4–5 jam |
| 3× 2000 mAh (paralel, 6000 mAh) | ~13–15 jam |
| 5× 2000 mAh (paralel, 10000 mAh) | ~24 jam+ |

> 💡 **Tips hemat daya:** Implementasi deep sleep ESP32 dapat menurunkan konsumsi rata-rata ke ~50–70 mA, sehingga satu baterai 2000 mAh bisa bertahan hingga 28–40 jam.

---

## 🔧 Troubleshooting

| Masalah | Kemungkinan Penyebab | Solusi |
|---|---|---|
| SIM800L tidak merespons AT | Power supply tidak cukup | Gunakan power 3.7V–4.2V terpisah, tambah kapasitor 1000µF |
| GPRS gagal konek | APN salah / sinyal lemah | Pastikan APN `internet` untuk XL/AXIS, pindah ke area sinyal lebih kuat |
| GPS tidak valid | Posisi tertutup / cold fix | Pindah ke area terbuka, tunggu 1–3 menit untuk cold fix |
| Arus terbaca saat tanpa beban | Offset ACS712 bergeser | Kalibrasi ulang `ACS712_OFFSET` |
| MQTT terputus berkala | Keep-alive tidak jalan | Pastikan `mqttPingReq_SIM()` terpanggil tiap 30 detik |
| Alarm magnet false positive | Jarak magnet terlalu jauh / getaran | Kurangi jarak antara magnet dan sensor (maks 1–2 cm) |
| Dashboard tidak update | WebSocket tidak terhubung | Pastikan backend berjalan, cek URL WebSocket di `script.js` |
| Tegangan terbaca tidak akurat | Kalibrasi belum dilakukan | Lakukan kalibrasi dengan multimeter |

---

## 📜 Lisensi

Proyek ini dirilis di bawah lisensi [MIT License](LICENSE).

---

<p align="center">
  Dibuat dengan ❤️ untuk monitoring energi terbarukan
</p>
