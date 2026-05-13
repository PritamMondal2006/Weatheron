let map;
let userMarker;
let heatLayer;
let markers = [];
let currentLayer = 0;
let userLat = 22.5726;
let userLng = 88.3639;
let centerMarker;
let zoneCircle;

// 🔑 WeatherAPI Key
const API_KEY = "eb58ff0428f74f66835134855260305";

// Cache last weather data for AI prediction
let lastWeatherData = null;

// Debounce weather prediction so rapid map moves don't spam Gemini
let predictionDebounceTimer = null;

// ICONS
const hospitalIcon = L.icon({
    iconUrl: 'https://www.clipartmax.com/png/small/28-280979_medical-logo-medical-cross-symbol-png.png',
    iconSize: [25, 25]
});

const waterIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/728/728093.png',
    iconSize: [30, 30]
});

// INIT
function initMap() {
    map = L.map('map').setView([userLat, userLng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
        .addTo(map);

    fetchWeather(userLat, userLng);

    centerMarker = L.marker([userLat, userLng])
        .addTo(map)
        .bindPopup("📍 Weather source location")
        .openPopup();

    let weatherTimeout;

    map.on("moveend", () => {
        clearTimeout(weatherTimeout);

        weatherTimeout = setTimeout(() => {
            const center = map.getCenter();
            userLat = center.lat;
            userLng = center.lng;

            if (centerMarker) {
                centerMarker.setLatLng([userLat, userLng]);
            }

            fetchWeather(userLat, userLng);
        }, 1000);
    });
}

// WEATHER FETCH — uses forecast endpoint so we get 3 future days for free
async function fetchWeather(lat, lng) {
    try {
        const url = `https://api.weatherapi.com/v1/forecast.json?key=${API_KEY}&q=${lat},${lng}&days=3&aqi=no`;
        const res = await fetch(url);
        const data = await res.json();

        console.log(data);
        lastWeatherData = data;

        displayWeather(data);
        checkAlerts(data);
        displayForecast(data);

        // Trigger Gemini forecast with debounce (1.5s after weather loads)
        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => fetchWeatherPrediction(data), 1500);

    } catch (err) {
        console.log("Weather error:", err);
    }
}

// 3-DAY FORECAST DISPLAY
function conditionEmoji(code) {
    if (code === 1000) return "☀️";
    if ([1003,1006,1009].includes(code)) return "⛅";
    if ([1030,1135,1147].includes(code)) return "🌫️";
    if ([1063,1180,1183,1186,1189,1192,1195,1240,1243,1246].includes(code)) return "🌧️";
    if ([1066,1114,1117,1210,1213,1216,1219,1222,1225,1255,1258].includes(code)) return "❄️";
    if ([1069,1072,1168,1171,1198,1201,1204,1207,1249,1252].includes(code)) return "🌨️";
    if ([1087,1273,1276,1279,1282].includes(code)) return "⛈️";
    if ([1150,1153,1168,1171].includes(code)) return "🌦️";
    return "🌤️";
}

function displayForecast(data) {
    if (!data.forecast || !data.forecast.forecastday) return;
    const days = data.forecast.forecastday;
    // index 0 = today, 1 = tomorrow, 2 = day after — free plan gives exactly 3 days
    const futureDays = days.slice(0, 3);
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    futureDays.forEach((day, i) => {
        const card = document.getElementById("fc-" + i);
        if (!card) return;

        const date     = new Date(day.date + "T00:00:00");
        const dayLabel = i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayNames[date.getDay()];
        const high     = Math.round(day.day.maxtemp_c);
        const low      = Math.round(day.day.mintemp_c);
        const rain     = day.day.daily_chance_of_rain + "%";
        const uv       = day.day.uv != null ? parseFloat(day.day.uv).toFixed(1) : "N/A";
        const condition = day.day.condition.text;
        const emoji    = conditionEmoji(day.day.condition.code);

        card.querySelector(".fc-day").textContent       = dayLabel;
        card.querySelector(".fc-icon").textContent      = emoji;
        card.querySelector(".fc-condition").textContent = condition;
        card.querySelector(".fc-high").textContent      = high + "°";
        card.querySelector(".fc-low").textContent       = low + "°";
        card.querySelector(".fc-rain").textContent      = "💧 " + rain + " rain";
        card.querySelector(".fc-uv").textContent        = "☀️ UV " + uv;

        const uvInfo = getUVInfo(parseFloat(uv));
        card.querySelector(".fc-uv").style.color = uvInfo.color;
    });
}

// DISPLAY WEATHER
function displayWeather(data) {
    const temp      = data.current.temp_c;
    const condition = data.current.condition.text;
    const feels     = data.current.feelslike_c;
    const humidity  = data.current.humidity;
    const wind      = data.current.wind_kph;
    const uv        = data.current.uv ?? null;
    const location  = data.location.name + ", " + data.location.region;

    document.getElementById("location-name").innerText = "📍 " + location;
    document.getElementById("temp").innerText          = "🌡 Temp: " + temp + "°C";
    document.getElementById("condition").innerText     = "🌥 " + condition;
    document.getElementById("feels").innerText         = "🌡️ Feels Like: " + feels + "°C";
    document.getElementById("humidity").innerText      = "💧 Humidity: " + humidity + "%";
    document.getElementById("wind").innerText          = "🌬 Wind: " + wind + " km/h";

    // ── UV Index display ──────────────────────────────
    displayUVIndex(uv);

    if (centerMarker) {
        centerMarker.bindPopup(`
            <b>📍 ${data.location.name}</b><br>
            🌡 ${temp}°C<br>
            🌥 ${condition}<br>
            💧 ${humidity}% humidity<br>
            ☀️ UV: ${uv !== null ? uv : "N/A"}
        `);
    }

    showHeatLayer(temp);

    if (zoneCircle) map.removeLayer(zoneCircle);

    let color;
    if (temp > 40) color = "red";
    else if (temp >= 30) color = "yellow";
    else color = "green";

    zoneCircle = L.circle([userLat, userLng], {
        radius: 2000,
        color: color,
        fillColor: color,
        fillOpacity: 0.3
    }).addTo(map);
}

// ── UV INDEX METER ────────────────────────────────────────
function getUVInfo(uv) {
    if (uv === null || uv === undefined) {
        return { category: "N/A", color: "#7ecfdf", barGradient: "#7ecfdf, #7ecfdf", pct: 0 };
    }
    const val = parseFloat(uv);
    if (val <= 2)  return { category: "Low — no protection needed",          color: "#4ade80", barGradient: "#4ade80, #22c55e",          pct: Math.round((val / 11) * 100) };
    if (val <= 5)  return { category: "Moderate — wear sunscreen",            color: "#fbbf24", barGradient: "#fbbf24, #f59e0b",          pct: Math.round((val / 11) * 100) };
    if (val <= 7)  return { category: "High — seek shade midday",             color: "#fb923c", barGradient: "#fb923c, #f97316",          pct: Math.round((val / 11) * 100) };
    if (val <= 10) return { category: "Very High — extra protection required", color: "#f87171", barGradient: "#f87171, #ef4444",         pct: Math.round((val / 11) * 100) };
    return             { category: "Extreme — avoid direct sun exposure",    color: "#c084fc", barGradient: "#c084fc, #a855f7",          pct: 100 };
}

function uvToSPF(uv) {
    // Standard dermatology formula: minimum SPF = UV index × 2 + 2
    // Rounded up to nearest common SPF value: 15, 20, 30, 50, 50+
    if (uv === null || uv === undefined || isNaN(uv)) return { min: "N/A", label: "SPF recommended" };
    const val = parseFloat(uv);
    const raw = Math.round(val * 2 + 2);
    let spf;
    if (raw <= 4)       spf = "None needed";
    else if (raw <= 15) spf = "SPF 15";
    else if (raw <= 20) spf = "SPF 20";
    else if (raw <= 30) spf = "SPF 30";
    else if (raw <= 50) spf = "SPF 50";
    else                spf = "SPF 50+";
    return spf;
}

function displayUVIndex(uv) {
    const info = getUVInfo(uv);
    const displayVal = (uv !== null && uv !== undefined) ? parseFloat(uv).toFixed(1) : "N/A";

    const badge = document.getElementById("uv-value-badge");
    badge.textContent = displayVal;
    badge.style.color = info.color;
    badge.style.background = info.color + "20";
    badge.style.border = `1px solid ${info.color}55`;

    const fill = document.getElementById("uv-bar-fill");
    fill.style.width = info.pct + "%";
    fill.style.background = `linear-gradient(90deg, ${info.barGradient})`;

    document.getElementById("uv-category").textContent = info.category;
    document.getElementById("uv-category").style.color = info.color;

    // SPF recommendation
    const spfEl = document.getElementById("uv-spf");
    const spf = uvToSPF(uv !== null && uv !== undefined ? parseFloat(uv) : null);
    spfEl.innerHTML = `<span class="spf-label">Recommended</span><span class="spf-value" style="color:${info.color}">${spf}</span>`;
}

// ── GEMINI WEATHER PREDICTION ────────────────────────────
async function fetchWeatherPrediction(data) {
    const predBox    = document.getElementById("weather-prediction");
    const loader     = document.getElementById("weather-prediction-loader");
    const textEl     = document.getElementById("weather-prediction-text");

    // Show box + loader
    predBox.style.display = "block";
    loader.style.display  = "flex";
    textEl.textContent    = "";

    const w = data.current;
    const loc = data.location.name + ", " + data.location.region;

    const prompt = `You are a concise weather forecaster. Given the current conditions below, write a SHORT 2-sentence forecast for the next 1–3 hours. Be specific and actionable. No markdown, no bullet points, plain text only.

Location: ${loc}
Temperature: ${w.temp_c}°C (feels like ${w.feelslike_c}°C)
Condition: ${w.condition.text}
Humidity: ${w.humidity}%
Wind: ${w.wind_kph} km/h
UV Index: ${w.uv ?? "N/A"}
Cloud Cover: ${w.cloud}%
Precipitation (mm): ${w.precip_mm}

Respond with 2 plain sentences only.`;

    try {
        const raw = await callGemini(prompt);
        // Strip any accidental markdown
        const clean = raw.replace(/[*_`#]/g, "").trim();
        loader.style.display = "none";
        textEl.textContent   = clean;
    } catch (err) {
        loader.style.display = "none";
        textEl.textContent   = "⚠️ Forecast unavailable.";
        console.error("Weather prediction error:", err);
    }
}

// ALERT WEATHER
function checkAlerts(data) {
    const temp      = data.current.temp_c;
    const condition = data.current.condition.text.toLowerCase();

    let message = "";

    if (temp > 40) message = "🔥 Heatwave Alert!";
    if (condition.includes("rain")) message = "🌧 Rain Alert!";

    document.getElementById("alert-box").innerText = message;

    if (message) {
        if (Notification.permission === "granted") {
            new Notification(message);
        } else {
            Notification.requestPermission();
        }
    }
}

// LOCATION
function getCurrentLocation() {
    navigator.geolocation.getCurrentPosition(pos => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;

        if (userMarker) map.removeLayer(userMarker);

        userMarker = L.marker([userLat, userLng]).addTo(map)
            .bindPopup("You are here").openPopup();

        map.flyTo([userLat, userLng], 15);

        searchNearby(userLat, userLng);
        fetchWeather(userLat, userLng);
    });
}

// LAYERS
function toggleLayer(layer) {
    currentLayer = layer;

    document.querySelectorAll("button").forEach((btn, i) => {
        btn.classList.toggle("active", i === layer);
    });

    searchNearby(userLat, userLng);
}

function searchNearby(lat, lng) {
    clearAll();
    if (currentLayer === 0) return showHeatLayer();
    if (currentLayer === 1) fetchHospitals(lat, lng);
}

// HEATMAP
function showHeatLayer(temp = 30) {
    clearAll();

    let gradient;

    if (temp > 40) {
        gradient = { 0.4: "red", 0.7: "darkred", 1.0: "black" };
    } else if (temp >= 30) {
        gradient = { 0.4: "yellow", 0.7: "orange", 1.0: "red" };
    } else {
        gradient = { 0.4: "green", 0.7: "lime", 1.0: "yellow" };
    }

    const heatPoints = [
        [userLat, userLng, 1],
        [userLat + 0.01, userLng + 0.01, 0.8],
        [userLat - 0.01, userLng - 0.01, 0.9]
    ];

    heatLayer = L.heatLayer(heatPoints, {
        radius: 50,
        blur: 30,
        gradient: gradient
    }).addTo(map);
}

// HOSPITALS
async function fetchHospitals(lat, lng) {
    clearAll();

    const query = `
        [out:json];
        node["amenity"="hospital"](around:8000, ${lat}, ${lng});
        out body;
    `;

    try {
        const res = await fetch("https://overpass-api.de/api/interpreter", {
            method: "POST",
            body: query
        });

        const data = await res.json();

        data.elements.forEach(place => {
            const name = place.tags?.name || "Hospital";
            let address = [
                place.tags?.["addr:housename"],
                place.tags?.["addr:housenumber"],
                place.tags?.["addr:street"],
                place.tags?.["addr:suburb"],
                place.tags?.["addr:city"]
            ].filter(Boolean).join(", ");

            if (!address && place.tags?.["addr:postcode"]) address = "Pincode: " + place.tags["addr:postcode"];
            if (!address) address = place.tags?.name + " (Location approx)";
            if (!address) address = "Address not available";

            const phone     = place.tags?.phone || "No contact";
            const emergency = place.tags?.emergency ? "Yes" : "No";

            const marker = L.marker([place.lat, place.lon], { icon: hospitalIcon }).addTo(map);

            const popupHTML = `
                <div>
                    <b>${name}</b><br>
                    <button class="details-btn"
                     data-name="${name}"
                     data-lat="${place.lat}"
                     data-lon="${place.lon}"
                     data-phone="${phone}"
                     data-emergency="${emergency}">
                     View Details
                    </button>
                </div>
            `;

            marker.bindPopup(popupHTML);

            marker.on("popupopen", function (e) {
                const popupNode = e.popup.getElement();
                const btn = popupNode.querySelector(".details-btn");

                if (btn) {
                    btn.onclick = function () {
                        showDetails(
                            this.dataset.name,
                            this.dataset.lat,
                            this.dataset.lon,
                            this.dataset.phone,
                            this.dataset.emergency
                        );
                    };
                }
            });

            markers.push(marker);
        });

    } catch (err) {
        console.error("Error fetching hospitals:", err);
    }
}

// CLEAR
function clearAll() {
    if (heatLayer) map.removeLayer(heatLayer);
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    if (zoneCircle) map.removeLayer(zoneCircle);
}

// SHOW DETAILS
async function showDetails(name, lat, lon, phone, emergency) {
    const panel = document.getElementById("detailsPanel");

    panel.innerHTML = "<p style='color:black;'>Loading address...</p>";
    panel.style.display = "block";

    try {
        const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        const data = await res.json();

        panel.innerHTML = `
            <h3 style="color:black;">${name}</h3>
            <p style="color:black;"><b>Address:</b> ${data.display_name}</p>
            <p style="color:black;"><b>Phone:</b> ${phone}</p>
            <p style="color:black;"><b>Emergency:</b> ${emergency}</p>
        `;

    } catch {
        panel.innerHTML = `
            <h3 style="color:black;">${name}</h3>
            <p style="color:black;"><b>Address:</b> Not available</p>
            <p style="color:black;"><b>Phone:</b> ${phone}</p>
            <p style="color:black;"><b>Emergency:</b> ${emergency}</p>
        `;
    }
}

// ═══════════════════════════════════════════════════
// 🔑 GEMINI API KEY
// ═══════════════════════════════════════════════════
const GEMINI_API_KEY = "AIzaSyAWpLqmIZeBOBCp59FQw7GMTRlNfysW27o";
const GEMINI_MODEL   = "gemini-2.5-flash";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Shared Gemini call helper
async function callGemini(prompt) {
    const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.5,
                maxOutputTokens: 2048,
                responseMimeType: "text/plain"
            }
        })
    });
    const data = await res.json();
    if (data.error) throw new Error("Gemini API: " + data.error.message);
    if (!data.candidates || !data.candidates[0]) throw new Error("Gemini returned no candidates.");

    const parts = data.candidates[0].content.parts || [];
    const text  = parts.map(p => p.text || "").join("").trim();
    console.log("Gemini raw response:", text);
    return text;
}

// Robustly pull first JSON object from Gemini response
function extractJSON(text) {
    let clean = text.replace(/```json|```/gi, "");
    const start = clean.indexOf("{");
    const end   = clean.lastIndexOf("}");
    if (start === -1 || end === -1) {
        console.error("Raw Gemini text (no JSON found):", text);
        throw new Error("Gemini did not return JSON. See console for raw response.");
    }
    const jsonStr = clean.slice(start, end + 1);
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("JSON parse failed on:", jsonStr);
        throw new Error("JSON parse error: " + e.message);
    }
}

// ─────────────────────────────────────────────
// 🤖 AI RISK PREDICTION
// ─────────────────────────────────────────────

function openAIPanel() {
    document.getElementById("aiRiskPanel").classList.add("visible");
}

function closeAIPanel() {
    document.getElementById("aiRiskPanel").classList.remove("visible");
}

async function runAIPrediction() {
    openAIPanel();

    document.getElementById("aiLoader").style.display  = "flex";
    document.getElementById("aiResult").style.display  = "none";
    document.getElementById("aiIdle").style.display    = "none";

    if (!lastWeatherData) {
        showAIError("No weather data yet. Wait for the map to finish loading.");
        return;
    }

    const w = lastWeatherData;
    const inputPayload = {
        temperature:        w.current.temp_c,
        humidity:           w.current.humidity,
        wind_speed:         w.current.wind_kph,
        condition:          w.current.condition.text,
        uv_index:           w.current.uv ?? "N/A",
        air_quality:        "Moderate",
        crowd_density:      "Unknown",
        nearby_hospitals:   "Unknown",
        water_sources:      "Unknown",
        location:           `${w.location.name}, ${w.location.region}`
    };

    const prompt = `Analyze this weather data and respond with ONLY a raw JSON object. No explanation, no markdown, no code fences, no text before or after. Start your response with { and end with }.

Return this exact structure:
{"risk_level":"SAFE","risk_score":0,"main_threat":"","human_advice":[],"government_recommendation":[],"future_prediction":""}

Rules:
- risk_level must be one of: SAFE, MODERATE, HIGH, EXTREME
- risk_score must be a number from 0 to 100
- human_advice must be an array of 3 short strings
- government_recommendation must be an array of 2 short strings
- future_prediction must be one short sentence

Weather data to analyze:
${JSON.stringify(inputPayload)}

Respond with ONLY the JSON object, nothing else.`;

    try {
        const rawText = await callGemini(prompt);
        const result  = extractJSON(rawText);
        renderAIResult(result, inputPayload.location);
    } catch (err) {
        console.error("AI Prediction error:", err);
        showAIError("AI prediction failed: " + err.message);
    }
}

function getRiskColor(level) {
    return { SAFE: "#4ade80", MODERATE: "#fbbf24", HIGH: "#fb923c", EXTREME: "#f87171" }[level] || "#7ecfdf";
}

function renderAIResult(r, location) {
    document.getElementById("aiLoader").style.display = "none";

    const color = getRiskColor(r.risk_level);
    const score = Math.min(100, Math.max(0, r.risk_score));

    const humanAdvice = (r.human_advice || []).map(a => `<li>${a}</li>`).join("");
    const govRec      = (r.government_recommendation || []).map(a => `<li>${a}</li>`).join("");

    document.getElementById("aiResult").innerHTML = `
        <p style="color:#7ecfdf; font-size:12px; margin: 0 0 10px;">📍 ${location}</p>

        <span class="risk-badge risk-${r.risk_level}">${r.risk_level}</span>

        <div class="risk-score-wrap">
            <div class="risk-score-label">
                <span>Risk Score</span>
                <span style="color:${color}; font-weight:700;">${score}/100</span>
            </div>
            <div class="risk-score-bar-bg">
                <div class="risk-score-bar-fill" style="width:${score}%; background: linear-gradient(90deg, #0a8095, ${color});"></div>
            </div>
        </div>

        <div class="ai-threat-tag">⚠️ ${r.main_threat}</div>

        <div class="ai-section-title">Human Safety Advice</div>
        <ul class="ai-list">${humanAdvice}</ul>

        <div class="ai-section-title">Government Recommendation</div>
        <ul class="ai-list">${govRec}</ul>

        <div class="ai-section-title">Next 1–3 Hour Prediction</div>
        <div class="ai-prediction-box">${r.future_prediction}</div>

        <button id="aiRunBtn" onclick="runAIPrediction()" style="margin-top:14px;">🔄 Re-analyze</button>
    `;

    document.getElementById("aiResult").style.display = "block";
}

function showAIError(msg) {
    document.getElementById("aiLoader").style.display = "none";
    document.getElementById("aiIdle").style.display   = "none";
    document.getElementById("aiResult").innerHTML     = `<div class="ai-error">⚠️ ${msg}</div>`;
    document.getElementById("aiResult").style.display = "block";
}

// ═══════════════════════════════════════════════════════════
// 💬 AI EMERGENCY CHATBOT
// ═══════════════════════════════════════════════════════════

let chatHistory   = [];
let chatOpen      = false;
let chatMinimized = false;
let isBotTyping   = false;
let voiceActive   = false;
let recognition   = null;

// ── Open / Close / Minimize ──────────────────────────────

function toggleChat() {
    if (!chatOpen) {
        openChat();
    } else if (chatMinimized) {
        unminimizeChat();
    } else {
        minimizeChat();
    }
}

function openChat() {
    chatOpen      = true;
    chatMinimized = false;
    const win = document.getElementById("chatWindow");
    win.classList.add("open");
    win.classList.remove("minimized");
    document.getElementById("chatBtnIcon").textContent = "💬";

    if (chatHistory.length === 0) {
        appendBotMessage(buildWelcomeMessage(), false);
    }

    scrollChatToBottom();
}

function closeChat() {
    chatOpen      = false;
    chatMinimized = false;
    document.getElementById("chatWindow").classList.remove("open", "minimized");
    document.getElementById("chatBtnIcon").textContent = "💬";
}

function minimizeChat() {
    chatMinimized = true;
    document.getElementById("chatWindow").classList.add("minimized");
    document.getElementById("chatBtnIcon").textContent = "💬";
}

function unminimizeChat() {
    chatMinimized = false;
    document.getElementById("chatWindow").classList.remove("minimized");
    scrollChatToBottom();
}

// ── Welcome message ──────────────────────────────────────

function buildWelcomeMessage() {
    let weather = "";
    if (lastWeatherData) {
        const w = lastWeatherData;
        weather = `\n📍 <b>${w.location.name}</b> · ${w.current.temp_c}°C · ${w.current.condition.text}`;
    }
    return `👋 Hi! I'm your <b>Emergency Assistant</b>, powered by Gemini 2.5 Flash.${weather}\n\nAsk me anything — heatwave tips, flood safety, nearest hospital, first aid, and more. Use the quick buttons above or type your question.`;
}

// ── Quick Actions ────────────────────────────────────────

function quickAction(text) {
    document.getElementById("chatInput").value = text;
    sendChatMessage();
}

// ── Send Message ─────────────────────────────────────────

async function sendChatMessage() {
    if (isBotTyping) return;

    const input = document.getElementById("chatInput");
    const raw   = input.value.trim();
    if (!raw) return;

    const userText = raw.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    input.value = "";

    appendUserMessage(userText);
    chatHistory.push({ role: "user", parts: [{ text: raw }] });

    showTyping(true);
    isBotTyping = true;

    try {
        const reply = await fetchChatReply(raw);
        showTyping(false);
        isBotTyping = false;

        const isEmergency = /emergency|sos|help|fire|flood|danger|dizzy|heat stroke|drowning/i.test(raw);
        appendBotMessage(reply, isEmergency);
        chatHistory.push({ role: "model", parts: [{ text: reply }] });

        speakText(reply);

    } catch (err) {
        showTyping(false);
        isBotTyping = false;
        appendBotMessage("⚠️ Sorry, I couldn't connect to the AI. Check your Gemini API key.", true);
        console.error("Chat error:", err);
    }
}

// ── Build context-aware prompt ───────────────────────────

function buildSystemContext() {
    let ctx = `You are WEATHERON's AI Emergency Assistant — a concise, calm, and authoritative disaster-safety chatbot.
You help users during heatwaves, floods, fires, storms, and medical emergencies.
Always be brief (3-6 lines), actionable, and empathetic.
Use bullet points for lists. Highlight critical warnings with ⚠️.
Never make up hospital names unless confirmed by real data.`;

    if (lastWeatherData) {
        const w = lastWeatherData;
        ctx += `

LIVE CONDITIONS RIGHT NOW:
- Location: ${w.location.name}, ${w.location.region}
- Temperature: ${w.current.temp_c}°C (feels like ${w.current.feelslike_c}°C)
- Humidity: ${w.current.humidity}%
- Wind: ${w.current.wind_kph} km/h
- Condition: ${w.current.condition.text}
- UV Index: ${w.current.uv ?? "N/A"}
- Coordinates: ${userLat.toFixed(4)}, ${userLng.toFixed(4)}

Use this real data in every relevant response.`;
    }

    return ctx;
}

async function fetchChatReply(userMessage) {
    const systemCtx = buildSystemContext();

    const contents = [
        { role: "user",  parts: [{ text: systemCtx + "\n\nUser: " + userMessage }] }
    ];

    if (chatHistory.length > 1) {
        const fullContents = [
            { role: "user",  parts: [{ text: systemCtx }] },
            { role: "model", parts: [{ text: "Understood. I'm ready to assist." }] },
            ...chatHistory
        ];
        const res = await fetch(GEMINI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: fullContents,
                generationConfig: { temperature: 0.75, maxOutputTokens: 512 }
            })
        });
        const data = await res.json();
        if (data.error) throw new Error("Gemini API: " + data.error.message);
        if (!data.candidates || !data.candidates[0]) throw new Error("Gemini returned no candidates.");
        return data.candidates[0].content.parts[0].text.trim();
    }

    return await callGemini(systemCtx + "\n\nUser question: " + userMessage);
}

// ── DOM Helpers ──────────────────────────────────────────

function appendUserMessage(text) {
    const area = document.getElementById("chatMessages");
    const row  = document.createElement("div");
    row.className = "chat-msg-row user";
    row.innerHTML = `
        <div>
            <div class="chat-bubble user">${text}</div>
            <div class="chat-timestamp">${getTime()}</div>
        </div>`;
    area.appendChild(row);
    scrollChatToBottom();
}

function appendBotMessage(text, isEmergency = false) {
    const area = document.getElementById("chatMessages");
    const row  = document.createElement("div");
    row.className = "chat-msg-row";

    const html = text
        .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
        .replace(/\n/g, "<br>");

    row.innerHTML = `
        <div class="chat-ai-avatar">🤖</div>
        <div>
            <div class="chat-bubble ai ${isEmergency ? 'emergency' : ''}">${html}</div>
            <div class="chat-timestamp">${getTime()}</div>
        </div>`;
    area.appendChild(row);
    scrollChatToBottom();
}

function showTyping(show) {
    document.getElementById("typingIndicator").style.display = show ? "flex" : "none";
    if (show) scrollChatToBottom();
}

function scrollChatToBottom() {
    const area = document.getElementById("chatMessages");
    setTimeout(() => { area.scrollTop = area.scrollHeight; }, 50);
}

function getTime() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Voice Input ──────────────────────────────────────────

function toggleVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert("Voice input not supported in this browser. Try Chrome.");
        return;
    }

    if (voiceActive) {
        recognition && recognition.stop();
        voiceActive = false;
        document.getElementById("voiceBtn").classList.remove("active");
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults  = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        voiceActive = true;
        document.getElementById("voiceBtn").classList.add("active");
    };

    recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        document.getElementById("chatInput").value = transcript;
        voiceActive = false;
        document.getElementById("voiceBtn").classList.remove("active");
        sendChatMessage();
    };

    recognition.onerror = recognition.onend = () => {
        voiceActive = false;
        document.getElementById("voiceBtn").classList.remove("active");
    };

    recognition.start();
}

// ── Voice Output ─────────────────────────────────────────

function speakText(text) {
    if (!window.speechSynthesis) return;

    const plain     = text.replace(/<[^>]+>/g, "");
    const max       = 200;
    const utterance = new SpeechSynthesisUtterance(plain.slice(0, max));
    utterance.lang  = "en-IN";
    utterance.rate  = 1;
    utterance.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

// SEARCH LOCATION
async function searchLocation() {
    const location = document.getElementById("location-input").value;
    if (!location) return;

    try {
        const url  = `https://nominatim.openstreetmap.org/search?format=json&q=${location}`;
        const res  = await fetch(url);
        const data = await res.json();

        if (data.length === 0) {
            alert("Location not found");
            return;
        }

        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);

        userLat = lat;
        userLng = lon;

        map.flyTo([lat, lon], 13);

        if (centerMarker) {
            centerMarker.setLatLng([lat, lon]);
        }

        fetchWeather(lat, lon);
        searchNearby(lat, lon);

    } catch (err) {
        console.log("Search error:", err);
    }
}

// AUTOCOMPLETE SEARCH
const input          = document.getElementById("location-input");
const suggestionsBox = document.getElementById("suggestions");

let searchTimeout;

input.addEventListener("input", () => {
    clearTimeout(searchTimeout);

    searchTimeout = setTimeout(async () => {
        const query = input.value.trim();

        if (query.length < 2) {
            suggestionsBox.style.display = "none";
            return;
        }

        try {
            const url  = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=5`;
            const res  = await fetch(url);
            const data = await res.json();

            suggestionsBox.innerHTML = "";

            if (data.length === 0) {
                suggestionsBox.style.display = "none";
                return;
            }

            data.forEach(place => {
                const item = document.createElement("div");
                item.className = "suggestion-item";
                item.innerText = place.display_name;

                item.onclick = () => {
                    input.value = place.display_name;
                    suggestionsBox.style.display = "none";

                    const lat = parseFloat(place.lat);
                    const lon = parseFloat(place.lon);

                    userLat = lat;
                    userLng = lon;

                    map.flyTo([lat, lon], 13);

                    if (centerMarker) {
                        centerMarker.setLatLng([lat, lon]);
                    }

                    fetchWeather(lat, lon);
                    searchNearby(lat, lon);
                };

                suggestionsBox.appendChild(item);
            });

            suggestionsBox.style.display = "block";

        } catch (err) {
            console.log("Autocomplete error:", err);
        }

    }, 500);
});

window.onload = initMap;
