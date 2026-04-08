'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  designs: [],
  continuation: null,       // pagination cursor from Canva
  selectedDesign: null,
  selectedPageIndex: null,
  thumbGeneration: 0,       // incremented on each design select to cancel stale loads
  thumbCache: {},           // { [designId]: { [pageIndex]: url } }
  countdownInterval: null,
  countdownRemaining: 0,
  showActive: false,        // true after Go Live, false after Stop
  showPaused: false,        // true after Pause, false after Resume/Stop
  activeDesignId: null,     // design currently on the display
  activePageIndex: null,    // page currently on the display
  currentlyDisplaying: null, // { label }
  ws: null,
  wsConnected: false,
  displayConnected: false,
  autoAdvance: false,
  slideDuration: 5,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const loginScreen     = document.getElementById('login-screen');
const mainEl          = document.getElementById('main');
const designGrid      = document.getElementById('design-grid');
const loadMoreRow     = document.getElementById('load-more-row');
const loadMoreBtn     = document.getElementById('load-more-btn');
const refreshBtn      = document.getElementById('refresh-btn');
const panelEmpty      = document.getElementById('panel-empty');
const panelContent    = document.getElementById('panel-content');
const panelTitle      = document.getElementById('panel-title');
const embedSection    = document.getElementById('embed-section');
const embedMsg        = document.getElementById('embed-msg');
const setEmbedBtn     = document.getElementById('set-embed-btn');
const autoAdvanceToggle    = document.getElementById('auto-advance-toggle');
const durationRow          = document.getElementById('duration-row');
const slideDurationSelect  = document.getElementById('slide-duration-select');
const slideDurationCustom  = document.getElementById('slide-duration-custom');
const countdownDisplay     = document.getElementById('countdown-display');
const embedModal      = document.getElementById('embed-modal');
const embedInput      = document.getElementById('embed-input');
const embedSaveBtn    = document.getElementById('embed-save-btn');
const embedCancelBtn  = document.getElementById('embed-cancel-btn');
const embedError      = document.getElementById('embed-error');
const pageButtons     = document.getElementById('page-buttons');
const slideNav        = document.getElementById('slide-nav');
// const prevBtn      = document.getElementById('prev-btn');  // commented out in HTML
// const nextBtn      = document.getElementById('next-btn');  // commented out in HTML
const slideNavLabel   = document.getElementById('slide-nav-label');
const goLiveBtn       = document.getElementById('go-live-btn');
const pauseBtn        = document.getElementById('pause-btn');
const stopBtn         = document.getElementById('stop-btn');
const confirmFlash    = document.getElementById('confirm-flash');
const wsStatus        = document.getElementById('ws-status');
const displayStatus   = document.getElementById('display-status');
const currentlyDisp   = document.getElementById('currently-displaying');
const currentLabel    = document.getElementById('current-label');

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const res = await fetch('/auth/status');
    const { authenticated } = await res.json();

    if (!authenticated) {
      loginScreen.classList.remove('hidden');
      return;
    }

    mainEl.classList.remove('hidden');
    connectWebSocket();
    await fetchDesigns();
  } catch (err) {
    console.error('[controller] Init error:', err);
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}?role=controller`;
  state.ws = new WebSocket(url);

  state.ws.addEventListener('open', () => {
    state.wsConnected = true;
    updateStatusPills();
    updateGoLiveBtn();
  });

  state.ws.addEventListener('close', () => {
    state.wsConnected = false;
    state.displayConnected = false;
    updateStatusPills();
    updateGoLiveBtn();
    setTimeout(connectWebSocket, 3000);
  });

  state.ws.addEventListener('error', (err) => {
    console.error('[ws] Error:', err);
  });

  state.ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'DISPLAY_CONNECTED') {
      state.displayConnected = true;
      updateStatusPills();
    }

    if (msg.type === 'DISPLAY_DISCONNECTED') {
      state.displayConnected = false;
      updateStatusPills();
    }

    if (msg.type === 'DISPLAY_CONFIRMED') {
      showConfirmFlash();
    }

    if (msg.type === 'SLIDE_ADVANCED') {
      state.activePageIndex = msg.pageIndex;
      state.selectedPageIndex = msg.pageIndex;
      if (state.autoAdvance) startCountdown(state.slideDuration);
      updateActiveOverlay();
      updateControlBtns();
      updateSlideNav();
    }
  });
}

function updateStatusPills() {
  wsStatus.textContent = state.wsConnected ? 'WS: Connected' : 'WS: Off';
  wsStatus.className = 'pill ' + (state.wsConnected ? 'pill--on' : 'pill--off');

  displayStatus.textContent = state.displayConnected ? 'Display: On' : 'Display: Off';
  displayStatus.className = 'pill ' + (state.displayConnected ? 'pill--on' : 'pill--warn');
}

// ─── Designs ──────────────────────────────────────────────────────────────────

async function fetchDesigns(append = false) {
  if (!append) {
    state.designs = [];
    state.continuation = null;
    designGrid.innerHTML = '<p class="placeholder">Loading designs…</p>';
  }

  try {
    const url = state.continuation
      ? `/api/designs?continuation=${encodeURIComponent(state.continuation)}`
      : '/api/designs';

    const res = await fetch(url);
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    const items = data.items ?? [];
    state.designs = append ? [...state.designs, ...items] : items;
    state.continuation = data.continuation ?? null;

    renderDesignGrid();
  } catch (err) {
    console.error('[controller] Fetch designs error:', err);
    designGrid.innerHTML = `<p class="placeholder" style="color:#c0392b">Error: ${err.message}</p>`;
  }
}

function renderDesignGrid() {
  designGrid.innerHTML = '';

  if (state.designs.length === 0) {
    designGrid.innerHTML = '<p class="placeholder">No designs found.</p>';
    loadMoreRow.classList.add('hidden');
    return;
  }

  for (const design of state.designs) {
    const card = buildDesignCard(design);
    designGrid.appendChild(card);
  }

  loadMoreRow.classList.toggle('hidden', !state.continuation);
}

function buildDesignCard(design) {
  const card = document.createElement('div');
  card.className = 'design-card';
  if (state.selectedDesign?.id === design.id) card.classList.add('selected');
  card.dataset.id = design.id;

  const thumbUrl = design.thumbnail?.url;
  const pageCount = design.page_count ?? 1;
  const dotClass = design.embedUrl ? 'embed-dot--ready' : 'embed-dot--missing';

  card.innerHTML = `
    ${thumbUrl
      ? `<img class="design-card__thumb" src="${thumbUrl}" alt="" loading="lazy">`
      : `<div class="design-card__thumb design-card__thumb--placeholder">🎹</div>`
    }
    <div class="design-card__info">
      <div class="design-card__name">${escapeHtml(design.title ?? 'Untitled')}</div>
      <div class="design-card__pages">${pageCount} page${pageCount !== 1 ? 's' : ''}<span class="embed-dot ${dotClass}"></span></div>
    </div>
  `;

  card.addEventListener('click', () => selectDesign(design));
  return card;
}

// ─── Slide panel ──────────────────────────────────────────────────────────────

function selectDesign(design) {
  state.selectedDesign = design;
  state.selectedPageIndex = null;

  document.querySelectorAll('.design-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === design.id);
  });

  panelEmpty.classList.add('hidden');
  panelContent.classList.remove('hidden');
  slideNav.classList.remove('hidden');

  panelTitle.textContent = design.title ?? 'Untitled';
  renderEmbedStatus(design);
  loadSlideThumbnails(design);

  confirmFlash.classList.add('hidden');
  updateGoLiveBtn();
  updateSlideNav();
}

function selectPage(pageIndex) {
  state.selectedPageIndex = pageIndex;

  document.querySelectorAll('.slide-thumb').forEach(thumb => {
    thumb.classList.toggle('selected', parseInt(thumb.dataset.page) === pageIndex);
  });

  confirmFlash.classList.add('hidden');
  updateGoLiveBtn();
  updateSlideNav();
}

// ─── Slide thumbnails ─────────────────────────────────────────────────────────

const THUMB_CONCURRENCY = 3; // max parallel export requests

function loadSlideThumbnails(design) {
  const gen = ++state.thumbGeneration;
  const pageCount = design.page_count ?? 1;
  const cache = state.thumbCache[design.id] ?? {};
  pageButtons.innerHTML = '';

  // Build all thumb elements immediately so the grid populates
  const pending = []; // { pageIndex, imgEl }
  for (let i = 0; i < pageCount; i++) {
    const thumb = buildSlideThumb(i);
    pageButtons.appendChild(thumb);
    const imgEl = thumb.querySelector('.slide-thumb__img');
    if (cache[i]) {
      imgEl.src = cache[i];
    } else {
      pending.push({ pageIndex: i, imgEl });
    }
  }

  updateActiveOverlay();

  if (pending.length > 0) {
    runThumbQueue(design.id, pending, gen);
  }
}

// Runs pending thumbnail loads with limited concurrency, then retries any
// that failed once the initial pass is complete.
async function runThumbQueue(designId, pending, gen) {
  const failed = [];
  let idx = 0;

  async function worker() {
    while (idx < pending.length) {
      if (state.thumbGeneration !== gen) return;
      const item = pending[idx++];
      const ok = await loadThumbnail(designId, item.pageIndex, item.imgEl, gen);
      if (!ok && state.thumbGeneration === gen) failed.push(item);
    }
  }

  // First pass — up to THUMB_CONCURRENCY parallel workers
  const workers = [];
  for (let w = 0; w < THUMB_CONCURRENCY; w++) workers.push(worker());
  await Promise.all(workers);

  // Retry pass — any slide that failed gets one more attempt, sequentially
  for (const item of failed) {
    if (state.thumbGeneration !== gen) return;
    await loadThumbnail(designId, item.pageIndex, item.imgEl, gen);
  }
}

function buildSlideThumb(pageIndex) {
  const div = document.createElement('div');
  div.className = 'slide-thumb';
  div.dataset.page = pageIndex;
  div.innerHTML = `
    <div class="slide-thumb__img-wrap">
      <img class="slide-thumb__img" alt="Slide ${pageIndex + 1}">
    </div>
    <span class="slide-thumb__label">Slide ${pageIndex + 1}</span>
  `;
  div.addEventListener('click', () => selectPage(pageIndex));
  return div;
}

// Returns true if the thumbnail loaded successfully, false otherwise.
async function loadThumbnail(designId, pageIndex, imgEl, gen) {
  try {
    const res = await fetch(`/api/designs/${designId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIndex }),
    });
    const data = await res.json();
    if (data.error || !data.job?.id) return false;

    const exportId = data.job.id;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 1500));
      if (state.thumbGeneration !== gen) return false; // design changed, abandon
      const pollRes = await fetch(`/api/designs/exports/${exportId}`);
      const pollData = await pollRes.json();
      const job = pollData.job;
      if (job?.status === 'success') {
        if (state.thumbGeneration !== gen) return false;
        const url = job.urls[0];
        if (!state.thumbCache[designId]) state.thumbCache[designId] = {};
        state.thumbCache[designId][pageIndex] = url;
        imgEl.src = url;
        return true;
      }
      if (job?.status === 'failed') return false;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Show controls ────────────────────────────────────────────────────────────

function updateActiveOverlay() {
  document.querySelectorAll('.slide-thumb').forEach(thumb => {
    const page = parseInt(thumb.dataset.page);
    const isActive = state.showActive
      && state.selectedDesign?.id === state.activeDesignId
      && page === state.activePageIndex;
    thumb.classList.toggle('slide-thumb--active', isActive);
  });
}

function updateControlBtns() {
  // Green button says "Resume" when paused and no different slide is selected
  const isResume = state.showPaused && (
    state.selectedPageIndex === null ||
    (state.selectedDesign?.id === state.activeDesignId &&
     state.selectedPageIndex === state.activePageIndex)
  );

  goLiveBtn.textContent = isResume ? 'Resume' : 'Go Live';

  const customDurationMissing = state.autoAdvance
    && slideDurationSelect.value === 'custom'
    && state.slideDuration <= 0;

  goLiveBtn.disabled = isResume
    ? !state.wsConnected
    : state.selectedPageIndex === null || !state.selectedDesign?.embedUrl || !state.wsConnected || customDurationMissing;

  pauseBtn.disabled = !state.showActive || state.showPaused || !state.wsConnected;
  stopBtn.disabled  = !state.showActive || !state.wsConnected;
}

function updateGoLiveBtn() { updateControlBtns(); }

function updateSlideNav() {
  if (!state.selectedDesign) return;
  const pageCount = state.selectedDesign.page_count ?? 1;
  const idx = state.selectedPageIndex;

  slideNavLabel.textContent = idx === null
    ? 'Select a slide, then tap Go Live'
    : `Slide ${idx + 1} of ${pageCount}`;

  prevBtn.disabled = idx === null || idx === 0;
  nextBtn.disabled = idx === null || idx >= pageCount - 1;
}

function sendShowSlide(design, pageIndex) {
  if (!state.ws || !state.wsConnected) return;

  state.ws.send(JSON.stringify({
    type: 'SHOW_SLIDE',
    designId: design.id,
    pageIndex,
    pageCount: design.page_count ?? 1,
    embedUrl: design.embedUrl,
    autoAdvance: state.autoAdvance,
    duration: state.slideDuration,
  }));

  state.activeDesignId = design.id;
  state.activePageIndex = pageIndex;
  state.showActive = true;
  state.showPaused = false;

  const label = `${design.title ?? 'Untitled'} — Slide ${pageIndex + 1}`;
  currentLabel.textContent = label;
  currentlyDisp.classList.remove('hidden');
  state.currentlyDisplaying = { label };

  if (state.autoAdvance) startCountdown(state.slideDuration);
  else clearCountdown();

  updateActiveOverlay();
  updateControlBtns();
  updateSlideNav();
}

function goToSlide(pageIndex) {
  selectPage(pageIndex);
  if (state.showActive && !state.showPaused && state.selectedDesign?.embedUrl && state.wsConnected) {
    sendShowSlide(state.selectedDesign, pageIndex);
  }
}

// prevBtn/nextBtn listeners commented out — buttons removed from HTML for now
// prevBtn.addEventListener('click', () => { ... });
// nextBtn.addEventListener('click', () => { ... });

goLiveBtn.addEventListener('click', () => {
  if (!state.ws || !state.wsConnected) return;

  const isResume = goLiveBtn.textContent === 'Resume';

  if (isResume) {
    const design = state.designs.find(d => d.id === state.activeDesignId);
    if (!design?.embedUrl) return;

    state.ws.send(JSON.stringify({
      type: 'SHOW_SLIDE',
      designId: design.id,
      pageIndex: state.activePageIndex,
      pageCount: design.page_count ?? 1,
      embedUrl: design.embedUrl,
      autoAdvance: state.autoAdvance,
      duration: state.slideDuration,
    }));

    state.showPaused = false;
    if (state.autoAdvance) resumeCountdown();
    updateControlBtns();
  } else {
    if (state.selectedPageIndex === null || !state.selectedDesign?.embedUrl) return;
    sendShowSlide(state.selectedDesign, state.selectedPageIndex);
  }
});

pauseBtn.addEventListener('click', () => {
  if (!state.ws || !state.wsConnected) return;
  state.ws.send(JSON.stringify({ type: 'PAUSE' }));
  state.showPaused = true;
  pauseCountdown();
  // Select the active slide thumb so Resume is immediately available
  if (state.selectedDesign?.id === state.activeDesignId) {
    selectPage(state.activePageIndex);
  } else {
    state.selectedPageIndex = state.activePageIndex;
    updateControlBtns();
  }
});

stopBtn.addEventListener('click', () => {
  if (!state.ws || !state.wsConnected) return;
  state.ws.send(JSON.stringify({ type: 'STOP' }));
  state.showActive = false;
  state.showPaused = false;
  state.activeDesignId = null;
  state.activePageIndex = null;
  currentlyDisp.classList.add('hidden');
  clearCountdown();
  updateActiveOverlay();
  updateControlBtns();
  updateSlideNav();
});

// ─── Embed URL setup ──────────────────────────────────────────────────────────

function renderEmbedStatus(design) {
  if (design.embedUrl) {
    embedMsg.textContent = 'Slideshow Verified';
    embedMsg.className = 'embed-msg configured';
    embedMsg.classList.remove('hidden');
    setEmbedBtn.textContent = 're-link';
    setEmbedBtn.className = 'btn btn--relink';
    slideNavLabel.classList.add('slide-nav-label--ready');
  } else {
    embedMsg.classList.add('hidden');
    setEmbedBtn.textContent = 'Set embed URL';
    setEmbedBtn.className = 'btn btn--secondary btn--sm';
    slideNavLabel.classList.remove('slide-nav-label--ready');
  }
}

setEmbedBtn.addEventListener('click', () => {
  embedInput.value = '';
  embedError.textContent = '';
  embedError.classList.add('hidden');
  embedModal.classList.remove('hidden');
  embedInput.focus();
});

embedCancelBtn.addEventListener('click', closeEmbedModal);

embedModal.addEventListener('click', (e) => {
  if (e.target === embedModal) closeEmbedModal();
});

embedSaveBtn.addEventListener('click', saveEmbedUrl);

embedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEmbedUrl();
});

function closeEmbedModal() {
  embedModal.classList.add('hidden');
}

async function saveEmbedUrl() {
  const input = embedInput.value.trim();
  if (!input) return;

  embedError.classList.add('hidden');
  embedSaveBtn.disabled = true;

  try {
    const res = await fetch(`/api/designs/${state.selectedDesign.id}/embed-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedUrl: input }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Update in-memory state for the selected design and the grid list
    state.selectedDesign.embedUrl = data.embedUrl;
    const inList = state.designs.find(d => d.id === state.selectedDesign.id);
    if (inList) inList.embedUrl = data.embedUrl;

    // Update card dot
    const card = document.querySelector(`.design-card[data-id="${state.selectedDesign.id}"]`);
    if (card) {
      const dot = card.querySelector('.embed-dot');
      if (dot) {
        dot.classList.remove('embed-dot--missing');
        dot.classList.add('embed-dot--ready');
      }
    }

    closeEmbedModal();
    renderEmbedStatus(state.selectedDesign);
    updateGoLiveBtn();
  } catch (err) {
    embedError.textContent = err.message;
    embedError.classList.remove('hidden');
  } finally {
    embedSaveBtn.disabled = false;
  }
}

// ─── Confirm flash ────────────────────────────────────────────────────────────

function showConfirmFlash() {
  confirmFlash.classList.remove('hidden');
  setTimeout(() => confirmFlash.classList.add('hidden'), 2500);
}

// ─── Countdown ────────────────────────────────────────────────────────────────

function startCountdown(seconds) {
  clearCountdown();
  state.countdownRemaining = seconds;
  countdownDisplay.classList.remove('hidden');
  renderCountdown();
  state.countdownInterval = setInterval(() => {
    if (state.countdownRemaining > 0) state.countdownRemaining--;
    renderCountdown();
  }, 1000);
}

function pauseCountdown() {
  clearInterval(state.countdownInterval);
  state.countdownInterval = null;
}

function resumeCountdown() {
  if (state.countdownInterval) return; // already running
  state.countdownInterval = setInterval(() => {
    if (state.countdownRemaining > 0) state.countdownRemaining--;
    renderCountdown();
  }, 1000);
}

function clearCountdown() {
  clearInterval(state.countdownInterval);
  state.countdownInterval = null;
  state.countdownRemaining = 0;
  countdownDisplay.classList.add('hidden');
}

function renderCountdown() {
  const m = Math.floor(state.countdownRemaining / 60);
  const s = state.countdownRemaining % 60;
  countdownDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Auto-advance controls ────────────────────────────────────────────────────

// Digit buffer for the right-to-left MM:SS input.
// Holds exactly 4 digits [m1, m2, s1, s2]; new digits shift in from the right.
let digitBuffer = [0, 0, 0, 0];

function digitBufferToDisplay() {
  return `${digitBuffer[0]}${digitBuffer[1]}:${digitBuffer[2]}${digitBuffer[3]}`;
}

function digitBufferToSeconds() {
  const mins = digitBuffer[0] * 10 + digitBuffer[1];
  const secs = digitBuffer[2] * 10 + digitBuffer[3];
  return mins * 60 + secs;
}

function resetDigitBuffer() {
  digitBuffer = [0, 0, 0, 0];
  slideDurationCustom.value = '00:00';
}

function commitDigitBuffer() {
  // Normalise seconds overflow (e.g. typing 0073 → 00:73 → 01:13)
  let mins = digitBuffer[0] * 10 + digitBuffer[1];
  let secs = digitBuffer[2] * 10 + digitBuffer[3];
  mins += Math.floor(secs / 60);
  secs = secs % 60;
  // Clamp to 60:00
  if (mins > 60 || (mins === 60 && secs > 0)) { mins = 60; secs = 0; }
  digitBuffer = [
    Math.floor(mins / 10), mins % 10,
    Math.floor(secs / 10), secs % 10,
  ];
  const formatted = digitBufferToDisplay();
  slideDurationCustom.value = formatted;
  const seconds = digitBufferToSeconds();
  state.slideDuration = seconds > 0 ? seconds : 0;
  updateGoLiveBtn();
}

autoAdvanceToggle.addEventListener('change', () => {
  state.autoAdvance = autoAdvanceToggle.checked;
  slideDurationSelect.disabled = !state.autoAdvance;
  if (state.autoAdvance && !slideDurationSelect.value) {
    slideDurationSelect.value = '30';
    slideDurationSelect.classList.add('has-value');
    state.slideDuration = 30;
  }
  if (!state.autoAdvance) {
    slideDurationCustom.classList.add('hidden');
    clearCountdown();
  }
  updateGoLiveBtn();
});

slideDurationSelect.addEventListener('change', () => {
  const val = slideDurationSelect.value;
  slideDurationSelect.classList.add('has-value');

  if (val === 'custom') {
    resetDigitBuffer();
    state.slideDuration = 0;
    slideDurationCustom.classList.remove('hidden');
    updateGoLiveBtn();
    // Delay focus slightly so iOS recognises the gesture chain
    setTimeout(() => slideDurationCustom.focus(), 50);
  } else {
    slideDurationCustom.classList.add('hidden');
    state.slideDuration = parseInt(val, 10);
    updateGoLiveBtn();
  }
});

// Right-to-left digit entry — intercept all keyboard input ourselves.
// keydown handles physical keyboards and most Android virtual keyboards.
slideDurationCustom.addEventListener('keydown', (e) => {
  if (e.key >= '0' && e.key <= '9') {
    e.preventDefault();
    digitBuffer.shift();
    digitBuffer.push(parseInt(e.key, 10));
    slideDurationCustom.value = digitBufferToDisplay();
    state.slideDuration = digitBufferToSeconds();
    updateGoLiveBtn();
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    digitBuffer.pop();
    digitBuffer.unshift(0);
    slideDurationCustom.value = digitBufferToDisplay();
    state.slideDuration = digitBufferToSeconds();
    updateGoLiveBtn();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    commitDigitBuffer();
    slideDurationCustom.blur();
  } else if (e.key !== 'Tab') {
    // Block all other keys (letters, symbols, etc.) except Tab
    e.preventDefault();
  }
});

// iOS Safari virtual keyboard fires 'input' events rather than keydown for
// digit keys. We read whatever the browser inserted, strip non-digits, feed
// each digit through the buffer, then restore our controlled display value.
slideDurationCustom.addEventListener('input', () => {
  const raw = slideDurationCustom.value.replace(/\D/g, '');
  // Restore display immediately so the browser doesn't show raw characters
  slideDurationCustom.value = digitBufferToDisplay();
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      digitBuffer.shift();
      digitBuffer.push(parseInt(ch, 10));
    }
  }
  slideDurationCustom.value = digitBufferToDisplay();
  state.slideDuration = digitBufferToSeconds();
  updateGoLiveBtn();
});

// Normalise on blur (handles seconds overflow)
slideDurationCustom.addEventListener('blur', () => {
  commitDigitBuffer();
});

// iOS Safari: ensure tapping the input always opens the keyboard, even after
// a prior programmatic blur. touchstart → explicit focus() re-arms it.
slideDurationCustom.addEventListener('touchstart', (e) => {
  e.preventDefault(); // prevent ghost click / double-fire
  slideDurationCustom.focus();
}, { passive: false });

// Dismiss keyboard when tapping outside the custom input on touch devices.
document.addEventListener('touchstart', (e) => {
  if (
    !slideDurationCustom.classList.contains('hidden') &&
    document.activeElement === slideDurationCustom &&
    !slideDurationCustom.contains(e.target)
  ) {
    slideDurationCustom.blur();
  }
}, { passive: true });

// ─── Load more / Refresh ──────────────────────────────────────────────────────

loadMoreBtn.addEventListener('click', () => fetchDesigns(true));
refreshBtn.addEventListener('click', () => fetchDesigns(false));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

init();
