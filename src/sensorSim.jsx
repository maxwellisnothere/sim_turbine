import React, { useState, useEffect, useCallback, useRef } from 'react';
import Paho from 'paho-mqtt';

// ----------------------------------------------------
// *** Config & Constants ***
// ----------------------------------------------------
const MQTT_HOST = import.meta.env.VITE_MQTT_HOST;
const MQTT_PORT = Number(import.meta.env.VITE_MQTT_PORT) || 9001;
const MQTT_USER = import.meta.env.VITE_MQTT_USER;
const MQTT_PASS = import.meta.env.VITE_MQTT_PASSWD;

// Topic Mapping (ให้ตรงกับ Node-RED)
const TOPIC_MAP = {
    'Temperature': '/temp',
    'Vibration': '/vibration',
    'RPM Sensor': '/rpm',
    'Water Level': '/level',
};

// Realistic Ranges (ช่วงข้อมูลที่สมจริง)
const RANGES = {
    'Temperature': { min: 20, max: 90, step: 1, unit: '°C' },
    'Vibration':   { min: 0, max: 20, step: 0.1, unit: 'mm/s' }, // 0-20 พอ เกินนี้พัง
    'RPM Sensor':  { min: 0, max: 4000, step: 10, unit: 'RPM' },
    'Water Level': { min: 0, max: 5.0, step: 0.1, unit: 'm' },
};

function SensorSimulator() {
    // --- State Management ---
    const [client, setClient] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isAutoSend, setIsAutoSend] = useState(true); // เปิด Auto เป็นค่าเริ่มต้น
    
    const [availableUnits, setAvailableUnits] = useState([]);
    const [selectedUnitId, setSelectedUnitId] = useState('');
    const [selectedUnitName, setSelectedUnitName] = useState('Loading...');

    const [log, setLog] = useState([]);
    
    // Values State
    const [sensorValues, setSensorValues] = useState({
        'Temperature': 45,
        'Vibration': 2.5,
        'RPM Sensor': 1500,
        'Water Level': 2.5,
    });

    const NODE_RED_API_URL = `http://${MQTT_HOST}:1880`;

    // --- Helper: Add Log ---
    const addLog = (msg) => {
        setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 7)]);
    };

    // --- 1. Fetch Units & Connect MQTT (Run Once) ---
    useEffect(() => {
        // 1.1 Fetch Units
        const fetchUnits = async () => {
            try {
                const res = await fetch(`${NODE_RED_API_URL}/api/villages/status`); // แก้ URL ตาม API จริงของคุณ
                // หมายเหตุ: ถ้า API นี้ยังไม่พร้อม ให้ Hardcode ไปก่อนได้
                // const data = [{ unit_id: 'unit01', name: 'Village 1' }, { unit_id: 'unit02', name: 'Village 2' }];
                
                const data = await res.json();
                if (data && data.length > 0) {
                    setAvailableUnits(data);
                    setSelectedUnitId(data[0].unit_id);
                    setSelectedUnitName(data[0].name || data[0].unit_name);
                } else {
                    // Fallback ถ้าไม่มีข้อมูล
                    const defaults = [{ unit_id: 'unit01', name: 'Default Unit 01' }];
                    setAvailableUnits(defaults);
                    setSelectedUnitId('unit01');
                    setSelectedUnitName('Default Unit 01');
                }
            } catch (err) {
                console.error(err);
                addLog("⚠️ Fetch Error, using default units.");
                setAvailableUnits([{ unit_id: 'unit01', name: 'Fallback Unit' }]);
                setSelectedUnitId('unit01');
            }
        };
        fetchUnits();

        // 1.2 Connect MQTT
        const mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, `sim_${Math.random().toString(16).substr(2,6)}`);
        
        mqttClient.onConnectionLost = (obj) => {
            setIsConnected(false);
            addLog(`❌ Connection Lost: ${obj.errorMessage}`);
        };

        mqttClient.connect({
            onSuccess: () => {
                setIsConnected(true);
                addLog("✅ MQTT Connected!");
            },
            onFailure: (err) => {
                setIsConnected(false);
                addLog(`❌ Connect Failed: ${err.errorMessage}`);
            },
            userName: MQTT_USER,
            password: MQTT_PASS,
            useSSL: false // ปรับเป็น true ถ้าใช้ wss
        });

        setClient(mqttClient);

        return () => {
            if (mqttClient.isConnected()) mqttClient.disconnect();
        };
    }, []);


    // --- 2. Publish Logic ---
    const publishData = useCallback(() => {
        if (!client || !client.isConnected()) return;

        const baseTopic = `gnt/${selectedUnitId}`;
        
        Object.entries(sensorValues).forEach(([name, value]) => {
            const suffix = TOPIC_MAP[name];
            const topic = `${baseTopic}${suffix}`;
            
            // แปลงชื่อ Field ให้ตรงกับ Database (เช่น 'RPM Sensor' -> 'rpm')
            let fieldKey = name.toLowerCase();
            if (name === 'RPM Sensor') fieldKey = 'rpm';
            if (name === 'Water Level') fieldKey = 'level';
            if (name === 'Temperature') fieldKey = 'temperature'; // หรือ temp แล้วแต่ DB

            const payload = JSON.stringify({ [fieldKey]: value });
            
            const message = new Paho.Message(payload);
            message.destinationName = topic;
            client.send(message);
        });

        addLog(`📤 Sent data for ${selectedUnitId}`);
    }, [client, selectedUnitId, sensorValues]);


    // --- 3. Auto Send Interval ---
    useEffect(() => {
        let interval = null;
        if (isConnected && isAutoSend) {
            interval = setInterval(publishData, 5000); // ส่งทุก 5 วินาที
        }
        return () => { if (interval) clearInterval(interval); };
    }, [isConnected, isAutoSend, publishData]);


    // --- Handlers ---
    const handleSlider = (name, val) => {
        setSensorValues(prev => ({ ...prev, [name]: parseFloat(val) }));
    };

    const handleReset = () => {
        // รีเซ็ตทุกอย่างเป็น 0 (เอาไว้แก้บั๊กค่าค้าง)
        const zeroValues = {
            'Temperature': 0,
            'Vibration': 0,
            'RPM Sensor': 0,
            'Water Level': 0,
        };
        setSensorValues(zeroValues);
        // Force send ทันที
        if(client && client.isConnected()) {
            // ต้องใช้ timeout นิดหน่อยเพื่อให้ State อัปเดตก่อนส่ง (แบบบ้านๆ)
            // หรือส่งค่า 0 ไปตรงๆ เลย
            setTimeout(() => {
               // Logic publish ซ้ำตรงนี้ หรือจะรอ Auto รอบหน้าก็ได้
               // แต่เพื่อความชัวร์ ส่ง Manual เลย
               const baseTopic = `gnt/${selectedUnitId}`;
               Object.entries(zeroValues).forEach(([name, val]) => {
                   let fieldKey = name === 'RPM Sensor' ? 'rpm' : (name === 'Water Level' ? 'level' : name.toLowerCase());
                   if(fieldKey === 'temperature') fieldKey = 'temp'; // check db column name mapping
                   
                   const msg = new Paho.Message(JSON.stringify({ [fieldKey]: 0 }));
                   msg.destinationName = `${baseTopic}${TOPIC_MAP[name]}`;
                   client.send(msg);
               });
               addLog("🛑 EMERGENCY RESET SENT!");
            }, 100);
        }
    };

    // --- Render UI ---
    return (
        <div style={{ maxWidth: '600px', margin: '40px auto', fontFamily: 'Sarabun, sans-serif', border:'1px solid #ddd', borderRadius:'12px', overflow:'hidden', boxShadow:'0 4px 15px rgba(0,0,0,0.1)' }}>
            
            {/* Header */}
            <div style={{ background: isConnected ? 'linear-gradient(to right, #28a745, #218838)' : '#dc3545', color: 'white', padding: '20px', textAlign: 'center' }}>
                <h2 style={{ margin: 0 }}>🎛️ Simulation Controller</h2>
                <div style={{ fontSize: '0.9rem', marginTop: '5px', opacity: 0.9 }}>
                    Status: {isConnected ? 'ONLINE 🟢' : 'OFFLINE 🔴'}
                </div>
            </div>

            <div style={{ padding: '20px' }}>
                
                {/* Unit Selector */}
                <div style={{ marginBottom: '20px' }}>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Target Unit:</label>
                    <select 
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontSize:'1rem' }}
                        value={selectedUnitId}
                        onChange={(e) => {
                            setSelectedUnitId(e.target.value);
                            const u = availableUnits.find(u => u.unit_id === e.target.value);
                            if(u) setSelectedUnitName(u.name || u.unit_name);
                        }}
                    >
                        {availableUnits.map(u => (
                            <option key={u.unit_id} value={u.unit_id}>{u.name || u.unit_name} ({u.unit_id})</option>
                        ))}
                    </select>
                </div>

                {/* Controls Area */}
                <div style={{ background: '#f8f9fa', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <h3 style={{ margin: 0 }}>Sensors</h3>
                        <button 
                            onClick={handleReset}
                            style={{ background: '#dc3545', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize:'0.8rem' }}
                        >
                            🛑 STOP / RESET 0
                        </button>
                    </div>

                    {Object.entries(RANGES).map(([name, conf]) => (
                        <div key={name} style={{ marginBottom: '15px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize:'0.9rem' }}>
                                <label>{name}</label>
                                <span style={{ fontWeight: 'bold', color: '#007bff' }}>
                                    {sensorValues[name].toFixed(name === 'Vibration' ? 2 : 0)} {conf.unit}
                                </span>
                            </div>
                            <input 
                                type="range" 
                                min={conf.min} max={conf.max} step={conf.step}
                                value={sensorValues[name]}
                                onChange={(e) => handleSlider(name, e.target.value)}
                                style={{ width: '100%', cursor: 'pointer' }}
                            />
                        </div>
                    ))}
                </div>

                {/* Actions */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button
                        onClick={() => setIsAutoSend(!isAutoSend)}
                        style={{
                            padding: '12px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                            background: isAutoSend ? '#ffc107' : '#28a745',
                            color: isAutoSend ? '#212529' : 'white',
                            fontWeight: 'bold'
                        }}
                    >
                        {isAutoSend ? '⏸️ Pause Auto-Send' : '▶️ Start Auto-Send'}
                    </button>
                    
                    <button
                        onClick={publishData}
                        disabled={isAutoSend} // ถ้า Auto อยู่ ให้ปิดปุ่มนี้กันกดซ้ำ
                        style={{
                            padding: '12px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                            background: '#17a2b8', color: 'white',
                            opacity: isAutoSend ? 0.6 : 1
                        }}
                    >
                        📤 Send Once
                    </button>
                </div>

                {/* Logs */}
                <div style={{ marginTop: '20px', background: '#343a40', color: '#00ff00', padding: '10px', borderRadius: '6px', height: '150px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {log.length === 0 && <div style={{opacity:0.5}}>Waiting for activity...</div>}
                    {log.map((l, i) => <div key={i}>{l}</div>)}
                </div>

            </div>
        </div>
    );
}

export default SensorSimulator;