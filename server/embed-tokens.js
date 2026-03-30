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
function extractViewToken(input) {
  const match = input.match(/\/design\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)\/view/);
  return match ? match[1] : null;
}

module.exports = { load, save, get, extractViewToken };
