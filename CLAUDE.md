# CLAUDE.md — Live Show Slide Controller

## Repository

- **Remote:** https://github.com/GingerBallZ/mortys-dueling-pianos
- **Main branch:** `main`

---

## Project Overview

A real-time web application for live stage performances. A **TV Display** (running in a desktop browser on a laptop connected to the stage TV via HDMI) shows full-screen Canva slides on stage. A **Controller Interface** (running on an iPad) allows a sound tech to browse designs from a Canva account and push slides to the display on command.

No native apps. No app store. Just two browser tabs that stay in sync over a WebSocket connection.

---

## Architecture

```
[iPad Controller UI]  ──WebSocket──  [Node.js Server]  ──WebSocket──  [Laptop Display UI → HDMI → Stage TV]
        │                                    │
        └── Canva Connect API (OAuth) ───────┘
```

### Three Components

1. **`/server`** — Node.js + Express + WebSocket server. Handles Canva OAuth, serves both UIs, and relays slide commands between clients.
2. **`/client/controller`** — iPad-optimized web UI. Browse Canva designs, preview thumbnails, push a slide to the display.
3. **`/client/display`** — TV display web UI. Full-screen, no controls. Renders whatever it's told to show.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Server | Node.js + Express | Lightweight, good Canva SDK support |
| Real-time sync | `ws` (WebSocket library) | Simple, low-latency, no polling |
| Frontend | Vanilla HTML/CSS/JS | No build complexity needed for MVP |
| Canva integration | Canva Connect REST API (OAuth 2.0 PKCE) | Official API for listing/exporting designs |
| Hosting | Railway | Easy WebSocket support, auto-deploy from GitHub |
| Auth token storage | Server-side `.tokens.json` | Tokens must NEVER be client-side |
| Embed token storage | Server-side `.embed-tokens.json` | Per-design public view tokens |

---

## Key User Flows

### Setup (one-time per design)
1. Operator opens the server URL and authenticates with Canva via OAuth
2. Access token + refresh token are stored securely server-side
3. Token auto-refreshes before expiry (~4 hours)
4. For each design to be used in a show: open design in Canva → Share → Embed → copy iframe URL → paste into controller "Set embed URL" modal

### Live Show
1. Sound tech opens `yourapp.com/controller` on iPad
2. Display operator opens `yourapp.com/display` on the laptop connected to the stage TV via HDMI; clicks to enter fullscreen
3. Controller shows a grid of Canva design thumbnails (green dot = embed URL configured)
4. Sound tech taps a design → selects a slide → previews it as PNG in the sidebar
5. (Optional) Enable Auto-advance and set seconds-per-slide
6. Sound tech taps **"Go Live"** → WebSocket message fires → Display switches instantly
7. Display shows the slide full-screen via Canva iframe with animations playing

---

## Canva API Integration

### Authentication
- Use **OAuth 2.0 with PKCE** (Authorization Code flow)
- All token requests come from the **backend** — never the browser
- Store `access_token` and `refresh_token` in `.tokens.json` (gitignored)
- Token refresh happens automatically before every API call

### Required API Scopes
```
design:content:read      # List and read user designs
design:meta:read         # Required for listing designs
asset:read               # Read assets/thumbnails
```

### Key Endpoints
| Purpose | Endpoint |
|---|---|
| List user's designs | `GET /v1/designs` |
| Get design details + pages | `GET /v1/designs/{designId}` |
| Export/render a slide | `POST /v1/exports` |
| Get export result | `GET /v1/exports/{exportId}` |

### Export API Notes
- Endpoint is `POST /v1/exports` with body `{ design_id, format: { type: 'png', pages: [N] } }`
- Pages are **1-indexed**
- Export result URLs are at `job.urls[0]`

### Slide Display Strategy
- Controller previews use PNG exports (fast, reliable for browsing)
- Display uses a Canva iframe with the **public embed URL** format
- The `view_url` from the API is a JWE-encrypted session-tied URL — it is NOT used for display
- Designs must be set to **"Anyone with the link can view"** in Canva

---

## Canva Embed URL — Critical Findings

### The only working iframe format
```
https://www.canva.com/design/{designId}/{viewToken}/view?embed
```
- `{viewToken}` is a stable public token visible in Canva's Share → Embed dialog
- This token is **NOT available from the Canva Connect API** — must be obtained manually
- The design must be set to "Anyone with the link can view"

### Slide navigation
- Correct format: `view?embed#5` to start at slide 5 (bare number hash, 1-indexed)
- `?embed&slide=N` — ignored, always loads slide 1
- `?embed#slide=N` — breaks embed mode, shows Canva UI
- `view#N` (no `?embed`) — shows correct slide but Canva UI is always visible

### Embed mode + slide navigation (two-step approach)
The display uses a two-step strategy to get both embed mode (no UI) and the correct slide:
1. Load `view?embed` as a full page — activates embed mode (hides Canva UI)
2. Navigate to target slide via `frame.contentWindow.location.href = view?embed#N` — browser treats this as a same-page fragment navigation (no reload), preserving embed mode state

### What was investigated and ruled out
- `view_url` JWE from API — session-tied, 403s server-side anonymously; requires Canva browser session cookies
- `/api/design/{jwe}/watch?embed&slide=N` — was working before, breaks after re-auth (JWE invalidated)
- `/present?slide=N` — CSP `frame-ancestors` hard-blocks iframing entirely
- JWT payload — the JWE is encrypted with A256GCM; payload is not decodable
- Following `view_url` redirect server-side — 403s with and without Bearer token
- Canva's published embed `view?embed` with `&slide=N` — server ignores the parameter
- Hash format `#slide=N` — breaks embed mode (Canva's hash router interprets it differently)

### Per-design embed token setup
- Stored in `.embed-tokens.json` as `{ designId: viewToken }` map (gitignored)
- Server merges stored tokens into `GET /api/designs` response as `embedUrl` field
- Controller shows green/grey dot on each design card indicating token status
- `POST /api/designs/:designId/embed-token` — accepts paste of embed URL or iframe HTML, extracts and stores token

---

## WebSocket Message Protocol

All messages are JSON over WebSocket.

```json
// Controller → Server: Switch to a specific slide
{
  "type": "SHOW_SLIDE",
  "designId": "abc123",
  "pageIndex": 0,
  "pageCount": 25,
  "embedUrl": "https://www.canva.com/design/abc123/token/view?embed",
  "autoAdvance": false,
  "duration": 5
}

// Server → Display: Relay the command (same fields)

// Display → Server: Acknowledge
{ "type": "ACK", "status": "displayed", "slideId": "abc123-0" }

// Server → Controller: Confirm display received it
{ "type": "DISPLAY_CONFIRMED", "slideId": "abc123-0" }

// Server → Controller: Display connection events
{ "type": "DISPLAY_CONNECTED" }
{ "type": "DISPLAY_DISCONNECTED" }
```

---

## Project File Structure

```
/
├── CLAUDE.md
├── package.json
├── .env.example
├── .gitignore                  # includes .tokens.json and .embed-tokens.json
├── server/
│   ├── index.js                # Express app + WebSocket server
│   ├── canva.js                # Canva API client (auth, token refresh, API calls)
│   ├── embed-tokens.js         # Storage for per-design public view tokens
│   ├── routes/
│   │   ├── auth.js             # OAuth callback + token exchange
│   │   └── designs.js          # Proxy endpoints: list designs, export slides, save embed token
│   └── ws/
│       └── relay.js            # WebSocket message routing logic
├── client/
│   ├── controller/
│   │   ├── index.html          # iPad controller UI
│   │   ├── style.css
│   │   └── app.js              # Design browser, slide selector, embed URL setup, WebSocket client
│   └── display/
│       ├── index.html          # TV display UI (full-screen, desktop browser via HDMI)
│       ├── style.css           # Black background, cursor auto-hides, pointer-events none on iframe
│       └── app.js              # WebSocket client, two-step embed load, auto-advance logic
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
NODE_ENV=production
```

---

## Display Browser Requirements

- Target screen resolution: **1920×1080** (laptop output via HDMI)
- Use Chrome in kiosk mode for cleanest experience (see Deployment Notes)
- Display page: black background, cursor auto-hides after 3s of inactivity
- `pointer-events: none` on iframe — prevents accidental mouse interaction from advancing slides
- Wake Lock API prevents screensaver during a show; released on Stop
- Fullscreen triggered on first click ("CLICK TO BEGIN" prompt); re-entered on each SHOW_SLIDE
- Display renders Canva slides via iframe using two-step embed approach (see above)
- Controller preview uses static PNG exports only

---

## iPad Controller UI Requirements

- Large tap targets (minimum 44×44px)
- Works in both orientations (landscape preferred)
- Design grid: 2–3 columns of thumbnail cards with embed status dot
- Selected slide clearly highlighted
- "Go Live" button prominent — disabled until embed URL configured AND preview ready
- "Currently Displaying" indicator in header
- Embed URL modal: paste Canva iframe code or URL → token extracted and saved
- Auto-advance toggle with configurable duration (sec/slide)

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

- Hosted on **Railway** at `https://mortys-dueling-pianos-production.up.railway.app`
- Auto-deploys on push to `main`
- Controller: `/controller` — Display: `/display`
- `.tokens.json` and `.embed-tokens.json` are server-side data files (gitignored, persist on Railway volume)
- Display runs in a desktop browser on a laptop connected to the stage TV via HDMI
- Launch display in Chrome kiosk mode for cleanest experience: `google-chrome --kiosk https://mortys-dueling-pianos-production.up.railway.app/display`
- Controller runs on iPad; server is internet-hosted so no local network dependency

---

## Canva Developer Setup (One-Time)

1. Go to [canva.dev/docs/connect](https://www.canva.dev/docs/connect)
2. Create a new integration in the Developer Portal
3. Set integration type to **Public** (required for non-Enterprise accounts)
4. Add scopes: `design:content:read`, `design:meta:read`, `asset:read`
5. Set redirect URI to match your `CANVA_REDIRECT_URI`
6. Works in "development mode" without Canva review for personal/internal use

---

## MVP Checklist

- [x] OAuth login flow + token storage
- [x] `GET /v1/designs` → display thumbnail grid on controller
- [x] Export a design page as PNG → preview on controller
- [x] WebSocket: controller sends SHOW_SLIDE → display renders it
- [x] "Go Live" button with confirmation feedback
- [x] Token auto-refresh
- [x] Display fullscreen on click prompt ("CLICK TO BEGIN") — hides browser UI
- [x] Slide buttons scrollable when design has many pages
- [x] Currently-displaying indicator on controller
- [x] Deployed to Railway
- [x] Logout route clears tokens
- [x] Per-design embed URL setup (paste from Canva Share → Embed)
- [x] Embed status indicator (green/orange dot) on design cards
- [x] Correct slide navigation via two-step embed load + fragment navigation
- [x] Slide animations working
- [x] Auto-advance mode with configurable duration (dropdown presets + custom MM:SS + countdown clock)
- [x] Scrollbar styling on design grid and slide panel (visible + hover state)
- [x] Slide nav label above thumbnail grid ("SELECT A SLIDE..." / "SLIDE X OF Y")
- [x] Embed status shows "Slideshow Verified" + subtle re-link affordance once configured
- [x] Embed status label tied to selected design name (shown in panel title)
- [x] Server validates pasted embed URL belongs to the selected design (wrong-design paste rejected with error)
- [x] Pause selects active slide thumb; Resume resumes from active slide
- [x] Active slide overlay tracks auto-advance via SLIDE_ADVANCED message
- [x] Prev/Next slide nav arrows (JS implemented, HTML commented out pending UX decision)
- [x] Black cover div hides slide-1 flash during new-design iframe load
- [x] Stop keeps iframe warm — next Go Live on same design uses fragment navigation (no reload flash)
- [x] Display cursor visible on prompt screen; auto-hides after 3s once fullscreen is entered
- [x] Wake lock prevents screensaver during show; released on Stop
- [x] `/auth/whoami` endpoint returns Canva user_id for test-user setup

---

## Known Issues

### Canva UI bar hidden via CSS offset
- **Status:** Fixed — `top: -75px` / `height: calc(100% + 150px)` on `.slide-frame`
- **Rule:** Only change `top` to shift content up/down; only change `height` to push UI bar below viewport. Do not change both simultaneously.

### Auto-advance occasionally unreliable
- **Status:** Fixed — timer no longer depends on iframe `load` event

### Slide N-1 briefly visible when jumping to slide N
- **Status:** Known limitation — Canva's built-in transition animation plays the exit of slide N-1 when entering slide N via hash navigation. Not fixable from our side without suppressing all transition animations.

---

## Backlog

### UI / Controller
- [ ] Re-enable Forward/Back nav arrows (JS already written, just uncomment HTML buttons and their DOM refs/listeners in app.js)
- [ ] Auto-populate embed URL — investigated; not feasible. Canva's page is SPA-rendered and requires browser session cookies. View token not exposed via Connect API. Manual paste flow is the only option.

### Display / Show Control
- [ ] Slide pre-caching — load slide N+1 in hidden iframe while N is showing (identified as impactful for cross-design transitions; tabled pending further testing)

### Future Enhancements
- Set list integration (map songs to specific slides)
- Multiple display support (IMAG screens, confidence monitors)
- Offline mode with pre-downloaded slide cache
