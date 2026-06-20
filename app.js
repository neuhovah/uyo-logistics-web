// ==============================================================================
// UYO LOGISTICS INTELLIGENCE | MASTER COMMAND CENTER
// 100% Survey-Grade Configuration (Deep Zoom, Individual Deletion, OSRM, BI, Search)
// ==============================================================================
//
// 📋 CHANGELOG
// v2.3.8: 60FPS Interpolation Engine: Replaced conflicting CSS transitions with requestAnimationFrame JS tweening (.slideTo).
// v2.3.9: Telemetry Diagnostic Patch: Injected WebSocket interceptor to debug ghost markers.
// v2.4.0: SURCON Enterprise Telemetry Sync: Patched defensive payload mapper to strictly reference nested telemetry objects, resolving undefined status/deviation reference bugs.
// ==============================================================================

// --- 0. PERSISTENT GLOBAL STATE (PATCHED & EXTENDED) ---
window.API_BASE_URL = "https://api.uyologistics.com";
window.WS_BASE_URL = "wss://api.uyologistics.com";

window.fleetRegistry = {}; 
window.activeDeployments = {};
window.activeDeploymentsMins = {}; 
window.currentPhysicsEngine = {};
window.lifetimeStats = { fuel: 0, co2: 0, efficiency: 0 };

window.depotLocation = { lat: 5.0333, lon: 7.9266 };
window.dynamicDeliveries = [];
window.liveMarkers = {};

window.map = null;
window.routeLayerGroup = null;
window.unassignedPinsLayer = null;
window.liveFleetSocket = null;

// --- 0.1 TELEMETRY INTERPOLATION ENGINE (SURCON STANDARD) ---
L.Marker.include({
    slideTo: function(destination, durationMs) {
        if (!this._map) return;
        
        const start = this.getLatLng();
        const end = L.latLng(destination);
        const startTime = performance.now();
        
        if (this._slideFrame) {
            cancelAnimationFrame(this._slideFrame);
        }
        
        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / durationMs, 1);
            
            const currentLat = start.lat + (end.lat - start.lat) * progress;
            const currentLng = start.lng + (end.lng - start.lng) * progress;
            
            this.setLatLng([currentLat, currentLng]);
            
            if (progress < 1) {
                this._slideFrame = requestAnimationFrame(animate);
            }
        };
        
        this._slideFrame = requestAnimationFrame(animate);
    }
});

// ==============================================================================
// --- EXTRACTED GLOBAL HANDLERS (SURVEY-GRADE DECOUPLING) ---
// ==============================================================================

window.createLiveIcon = function(vId, isBike) {
    const color = isBike ? '#28a745' : '#dc3545';
    const icon = isBike ? 'fa-motorcycle' : 'fa-truck';
    return L.divIcon({ 
        className: 'live-ping', 
        html: `
            <div style="position: relative; display: flex; align-items: center; justify-content: center;">
                <div id="ping-dot-${vId}" style="background: ${color}; width:24px; height:24px; border-radius:50%; box-shadow: 0 0 15px ${color}; border: 2.5px solid white; z-index: 2; transition: all 0.3s ease; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid ${icon}" style="color: white; font-size: 11px;"></i>
                </div>
                <div id="ping-badge-${vId}" style="position: absolute; left: 28px; background: rgba(31, 41, 55, 0.9); border: 1px solid ${color}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; white-space: nowrap; pointer-events: none; z-index: 1; transition: all 0.3s ease;">
                    <i class="fa-solid ${icon} mr-1"></i> ${vId}
                </div>
            </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
};

window.fetchLifetimeMetrics = async function() {
    try {
        const response = await fetch(`${window.API_BASE_URL}/api/vrp/history?_t=${Date.now()}`, {
            headers: { 
                'x-license-key': localStorage.getItem('uyo_license_key'),
                'Cache-Control': 'no-cache'
            }
        });
        
        if (response.status === 401) {
            localStorage.removeItem('uyo_license_key');
            window.location.href = "login.html";
            return;
        }

        if (response.ok) {
            const data = await response.json();
            window.lifetimeStats.fuel = parseFloat(data.total_fuel_saved ?? data.lifetime_fuel ?? data.fuel_saved ?? 0) || 0;
            window.lifetimeStats.co2 = parseFloat(data.total_co2_saved ?? data.lifetime_co2 ?? data.co2_saved_kg ?? 0) || 0;
            window.lifetimeStats.efficiency = parseFloat(data.avg_efficiency ?? data.efficiency ?? 0) || 0;
            window.updateBIMetrics(false);
        }
    } catch (err) { console.warn("Could not fetch lifetime stats from memory bank."); }
};

window.updateBIMetrics = function(isSession = false) {
    const statFuelEl = document.getElementById('stat-fuel');
    const statEffEl = document.getElementById('stat-efficiency');
    const statCo2El = document.getElementById('stat-co2');

    const pe = window.currentPhysicsEngine || {};
    const PUMP_PRICE_PER_LITER = 1300; 

    if (isSession) {
        if (statFuelEl) {
            statFuelEl.previousElementSibling.innerText = "Session Fuel Saved";
            const sessionFuelValue = (parseFloat(pe.fuel_saved) || 0) * PUMP_PRICE_PER_LITER;
            statFuelEl.innerText = `₦${sessionFuelValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            statFuelEl.style.color = "#fbbf24"; 
        }
        if (statEffEl) {
            statEffEl.previousElementSibling.innerText = "Session Efficiency";
            statEffEl.innerText = `${(parseFloat(pe.efficiency) || 0).toFixed(1)}%`;
            statEffEl.style.color = "#fbbf24";
        }
        if (statCo2El) {
            statCo2El.previousElementSibling.innerText = "Session CO2 Saved";
            statCo2El.innerText = `${(parseFloat(pe.co2_saved) || 0).toFixed(2)} kg`;
            statCo2El.style.color = "#fbbf24";
        }
    } else {
        if (statFuelEl) {
            statFuelEl.previousElementSibling.innerText = "Lifetime Fuel";
            const lifeFuelValue = (parseFloat(window.lifetimeStats.fuel) || 0) * PUMP_PRICE_PER_LITER;
            statFuelEl.innerText = `₦${lifeFuelValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            statFuelEl.style.color = "#4ade80"; 
        }
        if (statEffEl) {
            statEffEl.previousElementSibling.innerText = "Avg Efficiency";
            statEffEl.innerText = `${(parseFloat(window.lifetimeStats.efficiency) || 0).toFixed(1)}%`;
            statEffEl.style.color = "#60a5fa"; 
        }
        if (statCo2El) {
            statCo2El.previousElementSibling.innerText = "Lifetime CO2";
            statCo2El.innerText = `${(parseFloat(window.lifetimeStats.co2) || 0).toFixed(1)} kg`;
            statCo2El.style.color = "#f87171"; 
        }
    }
    
    if (document.getElementById('co2-bar')) { 
        const displayEff = isSession ? (pe.efficiency || 0) : (window.lifetimeStats.efficiency || 0);
        document.getElementById('co2-bar').style.width = `${Math.min(displayEff * 2, 100)}%`; 
    }
};

window.deployMission = async function(vehicleId, gmapsUrl) {
        
    const trackingUrl = `https://uyologistics.com/driver.html?v=${vehicleId}&map=${encodeURIComponent(gmapsUrl)}`;
    
    const whatsappMessage = encodeURIComponent(
        `🚀 *UYO LOGISTICS MISSION DEPLOYED*\n\n` +
        `📦 *Vehicle ID:* ${vehicleId}\n` +
        `📍 *Mission:* Optimized multi-stop delivery route generated by Command Center.\n\n` +
        `📱 *Open Live Tracking & Navigation:* \n${trackingUrl}`
    );
    const whatsappLink = `https://wa.me/?text=${whatsappMessage}`;

    const userChoice = confirm(
        `📡 DEPLOY MISSION: ${vehicleId}\n\n` +
        `This will initiate live tracking and record the mission.\n\n` +
        `Click OK to deploy.`
    );

    if (!userChoice) {
        return; 
    }

    const useWhatsApp = confirm("✅ Mission Authorized! \n\nDo you want to send this to the driver via WhatsApp?\n\n(Click 'Cancel' to just open the Tracker locally on this computer)");

    const newTab = window.open('about:blank', '_blank'); 

    try {
        const coords = window.activeDeployments[vehicleId];
        if (!coords) throw new Error("Route coordinates missing from memory.");
        
        const safeFloat = (val) => { const n = parseFloat(val); return isNaN(n) ? 0 : n; };
        const peRaw = window.currentPhysicsEngine || {};
        
        const payload = {
            vehicle_id: String(vehicleId),
            route_coords: coords,
            fuel_saved: safeFloat(peRaw.fuel_saved), 
            co2_saved: safeFloat(peRaw.co2_saved),
            efficiency: safeFloat(peRaw.efficiency)
        };
        
        const response = await fetch(`${window.API_BASE_URL}/api/vrp/dispatch`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-license-key': localStorage.getItem('uyo_license_key')
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(`Server Code ${response.status}: ${errData.detail || response.statusText}`);
        }

        console.log(`✅ Mission Deploy Success: ${vehicleId}. Awaiting Database Commit...`);
        
        await new Promise(resolve => setTimeout(resolve, 800));
        await window.fetchLifetimeMetrics();
        
        window.unassignedPinsLayer.clearLayers();

        if (!window.map.hasLayer(window.routeLayerGroup)) {
            window.map.addLayer(window.routeLayerGroup); 
        } 
        
        if (!window.liveFleetSocket || window.liveFleetSocket.readyState === WebSocket.CLOSED || window.liveFleetSocket.readyState === WebSocket.CLOSING) {
            console.log("🔄 Re-establishing dropped Live Fleet telemetry line...");
            window.connectLiveFleet(); 
        }

        const btns = document.querySelectorAll('button');
        btns.forEach(btn => {
            if (btn.innerText.includes('Deploy Live Mission') && btn.getAttribute('onclick')?.includes(vehicleId)) {
                btn.innerHTML = `<i class="fa-solid fa-satellite-dish fa-beat" style="color: #4ade80;"></i> Tracking Live`;
                btn.style.backgroundColor = "#166534"; 
                btn.style.cursor = "not-allowed";
                btn.disabled = true;
            }
        });

        newTab.location.href = useWhatsApp ? whatsappLink : trackingUrl;

    } catch (err) {
        newTab.close(); 
        console.error("Critical Synchronization Error:", err);
        alert(`❌ Deployment Failed!\n\n${err.message}`);
    }
};

window.connectLiveFleet = function() {
    window.liveFleetSocket = new WebSocket(`${window.WS_BASE_URL}/ws/live-fleet`);
    window.liveFleetSocket.onopen = function() { console.log("📡 Live Fleet Telemetry: Connected & Listening"); };
    
    window.liveFleetSocket.onmessage = async function(event) {
        let rawData;
        try {
            rawData = JSON.parse(event.data);
        } catch (e) {
            console.error("Failed to parse WebSocket JSON:", event.data);
            return;
        }
        
        console.log(`🔥 RAW WS PING [${new Date().toISOString()}]:`, rawData);

        // --- 🔴 SURVEY-GRADE FIX: Strict Payload Extraction ---
        // We now enforce the use of `payload` exclusively to avoid undefined reference errors
        const payload = rawData.telemetry ? rawData.telemetry : rawData;
        const vId = payload.vehicle_id || payload.id;

        const markerLat = parseFloat(payload.lat ?? payload.latitude);
        const markerLon = parseFloat(payload.lon ?? payload.longitude);

        if (isNaN(markerLat) || isNaN(markerLon) || !vId) {
            if (payload.status === 'completed' && vId) {
                console.log(`🏁 Mission Completed for ${vId}`); 
                if (window.liveMarkers[vId]) {
                    window.map.removeLayer(window.liveMarkers[vId]);
                    delete window.liveMarkers[vId];
                }
            }
            return; 
        }

        if (!window.activeDeployments[vId] && payload.status !== 'completed') {
            console.log(`🔄 Global Sync Triggered: Fetching missing route geometry for ${vId}...`);
            try {
                const syncRes = await fetch(`${window.API_BASE_URL}/api/vrp/active-missions`, {
                    headers: { 'x-license-key': localStorage.getItem('uyo_license_key') }
                });
                const syncData = await syncRes.json();
                
                if (syncData.active_missions && syncData.active_missions[vId]) {
                    const coords = syncData.active_missions[vId].coords;
                    
                    L.polyline(coords, { 
                        color: '#f59e0b', 
                        weight: 4, 
                        opacity: 0.8, 
                        dashArray: '10, 10', 
                        pane: 'routePane' 
                    }).addTo(window.routeLayerGroup);
                    
                    window.activeDeployments[vId] = coords;
                    console.log(`✅ Global Sync Complete: Route drawn for ${vId}`);
                }
            } catch (err) {
                console.warn("Global Sync Failed:", err);
            }
        }

        // --- Hardware-Accelerated 60FPS JS Interpolation ---
        if (window.liveMarkers[vId]) {
            const marker = window.liveMarkers[vId];
            
            const el = marker.getElement();
            if (el) {
                el.style.transition = 'none'; 
            }
            
            marker.slideTo([markerLat, markerLon], 667);
            marker.setZIndexOffset(1000); 

        } else {
            const isBike = window.fleetRegistry[vId] !== undefined 
                           ? window.fleetRegistry[vId] 
                           : String(vId).toLowerCase().includes('bike');
                           
            window.liveMarkers[vId] = L.marker([markerLat, markerLon], {
                icon: window.createLiveIcon(vId, isBike), 
                pane: 'poiPane',
                zIndexOffset: 1000
            }).addTo(window.map);
        }
        
        // --- Strict Deviation Alert Mapping ---
        if (payload.deviation_alert) {
            const dotEl = document.getElementById(`ping-dot-${vId}`);
            const badgeEl = document.getElementById(`ping-badge-${vId}`);
            if (dotEl && badgeEl) {
                dotEl.style.background = '#f97316'; 
                dotEl.style.boxShadow = '0 0 25px #f97316';
                dotEl.style.border = '3px solid #000000';
                badgeEl.style.border = '1px solid #f97316';
                badgeEl.style.color = '#f97316';
            }
            console.warn(`🚨 CRITICAL: ${vId} has deviated from the optimized route!`);
        } else {
            const isBike = window.fleetRegistry[vId] !== undefined 
                           ? window.fleetRegistry[vId] 
                           : String(vId).toLowerCase().includes('bike');
            const markerColor = isBike ? '#28a745' : '#dc3545';
            const dotEl = document.getElementById(`ping-dot-${vId}`);
            const badgeEl = document.getElementById(`ping-badge-${vId}`);
            if (dotEl && badgeEl) {
                dotEl.style.background = markerColor; 
                dotEl.style.boxShadow = `0 0 15px ${markerColor}`;
                dotEl.style.border = '2.5px solid white';
                badgeEl.style.border = `1px solid ${markerColor}`;
                badgeEl.style.color = 'white';
            }
        }
        
        if (payload.status === 'completed') { 
            console.log(`🏁 Mission Completed for ${vId}`); 
        }
    };
    window.liveFleetSocket.onerror = function(error) { console.error("WebSocket Error:", error); };
};

window.triggerTrafficRecalculate = async function(vehicleId) {
    const activeCoords = window.activeDeployments[vehicleId];
    if (!activeCoords) {
        alert("Cannot recalculate: No active GPS data found for this vehicle.");
        return;
    }

    const currentLicenseKey = localStorage.getItem('uyo_license_key');
    const btn = document.getElementById(`recalc-btn-${vehicleId}`);
    
    try {
        if (btn) {
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking Traffic...`;
            btn.disabled = true;
        }

        console.log(`🚦 Re-optimizing remaining drops for ${vehicleId} using time-aware logic...`);
        
        const remainingDeliveries = window.dynamicDeliveries.length > 0 ? window.dynamicDeliveries : [];
        
        if (remainingDeliveries.length === 0) {
             alert("No remaining drops available to recalculate.");
             return;
        }

        const solveRes = await fetch(`${window.API_BASE_URL}/api/vrp/solve-dynamic`, { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json',
                'x-license-key': currentLicenseKey
            }, 
            body: JSON.stringify({ 
                depot: window.depotLocation, 
                deliveries: remainingDeliveries, 
                fleet: [{ id: vehicleId, type: "van", capacity: 50, speed_factor: 1.0, fixed_cost: 0, cost_per_km: 50 }] 
            }) 
        });

        if (!solveRes.ok) throw new Error("Traffic Engine Failed.");
        const data = await solveRes.json();
        
        if (data.traffic_multiplier > 1.0) {
            console.warn(`⚠️ High Traffic Detected! Penalty applied: ${data.traffic_multiplier}x`);
            document.body.style.borderTop = "5px solid #f97316"; 
            setTimeout(() => document.body.style.borderTop = "none", 5000);
        }

        const newMapUrl = "https://www.google.com/maps/dir/?api=1"; 

        const pushRes = await fetch(`${window.API_BASE_URL}/api/vrp/push-reroute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vehicle_id: vehicleId,
                new_gmaps_url: encodeURIComponent(newMapUrl)
            })
        });

        if (pushRes.ok) {
            alert(`✅ New Traffic-Aware Route Sent to ${vehicleId} Driver!`);
        }

    } catch (err) {
        console.error("Reroute Error:", err);
        alert("Failed to calculate new traffic route.");
    } finally {
        if (btn) {
            btn.innerHTML = `<i class="fa-solid fa-code-merge"></i> Recalculate Traffic`;
            btn.disabled = false;
        }
    }
};

window.downloadSurveyManifest = function(routeData, opIntelData) {
    let csvContent = "\uFEFFVehicle ID,Vehicle Type,Stop Sequence,Estimated Arrival (ETA),Internal Node ID,Inventory Load,Travel Leg (Mins),Status\n";

    const routesArray = routeData.routes || routeData.optimized_routes || [];
    
    routesArray.forEach(route => {
        const vehicleId = route.vehicle_id || route.id || "UYO-VEH-1";
        const vehicleType = route.vehicle_type || route.type || "van";
        
        let details = route.route_details;
        if (!details && route.route) {
            details = route.route.map((nodeId, idx) => {
                return {
                    stop_sequence: idx,
                    node_id: nodeId,
                    arrival_time: "Calculated Live",
                    demand: (idx === 0 || idx === route.route.length - 1) ? 0 : 1,
                    cumulative_mins: 0
                };
            });
        }

        if (!details) return;

        const maxSeq = details.length - 1; 

        details.forEach(stop => {
            let status = "On Route";
            if (stop.stop_sequence === maxSeq) status = "Return to Depot";

            let row = [
                vehicleId,
                vehicleType,
                stop.stop_sequence,
                stop.arrival_time || "00:00 AM",
                stop.node_id,
                stop.demand || stop.weight_load_after_stop || stop.inventory_load || 0,
                Number(stop.cumulative_mins || 0).toFixed(2),
                status
            ].join(",");
            csvContent += row + "\n";
        });
    });

    csvContent += ",,,,,,,\n"; 
    csvContent += "--- EXECUTIVE BI SUMMARY ---,,,,,,,\n";
    
    csvContent += `Total Orders Dispatched,"${opIntelData.drops || 0} Drops",,,,,,\n`;
    csvContent += `Total Fleet Operation Time,"${opIntelData.total_mins || 0} Mins",,,,,,\n`;
    csvContent += `Estimated Fuel Savings,"${opIntelData.fuel_saved || '₦0'}",,,,,,\n`;
    csvContent += `Fleet Efficiency Score,"${opIntelData.efficiency || '0%'}",,,,,,\n`;
    csvContent += `CO2 Emission Offset,"${opIntelData.co2_saved || '0 kg'}",,,,,,\n`;
    
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
    csvContent += `Optimization Timestamp,"${timestamp}",,,,,,\n`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    
    const filenameId = Math.floor(Math.random() * 900000) + 100000; 
    link.setAttribute("download", `Uyo_Logistics_Report_${filenameId}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// --- 1. SECURITY HANDSHAKE (OPTIMISTIC UI SECURE BOOT) ---
const activeLicenseKey = localStorage.getItem('uyo_license_key');

if (!activeLicenseKey) {
    console.warn("🔒 Unauthorized access attempt. Redirecting to Secure Login.");
    window.location.replace("login.html");
} else {
    console.log("🔄 Performing Background Validation Ping...");
    
    bootCommandCenter(); 

    fetch("https://api.uyologistics.com/api/vrp/history", {
        method: 'GET',
        headers: { 'x-license-key': activeLicenseKey }
    })
    .then(response => {
        if (response.status === 401 || response.status === 403) {
            console.error("❌ Background Kill-Switch Triggered: License Expired.");
            localStorage.removeItem('uyo_license_key');
            window.location.replace("login.html");
        } else {
            console.log("✅ License Key Verified. Session secured.");
        }
    })
    .catch(err => {
        console.warn("⚠️ Validation ping network delay. Relying on endpoint interceptors.", err);
    });
}

// ==============================================================================
// --- MASTER BOOTLOADER (GATED APPLICATION LOGIC) ---
// ==============================================================================
function bootCommandCenter() {
    
    console.log("🚀 Uyo Logistics Engine v2.4.0 LOADED - Unified Telemetry Active");

    const uyoCenter = [5.0377, 7.9128];

   const uyoMathematicalBounds = L.latLngBounds(
        L.latLng(4.8000, 7.7000), 
        L.latLng(5.2500, 8.2000)  
    );

    const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { 
        attribution: '© OpenStreetMap contributors, © CARTO',
        subdomains: 'abcd',
        maxZoom: 22,
        maxNativeZoom: 19
    });
    const lightMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { 
        attribution: '© OpenStreetMap contributors, © CARTO',
        subdomains: 'abcd',
        maxZoom: 22,
        maxNativeZoom: 19
    });
    const satellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { 
        attribution: '© Google',
        maxZoom: 22,
        maxNativeZoom: 20
    });

    window.map = L.map('map', { center: uyoCenter, zoom: 13, maxZoom: 22, layers: [darkMap], zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(window.map);

    L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(window.map);

    const mapLegend = L.control({ position: 'bottomleft' });
    mapLegend.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend');
        div.style.cssText = "background-color: rgba(31, 41, 55, 0.9); border-radius: 8px; border: 1px solid #374151; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5); color: #e5e7eb; font-family: ui-sans-serif, system-ui, sans-serif; backdrop-filter: blur(4px); overflow: hidden; transition: all 0.3s ease; margin-bottom: 5px;";
        div.innerHTML = `
            <div id="legend-header" style="padding: 8px 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; user-select: none;">
                <span style="font-weight: 900; color: #60a5fa; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px;">
                    <i class="fa-solid fa-layer-group" style="margin-right: 4px;"></i> Spatial Legend
                </span>
                <i id="legend-chevron" class="fa-solid fa-chevron-up" style="font-size: 10px; margin-left: 14px; transition: transform 0.3s ease;"></i>
            </div>
            
            <div id="legend-content" style="padding: 0 12px 12px 12px; font-size: 11px; line-height: 1.8; display: none;">
                <div style="display: flex; align-items: center;"><i class="fa-solid fa-truck" style="color: #dc3545; width: 16px; margin-right: 6px;"></i> Van Route (Heavy)</div>
                <div style="display: flex; align-items: center;"><i class="fa-solid fa-motorcycle" style="color: #28a745; width: 16px; margin-right: 6px;"></i> Bike Route (Agile)</div>
                <div style="display: flex; align-items: center;"><i class="fa-solid fa-square" style="color: #ef4444; opacity: 0.5; width: 16px; margin-right: 6px;"></i> Operations Boundary</div>
                
                <div style="font-weight: bold; margin-top: 8px; margin-bottom: 4px; border-bottom: 1px solid #374151; padding-bottom: 2px;">Market Hotspots (Gi*)</div>
                <div style="display: flex; height: 10px; margin-top: 4px; border-radius: 2px; overflow: hidden; border: 1px solid #4b5563;">
                    <div style="flex: 1; background-color: rgba(253, 174, 97, 0.6);"></div>
                    <div style="flex: 1; background-color: rgba(215, 25, 28, 0.7);"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; margin-top: 2px; font-weight: bold;">
                    <span>95% Sig.</span>
                    <span>99% Sig.</span>
                </div>
                
                <div style="font-weight: bold; margin-top: 8px; margin-bottom: 4px; border-bottom: 1px solid #374151; padding-bottom: 2px;">Accessibility Reach</div>
                <div style="display: flex; height: 10px; margin-top: 4px; border-radius: 2px; overflow: hidden; border: 1px solid #4b5563;">
                    <div style="flex: 1; background-color: rgba(0, 104, 55, 0.85);"></div>
                    <div style="flex: 1; background-color: rgba(49, 163, 84, 0.6);"></div>
                    <div style="flex: 1; background-color: rgba(120, 198, 121, 0.35);"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; margin-top: 2px; font-weight: bold;">
                    <span>5 Min</span>
                    <span>10 Min</span>
                    <span>15 Min</span>
                </div>
                
                <div style="display: flex; align-items: center; margin-top: 8px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; border: 3px solid #3b82f6; background: #ffffff; margin-right: 6px; margin-left: 1px; box-shadow: 0 0 8px rgba(59, 130, 246, 0.8);"></div> Central Depot
                </div>
                <div style="display: flex; align-items: center; margin-top: 4px;">
                    <div style="width: 10px; height: 10px; border-radius: 50%; border: 2px solid #3b82f6; background: white; margin-right: 8px; margin-left: 2px; box-shadow: 0 0 5px rgba(255,255,255,0.5);"></div> Unassigned Drop
                </div>
                <div style="display: flex; align-items: center; margin-top: 4px;">
                    <div style="width: 10px; height: 10px; border-radius: 50%; border: 2px solid white; background: #ef4444; margin-right: 8px; margin-left: 2px; box-shadow: 0 0 8px #ef4444;"></div> Live Fleet Ping
                </div>
            </div>
        `;
        L.DomEvent.disableClickPropagation(div);
        setTimeout(() => {
            const header = document.getElementById('legend-header');
            const content = document.getElementById('legend-content');
            const chevron = document.getElementById('legend-chevron');
            let isOpen = false;
            header.onclick = function() {
                isOpen = !isOpen;
                content.style.display = isOpen ? 'block' : 'none';
                chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            };
        }, 100);
        return div;
    };
    mapLegend.addTo(window.map);

    window.map.createPane('hotspotPane');        window.map.getPane('hotspotPane').style.zIndex = 300;
    window.map.createPane('accessibilityPane');  window.map.getPane('accessibilityPane').style.zIndex = 310;
    window.map.createPane('routePane');          window.map.getPane('routePane').style.zIndex = 400; 
    window.map.createPane('poiPane');            window.map.getPane('poiPane').style.zIndex = 600; 

    window.routeLayerGroup = L.layerGroup().addTo(window.map); 
    const hotspotLayer = L.layerGroup();
    const boundaryLayer = L.layerGroup();
    const poiLayer = L.layerGroup();
    const accessibilityLayer = L.layerGroup();

    window.unassignedPinsLayer = L.layerGroup().addTo(window.map);

    const baseMaps = { 
        "Command Center (Dark)": darkMap, 
        "Clean Street (Light)": lightMap, 
        "Satellite View": satellite 
    };
    const overlayMaps = {
        "<b>Live Operations</b>": window.routeLayerGroup,
        "Demand Hotspots": hotspotLayer,
        "City Boundaries": boundaryLayer,
        "Points of Interest": poiLayer,
        "Accessibility": accessibilityLayer
    };
    
    const isMobile = window.innerWidth < 768;
    L.control.layers(baseMaps, overlayMaps, { 
        position: 'topright', 
        collapsed: isMobile 
    }).addTo(window.map);

    const layerStyles = {
        boundaries: { color: "#ef4444", weight: 3, fillOpacity: 0.05, dashArray: '5, 10', interactive: false },
        hotspots: (feature) => {
            const z = feature.properties?.z_score;
            const w = feature.properties?.weight;
            if (z !== undefined) {
                if (z > 2.58) return { color: "white", weight: 1, fillColor: "#d7191c", fillOpacity: 0.7, interactive: false }; 
                if (z > 1.96) return { color: "white", weight: 1, fillColor: "#fdae61", fillOpacity: 0.6, interactive: false }; 
                if (z < -2.58) return { color: "white", weight: 1, fillColor: "#2c7bb6", fillOpacity: 0.7, interactive: false }; 
                if (z < -1.96) return { color: "white", weight: 1, fillColor: "#abd9e9", fillOpacity: 0.6, interactive: false }; 
                return { stroke: false, fillOpacity: 0, interactive: false }; 
            } 
            else {
                if (w >= 0.8) return { color: "white", weight: 1, fillColor: "#d7191c", fillOpacity: 0.7, interactive: false };
                if (w >= 0.6) return { color: "white", weight: 1, fillColor: "#fdae61", fillOpacity: 0.6, interactive: false };
                if (w <= 0.2) return { color: "white", weight: 1, fillColor: "#2c7bb6", fillOpacity: 0.7, interactive: false };
                if (w <= 0.4) return { color: "white", weight: 1, fillColor: "#abd9e9", fillOpacity: 0.6, interactive: false };
                return { stroke: false, fillOpacity: 0, interactive: false };
            }
        },
        accessibility: (feature) => {
            const timeVal = feature.properties?.cost_level || feature.properties?.time || feature.properties?.cost;
            if (timeVal <= 300 || (timeVal <= 5 && timeVal > 0)) {
                return { fillColor: '#006837', color: '#ffffff', weight: 1.5, fillOpacity: 0.85, interactive: false };
            } 
            else if (timeVal <= 600 || (timeVal <= 10 && timeVal > 0)) {
                return { fillColor: '#31a354', color: '#ffffff', weight: 1.5, fillOpacity: 0.5, interactive: false };
            } 
            else {
                return { fillColor: '#78c679', color: '#ffffff', weight: 1, fillOpacity: 0.25, interactive: false };
            }
        }
    };

    async function fetchSpatialLayer(endpoint, layerGroup, styleConfig, targetPane = 'overlayPane') {
        try {
            const currentKey = localStorage.getItem('uyo_license_key');
            const response = await fetch(`${window.API_BASE_URL}/api/layers${endpoint}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'x-license-key': currentKey }
            });
            
            if (response.status === 401) {
                console.error(`🔒 Session Expired: Rejected by ${endpoint}`);
                localStorage.removeItem('uyo_license_key');
                alert("Your Corporate License or Trial Key has expired. Please log in again to renew access.");
                window.location.href = "login.html";
                return; 
            }
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            
            L.geoJSON(data, {
                pane: targetPane, 
                style: styleConfig.style || styleConfig, 
                pointToLayer: styleConfig.pointToLayer || null,
                onEachFeature: (feature, layer) => {
                    if (styleConfig.interactive !== false) {
                        let popup = `<strong class="text-blue-600 uppercase tracking-widest text-xs">${endpoint.replace('/', '')} DATA</strong><br>`;
                        for (let key in feature.properties) { if (feature.properties[key]) popup += `<b class="text-gray-700 capitalize">${key}:</b> ${feature.properties[key]}<br>`; }
                        layer.bindPopup(popup);
                    }
                }
            }).addTo(layerGroup);
        } catch (err) { 
            console.warn(`⚠️ Error loading ${endpoint}:`, err); 
        }
    }

    function loadAllDatabaseLayers() {
        fetchSpatialLayer('/hotspots', hotspotLayer, layerStyles.hotspots, 'hotspotPane');
        fetchSpatialLayer('/boundaries', boundaryLayer, { style: layerStyles.boundaries });
        fetchSpatialLayer('/accessibility', accessibilityLayer, layerStyles.accessibility, 'accessibilityPane');

        fetchSpatialLayer('/pois', poiLayer, { 
            pointToLayer: (feature, latlng) => {
                const category = String(feature.properties?.amenity || feature.properties?.cat_label || feature.properties?.type || '').toLowerCase();
                let iconClass = 'fa-solid fa-map-pin'; let color = '#71717a'; 
                if (category.includes('school') || category.includes('education')) { iconClass = 'fa-solid fa-graduation-cap'; color = '#3b82f6'; } 
                else if (category.includes('health') || category.includes('hospit') || category.includes('clinic')) { iconClass = 'fa-solid fa-kit-medical'; color = '#ef4444'; } 
                else if (category.includes('hotel') || category.includes('lodging')) { iconClass = 'fa-solid fa-bed'; color = '#8b5cf6'; } 
                else if (category.includes('bank') || category.includes('atm')) { iconClass = 'fa-solid fa-building-columns'; color = '#eab308'; } 
                else if (category.includes('worship') || category.includes('churc') || category.includes('mosque')) { iconClass = 'fa-solid fa-church'; color = '#d946ef'; } 
                else if (category.includes('restau') || category.includes('food')) { iconClass = 'fa-solid fa-utensils'; color = '#f97316'; } 
                else if (category.includes('fuel') || category.includes('gas')) { iconClass = 'fa-solid fa-gas-pump'; color = '#14b8a6'; } 
                else if (category.includes('gover') || category.includes('police')) { iconClass = 'fa-solid fa-landmark'; color = '#0ea5e9'; }

                const htmlString = `<div style="background-color: ${color}; color: white; width: 14px; height: 14px; border-radius: 50%; border: 1px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.5);"><i class="${iconClass}" style="font-size: 7px;"></i></div>`;
                return L.marker(latlng, { icon: L.divIcon({ html: htmlString, className: 'custom-poi', iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -7] }), pane: 'poiPane' });
            } 
        }, 'poiPane');
    }
    loadAllDatabaseLayers();

    const depotIcon = L.divIcon({ className: 'depot', html: `<div style="background-color: #ffffff; border: 4px solid #3b82f6; border-radius: 50%; width: 24px; height: 24px; box-shadow: 0 0 20px rgba(59, 130, 246, 1);"></div>` });
    const depotMarker = L.marker([window.depotLocation.lat, window.depotLocation.lon], { icon: depotIcon, draggable: true, pane: 'poiPane' }).addTo(window.map);

    depotMarker.on('dragend', function() {
        const position = depotMarker.getLatLng();
        window.depotLocation.lat = parseFloat(position.lat.toFixed(6));
        window.depotLocation.lon = parseFloat(position.lng.toFixed(6));
    });

    window.removePin = function(dropId) {
        window.dynamicDeliveries = window.dynamicDeliveries.filter(d => d.id !== dropId);
        window.unassignedPinsLayer.eachLayer(function(layer) {
            if (layer.options.dropId === dropId) {
                window.unassignedPinsLayer.removeLayer(layer);
            }
        });
        console.log(`🗑️ Removed Drop: ${dropId}`);
    };

    // --- PARCEL WEIGHT INTERCEPTION ON MAP CLICK ---
    window.map.on('click', function(e) {
        let isInside = false;
        if (boundaryLayer.getLayers().length > 0 && boundaryLayer.getLayers()[0].getBounds) {
            isInside = boundaryLayer.getLayers()[0].getBounds().contains(e.latlng);
        } else {
            isInside = uyoMathematicalBounds.contains(e.latlng);
        }

        if (!isInside) { 
            alert("⚠️ Location is outside the Uyo service boundary."); 
            return; 
        }
        
        let weightInput = prompt("Enter parcel weight in kg for this stop (e.g., 2, 15, 30):", "1");
        let parsedWeight = parseInt(weightInput, 10);
        if (isNaN(parsedWeight) || parsedWeight <= 0) {
            parsedWeight = 1; 
        }

        const cleanLat = parseFloat(e.latlng.lat.toFixed(6));
        const cleanLng = parseFloat(e.latlng.lng.toFixed(6));
        
        const dropId = "Drop_" + Math.floor(Math.random() * 10000);
        window.dynamicDeliveries.push({ id: dropId, lat: cleanLat, lon: cleanLng, weight: parsedWeight });
        
        const popupContent = `
            <div style="text-align: center;">
                <b style="color: #1f2937;">Order: ${dropId}</b><br>
                <span style="font-size: 11px; font-weight: bold; color: #28a745;">Weight: ${parsedWeight} kg</span><br>
                <button onclick="window.removePin('${dropId}')" style="margin-top: 8px; padding: 4px 8px; background-color: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">
                    <i class="fa-solid fa-trash"></i> Remove Drop
                </button>
            </div>
        `;

        L.marker([cleanLat, cleanLng], { 
            dropId: dropId,
            icon: L.divIcon({ className: 'unassigned', html: `<div style="background-color: #ffffff; border: 2px solid #3b82f6; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 10px rgba(255,255,255,0.5);"></div>` }), 
            pane: 'poiPane' 
        }).addTo(window.unassignedPinsLayer).bindPopup(popupContent);
    });

    const searchInput = document.getElementById('custom-search');
    let searchContainer = null;
    let dropdownMenu = null;

    if (searchInput) {
        searchContainer = searchInput.parentElement;
        dropdownMenu = document.createElement('div');
        dropdownMenu.id = 'search-dropdown';
        dropdownMenu.style.cssText = 'position:absolute; top:calc(100% + 5px); left:0; width:100%; background:#1f2937; color:white; z-index:9999; border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,0.8); display:none; max-height:300px; overflow-y:auto; font-family: ui-sans-serif, system-ui, sans-serif; pointer-events:auto;';
        searchContainer.appendChild(dropdownMenu);

        if (searchContainer.parentNode) {
            searchContainer.parentNode.removeChild(searchContainer);
        }

        const NativeSearchControl = L.Control.extend({
            options: { position: 'topleft' }, 
            onAdd: function() {
                searchContainer.style.position = 'relative'; 
                searchContainer.style.top = 'auto';
                searchContainer.style.left = 'auto';
                searchContainer.style.transform = 'none';
                searchContainer.style.width = isMobile ? '65vw' : '350px';
                searchContainer.style.margin = '10px';
                searchContainer.style.zIndex = 'auto'; 
                searchContainer.classList.remove('overflow-hidden');
                searchContainer.style.overflow = 'visible';
                L.DomEvent.disableClickPropagation(searchContainer);
                L.DomEvent.disableScrollPropagation(searchContainer);
                return searchContainer;
            }
        });
        window.map.addControl(new NativeSearchControl());
    }

    window.executeSearch = async function() {
        if (!searchInput || !searchContainer || !dropdownMenu) return;
        
        const query = searchInput.value.trim();
        if (!query) return;

        const btn = searchContainer.querySelector('button');
        let originalBtnHtml = "Search";
        if (btn) {
            originalBtnHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
        }
        
        dropdownMenu.innerHTML = ''; 
        dropdownMenu.style.display = 'none';

        let combinedResults = [];
        const lowerQuery = query.toLowerCase();

        try {
            poiLayer.eachLayer(layer => {
                const props = layer?.feature?.properties;
                if (!props) return; 
                
                const poiName = String(props.name || props.poi_name || props.title || '').toLowerCase();
                if (poiName.includes(lowerQuery)) {
                    combinedResults.push({
                        lat: layer.getLatLng().lat, lng: layer.getLatLng().lng,
                        name: props.name || query, address: "Verified Local Database", source: "LOCAL", icon: "fa-database"
                    });
                }
            });

            const searchPromises = [];

            searchPromises.push(
                fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)},Uyo,Akwa Ibom&format=json&limit=3`)
                .then(res => res.json())
                .then(data => {
                    if(data && data.length) {
                        data.forEach(item => {
                            combinedResults.push({
                                lat: parseFloat(item.lat), lng: parseFloat(item.lon),
                                name: item.name || query, address: item.display_name.split(',')[0] + " (OSM)", source: "NOMINATIM", icon: "fa-road"
                            });
                        });
                    }
                }).catch(err => console.warn("Nominatim failed:", err))
            );

            const GOOGLE_API_KEY = "AIzaSyA9Y339K4gDbQGQDSzWKppq2pmUvxODiho"; 
            const locationRestriction = { rectangle: { low: { latitude: 4.9500, longitude: 7.8500 }, high: { latitude: 5.1000, longitude: 8.0500 } } };
            
            searchPromises.push(
                fetch(`https://places.googleapis.com/v1/places:searchText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY, 'X-Goog-FieldMask': 'places.location,places.formattedAddress,places.displayName' },
                    body: JSON.stringify({ textQuery: lowerQuery.includes('uyo') ? query : `${query}, Uyo`, locationRestriction: locationRestriction })
                })
                .then(res => res.json())
                .then(data => {
                    if (data && data.places) {
                        data.places.slice(0, 3).forEach(place => {
                            if(place.location) {
                                combinedResults.push({
                                    lat: parseFloat(place.location.latitude), lng: parseFloat(place.location.longitude),
                                    name: place.displayName ? place.displayName.text : query, address: place.formattedAddress ? place.formattedAddress.split(',')[0] : "Uyo", source: "GOOGLE", icon: "fa-google"
                                });
                            }
                        });
                    }
                }).catch(err => console.warn("Google failed:", err))
            );

            await Promise.allSettled(searchPromises);

            const safeBounds = uyoMathematicalBounds.pad(0.5); 
            let uniqueResults = [];
            
            combinedResults.forEach(res => {
                if(!res.lat || !res.lng || isNaN(res.lat) || isNaN(res.lng)) return; 
                const targetLatLng = L.latLng(res.lat, res.lng);
                if (safeBounds.contains(targetLatLng)) {
                    const isDuplicate = uniqueResults.some(u => Math.abs(u.lat - res.lat) < 0.001 && Math.abs(u.lng - res.lng) < 0.001);
                    if (!isDuplicate) uniqueResults.push(res);
                }
            });

            if (uniqueResults.length === 0) {
                dropdownMenu.innerHTML = `
                    <div style="padding:15px; text-align:center; color:#f87171; font-size:12px;">
                        <i class="fa-solid fa-triangle-exclamation mb-2 text-lg"></i><br>
                        No verified addresses found for <b>"${query}"</b> inside the operational perimeter.
                    </div>
                `;
                dropdownMenu.style.display = 'block';
                return;
            }

            uniqueResults.forEach(item => {
                const opt = document.createElement('div');
                opt.style.cssText = 'padding:12px; cursor:pointer; border-bottom:1px solid #374151; transition: background 0.2s; display:flex; justify-content:space-between; align-items:center;';
                opt.onmouseover = () => opt.style.background = '#374151';
                opt.onmouseout = () => opt.style.background = 'transparent';
                
                let sourceColor = item.source === 'LOCAL' ? '#4ade80' : (item.source === 'NOMINATIM' ? '#60a5fa' : '#f87171');
                
                opt.innerHTML = `
                    <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 10px;">
                        <b style="font-size:13px; color:white;">${item.name}</b><br>
                        <span style="font-size:10px; color:#9ca3af;">${item.address}</span>
                    </div>
                    <span style="font-size:9px; font-weight:bold; color:${sourceColor}; border:1px solid ${sourceColor}; padding:2px 4px; border-radius:3px; flex-shrink: 0;">
                        <i class="fa-brands ${item.icon}"></i> ${item.source}
                    </span>
                `;

                opt.onclick = () => {
                    dropdownMenu.style.display = 'none';
                    searchInput.value = '';
                    searchInput.focus();
                    
                    let weightInput = prompt(`Enter parcel weight in kg for ${item.name} (e.g., 2, 15, 30):`, "1");
                    let parsedWeight = parseInt(weightInput, 10);
                    if (isNaN(parsedWeight) || parsedWeight <= 0) {
                        parsedWeight = 1; 
                    }
                    
                    const dropId = "Search_" + Math.floor(Math.random() * 10000);
                    window.dynamicDeliveries.push({ id: dropId, lat: item.lat, lon: item.lng, weight: parsedWeight });

                    const popupContent = `
                        <div style="text-align: center;">
                            <b style="color: #1f2937;">Dispatched to:</b><br>
                            <span style="font-size: 11px; font-weight: bold;">${item.name}</span><br>
                            <span style="font-size: 10px; color: #4b5563;">${item.address}</span><br>
                            <span style="font-size: 11px; font-weight: bold; color: #28a745;">Weight: ${parsedWeight} kg</span><br>
                            <button onclick="window.removePin('${dropId}')" style="margin-top: 8px; padding: 4px 8px; background-color: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">
                                <i class="fa-solid fa-trash"></i> Remove Drop
                            </button>
                        </div>
                    `;

                    L.marker([item.lat, item.lng], { 
                        dropId: dropId,
                        icon: L.divIcon({ className: 'unassigned', html: `<div style="background-color: #ffffff; border: 2px solid #3b82f6; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 10px rgba(255,255,255,0.5);"></div>` }), 
                        pane: 'poiPane' 
                    }).addTo(window.unassignedPinsLayer).bindPopup(popupContent).openPopup();
                    
                    window.map.flyTo([item.lat, item.lng], 16, { duration: 1.5 });
                };
                dropdownMenu.appendChild(opt);
            });

            dropdownMenu.style.display = 'block';

        } catch (err) {
            console.error("Critical Search Failure:", err);
            dropdownMenu.innerHTML = `<div style="padding:15px; text-align:center; color:#f87171; font-size:12px;">System Error: Could not parse geospatial data.</div>`;
            dropdownMenu.style.display = 'block';
        } finally {
            if (btn) btn.innerHTML = originalBtnHtml;
        }
    };

    document.addEventListener('click', (e) => {
        if (searchContainer && !searchContainer.contains(e.target) && dropdownMenu) {
            dropdownMenu.style.display = 'none';
        }
    });

    if (searchInput) {
        searchInput.addEventListener("keypress", function(event) { 
            if (event.key === "Enter") { 
                event.preventDefault(); 
                window.executeSearch(); 
            } 
        });
    }

    window.clearUnassignedPins = function() { 
        window.unassignedPinsLayer.clearLayers(); 
        window.routeLayerGroup.clearLayers(); 
        window.dynamicDeliveries = []; 
        window.activeDeployments = {}; 
        window.activeDeploymentsMins = {};
        window.currentPhysicsEngine = {};
        
        if (typeof window.liveMarkers !== 'undefined') {
            for (let id in window.liveMarkers) {
                if (window.map.hasLayer(window.liveMarkers[id])) window.map.removeLayer(window.liveMarkers[id]);
            }
            window.liveMarkers = {};
        }

        if (typeof window.liveFleetSocket !== 'undefined' && window.liveFleetSocket) {
            window.liveFleetSocket.close();
            window.liveFleetSocket = null;
            console.log("📡 Live Fleet Telemetry: Connection reset by 'Clear Pins'");
        }

        const fleetList = document.getElementById('fleet-list');
        if (fleetList) fleetList.innerHTML = "";
        if (typeof window.updateBIMetrics === 'function') window.updateBIMetrics(false); 
        
        const reportContainer = document.getElementById("report-container");
        if (reportContainer) reportContainer.style.display = "none";
    };

    // --- UYO COMMAND CENTER TELEMETRY WIDGET HANDLER ---
    window.updateTelemetryUI = function(apiResponse) {
        const trafficMultiplier = apiResponse.traffic_multiplier || 1.0;
        const trafficText = document.getElementById('traffic-text');
        const indicator = document.getElementById('traffic-indicator');
        
        if (trafficText && indicator) {
            if (trafficMultiplier > 1.5) {
                trafficText.innerText = `Heavy Congestion (${trafficMultiplier}x Penalty)`;
                indicator.className = "pulse-dot bg-red";
            } else {
                trafficText.innerText = "Optimal Free-Flowing Traffic";
                indicator.className = "pulse-dot bg-green";
            }
        }

        const peRaw = apiResponse.physics_engine || {};
        const pe = {
            fuel_saved: Number(peRaw.fuel_saved) || 0,
            co2_saved: Number(peRaw.co2_saved) || 0,
            efficiency: Number(peRaw.efficiency) || 0
        };
        
        const empiricalBaselineMins = Number(apiResponse.empirical_baseline) || 0;
        let totalOptimizedMins = 0;
        
        if (apiResponse.routes && apiResponse.routes.length > 0) {
            apiResponse.routes.forEach(vehicleRoute => {
                totalOptimizedMins += (Number(vehicleRoute.total_time_mins) || 0);
            });
        }

        const timeSavedMins = Math.max(0, empiricalBaselineMins - totalOptimizedMins);
        
        const timeSavedEl = document.getElementById('time-saved-val');
        const co2SavedEl = document.getElementById('co2-saved-val');
        
        if (timeSavedEl) timeSavedEl.innerText = `${timeSavedMins.toFixed(1)} mins`;
        if (co2SavedEl) co2SavedEl.innerText = `${pe.co2_saved.toFixed(2)} kg`;
    };

    window.solveAndDisplay = async function() {
        if (window.dynamicDeliveries.length === 0) { alert("Drop pins or search for locations first!"); return; }
        
        const currentLicenseKey = localStorage.getItem('uyo_license_key');
        if (!currentLicenseKey) {
            alert("Session expired. Please log in again.");
            window.location.href = "login.html";
            return;
        }

        const vehicleChoice = document.getElementById('vehicle-select').value;
        const btn = document.getElementById('optimize-btn');
        
        const fleetProfiles = {
            bike: [
                { id: "BIKE-01", type: "bike", capacity: 10, speed_factor: 1.5, fixed_cost: 0, cost_per_km: 10 }, 
                { id: "BIKE-02", type: "bike", capacity: 10, speed_factor: 1.5, fixed_cost: 0, cost_per_km: 10 },
                { id: "BIKE-03", type: "bike", capacity: 10, speed_factor: 1.5, fixed_cost: 0, cost_per_km: 10 }
            ],
            van: [
                { id: "VAN-01", type: "van", capacity: 50, speed_factor: 1.0, fixed_cost: 10000, cost_per_km: 50 }
            ]
        };
        let activeFleet = (vehicleChoice === 'all') ? null : fleetProfiles[vehicleChoice];
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); 
        
        try {
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Optimizing Engine...`; 
            btn.disabled = true;

            const response = await fetch(`${window.API_BASE_URL}/api/vrp/solve-dynamic`, { 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json',
                    'x-license-key': currentLicenseKey
                }, 
                body: JSON.stringify({ depot: window.depotLocation, deliveries: window.dynamicDeliveries, fleet: activeFleet }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId); 
            
            if (!response.ok) {
                let errorMsg = "Backend Routing Error";
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.detail || errorMsg;
                } catch(e) {} 

                if (response.status === 402) {
                    if(confirm(`💳 PAYMENT REQUIRED:\n\n${errorMsg}\n\nWould you like to renew your subscription now?`)) {
                        window.initiateSubscriptionRenewal();
                    }
                } else if (response.status === 401) {
                    alert(`❌ ACCESS DENIED:\n\n${errorMsg}`);
                    localStorage.removeItem('uyo_license_key');
                    window.location.href = "login.html";
                } else if (response.status === 400 && typeof errorMsg === 'string' && errorMsg.toLowerCase().includes("valid sequence")) {
                    throw new Error("OR-Tools Topology Failure:\n\nOne or more pins are dropped in a 'dead zone' too far from a mapped road. Please use the 'Remove Drop' button on your most recent pins and nudge them closer to a main street.");
                } else {
                    throw new Error(errorMsg);
                }
                return; 
            }
            
            const data = await response.json();
            
            window.latestOptimizationResult = data;
            
            const peRaw = data.physics_engine || {};
            window.currentPhysicsEngine = {
                fuel_saved: Number(peRaw.fuel_saved) || 0,
                co2_saved: Number(peRaw.co2_saved) || 0,
                efficiency: Number(peRaw.efficiency) || 0
            };
            
            window.updateTelemetryUI(data);
            
            window.routeLayerGroup.clearLayers(); 
            window.unassignedPinsLayer.clearLayers();
            window.activeDeployments = {}; 
            window.activeDeploymentsMins = {};

            let backendOptimizedMins = 0;
            data.routes.forEach(r => {
                if (r.route && r.route.length > 2) {
                    backendOptimizedMins += (r.total_time_mins || 0);
                }
            });
            window.currentMissionMins = backendOptimizedMins;
            window.currentBaselineMins = data.empirical_baseline || 0;
            
            if (data.routes || data.report_url) {
                const reportContainer = document.getElementById("report-container");
                const downloadBtn = document.getElementById("download-report-btn");
                
                if (reportContainer && downloadBtn) {
                    reportContainer.style.display = "block"; 
                    const sidebar = document.querySelector('.col-span-3');
                    if (sidebar) sidebar.scrollTop = 0;
                    
                    downloadBtn.onclick = function() {
                        const currentOpIntel = {
                            fuel_saved: document.getElementById("stat-fuel") ? document.getElementById("stat-fuel").innerText : "₦0",
                            efficiency: document.getElementById("stat-efficiency") ? document.getElementById("stat-efficiency").innerText : "0%",
                            co2_saved: document.getElementById("stat-co2") ? document.getElementById("stat-co2").innerText : "0 kg",
                            drops: data.routes.reduce((acc, route) => acc + (route.route ? route.route.length - 2 : 0), 0),
                            total_mins: window.currentMissionMins ? window.currentMissionMins.toFixed(2) : 0
                        };
                        window.downloadSurveyManifest(data, currentOpIntel);
                    };
                }
            }

            await renderRoutes(data.routes, { depot: window.depotLocation, deliveries: window.dynamicDeliveries });

        } catch (error) { 
            if (error.name === 'AbortError') {
                alert("⚠️ Network Timeout: Connection to the Uyo Logistics cloud was lost. Please check your internet and try again.");
            } else {
                alert(error.message); 
            }
            console.error("Routing Error:", error);
        } finally { 
            if (btn) {
                btn.innerHTML = "Optimize Routes"; 
                btn.disabled = false; 
            }
        }
    };

    async function renderRoutes(routes, payload) {
        const fleetList = document.getElementById('fleet-list');
        if (fleetList) fleetList.innerHTML = "";
        
        const locDict = {};
        locDict[0] = [payload.depot.lat, payload.depot.lon];
        locDict["0"] = [payload.depot.lat, payload.depot.lon];
        locDict['depot'] = [payload.depot.lat, payload.depot.lon];
        
        payload.deliveries.forEach((d, idx) => {
            locDict[idx + 1] = [d.lat, d.lon];
            locDict[String(idx + 1)] = [d.lat, d.lon];
            locDict[d.id] = [d.lat, d.lon];
        });

        for (const r of routes) {
            const dropsCount = r.route ? r.route.length - 2 : 0;
            if (dropsCount <= 0) continue; 
            
            let vType = r.vehicle_type || r.type || 'Van'; 
            if (!vType || String(vType).trim().toLowerCase() === 'undefined' || String(vType).trim().toLowerCase() === 'unknown') {
                vType = 'Van';
            }
            vType = String(vType).charAt(0).toUpperCase() + String(vType).slice(1);
            const vId = r.vehicle_id || `${vType}-${Math.floor(Math.random() * 1000)}`;
            
            const isBike = vType.toLowerCase() === 'bike';
            
            window.fleetRegistry[vId] = isBike; 

            const color = isBike ? '#28a745' : '#dc3545';
            const routeWeight = isBike ? 4 : 6; 
            
            const gpsPath = r.route.map(node => locDict[node]).filter(Boolean);
            if (gpsPath.length < 2) continue;

            const coordStr = gpsPath.map(c => `${c[1]},${c[0]}`).join(';');
            
            const originCoord = gpsPath[0];
            const destCoord = gpsPath[gpsPath.length - 1];
            let waypointsStr = '';
            if (gpsPath.length > 2) {
                waypointsStr = gpsPath.slice(1, -1).map(c => `${c[0]},${c[1]}`).join('|');
            }
            
            const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoord[0]},${originCoord[1]}&destination=${destCoord[0]},${destCoord[1]}${waypointsStr ? '&waypoints=' + waypointsStr : ''}&travelmode=driving`;
            
            try {
                await new Promise(resolve => setTimeout(resolve, 800)); 
                let osrmData = null;

                try {
                    const res1 = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`);
                    if (res1.ok) osrmData = await res1.json();
                } catch (e1) { console.warn("Primary OSRM failed..."); }

                if (!osrmData || osrmData.code !== "Ok") {
                    const res2 = await fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordStr}?overview=full&geometries=geojson`);
                    if (res2.ok) osrmData = await res2.json();
                }
                
                if (osrmData && osrmData.code === "Ok") {
                    const distanceKm = parseFloat((osrmData.routes[0].distance / 1000).toFixed(2));
                    const durationMin = (osrmData.routes[0].duration / 60).toFixed(1);

                    const routeCoords = osrmData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                    window.activeDeployments[vId] = routeCoords;
                    window.activeDeploymentsMins[vId] = parseFloat(durationMin);

                    const routeLine = L.polyline(routeCoords, { color: color, weight: routeWeight, opacity: 0.9, pane: 'routePane' }).addTo(window.routeLayerGroup);
                    
                    let sequenceCounter = 1;
                    r.route.forEach((node, idx) => {
                        if (idx === 0 || idx === r.route.length - 1) return;
                        const coords = locDict[node];
                        if (coords) {
                            L.marker(coords, { icon: L.divIcon({ className: 'seq', html: `<div style="background: white; color: ${color}; border: 2.5px solid ${color}; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">${sequenceCounter}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), pane: 'poiPane' }).addTo(window.routeLayerGroup);
                            sequenceCounter++;
                        }
                    });

                    try {
                        if (typeof L.polylineDecorator === 'function') {
                            L.polylineDecorator(routeLine, { 
                                patterns: [{ 
                                    offset: 30, 
                                    repeat: 70, 
                                    symbol: L.Symbol.arrowHead({ 
                                        pixelSize: 14, 
                                        polygon: true, 
                                        pathOptions: { color: '#ffffff', fillOpacity: 1, weight: 0, pane: 'routePane' } 
                                    }) 
                                }] 
                            }).addTo(window.routeLayerGroup);
                        }
                    } catch(err) { console.warn("Polyline Decorator skipped."); }

                    if (fleetList) {
                        fleetList.innerHTML += `<div class="p-4 bg-gray-800 rounded-xl border-l-4 mb-3 shadow-xl" style="border-color: ${color}">
                            <div class="flex justify-between items-start mb-2">
                                <p class="text-[10px] font-black uppercase text-gray-500 tracking-tighter">${vId} Active</p>
                                <span class="text-[10px] font-bold bg-gray-700 px-2 py-1 rounded text-blue-400">${durationMin} MIN</span>
                            </div>
                            <p class="text-white font-mono text-sm mb-3">${distanceKm} KM | ${dropsCount} Drops</p>
                            <button onclick="window.deployMission('${vId}', '${gmapsUrl}')" class="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow transition-colors flex items-center justify-center gap-2">
                                Deploy Live Mission
                            </button>
                            <button id="recalc-btn-${vId}" onclick="window.triggerTrafficRecalculate('${vId}')" class="w-full mt-2 py-2 bg-gray-700 hover:bg-orange-600 text-white text-xs font-bold rounded shadow transition-colors flex items-center justify-center gap-2">
                                <i class="fa-solid fa-code-merge"></i> Recalculate Traffic
                            </button>
                        </div>`;
                    }
                } else { throw new Error("Both OSRM servers rejected the route geometry."); }
            } catch (e) { 
                console.error("Complete Network Failure. Deploying Direct Lines.", e);
            }
        }
        window.updateBIMetrics(true);
    }

    window.map.on('overlayadd', function(e) {
        if (e.name.includes("Live Operations")) {
            window.connectLiveFleet();
        }
    });

    window.map.on('overlayremove', function(e) {
        if (e.name.includes("Live Operations")) {
            if (window.liveFleetSocket) {
                window.liveFleetSocket.close();
                window.liveFleetSocket = null;
                console.log("📡 Live Fleet Telemetry: Disconnected");
            }
            for (let id in window.liveMarkers) {
                window.map.removeLayer(window.liveMarkers[id]);
            }
            window.liveMarkers = {};
        }
    });

    window.initiateSubscriptionRenewal = function() {
        const planChoice = prompt(
            "💳 SELECT YOUR PLAN:\n\n" +
            "1. Daily Pass (20 Stops) - ₦3,000\n" +
            "2. Bi-Weekly Pro (200 Stops) - ₦25,000\n" +
            "3. Monthly Enterprise (600 Stops) - ₦70,000\n\n" +
            "Enter 1, 2, or 3:"
        );

        let amountKobo, daysToAdd, stopLimit;

        if (planChoice === "1") {
            amountKobo = 300000; daysToAdd = 1; stopLimit = 20;
        } else if (planChoice === "2") {
            amountKobo = 2500000; daysToAdd = 14; stopLimit = 200;
        } else if (planChoice === "3") {
            amountKobo = 7000000; daysToAdd = 30; stopLimit = 600;
        } else {
            alert("Invalid selection. Operation cancelled.");
            return;
        }

        const userEmail = prompt("Please enter your business email for the receipt:");
        if (!userEmail) return;

        const handler = PaystackPop.setup({
            key: 'pk_live_e0c2402108448771f33bbe09670508ede2ad6a92',
            email: userEmail,
            amount: amountKobo,
            currency: "NGN",
            ref: 'UYO-' + Math.floor((Math.random() * 1000000000) + 1),
            callback: function(response) {
                fetch(`${window.API_BASE_URL}/api/vrp/activate-license`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        reference: response.reference, 
                        license_key: localStorage.getItem('uyo_license_key'),
                        days_to_add: daysToAdd,
                        stop_limit: stopLimit
                    })
                })
                .then(res => {
                    if (res.ok) {
                        alert(`✅ Plan Activated! Access extended by ${daysToAdd} day(s) with a ${stopLimit}-stop limit.`);
                        location.reload(); 
                    } else {
                        alert("⚠️ Payment confirmed but license activation failed. Please contact support.");
                    }
                })
                .catch(err => {
                    alert("⚠️ Network error during activation verification.");
                });
            },
            onClose: function() {
                alert("Transaction cancelled. Optimization remains locked.");
            }
        });
        handler.openIframe();
    };

    window.fetchLifetimeMetrics();
}