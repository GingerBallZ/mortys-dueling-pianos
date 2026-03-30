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
design:meta:read         # Required for listing designs (discovered during setup)
asset:read               # Read assets/thumbnails
```

### Key Endpoints to Use
| Purpose | Endpoint |
|---|---|
| List user's designs | `GET /v1/designs` |
| Get design details + pages | `GET /v1/designs/{designId}` |
| Export/render a slide | `POST /v1/exports` (NOT `/designs/{id}/exports` — that endpoint no longer exists) |
| Get export result | `GET /v1/exports/{exportId}` |

### Export API Notes
- Endpoint is `POST /v1/exports` with body `{ design_id, format: { type: 'png', pages: [N] } }`
- Pages are **1-indexed**
- Export result URLs are at `job.urls[0]` (not `job.result.urls[0]`)

### Slide Display Strategy
- Controller previews use PNG exports (fast, reliable for browsing)
- Display uses a Canva iframe (`/watch?embed&slide=N`) so animations play natively
- Designs must be set to **"Anyone with the link can view"** in Canva for the iframe to load on the Fire TV (which is not authenticated with Canva)

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
- Avoid: heavy JS frameworks, Web Workers
- Use `document.documentElement.requestFullscreen()` on first user interaction
- Display page should have no UI chrome, no cursor, black background
- Display renders Canva slides via iframe (`/watch?embed`) — Canva handles all animations and transitions natively
- Controller preview uses static PNG exports only — animations are not needed or expected there

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

- [x] OAuth login flow + token storage
- [x] `GET /v1/designs` → display thumbnail grid on controller
- [x] Export a design page as PNG → display on TV
- [x] WebSocket: controller sends SHOW_SLIDE → display renders it
- [x] "Go Live" button with confirmation feedback
- [x] Token auto-refresh
- [x] Fire TV full-screen mode (triggered on WebSocket connect)
- [x] Slide buttons scrollable when design has many pages
- [x] Currently-displaying indicator on controller
- [x] Deployed to Railway at `https://mortys-dueling-pianos-production.up.railway.app`
- [x] Logout route (`/auth/logout`) clears tokens and redirects to login

---

## Known Bugs

### Canva animations not playing on display
- **Status:** Closed — not possible with Canva's current embed API
- **What's happening:** The display iframe loads the correct Canva slide but entrance animations and slide transitions do not play.
- **Root cause:** Canva's `?embed` parameter (required for anonymous iframing) suppresses presentation animations by design. All alternatives are blocked:
  - `/present?slide=N` — Canva's CSP (`frame-ancestors`) blocks it from being iframed entirely
  - `/view?embed&slide=N` — returns 403 Forbidden for anonymous viewers
  - `/watch?embed&slide=N` — only working option, but animations are suppressed
- **Resolution:** Staying on `/watch?embed&slide=N`. Animations would require Canva to expose a presentation-mode embed URL, which they currently do not.

---

## Backlog

### UI / Controller
- [ ] Forward and Back nav arrows in the controller to advance or return to the next/previous slide without tapping individual slide buttons
- [ ] Reduce vertical height of the Preview window; increase Slide Selection area accordingly
- [ ] Change scrollbar color to be more visible against dark background
- [ ] Make Preview image load faster (investigate pre-export on design select, or parallel export requests)

### Display / Show Control
- [ ] "End Show" button on controller: loads the "Waiting for controller..." screen on the display and exits fullscreen
- [ ] On "Go Live": enter fullscreen on the display device and hide the browser navigation bar
- [ ] On "Go Live": prevent display device screensaver / auto-screen-off from activating
- [ ] On "End Show": re-enable screensaver / auto-screen-off

### Future Enhancements
- Auto-advance mode (timer-based slideshow)
- Slide pre-caching for zero-latency transitions
- Set list integration (map songs to specific slides)
- Multiple display support (IMAG screens, confidence monitors)
- Offline mode with pre-downloaded slide cache
