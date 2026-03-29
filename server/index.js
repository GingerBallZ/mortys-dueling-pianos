'use strict';

require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { WebSocketServer } = require('ws');
const { handleConnection } = require('./ws/relay');

const app = express();
const server = http.createServer(app);

// --- Middleware ---

app.set('trust proxy', 1); // trust Railway's proxy for secure cookies
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' },
}));

// --- Static files ---

app.use('/controller', express.static(path.join(__dirname, '..', 'client', 'controller')));
app.use('/display', express.static(path.join(__dirname, '..', 'client', 'display')));

// --- Routes ---

app.use('/auth', require('./routes/auth'));
app.use('/api/designs', require('./routes/designs'));

// Root → redirect to controller
app.get('/', (req, res) => res.redirect('/controller'));

// --- WebSocket Server ---

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get('role');

  if (role !== 'controller' && role !== 'display') {
    console.warn('[ws] Connection rejected: unknown role', role);
    ws.close(1008, 'role parameter must be "controller" or "display"');
    return;
  }

  handleConnection(ws, role);
});

// --- Start ---

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  Controller: http://127.0.0.1:${PORT}/controller`);
  console.log(`  Display:    http://127.0.0.1:${PORT}/display`);
  console.log(`  Auth:       http://127.0.0.1:${PORT}/auth/login`);
});
