'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  designs: [],
  continuation: null,       // pagination cursor from Canva
  selectedDesign: null,
  selectedPageIndex: null,
  preview: {
    url: null,              // final image URL once export is done
    loading: false,
    error: false,
    pollTimer: null,        // setInterval handle for export polling
  },
  currentlyDisplaying: null, // { title, pageIndex }
  ws: null,
  wsConnected: false,
  displayConnected: false,
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
  });

  state.ws.addEventListener('close', () => {
    state.wsConnected = false;
    state.displayConnected = false;
    updateStatusPills();
    setTimeout(connectWebSocket, 3000); // auto-reconnect
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

  // Show "Load more" if there's a pagination cursor
  if (state.continuation) {
    loadMoreRow.classList.remove('hidden');
  } else {
    loadMoreRow.classList.add('hidden');
  }
}

function buildDesignCard(design) {
  const card = document.createElement('div');
  card.className = 'design-card';
  if (state.selectedDesign?.id === design.id) card.classList.add('selected');
  card.dataset.id = design.id;

  const thumbUrl = design.thumbnail?.url;
  const pageCount = design.page_count ?? 1;

  card.innerHTML = `
    ${thumbUrl
      ? `<img class="design-card__thumb" src="${thumbUrl}" alt="" loading="lazy">`
      : `<div class="design-card__thumb design-card__thumb--placeholder">🎹</div>`
    }
    <div class="design-card__info">
      <div class="design-card__name">${escapeHtml(design.title ?? 'Untitled')}</div>
      <div class="design-card__pages">${pageCount} page${pageCount !== 1 ? 's' : ''}</div>
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

  // Update selected highlight in grid
  document.querySelectorAll('.design-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === design.id);
  });

  panelEmpty.classList.add('hidden');
  panelContent.classList.remove('hidden');

  panelTitle.textContent = design.title ?? 'Untitled';

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

  // Reset preview
  setPreviewState('empty');
  goLiveBtn.disabled = true;
  confirmFlash.classList.add('hidden');
}

function selectPage(pageIndex) {
  state.selectedPageIndex = pageIndex;

  // Update page button highlights
  document.querySelectorAll('.page-btn').forEach((btn, i) => {
    btn.classList.toggle('selected', i === pageIndex);
  });

  goLiveBtn.disabled = true;
  confirmFlash.classList.add('hidden');
  startExportPreview(pageIndex);
}

// ─── Export & preview ─────────────────────────────────────────────────────────

async function startExportPreview(pageIndex) {
  cancelPreview(); // stop any previous poll
  setPreviewState('loading');

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
  // Poll every 1.5 seconds until the export is done
  state.preview.pollTimer = setInterval(async () => {
    // Bail out if the user has moved to a different page while polling
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
        goLiveBtn.disabled = false;
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

goLiveBtn.addEventListener('click', () => {
  if (!state.preview.url || !state.ws || !state.wsConnected) return;

  state.ws.send(JSON.stringify({
    type: 'SHOW_SLIDE',
    designId: state.selectedDesign.id,
    pageIndex: state.selectedPageIndex,
    imageUrl: state.preview.url,
    viewUrl: state.selectedDesign.urls?.view_url,
  }));

  // Update "currently displaying" in the header
  const label = `${state.selectedDesign.title ?? 'Untitled'} — Slide ${state.selectedPageIndex + 1}`;
  currentLabel.textContent = label;
  currentlyDisp.classList.remove('hidden');

  state.currentlyDisplaying = { label };
});

// ─── Confirm flash ────────────────────────────────────────────────────────────

function showConfirmFlash() {
  confirmFlash.classList.remove('hidden');
  setTimeout(() => confirmFlash.classList.add('hidden'), 2500);
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
