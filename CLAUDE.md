# CLAUDE.md — Live Show Slide Controller

## Repository

- **Remote:** https://github.com/GingerBallZ/mortys-dueling-pianos
- **Main branch:** `main`

---

## Project Overview

A real-time web application for live stage performances. A **TV Display** (running on Amazon Fire TV via Silk browser) shows full-screen Canva slides on stage. A **Controller Interface** (running on an iPad) allows a sound tech to browse designs from a Canva account and push slides to the display on command.

No native apps. No app store. Just two browser tabs that stay in sync over a WebSocket connection.

---

## Architecture

```
[iPad Controller UI]  ──WebSocket──  [Node.js Server]  ──WebSocket──  [Fire TV Display UI]
        │                                    │
        └── Canva Connect API (OAuth) ───────┘
```

### Three Components

1. **`/server`** — Node.js + Express + WebSocket server. Handles Canva OAuth, serves both UIs, and relays slide commands between clients.
2. **`/client/controller`** — iPad-optimized web UI. Browse Canva designs, preview thumbnails, push a slide/deck to the display.
3. **`/client/display`** — Fire TV / TV-optimized web UI. Full-screen, no controls. Renders whatever it's told to show.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Server | Node.js + Express | Lightweight, good Canva SDK support |
| Real-time sync | `ws` (WebSocket library) | Simple, low-latency, no polling |
| Frontend | Vanilla HTML/CSS/JS or React | No build complexity needed for MVP |
| Canva integration | Canva Connect REST API (OAuth 2.0 PKCE) | Official API for listing/exporting designs |
| Hosting | Railway, Render, or Fly.io | Easy WebSocket support, free tiers available |
| Auth token storage | Server-side in `.env` / database | Tokens must NEVER be client-side |

---

## Key User Flows

### Setup (one-time)
1. Operator opens the server URL and authenticates with Canva via OAuth
2. Access token + refresh token are stored securely server-side
3. Token auto-refreshes before expiry (~4 hours)

### Live Show
1. Sound tech opens `yourapp.com/controller` on iPad
2. Fire TV operator (or auto-launch) opens `yourapp.com/display` on Fire TV Silk browser
3. Controller shows a grid of Canva design thumbnails
4. Sound tech taps a design or individual slide → previews it in a sidebar
5. Sound tech taps **"Go Live"** → WebSocket message fires → Display switches instantly
6. Display shows the slide full-screen (rendered via Canva export URL or iframe)

---

## Canva API Integration

### Authentication
- Use **OAuth 2.0 with PKCE** (Authorization Code flow)
- All token requests must come from the **backend** — never the browser (CORS will block it)
- Store `access_token` and `refresh_token` in server memory or a simple DB (e.g., SQLite)
- Implement token refresh logic before every API call

### Required API Scopes
```
design:content:read      # List and read user designs
asset:read               # Read assets/thumbnails
```

### Key Endpoints to Use
| Purpose | Endpoint |
|---|---|
| List user's designs | `GET /v1/designs` |
| Get design details + pages | `GET /v1/designs/{designId}` |
| Export/render a slide | `POST /v1/designs/{designId}/exports` |
| Get export result | `GET /v1/exports/{exportId}` |

### Slide Display Strategy
- Export individual pages as PNG or JPG for display (most reliable for TV)
- Or use Canva's shareable "present" link embedded in an iframe (simpler, but less control)
- Pre-fetch and cache export URLs for the next 2–3 slides during a show to avoid latency

---

## WebSocket Message Protocol

All messages are JSON over WebSocket.

```json
// Controller → Server: Switch to a specific slide
{ "type": "SHOW_SLIDE", "designId": "abc123", "pageIndex": 0, "imageUrl": "https://..." }

// Controller → Server: Switch to a full slideshow (auto-advance or manual)
{ "type": "SHOW_DECK", "designId": "abc123", "mode": "manual" }

// Server → Display: Relay the command
{ "type": "SHOW_SLIDE", "imageUrl": "https://...", "transition": "fade" }

// Display → Server: Acknowledge
{ "type": "ACK", "status": "displayed" }

// Server → Controller: Confirm display received it
{ "type": "DISPLAY_CONFIRMED", "slideId": "abc123-0" }
```

---

## Project File Structure

```
/
├── CLAUDE.md
├── package.json
├── .env.example
├── server/
│   ├── index.js            # Express app + WebSocket server
│   ├── canva.js            # Canva API client (auth, token refresh, API calls)
│   ├── routes/
│   │   ├── auth.js         # OAuth callback + token exchange
│   │   └── designs.js      # Proxy endpoints: list designs, export slides
│   └── ws/
│       └── relay.js        # WebSocket message routing logic
├── client/
│   ├── controller/
│   │   ├── index.html      # iPad controller UI
│   │   ├── style.css
│   │   └── app.js          # Design browser, slide selector, WebSocket client
│   └── display/
│       ├── index.html      # Fire TV display UI (full-screen)
│       ├── style.css       # Black background, centered image, no scrollbars
│       └── app.js          # WebSocket client, image swap logic, transitions
└── README.md
```

---

## Environment Variables

```bash
# .env
CANVA_CLIENT_ID=your_client_id
CANVA_CLIENT_SECRET=your_client_secret
CANVA_REDIRECT_URI=https://yourapp.com/auth/callback
SESSION_SECRET=random_long_string

# Stored after first OAuth login (not committed to git)
CANVA_ACCESS_TOKEN=
CANVA_REFRESH_TOKEN=
```

---

## Fire TV / Silk Browser Constraints

- Target screen resolution: **1920×1080**
- Silk browser supports: ES6+, WebSockets, CSS Flexbox/Grid, full-screen API
- Avoid: complex animations, heavy JS frameworks, Web Workers
- Use `document.documentElement.requestFullscreen()` on first user interaction
- Display page should be **completely static** — no UI chrome, no cursor, black background
- Test image transitions with CSS `opacity` transitions (most reliable on TV)

---

## iPad Controller UI Requirements

- Large tap targets (minimum 44×44px)
- Works in both orientations (landscape preferred for side-by-side thumbnail grid)
- Design grid: 2–3 columns of thumbnail cards
- Selected/queued slide should be clearly highlighted
- "Go Live" button should be prominent and distinct from browsing actions
- Show a small "Currently Displaying" indicator so tech knows what's on screen
- Low-latency feedback: button press should show confirmation within 200ms

---

## Development Workflow

```bash
# Install dependencies
npm install

# Run dev server (with nodemon)
npm run dev

# Controller available at:
http://127.0.0.1:3000/controller

# Display available at:
http://127.0.0.1:3000/display

# OAuth callback (must match Canva Developer Portal setting):
http://127.0.0.1:3000/auth/callback
```

> ⚠️ Use `127.0.0.1` not `localhost` — Canva's API has CORS issues with `localhost`.

---

## Deployment Notes

- Use **Railway** or **Render** for simplest WebSocket-compatible hosting
- Both the controller and display connect to the same server URL
- For live shows: ensure the venue's WiFi can handle the iPad and Fire TV on the same network
- Fire TV and iPad must be on the **same network** as the server, or server must be internet-hosted
- Recommend hosting on the internet (not LAN) for reliability at different venues

---

## Canva Developer Setup (One-Time)

1. Go to [canva.dev/docs/connect](https://www.canva.dev/docs/connect)
2. Create a new integration in the Developer Portal
3. Set integration type to **Public** (required for non-Enterprise accounts)
4. Add scopes: `design:content:read`, `asset:read`
5. Set redirect URI to match your `CANVA_REDIRECT_URI`
6. Note: Public integrations require Canva review before going live — for personal/internal use during development, the integration works in "development mode" without review

---

## MVP Checklist

- [ ] OAuth login flow + token storage
- [ ] `GET /v1/designs` → display thumbnail grid on controller
- [ ] Export a design page as PNG → display on TV
- [ ] WebSocket: controller sends SHOW_SLIDE → display renders it
- [ ] "Go Live" button with confirmation feedback
- [ ] Token auto-refresh
- [ ] Fire TV full-screen mode
- [ ] Basic fade transition between slides
- [ ] Currently-displaying indicator on controller

---

## Future Enhancements

- Auto-advance mode (timer-based slideshow)
- Slide pre-caching for zero-latency transitions
- Set list integration (map songs to specific slides)
- Multiple display support (IMAG screens, confidence monitors)
- Offline mode with pre-downloaded slide cache
