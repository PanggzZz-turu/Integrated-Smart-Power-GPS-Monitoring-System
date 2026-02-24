"""
WATTSCOPE Backend Server with MQTT Integration
FastAPI + WebSocket + MQTT (HiveMQ Cloud SSL/TLS)
FIXED: MQTT to AsyncIO event loop communication
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
from datetime import datetime
from typing import List
import paho.mqtt.client as mqtt
import ssl
from queue import Queue
import threading

app = FastAPI(title="WATTSCOPE API", version="2.0.0")

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========================================
# MQTT Configuration - HiveMQ Cloud
# ========================================
MQTT_BROKER = "9de252096f4146cb844e4b835206298f.s1.eu.hivemq.cloud"
MQTT_PORT = 8883  # SSL/TLS Port
MQTT_USER = "Testlog"
MQTT_PASS = "Test123456"

MQTT_TOPICS = {
    "solar": "wattscope/sensor/solar",
    "turbine": "wattscope/sensor/turbine", 
    "gps": "wattscope/gps",
    "sensor": "wattscope/sensor"
}

# Global data storage
current_data = {
    "solar": {"voltage": 0, "ampere": 0, "power": 0},
    "turbine": {"voltage": 0, "ampere": 0, "power": 0},
    "gps": {"latitude": -7.2575, "longitude": 112.7521}
}

mqtt_connected = False

# Queue untuk komunikasi MQTT thread -> AsyncIO
mqtt_message_queue = Queue()

# ========================================
# WebSocket Connection Manager
# ========================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"✅ WebSocket client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        print(f"❌ WebSocket client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Broadcast to all connected WebSocket clients"""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"⚠️ Broadcast error: {e}")
                disconnected.append(connection)
        
        for conn in disconnected:
            if conn in self.active_connections:
                self.active_connections.remove(conn)

manager = ConnectionManager()

# ========================================
# MQTT Client Setup with SSL/TLS
# ========================================
mqtt_client = mqtt.Client(client_id="wattscope_backend", protocol=mqtt.MQTTv311)

def on_mqtt_connect(client, userdata, flags, rc):
    global mqtt_connected
    if rc == 0:
        mqtt_connected = True
        print("✅ MQTT Connected to HiveMQ Cloud!")
        
        # Subscribe to all topics
        for name, topic in MQTT_TOPICS.items():
            client.subscribe(topic)
            print(f"📡 Subscribed to: {topic}")
    else:
        mqtt_connected = False
        error_messages = {
            1: "Connection refused - incorrect protocol version",
            2: "Connection refused - invalid client identifier",
            3: "Connection refused - server unavailable",
            4: "Connection refused - bad username or password",
            5: "Connection refused - not authorized"
        }
        print(f"❌ MQTT Connection failed: {error_messages.get(rc, f'Unknown error ({rc})')}")

def on_mqtt_message(client, userdata, msg):
    """Handle incoming MQTT messages from ESP32"""
    try:
        topic = msg.topic
        payload = json.loads(msg.payload.decode())
        
        print(f"📨 MQTT [{topic}]: {payload}")
        
        # Put message in queue untuk diproses oleh asyncio event loop
        mqtt_message_queue.put({
            "topic": topic,
            "payload": payload,
            "timestamp": datetime.now().isoformat()
        })
        
    except json.JSONDecodeError as e:
        print(f"⚠️ JSON decode error: {e}")
    except Exception as e:
        print(f"⚠️ MQTT message error: {e}")

def on_mqtt_disconnect(client, userdata, rc):
    global mqtt_connected
    mqtt_connected = False
    if rc != 0:
        print(f"⚠️ MQTT Unexpected disconnect: {rc}")
        print("🔄 Attempting to reconnect...")
    else:
        print("✅ MQTT Disconnected gracefully")

def on_mqtt_subscribe(client, userdata, mid, granted_qos):
    print(f"✅ Subscription confirmed - QoS: {granted_qos}")

# Setup MQTT callbacks
mqtt_client.on_connect = on_mqtt_connect
mqtt_client.on_message = on_mqtt_message
mqtt_client.on_disconnect = on_mqtt_disconnect
mqtt_client.on_subscribe = on_mqtt_subscribe

# Configure SSL/TLS for HiveMQ Cloud
mqtt_client.tls_set(
    cert_reqs=ssl.CERT_REQUIRED,
    tls_version=ssl.PROTOCOL_TLSv1_2
)

# Set username and password
mqtt_client.username_pw_set(MQTT_USER, MQTT_PASS)

# ========================================
# MQTT Message Processor (AsyncIO)
# ========================================
async def process_mqtt_messages():
    """Background task untuk process messages dari MQTT queue"""
    while True:
        try:
            # Check queue non-blocking
            if not mqtt_message_queue.empty():
                msg_data = mqtt_message_queue.get_nowait()
                topic = msg_data["topic"]
                payload = msg_data["payload"]
                
                # Update current data based on topic
                if topic == MQTT_TOPICS["solar"]:
                    current_data["solar"] = payload
                    await broadcast_sensor_update()
                    
                elif topic == MQTT_TOPICS["turbine"]:
                    current_data["turbine"] = payload
                    await broadcast_sensor_update()
                    
                elif topic == MQTT_TOPICS["sensor"]:
                    # Jika ESP32 mengirim solar + turbine sekaligus
                    if "solar" in payload:
                        current_data["solar"] = payload["solar"]
                    if "turbine" in payload:
                        current_data["turbine"] = payload["turbine"]
                    await broadcast_sensor_update()
                    
                elif topic == MQTT_TOPICS["gps"]:
                    current_data["gps"] = payload
                    await broadcast_gps_update(payload)
                
        except Exception as e:
            print(f"⚠️ Message processing error: {e}")
        
        await asyncio.sleep(0.01)  # Small delay to prevent busy loop

async def broadcast_sensor_update():
    """Broadcast sensor data to WebSocket clients"""
    data = {
        "type": "sensor_data",
        "timestamp": datetime.now().isoformat(),
        "solar": current_data["solar"],
        "turbine": current_data["turbine"]
    }
    await manager.broadcast(data)
    print(f"📡 Broadcasted sensor data to {len(manager.active_connections)} clients")

async def broadcast_gps_update(gps_data):
    """Broadcast GPS data to WebSocket clients"""
    data = {
        "type": "gps_data",
        "timestamp": datetime.now().isoformat(),
        "gps": gps_data
    }
    await manager.broadcast(data)
    print(f"📍 Broadcasted GPS data to {len(manager.active_connections)} clients")

# ========================================
# REST API Endpoints
# ========================================
@app.get("/")
async def root():
    return {
        "name": "WATTSCOPE API",
        "version": "2.0.0",
        "mqtt": {
            "connected": mqtt_connected,
            "broker": MQTT_BROKER,
            "port": MQTT_PORT
        },
        "endpoints": {
            "websocket": "ws://localhost:8000/ws",
            "current_data": "/api/current",
            "status": "/api/status"
        },
        "message": "WATTSCOPE Backend with MQTT Integration"
    }

@app.get("/api/current")
async def get_current_data():
    """Get current sensor data from MQTT"""
    return {
        "timestamp": datetime.now().isoformat(),
        "solar": current_data["solar"],
        "turbine": current_data["turbine"],
        "gps": current_data["gps"],
        "status": {
            "mqtt_connected": mqtt_connected,
            "websocket_clients": len(manager.active_connections)
        }
    }

@app.get("/api/status")
async def get_status():
    return {
        "status": "online",
        "mqtt_connected": mqtt_connected,
        "mqtt_broker": MQTT_BROKER,
        "active_websocket_connections": len(manager.active_connections),
        "server_time": datetime.now().isoformat(),
        "current_data": current_data
    }

# ========================================
# WebSocket Endpoint
# ========================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    try:
        # Send initial connection message with current data
        await websocket.send_json({
            "type": "connection",
            "status": "connected",
            "message": "Connected to WATTSCOPE Backend",
            "timestamp": datetime.now().isoformat(),
            "current_data": current_data,
            "mqtt_connected": mqtt_connected
        })
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                
                # Handle client messages (ping, commands, etc.)
                try:
                    client_msg = json.loads(data)
                    if client_msg.get("type") == "ping":
                        await websocket.send_json({
                            "type": "pong",
                            "timestamp": datetime.now().isoformat()
                        })
                except json.JSONDecodeError:
                    pass
                    
            except asyncio.TimeoutError:
                pass  # No message received, continue
            
            await asyncio.sleep(0.1)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"⚠️ WebSocket error: {e}")
        manager.disconnect(websocket)

# ========================================
# Background Tasks
# ========================================
async def mqtt_reconnect_task():
    """Background task to reconnect MQTT if disconnected"""
    while True:
        if not mqtt_connected:
            try:
                print("🔄 Attempting MQTT reconnection...")
                mqtt_client.reconnect()
            except Exception as e:
                print(f"⚠️ Reconnection failed: {e}")
        
        await asyncio.sleep(10)  # Check every 10 seconds

# ========================================
# Startup & Shutdown Events
# ========================================
@app.on_event("startup")
async def startup_event():
    print("=" * 60)
    print("🚀 WATTSCOPE Backend Server Starting...")
    print("=" * 60)
    print(f"📡 MQTT Broker: {MQTT_BROKER}:{MQTT_PORT}")
    print(f"👤 MQTT User: {MQTT_USER}")
    print(f"🔒 SSL/TLS: Enabled")
    print(f"📂 Topics: {list(MQTT_TOPICS.values())}")
    
    try:
        # Connect to MQTT broker
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_start()
        print("✅ MQTT Client started")
        
        # Start background tasks
        asyncio.create_task(mqtt_reconnect_task())
        asyncio.create_task(process_mqtt_messages())  # ← Penting!
        print("✅ Background tasks started")
        
    except Exception as e:
        print(f"❌ MQTT Connection error: {e}")
        print("⚠️ Server will continue, but MQTT features disabled")
    
    print("=" * 60)
    print("✅ Server Ready!")
    print("🌐 API: http://localhost:8000")
    print("🔌 WebSocket: ws://localhost:8000/ws")
    print("=" * 60)

@app.on_event("shutdown")
async def shutdown_event():
    print("🛑 Shutting down WATTSCOPE Backend...")
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    print("✅ MQTT disconnected")
    print("✅ Server stopped")

# ========================================
# Run Server
# ========================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )