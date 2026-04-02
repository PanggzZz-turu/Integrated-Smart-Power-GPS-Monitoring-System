const API = "http://localhost:5000/api";
const state = {
  username: '',
  password: '',
  selectedDevice: null,
  devices: [],
  solarData:   { v:[], a:[], w:[], t:[] },
  turbineData: { v:[], a:[], w:[], t:[] },
  logs: [],
  solarChart: null,
  turbineChart: null,
  map: null,
  marker: null,
  circle: null,
  interval: null,
  motionInterval: null,
  statusInterval: null,
  alarms: []
};
const MAX_PTS = 20;

function mqttTopic(topicSensor) {
  const dev = state.selectedDevice || '—';
  return `Terangin/${state.username}/${state.password}/${dev}/${topicSensor}`;
}
function mqttBase() {
  return `Terangin/${state.username}/${state.password}`;
}

function toggleTheme() {
  const html    = document.documentElement;
  const isLight = html.classList.toggle('light');
  localStorage.setItem('pt-theme', isLight ? 'light' : 'dark');
  const gc = isLight ? 'rgba(0,0,0,0.07)'   : 'rgba(255,255,255,0.04)';
  const tc = isLight ? '#8aaabb'             : '#3d5566';
  const lc = isLight ? '#4a6a7a'             : '#7a9aaa';
  [state.solarChart, state.turbineChart].forEach(c => {
    if (!c) return;
    c.options.scales.x.grid.color = gc;
    c.options.scales.y.grid.color = gc;
    c.options.scales.x.ticks.color = tc;
    c.options.scales.y.ticks.color = tc;
    c.options.plugins.legend.labels.color = lc;
    c.update('none');
  });
}
(function () {
  if (localStorage.getItem('pt-theme') === 'light')
    document.documentElement.classList.add('light');
})();

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.getElementById('btn-login').addEventListener('click', doLogin);
document.getElementById('login-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

async function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value.trim();
  const err  = document.getElementById('login-error');
  const btn  = document.getElementById('btn-login');

  if (!user || !pass) {
    err.classList.add('show'); err.textContent = 'Username dan password wajib diisi.'; return;
  }
  btn.classList.add('loading'); btn.textContent = 'Menghubungkan...';
  err.classList.remove('show');

  try {
    const res  = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    if (data.ok) {
      state.username = data.username;
      state.password = pass;
      await loadDevicePage(data.username);
      showPage('page-devices');
    } else {
      err.classList.add('show'); err.textContent = data.msg;
    }
  } catch {
    err.classList.add('show'); err.textContent = 'Tidak dapat terhubung ke server.';
  } finally {
    btn.classList.remove('loading'); btn.textContent = 'Masuk';
  }
}

async function loadDevicePage(user) {
  try {
    const res = await fetch(`${API}/devices`);
    state.devices = await res.json();
  } catch {
    state.devices = [
      { id:'device1', color:'teal',   online:true,  isNew:false },
      { id:'device2', color:'orange', online:true,  isNew:false },
      { id:'device3', color:'gray',   online:false, isNew:false },
      { id:'device4', color:'blue',   online:true,  isNew:true  },
    ];
  }
  const online = state.devices.filter(d => d.online).length;
  document.getElementById('dev-topic-label').textContent =
    `Terangin/${user}/${state.password}/# — ${online} device terdeteksi`;
  state.selectedDevice = state.devices.find(d => d.online)?.id || null;
  renderDeviceList();
}

function renderDeviceList() {
  const list = document.getElementById('device-list');
  list.innerHTML = '';
  state.devices.forEach((dev, i) => {
    const el = document.createElement('div');
    el.className = 'device-card' +
      (dev.id === state.selectedDevice ? ' selected' : '') +
      (!dev.online ? ' offline' : '') +
      (dev.isNew ? ' new-device' : '');
    el.style.animationDelay = (i * 0.08) + 's';
    el.innerHTML = `
      <div class="dev-icon ${dev.color}">${dev.id.replace('device','D')}</div>
      <div class="dev-info">
        <div class="dev-name">${dev.id}</div>
        <div class="dev-topic">Terangin/${state.username}/${state.password}/${dev.id}</div>
        ${dev.isNew ? '<div class="dev-new-badge">▸ baru terdeteksi</div>' : ''}
      </div>
      <div class="dev-status">
        <div class="dot-status ${dev.online ? 'dot-online' : 'dot-offline'}"></div>
        <span class="${dev.online ? 'status-online' : 'status-offline'}">${dev.online ? 'online' : 'offline'}</span>
      </div>`;
    if (dev.online) {
      el.addEventListener('click', () => {
        state.selectedDevice = dev.id;
        renderDeviceList();
        document.getElementById('btn-monitor').textContent = `Monitor ${dev.id} →`;
      });
    }
    list.appendChild(el);
  });
  document.getElementById('btn-monitor').textContent = `Monitor ${state.selectedDevice} →`;
}

document.getElementById('btn-monitor').addEventListener('click', () => {
  if (!state.selectedDevice) return;
  document.getElementById('nav-device-name').textContent =
    `Terangin/${state.username}/***/${state.selectedDevice}`;
  showPage('page-dashboard');
  initDashboard();
});

document.getElementById('btn-logout').addEventListener('click', () => {
  clearInterval(state.interval); state.interval = null;
  clearInterval(state.motionInterval); state.motionInterval = null;
  clearInterval(state.statusInterval); state.statusInterval = null;
  state.username = ''; state.password = ''; state.selectedDevice = null;
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  showPage('page-login');
});

document.getElementById('btn-switch').addEventListener('click', () => {
  clearInterval(state.interval); state.interval = null;
  clearInterval(state.motionInterval); state.motionInterval = null;
  clearInterval(state.statusInterval); state.statusInterval = null;
  renderDeviceList(); showPage('page-devices');
});

function initDashboard() {
  state.solarData   = { v:[], a:[], w:[], t:[] };
  state.turbineData = { v:[], a:[], w:[], t:[] };
  state.logs = [];
  state.alarms = [];
  document.getElementById('log-list').innerHTML = '';
  updateLogCount();
  const badge = document.getElementById('alarm-badge');
  if (badge) { badge.textContent = '0'; badge.classList.add('hidden'); }
  renderAlarmPanel();

  initCharts();
  initMap();
  initNavMenu();
  initChartControls();
  initLampu();

  addLog('green', `Terhubung ke ${mqttTopic('sensor')}`);
  addLog('blue',  `MQTT topic: Terangin/${state.username}/***/${state.selectedDevice}/#`);

  fetchSensor();
  state.interval = setInterval(fetchSensor, 2000);

  fetchMotion();
  state.motionInterval = setInterval(fetchMotion, 10000);

  publishStatus();
  state.statusInterval = setInterval(publishStatus, 30000);
}

function initNavMenu() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const sec = this.getAttribute('data-section');
      const target = document.getElementById('section-' + sec);
      if (target) {
        const navH = document.querySelector('nav').offsetHeight;
        window.scrollTo({ top: target.offsetTop - navH - 8, behavior: 'smooth' });
      }
    });
  });
}

async function fetchSensor() {
  try {
    const res  = await fetch(`${API}/sensor`);
    const raw  = await res.json();

    const data = {
      solar:   { v: parseFloat(raw.solar.v),   a: parseFloat(raw.solar.a),   w: parseFloat(raw.solar.w)   },
      turbine: { v: parseFloat(raw.turbine.v), a: parseFloat(raw.turbine.a), w: parseFloat(raw.turbine.w) },
      gps:     { lat: raw.gps.lat, lng: raw.gps.lng },
      ts:      raw.timestamp ? new Date(raw.timestamp.replace(' ','T')).toISOString() : new Date().toISOString()
    };

    const ts = data.ts.split('T')[1]?.substring(0,8) || data.ts;

    setVal('solar-v',   data.solar.v   + ' V');
    setVal('solar-a',   data.solar.a   + ' A');
    setVal('solar-w',   data.solar.w   + ' W');
    setVal('turbine-v', data.turbine.v + ' V');
    setVal('turbine-a', data.turbine.a + ' A');
    setVal('turbine-w', data.turbine.w + ' W');

    push(state.solarData,   data.solar.v,   data.solar.a,   data.solar.w,   ts);
    push(state.turbineData, data.turbine.v, data.turbine.a, data.turbine.w, ts);
    updateActiveChart('solar');
    updateActiveChart('turbine');

    const lat = data.gps.lat, lng = data.gps.lng;
    document.getElementById('map-coords').textContent =
      `${lat.toFixed(4)}° S, ${lng.toFixed(4)}° E`;
    if (state.marker) {
      state.marker.setLatLng([lat, lng]);
      state.circle.setLatLng([lat, lng]);
    }

    if (Math.random() > 0.6)
      addLog('green', `[${mqttTopic('sensor')}] Solar: ${data.solar.v}V ${data.solar.a}A ${data.solar.w}W | Turbin: ${data.turbine.v}V ${data.turbine.a}A ${data.turbine.w}W`);

  } catch {
    addLog('red', 'Gagal mengambil data sensor dari server');
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.style.transform = 'scale(1.05)';
  setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
}

function push(store, v, a, w, t) {
  store.v.push(v); store.a.push(a); store.w.push(w); store.t.push(t);
  if (store.v.length > MAX_PTS) {
    store.v.shift(); store.a.shift(); store.w.shift(); store.t.shift();
  }
}

function mkChart(id, label, color) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{ label, data: [], borderColor: color, backgroundColor: color + '22',
                   borderWidth: 2, fill: true, tension: 0.4, pointRadius: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#7a9aaa', font: { size: 10 } } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#3d5566', font: { size: 9 }, maxRotation: 0 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#3d5566', font: { size: 9 } } }
      },
      animation: { duration: 200 }
    }
  });
}

function mkMultiChart(id, datasets) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#7a9aaa', font: { size: 9 } } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#3d5566', font: { size: 8 }, maxRotation: 0 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#3d5566', font: { size: 8 } } },
        y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#3d5566', font: { size: 8 } } }
      },
      animation: { duration: 200 }
    }
  });
}

function initCharts() {
  if (state.solarChart)   state.solarChart.destroy();
  if (state.turbineChart) state.turbineChart.destroy();
  state.solarChart   = mkChart('solar-chart',   'Tegangan (V)', '#0FD9BF');
  state.turbineChart = mkChart('turbine-chart', 'Tegangan (V)', '#FF4800');
  document.querySelectorAll('.chart-btn').forEach(b => {
    if (b.getAttribute('data-chart') === 'tegangan') b.classList.add('active');
    else b.classList.remove('active');
  });
}

function initChartControls() {
  document.querySelectorAll('.chart-btns').forEach(group => {
    group.querySelectorAll('.chart-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        group.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        switchChart(this.getAttribute('data-chart'), this.getAttribute('data-type'));
      });
    });
  });
}

function switchChart(mode, type) {
  const isS   = type === 'solar';
  const canId = isS ? 'solar-chart' : 'turbine-chart';
  const data  = isS ? state.solarData : state.turbineData;
  let chart   = isS ? state.solarChart : state.turbineChart;
  chart.destroy();

  const colors = { tegangan: '#0FD9BF', ampere: '#22c55e', daya: '#FFB800' };
  if (mode === 'multi') {
    const ds = [
      { label:'Tegangan (V)', data: data.v, borderColor:'#0FD9BF', backgroundColor:'#0FD9BF22', borderWidth:2, fill:false, tension:0.4, yAxisID:'y' },
      { label:'Ampere (A)',   data: data.a, borderColor:'#22c55e', backgroundColor:'#22c55e22', borderWidth:2, fill:false, tension:0.4, yAxisID:'y' },
      { label:'Daya (W)',     data: data.w, borderColor:'#FFB800', backgroundColor:'#FFB80022', borderWidth:2, fill:false, tension:0.4, yAxisID:'y1' }
    ];
    const nc = mkMultiChart(canId, ds);
    nc.data.labels = data.t; nc.update('none');
    if (isS) state.solarChart = nc; else state.turbineChart = nc;
    return;
  }
  const map = { tegangan: ['v','Tegangan (V)'], ampere: ['a','Ampere (A)'], daya: ['w','Daya (W)'] };
  const [key, label] = map[mode];
  const nc = mkChart(canId, label, colors[mode]);
  nc.data.labels = [...data.t]; nc.data.datasets[0].data = [...data[key]]; nc.update('none');
  if (isS) state.solarChart = nc; else state.turbineChart = nc;
}

function updateActiveChart(type) {
  const activeBtn = document.querySelector(`.chart-btn.active[data-type="${type}"]`);
  if (!activeBtn) return;
  const mode  = activeBtn.getAttribute('data-chart');
  const chart = type === 'solar' ? state.solarChart : state.turbineChart;
  const data  = type === 'solar' ? state.solarData  : state.turbineData;
  if (!chart) return;
  if (mode === 'multi') {
    chart.data.labels = data.t;
    chart.data.datasets[0].data = data.v;
    chart.data.datasets[1].data = data.a;
    chart.data.datasets[2].data = data.w;
  } else {
    const key = mode === 'tegangan' ? 'v' : mode === 'ampere' ? 'a' : 'w';
    chart.data.labels = data.t;
    chart.data.datasets[0].data = data[key];
  }
  chart.update('none');
}

function initMap() {
  if (state.map) { state.map.remove(); state.map = null; }
  const lat = -7.2575, lng = 112.7521;
  state.map = L.map('map').setView([lat, lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(state.map);
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;background:#0FD9BF;border-radius:50%;border:2px solid white;box-shadow:0 0 8px rgba(15,217,191,0.6)"></div>`,
    iconSize: [14,14], iconAnchor: [7,7]
  });
  state.marker = L.marker([lat, lng], { icon }).addTo(state.map);
  state.marker.bindPopup(
    `<b style="color:#0FD9BF">PowerTrack</b><br><small style="font-family:monospace">Terangin/${state.username}/***/${state.selectedDevice}</small>`
  ).openPopup();
  state.circle = L.circle([lat, lng], {
    color:'#0FD9BF', fillColor:'#0FD9BF', fillOpacity:0.08, radius:60
  }).addTo(state.map);
}

function addLog(color, msg) {
  const time = new Date().toLocaleString('id-ID');
  state.logs.unshift({ color, msg, time });
  if (state.logs.length > 100) state.logs.pop();
  const list = document.getElementById('log-list');
  const el   = document.createElement('div');
  el.className = `log-entry ${color}`;
  el.innerHTML = `<div class="log-time">${time}</div><div class="log-msg">${msg}</div>`;
  list.insertBefore(el, list.firstChild);
  if (list.children.length > 50) list.lastChild.remove();
  updateLogCount();
}

function updateLogCount() {
  document.getElementById('log-count').textContent = `${state.logs.length} entri`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh-log').addEventListener('click', () => {
    addLog('blue', 'Manual refresh oleh user');
  });
  document.getElementById('btn-export-log').addEventListener('click', async () => {
    try {
      const a = document.createElement('a');
      a.href = `${API}/sensor/export`; a.click();
      addLog('blue', 'Export sensor CSV dari server');
    } catch {

      let csv = 'Time,Color,Message\n';
      state.logs.forEach(l => { csv += `"${l.time}","${l.color}","${l.msg}"\n`; });
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = `powertrack_log_${Date.now()}.csv`; a.click();
      addLog('blue', 'Log berhasil diekspor (lokal)');
    }
  });
});

async function fetchMotion() {
  try {
    const res  = await fetch(`${API}/motion?device=${state.selectedDevice}`);
    const raw  = await res.json();

    if (raw.detected) {
      const ts = raw.ts || new Date().toISOString();
      triggerAlarm(ts);

      const serverAlarmCmd = {
        motion:      true,
        sensitivity: "medium",
        ts:          new Date().toISOString()
      };
      addLog('red',
        `[${mqttTopic('alarm')}] Server→Device: motion:true sensitivity:${serverAlarmCmd.sensitivity}`);
    }
  } catch {

  }
}

let _startTime = Date.now();

async function publishStatus() {
  try {
    const res     = await fetch(`${API}/status`);
    const payload = await res.json();
    addLog('blue',
      `[${mqttTopic('status')}] online:${payload.online} uptime:${payload.uptime_s}s rssi:${payload.rssi}dBm`);
    return payload;
  } catch {

  }
}

  const time = timestamp || new Date().toLocaleString('id-ID');

  state.alarms.unshift({ time, device: state.selectedDevice });
  if (state.alarms.length > 99) state.alarms.pop();

  const bell  = document.getElementById('alarm-bell');
  const badge = document.getElementById('alarm-badge');
  bell.classList.add('ringing');
  setTimeout(() => bell.classList.remove('ringing'), 600);
  badge.textContent = state.alarms.length > 99 ? '99+' : state.alarms.length;
  badge.classList.remove('hidden');
  badge.classList.add('pop');
  setTimeout(() => badge.classList.remove('pop'), 300);

  renderAlarmPanel();

  showToast(
    '🚨 Gerak Terdeteksi!',
    `${state.selectedDevice} · ${time}`
  );

  addLog('red', `[${mqttTopic('alarm')}] ⚠ PIR: Gerak terdeteksi — armed:true`);

function renderAlarmPanel() {
  const list = document.getElementById('alarm-panel-list');
  if (!list) return;
  if (state.alarms.length === 0) {
    list.innerHTML = `<div class="alarm-empty">Belum ada alarm terdeteksi</div>`;
    return;
  }
  list.innerHTML = state.alarms.map(a => `
    <div class="alarm-entry">
      <div class="alarm-entry-dot"></div>
      <div class="alarm-entry-info">
        <div class="alarm-entry-msg">⚠ Gerak terdeteksi</div>
        <div class="alarm-entry-time">${a.device} · ${a.time}</div>
      </div>
    </div>`).join('');
}

function openAlarmPanel() {
  const panel = document.getElementById('alarm-panel');
  panel.classList.toggle('open');
}

function clearAlarms() {
  state.alarms = [];
  const badge = document.getElementById('alarm-badge');
  badge.textContent = '0';
  badge.classList.add('hidden');
  renderAlarmPanel();
  document.getElementById('alarm-panel').classList.remove('open');
}

document.addEventListener('click', e => {
  const panel = document.getElementById('alarm-panel');
  const bell  = document.getElementById('alarm-bell');
  if (panel && !panel.contains(e.target) && bell && !bell.contains(e.target)) {
    panel.classList.remove('open');
  }
});

function showToast(title, sub) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <div class="toast-icon">🚨</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-sub">${sub}</div>
    </div>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, 4000);
}

const lampuState = {
  on: false,
  activeTimers: [],
  activeJadwals: [],
  jadwalCheckInterval: null
};

async function initLampu() {
  try {
    const res  = await fetch(`${API}/lampu`);
    const data = await res.json();
    lampuState.on = data.on;
  } catch { lampuState.on = false; }
  renderLampuUI();
  renderActiveTimers();
  renderActiveJadwals();
  startJadwalChecker();
  addLog('blue', `[${mqttTopic('lampu')}] Kontrol lampu diinisialisasi`);
}

function renderLampuUI() {
  const btn  = document.getElementById('single-lampu-btn');
  const lbl  = document.getElementById('single-lampu-label');
  const dot  = document.getElementById('lampu-live-dot');
  const live = document.getElementById('lampu-live-label');
  const on   = lampuState.on;
  btn.classList.toggle('on', on);
  lbl.textContent  = on ? 'NYALA' : 'MATI';
  dot.classList.toggle('on', on);
  live.textContent = on ? 'Nyala' : 'Mati';
  document.getElementById('btn-manual-on') ?.classList.toggle('active-state', on);
  document.getElementById('btn-manual-off')?.classList.toggle('active-state', !on);
}

function toggleLampu() { setLampu(!lampuState.on, 'manual', 'Toggle dari ikon'); }

async function setLampu(on, mode = 'manual', detail = '') {
  lampuState.on = on;
  renderLampuUI();
  addLog(on ? 'green' : 'yellow', `[${mqttTopic('lampu')}] Lampu ${on ? 'dinyalakan' : 'dimatikan'} (${mode})`);

  const payload = {
    on,
    mode,
    detail,
    ts: new Date().toISOString()
  };

  try {
    await fetch(`${API}/lampu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch { addLog('red', 'Gagal sinkronisasi status lampu ke server'); }
}

function switchLampuMode(mode, btn) {
  document.querySelectorAll('.lampu-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.lampu-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('lampu-panel-' + mode).classList.add('active');
}

let timerIdCounter = 1;

function startTimer() {
  const action  = document.getElementById('timer-action').value;
  const minutes = parseInt(document.getElementById('timer-duration').value) || 1;
  const ms      = minutes * 60 * 1000;
  const endsAt  = Date.now() + ms;
  const label   = `${action === 'on' ? 'Nyalakan' : 'Matikan'} setelah ${minutes} mnt`;
  const tid     = timerIdCounter++;

  const intervalId = setInterval(() => {
    const remaining = endsAt - Date.now();
    const el = document.getElementById(`timer-countdown-${tid}`);
    if (el) {
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }
    if (remaining <= 0) executeTimerAction(tid, action);
  }, 1000);

  lampuState.activeTimers.push({ id: tid, action, endsAt, label, intervalId });
  renderActiveTimers();
  addLog('blue', `Timer set: ${label}`);
}

function executeTimerAction(tid, action) {
  setLampu(action === 'on', 'timer', `Timer #${tid}`);
  cancelTimer(tid);
}

function cancelTimer(tid) {
  const idx = lampuState.activeTimers.findIndex(t => t.id === tid);
  if (idx === -1) return;
  clearInterval(lampuState.activeTimers[idx].intervalId);
  lampuState.activeTimers.splice(idx, 1);
  renderActiveTimers();
}

function renderActiveTimers() {
  const container = document.getElementById('active-timers');
  if (!container) return;
  if (lampuState.activeTimers.length === 0) {
    container.innerHTML = `<div style="text-align:center;font-size:11px;color:var(--text-dim);padding:8px 0">Tidak ada timer aktif</div>`;
    return;
  }
  container.innerHTML = lampuState.activeTimers.map(t => {
    const rem = Math.max(0, t.endsAt - Date.now());
    const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
    return `<div class="timer-item">
      <div class="timer-item-info">
        <div class="timer-item-main">${t.label}</div>
        <div class="timer-item-sub">Hitung mundur</div>
      </div>
      <div class="timer-countdown" id="timer-countdown-${t.id}">${m}:${s.toString().padStart(2,'0')}</div>
      <button class="btn-cancel-timer" onclick="cancelTimer(${t.id})">✕</button>
    </div>`;
  }).join('');
}

let jadwalIdCounter = 1;

function addJadwal() {
  const action = document.getElementById('jadwal-action').value;
  const time   = document.getElementById('jadwal-time').value;
  const hari   = document.getElementById('jadwal-hari').value;
  if (!time) return;
  const hariLabel = { daily:'Setiap Hari', weekday:'Sen–Jum', weekend:'Sab–Min' }[hari];
  const label = `${action === 'on' ? 'Nyala' : 'Mati'} @ ${time} (${hariLabel})`;
  lampuState.activeJadwals.push({ id: jadwalIdCounter++, action, time, hari, label });
  renderActiveJadwals();
  addLog('blue', `Jadwal ditambahkan: ${label}`);
}

function cancelJadwal(jid) {
  const idx = lampuState.activeJadwals.findIndex(j => j.id === jid);
  if (idx !== -1) lampuState.activeJadwals.splice(idx, 1);
  renderActiveJadwals();
}

function renderActiveJadwals() {
  const container = document.getElementById('active-jadwals');
  if (!container) return;
  if (lampuState.activeJadwals.length === 0) {
    container.innerHTML = `<div style="text-align:center;font-size:11px;color:var(--text-dim);padding:8px 0">Tidak ada jadwal aktif</div>`;
    return;
  }
  container.innerHTML = lampuState.activeJadwals.map(j => `
    <div class="timer-item">
      <div class="timer-item-info">
        <div class="timer-item-main">${j.label}</div>
        <div class="timer-item-sub" id="jadwal-next-${j.id}">Menghitung...</div>
      </div>
      <button class="btn-cancel-timer" onclick="cancelJadwal(${j.id})">✕</button>
    </div>`).join('');
  updateJadwalNextLabels();
}

function updateJadwalNextLabels() {
  lampuState.activeJadwals.forEach(j => {
    const el = document.getElementById(`jadwal-next-${j.id}`);
    if (!el) return;
    const now = new Date();
    const [h, m] = j.time.split(':').map(Number);
    const target = new Date(); target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const diff = target - now;
    const hh = Math.floor(diff / 3600000);
    const mm = Math.floor((diff % 3600000) / 60000);
    el.textContent = `Berikutnya: ${hh}j ${mm}m lagi`;
  });
}

function startJadwalChecker() {
  if (lampuState.jadwalCheckInterval) clearInterval(lampuState.jadwalCheckInterval);
  lampuState.jadwalCheckInterval = setInterval(() => {
    const now     = new Date();
    const timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
    const day     = now.getDay();
    lampuState.activeJadwals.forEach(j => {
      if (j.time !== timeStr) return;
      if (j.hari === 'weekday' && (day === 0 || day === 6)) return;
      if (j.hari === 'weekend' && day !== 0 && day !== 6) return;
      setLampu(j.action === 'on', 'jadwal', j.label);
    });
    updateJadwalNextLabels();
  }, 10000);
}
