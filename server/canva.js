'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CANVA_AUTH_URL = 'https://www.canva.com/api/oauth/authorize';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const CANVA_API_BASE = 'https://api.canva.com/rest/v1';
const TOKENS_FILE = path.join(__dirname, '..', '.tokens.json');

// --- Token Storage ---

let tokenCache = null;

function loadTokens() {
  if (tokenCache) return tokenCache;
  try {
    const raw = fs.readFileSync(TOKENS_FILE, 'utf8');
    tokenCache = JSON.parse(raw);
    return tokenCache;
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  tokenCache = tokens;
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
}

function clearTokens() {
  tokenCache = null;
  try { fs.unlinkSync(TOKENS_FILE); } catch { /* already gone */ }
}

// --- PKCE Helpers ---

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// --- OAuth Flow ---

/**
 * Returns the Canva authorization URL and the code_verifier to store in session.
 */
function getAuthorizationUrl() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.CANVA_CLIENT_ID,
    redirect_uri: process.env.CANVA_REDIRECT_URI,
    scope: 'design:content:read design:meta:read asset:read',
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
  });

  return {
    url: `${CANVA_AUTH_URL}?${params.toString()}`,
    codeVerifier,
    state,
  };
}

/**
 * Exchanges an authorization code for access + refresh tokens.
 */
async function exchangeCodeForTokens(code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.CANVA_REDIRECT_URI,
    code_verifier: codeVerifier,
    client_id: process.env.CANVA_CLIENT_ID,
    client_secret: process.env.CANVA_CLIENT_SECRET,
  });

  const response = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });

  return data;
}

/**
 * Refreshes the access token using the stored refresh token.
 */
async function refreshAccessToken() {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) throw new Error('No refresh token stored.');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: process.env.CANVA_CLIENT_ID,
    client_secret: process.env.CANVA_CLIENT_SECRET,
  });

  const response = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    clearTokens();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

/**
 * Returns a valid access token, refreshing if it expires within 5 minutes.
 */
async function getValidAccessToken() {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Not authenticated. Visit /auth/login first.');

  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() >= tokens.expires_at - fiveMinutes) {
    return refreshAccessToken();
  }

  return tokens.access_token;
}

/**
 * Makes an authenticated request to the Canva API.
 */
async function canvaRequest(method, endpoint, body = null) {
  const token = await getValidAccessToken();

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${CANVA_API_BASE}${endpoint}`, options);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva API error (${response.status}) ${endpoint}: ${text}`);
  }

  return response.json();
}

function isAuthenticated() {
  return loadTokens() !== null;
}

module.exports = {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getValidAccessToken,
  canvaRequest,
  isAuthenticated,
};
