// StadiumFlow - Core Logic
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- CONFIGURATION MANAGEMENT ---
let GEMINI_API_KEY = localStorage.getItem('STADIUMFLOW_GEMINI_KEY') || "";

// Try to load from ignored local config if it exists (for local dev)
try {
    const localConfig = await import('./config.js').catch(() => null);
    if (localConfig && localConfig.CONFIG.GEMINI_API_KEY !== "YOUR_KEY_HERE") {
        GEMINI_API_KEY = localConfig.CONFIG.GEMINI_API_KEY;
    }
} catch (e) {
    // config.js not found, perfectly fine for public repo
}

document.addEventListener("DOMContentLoaded", () => {
    initMap();
    refreshQueues();
    simulateCrowdAlerts();
    registerServiceWorker();
    
    // Show settings if key is missing
    if (!GEMINI_API_KEY) {
        setTimeout(openSettings, 2000);
    }
});

// Register PWA Service Worker
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('StadiumFlow Service Worker Registered'))
            .catch(err => console.log('Service Worker Failed', err));
    }
}

// --- SETTINGS LOGIC ---
function openSettings() {
    const modal = document.getElementById('settings-modal');
    const input = document.getElementById('api-key-input');
    if (input) input.value = GEMINI_API_KEY;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

function saveSettings() {
    const input = document.getElementById('api-key-input');
    const newKey = input.value.trim();
    if (newKey) {
        GEMINI_API_KEY = newKey;
        localStorage.setItem('STADIUMFLOW_GEMINI_KEY', newKey);
        showToast("Configuration saved successfully!", "success");
        closeSettings();
    } else {
        showToast("Please enter a valid API key.", "danger");
    }
}

// --- DYNAMIC STADIUM MAP (Leaflet) ---
let map;
let heatLayer;

function initMap() {
    // Initializing map centered on a hypothetical stadium coordinates
    map = L.map('map').setView([34.0141, -118.2879], 16);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // Initial Heatmap - Representing initial crowd density at gates
    heatLayer = L.heatLayer([
        [34.015, -118.288, 0.5], // Gate A
        [34.013, -118.287, 0.2], // Gate B
        [34.0145, -118.289, 0.8] // Food Court (Dense)
    ], { radius: 35, blur: 20, maxZoom: 17 }).addTo(map);

    // Mock POIs (Points of Interest) in the stadium
    const pois = [
        { name: "Gate A (Main)", coords: [34.015, -118.288], type: "gate" },
        { name: "Gate B (VIP)", coords: [34.013, -118.287], type: "gate" },
        { name: "Food Court North", coords: [34.0145, -118.289], type: "food" },
        { name: "Restrooms South", coords: [34.0135, -118.286], type: "restroom" },
        { name: "Merchandise Tent", coords: [34.014, -118.2885], type: "merch" }
    ];

    pois.forEach(poi => {
        let iconEmoji = "📍";
        if (poi.type === 'gate') iconEmoji = "🚪";
        if (poi.type === 'food') iconEmoji = "🍔";
        if (poi.type === 'restroom') iconEmoji = "🚻";
        if (poi.type === 'merch') iconEmoji = "👕";

        const customIcon = L.divIcon({
            html: `<div style="font-size: 24px; text-shadow: 0 0 10px rgba(255,255,255,0.5);">${iconEmoji}</div>`,
            className: 'custom-leaflet-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        const marker = L.marker(poi.coords, { icon: customIcon }).addTo(map);
        marker.bindPopup(`<b>${poi.name}</b><br>Live Status: <span id="poi-status-${poi.name.replace(/\s+/g, '')}">Analyzing...</span>`);
    });
}

// --- LIVE QUEUE TRACKER ---
const locations = [
    { id: 1, name: 'Main Gate A', max: 60, current: 45, type: 'gate', coords: [34.015, -118.288] },
    { id: 2, name: 'Burger Stand North', max: 30, current: 10, type: 'food', coords: [34.0145, -118.289] },
    { id: 3, name: 'Restroom Block C', max: 15, current: 14, type: 'restroom', coords: [34.0135, -118.286] },
    { id: 4, name: 'Merch Lane East', max: 20, current: 5, type: 'merch', coords: [34.014, -118.2885] },
    { id: 5, name: 'VIP Entrance', max: 10, current: 1, type: 'gate', coords: [34.013, -118.287] },
];

function refreshQueues() {
    const container = document.getElementById('queues-list');
    if(!container) return;
    container.innerHTML = '';
    
    const heatData = [];

    locations.forEach(loc => {
        // Randomize current queue +/- 3
        const change = Math.floor(Math.random() * 7) - 3; 
        loc.current = Math.max(0, Math.min(loc.max, loc.current + change));
        
        const percentage = (loc.current / loc.max) * 100;
        let statusClass = 'good';
        let waitTimeValue = Math.ceil(loc.current * 1.5);
        let waitTimeStr = waitTimeValue + " min";

        if (percentage > 80) statusClass = 'bad';
        else if (percentage > 50) statusClass = 'medium';

        // Update heatmap intensity based on percentage
        heatData.push([...loc.coords, percentage / 100]);

        const itemHtml = `
            <div class="queue-item" role="listitem">
                <div class="queue-header">
                    <span class="queue-name">${loc.name}</span>
                    <span class="queue-time ${statusClass}" aria-label="Wait time ${waitTimeStr}">${waitTimeStr}</span>
                </div>
                <div class="progress-bar" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100">
                    <div class="progress-fill ${statusClass}" style="width: ${percentage}%"></div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', itemHtml);
        
        // Update popup status if marker exists
        const statusEl = document.getElementById(`poi-status-${loc.name.replace(/\s+/g, '')}`);
        if(statusEl) statusEl.textContent = waitTimeStr;
    });

    if (heatLayer) heatLayer.setLatLngs(heatData);
}

// Auto-refresh queues every 8 seconds
setInterval(refreshQueues, 8000);

// --- GEMINI AI ASSISTANT ---

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const rawMsg = input.value.trim();
    if (!rawMsg) return;

    const msg = sanitizeInput(rawMsg);
    appendMessage(msg, 'user');
    input.value = '';

    // Simulate AI "Thinking"
    const botMsgId = 'bot-' + Date.now();
    appendMessage('', 'bot', botMsgId, true);

    try {
        const response = await generateAIResponse(msg);
        updateBotMessage(botMsgId, response);
    } catch (error) {
        console.error("Gemini Error:", error);
        updateBotMessage(botMsgId, "I'm having trouble connecting to the flow engine. Make sure your API key is correct in Settings.");
    }
}

async function generateAIResponse(query) {
    if (!GEMINI_API_KEY) {
        return fallbackLogic(query);
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `You are StadiumFlow, an intelligent event coordinator. 
        You have access to real-time stadium telemetry. 
        Current State: ${JSON.stringify(locations)}. 
        Decision Criteria: Always recommend the location with the lowest wait time (current value). 
        Constraints: Stay in persona. Be concise. Use wait times in minutes (current * 1.5).`
    });

    const result = await model.generateContent(query);
    const response = await result.response;
    return response.text();
}

// Fallback logic for when API key is missing
function fallbackLogic(query) {
    const q = query.toLowerCase();
    const getBest = (type) => locations
        .filter(l => l.type === type)
        .sort((a, b) => a.current - b.current)[0];

    if (q.includes('food')) {
        const best = getBest('food');
        return `[Demo Mode] I recommend ${best.name}. Wait time: ${Math.ceil(best.current * 1.5)} min.`;
    }
    if (q.includes('restroom')) {
        const best = getBest('restroom');
        return `[Demo Mode] The ${best.name} is least congested (${Math.ceil(best.current * 1.5)} min wait).`;
    }
    return "I'm currently in demo mode. Please click the ⚙️ gear icon to enter your Gemini API key!";
}

function handleChatKeyPress(e) {
    if (e.key === 'Enter') sendChatMessage();
}

function sanitizeInput(text) {
    const temp = document.createElement('div');
    temp.textContent = text;
    return temp.innerHTML;
}

function appendMessage(text, sender, id = '', isTyping = false) {
    const history = document.getElementById('chat-history');
    if(!history) return;
    const div = document.createElement('div');
    div.className = `message ${sender}-message ${isTyping ? 'typing' : ''}`;
    if(id) div.id = id;
    div.innerHTML = `<article class="message-content">${text}</article>`;
    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
}

function updateBotMessage(id, text) {
    const msgDiv = document.getElementById(id);
    if(msgDiv) {
        msgDiv.classList.remove('typing');
        msgDiv.querySelector('.message-content').textContent = text;
    }
}

// Bind to window for HTML event handlers
window.refreshQueues = refreshQueues;
window.sendChatMessage = sendChatMessage;
window.handleChatKeyPress = handleChatKeyPress;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;

// --- CROWD ALERT SYSTEM ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    
    let icon = 'ℹ️';
    if(type === 'alert' || type === 'warning') icon = '⚠️';
    if(type === 'danger') icon = '🚨';
    if(type === 'success') icon = '✅';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 5000);
}

function simulateCrowdAlerts() {
    setTimeout(() => {
        showToast("Heavy congestion near Restroom Block C. Routing optimized.", "warning");
    }, 5000);

    setTimeout(() => {
        showToast("halftime show starts in 10 minutes. Use North corridors.", "info");
    }, 15000);
}
