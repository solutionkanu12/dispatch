# Dispatch — Development Task Breakdown

Ordered first to last. Each task lists suggested model (Sonnet/Opus per your allocation pattern) and what "done" looks like, so each one is independently handoff-ready to Claude Code.

---

## Phase 0 — Groundwork (do before writing any code)

**Task 1: Pull real CAP SDK docs and confirm integration shape**
- Model: N/A (research, do this yourself or with search)
- Go to docs.croo.network, get exact SDK package name, install command, and method signatures for agent registration, hiring, escrow polling
- Confirm whether VeriMath/ChainGuard need structured input beyond free text (check their Store "Requirements" dropdowns)
- **Done when:** you have real method names/signatures to hand to Claude Code, not placeholders

**Task 2: Register Dispatch as a CAP agent + fund wallet**
- Model: N/A (manual/operational)
- Create Dispatch's own agent identity per CAP's registration flow
- Fund its wallet with enough USDC to cover demo-window order volume + buffer
- **Done when:** Dispatch has a live wallet address and can theoretically place an order

---

## Phase 1 — Backend skeleton

**Task 3: Scaffold Node.js/Express backend + Postgres connection**
- Model: Sonnet
- Set up project structure per architecture doc §3
- Wire up hosted Postgres (Supabase/Neon), run the schema from architecture doc §4
- **Done when:** server boots, connects to DB, health-check endpoint responds

**Task 4: Build the static agent registry**
- Model: Sonnet
- Create `config/agents.json` with VeriMath + ChainGuard real data (wallet, price, tags, SLA, store URL)
- Seed script to load it into the `agents` table on deploy
- **Done when:** `GET /api/agents` returns both agents correctly from DB

**Task 5: Build the routing classifier**
- Model: Sonnet
- Implement the keyword-match logic from PRD §11
- Unit-testable in isolation (no CAP dependency yet)
- **Done when:** given sample request strings, it returns the correct `agent_id` every time for your known test cases

---

## Phase 2 — CAP integration (highest risk, do this early)

**Task 6: CAP client wrapper — order placement**
- Model: **Opus**
- Implement `capClient.placeOrder(agentId, requestText)` using real SDK calls from Task 1
- Handle the immediate response (order accepted, ref returned) vs immediate failure (agent offline, malformed request)
- **Done when:** you can place one real order to VeriMath from a script and see it appear in VeriMath's own Store activity feed

**Task 7: CAP client wrapper — settlement polling**
- Model: **Opus**
- Implement `capClient.getOrderStatus(orderRef)` and a background poller/job that checks in-flight orders until settled or timed out
- Handle the async nature explicitly — don't block HTTP responses on this (architecture doc §3)
- **Done when:** a placed order transitions from `routed` to `settled` in your DB automatically, with `settlement_proof` and `result_payload` populated, without manual intervention

**Task 8: Failure handling**
- Model: **Opus**
- Define and implement the failure paths: agent unreachable at placement time, order never settles within timeout, malformed provider response
- Every failure must resolve to a `failed` status with a human-readable `failure_reason` — never a silently stuck order
- **Done when:** you can simulate an offline agent (e.g. point at a dead agent URL) and see it fail cleanly, not hang

---

## Phase 3 — Wire backend end-to-end

**Task 9: `/api/dispatch` endpoint**
- Model: Sonnet
- Wire together classifier (Task 5) → order creation → `capClient.placeOrder` (Task 6)
- Returns order id immediately per architecture doc §3 step 6
- **Done when:** POSTing a request text creates a DB row and triggers a real CAP order

**Task 10: `/api/orders` and `/api/orders/:id` endpoints**
- Model: Sonnet
- List endpoint for the ledger (most recent first), detail endpoint for expandable rows
- **Done when:** both return correct data shaped per PRD §9

**Task 11: Rate limiting on `/api/dispatch`**
- Model: Sonnet
- Basic IP-based throttle to protect Dispatch's wallet during public demo access
- **Done when:** repeated rapid requests from one source get throttled, not silently accepted

---

## Phase 4 — Frontend build

**Task 12: Scaffold React + Vite + Tailwind + Framer Motion project**
- Model: Sonnet
- Fresh proper project (not the CDN-based HTML prototype) per architecture doc §2 file structure
- Port over the visual design system (colors, fonts, layout) from the approved HTML prototype
- **Done when:** blank-but-styled app runs locally with `npm run dev`

**Task 13: Build static components against the prototype's design**
- Model: Sonnet
- `RequestForm`, `AgentCard`, `LedgerRow`, `Footer` (CRT + socials) — visually matching the approved prototype exactly
- Still using mock data at this point
- **Done when:** the app looks identical to the HTML prototype you approved, running as real React components

**Task 14: Real Framer Motion packet animation**
- Model: Sonnet
- Replace the prototype's CSS-keyframe packet travel with actual Framer Motion, now that it's a real bundled project (no CDN reliability issue here)
- **Done when:** the launch → travel → arrive → seal-burst → ledger-drop sequence works with real Framer Motion, same feel as prototype

**Task 15: Wire frontend to real backend**
- Model: Sonnet
- `useDispatch` hook → POST `/api/dispatch`
- `useOrders` polling hook → GET `/api/orders`, drives the ledger and triggers the packet animation on new orders
- Remove all mock/simulated data
- **Done when:** typing a real request in the browser triggers a real CAP order and you watch it settle live in the ledger

**Task 16: Failure states in UI**
- Model: Sonnet
- Ledger row styling for `failed` status (per Task 8's backend work)
- **Done when:** a failed order is visibly distinct in the ledger, not just missing or stuck

---

## Phase 5 — Hardening + real order volume

**Task 17: Place 10+ real orders across both agents**
- Model: N/A (manual, but do this deliberately, not incidentally)
- Explicitly hit the Technical Execution bonus threshold before submission
- **Done when:** ledger shows 10+ real settled orders spanning both VeriMath and ChainGuard

**Task 18: Deploy backend (Railway/Render) + frontend (Vercel/Netlify)**
- Model: Sonnet
- Environment variables, CORS, production DB connection
- **Done when:** the live public URL works end-to-end, matching local behavior

**Task 19: Verify stability through Demo Day window**
- Model: N/A (manual check)
- Confirm uptime plan covers Jul 12 submission through Jul 16 Demo Day, not just the deadline moment
- **Done when:** you've checked the deployed app works a day after deploying, not just immediately after

---

## Phase 6 — Submission materials

**Task 20: README**
- Model: Sonnet
- Setup instructions, SDK methods used, integration notes (submission requirement)
- Explicit anti-sybil framing paragraph (PRD §13 risk mitigation) explaining Dispatch routes to independently-built third-party agents
- **Done when:** a stranger could clone the repo and get it running from the README alone

**Task 21: Demo video (≤5 min)**
- Model: N/A (you)
- Script: state the thesis in the first 30 seconds ("it doesn't do the task, it decides who does"), show a live request traveling through the full lifecycle to a real settled result, show the ledger with real order history
- **Done when:** video is under 5 minutes and doesn't require narration to be understood

**Task 22: File BUIDL on DoraHacks**
- Model: N/A (you)
- All required fields, repo link, demo video, track selection (Open — Any A2A Agents)
- **Done when:** submitted before Jul 12, 10:00

---

## Critical path if time runs short

If you have to cut scope under pressure, cut in this order: Task 16 (failure UI polish) → Task 11 (rate limiting, accept the risk) → Task 14 (keep CSS animation instead of real Framer Motion, it already looks good). **Never cut Tasks 6-8 (CAP integration) or Task 17 (real order volume)** — those are the two things that most directly determine your score on the two heaviest-weighted criteria.
