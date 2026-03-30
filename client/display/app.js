'use strict';

const frame = document.getElementById('slide-frame');
const statusEl = document.getElementById('status');

// Auto-advance state
let autoAdvanceTimer = null;
let currentSlide = null; // { embedUrl, pageIndex, pageCount, autoAdvance, duration }

function showSlide(embedUrl, pageIndex, pageCount, autoAdvance, duration) {
  clearTimeout(autoAdvanceTimer);

  currentSlide = { embedUrl, pageIndex, pageCount, autoAdvance, duration };

  // Canva slide navigation: ?embed keeps animations, #N jumps to slide N (1-indexed).
  // The iframe height extension in CSS hides Canva's bottom navigation bar.
  frame.src = `${embedUrl}#${pageIndex + 1}`;
  statusEl.classList.add('hidden');

  if (autoAdvance && pageIndex < pageCount - 1) {
    // Start the timer after the slide finishes loading so each slide
    // gets its full display duration regardless of load time.
    frame.addEventListener('load', function onLoad() {
      const s = currentSlide;
      if (!s.autoAdvance) return;
      autoAdvanceTimer = setTimeout(() => {
        showSlide(s.embedUrl, s.pageIndex + 1, s.pageCount, true, s.duration);
      }, s.duration * 1000);
    }, { once: true });
  }
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
      showSlide(
        message.embedUrl,
        message.pageIndex ?? 0,
        message.pageCount ?? 1,
        message.autoAdvance ?? false,
        message.duration ?? 5,
      );

      ws.send(JSON.stringify({
        type: 'ACK',
        status: 'displayed',
        slideId: `${message.designId ?? 'unknown'}-${message.pageIndex ?? 0}`,
      }));
    }
  });

  ws.addEventListener('close', () => {
    console.warn('[display] Disconnected — retrying in 3s');
    clearTimeout(autoAdvanceTimer);
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
