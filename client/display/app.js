'use strict';

const frame = document.getElementById('slide-frame');
const statusEl = document.getElementById('status');

function showSlide(embedUrl, pageIndex) {
  // Append the slide number so Canva opens at the correct page.
  // embedUrl already contains ?embed so we chain with &slide=N (1-indexed).
  frame.src = `${embedUrl}&slide=${pageIndex + 1}`;
  statusEl.classList.add('hidden');
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

    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
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

    if (message.type === 'SHOW_SLIDE' && message.embedUrl) {
      showSlide(message.embedUrl, message.pageIndex ?? 0);

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

connect();
