'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  designs: [],
  continuation: null,       // pagination cursor from Canva
  selectedDesign: null,
  selectedPageIndex: null,
  preview: {
    url: null,              // final image URL once export is done
    pollTimer: null,        // setInterval handle for export polling
  },
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
const autoAdvanceToggle = document.getElementById('auto-advance-toggle');
const durationRow       = document.getElementById('duration-row');
const slideDurationInput = document.getElementById('slide-duration');
const embedModal      = document.getElementById('embed-modal');
const embedInput      = document.getElementById('embed-input');
const embedSaveBtn    = document.getElementById('embed-save-btn');
const embedCancelBtn  = document.getElementById('embed-cancel-btn');
const embedError      = document.getElementById('embed-error');
const pageButtons     = document.getElementById('page-buttons');
const previewArea     = document.getElementById('preview-area');
const previewLoading  = document.getElementById('preview-loading');
const previewError    = document.getElementById('preview-error');
const previewImg      = document.getElementById('preview-img');
const goLiveBtn       = document.getElementById('go-live-btn');
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
  cancelPreview();

  document.querySelectorAll('.design-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === design.id);
  });

  panelEmpty.classList.add('hidden');
  panelContent.classList.remove('hidden');

  panelTitle.textContent = design.title ?? 'Untitled';
  renderEmbedStatus(design);

  // Build page buttons
  const pageCount = design.page_count ?? 1;
  pageButtons.innerHTML = '';
  for (let i = 0; i < pageCount; i++) {
    const btn = document.createElement('button');
    btn.className = 'page-btn';
    btn.textContent = `Slide ${i + 1}`;
    btn.addEventListener('click', () => selectPage(i));
    pageButtons.appendChild(btn);
  }

  setPreviewState('empty');
  confirmFlash.classList.add('hidden');
  updateGoLiveBtn();
}

function selectPage(pageIndex) {
  state.selectedPageIndex = pageIndex;

  document.querySelectorAll('.page-btn').forEach((btn, i) => {
    btn.classList.toggle('selected', i === pageIndex);
  });

  confirmFlash.classList.add('hidden');
  startExportPreview(pageIndex);
}

// ─── Export & preview ─────────────────────────────────────────────────────────

async function startExportPreview(pageIndex) {
  cancelPreview();
  setPreviewState('loading');
  updateGoLiveBtn();

  try {
    const res = await fetch(`/api/designs/${state.selectedDesign.id}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIndex }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const exportId = data.job?.id;
    if (!exportId) throw new Error('No export job ID returned.');

    pollExport(exportId, pageIndex);
  } catch (err) {
    console.error('[controller] Export start error:', err);
    setPreviewState('error');
  }
}

function pollExport(exportId, pageIndex) {
  state.preview.pollTimer = setInterval(async () => {
    if (state.selectedPageIndex !== pageIndex) {
      cancelPreview();
      return;
    }

    try {
      const res = await fetch(`/api/designs/exports/${exportId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const job = data.job;
      if (!job) throw new Error('Unexpected export response.');

      if (job.status === 'success') {
        cancelPreview();
        const url = job.urls?.[0];
        if (!url) throw new Error('No URL in export result.');
        state.preview.url = url;
        setPreviewState('ready', url);
        updateGoLiveBtn();
      } else if (job.status === 'failed') {
        cancelPreview();
        setPreviewState('error');
      }
      // status === 'in_progress' → keep polling
    } catch (err) {
      console.error('[controller] Export poll error:', err);
      cancelPreview();
      setPreviewState('error');
    }
  }, 1500);
}

function cancelPreview() {
  if (state.preview.pollTimer) {
    clearInterval(state.preview.pollTimer);
    state.preview.pollTimer = null;
  }
  state.preview.url = null;
}

function setPreviewState(mode, url = null) {
  previewLoading.classList.add('hidden');
  previewError.classList.add('hidden');
  previewImg.classList.add('hidden');

  if (mode === 'loading') {
    previewLoading.classList.remove('hidden');
  } else if (mode === 'error') {
    previewError.classList.remove('hidden');
  } else if (mode === 'ready' && url) {
    previewImg.src = url;
    previewImg.classList.remove('hidden');
  }
}

// ─── Go Live ──────────────────────────────────────────────────────────────────

function updateGoLiveBtn() {
  goLiveBtn.disabled = !state.preview.url
    || !state.selectedDesign?.embedUrl
    || !state.wsConnected;
}

goLiveBtn.addEventListener('click', () => {
  if (!state.preview.url || !state.selectedDesign?.embedUrl || !state.ws || !state.wsConnected) return;

  state.ws.send(JSON.stringify({
    type: 'SHOW_SLIDE',
    designId: state.selectedDesign.id,
    pageIndex: state.selectedPageIndex,
    pageCount: state.selectedDesign.page_count ?? 1,
    embedUrl: state.selectedDesign.embedUrl,
    autoAdvance: state.autoAdvance,
    duration: state.slideDuration,
  }));

  const label = `${state.selectedDesign.title ?? 'Untitled'} — Slide ${state.selectedPageIndex + 1}`;
  currentLabel.textContent = label;
  currentlyDisp.classList.remove('hidden');
  state.currentlyDisplaying = { label };
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

// ─── Auto-advance controls ────────────────────────────────────────────────────

autoAdvanceToggle.addEventListener('change', () => {
  state.autoAdvance = autoAdvanceToggle.checked;
  durationRow.classList.toggle('hidden', !state.autoAdvance);
});

slideDurationInput.addEventListener('change', () => {
  const val = parseInt(slideDurationInput.value, 10);
  state.slideDuration = isNaN(val) || val < 1 ? 5 : Math.min(val, 120);
  slideDurationInput.value = state.slideDuration;
});

// ─── Load more / Refresh ──────────────────────────────────────────────────────

loadMoreBtn.addEventListener('click', () => fetchDesigns(true));
refreshBtn.addEventListener('click', () => fetchDesigns(false));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

init();
