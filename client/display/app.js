'use strict';

// --- Slide crossfade logic ---
// We keep two <img> layers (A and B). The visible one is "active".
// When a new slide arrives, we load it into the hidden layer, then swap.

const slideA = document.getElementById('slide-a');
const slideB = document.getElementById('slide-b');
const statusEl = document.getElementById('status');

let activeSlide = slideA;   // the currently visible layer
let inactiveSlide = slideB; // the hidden layer we load into

function showSlide(imageUrl) {
  // Load the new image into the hidden layer
  inactiveSlide.src = imageUrl;

  inactiveSlide.onload = () => {
    // Fade the new image in
    inactiveSlide.classList.add('visible');
    // Fade the old image out
    activeSlide.classList.remove('visible');
    // Hide status message once we have a slide
    statusEl.classList.add('hidden');

    // Swap roles for next transition
    [activeSlide, inactiveSlide] = [inactiveSlide, activeSlide];
  };

  inactiveSlide.onerror = () => {
    console.error('[display] Failed to load image:', imageUrl);
  };
}

// --- WebSocket connection ---

const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${location.host}?role=display`;

let ws = null;
let reconnectTimer = null;

function connect() {
  console.log('[display] Connecting to', WS_URL);
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    console.log('[display] Connected');
    statusEl.textContent = 'Connected — waiting for slide...';
    clearTimeout(reconnectTimer);

    // Request fullscreen on first successful connection
    // (must happen in response to a user gesture on some browsers,
    //  but Fire TV Silk allows it on page load after the WS opens)
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {
        // Silently ignore — fullscreen may require a user gesture
      });
    }
  });

  ws.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      console.warn('[display] Non-JSON message ignored');
      return;
    }

    console.log('[display] Received:', message.type);

    if (message.type === 'SHOW_SLIDE' && message.imageUrl) {
      showSlide(message.imageUrl);

      // Acknowledge back to the server
      ws.send(JSON.stringify({
        type: 'ACK',
        status: 'displayed',
        slideId: `${message.designId ?? 'unknown'}-${message.pageIndex ?? 0}`,
      }));
    }
  });

  ws.addEventListener('close', () => {
    console.warn('[display] Disconnected — retrying in 3s');
    statusEl.textContent = 'Connection lost — reconnecting...';
    statusEl.classList.remove('hidden');
    scheduleReconnect();
  });

  ws.addEventListener('error', (err) => {
    console.error('[display] WebSocket error:', err);
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 3000);
}

// Kick off
connect();
