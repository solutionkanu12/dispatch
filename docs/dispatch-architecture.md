# Dispatch — System Architecture

**Companion to:** Dispatch PRD
**Purpose:** Concrete technical architecture ready to hand to Claude Code for phased implementation

---

## 1. Architecture Overview

Dispatch is a thin, stateless-frontend / lightweight-backend system. The backend's only real complexity is the CAP integration; everything else is intentionally simple, because the PRD's non-goals (no auth, no accounts, no multi-tenant data) remove most of what makes typical web apps complex.

```
┌────────────────────────────────────────────────────────────────┐
│                          CLIENT (Browser)                        │
│  React + Tailwind + Framer Motion                                 │
│  - Request form                                                   │
│  - Agent cards (VeriMath / ChainGuard)                             │
│  - Live ledger (polling or websocket)                             │
└───────────────────────────┬────────────────────────────────────┘
                              │ HTTPS (REST + polling, or WS)
┌───────────────────────────▼────────────────────────────────────┐
│                     DISPATCH BACKEND (Node.js)                    │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────────────┐  │
│  │  API layer    │  │  Router/        │  │  CAP Client         │  │
│  │  (Express/    │─▶│  classifier     │─▶│  (SDK wrapper,      │  │
│  │  Fastify)     │  │  engine         │  │  wallet, escrow)    │  │
│  └──────────────┘  └────────────────┘  └──────────┬─────────┘  │
│                                                       │            │
│  ┌──────────────────────────────────────────────────▼─────────┐ │
│  │              Order store (Postgres/SQLite)                   │ │
│  └───────────────────────────────────────────────────────────┘ │
└───────────────────────────┬────────────────────────────────────┘
                              │ CAP protocol calls (on-chain, Base)
┌───────────────────────────▼────────────────────────────────────┐
│                        CROO / CAP Network                        │
│   ┌────────────┐          ┌──────────────┐                       │
│   │  VeriMath   │          │  ChainGuard   │   ...future agents   │
│   │  (external) │          │  (external)   │                       │
│   └────────────┘          └──────────────┘                       │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Frontend

**Stack:** React 18, Tailwind CSS, Framer Motion, Vite (build tool — fast dev server, simple production build).

**Structure:**
```
/src
  /components
    RequestForm.jsx        // input + submit
    AgentCard.jsx           // per-provider live stats card
    Ledger.jsx               // list of LedgerRow
    LedgerRow.jsx
    Packet.jsx                // the animated routing element
    ReceiveRing.jsx
    Footer.jsx                 // CRT + social links
  /hooks
    useOrders.js              // polling hook against /api/orders
    useDispatch.js             // POST wrapper for /api/dispatch
  /lib
    classifyPreview.js        // optional client-side preview of routing (cosmetic only — real classification happens server-side)
  App.jsx
  main.jsx
```

**State management:** local component state + a polling hook is sufficient at this scale — no Redux/Zustand needed. `useOrders` polls `/api/orders` every 2-3 seconds while any order is in a non-terminal state, and stops polling when idle, to keep it cheap.

**Real-time updates:** Two viable options, pick based on time budget:
- **Polling (recommended for hackathon speed):** simple, robust, easy to debug under demo conditions. Poll every 2s while an order is in flight.
- **WebSocket (stretch):** lower latency, nicer for the live "public ledger" feel if multiple people load it during the demo simultaneously. Only worth it if the backend framework makes it near-zero extra effort (e.g. Socket.io with Express).

**Do not** re-implement the CSS-keyframe animation approach from the prototype as-is in production — swap in real Framer Motion here, since this is a proper bundled build (no CDN-ESM reliability concern like the standalone HTML prototype had).

---

## 3. Backend

**Stack:** Node.js + Express (or Fastify) + TypeScript recommended for the CAP integration specifically, since escrow/payment state is exactly where type safety earns its keep.

**Structure:**
```
/server
  /routes
    dispatch.ts       // POST /api/dispatch
    orders.ts          // GET /api/orders, GET /api/orders/:id
    agents.ts           // GET /api/agents
  /services
    classifier.ts       // routing logic (keyword match, per PRD §11)
    capClient.ts          // CAP SDK wrapper: register, hire, poll escrow
    orderStore.ts          // DB access layer
  /config
    agents.json            // static registry: VeriMath, ChainGuard config
  server.ts
```

**Core flow implementation (`/api/dispatch`):**
1. Validate `request_text` is non-empty
2. Run `classifier.ts` → returns `agent_id`
3. Create order record, status `queued`
4. Call `capClient.placeOrder(agent_id, request_text)` — this is the CAP SDK call that actually hires the provider and initiates escrow
5. Update order status to `routed`, store `cap_order_ref`
6. Return order id to frontend immediately (do not block the HTTP response on settlement — settlement may take up to the provider's stated SLA, e.g. ChainGuard's 5 min)
7. **Background job / webhook / poller** watches the CAP order until it settles or fails, then updates the order record to `settled` (with `settlement_proof` and `result_payload`) or `failed`

**Why async matters here:** ChainGuard's SLA is up to 5 minutes. The frontend should not hang an HTTP request open that long — decouple order placement (fast, synchronous response) from settlement (slow, tracked separately and picked up by the frontend's polling).

**Failure handling (PRD item 9):** if `capClient.placeOrder` throws (agent offline, CAP error) or if a placed order never settles within a defined timeout (e.g. 2x the provider's stated SLA), mark the order `failed` with a human-readable reason, surfaced clearly in the ledger — never leave an order silently stuck in `routed`.

---

## 4. Database

**Recommendation for hackathon scope:** Postgres (via a hosted free tier — e.g. Supabase or Neon) if you want real persistence and easy hosting; SQLite is also fine if the whole backend runs on a single instance and you don't need multi-instance scaling (you don't, for a hackathon demo).

**Schema:**

```sql
CREATE TABLE orders (
  id              TEXT PRIMARY KEY,
  request_text    TEXT NOT NULL,
  agent_id        TEXT NOT NULL REFERENCES agents(id),
  status          TEXT NOT NULL CHECK (status IN ('queued','routed','settled','failed')),
  price_usdc      NUMERIC NOT NULL,
  cap_order_ref   TEXT,
  settlement_proof TEXT,
  result_payload  TEXT,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at      TIMESTAMPTZ
);

CREATE TABLE agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  cap_wallet    TEXT NOT NULL,
  service_tags  TEXT[] NOT NULL,
  price_usdc    NUMERIC NOT NULL,
  store_url     TEXT,
  sla_minutes   INTEGER
);

CREATE INDEX idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX idx_orders_status ON orders (status);
```

`agents` is seeded once at deploy time from `config/agents.json` — it is not written to at runtime in MVP (no dynamic provider onboarding, per PRD non-goals).

**No user table.** No sessions table. No auth-related schema at all — this is a direct consequence of the "no login" product decision, not an oversight.

---

## 5. Authentication

**End users: none.** By product design (PRD §2, §4), no human ever logs in or connects a wallet. This removes an entire category of build risk and matches the "zero friction" usability goal.

**Dispatch itself: yes — agent-level identity.** Dispatch must register as a CAP agent with its own wallet, which is how it authenticates *to the CAP network*, not to end users:
- Dispatch holds a private key (or uses whatever CAP's SDK requires for agent registration — check CAP SDK quickstart for the exact mechanism)
- This key lives server-side only, in environment variables / secrets manager — **never** exposed to the frontend
- Dispatch's wallet needs a small pre-funded USDC balance to pay providers; this is operational setup, not a build task, but must happen before the first real order can settle

**Admin/operator access:** not in MVP scope. If you want basic protection against someone spamming `/api/dispatch` and draining Dispatch's wallet during the public demo window, that's a rate-limit concern (see §7), not an auth concern.

---

## 6. APIs

Already specified in PRD §10. Architectural notes on top of that:

**External — CAP SDK:** integrate via whatever official SDK/package CROO provides (confirm exact package name and install method from `docs.croo.network` before starting — this was flagged as an open question in the PRD). Expect methods roughly shaped like:
- `registerAgent(...)` — one-time setup
- `hireAgent(agentId, serviceId, payload)` — places an order
- `getOrderStatus(orderRef)` — poll escrow/settlement state
- `getOrderResult(orderRef)` — fetch delivered payload once settled

Exact method names will differ — this is a placeholder shape based on the order lifecycle described on VeriMath/ChainGuard's Store pages (submit → escrow locks → deliver → settle).

**Internal REST API:** as specified in PRD §10 — `/api/dispatch`, `/api/orders`, `/api/orders/:id`, `/api/agents`. All are unauthenticated (matches the no-login design) but should still validate/sanitize input and rate-limit (see below).

---

## 7. Deployment

**Frontend:** static build (Vite output) deployed to Vercel or Netlify — trivial, fast, free tier is enough for a hackathon demo.

**Backend:** needs a persistent Node process (for the settlement-polling background job), so a static/serverless host isn't ideal unless you implement polling as a scheduled function instead of a long-lived process. Recommended: Railway or Render (both have simple free/cheap tiers, support long-running Node processes, and are fast to deploy from a GitHub repo) — notably, RepoAudit (one of the live agents you found) is already deployed on Railway, which is a reasonable signal it works well for this exact use case.

**Database:** hosted Postgres — Supabase or Neon free tier, both trivial to wire up from Railway/Render.

**Environment variables (backend):**
```
CAP_AGENT_PRIVATE_KEY=...       # Dispatch's own agent identity
CAP_NETWORK=base                 # or whatever CROO specifies
DATABASE_URL=...
PORT=3000
```

**Deployment checklist:**
- [ ] Backend deployed and stable *through July 16 Demo Day*, not just the Jul 12 submission deadline — CROO's timeline has internal review (Jul 10-15) and Demo Day (Jul 16) after submission, so uptime matters past the deadline
- [ ] Dispatch's CAP wallet funded with enough USDC to cover demo-window order volume plus buffer
- [ ] CORS configured on the backend to allow the deployed frontend origin
- [ ] Basic rate limiting on `/api/dispatch` (e.g. simple IP-based throttle) so a public, unauthenticated demo can't drain the wallet or spam orders
- [ ] `.env` / secrets never committed to the public repo (required for the open-source submission requirement — double-check before making the repo public)

---

## 8. Build Sequencing (maps to model allocation)

1. **Sonnet:** scaffold frontend (adapt the existing HTML prototype into a real React+Vite+Tailwind+Framer Motion project)
2. **Sonnet:** scaffold backend routes, DB schema, agent registry config
3. **Opus:** CAP SDK integration — agent registration, `hireAgent`, escrow polling, settlement handling, failure states (highest-risk, highest-weighted section)
4. **Sonnet:** wire frontend to real backend endpoints, replace prototype's simulated data with live polling
5. **Sonnet:** deployment, environment setup, README, demo video prep

This sequencing front-loads the CAP integration risk (step 3) early enough that if something in the SDK behaves unexpectedly, there's still runway before Jul 12 to adjust — rather than discovering integration problems on the last day.
