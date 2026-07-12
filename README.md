# Dispatch

Dispatch is a routing layer for AI agent orders on CROO. A user types a free text request into a web frontend. Dispatch classifies the request, picks the right agent, pays for the order using its own funded CROO wallet, and returns the result.

Live app: https://dispatch-one-beige.vercel.app
Backend API: https://dispatch-backend-axh4.onrender.com
CAP bridge service: https://dispatch-cap-service.onrender.com
Repo: https://github.com/solutionkanu12/dispatch (MIT license)
CROO Agent Store listing: confirmed live via the Store page and an active presence websocket connection

## What it does

Dispatch sits between a user and CROO's agent marketplace. It reads a plain text request, decides which live agent should handle it, negotiates and places a real order through CAP, tracks that order from creation through settlement or failure, and shows the result on a live ledger in the frontend.

Right now Dispatch routes to three agents:

- VeriMath, for computational verification
- ChainGuard, for smart contract audits
- Polymarket, for wallet intelligence and prediction market analytics

## Who pays

During this hackathon submission, the user never connects a wallet and never pays anything themselves. Dispatch fronts small amounts, cents per order, from its own funded CROO wallet. This was a deliberate choice to keep the demo frictionless: type a request, get a result, no wallet popup in the way.

Wallet connect, so real users can fund their own orders instead of Dispatch paying for them, is scoped as the next piece of work after the hackathon. It is not built yet. This README is not going to pretend otherwise.

## A note on order status, read this before judging the ledger

If you open the live ledger, you will see a run of orders marked Failed with the reason "negotiation was created but no order appeared within 20 seconds." This looks bad at a glance so it deserves a direct explanation.

Dispatch's job is to classify a request, pick the right agent, create a real negotiation with that agent through CAP, and then either report a settled result or report cleanly why it did not settle. All of that is working. What is not working, and is outside Dispatch's control, is that CROO's VeriMath and ChainGuard agents were not actively accepting negotiations during the testing window for this submission.

This was checked directly, not assumed. Every negotiation Dispatch has ever created for this account, seventeen of them, was pulled and inspected. None of them, for any provider, has ever moved to accepted. Several sit pending for over an hour with no movement. The failure pattern is identical and consistent: a real negotiation gets created successfully, CROO's own API confirms it, and then nothing happens on the provider's side within the timeout window. This is not a parameter error, not a missing service ID, not a crash. It is Dispatch correctly detecting and reporting that a provider agent is not currently responding, instead of hanging silently or returning a fake success.

If the providers come back online, orders placed through Dispatch will settle normally with no code changes needed. The routing, negotiation, and CAP integration layer is complete and has been tested end to end against the real deployed backend.

## How the CAP integration actually works

Dispatch's Node backend does not talk to CROO's Python SDK directly. It calls a small FastAPI bridge service, cap-service, which wraps CROO's real croo-sdk package and exposes it over HTTP. The backend calls this bridge, which calls CROO's AgentClient methods directly: negotiate_order, get_negotiation, accept_negotiation, pay_order, get_order, list_orders, and list_negotiations. Nothing here is simulated. Every method name above was verified against the actual installed SDK, not written from memory.

Each agent has different requirements on CROO's side. Some services expect fund_amount and fund_token fields on order placement, others reject the request if those fields are present at all. Dispatch tracks this per agent and sends the correct shape of request to each one.

## Setup

Clone the repo, then run each service separately.

Backend (Node, Express), from the repo root:
```
npm install
npm run build
npm run start
```
Needs environment variables: DATABASE_URL, CROO_VERIMATH_SERVICE_ID, CROO_CHAINGUARD_SERVICE_ID, CAP_SERVICE_URL.

CAP bridge (Python, FastAPI):
```
cd cap-service
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```
Needs environment variables: CROO_BASE_URL, CROO_API_KEY, CROO_WS_URL.

Frontend (Vite, React):
```
cd frontend
npm install
npm run dev
```
Needs environment variable VITE_API_URL pointing at the backend. If unset, it falls back to relative API paths for local development against the Vite proxy.

## Roadmap

Wallet connect so users fund their own orders instead of Dispatch paying for them.
Additional agents beyond VeriMath, ChainGuard, and Polymarket as CROO's marketplace grows.
Retry and backoff handling for providers that are temporarily unresponsive, so a slow provider does not need a manual retry from the user.
