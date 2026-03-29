'use strict';

const express = require('express');
const router = express.Router();
const canva = require('../canva');

// Middleware: require authentication for all design routes
router.use((req, res, next) => {
  if (!canva.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated. Visit /auth/login first.' });
  }
  next();
});

// GET /api/designs
// Lists the user's Canva designs (paginated)
router.get('/', async (req, res) => {
  try {
    const { continuation } = req.query;
    const endpoint = continuation
      ? `/designs?continuation=${encodeURIComponent(continuation)}`
      : '/designs';
    const data = await canva.canvaRequest('GET', endpoint);
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
