import React, { useState, useEffect, useCallback } from 'react';
import Paho from 'paho-mqtt';

// ----------------------------------------------------
// *** Config & Constants ***
// ----------------------------------------------------
const MQTT_HOST = import.meta.env.VITE_MQTT_HOST;
const MQTT_PORT = Number(import.meta.env.VITE_MQTT_PORT) || 9001;
const MQTT_USER = import.meta.env.VITE_MQTT_USER;
const MQTT_PASS = import.meta.env.VITE_MQTT_PASSWD;

const TOPIC_MAP = {
    'Temperature': '/temp',
    'Vibration': '/vibration',
    'RPM Sensor': '/rpm',
    'Water Level': '/level',
};

const RANGES = {
    'Temperature': { min: 20, max: 90, step: 1, unit: '°C', icon: '🌡️' },
    'Vibration':   { min: 0, max: 20, step: 0.1, unit: 'mm/s', icon: '〰️' },
    'RPM Sensor':  { min: 0, max: 4000, step: 10, unit: 'RPM', icon: '⚙️' },
    'Water Level': { min: 0, max: 5.0, step: 0.1, unit: 'm', icon: '💧' },
};

// --- Styles based on the uploaded image (Dark Navy/Black + Amber Yellow) ---
const customStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;600&display=swap');

  :root {
    --bg-dark: #0f1014;
    --card-bg: #1C1E26;
    --card-highlight: #2A2D3A;
    --accent: #FFD166;
    --accent-hover: #ffdb85;
    --text-primary: #ffffff;
    --text-secondary: #8b8e99;
    --danger: #ef4444;
    --success: #10b981;
    --accent-glow: rgba(255, 209, 102, 0.5); /* Glow effect */
  }

  body {
    background-color: var(--bg-dark);
    margin: 0;
    font-family: 'Prompt', sans-serif;
  }

  /* The main phone-like container */
  .app-container {
    background: var(--card-bg);
    color: var(--text-primary);
    max-width: 420px;
    margin: 40px auto;
    border-radius: 35px;
    overflow: hidden;
    box-shadow: 0 30px 60px rgba(0,0,0,0.6), 0 0 0 1px #333; /* Subtle border with shadow */
    position: relative;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }
  .app-container:hover {
    box-shadow: 0 40px 70px rgba(0,0,0,0.7), 0 0 10px var(--accent-glow); /* Container glow */
  }

  /* Status Bar / Header */
  .header {
    padding: 30px 25px 10px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .header h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
    color: var(--text-primary);
    text-shadow: 0 2px 4px rgba(0,0,0,0.3); /* Text shadow */
  }
  .status-badge {
    font-size: 0.75rem;
    padding: 6px 12px;
    border-radius: 20px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255,255,255,0.05);
    transition: background 0.3s, box-shadow 0.3s;
  }
  .status-badge.online {
    background: rgba(16, 185, 129, 0.1); /* Green tint when online */
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.2); /* Green glow */
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 8px currentColor;
    transition: box-shadow 0.3s;
  }
  .status-badge.online .status-dot {
    box-shadow: 0 0 15px currentColor; /* Stronger glow when online */
    animation: pulse-green 2s infinite;
  }
  @keyframes pulse-green {
    0% { box-shadow: 0 0 8px currentColor; }
    50% { box-shadow: 0 0 15px currentColor; }
    100% { box-shadow: 0 0 8px currentColor; }
  }

  /* Custom Select Dropdown */
  .select-wrapper {
    position: relative;
    margin: 20px 25px;
  }
  .custom-select {
    width: 100%;
    padding: 16px 20px;
    border-radius: 18px;
    background: var(--card-highlight);
    border: 1px solid transparent;
    color: var(--text-primary);
    font-size: 1rem;
    font-family: inherit;
    appearance: none;
    cursor: pointer;
    transition: all 0.3s;
  }
  .custom-select:focus, .custom-select:hover {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 4px rgba(255, 209, 102, 0.1), 0 0 10px var(--accent-glow); /* Hover/focus glow */
  }
  .select-icon {
    position: absolute;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--text-secondary);
  }

  /* Sensor Cards (Mini Widgets) */
  .sensor-list {
    padding: 0 25px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .sensor-item {
    background: rgba(255,255,255,0.02);
    border-radius: 20px;
    padding: 15px 20px;
    border: 1px solid rgba(255,255,255,0.05);
    transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
  }
  .sensor-item:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
    box-shadow: 0 5px 15px rgba(0,0,0,0.3), 0 0 10px var(--accent-glow); /* Card glow on hover */
  }
  .sensor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .sensor-label {
    color: var(--text-secondary);
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sensor-value {
    color: var(--accent);
    font-weight: 600;
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 5px var(--accent-glow); /* Value glow */
  }

  /* Styled Range Slider */
  input[type=range] {
    -webkit-appearance: none;
    width: 100%;
    background: transparent;
  }
  input[type=range]:focus {
    outline: none;
  }
  input[type=range]::-webkit-slider-runnable-track {
    width: 100%;
    height: 6px;
    cursor: pointer;
    background: #3E414B;
    border-radius: 10px;
    transition: background 0.3s;
  }
  input[type=range]:hover::-webkit-slider-runnable-track {
    background: #4E515B; /* Lighter track on hover */
  }
  input[type=range]::-webkit-slider-thumb {
    height: 20px;
    width: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    -webkit-appearance: none;
    margin-top: -7px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.5), 0 0 8px var(--accent-glow); /* Thumb glow */
    border: 3px solid var(--card-bg);
    transition: transform 0.1s, box-shadow 0.1s;
  }
  input[type=range]::-webkit-slider-thumb:hover, input[type=range]:active::-webkit-slider-thumb {
    transform: scale(1.2); /* Larger scale */
    box-shadow: 0 4px 12px rgba(0,0,0,0.6), 0 0 15px var(--accent-glow); /* Stronger glow on hover/active */
  }

  /* Action Buttons Area */
  .actions-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
    padding: 25px;
    margin-top: 10px;
  }
  .btn-main {
    border: none;
    border-radius: 16px;
    padding: 16px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    position: relative; /* For overflow hidden */
    overflow: hidden;
  }
  
  .btn-primary {
    background: var(--accent);
    color: #121212;
    box-shadow: 0 4px 15px rgba(255, 209, 102, 0.3); /* Stronger shadow */
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 6px 20px rgba(255, 209, 102, 0.5), 0 0 20px var(--accent-glow); /* Strong hover glow */
    transform: translateY(-2px);
  }
  .btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    box-shadow: none;
  }

  .btn-secondary {
    background: transparent;
    border: 2px solid #3E414B;
    color: var(--text-primary);
  }
  .btn-secondary:hover:not(.active) {
    border-color: var(--accent-hover);
    color: var(--accent-hover);
    box-shadow: 0 0 10px var(--accent-glow) inset; /* Inset glow on hover */
    transform: translateY(-2px);
  }
  .btn-secondary.active {
    border-color: var(--accent);
    background: rgba(255, 209, 102, 0.15); /* Slightly stronger active background */
    color: var(--accent);
    box-shadow: 0 0 15px var(--accent-glow) inset; /* Stronger inset glow */
    animation: pulse-yellow 1.5s infinite; /* Pulse animation when active */
  }
  @keyframes pulse-yellow {
    0% { box-shadow: 0 0 15px var(--accent-glow) inset; }
    50% { box-shadow: 0 0 25px var(--accent-glow) inset; background: rgba(255, 209, 102, 0.25); }
    100% { box-shadow: 0 0 15px var(--accent-glow) inset; }
  }
  .btn-secondary:active { transform: scale(0.98); }

  .reset-btn {
    background: transparent;
    color: var(--text-secondary);
    border: none;
    font-size: 0.8rem;
    cursor: pointer;
    padding: 5px;
    transition: color 0.3s, text-shadow 0.3s;
  }
  .reset-btn:hover {
    color: var(--danger);
    text-shadow: 0 0 5px rgba(239, 68, 68, 0.5); /* Danger glow */
  }

  /* Log Terminal */
  .log-terminal {
    background: #121318;
    margin: 0 25px 30px;
    border-radius: 16px;
    padding: 15px;
    height: 120px;
    overflow-y: auto;
    font-family: 'Courier New', monospace;
    font-size: 0.75rem;
    border: 1px solid #2A2D3A;
    box-shadow: inset 0 0 10px rgba(0,0,0,0.5); /* Inset shadow */
    transition: border-color 0.3s, box-shadow 0.3s;
  }
  .log-terminal:hover {
    border-color: var(--accent);
    box-shadow: inset 0 0 10px rgba(0,0,0,0.5), 0 0 10px var(--accent-glow); /* Terminal glow */
  }
  .log-line {
    margin-bottom: 4px;
    color: #6B7280;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.3s, text-shadow 0.3s;
  }
  .log-line:hover {
    color: var(--text-primary);
  }
  .log-line.latest {
    color: var(--accent);
    text-shadow: 0 0 5px var(--accent-glow); /* Latest log glow */
    animation: flash 1s ease-out; /* Flash animation on new log */
  }
  @keyframes flash {
    0% { opacity: 0.5; }
    50% { opacity: 1; }
    100% { opacity: 1; }
  }
  
  /* Scrollbar */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #3E414B; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--accent); } /* Scrollbar hover color */
`;

function SensorSimulator() {
    // --- State Management (Same Logic) ---
    const [client, setClient] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isAutoSend, setIsAutoSend] = useState(true);
    
    const [availableUnits, setAvailableUnits] = useState([]);
    const [selectedUnitId, setSelectedUnitId] = useState('');
    const [selectedUnitName, setSelectedUnitName] = useState('Loading...');
    const [log, setLog] = useState([]);
    
    const [sensorValues, setSensorValues] = useState({
        'Temperature': 45,
        'Vibration': 2.5,
        'RPM Sensor': 1500,
        'Water Level': 2.5,
    });

    const NODE_RED_API_URL = `http://${MQTT_HOST}:1880`;

    const addLog = (msg) => {
        setLog(prev => [`> ${msg}`, ...prev.slice(0, 7)]);
    };

    // --- Effects & Logic (Same as before) ---
    useEffect(() => {
        const fetchUnits = async () => {
            try {
                const res = await fetch(`${NODE_RED_API_URL}/api/villages/status`);
                const data = await res.json();
                if (data && data.length > 0) {
                    setAvailableUnits(data);
                    setSelectedUnitId(data[0].unit_id);
                    setSelectedUnitName(data[0].name || data[0].unit_name);
                } else {
                    const defaults = [{ unit_id: 'unit01', name: 'Factory Unit A-01' }, { unit_id: 'unit02', name: 'Factory Unit B-02' }];
                    setAvailableUnits(defaults);
                    setSelectedUnitId('unit01');
                    setSelectedUnitName('Factory Unit A-01');
                }
            } catch (err) {
                console.error(err);
                setAvailableUnits([{ unit_id: 'unit01', name: 'Demo Unit 01' }]);
                setSelectedUnitId('unit01');
            }
        };
        fetchUnits();

        const mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, `sim_${Math.random().toString(16).substr(2,6)}`);
        mqttClient.onConnectionLost = (obj) => { setIsConnected(false); addLog(`Lost: ${obj.errorMessage}`); };
        mqttClient.connect({
            onSuccess: () => { setIsConnected(true); addLog("Connected to Broker"); },
            onFailure: (err) => { setIsConnected(false); addLog(`Fail: ${err.errorMessage}`); },
            userName: MQTT_USER, password: MQTT_PASS, useSSL: false 
        });
        setClient(mqttClient);
        return () => { if (mqttClient.isConnected()) mqttClient.disconnect(); };
    }, []);

    const publishData = useCallback(() => {
        if (!client || !client.isConnected()) return;
        const baseTopic = `gnt/${selectedUnitId}`;
        Object.entries(sensorValues).forEach(([name, value]) => {
            const suffix = TOPIC_MAP[name];
            let fieldKey = name.toLowerCase();
            if (name === 'RPM Sensor') fieldKey = 'rpm';
            if (name === 'Water Level') fieldKey = 'level';
            if (name === 'Temperature') fieldKey = 'temperature'; 
            const payload = JSON.stringify({ [fieldKey]: value });
            const message = new Paho.Message(payload);
            message.destinationName = `${baseTopic}${suffix}`;
            client.send(message);
        });
        addLog(`Sent to ${selectedUnitId}`);
    }, [client, selectedUnitId, sensorValues]);

    useEffect(() => {
        let interval = null;
        if (isConnected && isAutoSend) interval = setInterval(publishData, 5000); 
        return () => { if (interval) clearInterval(interval); };
    }, [isConnected, isAutoSend, publishData]);

    const handleSlider = (name, val) => {
        setSensorValues(prev => ({ ...prev, [name]: parseFloat(val) }));
    };

    const handleReset = () => {
        const zeroValues = { 'Temperature': 0, 'Vibration': 0, 'RPM Sensor': 0, 'Water Level': 0 };
        setSensorValues(zeroValues);
        addLog("Resetting values...");
        // (Logic to send 0 is omitted for brevity but can be added back if needed)
    };

    // --- Render ---
    return (
        <>
            <style>{customStyles}</style>
            <div className="app-container">
                
                {/* Header */}
                <div className="header">
                    <div>
                        <h2 style={{letterSpacing: '-1px'}}>Simulator</h2>
                        <div style={{color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop:'4px'}}>Control Panel</div>
                    </div>
                    <div className={`status-badge ${isConnected ? 'online' : ''}`} style={{ color: isConnected ? 'var(--success)' : 'var(--danger)' }}>
                        <div className="status-dot" style={{ backgroundColor: isConnected ? 'var(--success)' : 'var(--danger)' }}></div>
                        {isConnected ? 'ONLINE' : 'OFFLINE'}
                    </div>
                </div>

                {/* Unit Select */}
                <div className="select-wrapper">
                    <select 
                        className="custom-select"
                        value={selectedUnitId}
                        onChange={(e) => {
                            setSelectedUnitId(e.target.value);
                            const u = availableUnits.find(u => u.unit_id === e.target.value);
                            if(u) setSelectedUnitName(u.name || u.unit_name);
                        }}
                    >
                        {availableUnits.map(u => (
                            <option key={u.unit_id} value={u.unit_id}>{u.name || u.unit_name}</option>
                        ))}
                    </select>
                    <div className="select-icon">▼</div>
                </div>

                {/* Sensor Sliders */}
                <div className="sensor-list">
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 5px'}}>
                        <span style={{color:'var(--text-primary)', fontWeight:'600', textShadow: '0 0 5px rgba(0,0,0,0.5)'}}>Sensors</span>
                        <button className="reset-btn" onClick={handleReset}>Reset All</button>
                    </div>

                    {Object.entries(RANGES).map(([name, conf]) => (
                        <div key={name} className="sensor-item">
                            <div className="sensor-header">
                                <div className="sensor-label">
                                    <span>{conf.icon}</span> {name}
                                </div>
                                <div className="sensor-value">
                                    {sensorValues[name].toFixed(name === 'Vibration' ? 2 : 0)} 
                                    <span style={{fontSize:'0.7em', marginLeft:'4px', opacity:0.7}}>{conf.unit}</span>
                                </div>
                            </div>
                            <input 
                                type="range" 
                                min={conf.min} max={conf.max} step={conf.step}
                                value={sensorValues[name]}
                                onChange={(e) => handleSlider(name, e.target.value)}
                            />
                        </div>
                    ))}
                </div>

                {/* Action Buttons */}
                <div className="actions-grid">
                    <button
                        className={`btn-main btn-secondary ${isAutoSend ? 'active' : ''}`}
                        onClick={() => setIsAutoSend(!isAutoSend)}
                    >
                        {isAutoSend ? '⏸ Pause' : '▶ Auto Run'}
                    </button>
                    
                    <button
                        className="btn-main btn-primary"
                        onClick={publishData}
                        disabled={isAutoSend}
                    >
                        Send Data
                    </button>
                </div>

                {/* Log Terminal */}
                <div className="log-terminal">
                    {log.length === 0 && <div style={{opacity:0.3, fontStyle:'italic'}}>System idle...</div>}
                    {log.map((l, i) => (
                        <div key={i} className={`log-line ${i === 0 ? 'latest' : ''}`}>{l}</div>
                    ))}
                </div>

            </div>
        </>
    );
}

export default SensorSimulator;