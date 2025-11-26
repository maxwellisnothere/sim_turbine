import React, { useState, useEffect, useCallback } from 'react';
import Paho from 'paho-mqtt';

// ----------------------------------------------------
// *** การตั้งค่า MQTT Broker (ดึงจาก .env) ***
// ----------------------------------------------------
// ตรวจสอบให้แน่ใจว่าได้ตั้งค่า VITE_MQTT_HOST, VITE_MQTT_PORT (9001), 
// VITE_MQTT_USER, และ VITE_MQTT_PASSWD ในไฟล์ .env ของคุณ
const MQTT_HOST = import.meta.env.VITE_MQTT_HOST; // IP Address ของ Broker (เช่น 172.20.10.3)
const MQTT_PORT = import.meta.env.VITE_MQTT_PORT; // Port สำหรับ WebSocket (9001)
const MQTT_USER = import.meta.env.VITE_MQTT_USER;
const MQTT_PASS = import.meta.env.VITE_MQTT_PASSWD;

// ----------------------------------------------------
// *** Component หลัก SensorSimulator_with_button ***
// ----------------------------------------------------

function SensorSimulator() {
    const [client, setClient] = useState(null); 
    const [isConnected, setIsConnected] = useState(false); 
    const [log, setLog] = useState([]); 
    const [availableUnits, setAvailableUnits] = useState([]); 
    const [selectedUnitId, setSelectedUnitId] = useState('unit01'); 
    const [selectedUnitName, setSelectedUnitName] = useState('Default Unit');
    const NODE_RED_API_URL = `http://${MQTT_HOST}:1880`;

    // State สำหรับเก็บค่า Slider ทั้ง 4 ตัว
    const [sensorValues, setSensorValues] = useState({
        'Temperature': 58,
        'Vibration': 7069,
        'RPM Sensor': 5479,
        'Water Level': 347.00,
    });

    // Mapping ชื่อเซนเซอร์ไป Topic Suffix
    const topicMap = {
        'Temperature': '/temp',
        'Vibration': '/vibration',
        'RPM Sensor': '/rpm',
        'Water Level': '/level',
    };
    
    // ฟังก์ชันสำหรับบันทึก Log 
    const addLog = useCallback((message) => {
        setLog(prevLog => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prevLog.slice(0, 9)]);
    }, []);

    // --- 1. เชื่อมต่อ MQTT Broker และดึงข้อมูล Unit (Effect รันครั้งเดียว) ---
    useEffect(() => {
        // --- 1.1 ส่วนดึงข้อมูล Units จาก Node-RED API ---
        const fetchUnits = async () => {
            try {
                const response = await fetch(`${NODE_RED_API_URL}/api/villages/status`);
                
                if (!response.ok) {
                    throw new Error('Failed to fetch units from Node-RED');
                }
                const data = await response.json();
                console.log(data);
                setAvailableUnits(data);
                setSelectedUnitName(data);
                
                // ตั้งค่า Unit แรกเป็นค่าเริ่มต้น
                if (data.length > 0) {
                    setSelectedUnitId(data[0].unit_id);
                    setSelectedUnitName(data[0].name);
                }
            } catch (error) {
                console.error("Error fetching units:", error);
                addLog(`❌ Failed to load Unit list: ${error.message}`);
            }
        };
        fetchUnits();

        // --- 1.2 ส่วนเชื่อมต่อ MQTT Broker (Paho Client) ---
        if (!MQTT_HOST || !MQTT_PORT) {
            addLog('❌ Error: VITE_MQTT_HOST or VITE_MQTT_PORT is missing in .env file.');
            return;
        }

        const clientId = 'react_sim_' + Math.random().toString(16).substr(2, 8);
        
        // สร้าง Client Object
        const mqttClient = new Paho.Client(MQTT_HOST, Number(MQTT_PORT), "", clientId);
        
        // กำหนด Handler เมื่อ Connection หลุด
        mqttClient.onConnectionLost = (response) => { setIsConnected(false); addLog('⚠️ Lost connection'); };
        
        // เริ่มต้นการเชื่อมต่อ
        mqttClient.connect({
            onSuccess: () => { setIsConnected(true); addLog('✅ Connected!'); },
            onFailure: (r) => { setIsConnected(false); addLog(`❌ Failed: ${r.errorMessage}`); },
            userName: MQTT_USER,
            password: MQTT_PASS,
        });
        setClient(mqttClient);
        
        // Cleanup function: ตัดการเชื่อมต่อเมื่อ Component ถูกยกเลิก
        return () => { if (mqttClient && mqttClient.isConnected()) mqttClient.disconnect(); };
    }, [addLog, NODE_RED_API_URL]); 

    // ----------------------------------------------------
    // *** NEW: ฟังก์ชันสำหรับส่งข้อมูลไปยัง Broker (ห่อด้วย useCallback) ***
    // ----------------------------------------------------
    const publishData = useCallback(() => {
        if (!client || !client.isConnected()) {
            addLog('❌ Not connected to Broker. Cannot publish.');
            return;
        }

        const turbineId = selectedUnitId; 
        const currentTopicBase = `gnt/${turbineId}`;
        
        Object.entries(sensorValues).forEach(([sensorName, value]) => {
            const topicSuffix = topicMap[sensorName]; 
            const fullTopic = currentTopicBase + topicSuffix; 
            
            // ตั้งชื่อ Field (เช่น 'Temperature' -> 'temperature')
            const fieldName = sensorName.split(' ')[0].toLowerCase().replace('sensor', 'rpm'); 

            const payloadObject = {};
            payloadObject[fieldName] = value;
            
            const payloadString = JSON.stringify(payloadObject);
            const message = new Paho.Message(payloadString);
            
            message.destinationName = fullTopic;
            
            client.send(message);
            addLog(`➡️ Sent ${fieldName}: ${value.toFixed(2)} to ${fullTopic}`);
        });

        addLog(`✅ Sent 4 Sensor Readings for ${selectedUnitName}.`);
    }, [client, selectedUnitId, sensorValues, topicMap, addLog, selectedUnitName]); 

    // ----------------------------------------------------
    // *** NEW: ตั้งค่า Timer สำหรับส่งข้อมูลทุก 10 วินาที ***
    // ----------------------------------------------------
    useEffect(() => {
        // เริ่ม Interval เฉพาะเมื่อเชื่อมต่อแล้ว
        if (isConnected) {
            // ตั้งค่า Interval ให้เรียก publishData ทุก 10,000 มิลลิวินาที (10 วินาที)
            const intervalId = setInterval(() => {
                publishData();
            }, 10000); 

            // Cleanup function: หยุด Timer เมื่อ Component ถูก Unmount หรือ isConnected เปลี่ยน
            return () => clearInterval(intervalId);
        }
        // Dependency: isConnected และ publishData (ต้องเป็น useCallback)
    }, [isConnected, publishData]); 

    // --- ฟังก์ชันจัดการการเปลี่ยนแปลง Slider ---
    const handleSliderChange = (sensorName, event) => {
        const value = parseFloat(event.target.value);
        setSensorValues(prevValues => ({
            ...prevValues,
            [sensorName]: value,
        }));
    };

    // --- ฟังก์ชันจัดการ Dropdown Change ---
    const handleUnitChange = (e) => {
        const newUnitId = e.target.value;
        setSelectedUnitId(newUnitId);
        
        // อัปเดตชื่อ Unit สำหรับแสดงใน Header และ Log
        const unit = availableUnits.find(u => u.unit_id === newUnitId);
        if (unit) {
            setSelectedUnitName(unit.unit_name);
            
        }
    };

    // --- ส่วนแสดงผล Slider ---
    const renderSlider = (name, min, max, step) => (
        <div key={name} style={{ margin: '20px 0', border: '1px solid #ccc', padding: '15px', borderRadius: '5px' }}>
            <label style={{ display: 'block', fontWeight: 'bold' }}>
                {name}: {sensorValues[name].toFixed(name === 'Water Level' ? 2 : 0)}
            </label>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={sensorValues[name]}
                onChange={(e) => handleSliderChange(name, e)}
                style={{ width: '100%', marginTop: '5px' }}
            />
        </div>
    );

    return (
        <div style={{ maxWidth: '800px', margin: '50px auto', fontFamily: 'Arial' }}>
            {/* อัปเดต Header ให้แสดง Unit Name และ ID ที่ถูกเลือก */}
            <h2>⚙️ Sensor Data Simulator: {selectedUnitName} ({selectedUnitId})</h2>
            
            <div style={{ padding: '10px', backgroundColor: isConnected ? '#d4edda' : '#f8d7da', color: isConnected ? '#155724' : '#721c24', borderRadius: '5px', marginBottom: '20px' }}>
                สถานะ Broker: **{isConnected ? 'เชื่อมต่อแล้ว' : 'กำลังรอเชื่อมต่อ...'}**
            </div>

            {/* Dropdown สำหรับเลือก Unit */}
            <div style={{ marginBottom: '20px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
                <label htmlFor="unit-selector" style={{ fontWeight: 'bold' }}>
                    **เลือกหมู่บ้าน:** {/* <-- เปลี่ยน Label */}
                </label>
                <select
                    id="unit-selector"
                    value={selectedUnitId}
                    onChange={handleUnitChange}
                    style={{ marginLeft: '10px', padding: '8px' }}
                >
                    {availableUnits.map((unit) => (
                        <option key={unit.unit_id} value={unit.unit_id}>
                            {unit.name}
                        </option>
                    ))}
                </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                    {renderSlider('Temperature', 0, 100, 1)}
                    {renderSlider('Vibration', 0, 10000, 10)}
                    {renderSlider('RPM Sensor', 0, 8000, 10)}
                    {renderSlider('Water Level', 0, 1000, 1)}
                </div>
                {/* Log Area */}
                <div style={{ border: '1px solid #eee', padding: '15px', height: '400px', overflowY: 'scroll', backgroundColor: '#f9f9f9' }}>
                    <h4>Activity Log</h4>
                    {log.map((entry, index) => (
                        <div key={index} style={{ fontSize: '0.8em', marginBottom: '3px' }}>{entry}</div>
                    ))}
                </div>
            </div>

            {/* แสดงสถานะการส่งข้อมูลอัตโนมัติ */}
            <div 
                style={{ 
                    marginTop: '20px', 
                    padding: '15px 30px', 
                    fontSize: '1.2em', 
                    cursor: 'default', 
                    backgroundColor: isConnected ? '#007bff' : '#ccc', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '5px',
                    textAlign: 'center'
                }}
            >
                {isConnected ? 
                    '✅ Data Publishing: AUTO (Every 10 seconds)' : 
                    '⏳ Waiting for connection to start AUTO publishing...'
                }
            </div>
        </div>
    );
}

export default SensorSimulator;