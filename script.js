// ========================================
// WATTSCOPE Dashboard with WebSocket Integration
// ========================================

const CONFIG = {
    updateInterval: 2000,
    chartDataPoints: 20,
    coordinates: { lat: -7.2575, lng: 112.7521 },
    websocketUrl: 'ws://localhost:8000/ws', // Ganti dengan URL server Anda
    reconnectInterval: 5000,
    useSimulation: false // Set true untuk mode simulasi (jika WebSocket gagal)
};

let solarData = { voltage: [], ampere: [], power: [], timestamps: [] };
let turbineData = { voltage: [], ampere: [], power: [], timestamps: [] };
let logEntries = [];

// Chart instances
let solarChart = null;
let turbineChart = null;

// Map instance
let map = null;
let marker = null;
let circle = null;

// WebSocket connection
let ws = null;
let reconnectTimer = null;
let isConnected = false;
let simulationInterval = null;

// ========================================
// WebSocket Connection Management
// ========================================
function connectWebSocket() {
    try {
        console.log('🔌 Connecting to WebSocket...');
        ws = new WebSocket(CONFIG.websocketUrl);
        
        ws.onopen = () => {
            console.log('✅ WebSocket Connected');
            isConnected = true;
            updateConnectionStatus(true);
            clearReconnectTimer();
            stopSimulation(); // Stop simulation if running
            
            addLogEntry(
                new Date().toLocaleString('id-ID'),
                'green',
                'WebSocket: Connected to backend server'
            );
        };
        
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('❌ Error parsing WebSocket message:', error);
            }
        };
        
        ws.onerror = (error) => {
            console.error('❌ WebSocket Error:', error);
            updateConnectionStatus(false);
            addLogEntry(
                new Date().toLocaleString('id-ID'),
                'yellow',
                'WebSocket: Connection error'
            );
        };
        
        ws.onclose = () => {
            console.log('⚠️ WebSocket Disconnected');
            isConnected = false;
            updateConnectionStatus(false);
            
            addLogEntry(
                new Date().toLocaleString('id-ID'),
                'yellow',
                'WebSocket: Disconnected, attempting reconnect...'
            );
            
            // Start simulation as fallback
            if (!CONFIG.useSimulation) {
                console.log('📊 Starting fallback simulation...');
                startSimulation();
            }
            
            scheduleReconnect();
        };
        
    } catch (error) {
        console.error('❌ WebSocket Connection Error:', error);
        
        // Start simulation if WebSocket fails
        if (!CONFIG.useSimulation) {
            console.log('📊 WebSocket failed, starting fallback simulation...');
            startSimulation();
        }
        
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
        if (!isConnected) {
            console.log('🔄 Attempting to reconnect...');
            connectWebSocket();
        }
    }, CONFIG.reconnectInterval);
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function updateConnectionStatus(connected) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (connected) {
        statusDot.style.background = '#22c55e';
        statusText.textContent = 'Status: Online';
        statusText.style.color = '#15803d';
        document.querySelector('.status-indicator').style.background = '#dcfce7';
    } else {
        statusDot.style.background = '#ef4444';
        statusText.textContent = 'Status: Reconnecting...';
        statusText.style.color = '#991b1b';
        document.querySelector('.status-indicator').style.background = '#fee2e2';
    }
}

// ========================================
// WebSocket Message Handler
// ========================================
function handleWebSocketMessage(message) {
    // Validasi message
    if (!message) {
        console.warn('⚠️ Received empty message');
        return;
    }
    
    const { type, data, timestamp, solar, turbine, gps } = message;
    
    console.log('📨 WebSocket message:', type, message);
    
    switch (type) {
        case 'connection':
            console.log('✅ Connection established:', message);
            // Load initial data
            if (message.current_data) {
                if (message.current_data.solar) {
                    updateSolarData(message.current_data.solar);
                }
                if (message.current_data.turbine) {
                    updateTurbineData(message.current_data.turbine);
                }
                if (message.current_data.gps) {
                    updateGPSData(message.current_data.gps);
                }
            }
            break;
            
        case 'sensor_data':
            // Backend mengirim solar dan turbine dalam satu message
            console.log('📊 Sensor data received:', { solar, turbine });
            
            if (solar) {
                updateSolarData(solar);
                addLogEntry(
                    new Date().toLocaleString('id-ID'),
                    'green',
                    `Panel Surya: ${solar.voltage}V, ${solar.ampere}A, ${solar.power}W`
                );
            }
            
            if (turbine) {
                updateTurbineData(turbine);
                addLogEntry(
                    new Date().toLocaleString('id-ID'),
                    'green',
                    `Turbin: ${turbine.voltage}V, ${turbine.ampere}A, ${turbine.power}W`
                );
            }
            break;
            
        case 'solar_data':
            if (data) {
                updateSolarData(data);
                addLogEntry(
                    new Date().toLocaleString('id-ID'),
                    'green',
                    `Panel Surya: ${data.voltage}V, ${data.ampere}A, ${data.power}W`
                );
            }
            break;
            
        case 'turbine_data':
            if (data) {
                updateTurbineData(data);
                addLogEntry(
                    new Date().toLocaleString('id-ID'),
                    'green',
                    `Turbin: ${data.voltage}V, ${data.ampere}A, ${data.power}W`
                );
            }
            break;
            
        case 'gps_data':
            // GPS bisa di dalam 'data' atau langsung di message
            const gpsData = data || gps;
            if (gpsData) {
                updateGPSData(gpsData);
            }
            break;
            
        case 'status_data':
            console.log('📊 Status update:', data);
            break;
            
        case 'system_status':
            console.log('🔔 System status:', message);
            if (message.mqtt_connected !== undefined) {
                updateConnectionStatus(message.mqtt_connected);
            }
            break;
            
        case 'keepalive':
            // Respond to keepalive
            sendPing();
            break;
            
        default:
            console.log('📨 Unknown message type:', type, message);
    }
}

function sendPing() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
    }
}

// ========================================
// Data Update Functions
// ========================================
function updateSolarData(data) {
    // Validasi data
    if (!data || typeof data.voltage === 'undefined' || typeof data.ampere === 'undefined') {
        console.warn('⚠️ Invalid solar data received:', data);
        return;
    }
    
    const voltage = parseFloat(data.voltage) || 0;
    const ampere = parseFloat(data.ampere) || 0;
    const power = parseFloat(data.power) || (voltage * ampere);
    
    const timestamp = new Date().toLocaleTimeString('id-ID', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    // Update display
    updateDisplay('solar-voltage', voltage.toFixed(2) + ' V');
    updateDisplay('solar-ampere', ampere.toFixed(2) + ' A');
    updateDisplay('solar-power', power.toFixed(2) + ' W');
    
    // Store data
    storeSensorData('solar', voltage, ampere, power, timestamp);
    updateChartData();
}

function updateTurbineData(data) {
    // Validasi data
    if (!data || typeof data.voltage === 'undefined' || typeof data.ampere === 'undefined') {
        console.warn('⚠️ Invalid turbine data received:', data);
        return;
    }
    
    const voltage = parseFloat(data.voltage) || 0;
    const ampere = parseFloat(data.ampere) || 0;
    const power = parseFloat(data.power) || (voltage * ampere);
    
    const timestamp = new Date().toLocaleTimeString('id-ID', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    // Update display
    updateDisplay('turbine-voltage', voltage.toFixed(2) + ' V');
    updateDisplay('turbine-ampere', ampere.toFixed(2) + ' A');
    updateDisplay('turbine-power', power.toFixed(2) + ' W');
    
    // Store data
    storeSensorData('turbine', voltage, ampere, power, timestamp);
    updateChartData();
}

function updateGPSData(data) {
    // Validasi data
    if (!data || typeof data.latitude === 'undefined' || typeof data.longitude === 'undefined') {
        console.warn('⚠️ Invalid GPS data received:', data);
        return;
    }
    
    const latitude = parseFloat(data.latitude);
    const longitude = parseFloat(data.longitude);
    
    // Validasi koordinat
    if (isNaN(latitude) || isNaN(longitude)) {
        console.warn('⚠️ Invalid GPS coordinates:', data);
        return;
    }
    
    if (map && marker) {
        // Update marker position
        marker.setLatLng([latitude, longitude]);
        circle.setLatLng([latitude, longitude]);
        
        // Update coordinates display
        const coordsElement = document.querySelector('.coordinates-value');
        if (coordsElement) {
            coordsElement.textContent = `${latitude.toFixed(4)}° S, ${longitude.toFixed(4)}° E`;
        }
        
        addLogEntry(
            new Date().toLocaleString('id-ID'),
            'blue',
            `GPS: Lat ${latitude.toFixed(4)}, Lng ${longitude.toFixed(4)}`
        );
    }
}

// ========================================
// Chart.js Configuration
// ========================================
function createChart(canvasId, label, color) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: label,
                data: [],
                borderColor: color,
                backgroundColor: color + '20',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { 
                        font: { size: 10 },
                        color: '#374151'
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: { display: false },
                    ticks: { 
                        font: { size: 9 },
                        color: '#6b7280',
                        maxRotation: 0
                    }
                },
                y: {
                    display: true,
                    grid: { color: '#e5e7eb' },
                    ticks: { 
                        font: { size: 9 },
                        color: '#6b7280'
                    }
                }
            },
            animation: {
                duration: 300
            }
        }
    });
}

function createMultiChart(canvasId, datasets) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { 
                        font: { size: 9 },
                        color: '#374151'
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: { display: false },
                    ticks: { 
                        font: { size: 8 },
                        color: '#6b7280',
                        maxRotation: 0
                    }
                },
                y: {
                    display: true,
                    grid: { color: '#e5e7eb' },
                    ticks: { 
                        font: { size: 8 },
                        color: '#6b7280'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { 
                        font: { size: 8 }, 
                        color: '#6b7280' 
                    }
                }
            },
            animation: {
                duration: 300
            }
        }
    });
}

function updateChart(chart, labels, data, label) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.data.datasets[0].label = label;
    chart.update('none');
}

function updateMultiChart(chart, labels, datasetsData) {
    chart.data.labels = labels;
    datasetsData.forEach((data, index) => {
        chart.data.datasets[index].data = data;
    });
    chart.update('none');
}

// ========================================
// Navigation
// ========================================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            navItems.forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');
            
            const menuType = this.getAttribute('data-menu');
            handleMenuSwitch(menuType);
        });
    });
}

function handleMenuSwitch(menuType) {
    const sectionMap = {
        'panel': '.panel-section',
        'grafik': '.chart-section',
        'history': '.map-section',
        'alarm': '.log-section'
    };
    
    const targetSection = document.querySelector(sectionMap[menuType]);
    if (targetSection) {
        const navHeight = document.querySelector('nav').offsetHeight;
        const targetPosition = targetSection.offsetTop - navHeight - 10;
        
        window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
        });
    }
}

// ========================================
// Chart Controls
// ========================================
function initChartControls() {
    const chartControlGroups = document.querySelectorAll('.chart-controls');
    
    chartControlGroups.forEach(group => {
        const buttons = group.querySelectorAll('.chart-btn');
        
        buttons.forEach(button => {
            button.addEventListener('click', function() {
                buttons.forEach(btn => btn.classList.remove('active'));
                this.classList.add('active');
                
                const chartType = this.getAttribute('data-chart');
                const deviceType = this.getAttribute('data-type');
                switchChartMode(chartType, deviceType);
            });
        });
    });
}

function switchChartMode(mode, device) {
    const chart = device === 'solar' ? solarChart : turbineChart;
    const data = device === 'solar' ? solarData : turbineData;
    
    if (mode === 'tegangan') {
        if (chart.data.datasets.length > 1) {
            chart.destroy();
            const newChart = createChart(
                device === 'solar' ? 'solar-chart' : 'turbine-chart',
                'Tegangan (V)',
                '#3b82f6'
            );
            if (device === 'solar') solarChart = newChart;
            else turbineChart = newChart;
        }
        updateChart(chart, data.timestamps, data.voltage, 'Tegangan (V)');
        chart.data.datasets[0].borderColor = '#3b82f6';
        chart.data.datasets[0].backgroundColor = '#3b82f620';
        
    } else if (mode === 'ampere') {
        if (chart.data.datasets.length > 1) {
            chart.destroy();
            const newChart = createChart(
                device === 'solar' ? 'solar-chart' : 'turbine-chart',
                'Ampere (A)',
                '#10b981'
            );
            if (device === 'solar') solarChart = newChart;
            else turbineChart = newChart;
        }
        updateChart(chart, data.timestamps, data.ampere, 'Ampere (A)');
        chart.data.datasets[0].borderColor = '#10b981';
        chart.data.datasets[0].backgroundColor = '#10b98120';
        
    } else if (mode === 'daya') {
        if (chart.data.datasets.length > 1) {
            chart.destroy();
            const newChart = createChart(
                device === 'solar' ? 'solar-chart' : 'turbine-chart',
                'Daya (W)',
                '#f59e0b'
            );
            if (device === 'solar') solarChart = newChart;
            else turbineChart = newChart;
        }
        updateChart(chart, data.timestamps, data.power, 'Daya (W)');
        chart.data.datasets[0].borderColor = '#f59e0b';
        chart.data.datasets[0].backgroundColor = '#f59e0b20';
        
    } else if (mode === 'multi') {
        chart.destroy();
        
        const datasets = [
            {
                label: 'Tegangan (V)',
                data: data.voltage,
                borderColor: '#3b82f6',
                backgroundColor: '#3b82f620',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                yAxisID: 'y'
            },
            {
                label: 'Ampere (A)',
                data: data.ampere,
                borderColor: '#10b981',
                backgroundColor: '#10b98120',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                yAxisID: 'y'
            },
            {
                label: 'Daya (W)',
                data: data.power,
                borderColor: '#f59e0b',
                backgroundColor: '#f59e0b20',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                yAxisID: 'y1'
            }
        ];
        
        const newChart = createMultiChart(
            device === 'solar' ? 'solar-chart' : 'turbine-chart',
            datasets
        );
        
        if (device === 'solar') {
            solarChart = newChart;
        } else {
            turbineChart = newChart;
        }
        
        updateMultiChart(newChart, data.timestamps, [data.voltage, data.ampere, data.power]);
    }
    
    chart.update();
}

// ========================================
// Data Simulation (Fallback Mode)
// ========================================
function generateRandomData(min, max) {
    return (Math.random() * (max - min) + min).toFixed(2);
}

function startSimulation() {
    if (simulationInterval) return; // Already running
    
    console.log('🎮 Simulation mode started');
    addLogEntry(
        new Date().toLocaleString('id-ID'),
        'blue',
        'System: Running in simulation mode (demo data)'
    );
    
    // Generate initial data
    simulateSensorData();
    
    // Start interval
    simulationInterval = setInterval(simulateSensorData, CONFIG.updateInterval);
}

function stopSimulation() {
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
        console.log('⏹️ Simulation mode stopped');
    }
}

function simulateSensorData() {
    const timestamp = new Date().toLocaleTimeString('id-ID', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const solarVoltage = parseFloat(generateRandomData(200, 240));
    const solarAmpere = parseFloat(generateRandomData(4, 7));
    const solarPower = parseFloat((solarVoltage * solarAmpere).toFixed(2));
    
    const turbineVoltage = parseFloat(generateRandomData(210, 250));
    const turbineAmpere = parseFloat(generateRandomData(5, 8));
    const turbinePower = parseFloat((turbineVoltage * turbineAmpere).toFixed(2));
    
    updateDisplay('solar-voltage', solarVoltage.toFixed(2) + ' V');
    updateDisplay('solar-ampere', solarAmpere.toFixed(2) + ' A');
    updateDisplay('solar-power', solarPower.toFixed(2) + ' W');
    
    updateDisplay('turbine-voltage', turbineVoltage.toFixed(2) + ' V');
    updateDisplay('turbine-ampere', turbineAmpere.toFixed(2) + ' A');
    updateDisplay('turbine-power', turbinePower.toFixed(2) + ' W');
    
    storeSensorData('solar', solarVoltage, solarAmpere, solarPower, timestamp);
    storeSensorData('turbine', turbineVoltage, turbineAmpere, turbinePower, timestamp);
    
    updateChartData();
}

function updateDisplay(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.transition = 'all 0.3s ease';
        element.style.transform = 'scale(1.1)';
        element.textContent = value;
        
        setTimeout(() => {
            element.style.transform = 'scale(1)';
        }, 300);
    }
}

function storeSensorData(type, voltage, ampere, power, timestamp) {
    const dataStore = type === 'solar' ? solarData : turbineData;
    
    dataStore.voltage.push(parseFloat(voltage));
    dataStore.ampere.push(parseFloat(ampere));
    dataStore.power.push(parseFloat(power));
    dataStore.timestamps.push(timestamp);
    
    if (dataStore.voltage.length > CONFIG.chartDataPoints) {
        dataStore.voltage.shift();
        dataStore.ampere.shift();
        dataStore.power.shift();
        dataStore.timestamps.shift();
    }
}

function updateChartData() {
    const solarActive = document.querySelector('[data-type="solar"].active');
    const turbineActive = document.querySelector('[data-type="turbine"].active');
    
    if (solarActive && solarChart) {
        const mode = solarActive.getAttribute('data-chart');
        if (mode === 'multi') {
            updateMultiChart(solarChart, solarData.timestamps, 
                [solarData.voltage, solarData.ampere, solarData.power]);
        } else {
            const dataMap = {
                'tegangan': solarData.voltage,
                'ampere': solarData.ampere,
                'daya': solarData.power
            };
            updateChart(solarChart, solarData.timestamps, dataMap[mode], 
                solarChart.data.datasets[0].label);
        }
    }
    
    if (turbineActive && turbineChart) {
        const mode = turbineActive.getAttribute('data-chart');
        if (mode === 'multi') {
            updateMultiChart(turbineChart, turbineData.timestamps, 
                [turbineData.voltage, turbineData.ampere, turbineData.power]);
        } else {
            const dataMap = {
                'tegangan': turbineData.voltage,
                'ampere': turbineData.ampere,
                'daya': turbineData.power
            };
            updateChart(turbineChart, turbineData.timestamps, dataMap[mode], 
                turbineChart.data.datasets[0].label);
        }
    }
}

// ========================================
// Log System
// ========================================
function addLogEntry(time, type, message) {
    const logContent = document.querySelector('.log-content');
    
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.style.opacity = '0';
    logEntry.style.transform = 'translateY(-10px)';
    
    logEntry.innerHTML = `
        <span class="log-time">
            <span class="log-dot ${type}"></span>
            ${time}
        </span>
        <span class="log-message">${message}</span>
    `;
    
    logContent.insertBefore(logEntry, logContent.firstChild);
    
    setTimeout(() => {
        logEntry.style.transition = 'all 0.3s ease';
        logEntry.style.opacity = '1';
        logEntry.style.transform = 'translateY(0)';
    }, 10);
    
    logEntries.push({ time, type, message });
    updateLogCount();
    
    const entries = logContent.querySelectorAll('.log-entry');
    if (entries.length > 50) {
        entries[entries.length - 1].remove();
    }
}

function updateLogCount() {
    const logCount = document.querySelector('.log-count');
    if (logCount) {
        logCount.textContent = `Total Logs: ${logEntries.length} entries`;
    }
}

function initLogControls() {
    const refreshBtn = document.querySelector('.log-btn.primary');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            addLogEntry(
                new Date().toLocaleString('id-ID'),
                'blue',
                'System: Manual refresh triggered'
            );
            
            // Request current data from server
            fetchCurrentData();
        });
    }
    
    const exportBtn = document.querySelector('.log-btn.secondary');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportLogs);
    }
}

function exportLogs() {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Time,Type,Message\n";
    
    logEntries.forEach(entry => {
        csvContent += `"${entry.time}","${entry.type}","${entry.message}"\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `wattscope_logs_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    addLogEntry(
        new Date().toLocaleString('id-ID'),
        'blue',
        'System: Logs exported successfully'
    );
}

// ========================================
// REST API Functions
// ========================================
async function fetchCurrentData() {
    try {
        const response = await fetch('http://localhost:8000/api/current');
        const data = await response.json();
        
        if (data.solar) updateSolarData(data.solar);
        if (data.turbine) updateTurbineData(data.turbine);
        if (data.gps) updateGPSData(data.gps);
        
        addLogEntry(
            new Date().toLocaleString('id-ID'),
            'blue',
            'System: Data refreshed from server'
        );
    } catch (error) {
        console.error('❌ Error fetching current data:', error);
        addLogEntry(
            new Date().toLocaleString('id-ID'),
            'yellow',
            'System: Failed to refresh data from server'
        );
    }
}

// ========================================
// GPS Controls & Leaflet Map
// ========================================
function initMap() {
    map = L.map('map').setView([CONFIG.coordinates.lat, CONFIG.coordinates.lng], 15);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
    
    const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #0FD9BF 0%, #0FD9BF 100%);
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 3px solid white;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        "><div style="
            width: 12px;
            height: 12px;
            background: white;
            border-radius: 50%;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(45deg);
        "></div></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
    });
    
    marker = L.marker([CONFIG.coordinates.lat, CONFIG.coordinates.lng], {
        icon: customIcon
    }).addTo(map);
    
    marker.bindPopup(`
        <div style="text-align: center; font-family: 'Segoe UI', sans-serif;">
            <strong style="color: #0FD9BF; font-size: 14px;">WATTSCOPE Station</strong><br>
            <span style="font-size: 11px; color: #6b7280;">Panel Surya & Turbin Angin</span><br>
            <span style="font-size: 10px; color: #9ca3af;">Surabaya, Indonesia</span>
        </div>
    `).openPopup();
    
    circle = L.circle([CONFIG.coordinates.lat, CONFIG.coordinates.lng], {
        color: '#0FD9BF',
        fillColor: '#0FD9BF',
        fillOpacity: 0.1,
        radius: 50
    }).addTo(map);
}

// ========================================
// Initialization
// ========================================
function init() {
    console.log('🚀 WATTSCOPE Dashboard Initialized');
    
    // Initialize charts
    solarChart = createChart('solar-chart', 'Tegangan (V)', '#3b82f6');
    turbineChart = createChart('turbine-chart', 'Tegangan (V)', '#3b82f6');
    
    // Initialize Leaflet map
    initMap();
    
    // Initialize components
    initNavigation();
    initChartControls();
    initLogControls();
    
    addLogEntry(
        new Date().toLocaleString('id-ID'),
        'green',
        'System: Dashboard initialized, connecting to backend...'
    );
    
    // Connect to WebSocket or start simulation
    if (CONFIG.useSimulation) {
        console.log('🎮 Starting in SIMULATION mode');
        startSimulation();
    } else {
        console.log('🔌 Starting in PRODUCTION mode');
        connectWebSocket();
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ========================================
// Public API for External Integration
// ========================================
window.WATTSCOPE = {
    updateSolarData: (voltage, ampere, power) => {
        updateSolarData({ voltage, ampere, power });
    },
    updateTurbineData: (voltage, ampere, power) => {
        updateTurbineData({ voltage, ampere, power });
    },
    updateGPS: (latitude, longitude) => {
        updateGPSData({ latitude, longitude });
    },
    addLog: (message, type = 'green') => {
        addLogEntry(new Date().toLocaleString('id-ID'), type, message);
    },
    reconnect: () => {
        if (!isConnected) {
            connectWebSocket();
        }
    },
    disconnect: () => {
        if (ws) {
            ws.close();
        }
    },
    getStatus: () => ({
        connected: isConnected,
        solarDataPoints: solarData.voltage.length,
        turbineDataPoints: turbineData.voltage.length,
        logEntries: logEntries.length
    })
};