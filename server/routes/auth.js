'use strict';

const express = require('express');
const router = express.Router();
const canva = require('../canva');

// GET /auth/login
// Generates PKCE params, stores code_verifier in session, redirects to Canva
router.get('/login', (req, res) => {
  const { url, codeVerifier, state } = canva.getAuthorizationUrl();
  req.session.codeVerifier = codeVerifier;
  req.session.oauthState = state;
  res.redirect(url);
});

// GET /auth/callback
// Canva redirects here after user approves. Exchanges code for tokens.
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`Canva OAuth error: ${error}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  if (state !== req.session.oauthState) {
    return res.status(400).send('OAuth state mismatch. Possible CSRF attempt.');
  }

  const { codeVerifier } = req.session;
  if (!codeVerifier) {
    return res.status(400).send('Missing code verifier. Please restart the login flow.');
  }

  // Clean up session values
  delete req.session.codeVerifier;
  delete req.session.oauthState;

  try {
    await canva.exchangeCodeForTokens(code, codeVerifier);
    res.redirect('/controller');
  } catch (err) {
    console.error('[auth] Token exchange failed:', err.message);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// GET /auth/status
// Returns current auth state (no token values exposed to client)
router.get('/status', (req, res) => {
  res.json({ authenticated: canva.isAuthenticated() });
});

// GET /auth/whoami
// Returns the Canva user ID and team ID of the authenticated user.
// Use this to get the user_id needed to add someone as a test user in the Canva Developer Portal.
router.get('/whoami', async (req, res) => {
  if (!canva.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated. Visit /auth/login first.' });
  }
  try {
    const data = await canva.canvaRequest('GET', '/users/me');
    res.json({ user_id: data.profile?.user_id ?? data.user_id, team_id: data.profile?.team_id ?? data.team_id, raw: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/logout
// Clears stored tokens and redirects to login
router.get('/logout', (req, res) => {
  canva.clearTokens();
  res.redirect('/auth/login');
});

module.exports = router;
