let map;
let userMarker;
let heatLayer;
let markers = [];
let currentLayer = 0;
let userLat = 22.5726;
let userLng = 88.3639;
let centerMarker;
let zoneCircle;

// 🔑 ADD YOUR API KEY HERE
const API_KEY = "eb58ff0428f74f66835134855260305";

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

    // Initial layers & weather
    fetchWeather(userLat, userLng);

    // 📍 Create center marker (weather source)
    centerMarker = L.marker([userLat, userLng])
        .addTo(map)
        .bindPopup("📍 Weather source location")
        .openPopup();

    // ⏱ Debounce variable
    let weatherTimeout;

    // 🔄 Update weather when map stops moving
    map.on("moveend", () => {
        clearTimeout(weatherTimeout);

        weatherTimeout = setTimeout(() => {
            const center = map.getCenter();

            userLat = center.lat;
            userLng = center.lng;

            // 📍 Move marker to new center
            if (centerMarker) {
                centerMarker.setLatLng([userLat, userLng]);
            }

            // 🌦 Fetch new weather
            fetchWeather(userLat, userLng);

        }, 1000); // 1 sec delay (safe for API)
    });
}

// WEATHER FETCH
async function fetchWeather(lat, lng) {
    try {
        const url = `https://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${lat},${lng}&aqi=no`;

        const res = await fetch(url);
        const data = await res.json();

        console.log(data); // DEBUG

        displayWeather(data);
        checkAlerts(data);

    } catch (err) {
        console.log("Weather error:", err);
    }
}

// DISPLAY WEATHER
function displayWeather(data) {
    const temp = data.current.temp_c;
    const condition = data.current.condition.text;

    const feels = data.current.feelslike_c;
    const humidity = data.current.humidity;
    const wind = data.current.wind_kph;

    const location = data.location.name + ", " + data.location.region;

    document.getElementById("location-name").innerText = "📍 " + location;
    document.getElementById("temp").innerText = "🌡 Temp: " + temp + "°C";
    document.getElementById("condition").innerText = "🌥 " + condition;

    document.getElementById("feels").innerText = "🌡️ Feels Like: " + feels + "°C";
    document.getElementById("humidity").innerText = "💧 Humidity: " + humidity + "%";
    document.getElementById("wind").innerText = "🌬 Wind: " + wind + " km/h";

    if (centerMarker) {
        centerMarker.bindPopup(`
            <b>📍 ${data.location.name}</b><br>
            🌡 ${temp}°C<br>
            🌥 ${condition}<br>
            💧 ${humidity}% humidity
        `)};
    
    showHeatLayer(temp);

    // remove old circle
    if (zoneCircle) {
        map.removeLayer(zoneCircle);
    }

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

//ALERT WEATHER
function checkAlerts(data) {
    const temp = data.current.temp_c;
    const condition = data.current.condition.text.toLowerCase();

    let message = "";  // ✅ DEFINE HERE

    if (temp > 40) {
        message = "🔥 Heatwave Alert!";
    }

    if (condition.includes("rain")) {
        message = "🌧 Rain Alert!";
    }

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
        fetchWeather(userLat, userLng); // 🔥 weather update
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
        gradient = {
            0.4: "red",
            0.7: "darkred",
            1.0: "black"
        };
    } else if (temp >= 30) {
        gradient = {
            0.4: "yellow",
            0.7: "orange",
            1.0: "red"
        };
    } else {
        gradient = {
            0.4: "green",
            0.7: "lime",
            1.0: "yellow"
        };
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

        // 👉 fallback 1: postcode
        if (!address && place.tags?.["addr:postcode"]) {
        address = "Pincode: " + place.tags["addr:postcode"];
        }

       // 👉 fallback 2: use name + area
       if (!address) {
       address = place.tags?.name + " (Location approx)";
       }

      // 👉 final fallback
      if (!address) {
      address = "Address not available";
      }
            const phone = place.tags?.phone || "No contact";
            const emergency = place.tags?.emergency ? "Yes" : "No";

            const marker = L.marker([place.lat, place.lon], {
                icon: hospitalIcon
            }).addTo(map);

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

            // ✅ FIXED EVENT HANDLING
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

            // ✅ KEEP THIS (important for clearing markers)
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
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        const data = await res.json();

        const address = data.display_name;

        panel.innerHTML = `
            <h3 style="color:black;">${name}</h3>
            <p style="color:black;"><b>Address:</b> ${address}</p>
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

window.onload = initMap;