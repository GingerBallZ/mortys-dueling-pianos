'use strict';

const frame = document.getElementById('slide-frame');
const statusEl = document.getElementById('status');
const fsPrompt = document.getElementById('fs-prompt');

// Auto-hide cursor after 3 seconds of inactivity — only active once fullscreen is entered
let cursorTimer = null;

function enableCursorAutoHide() {
  document.addEventListener('mousemove', () => {
    document.body.style.cursor = '';
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => { document.body.style.cursor = 'none'; }, 3000);
  });
}

let autoAdvanceTimer = null;
let currentSlide = null;
let currentEmbedUrl = null; // which design is loaded in embed mode

function showSlide(embedUrl, pageIndex, pageCount, autoAdvance, duration) {
  clearTimeout(autoAdvanceTimer);
  currentSlide = { embedUrl, pageIndex, pageCount, autoAdvance, duration };
  statusEl.classList.add('hidden');

  if (currentEmbedUrl !== embedUrl) {
    // New design — full page load to activate ?embed mode (suppresses Canva UI).
    currentEmbedUrl = embedUrl;
    frame.src = embedUrl; // loads view?embed at slide 1

    // After embed mode is active, navigate to the target slide via fragment.
    // The browser treats this as a same-page hash navigation (no reload),
    // so ?embed mode is preserved and the Canva UI stays hidden.
    frame.addEventListener('load', function () {
      navigateToSlide(pageIndex);
      scheduleAutoAdvance();
    }, { once: true });
  } else {
    // Same design already in embed mode — fragment navigation preserves it.
    navigateToSlide(pageIndex);
    scheduleAutoAdvance();
  }
}

function navigateToSlide(pageIndex) {
  // pageIndex 0 → strip hash (goes to slide 1, no reload)
  // pageIndex N → add #(N+1) hash fragment (goes to slide N+1, no reload)
  const target = pageIndex === 0
    ? currentEmbedUrl
    : `${currentEmbedUrl}#${pageIndex + 1}`;
  try {
    // Setting contentWindow.location.href cross-origin is allowed.
    // Same base URL + different fragment → treated as a fragment navigation,
    // not a full page reload, so embed mode state is preserved.
    frame.contentWindow.location.href = target;
  } catch {
    // Fallback: full reload. Embed mode won't be preserved but slide will be correct.
    frame.src = target;
  }
}

function scheduleAutoAdvance() {
  const s = currentSlide;
  if (!s.autoAdvance) return;

  autoAdvanceTimer = setTimeout(() => {
    if (currentSlide !== s) return; // superseded by a new SHOW_SLIDE message
    const next = s.pageIndex >= s.pageCount - 1 ? 0 : s.pageIndex + 1;
    currentSlide = { ...s, pageIndex: next };
    navigateToSlide(next);
    scheduleAutoAdvance();
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'SLIDE_ADVANCED', pageIndex: next }));
    }
  }, s.duration * 1000);
}

// --- Fullscreen prompt ---

function dismissPrompt() {
  fsPrompt.classList.add('hidden');
  enterFullscreen();
  enableCursorAutoHide();
}

['click', 'keydown', 'touchstart'].forEach(evt =>
  fsPrompt.addEventListener(evt, dismissPrompt, { once: true })
);

// --- Fullscreen ---

function enterFullscreen() {
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function exitFullscreen() {
  if (document.exitFullscreen && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

// --- Wake lock ---

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('[display] Wake lock request failed:', err.message);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Wake lock is auto-released when the tab loses visibility — re-acquire on return if show is active.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentSlide) {
    requestWakeLock();
  }
});

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

      enterFullscreen();
      requestWakeLock();

      ws.send(JSON.stringify({
        type: 'ACK',
        status: 'displayed',
        slideId: `${message.designId ?? 'unknown'}-${message.pageIndex ?? 0}`,
      }));
    }

    if (message.type === 'PAUSE') {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }

    if (message.type === 'STOP') {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
      currentSlide = null;
      currentEmbedUrl = null;
      frame.src = 'about:blank';
      statusEl.textContent = 'Connected — waiting for slide...';
      statusEl.classList.remove('hidden');
      exitFullscreen();
      releaseWakeLock();
    }
  });

  ws.addEventListener('close', () => {
    console.warn('[display] Disconnected — retrying in 3s');
    clearTimeout(autoAdvanceTimer);
    releaseWakeLock();
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
