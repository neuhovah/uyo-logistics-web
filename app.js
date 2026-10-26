// ==============================================================================
// UYO LOGISTICS INTELLIGENCE | MASTER COMMAND CENTER
// 100% Survey-Grade Configuration (Deep Zoom, Individual Deletion, OSRM, BI, Search)
// ==============================================================================
//
// 📋 CHANGELOG
// v2.3.8: 60FPS Interpolation Engine: Replaced conflicting CSS transitions with requestAnimationFrame JS tweening (.slideTo).
// v2.3.9: Telemetry Diagnostic Patch: Injected WebSocket interceptor to debug ghost markers.
// v2.4.0: SURCON Enterprise Telemetry Sync: Patched defensive payload mapper to strictly reference nested telemetry objects.
// v2.4.1: Cartographic Expansion & Matrix Parity: Expanded Google Places API bounds and strictly enforced mathematical geofencing.
// v2.4.2: Survey-Grade Sync: Removed redundant UI pump price multiplication & switched to explicit backend time_saved_mins.
// v2.4.3: Telemetry Lock Patch: Introduced window.sessionMetricsCommitted state lock to prevent database metric duplication.
// v2.4.4: Telemetry Schema Enforcement: Normalized WebSocket ingestion to strictly target 'lng' and 'lat' keys, resolving silent NaN failures.
// v2.4.5: Architecture Synchronization: Pointed API and WS globals directly to Render to resolve split-brain memory allocation.
// v2.5.0: Enriched Payload Integration: Added dispatcher metadata inputs, transformed array mapping to RouteWaypoint dictionaries.
// v2.5.1: Dual-Payload Patch: Added fallback route_coords generation to window.deployMission to bypass strict backend validation.
// v2.5.2: Telemetry Schema Patch: Updated WebSocket ingestion to accept both 'lng' and 'lon' coordinate keys to resolve silent NaN failures on mobile driver deployment.
// v2.5.3: Security & Auth Patch: Explicitly injected missing x-license-key headers across all fetch endpoints and redacted exposed Google API key.
// v2.5.4: Places API Hotfix: Modified restricted key placeholder strategy to resolve HTTP 400 errors during UI geocoding searches.
// v2.5.5: Basemap Authentication Patch: Injected CARTO API key to raster tile endpoints to resolve commercial watermarks and prevent rate-limiting.
// v2.6.0: Backend v3 alignment and hardening (REQUIRES API v3.0.0 deployed FIRST):
//   API alignment
//   - WebSocket authenticates with {"type":"auth"}, heartbeats, reconnects with backoff, stops on auth failure (4401)
//   - Dispatch happens BEFORE the driver link is built; the link carries the per-mission driver token (&t=)
//   - Dispatch claims session metrics once, gives them back on failure, and sends the measured distance_km
//   - Licence renewal sends only reference + licence key (the server now decides days/stops from the verified payment)
//     and passes the licence key as Paystack metadata so the signed webhook can apply it too
//   - fetchLifetimeMetrics uses cache:'no-store' (no Cache-Control header), handles 401/402
//   - Re-route is disabled (API returns 501) instead of spending stop quota and reporting a fake success
//   Security
//   - Removed the hard-coded Google Places key (set window.ENV_GOOGLE_API_KEY; ROTATE the old key and restrict it by referrer)
//   - All third-party / user text (OSM+Foursquare POI properties, Nominatim/Google results, customer names) is HTML-escaped
//   Correctness
//   - Fixed fleet typo cost_cost_per_km -> cost_per_km for the van profile
//   - Unique order ids (4-digit random ids collided); exact vehicle-id matching for deploy buttons
//   - Local POI search now finds features (it iterated the wrong layer level and never matched)
//   - Route cards use backend-measured distance/time; OSRM is only used to draw geometry, with a straight-line fallback
//     so a mission can still be deployed when OSRM is down (it silently dropped the vehicle before)
//   - Validation errors (422) are readable; "Location N" errors name the drop; solver warnings are shown
//   - Telemetry: duplicates / out-of-order ignored, stop events handled, completed removes marker, animation follows real
//     update spacing, route sync throttled, position logging removed
//   - UI labels say fuel/CO2 are estimates, "efficiency" is distance saved vs entry order, traffic factor is an assumption
// ==============================================================================

// --- 0. PERSISTENT GLOBAL STATE (PATCHED & EXTENDED) ---
// 🔴 SYNCHRONIZATION FIX: Pointed directly to Render to ensure simulator and frontend share the exact same worker memory.
window.API_BASE_URL = "https://uyo-routing-engine.onrender.com";
window.WS_BASE_URL = "wss://uyo-routing-engine.onrender.com";

window.fleetRegistry = {}; 
window.activeDeployments = {};
window.activeDeploymentsMins = {}; 
window.activeRoutePlans = {}; // NEW: Stores the enriched RouteWaypoint payload
window.currentPhysicsEngine = {};
window.lifetimeStats = { fuel: 0, co2: 0, efficiency: 0 };
window.sessionMetricsCommitted = false; 

window.depotLocation = { lat: 5.0333, lon: 7.9266 };
window.dynamicDeliveries = [];
window.liveMarkers = {};

window.map = null;
window.routeLayerGroup = null;
window.unassignedPinsLayer = null;
window.liveFleetSocket = null;

// v2.6.0 state
window.FEATURES = { reroute: false };       // API /push-reroute returns 501 until implemented
window.MAX_DISPLAY_ACCURACY_M = 150;        // fixes worse than this are drawn dimmed
window.DEBUG_TELEMETRY = false;             // never log vehicle positions unless debugging
window.RESEARCH_MODE = new URLSearchParams(window.location.search).get('research') === '1'; // adds &research=1 to driver links
window.currentMetrics = null;               // measured distances from the last solve (data.metrics)
window.currentAssumptions = null;           // fuel/CO2 assumptions from the last solve (data.assumptions)
window.currentWarnings = [];
window.stopEvents = {};                     // arrived/departed markers per vehicle
window.lastTelemetry = {};                  // per-vehicle {session, seq, at} for de-duplication
window.routeSyncState = {};                 // per-vehicle throttle for route-geometry sync
window._notified = {};
window._dropCounter = 0;

// --- 0.0 SMALL SHARED HELPERS ---
window.escapeHtml = function(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
};

window.escapeRegex = function(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

window.notifyOnce = function(key, message) {
    if (window._notified[key]) return;
    window._notified[key] = true;
    alert(message);
};

// Non-blocking notice (never parsed as HTML).
window.showToast = function(message, durationMs) {
    try {
        const el = document.createElement('div');
        el.textContent = String(message);
        el.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%); max-width:min(90vw,520px); background:#1f2937; color:#fbbf24; border:1px solid #f59e0b; border-radius:8px; padding:10px 14px; font:600 12px ui-sans-serif,system-ui,sans-serif; z-index:99999; box-shadow:0 10px 25px rgba(0,0,0,0.6);';
        document.body.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, durationMs || 8000);
    } catch (e) { console.warn(message); }
};

// Unique within the page (the old 4-digit random ids collided after a few dozen drops).
window.newDropId = function() {
    window._dropCounter += 1;
    let rand;
    if (window.crypto && window.crypto.getRandomValues) rand = window.crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4);
    else rand = Math.random().toString(36).slice(2, 6);
    return `ORD-${window._dropCounter}-${rand}`;
};

window.authHeaders = function(extra) {
    const key = localStorage.getItem('uyo_license_key');
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['x-license-key'] = key;
    return Object.assign(headers, extra || {});
};

// Returns true when the session is invalid and the user has been sent to the login page.
window.handleAuthFailure = function(status) {
    if (status === 401) {
        localStorage.removeItem('uyo_license_key');
        window.location.href = "login.html";
        return true;
    }
    return false;
};

// FastAPI 422 errors arrive as an array of objects; never print "[object Object]".
window.formatApiError = function(body, fallback) {
    const detail = body && body.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
        return detail.map(d => `${(d.loc || []).slice(1).join('.') || 'request'}: ${d.msg}`).join('; ');
    }
    if (detail) { try { return JSON.stringify(detail); } catch (e) { /* fall through */ } }
    return fallback || 'Unknown error';
};

// The API reports problems by position ("Location 3 ..."); name the drop the dispatcher entered.
window.describeLocationErrors = function(message) {
    return String(message).replace(/Location (\d+)/g, (match, n) => {
        const i = parseInt(n, 10);
        if (i === 0) return 'the depot';
        const d = window.dynamicDeliveries[i - 1];
        if (!d) return match;
        const who = d.customer_name && d.customer_name !== 'Unknown Customer' ? ` (${d.customer_name})` : '';
        return `drop ${d.id}${who}`;
    });
};

// Call this once with the /solve-dynamic response.
window.captureSolveResult = function(data) {
    window.currentMetrics = (data && data.metrics) || null;
    window.currentAssumptions = (data && data.assumptions) || null;
    window.currentWarnings = (data && data.warnings) || [];
    if (data && data.physics_engine) window.currentPhysicsEngine = data.physics_engine;
    if (window.currentWarnings.length) console.warn("Solve warnings:", window.currentWarnings);
};

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

        if (!(durationMs > 0)) {                 // no animation requested
            this.setLatLng(end);
            return;
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
    const icon = isBike ? 'fa-motorcycle' : 'fa-truck';
    
    return L.divIcon({ 
        className: 'live-telemetry-marker',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        html: `
            <div class="relative flex items-center justify-center h-6 w-6">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                <div class="relative flex items-center justify-center h-5 w-5 rounded-full bg-red-600 border-[1.5px] border-white shadow-lg">
                    <i class="fa-solid ${icon}" style="color: white; font-size: 8px;"></i>
                </div>
            </div>
        `
    });
};

window.fetchLifetimeMetrics = async function() {
    if (!localStorage.getItem('uyo_license_key')) return;
    try {
        // cache:'no-store' + the _t query value replace the old Cache-Control request header,
        // which the API's CORS policy does not need to allow any more.
        const response = await fetch(`${window.API_BASE_URL}/api/vrp/history?_t=${Date.now()}`, {
            method: 'GET',
            cache: 'no-store',
            headers: window.authHeaders()
        });
        
        if (window.handleAuthFailure(response.status)) return;

        if (response.status === 402) {
            // Not a logout: the renewal flow (Optimize Routes -> 402 -> renew) must stay reachable.
            if (!window._notified['license-expired']) {
                window._notified['license-expired'] = true;
                window.showToast("Your subscription has expired. Renew to keep optimising routes.", 12000);
            }
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
    const a = window.currentAssumptions;
    const assumptionNote = a
        ? `Estimate: ${a.km_per_liter} km/L, ₦${a.fuel_price_ngn_per_liter}/L, ${a.co2_kg_per_liter} kg CO2/L`
        : 'Estimate based on configured fuel assumptions';

    if (isSession) {
        if (statFuelEl) {
            statFuelEl.previousElementSibling.innerText = "Session Fuel Saved (est.)";
            const sessionFuelValue = parseFloat(pe.fuel_saved) || 0; 
            statFuelEl.innerText = `₦${sessionFuelValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            statFuelEl.style.color = "#fbbf24"; 
            statFuelEl.title = assumptionNote;
        }
        if (statEffEl) {
            statEffEl.previousElementSibling.innerText = "Session Distance Saved";
            statEffEl.innerText = `${(parseFloat(pe.efficiency) || 0).toFixed(1)}%`;
            statEffEl.style.color = "#fbbf24";
            statEffEl.title = "Distance saved versus visiting the same stops in the order entered";
        }
        if (statCo2El) {
            statCo2El.previousElementSibling.innerText = "Session CO2 Saved (est.)";
            statCo2El.innerText = `${(parseFloat(pe.co2_saved) || 0).toFixed(2)} kg`;
            statCo2El.style.color = "#fbbf24";
            statCo2El.title = assumptionNote;
        }
    } else {
        if (statFuelEl) {
            statFuelEl.previousElementSibling.innerText = "Lifetime Fuel (est.)";
            const lifeFuelValue = parseFloat(window.lifetimeStats.fuel) || 0; 
            statFuelEl.innerText = `₦${lifeFuelValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            statFuelEl.style.color = "#4ade80"; 
            statFuelEl.title = assumptionNote;
        }
        if (statEffEl) {
            statEffEl.previousElementSibling.innerText = "Avg Distance Saved";
            statEffEl.innerText = `${(parseFloat(window.lifetimeStats.efficiency) || 0).toFixed(1)}%`;
            statEffEl.style.color = "#60a5fa"; 
            statEffEl.title = "Average of reported per-mission distance saved versus entry order";
        }
        if (statCo2El) {
            statCo2El.previousElementSibling.innerText = "Lifetime CO2 (est.)";
            statCo2El.innerText = `${(parseFloat(window.lifetimeStats.co2) || 0).toFixed(1)} kg`;
            statCo2El.style.color = "#f87171"; 
            statCo2El.title = assumptionNote;
        }
    }
    
    if (document.getElementById('co2-bar')) { 
        const displayEff = isSession ? (pe.efficiency || 0) : (window.lifetimeStats.efficiency || 0);
        document.getElementById('co2-bar').style.width = `${Math.min(displayEff * 2, 100)}%`; 
    }
};

// Builds the driver link. URLSearchParams encodes each value exactly once.
window.buildDriverUrl = function(vehicleId, gmapsUrl, driverToken) {
    const q = new URLSearchParams();
    q.set('v', String(vehicleId));
    if (driverToken) q.set('t', driverToken);
    if (gmapsUrl) q.set('map', gmapsUrl);
    if (window.RESEARCH_MODE) q.set('research', '1');   // field tests: driver page will not open Maps
    return `https://uyologistics.com/driver.html?${q.toString()}`;
};

window.deployMission = async function(vehicleId, gmapsUrl) {

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

    let claimedMetrics = false;   // did THIS call take the once-per-session savings?
    let dispatched = false;       // did the server accept the mission?

    try {
        // --- NEW: Fetching the enriched structured dictionary instead of raw OSRM path arrays ---
        const routePlan = window.activeRoutePlans[vehicleId];
        if (!routePlan) throw new Error("Route plan metadata missing from memory.");
        if (routePlan.length > 500) throw new Error("A mission can have at most 500 stops.");
        
        const safeFloat = (val) => { const n = parseFloat(val); return isNaN(n) ? 0 : n; };

        // Normalise to what the API validates: finite coordinates and bounded text.
        const cleanPlan = routePlan.map((wp, i) => {
            const lat = parseFloat(wp.lat);
            const lng = parseFloat(wp.lng ?? wp.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                throw new Error(`Stop ${i} has invalid coordinates.`);
            }
            return {
                sequence: Number.isInteger(wp.sequence) ? wp.sequence : i,
                lat, lng,
                customer_name: String(wp.customer_name ?? 'Unknown Customer').slice(0, 120),
                phone: String(wp.phone ?? 'N/A').slice(0, 32),
                order_id: String(wp.order_id ?? 'N/A').slice(0, 64)
            };
        });

        const peRaw = window.currentPhysicsEngine || {};
        let dispatchFuel = 0;
        let dispatchCo2 = 0;
        let dispatchEff = 0;
        let dispatchKm = null;

        if (!window.sessionMetricsCommitted) {
            dispatchFuel = safeFloat(peRaw.fuel_saved);
            dispatchCo2 = safeFloat(peRaw.co2_saved);
            dispatchEff = safeFloat(peRaw.efficiency);
            const km = parseFloat(window.currentMetrics && window.currentMetrics.distance_km);
            dispatchKm = Number.isFinite(km) ? km : null;
            window.sessionMetricsCommitted = true;   // claim before awaiting so a double-click cannot double count
            claimedMetrics = true;
        }

        const payload = {
            vehicle_id: String(vehicleId),
            route_plan: cleanPlan,                                  // List[RouteWaypoint]
            route_coords: cleanPlan.map(wp => [wp.lat, wp.lng]),    // legacy fallback
            fuel_saved: dispatchFuel, 
            co2_saved: dispatchCo2,
            efficiency: dispatchEff
        };
        if (dispatchKm !== null) payload.distance_km = dispatchKm;  // measured by the API, not estimated here
        
        const response = await fetch(`${window.API_BASE_URL}/api/vrp/dispatch`, {
            method: 'POST',
            headers: window.authHeaders(),
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (window.handleAuthFailure(response.status)) return;
            throw new Error(`Server Code ${response.status}: ${window.formatApiError(errData, response.statusText)}`);
        }

        dispatched = true;
        const result = await response.json().catch(() => ({}));
        const driverToken = result.driver_token || null;
        if (!driverToken) console.warn("API did not return a driver token (older backend). The link will be untracked-by-token.");
        if (result.logged === false) console.warn("Mission deployed but history could not be logged.");

        // The link is built AFTER dispatch because it carries the per-mission token.
        const trackingUrl = window.buildDriverUrl(vehicleId, gmapsUrl, driverToken);
        const whatsappMessage = encodeURIComponent(
            `🚀 *UYO LOGISTICS MISSION DEPLOYED*\n\n` +
            `📦 *Vehicle ID:* ${vehicleId}\n` +
            `📍 *Mission:* Optimized multi-stop delivery route generated by Command Center.\n\n` +
            `📱 *Open Live Tracking & Navigation:* \n${trackingUrl}`
        );
        const whatsappLink = `https://wa.me/?text=${whatsappMessage}`;

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

        // Exact id match: 'UYO-VEH-1' must not also disable 'UYO-VEH-10' ... 'UYO-VEH-15'.
        const idPattern = new RegExp(`['"]${window.escapeRegex(vehicleId)}['"]`);
        const btns = document.querySelectorAll('button');
        btns.forEach(btn => {
            const exactById = btn.dataset && btn.dataset.deployVehicle === vehicleId;
            const exactByOnclick = idPattern.test(btn.getAttribute('onclick') || '');
            if (btn.innerText.includes('Deploy Live Mission') && (exactById || exactByOnclick)) {
                btn.innerHTML = `<i class="fa-solid fa-satellite-dish fa-beat" style="color: #4ade80;"></i> Tracking Live`;
                btn.style.backgroundColor = "#166534"; 
                btn.style.cursor = "not-allowed";
                btn.disabled = true;
            }
        });

        const target = useWhatsApp ? whatsappLink : trackingUrl;
        if (newTab && !newTab.closed) {
            newTab.location.href = target;
        } else {
            // Pop-up blocked: the mission IS deployed, so hand over the link instead of failing.
            try { await navigator.clipboard.writeText(trackingUrl); } catch (e) { /* clipboard may be unavailable */ }
            alert(`Mission deployed. Your browser blocked the pop-up, so send the driver this link:\n\n${trackingUrl}`);
        }

    } catch (err) {
        if (newTab && !newTab.closed) newTab.close(); 
        console.error("Critical Synchronization Error:", err);
        if (!dispatched) {
            // Nothing was accepted by the server: give the session savings back so a retry still counts them.
            if (claimedMetrics) window.sessionMetricsCommitted = false;
            alert(`❌ Deployment Failed!\n\n${err.message}`);
        } else {
            alert(`⚠️ Mission ${vehicleId} was deployed, but the dashboard could not finish updating:\n\n${err.message}\n\nRefresh the page to see live tracking.`);
        }
    }
};

// --- LIVE TELEMETRY ---
window._ws = { backoff: 1000, reconnectTimer: null, heartbeat: null, authFailed: false };

window.syncRouteGeometry = async function(vId) {
    const st = window.routeSyncState[vId] || (window.routeSyncState[vId] = { inFlight: false, retryAt: 0 });
    if (st.inFlight || Date.now() < st.retryAt) return;     // at most one attempt per 15 s per vehicle
    st.inFlight = true;
    console.log(`🔄 Global Sync Triggered: Fetching missing route geometry for ${vId}...`);
    try {
        const syncRes = await fetch(`${window.API_BASE_URL}/api/vrp/active-missions`, {
            method: 'GET',
            headers: window.authHeaders()
        });
        if (window.handleAuthFailure(syncRes.status)) return;
        if (!syncRes.ok) throw new Error(`HTTP ${syncRes.status}`);
        const syncData = await syncRes.json();
        
        if (syncData.active_missions && syncData.active_missions[vId]) {
            const rawCoords = syncData.active_missions[vId].coords || [];
            
            // Safely extract lat/lng regardless of array format or enriched dict format
            const extractedCoords = rawCoords.map(c => Array.isArray(c) ? c : [c.lat, c.lng]);
            
            L.polyline(extractedCoords, { 
                color: '#f59e0b', 
                weight: 4, 
                opacity: 0.8, 
                dashArray: '10, 10', 
                pane: 'routePane' 
            }).addTo(window.routeLayerGroup);
            
            window.activeDeployments[vId] = extractedCoords;
            console.log(`✅ Global Sync Complete: Route drawn for ${vId}`);
        }
    } catch (err) {
        console.warn("Global Sync Failed:", err);
    } finally {
        st.inFlight = false;
        if (!window.activeDeployments[vId]) st.retryAt = Date.now() + 15000;
    }
};

window.handleTelemetryMessage = async function(rawData) {
    if (!rawData || typeof rawData !== 'object') return;
    if (rawData.type === 'auth_ok' || rawData.type === 'pong') return;   // control frames

    if (window.DEBUG_TELEMETRY) console.debug(`WS [${new Date().toISOString()}]`, rawData);

    const payload = rawData.telemetry ? rawData.telemetry : rawData;
    const vId = payload.vehicle_id || payload.id;
    if (!vId) return;

    // Mission finished: drop the marker (the API now includes status on the broadcast).
    if (payload.status === 'completed') {
        console.log(`🏁 Mission Completed for ${vId}`); 
        const done = window.liveMarkers[vId];
        if (done) {
            if (done._slideFrame) cancelAnimationFrame(done._slideFrame);
            window.map.removeLayer(done);
            delete window.liveMarkers[vId];
        }
        delete window.lastTelemetry[vId];
        return;
    }

    // Stop markers (Arrived / Departed) are events, not positions.
    if (payload.event) {
        (window.stopEvents[vId] = window.stopEvents[vId] || []).push({
            event: payload.event, stop_seq: payload.stop_seq, ts: payload.event_ts || payload.server_ts
        });
        console.info(`📍 ${vId} ${payload.event} stop ${payload.stop_seq}`);
        return;
    }

    // 🔴 STRICT SCHEMA FIX: API sends 'lat' and 'lon' (older senders used 'lng').
    const markerLat = parseFloat(payload.lat);
    const markerLng = parseFloat(payload.lng ?? payload.lon);
    if (!Number.isFinite(markerLat) || !Number.isFinite(markerLng)) return;

    // Ignore duplicates and out-of-order fixes within one driver session.
    const prev = window.lastTelemetry[vId];
    const seq = Number.isInteger(payload.seq) ? payload.seq : null;
    if (prev && seq !== null && payload.session_id && prev.session === payload.session_id && seq <= prev.seq) return;
    const nowMs = performance.now();
    const gapMs = prev ? nowMs - prev.at : null;
    window.lastTelemetry[vId] = {
        session: payload.session_id || null,
        seq: seq !== null ? seq : (prev ? prev.seq : -1),
        at: nowMs
    };

    if (!window.activeDeployments[vId]) {
        window.syncRouteGeometry(vId);   // not awaited: the marker must not wait for a network call
    }

    // Animate over the real spacing between updates (the old fixed 667 ms assumed 1.5 Hz).
    const durationMs = gapMs === null ? 0 : Math.min(2000, Math.max(200, gapMs));
    const acc = Number(payload.accuracy);
    const lowAccuracy = Number.isFinite(acc) && acc > window.MAX_DISPLAY_ACCURACY_M;

    // --- Hardware-Accelerated 60FPS JS Interpolation ---
    if (window.liveMarkers[vId]) {
        const marker = window.liveMarkers[vId];
        
        const el = marker.getElement();
        if (el) {
            el.style.transition = 'none'; 
        }
        
        marker.slideTo([markerLat, markerLng], durationMs);
        marker.setZIndexOffset(1000); 
        marker.setOpacity(lowAccuracy ? 0.45 : 1);

    } else {
        const isBike = window.fleetRegistry[vId] !== undefined 
                       ? window.fleetRegistry[vId] 
                       : String(vId).toLowerCase().includes('bike');
                       
        window.liveMarkers[vId] = L.marker([markerLat, markerLng], {
            icon: window.createLiveIcon(vId, isBike), 
            pane: 'poiPane',
            zIndexOffset: 1000,
            opacity: lowAccuracy ? 0.45 : 1
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
};

window.connectLiveFleet = function() {
    const existing = window.liveFleetSocket;
    if (existing && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)) return;
    if (window._ws.authFailed) return;
    const key = localStorage.getItem('uyo_license_key');
    if (!key) return;

    const socket = new WebSocket(`${window.WS_BASE_URL}/ws/live-fleet`);
    window.liveFleetSocket = socket;

    socket.onopen = function() {
        // The API expects the licence key as the FIRST message (it is never relayed to other clients).
        socket.send(JSON.stringify({ type: 'auth', license_key: key }));
        window._ws.backoff = 1000;
        clearInterval(window._ws.heartbeat);
        window._ws.heartbeat = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
        }, 25000);
        console.log("📡 Live Fleet Telemetry: Connected & Listening");
    };
    
    socket.onmessage = function(event) {
        let rawData;
        try {
            rawData = JSON.parse(event.data);
        } catch (e) {
            console.error("Failed to parse WebSocket JSON.");
            return;
        }
        window.handleTelemetryMessage(rawData);
    };

    socket.onclose = function(ev) {
        clearInterval(window._ws.heartbeat);
        if (window.liveFleetSocket !== socket) return;          // closed on purpose, or replaced by a newer socket
        if (ev.code === 4401) {                                  // licence rejected (invalid, expired, or rate-limited)
            window._ws.authFailed = true;
            window.notifyOnce('ws-auth', "Live tracking could not be authorised. Check your subscription or sign in again, then reload.");
            return;
        }
        const delay = window._ws.backoff;
        window._ws.backoff = Math.min(30000, delay * 2);
        console.warn(`Live Fleet socket closed (code ${ev.code}). Reconnecting in ${Math.round(delay / 1000)} s.`);
        clearTimeout(window._ws.reconnectTimer);
        window._ws.reconnectTimer = setTimeout(window.connectLiveFleet, delay);
    };

    socket.onerror = function(error) { console.error("WebSocket Error:", error); };
};

window.triggerTrafficRecalculate = async function(vehicleId) {
    // The API's /push-reroute is not implemented (it returns 501), and /solve-dynamic spends the
    // client's paid stop quota. Until re-routing exists, do not burn stops for a result nobody receives.
    if (!window.FEATURES.reroute) {
        alert("Live re-routing is not available yet. Your current route stays active; contact dispatch to change it.");
        return;
    }

    const activeCoords = window.activeDeployments[vehicleId];
    if (!activeCoords) {
        alert("Cannot recalculate: No active GPS data found for this vehicle.");
        return;
    }

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
            headers: window.authHeaders(), 
            body: JSON.stringify({ 
                depot: window.depotLocation, 
                deliveries: remainingDeliveries, 
                fleet: [{ id: vehicleId, type: "van", capacity: 50, speed_factor: 1.0, fixed_cost: 0, cost_per_km: 50 }] 
            }) 
        });

        if (window.handleAuthFailure(solveRes.status)) return;
        if (!solveRes.ok) throw new Error("Traffic Engine Failed.");
        const data = await solveRes.json();
        window.captureSolveResult(data);
        
        if (data.traffic_multiplier > 1.0) {
            console.warn(`⚠️ High Traffic Detected! Penalty applied: ${data.traffic_multiplier}x`);
            document.body.style.borderTop = "5px solid #f97316"; 
            setTimeout(() => document.body.style.borderTop = "none", 5000);
        }

        const newMapUrl = "https://www.google.com/maps/dir/?api=1"; 

        const pushRes = await fetch(`${window.API_BASE_URL}/api/vrp/push-reroute`, {
            method: 'POST',
            headers: window.authHeaders(),
            body: JSON.stringify({
                vehicle_id: vehicleId,
                new_gmaps_url: encodeURIComponent(newMapUrl)
            })
        });

        if (pushRes.ok) {
            alert(`✅ New Traffic-Aware Route Sent to ${vehicleId} Driver!`);
        } else if (pushRes.status === 501) {
            alert("Re-routing is not implemented on the server yet.");
        } else {
            throw new Error(`Push failed (${pushRes.status}).`);
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

// CSV cell: neutralise spreadsheet formulas and quote when needed.
window.csvCell = function(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;   // formula-injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

window.downloadSurveyManifest = function(routeData, opIntelData) {
    opIntelData = opIntelData || {};
    // "Cumulative Time" is the running clock from shift start (it was mislabelled "Travel Leg").
    let csvContent = "\uFEFFVehicle ID,Vehicle Type,Stop Sequence,Estimated Arrival (ETA),Internal Node ID,Load After Stop,Cumulative Time (Mins),Status\n";

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

            csvContent += [
                vehicleId,
                vehicleType,
                stop.stop_sequence,
                stop.arrival_time || "00:00 AM",
                stop.node_id,
                stop.demand || stop.weight_load_after_stop || stop.inventory_load || 0,
                Number(stop.cumulative_mins || 0).toFixed(2),
                status
            ].map(window.csvCell).join(",") + "\n";
        });
    });

    const summary = (label, value) => csvContent += [label, value, '', '', '', '', '', ''].map(window.csvCell).join(",") + "\n";

    csvContent += ",,,,,,,\n"; 
    csvContent += "--- EXECUTIVE BI SUMMARY ---,,,,,,,\n";
    
    summary("Total Orders Dispatched", `${opIntelData.drops || 0} Drops`);
    summary("Total Fleet Operation Time", `${opIntelData.total_mins || 0} Mins`);

    const m = window.currentMetrics;
    if (m) {
        summary("Measured Route Distance (km)", m.distance_km);
        summary("Baseline: Same Stops In Entry Order (km)", m.baseline_input_order_km);
        summary("Baseline: Nearest Neighbour (km)", m.baseline_nearest_neighbour_km);
        summary("Distance Saved vs Entry Order (%)", m.reduction_vs_input_order_pct);
        summary("Distance Saved vs Nearest Neighbour (%)", m.reduction_vs_nearest_neighbour_pct);
    }

    summary("Estimated Fuel Savings (est.)", opIntelData.fuel_saved || '₦0');
    summary("Fleet Distance-Saved Score", opIntelData.efficiency || '0%');
    summary("CO2 Emission Offset (est.)", opIntelData.co2_saved || '0 kg');

    const a = window.currentAssumptions;
    if (a) {
        summary("Estimate Assumptions", `${a.km_per_liter} km/L; NGN ${a.fuel_price_ngn_per_liter}/L; ${a.co2_kg_per_liter} kg CO2/L`);
    }
    
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
    summary("Optimization Timestamp", timestamp);

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

    // 🔴 SYNCHRONIZATION FIX: Handshake explicitly dynamically tied to window.API_BASE_URL to avoid hardcoded domain blocks
    fetch(`${window.API_BASE_URL}/api/vrp/history`, {
        method: 'GET',
        headers: { 
            'Content-Type': 'application/json',
            'x-license-key': activeLicenseKey 
        }
    })
    .then(response => {
        // 401 = unknown key. 402 (expired) deliberately does NOT log out, so the renewal prompt stays reachable.
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
    
    console.log("🚀 Uyo Logistics Engine v2.6.0 LOADED - Unified Telemetry Active");

    const uyoCenter = [5.0377, 7.9128];

    // 🔴 SURVEY-GRADE FIX: Frontend bounds perfectly synced to vrp.py matrix
    const uyoMathematicalBounds = L.latLngBounds(
        L.latLng(4.8000, 7.7000), 
        L.latLng(5.2500, 8.2000)  
    );

    const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_25zt_1_55c6b7ed19fd0cb6b0e8591b', { 
        attribution: '© OpenStreetMap contributors, © CARTO',
        subdomains: 'abcd',
        maxZoom: 22,
        maxNativeZoom: 19
    });
    const lightMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_25zt_1_55c6b7ed19fd0cb6b0e8591b', { 
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
                        // Feature properties come from OSM / Foursquare / the database: never trust them as HTML.
                        let popup = `<strong class="text-blue-600 uppercase tracking-widest text-xs">${window.escapeHtml(endpoint.replace('/', ''))} DATA</strong><br>`;
                        for (let key in feature.properties) { if (feature.properties[key]) popup += `<b class="text-gray-700 capitalize">${window.escapeHtml(key)}:</b> ${window.escapeHtml(feature.properties[key])}<br>`; }
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

    // Shared by the map-click and search flows. Text is bounded to what the API accepts and escaped for display.
    function buildDropPopup(dropId, custName, custPhone, parsedWeight) {
        return `
            <div style="text-align: center;">
                <b style="color: #1f2937;">Order: ${window.escapeHtml(dropId)}</b><br>
                <span style="font-size: 12px; color: #3b82f6;"><b>${window.escapeHtml(custName)}</b></span><br>
                <span style="font-size: 11px; color: #4b5563;">${window.escapeHtml(custPhone)}</span><br>
                <span style="font-size: 11px; font-weight: bold; color: #28a745;">Weight: ${window.escapeHtml(parsedWeight)} kg</span><br>
                <button onclick="window.removePin('${window.escapeHtml(dropId)}')" style="margin-top: 8px; padding: 4px 8px; background-color: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">
                    <i class="fa-solid fa-trash"></i> Remove Drop
                </button>
            </div>
        `;
    }

    // --- 🔴 SURVEY-GRADE FIX: Strict Mathematical Interception ---
    // Removed dependency on GeoJSON boundaryLayer to prevent "click-trap" bugs.
    window.map.on('click', function(e) {
        if (!uyoMathematicalBounds.contains(e.latlng)) { 
            alert("⚠️ Location is outside the Uyo operational geofence (Lat 4.80-5.25, Lon 7.70-8.20)."); 
            return; 
        }
        
        let custName = String(prompt("Enter Customer Name (or leave blank for Unknown):", "") || "Unknown Customer").trim().slice(0, 120) || "Unknown Customer";
        let custPhone = String(prompt("Enter Customer Phone Number:", "") || "N/A").trim().slice(0, 32) || "N/A";
        let weightInput = prompt("Enter parcel weight in kg for this stop (e.g., 2, 15, 30):", "1");
        let parsedWeight = parseInt(weightInput, 10);
        if (isNaN(parsedWeight) || parsedWeight <= 0) {
            parsedWeight = 1; 
        }

        const cleanLat = parseFloat(e.latlng.lat.toFixed(6));
        const cleanLng = parseFloat(e.latlng.lng.toFixed(6));
        
        const dropId = window.newDropId();
        window.dynamicDeliveries.push({ 
            id: dropId, 
            lat: cleanLat, 
            lon: cleanLng, 
            weight: parsedWeight, 
            customer_name: custName, 
            phone: custPhone 
        });
        
        const popupContent = buildDropPopup(dropId, custName, custPhone, parsedWeight);

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
            // L.geoJSON nests the features one level below the layer group, so look inside each group.
            poiLayer.eachLayer(group => {
                const visit = (layer) => {
                    const props = layer?.feature?.properties;
                    if (!props || typeof layer.getLatLng !== 'function') return; 
                    
                    const poiName = String(props.name || props.poi_name || props.title || '').toLowerCase();
                    if (poiName.includes(lowerQuery)) {
                        combinedResults.push({
                            lat: layer.getLatLng().lat, lng: layer.getLatLng().lng,
                            name: props.name || query, address: "Verified Local Database", source: "LOCAL", icon: "fa-database"
                        });
                    }
                };
                if (group && typeof group.eachLayer === 'function') group.eachLayer(visit); else visit(group);
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

            // 🔴 SECURITY FIX: no key lives in this file any more. Provide window.ENV_GOOGLE_API_KEY from a
            // deployment-time script, and RESTRICT that key by HTTP referrer and to the Places API (a browser key is
            // visible to anyone). Without it, Google results are skipped and the other sources still work.
            const GOOGLE_API_KEY = window.ENV_GOOGLE_API_KEY;
            const locationRestriction = { rectangle: { low: { latitude: 4.8000, longitude: 7.7000 }, high: { latitude: 5.2500, longitude: 8.2000 } } };
            
            if (GOOGLE_API_KEY) {
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
            } else {
                console.info("Google Places search skipped: window.ENV_GOOGLE_API_KEY is not set.");
            }

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
                        No verified addresses found for <b>"${window.escapeHtml(query)}"</b> inside the operational perimeter.
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
                
                // name/address come from OSM, Google or the database: always escaped.
                opt.innerHTML = `
                    <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 10px;">
                        <b style="font-size:13px; color:white;">${window.escapeHtml(item.name)}</b><br>
                        <span style="font-size:10px; color:#9ca3af;">${window.escapeHtml(item.address)}</span>
                    </div>
                    <span style="font-size:9px; font-weight:bold; color:${sourceColor}; border:1px solid ${sourceColor}; padding:2px 4px; border-radius:3px; flex-shrink: 0;">
                        <i class="fa-brands ${item.icon}"></i> ${item.source}
                    </span>
                `;

                opt.onclick = () => {
                    dropdownMenu.style.display = 'none';
                    searchInput.value = '';
                    searchInput.focus();
                    
                    let custName = String(prompt(`Enter Customer Name for ${item.name} (or leave blank):`, "Unknown Customer") || "Unknown Customer").trim().slice(0, 120) || "Unknown Customer";
                    let custPhone = String(prompt("Enter Customer Phone:", "N/A") || "N/A").trim().slice(0, 32) || "N/A";
                    let weightInput = prompt(`Enter parcel weight in kg for ${item.name} (e.g., 2, 15, 30):`, "1");
                    let parsedWeight = parseInt(weightInput, 10);
                    if (isNaN(parsedWeight) || parsedWeight <= 0) {
                        parsedWeight = 1; 
                    }
                    
                    const dropId = window.newDropId();
                    window.dynamicDeliveries.push({ 
                        id: dropId, 
                        lat: item.lat, 
                        lon: item.lng, 
                        weight: parsedWeight,
                        customer_name: custName,
                        phone: custPhone 
                    });

                    const popupContent = buildDropPopup(dropId, custName, custPhone, parsedWeight);

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
        window.activeRoutePlans = {}; // Reset enriched payloads
        window.activeDeploymentsMins = {};
        window.currentPhysicsEngine = {};
        window.currentMetrics = null;
        window.currentAssumptions = null;
        window.currentWarnings = [];
        window.lastTelemetry = {};
        window.routeSyncState = {};
        window.stopEvents = {};
        window.sessionMetricsCommitted = false; 
        
        if (typeof window.liveMarkers !== 'undefined') {
            for (let id in window.liveMarkers) {
                if (window.liveMarkers[id]._slideFrame) cancelAnimationFrame(window.liveMarkers[id]._slideFrame);
                if (window.map.hasLayer(window.liveMarkers[id])) window.map.removeLayer(window.liveMarkers[id]);
            }
            window.liveMarkers = {};
        }

        if (typeof window.liveFleetSocket !== 'undefined' && window.liveFleetSocket) {
            const closing = window.liveFleetSocket;
            window.liveFleetSocket = null;      // detach first so onclose does not auto-reconnect
            closing.close();
            console.log("📡 Live Fleet Telemetry: Connection reset by 'Clear Pins'");
        }

        const fleetList = document.getElementById('fleet-list');
        if (fleetList) fleetList.innerHTML = "";
        if (typeof window.updateBIMetrics === 'function') window.updateBIMetrics(false); 
        
        const reportContainer = document.getElementById("report-container");
        if (reportContainer) reportContainer.style.display = "none";
    };

    window.updateTelemetryUI = function(apiResponse) {
        const trafficMultiplier = apiResponse.traffic_multiplier || 1.0;
        const trafficText = document.getElementById('traffic-text');
        const indicator = document.getElementById('traffic-indicator');
        
        // The multiplier is a fixed time-of-day assumption in the API, not live traffic data.
        if (trafficText && indicator) {
            if (trafficMultiplier > 1.5) {
                trafficText.innerText = `Peak-Hour Factor Applied (${trafficMultiplier}x)`;
                indicator.className = "pulse-dot bg-red";
            } else {
                trafficText.innerText = `Standard Traffic Factor (${trafficMultiplier}x)`;
                indicator.className = "pulse-dot bg-green";
            }
        }

        const peRaw = apiResponse.physics_engine || {};
        const pe = {
            time_saved_mins: Number(peRaw.time_saved_mins) || 0,
            fuel_saved: Number(peRaw.fuel_saved) || 0,
            co2_saved: Number(peRaw.co2_saved) || 0,
            efficiency: Number(peRaw.efficiency) || 0
        };
        
        const timeSavedEl = document.getElementById('time-saved-val');
        const co2SavedEl = document.getElementById('co2-saved-val');
        
        if (timeSavedEl) timeSavedEl.innerText = `${pe.time_saved_mins.toFixed(1)} mins`;
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
                // was `cost_cost_per_km`, which the API ignores, so this van silently got cost_per_km = 1
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
                let errorBody = {};
                try { errorBody = await response.json(); } catch(e) {} 
                // 422 detail is an array; "Location N" is translated into the drop the dispatcher entered.
                const errorMsg = window.describeLocationErrors(window.formatApiError(errorBody, "Backend Routing Error"));

                if (response.status === 402) {
                    if(confirm(`💳 PAYMENT REQUIRED:\n\n${errorMsg}\n\nWould you like to renew your subscription now?`)) {
                        window.initiateSubscriptionRenewal();
                    }
                } else if (response.status === 401) {
                    alert(`❌ ACCESS DENIED:\n\n${errorMsg}`);
                    localStorage.removeItem('uyo_license_key');
                    window.location.href = "login.html";
                } else if (response.status === 429) {
                    alert("⚠️ Too many attempts. Please wait a few minutes and try again.");
                } else if (response.status === 400 && /valid sequence/i.test(errorMsg)) {
                    throw new Error("No feasible plan for these stops and vehicles.\n\nCheck parcel weights against vehicle capacity (a bike carries at most 10 stops) or choose a larger vehicle option.");
                } else {
                    throw new Error(errorMsg);
                }
                return; 
            }
            
            const data = await response.json();
            
            window.latestOptimizationResult = data;
            window.captureSolveResult(data);   // measured distances, assumptions and warnings from the API
            
            const peRaw = data.physics_engine || {};
            window.currentPhysicsEngine = {
                fuel_saved: Number(peRaw.fuel_saved) || 0,
                co2_saved: Number(peRaw.co2_saved) || 0,
                efficiency: Number(peRaw.efficiency) || 0
            };

            // "No fleet supplied" is expected when the dispatcher chose Mixed Fleet (Auto); show every other warning.
            (data.warnings || [])
                .filter(w => !(vehicleChoice === 'all' && /default fleet/i.test(w)))
                .forEach(w => window.showToast(w, 10000));
            
            window.updateTelemetryUI(data);
            
            window.routeLayerGroup.clearLayers(); 
            window.unassignedPinsLayer.clearLayers();
            window.activeDeployments = {}; 
            window.activeRoutePlans = {}; // Reset payloads
            window.activeDeploymentsMins = {};
            window.sessionMetricsCommitted = false; 

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
        const metaDict = {}; // NEW: Dictionary to map nodes to full customer details

        // Define the depot metadata
        locDict[0] = [payload.depot.lat, payload.depot.lon];
        locDict["0"] = [payload.depot.lat, payload.depot.lon];
        locDict['depot'] = [payload.depot.lat, payload.depot.lon];
        metaDict[0] = { id: 'DEPOT', customer_name: 'Command Center Depot', phone: 'N/A' };
        metaDict["0"] = metaDict[0];
        metaDict['depot'] = metaDict[0];
        
        payload.deliveries.forEach((d, idx) => {
            locDict[idx + 1] = [d.lat, d.lon];
            locDict[String(idx + 1)] = [d.lat, d.lon];
            locDict[d.id] = [d.lat, d.lon];

            // Store full customer objects based on array index
            metaDict[idx + 1] = d;
            metaDict[String(idx + 1)] = d;
            metaDict[d.id] = d;
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
            
            // OSRM is used ONLY to draw road geometry. The kilometres and minutes on the card come from the API
            // (measured on the same road network the plan was built on). If OSRM is unavailable the route is drawn as
            // straight lines so the mission can still be deployed (previously the vehicle vanished from the list).
            let routeCoords = null;
            let osrmDistanceKm = null;
            let osrmDurationMin = null;
            try {
                await new Promise(resolve => setTimeout(resolve, 800)); 
                let osrmData = null;

                try {
                    const res1 = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`);
                    if (res1.ok) osrmData = await res1.json();
                } catch (e1) { console.warn("Primary OSRM failed..."); }

                if (!osrmData || osrmData.code !== "Ok") {
                    try {
                        const res2 = await fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordStr}?overview=full&geometries=geojson`);
                        if (res2.ok) osrmData = await res2.json();
                    } catch (e2) { console.warn("Fallback OSRM failed..."); }
                }
                
                if (osrmData && osrmData.code === "Ok") {
                    osrmDistanceKm = osrmData.routes[0].distance / 1000;
                    osrmDurationMin = osrmData.routes[0].duration / 60;
                    routeCoords = osrmData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                }
            } catch (e) { 
                console.warn("Road geometry unavailable.", e);
            }

            const straightLinePreview = !routeCoords;
            if (straightLinePreview) routeCoords = gpsPath;

            const apiKm = Number(r.distance_km);
            const apiMin = Number(r.travel_time_min);
            const distanceKm = (Number.isFinite(apiKm) ? apiKm : (osrmDistanceKm ?? 0)).toFixed(2);
            const durationMin = (Number.isFinite(apiMin) ? apiMin : (osrmDurationMin ?? 0)).toFixed(1);

            // Maintain dense polyline for frontend interpolation logic
            window.activeDeployments[vId] = routeCoords;
            window.activeDeploymentsMins[vId] = parseFloat(durationMin);

            const routeLine = L.polyline(routeCoords, { color: color, weight: routeWeight, opacity: 0.9, pane: 'routePane', dashArray: straightLinePreview ? '6, 8' : null }).addTo(window.routeLayerGroup);
            
            // --- NEW: Map waypoints to the backend RouteWaypoint structure while rendering popups ---
            let currentRoutePlan = [];
            let sequenceCounter = 1;
            
            r.route.forEach((node, idx) => {
                const coords = locDict[node];
                const meta = metaDict[node] || { id: `DEPOT-${sequenceCounter}`, customer_name: 'Command Center Depot', phone: 'N/A' };

                if (coords) {
                    // Construct the dictionary expected by main.py
                    currentRoutePlan.push({
                        sequence: sequenceCounter,
                        lat: coords[0],
                        lng: coords[1],
                        customer_name: meta.customer_name || 'Depot',
                        phone: meta.phone || 'N/A',
                        order_id: meta.id || `ORD-${sequenceCounter}`
                    });

                    if (idx !== 0 && idx !== r.route.length - 1) {
                        // Dynamic UI Popup for drivers showing the mapped customer metadata (escaped: free text)
                        const popupHtml = `
                            <div style="text-align: center;">
                                <b style="color: #1f2937;">Drop-off: ${window.escapeHtml(meta.customer_name || 'Unknown')}</b><br>
                                <span style="font-size: 11px; color: #4b5563;">📞 ${window.escapeHtml(meta.phone || 'N/A')}</span><br>
                                <span style="font-size: 10px; font-weight: bold; color: #28a745;">Order ID: ${window.escapeHtml(meta.id)}</span>
                            </div>
                        `;

                        L.marker(coords, { 
                            icon: L.divIcon({ className: 'seq', html: `<div style="background: white; color: ${color}; border: 2.5px solid ${color}; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">${sequenceCounter}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), 
                            pane: 'poiPane' 
                        }).addTo(window.routeLayerGroup).bindPopup(popupHtml);
                    }
                    sequenceCounter++;
                }
            });

            // Store the strictly formatted structured dictionaries to push to the backend
            window.activeRoutePlans[vId] = currentRoutePlan;

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
                const safeId = window.escapeHtml(vId);
                const previewNote = straightLinePreview
                    ? `<p class="text-[10px] text-orange-400 mb-2">Straight-line preview: road geometry unavailable</p>` : '';
                fleetList.innerHTML += `<div class="p-4 bg-gray-800 rounded-xl border-l-4 mb-3 shadow-xl" style="border-color: ${color}">
                    <div class="flex justify-between items-start mb-2">
                        <p class="text-[10px] font-black uppercase text-gray-500 tracking-tighter">${safeId} Active</p>
                        <span class="text-[10px] font-bold bg-gray-700 px-2 py-1 rounded text-blue-400">${durationMin} MIN</span>
                    </div>
                    <p class="text-white font-mono text-sm mb-3">${distanceKm} KM | ${dropsCount} Drops</p>
                    ${previewNote}
                    <button data-deploy-vehicle="${safeId}" onclick="window.deployMission('${safeId}', '${gmapsUrl}')" class="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow transition-colors flex items-center justify-center gap-2">
                        Deploy Live Mission
                    </button>
                    <button id="recalc-btn-${safeId}" onclick="window.triggerTrafficRecalculate('${safeId}')" class="w-full mt-2 py-2 bg-gray-700 hover:bg-orange-600 text-white text-xs font-bold rounded shadow transition-colors flex items-center justify-center gap-2">
                        <i class="fa-solid fa-code-merge"></i> Recalculate Traffic
                    </button>
                </div>`;
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
                const closing = window.liveFleetSocket;
                window.liveFleetSocket = null;      // detach first so onclose does not auto-reconnect
                closing.close();
                console.log("📡 Live Fleet Telemetry: Disconnected");
            }
            for (let id in window.liveMarkers) {
                if (window.liveMarkers[id]._slideFrame) cancelAnimationFrame(window.liveMarkers[id]._slideFrame);
                window.map.removeLayer(window.liveMarkers[id]);
            }
            window.liveMarkers = {};
        }
    });

    window.initiateSubscriptionRenewal = function() {
        // The server is the authority on what each payment buys (PAYSTACK_PLANS on the API, keyed by amount).
        // These figures are only used for the prompt text and must match that configuration.
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

        const licenseKey = localStorage.getItem('uyo_license_key');
        const handler = PaystackPop.setup({
            key: 'pk_live_e0c2402108448771f33bbe09670508ede2ad6a92',
            email: userEmail,
            amount: amountKobo,
            currency: "NGN",
            ref: 'UYO-' + Math.floor((Math.random() * 1000000000) + 1),
            // The licence key travels with the payment so the signed Paystack webhook can apply it even if this tab closes.
            metadata: { license_key: licenseKey },
            callback: function(response) {
                // Only the reference and key are sent: the API verifies the payment with Paystack and applies the plan itself.
                fetch(`${window.API_BASE_URL}/api/vrp/activate-license`, {
                    method: 'POST',
                    headers: window.authHeaders(),
                    body: JSON.stringify({ 
                        reference: response.reference, 
                        license_key: licenseKey
                    })
                })
                .then(async res => {
                    if (res.ok) {
                        alert(`✅ Plan Activated! Access extended by ${daysToAdd} day(s) with a ${stopLimit}-stop limit.`);
                        location.reload(); 
                    } else {
                        const body = await res.json().catch(() => ({}));
                        alert(`⚠️ Payment received, but activation failed: ${window.formatApiError(body, res.statusText)}\n\nKeep this payment reference and contact support: ${response.reference}`);
                    }
                })
                .catch(err => {
                    alert(`⚠️ Network error during activation verification. Keep this payment reference: ${response.reference}`);
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