# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This repository currently contains **no application code** — only planning docs and a single static HTML prototype. There is no `package.json`, backend, frontend project, build tooling, linter, or test suite yet. Do not assume any of these exist; check before referencing commands like `npm run dev`, `npm test`, etc. — they have not been set up.

- `docs/dispatch-prd.md` — product requirements
- `docs/dispatch-architecture.md` — target system architecture (frontend, backend, DB schema, deployment)
- `docs/dispatch-tasks.md` — ordered build task list (Phase 0 through Phase 6), each task tagged with a suggested model (Sonnet/Opus) and a "done when" criterion
- `assets/dispatch-prototype.html` — a standalone, CDN-based (React UMD + Babel-standalone, no build step) HTML/CSS/JS prototype of the UI. This is a design reference only, not the production frontend — the architecture doc explicitly says not to port its CSS-keyframe animation approach into production; use real Framer Motion instead once a real Vite project exists.

**When starting implementation work, read `docs/dispatch-tasks.md` first** — it defines the build order and which phase to work in. Follow that sequencing rather than improvising a different order, since later phases (CAP integration) are intentionally front-loaded due to risk, and frontend work intentionally comes after the backend skeleton.

## What Dispatch is

Dispatch is a CAP-native routing agent (built for the CROO Agent Hackathon, CAP protocol on Base). A user describes a task in plain language; Dispatch classifies it, places a real on-chain CAP order with one of a small set of known live provider agents (VeriMath for computational verification, ChainGuard for smart contract security), pays from its own agent wallet, and returns the provider's result. It is a broker/router, not a task-performing agent — "it doesn't do the task, it decides who does" is the core positioning. No end-user auth, accounts, or wallet-connect (Dispatch fronts all costs itself).

## Target architecture (per docs/dispatch-architecture.md)

- **Frontend:** React 18 + Tailwind + Framer Motion + Vite. Local state + a polling hook (`useOrders`, 2-3s interval while orders are in flight) — no Redux/Zustand.
- **Backend:** Node.js + Express/Fastify, TypeScript recommended specifically for the CAP integration layer. Key modules: `services/classifier.ts` (deterministic keyword-match router, see PRD §11), `services/capClient.ts` (CAP SDK wrapper: register agent, place order, poll escrow, fetch result), `services/orderStore.ts` (DB access).
- **Routing classifier is intentionally simple:** keyword match on request text — contract/token/audit-related keywords → ChainGuard, else → VeriMath. Do not replace with an LLM classifier unless explicitly asked; simplicity here is a deliberate reliability choice for demo conditions, not a placeholder to "upgrade."
- **Order lifecycle:** `queued` → `routed` → `settled` | `failed`. Order placement (`/api/dispatch`) must respond immediately with the order id and must never block on settlement — settlement (especially ChainGuard, up to 5 min SLA) is handled by a separate background poller that updates the order record asynchronously. A failed or timed-out order must always resolve to `failed` with a human-readable `failure_reason` — never leave it silently stuck in `routed`.
- **Database:** Postgres (or SQLite for local/single-instance), two tables: `orders` and `agents`. `agents` is seeded once from `config/agents.json` at deploy time and is not runtime-writable (no dynamic provider onboarding in MVP scope).
- **No auth for end users** — this is a deliberate product decision (see PRD §4 non-goals), not a gap to fill in. Dispatch itself authenticates to the CAP network via its own agent private key (server-side env var only, never sent to the frontend).

## Design system (from assets/dispatch-prototype.html)

Dark theme, warm/ember accent, "Space Grotesk" for display text and "Inter" for body text. Key CSS variables to preserve when building the real frontend:
```
--bg: #0E0B08;        --panel: #1A1511;      --line: #2E2620;
--cream: #F5EFE6;      --muted: #8A7F72;      --ember: #E8913C;
--ember-hot: #FFA94D;  --green: #6FB98F;
```
The prototype's animated "packet" element (launch → travel → arrive → seal-burst → ledger-drop) represents an order traveling from Dispatch to a provider agent — reproduce this interaction with real Framer Motion in production, not CSS keyframes.

## Non-goals (do not build unless explicitly asked)

Per PRD §4: user accounts/auth, wallet-connect / user-funded requests, dynamic third-party provider onboarding, reputation-weighted routing, any UI beyond a single request + ledger page.

## Commit and writing rules

1. Every git commit in this repository must be authored solely by the human developer. Never add Claude or AI co-author lines, "Generated with Claude Code" text, or any bot signature to commit messages, code comments, or documentation.

2. Never use em dashes or en dashes anywhere in code comments, UI copy, README files, or any written documentation in this project. Rewrite sentences to avoid them instead.
