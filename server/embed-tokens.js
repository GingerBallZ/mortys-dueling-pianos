'use strict';

const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, '..', '.embed-tokens.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(designId, viewToken) {
  const tokens = load();
  tokens[designId] = viewToken;
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
}

function get(designId) {
  return load()[designId] ?? null;
}

// Accepts a full Canva embed URL or pasted iframe HTML and extracts the view token.
// Expected URL shape: https://www.canva.com/design/{designId}/{viewToken}/view?...
// If designId is provided, validates that the URL belongs to that design.
function extractViewToken(input, designId) {
  const match = input.match(/\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/view/);
  if (!match) return null;
  if (designId && match[1] !== designId) return null;
  return match[2];
}

module.exports = { load, save, get, extractViewToken };
