'use strict';

const express = require('express');
const router = express.Router();
const canva = require('../canva');
const embedTokens = require('../embed-tokens');

// Middleware: require authentication for all design routes
router.use((req, res, next) => {
  if (!canva.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated. Visit /auth/login first.' });
  }
  next();
});

// GET /api/designs
// Lists the user's Canva designs (paginated), with stored embed URLs merged in
router.get('/', async (req, res) => {
  try {
    const { continuation } = req.query;
    const endpoint = continuation
      ? `/designs?continuation=${encodeURIComponent(continuation)}`
      : '/designs';
    const data = await canva.canvaRequest('GET', endpoint);

    // Attach stored embed URL to each design item
    const tokens = embedTokens.load();
    if (data.items) {
      data.items = data.items.map(design => ({
        ...design,
        embedUrl: tokens[design.id]
          ? `https://www.canva.com/design/${design.id}/${tokens[design.id]}/view?embed`
          : null,
      }));
    }

    res.json(data);
  } catch (err) {
    console.error('[designs] List error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/designs/exports/:exportId
// Polls the status of an export job
// IMPORTANT: must be defined before /:designId to avoid route shadowing
router.get('/exports/:exportId', async (req, res) => {
  try {
    const data = await canva.canvaRequest('GET', `/exports/${req.params.exportId}`);
    res.json(data);
  } catch (err) {
    console.error('[designs] Export poll error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/designs/:designId
// Gets design details including page count
router.get('/:designId', async (req, res) => {
  try {
    const data = await canva.canvaRequest('GET', `/designs/${req.params.designId}`);
    res.json(data);
  } catch (err) {
    console.error('[designs] Get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/designs/:designId/embed-token
// Saves the Canva public view token for a design so the display can iframe it.
// Body: { embedUrl: string } — accepts the full embed URL or the raw iframe HTML from Canva's Share → Embed dialog
router.post('/:designId/embed-token', (req, res) => {
  const { embedUrl } = req.body;
  if (!embedUrl) {
    return res.status(400).json({ error: 'embedUrl is required.' });
  }

  const viewToken = embedTokens.extractViewToken(embedUrl, req.params.designId);
  if (!viewToken) {
    return res.status(400).json({ error: 'Could not find a valid Canva view token. Make sure you\'re pasting the embed URL for this specific design.' });
  }

  embedTokens.save(req.params.designId, viewToken);

  const fullEmbedUrl = `https://www.canva.com/design/${req.params.designId}/${viewToken}/view?embed`;
  res.json({ embedUrl: fullEmbedUrl });
});

// POST /api/designs/:designId/export
// Triggers an export of a specific page as PNG
// Body: { pageIndex: number }
router.post('/:designId/export', async (req, res) => {
  const { pageIndex = 0 } = req.body;

  try {
    const exportJob = await canva.canvaRequest(
      'POST',
      '/exports',
      {
        design_id: req.params.designId,
        format: {
          type: 'png',
          pages: [pageIndex + 1], // Canva pages are 1-indexed
        },
      }
    );
    res.json(exportJob);
  } catch (err) {
    console.error('[designs] Export error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
