'use strict';

// Tracks connected clients by role
const clients = {
  controller: null,
  display: null,
};

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function handleConnection(ws, role) {
  console.log(`[ws] ${role} connected`);
  clients[role] = ws;

  // Notify controller if display is already connected (or vice versa)
  if (role === 'controller' && clients.display) {
    send(ws, { type: 'DISPLAY_CONNECTED' });
  }
  if (role === 'display' && clients.controller) {
    send(clients.controller, { type: 'DISPLAY_CONNECTED' });
  }

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      console.warn('[ws] Non-JSON message ignored:', raw);
      return;
    }

    handleMessage(ws, role, message);
  });

  ws.on('close', () => {
    console.log(`[ws] ${role} disconnected`);
    clients[role] = null;

    if (role === 'display' && clients.controller) {
      send(clients.controller, { type: 'DISPLAY_DISCONNECTED' });
    }
  });

  ws.on('error', (err) => {
    console.error(`[ws] ${role} error:`, err.message);
  });
}

function handleMessage(ws, role, message) {
  console.log(`[ws] ${role} →`, message.type);

  switch (message.type) {
    // Controller → Display: show a single slide
    case 'SHOW_SLIDE': {
      if (role !== 'controller') break;
      send(clients.display, {
        type: 'SHOW_SLIDE',
        embedUrl: message.embedUrl,
        designId: message.designId,
        pageIndex: message.pageIndex,
        pageCount: message.pageCount,
        autoAdvance: message.autoAdvance ?? false,
        duration: message.duration ?? 5,
      });
      break;
    }

    // Controller → Display: pause auto-advance, hold current slide
    case 'PAUSE': {
      if (role !== 'controller') break;
      send(clients.display, { type: 'PAUSE' });
      break;
    }

    // Controller → Display: end show, return to waiting screen
    case 'STOP': {
      if (role !== 'controller') break;
      send(clients.display, { type: 'STOP' });
      break;
    }

    // Display → Controller: auto-advance moved to a new slide
    case 'SLIDE_ADVANCED': {
      if (role !== 'display') break;
      send(clients.controller, { type: 'SLIDE_ADVANCED', pageIndex: message.pageIndex });
      break;
    }

    // Display → Controller: acknowledge a slide was rendered
    case 'ACK': {
      if (role !== 'display') break;
      send(clients.controller, {
        type: 'DISPLAY_CONFIRMED',
        slideId: message.slideId,
        status: message.status,
      });
      break;
    }

    default:
      console.warn(`[ws] Unknown message type from ${role}:`, message.type);
  }
}

module.exports = { handleConnection };
