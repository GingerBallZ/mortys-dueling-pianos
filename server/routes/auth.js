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

// GET /auth/logout
// Clears stored tokens and redirects to login
router.get('/logout', (req, res) => {
  canva.clearTokens();
  res.redirect('/auth/login');
});

module.exports = router;
