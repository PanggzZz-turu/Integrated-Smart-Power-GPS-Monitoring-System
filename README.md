# ⚡ PowerTrack by Terangin

Sistem monitoring energi terbarukan berbasis web secara real-time. Memantau panel surya dan turbin angin, mengontrol lampu, mendeteksi gerak, dan melacak lokasi GPS — semua dalam satu dashboard.

---

## 📁 Struktur Project

```
powertrack/
├── index.html      # Struktur halaman (Login, Device Selector, Dashboard)
├── style.css       # Seluruh styling — dark/light theme, animasi, layout
├── app.js          # Logika frontend: MQTT topic, sensor, chart, map, lampu, alarm
└── main.py         # Backend Flask: API endpoint, CSV storage, simulasi sensor
```

---

## 🚀 Cara Menjalankan

### Persyaratan

- Python 3.8+
- pip

### Instalasi

```bash
pip install flask flask-cors
```

### Jalankan Server

```bash
python main.py
```

Server berjalan di `http://localhost:5000`

### Akun Default

| Username | Password | Role  |
|----------|----------|-------|
| admin    | admin123 | admin |
| user     | user123  | user  |

---

## 🖥️ Halaman & Fitur

### 1. Login (`#page-login`)

- Input username dan password
- Validasi ke backend via `POST /api/login`
- Username dan password disimpan di state untuk membangun MQTT topic
- Mendukung dark / light theme (toggle di pojok kanan atas)
- Enter pada field password langsung login

### 2. Device Selector (`#page-devices`)

- Menampilkan daftar device yang tersedia dari `GET /api/devices`
- Setiap device menampilkan preview MQTT topic lengkap:
  ```
  Terangin/{username}/{password}/{device_id}
  ```
- Badge status online / offline per device
- Device baru ditandai badge "▸ baru terdeteksi"
- Animasi scan aktif saat memuat device

### 3. Dashboard (`#page-dashboard`)

Dashboard utama dengan 5 section yang bisa dinavigasi:

| Section | Konten |
|---------|--------|
| Panel   | Kartu metrik real-time Solar & Turbin |
| Grafik  | Chart tegangan / ampere / daya (line chart interaktif) |
| GPS     | Peta lokasi real-time (Leaflet + OpenStreetMap) |
| Lampu   | Kontrol on/off dengan mode Manual, Timer, Jadwal |
| Log     | Riwayat aktivitas sistem + export CSV |

---

## 📡 MQTT Topic & Payload

### Format Topic

```
Terangin/{username}/{password}/{device}/{topicsensor}
```

Kredensial username dan password berasal langsung dari form Login. Di tampilan UI, password disembunyikan sebagai `***`.

---

### `/sensor` — Data Energi & GPS

**Arah:** Server → Device | **Interval:** 2 detik

```json
{
  "solar":   { "v": 218.45, "a": 5.32,  "w": 1162.15 },
  "turbine": { "v": 235.10, "a": 6.41,  "w": 1507.00 },
  "gps":     { "lat": -7.2575, "lng": 112.7521 },
  "ts": "2025-04-02T08:30:00"
}
```

| Field | Tipe | Keterangan |
|-------|------|-----------|
| `solar.v` | float | Tegangan panel surya (V) |
| `solar.a` | float | Arus panel surya (A) |
| `solar.w` | float | Daya panel surya (W) |
| `turbine.v` | float | Tegangan turbin angin (V) |
| `turbine.a` | float | Arus turbin angin (A) |
| `turbine.w` | float | Daya turbin angin (W) |
| `gps.lat` | float | Koordinat lintang (WGS84) |
| `gps.lng` | float | Koordinat bujur (WGS84) |
| `ts` | string ISO 8601 | Timestamp server |

---

### `/lampu` — Kontrol Lampu

**Arah:** Dua arah (bidirectional) | **Interval:** On-demand

**Server → Device** (perintah):
```json
{
  "on": true,
  "mode": "manual",
  "detail": "Tombol nyala",
  "ts": "2025-04-02T08:30:00"
}
```

**Device → Server** (konfirmasi status):
```json
{
  "on": true,
  "mode": "manual",
  "detail": "Tombol nyala",
  "ts": "2025-04-02T08:30:00"
}
```

| Field | Tipe | Keterangan |
|-------|------|-----------|
| `on` | boolean | `true` = nyala, `false` = mati |
| `mode` | string | `manual` \| `timer` \| `jadwal` |
| `detail` | string | Deskripsi aksi (contoh: "Timer #1") |
| `ts` | string ISO 8601 | Timestamp perintah / konfirmasi |

**Mode Kontrol Lampu:**

- **Manual** — tombol nyala/mati langsung
- **Timer** — set durasi menit, countdown otomatis eksekusi
- **Jadwal** — set jam + hari (Setiap Hari / Sen–Jum / Sab–Min), cek setiap 10 detik

---

### `/alarm` — Deteksi Gerak PIR

**Arah:** Dua arah | **Interval:** 10 detik

**Server → Device** (konfigurasi):
```json
{
  "motion": true,
  "sensitivity": "medium",
  "ts": "2025-04-02T08:31:00"
}
```

**Device → Server** (laporan deteksi):
```json
{
  "armed": true,
  "ts": "2025-04-02T08:31:00"
}
```

| Field | Tipe | Keterangan |
|-------|------|-----------|
| `motion` | boolean | `true` = gerak terdeteksi |
| `sensitivity` | string | `low` \| `medium` \| `high` |
| `armed` | boolean | `true` = alarm aktif / terpicu |
| `ts` | string ISO 8601 | Timestamp deteksi |

Saat alarm terpicu: bell icon bergetar, badge counter bertambah, toast notification muncul, dan entri log merah ditambahkan.

---

### `/status` — Heartbeat Device

**Arah:** Device → Server | **Interval:** 30 detik

```json
{
  "online": true,
  "uptime_s": 3600,
  "rssi": -65,
  "ts": "2025-04-02T08:30:00"
}
```

| Field | Tipe | Keterangan |
|-------|------|-----------|
| `online` | boolean | Status koneksi device |
| `uptime_s` | integer | Lama device menyala (detik) |
| `rssi` | integer (dBm) | Kekuatan sinyal WiFi (negatif) |
| `ts` | string ISO 8601 | Timestamp heartbeat |

---

## 🔌 API Endpoint (Backend)

Base URL: `http://localhost:5000/api`

| Endpoint | Method | Keterangan |
|----------|--------|-----------|
| `/login` | POST | Autentikasi user, cek dari `users.csv` |
| `/devices` | GET | Daftar device beserta status online/offline |
| `/sensor` | GET | Generate data sensor, simpan ke CSV, return payload `/sensor` |
| `/sensor/history` | GET | Riwayat data sensor (`?limit=20`) |
| `/sensor/export` | GET | Download `data_sensor.csv` |
| `/lampu` | GET | Status lampu saat ini |
| `/lampu` | POST | Kirim perintah lampu, terima payload format MQTT |
| `/lampu/export` | GET | Download `lampu_log.csv` |
| `/log` | GET | Riwayat log kontrol lampu (`?limit=50`) |
| `/motion` | GET | Simulasi deteksi PIR, return payload `/alarm` |
| `/motion/history` | GET | Riwayat deteksi gerak (`?limit=50`) |
| `/status` | GET | Heartbeat device: uptime, RSSI, online |

---

## 🗄️ Penyimpanan Data (CSV)

Semua data disimpan lokal dalam format CSV. File dibuat otomatis saat server pertama kali dijalankan.

| File | Header | Keterangan |
|------|--------|-----------|
| `data_sensor.csv` | timestamp, solar_v, solar_a, solar_w, turbine_v, turbine_a, turbine_w, lat, lng | Data sensor setiap polling |
| `lampu_log.csv` | timestamp, action, mode, detail, ts_mqtt | Riwayat kontrol lampu |
| `users.csv` | username, password, role | Akun pengguna |
| `motion_log.csv` | timestamp, detected, device | Riwayat deteksi gerak |

---

## 🎨 UI & Styling

### Tema

Mendukung **dark mode** (default) dan **light mode**. Toggle tersedia di semua halaman. Preferensi disimpan di `localStorage`.

**Palet warna utama:**

| Nama | Hex | Penggunaan |
|------|-----|-----------|
| Teal | `#0FD9BF` | Aksen utama, solar, border aktif |
| Orange | `#FF4800` | Turbin, logo gradient |
| Yellow | `#FFB800` | Daya, warning |
| Dark | `#0A0F14` | Background utama |

### Font

- **DM Sans** — teks umum, label, body
- **Space Mono** — nilai metrik, topic MQTT, kode

### Animasi

- `fadeUp` — card masuk saat pertama load
- `pulse` — dot status online
- `scan` — indikator scanning device
- Bell shake saat alarm terpicu

---

## 📊 Grafik (Chart.js)

Setiap sumber energi (Solar & Turbin) memiliki grafik terpisah dengan 4 mode tampilan:

| Mode | Dataset | Warna |
|------|---------|-------|
| Tegangan | Volt (V) | Teal `#0FD9BF` |
| Ampere | Ampere (A) | Green `#22c55e` |
| Daya | Watt (W) | Yellow `#FFB800` |
| Multi | V + A + W (dual axis) | Ketiganya |

Maksimum **20 titik data** ditampilkan (FIFO). Update setiap 2 detik tanpa jeda animasi agar tidak patah-patah.

---

## 🗺️ GPS (Leaflet)

- Peta OpenStreetMap via Leaflet.js
- Marker custom dengan warna teal + glow effect
- Lingkaran radius 60 meter di sekitar posisi device
- Popup menampilkan MQTT topic device
- Koordinat diperbarui setiap polling sensor

---

## 🔧 Implementasi Frontend (app.js)

### State Utama

```js
const state = {
  username: '',         // dari form login
  password: '',         // dari form login — digunakan untuk MQTT topic
  selectedDevice: null,
  devices: [],
  solarData:   { v:[], a:[], w:[], t:[] },
  turbineData: { v:[], a:[], w:[], t:[] },
  interval: null,        // polling sensor  — 2 detik
  motionInterval: null,  // polling alarm   — 10 detik
  statusInterval: null,  // polling status  — 30 detik
  alarms: []
};
```

### Helper MQTT Topic

```js
function mqttTopic(topicSensor) {
  const dev = state.selectedDevice || '—';
  return `Terangin/${state.username}/${state.password}/${dev}/${topicSensor}`;
}
```

Semua referensi topic di seluruh kode menggunakan fungsi ini. Perubahan format topic cukup dilakukan di satu tempat.

### Interval Polling

| Fungsi | Interval | Topic |
|--------|----------|-------|
| `fetchSensor()` | 2 detik | `/sensor` |
| `fetchMotion()` | 10 detik | `/alarm` |
| `publishStatus()` | 30 detik | `/status` |

Semua interval dibersihkan (`clearInterval`) saat logout atau pindah device.

---

## 📋 Log Sistem

Log ditampilkan di section **Log** pada dashboard. Setiap entri memiliki warna:

| Warna | Arti |
|-------|------|
| 🟢 Green | Data sensor masuk, lampu nyala, koneksi berhasil |
| 🔵 Blue | Info: inisialisasi, export, heartbeat status |
| 🟡 Yellow | Lampu dimatikan |
| 🔴 Red | Error, gagal koneksi, alarm gerak terdeteksi |

Maksimum 100 entri disimpan di memory, 50 ditampilkan di UI.

---

## 🚨 Sistem Alarm

1. `fetchMotion()` polling `/api/motion` setiap 10 detik
2. Jika `detected: true`, fungsi `triggerAlarm()` dipanggil
3. Bell icon di navbar bergetar + badge counter bertambah
4. Toast notification muncul 4 detik di pojok layar
5. Log merah ditambahkan ke riwayat
6. Panel alarm menampilkan riwayat semua deteksi
7. Semua alarm bisa dihapus dengan tombol "Hapus Semua"

---

## 📦 Dependensi

### Frontend (CDN)

| Library | Versi | Fungsi |
|---------|-------|--------|
| Leaflet.js | 1.9.4 | Peta GPS interaktif |
| Chart.js | 4.4.1 | Grafik data sensor |
| Google Fonts | — | DM Sans, Space Mono |

### Backend (Python)

| Package | Fungsi |
|---------|--------|
| `flask` | Web framework & API server |
| `flask-cors` | Cross-Origin Resource Sharing |
| `csv` | Baca/tulis file CSV (built-in) |
| `random` | Simulasi data sensor & PIR |
| `datetime` | Timestamp ISO 8601 |

---

## 📝 Changelog

### v2.0 — Pembaruan MQTT
- Format topic diubah: `Terangin/{username}/{password}/{device}/{topic}`
- Username & password dikonfigurasi dari halaman Login (tidak hardcode)
- Semua payload ditambah field `ts` format ISO 8601
- Endpoint `/api/status` ditambahkan untuk heartbeat device
- Response `/api/motion` diperbarui sesuai payload `/alarm` Device→Server
- Response `/api/sensor` ditambah field `ts` ISO 8601
- `lampu_log.csv` ditambah kolom `ts_mqtt`
- Fungsi terpusat `mqttTopic()` di `app.js`
- Interval polling `/status` setiap 30 detik dengan auto-cleanup saat logout

### v1.0 — Rilis Awal
- Dashboard monitoring solar, turbin, GPS, lampu, alarm
- Format topic awal: `wattscope/{username}/{device}`
- Tema dark/light, multi-chart, timer, jadwal

---

> **PowerTrack by Terangin** — Monitoring energi terbarukan, real-time, di genggaman tangan.
