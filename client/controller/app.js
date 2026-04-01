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
const prevBtn         = document.getElementById('prev-btn');
const nextBtn         = document.getElementById('next-btn');
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

function loadSlideThumbnails(design) {
  const gen = ++state.thumbGeneration;
  const pageCount = design.page_count ?? 1;
  const cache = state.thumbCache[design.id] ?? {};
  pageButtons.innerHTML = '';

  for (let i = 0; i < pageCount; i++) {
    const thumb = buildSlideThumb(i);
    pageButtons.appendChild(thumb);
    const imgEl = thumb.querySelector('.slide-thumb__img');
    if (cache[i]) {
      imgEl.src = cache[i];
    } else {
      loadThumbnail(design.id, i, imgEl, gen);
    }
  }

  updateActiveOverlay();
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

async function loadThumbnail(designId, pageIndex, imgEl, gen) {
  try {
    const res = await fetch(`/api/designs/${designId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIndex }),
    });
    const data = await res.json();
    if (data.error || !data.job?.id) return;

    const exportId = data.job.id;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 1500));
      if (state.thumbGeneration !== gen) return; // design changed, abandon
      const pollRes = await fetch(`/api/designs/exports/${exportId}`);
      const pollData = await pollRes.json();
      const job = pollData.job;
      if (job?.status === 'success') {
        if (state.thumbGeneration !== gen) return;
        const url = job.urls[0];
        if (!state.thumbCache[designId]) state.thumbCache[designId] = {};
        state.thumbCache[designId][pageIndex] = url;
        imgEl.src = url;
        return;
      }
      if (job?.status === 'failed') return;
    }
  } catch {
    // silent fail — placeholder stays
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

  goLiveBtn.disabled = isResume
    ? !state.wsConnected
    : state.selectedPageIndex === null || !state.selectedDesign?.embedUrl || !state.wsConnected;

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

prevBtn.addEventListener('click', () => {
  if (state.selectedPageIndex === null || state.selectedPageIndex <= 0) return;
  goToSlide(state.selectedPageIndex - 1);
});

nextBtn.addEventListener('click', () => {
  if (!state.selectedDesign) return;
  const pageCount = state.selectedDesign.page_count ?? 1;
  if (state.selectedPageIndex === null || state.selectedPageIndex >= pageCount - 1) return;
  goToSlide(state.selectedPageIndex + 1);
});

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
    embedMsg.textContent = 'Embed configured';
    embedMsg.className = 'embed-msg configured';
    setEmbedBtn.textContent = 'Change';
  } else {
    embedMsg.textContent = 'No embed URL — display will not work';
    embedMsg.className = 'embed-msg missing';
    setEmbedBtn.textContent = 'Set embed URL';
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
});

slideDurationSelect.addEventListener('change', () => {
  const val = slideDurationSelect.value;
  slideDurationSelect.classList.add('has-value');

  if (val === 'custom') {
    slideDurationCustom.classList.remove('hidden');
    slideDurationCustom.value = '';
    slideDurationCustom.focus();
  } else {
    slideDurationCustom.classList.add('hidden');
    state.slideDuration = parseInt(val, 10);
  }
});

slideDurationCustom.addEventListener('change', () => {
  const result = applyCustomDuration(slideDurationCustom.value);
  if (result) {
    state.slideDuration = result.seconds;
    slideDurationCustom.value = result.formatted;
  } else {
    slideDurationCustom.value = '';
  }
});

// Parses a custom duration entry into { seconds, formatted }.
// Accepts 1–4 raw digits (padded from the right to MM:SS) or a colon
// format like "12:34". Returns null if the value contains non-numerals,
// is zero, or exceeds 6000 (i.e. greater than 60:00).
function applyCustomDuration(raw) {
  const val = raw.trim();
  if (!val) return null;

  let mins, secs, rawInt;

  if (/^(\d{1,2}):(\d{2})$/.test(val)) {
    // Already formatted as MM:SS
    const [m, s] = val.split(':').map(Number);
    rawInt = parseInt(String(m).padStart(2, '0') + String(s).padStart(2, '0'), 10);
    mins = m; secs = s;
  } else if (/^\d{1,4}$/.test(val)) {
    // 1–4 raw digits — pad from the right
    rawInt = parseInt(val, 10);
    const padded = val.padStart(4, '0');
    mins = parseInt(padded.slice(0, 2), 10);
    secs = parseInt(padded.slice(2), 10);
  } else {
    return null; // non-numeral or > 4 digits
  }

  if (rawInt > 6000) return null;

  // Normalise seconds overflow (e.g. 00:90 → 01:30)
  mins += Math.floor(secs / 60);
  secs = secs % 60;

  const seconds = mins * 60 + secs;
  if (seconds <= 0) return null;

  return {
    seconds,
    formatted: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
  };
}

// ─── Load more / Refresh ──────────────────────────────────────────────────────

loadMoreBtn.addEventListener('click', () => fetchDesigns(true));
refreshBtn.addEventListener('click', () => fetchDesigns(false));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

init();
