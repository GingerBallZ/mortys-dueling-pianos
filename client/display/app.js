'use strict';

const frame = document.getElementById('slide-frame');
const statusEl = document.getElementById('status');

// Build the Canva embed URL from the view_url returned by the API.
// The API returns a signed JWT URL (/api/design/{jwt}/...) which Canva permits
// in iframes. The public /design/{id} URL works in browser tabs but Canva
// sets stricter iframe headers on it and it 403s when embedded.
function buildEmbedUrl(viewUrl, pageIndex) {
  const base = viewUrl.replace(/\/(view|edit|watch|present).*$/, '');
  return `${base}/watch?embed&slide=${pageIndex + 1}`;
}

function showSlide(viewUrl, pageIndex) {
  const url = buildEmbedUrl(viewUrl, pageIndex);
  console.log('[display] Loading embed URL:', url);
  frame.src = url;
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

    if (message.type === 'SHOW_SLIDE' && message.viewUrl) {
      showSlide(message.viewUrl, message.pageIndex ?? 0);

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
