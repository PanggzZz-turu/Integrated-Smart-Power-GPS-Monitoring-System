from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import csv, os, random, math, time
from datetime import datetime

app = Flask(__name__, static_folder=".")
CORS(app)

DATA_FILE   = "data_sensor.csv"
LAMPU_FILE  = "lampu_log.csv"
USERS_FILE  = "users.csv"
MOTION_FILE = "motion_log.csv"

def init_csv():
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w", newline="") as f:
            csv.writer(f).writerow(["timestamp","solar_v","solar_a","solar_w",
                                     "turbine_v","turbine_a","turbine_w",
                                     "lat","lng"])

    if not os.path.exists(LAMPU_FILE):
        with open(LAMPU_FILE, "w", newline="") as f:
            csv.writer(f).writerow(["timestamp","action","mode","detail","ts_mqtt"])

    if not os.path.exists(USERS_FILE):
        with open(USERS_FILE, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["username","password","role"])
            w.writerow(["admin","admin123","admin"])
            w.writerow(["user","user123","user"])

    if not os.path.exists(MOTION_FILE):
        with open(MOTION_FILE, "w", newline="") as f:
            csv.writer(f).writerow(["timestamp","detected","device"])

init_csv()

server_state = {
    "lampu_on": False,
    "devices": [
        {"id": "device1", "color": "teal",   "online": True,  "isNew": False},
        {"id": "device2", "color": "orange", "online": True,  "isNew": False},
        {"id": "device3", "color": "gray",   "online": False, "isNew": False},
        {"id": "device4", "color": "blue",   "online": True,  "isNew": True},
    ]
}

def rnd(mn, mx, dec=2):
    return round(random.uniform(mn, mx), dec)

def gen_sensor():
    sv = rnd(8, 12); sa = rnd(6, 10);   sw = round(sv * sa, 2)
    tv = rnd(9, 12); ta = rnd(22, 30);   tw = round(tv * ta, 2)
    lat = round(-7.283809 + (random.random() - 0.5) * 0.0004, 6)
    lng = round(112.796587 + (random.random() - 0.5) * 0.0004, 6)
    return sv, sa, sw, tv, ta, tw, lat, lng

def save_sensor(sv, sa, sw, tv, ta, tw, lat, lng):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(DATA_FILE, "a", newline="") as f:
        csv.writer(f).writerow([ts, sv, sa, sw, tv, ta, tw, lat, lng])
    return ts

@app.route("/api/login", methods=["POST"])
def login():
    body = request.json or {}
    user = body.get("username", "").strip()
    pwd  = body.get("password", "").strip()
    if not user or not pwd:
        return jsonify({"ok": False, "msg": "Username dan password wajib diisi."}), 400

    with open(USERS_FILE, newline="") as f:
        for row in csv.DictReader(f):
            if row["username"] == user and row["password"] == pwd:
                return jsonify({"ok": True, "username": user, "role": row["role"]})

    return jsonify({"ok": False, "msg": "Username atau password salah."}), 401

@app.route("/api/devices")
def get_devices():
    return jsonify(server_state["devices"])

@app.route("/api/sensor")
def sensor():
    sv, sa, sw, tv, ta, tw, lat, lng = gen_sensor()
    ts = save_sensor(sv, sa, sw, tv, ta, tw, lat, lng)
    return jsonify({
        "solar":   {"v": sv, "a": sa, "w": sw},
        "turbine": {"v": tv, "a": ta, "w": tw},
        "gps":     {"lat": lat, "lng": lng},
        "ts":      datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "timestamp": ts 
    })

@app.route("/api/sensor/history")
def sensor_history():
    limit = int(request.args.get("limit", 20))
    rows = []
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, newline="") as f:
            rows = list(csv.DictReader(f))
    return jsonify(rows[-limit:])

@app.route("/api/sensor/export")
def export_sensor():
    if not os.path.exists(DATA_FILE):
        return jsonify({"ok": False}), 404
    return send_from_directory(".", DATA_FILE, as_attachment=True,
                               download_name="powertrack_sensor.csv")

@app.route("/api/lampu/export")
def export_lampu():
    if not os.path.exists(LAMPU_FILE):
        return jsonify({"ok": False}), 404
    return send_from_directory(".", LAMPU_FILE, as_attachment=True,
                               download_name="powertrack_lampu.csv")

@app.route("/api/lampu", methods=["GET"])
def get_lampu():
    return jsonify({"on": server_state["lampu_on"]})

@app.route("/api/lampu", methods=["POST"])
def set_lampu():
    body   = request.json or {}
    on     = bool(body.get("on", False))
    mode   = body.get("mode", "manual")
    detail = body.get("detail", "")
    ts_in  = body.get("ts", None)

    server_state["lampu_on"] = on
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    action = "NYALA" if on else "MATI"

    with open(LAMPU_FILE, "a", newline="") as f:
        csv.writer(f).writerow([ts, action, mode, detail, ts_in or ts])

    response_payload = {
        "on": on,
        "mode": mode,
        "detail": detail,
        "ts": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    }
    return jsonify({"ok": True, **response_payload})

@app.route("/api/log")
def get_log():
    limit = int(request.args.get("limit", 50))
    rows = []
    if os.path.exists(LAMPU_FILE):
        with open(LAMPU_FILE, newline="") as f:
            rows = list(csv.DictReader(f))
    return jsonify(list(reversed(rows[-limit:])))

@app.route("/api/motion")
def get_motion():
    detected = random.random() < 0.20  
    ts_iso   = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    ts_log   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if detected:
        device = request.args.get("device", "unknown")
        with open(MOTION_FILE, "a", newline="") as f:
            csv.writer(f).writerow([ts_log, "1", device])
    return jsonify({
        "detected": detected,
        "armed": detected,
        "ts": ts_iso,
        "timestamp": ts_log 
    })

@app.route("/api/motion/history")
def motion_history():
    limit = int(request.args.get("limit", 50))
    rows = []
    if os.path.exists(MOTION_FILE):
        with open(MOTION_FILE, newline="") as f:
            rows = list(csv.DictReader(f))
    return jsonify(list(reversed(rows[-limit:])))

_server_start = time.time()

@app.route("/api/status")
def get_status():
    """MQTT /status topic payload (Device→Server simulation)."""
    uptime_s = int(time.time() - _server_start)
    rssi     = random.randint(-75, -50)
    return jsonify({
        "online":   True,
        "uptime_s": uptime_s,
        "rssi":     rssi,
        "ts":       datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    })

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(".", filename)

if __name__ == "__main__":
    print("=" * 50)
    print("  PowerTrack by Terangin — Backend")
    print("  http://localhost:5000")
    print("  Login: admin / admin123  atau  user / user123")
    print("=" * 50)
    app.run(debug=True, port=5000)
