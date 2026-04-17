// ==============================================================================
// UYO LOGISTICS INTELLIGENCE | MASTER COMMAND CENTER
// 100% Survey-Grade Configuration (Panes, OSRM, BI, Simulation, Search & Symbology)
// ==============================================================================

// --- 0. SECURITY HANDSHAKE ---
const activeLicenseKey = localStorage.getItem('uyo_license_key');
if (!activeLicenseKey) {
    console.warn("🔒 Unauthorized access attempt. Redirecting to Secure Login.");
    window.location.href = "login.html";
} else {
    console.log("✅ License Key Verified. Initializing Command Center...");
}

// --- DYNAMIC INFRASTRUCTURE CONFIG (CLOUD-READY) ---
// TARGET LOCK: Hardcoded to point directly to the live Render Backend API
const API_BASE_URL = "https://uyo-routing-engine.onrender.com";
const WS_BASE_URL = "wss://uyo-routing-engine.onrender.com";

console.log("🚀 Uyo Logistics Engine v2.0 LOADED - Cloud-Ready & Cache Cleared");

// --- 1. SETTINGS & BASE LAYERS ---
const uyoCenter = [5.0377, 7.9128];

const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { 
    attribution: '© OpenStreetMap contributors, © CARTO',
    subdomains: 'abcd',
    maxZoom: 20
});
const lightMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { 
    attribution: '© OpenStreetMap contributors, © CARTO',
    subdomains: 'abcd',
    maxZoom: 20
});
const satellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { 
    attribution: '© Google' 
});

// --- 2. INITIALIZE MAP ---
const map = L.map('map', { center: uyoCenter, zoom: 13, layers: [darkMap], zoomControl: false });
L.control.zoom({ position: 'bottomright' }).addTo(map);

// --- 3. PROFESSIONAL GIS PANES ---
map.createPane('accessibilityPane'); map.getPane('accessibilityPane').style.zIndex = 300;
map.createPane('hotspotPane');       map.getPane('hotspotPane').style.zIndex = 310;
map.createPane('routePane');         map.getPane('routePane').style.zIndex = 400; 
map.createPane('poiPane');           map.getPane('poiPane').style.zIndex = 600; 

// --- 4. STATE & LAYER CONTAINERS ---
let routeLayerGroup = L.layerGroup().addTo(map); 
const hotspotLayer = L.layerGroup();
const boundaryLayer = L.layerGroup();
const poiLayer = L.layerGroup();
const accessibilityLayer = L.layerGroup();

let dynamicDeliveries = [];
let unassignedPinsLayer = L.layerGroup().addTo(map);

// Store calculated OSRM coordinates for backend deployment
window.activeDeployments = {}; 

const baseMaps = { 
    "Command Center (Dark)": darkMap, 
    "Clean Street (Light)": lightMap, 
    "Satellite View": satellite 
};
const overlayMaps = {
    "<b>Live Operations</b>": routeLayerGroup,
    "Demand Hotspots": hotspotLayer,
    "City Boundaries": boundaryLayer,
    "Points of Interest": poiLayer,
    "Accessibility": accessibilityLayer
};
L.control.layers(baseMaps, overlayMaps, { collapsed: false }).addTo(map);

// --- 5. DATA LOADING & NATIVE SYMBOLOGY ---
const layerStyles = {
    boundaries: { color: "#ef4444", weight: 3, fillOpacity: 0.05, dashArray: '5, 10', interactive: false },
    hotspots: { fillColor: "#ef4444", color: "transparent", fillOpacity: 0.5, interactive: false },
    accessibility: { fillColor: "#166534", fillOpacity: 0.4, interactive: false }
};

async function fetchSpatialLayer(endpoint, layerGroup, styleConfig, targetPane = 'overlayPane') {
    try {
        const response = await fetch(`${API_BASE_URL}/api/layers${endpoint}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        L.geoJSON(data, {
            pane: targetPane, 
            style: styleConfig.style || {},
            pointToLayer: styleConfig.pointToLayer || null,
            onEachFeature: (feature, layer) => {
                if (styleConfig.interactive !== false) {
                    let popup = `<strong class="text-blue-600 uppercase tracking-widest text-xs">${endpoint.replace('/', '')} DATA</strong><br>`;
                    for (let key in feature.properties) { if (feature.properties[key]) popup += `<b class="text-gray-700 capitalize">${key}:</b> ${feature.properties[key]}<br>`; }
                    layer.bindPopup(popup);
                }
            }
        }).addTo(layerGroup);
    } catch (err) { console.warn(`⚠️ Error loading ${endpoint}:`, err); }
}

function loadAllDatabaseLayers() {
    fetchSpatialLayer('/hotspots', hotspotLayer, { style: () => layerStyles.hotspots }, 'hotspotPane');
    fetchSpatialLayer('/boundaries', boundaryLayer, { style: layerStyles.boundaries });
    fetchSpatialLayer('/accessibility', accessibilityLayer, { style: () => layerStyles.accessibility }, 'accessibilityPane');

    fetchSpatialLayer('/pois', poiLayer, { 
        pointToLayer: (feature, latlng) => {
            const category = String(feature.properties.amenity || feature.properties.cat_label || feature.properties.type || '').toLowerCase();
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

// --- 6. INTERACTIVE LOGIC ---
let depotLocation = { lat: 5.0333, lon: 7.9266 };
const depotIcon = L.divIcon({ className: 'depot', html: `<div style="background-color: #ffffff; border: 4px solid #3b82f6; border-radius: 50%; width: 24px; height: 24px; box-shadow: 0 0 20px rgba(59, 130, 246, 1);"></div>` });
const depotMarker = L.marker([depotLocation.lat, depotLocation.lon], { icon: depotIcon, draggable: true, pane: 'poiPane' }).addTo(map);

depotMarker.on('dragend', function() {
    const position = depotMarker.getLatLng();
    depotLocation.lat = position.lat;
    depotLocation.lon = position.lng;
});

map.on('click', function(e) {
    if (boundaryLayer.getLayers().length > 0) {
        if (!boundaryLayer.getLayers()[0].getBounds().contains(e.latlng)) { alert("⚠️ Location is outside service boundary."); return; }
    }
    const dropId = "Drop_" + Math.floor(Math.random() * 10000);
    dynamicDeliveries.push({ id: dropId, lat: e.latlng.lat, lon: e.latlng.lng, weight: 1 });
    
    L.marker([e.latlng.lat, e.latlng.lng], { icon: L.divIcon({ className: 'unassigned', html: `<div style="background-color: #ffffff; border: 2px solid #3b82f6; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 10px rgba(255,255,255,0.5);"></div>` }), pane: 'poiPane' }).addTo(unassignedPinsLayer).bindPopup(`Order: ${dropId}`);
});

// --- 7. NATIVE SEARCH BAR ENGINE ---
async function executeSearch() {
    const query = document.getElementById('custom-search').value.trim();
    if (!query) return;

    try {
        let searchString = query.toLowerCase().includes('uyo') ? query + ', Nigeria' : query + ', Uyo, Nigeria';
        let res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchString)}&limit=1`);
        let data = await res.json();
        
        if (data.length === 0) { 
            res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Akwa Ibom, Nigeria')}&limit=1`);
            data = await res.json();
        }

        if (data.length === 0) { alert("Location not found. Try searching for the street name (e.g., 'Oron Road') instead."); return; }

        const searchLat = parseFloat(data[0].lat); const searchLng = parseFloat(data[0].lon);

        if (boundaryLayer.getLayers().length > 0) {
            if (!boundaryLayer.getLayers()[0].getBounds().contains([searchLat, searchLng])) { alert("⚠️ Searched location is outside the Uyo service boundary."); return; }
        }

        const dropId = "Search_" + Math.floor(Math.random() * 10000);
        dynamicDeliveries.push({ id: dropId, lat: searchLat, lon: searchLng, weight: 1 });

        L.marker([searchLat, searchLng], { icon: L.divIcon({ className: 'unassigned', html: `<div style="background-color: #ffffff; border: 2px solid #3b82f6; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 10px rgba(255,255,255,0.5);"></div>` }), pane: 'poiPane' }).addTo(unassignedPinsLayer).bindPopup(`<b>Dispatched to:</b><br>${data[0].display_name.split(',')[0]}`).openPopup();
        map.flyTo([searchLat, searchLng], 16, { duration: 1.5 });
        document.getElementById('custom-search').value = ""; 

    } catch (err) { console.error("Search failed", err); alert("Search engine temporarily disconnected."); }
}

document.getElementById("custom-search").addEventListener("keypress", function(event) { if (event.key === "Enter") { event.preventDefault(); executeSearch(); } });

function clearUnassignedPins() { 
    unassignedPinsLayer.clearLayers(); 
    routeLayerGroup.clearLayers(); 
    dynamicDeliveries = []; 
    window.activeDeployments = {}; 
    
    const fleetList = document.getElementById('fleet-list');
    if (fleetList) fleetList.innerHTML = "";
    updateBIMetrics(0); 
    
    const reportContainer = document.getElementById("report-container");
    if (reportContainer) reportContainer.style.display = "none";
}

// --- 8. DUAL-SERVER REDUNDANCY & CRASH TRAPPING ---
async function solveAndDisplay() {
    if (dynamicDeliveries.length === 0) { alert("Drop pins or search for locations first!"); return; }
    
    if (!activeLicenseKey) {
        alert("Session expired. Please log in again.");
        window.location.href = "login.html";
        return;
    }

    const vehicleChoice = document.getElementById('vehicle-select').value;
    const btn = document.querySelector('button[onclick="solveAndDisplay()"]');
    
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
    let activeFleet = (vehicleChoice === 'all') ? [...fleetProfiles.bike, ...fleetProfiles.van] : fleetProfiles[vehicleChoice];
    
    try {
        btn.innerHTML = "Optimizing Engine..."; btn.disabled = true;
        
        const response = await fetch(`${API_BASE_URL}/api/vrp/solve-dynamic`, { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json',
                'x-license-key': activeLicenseKey 
            }, 
            body: JSON.stringify({ depot: depotLocation, deliveries: dynamicDeliveries, fleet: activeFleet }) 
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 402) {
                // Modified: Now calls the tiered subscription logic
                if(confirm(`💳 PAYMENT REQUIRED:\n\n${errorData.detail || 'Access restricted.'}\n\nWould you like to renew your subscription now?`)) {
                    initiateSubscriptionRenewal();
                }
            } else if (response.status === 401) {
                alert(`❌ ACCESS DENIED:\n\n${errorData.detail || 'Invalid License Key.'}`);
                localStorage.removeItem('uyo_license_key');
                window.location.href = "login.html";
            } else {
                throw new Error(errorData.detail || "Backend Distance Matrix Error");
            }
            return; 
        }
        
        const data = await response.json();
        routeLayerGroup.clearLayers(); 
        unassignedPinsLayer.clearLayers();
        window.activeDeployments = {}; 
        
        if (data.report_url) {
            const reportContainer = document.getElementById("report-container");
            const downloadBtn = document.getElementById("download-report-btn");
            
            if (reportContainer && downloadBtn) {
                reportContainer.style.display = "block"; 
                const sidebar = document.querySelector('.col-span-3');
                if (sidebar) sidebar.scrollTop = 0;
                
                downloadBtn.onclick = function() {
                    const reportPath = data.report_url.startsWith('/') ? data.report_url : '/' + data.report_url;
                    const fullUrl = data.report_url.startsWith('http') ? data.report_url : `${API_BASE_URL}${reportPath}`;
                    window.open(fullUrl, "_blank");
                };
            }
        }

        await renderRoutes(data.routes, { depot: depotLocation, deliveries: dynamicDeliveries });
        dynamicDeliveries = [];

    } catch (error) { 
        alert(`Routing Failed!\n\n${error.message}`); console.error(error);
    } finally { btn.innerHTML = "Optimize Routes"; btn.disabled = false; }
}

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

    let totalMissionDistance = 0;

    for (const r of routes) {
        const dropsCount = r.route ? r.route.length - 2 : 0;
        if (dropsCount <= 0) continue; 
        
        let vType = r.vehicle_type || r.type || 'Van'; 
        if (!vType || String(vType).trim().toLowerCase() === 'undefined' || String(vType).trim().toLowerCase() === 'unknown') {
            vType = 'Van';
        }
        vType = String(vType).charAt(0).toUpperCase() + String(vType).slice(1);
        const vId = r.vehicle_id || `${vType}-${Math.floor(Math.random() * 1000)}`;
        
        const color = vType.toLowerCase() === 'van' ? '#3b82f6' : '#10b981';
        
        const gpsPath = r.route.map(node => locDict[node]).filter(Boolean);
        if (gpsPath.length < 2) continue;

        const coordStr = gpsPath.map(c => `${c[1]},${c[0]}`).join(';');
        
        const originCoord = gpsPath[0];
        const destCoord = gpsPath[gpsPath.length - 1];
        let waypointsStr = '';
        if (gpsPath.length > 2) {
            waypointsStr = gpsPath.slice(1, -1).map(c => `${c[0]},${c[1]}`).join('|');
        }
        const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoord[0]},${originCoord[1]}&destination=${destCoord[0]},${destCoord[1]}${waypointsStr ? `&waypoints=${waypointsStr}` : ''}&travelmode=driving`;
        
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
                totalMissionDistance += distanceKm;

                const routeCoords = osrmData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                window.activeDeployments[vId] = routeCoords;

                const routeLine = L.polyline(routeCoords, { color: color, weight: 6, opacity: 0.9, pane: 'routePane' }).addTo(routeLayerGroup);
                
                let sequenceCounter = 1;
                r.route.forEach((node, idx) => {
                    if (idx === 0 || idx === r.route.length - 1) return;
                    const coords = locDict[node];
                    if (coords) {
                        L.marker(coords, { icon: L.divIcon({ className: 'seq', html: `<div style="background: white; color: ${color}; border: 2.5px solid ${color}; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">${sequenceCounter}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), pane: 'poiPane' }).addTo(routeLayerGroup);
                        sequenceCounter++;
                    }
                });

                try {
                    if (typeof L.polylineDecorator === 'function') {
                        L.polylineDecorator(routeLine, { 
                            patterns: [{ offset: 30, repeat: 70, symbol: L.Symbol.arrowHead({ pixelSize: 14, polygon: true, pathOptions: { color: '#ffffff', fillOpacity: 1, weight: 0, pane: 'routePane' } }) }] 
                        }).addTo(routeLayerGroup);
                    }
                } catch(err) { console.warn("Polyline Decorator skipped."); }

                if (fleetList) {
                    fleetList.innerHTML += `<div class="p-4 bg-gray-800 rounded-xl border-l-4 mb-3 shadow-xl" style="border-color: ${color}">
                        <div class="flex justify-between items-start mb-2">
                            <p class="text-[10px] font-black uppercase text-gray-500 tracking-tighter">${vId} Active</p>
                            <span class="text-[10px] font-bold bg-gray-700 px-2 py-1 rounded text-blue-400">${durationMin} MIN</span>
                        </div>
                        <p class="text-white font-mono text-sm mb-3">${distanceKm} KM | ${dropsCount} Drops</p>
                        <button onclick="deployMission('${vId}', '${gmapsUrl}')" class="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow transition-colors flex items-center justify-center gap-2">
                            Deploy Live Mission
                        </button>
                    </div>`;
                }
            } else { throw new Error("Both OSRM servers rejected the route geometry."); }
        } catch (e) { 
            console.error("Complete Network Failure. Deploying Direct Lines.", e);
        }
    }
    updateBIMetrics(totalMissionDistance);
}

// --- 9. BI ENGINES ---
let lifetimeStats = { fuel: 0, co2: 0, efficiency: 0 };

async function fetchLifetimeMetrics() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/vrp/history`, {
            headers: { 'x-license-key': activeLicenseKey }
        });
        if (response.ok) {
            const data = await response.json();
            lifetimeStats.fuel = data.total_fuel_saved || 0;
            lifetimeStats.co2 = data.total_co2_saved || 0;
            lifetimeStats.efficiency = data.avg_efficiency || 0;
            updateBIMetrics(0);
        }
    } catch (err) { console.warn("Could not fetch lifetime stats from memory bank."); }
}

function updateBIMetrics(newKm) {
    const manualDistance = newKm * 1.35; 
    const kmSaved = manualDistance - newKm;
    const currentFuelSaved = (kmSaved / 10) * 1200; 
    const currentCo2Saved = (kmSaved / 10) * 2.3;
    const sessionEfficiency = newKm > 0 ? ((kmSaved / manualDistance) * 100) : 0;
    const displayFuel = lifetimeStats.fuel + currentFuelSaved;
    const displayCo2 = lifetimeStats.co2 + currentCo2Saved;
    const displayEff = newKm > 0 ? sessionEfficiency : lifetimeStats.efficiency;
    if (document.getElementById('stat-fuel')) document.getElementById('stat-fuel').innerText = `₦${Math.floor(displayFuel).toLocaleString()}`;
    if (document.getElementById('stat-efficiency')) document.getElementById('stat-efficiency').innerText = `${displayEff.toFixed(1)}%`;
    if (document.getElementById('stat-co2')) document.getElementById('stat-co2').innerText = `${displayCo2.toFixed(1)} kg`;
    if (document.getElementById('co2-bar')) { document.getElementById('co2-bar').style.width = `${Math.min(displayEff * 2, 100)}%`; }
}

fetchLifetimeMetrics();

// --- 10. BACKEND MISSION DEPLOYMENT (ENTERPRISE SAAS) ---
window.deployMission = async function(vehicleId, gmapsUrl) {
    const whatsappMessage = encodeURIComponent(
        `🚀 *UYO LOGISTICS MISSION DEPLOYED*\n\n` +
        `📦 *Vehicle ID:* ${vehicleId}\n` +
        `📍 *Mission:* Optimized multi-stop delivery route generated by Command Center.\n\n` +
        `🗺️ *Open Turn-by-Turn Route:* \n${gmapsUrl}`
    );
    const whatsappLink = `https://wa.me/?text=${whatsappMessage}`;

    const userChoice = confirm(
        `📡 DEPLOY MISSION: ${vehicleId}\n\n` +
        `This will initiate live tracking and record the mission.\n\n` +
        `Click OK to deploy. You will then be asked if you want to hand off the route to the driver via WhatsApp.`
    );

    if (userChoice) {
        try {
            const coords = window.activeDeployments[vehicleId];
            if (!coords) throw new Error("Route coordinates missing from memory.");
            
            const response = await fetch(`${API_BASE_URL}/api/vrp/dispatch`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-license-key': activeLicenseKey
                },
                body: JSON.stringify({ vehicle_id: vehicleId, route_coords: coords })
            });
            
            if (response.ok) {
                console.log(`✅ Mission Deploy Success: ${vehicleId}`);
                setTimeout(fetchLifetimeMetrics, 1500);

                if (confirm("✅ Mission Active! Would you like to hand off this route to the Driver via WhatsApp?")) {
                    window.open(whatsappLink, '_blank');
                } else {
                    window.open(gmapsUrl, '_blank');
                }
            } else {
                const errData = await response.json().catch(() => ({}));
                throw new Error(`Server Code ${response.status}: ${errData.detail || response.statusText}`);
            }
        } catch (err) {
            console.error("Deployment Error:", err);
            alert(`❌ Deployment Failed!\n\n${err.message}`);
        }
    }
};

// --- 11. LIVE OPERATIONS (WEBSOCKETS) ---
let liveFleetSocket = null;
let liveMarkers = {}; 

map.on('overlayadd', function(e) {
    if (e.name.includes("Live Operations")) {
        connectLiveFleet();
    }
});

map.on('overlayremove', function(e) {
    if (e.name.includes("Live Operations")) {
        if (liveFleetSocket) {
            liveFleetSocket.close();
            liveFleetSocket = null;
            console.log("📡 Live Fleet Telemetry: Disconnected");
        }
        for (let id in liveMarkers) {
            map.removeLayer(liveMarkers[id]);
        }
        liveMarkers = {};
    }
});

function connectLiveFleet() {
    liveFleetSocket = new WebSocket(`${WS_BASE_URL}/ws/live-fleet`);
    liveFleetSocket.onopen = function() { console.log("📡 Live Fleet Telemetry: Connected"); };
    liveFleetSocket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        if (liveMarkers[data.vehicle_id]) {
            liveMarkers[data.vehicle_id].setLatLng([data.lat, data.lon]);
        } else {
            const icon = L.divIcon({ 
                className: 'live-ping', 
                html: `<div style="background: #ef4444; width:16px; height:16px; border-radius:50%; box-shadow: 0 0 15px #ef4444; border: 2.5px solid white;"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            liveMarkers[data.vehicle_id] = L.marker([data.lat, data.lon], {icon: icon, pane: 'poiPane'}).addTo(map);
        }
        if (data.deviation_alert) {
            const el = liveMarkers[data.vehicle_id].getElement().firstChild;
            el.style.background = '#f97316'; 
            el.style.boxShadow = '0 0 25px #f97316';
            el.style.border = '3px solid #000000';
            console.warn(`🚨 CRITICAL: ${data.vehicle_id} has deviated from the optimized route!`);
        } else {
            const el = liveMarkers[data.vehicle_id].getElement().firstChild;
            el.style.background = '#ef4444'; 
            el.style.boxShadow = '0 0 15px #ef4444';
            el.style.border = '2.5px solid white';
        }
        if (data.status === 'completed') { console.log(`🏁 Mission Completed for ${data.vehicle_id}`); }
    };
    liveFleetSocket.onerror = function(error) { console.error("WebSocket Error:", error); };
}

// --- 12. TIERED REVENUE ENGINE (PAYSTACK) ---
async function initiateSubscriptionRenewal() {
    const planChoice = prompt(
        "💳 SELECT YOUR PLAN:\n\n" +
        "1. Daily Pass - ₦3,000\n" +
        "2. Bi-Weekly Pro - ₦25,000\n" +
        "3. Monthly Enterprise - ₦50,000\n\n" +
        "Enter 1, 2, or 3:"
    );

    let amountKobo, daysToAdd;

    if (planChoice === "1") {
        amountKobo = 300000; daysToAdd = 1;
    } else if (planChoice === "2") {
        amountKobo = 2500000; daysToAdd = 14;
    } else if (planChoice === "3") {
        amountKobo = 5000000; daysToAdd = 30;
    } else {
        alert("Invalid selection. Operation cancelled.");
        return;
    }

    const userEmail = prompt("Please enter your business email for the receipt:");
    if (!userEmail) return;

    const handler = PaystackPop.setup({
        key: 'pk_test_c84a971d6679a03491b013d7cb2a51b8cc1bbebd', // REMEMBER: Replace with your actual Live Key from Paystack Dashboard
        email: userEmail,
        amount: amountKobo,
        currency: "NGN",
        ref: 'UYO-' + Math.floor((Math.random() * 1000000000) + 1),
        callback: async function(response) {
            const updateRes = await fetch(`${API_BASE_URL}/api/vrp/activate-license`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    reference: response.reference, 
                    license_key: activeLicenseKey,
                    days_to_add: daysToAdd 
                })
            });
            
            if (updateRes.ok) {
                alert(`✅ Plan Activated! Access extended by ${daysToAdd} day(s).`);
                location.reload(); 
            } else {
                alert("⚠️ Payment confirmed but license activation failed. Please contact support.");
            }
        },
        onClose: function() {
            alert("Transaction cancelled. Optimization remains locked.");
        }
    });
    handler.openIframe();
}