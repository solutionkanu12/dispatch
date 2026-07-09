# Dispatch — Product Requirements Document

**Hackathon:** CROO Agent Hackathon (DoraHacks × CROO Network)
**Track:** Open — Any A2A Agents
**Deadline:** July 12, 2026, 10:00
**Author:** winarc (solutionkanu12)
**Status:** Build-ready

---

## 1. Problem Statement

CROO's CAP protocol lets any AI agent hire and pay any other agent on-chain. In practice, this creates a discovery problem: a buyer (human or agent) who needs work done has to browse the Agent Store, evaluate which of dozens of listed agents is actually live, compare pricing, and place an order manually. Most listed agents are not reliably live — in a sample of ~10 Store listings checked directly, several (e.g. ProofDesk, AlphaProbe) were offline or had no working link, while others (VeriMath, ChainGuard) were genuinely live with real order history.

There is no layer that sits between "I need X done" and "here is the specific live agent who will do X, priced, ordered, and paid." Every submission in this hackathon builds an agent that *performs* a task. Almost none build the layer that *decides where the task goes*.

## 2. Solution

Dispatch is a CAP-native routing agent. A user states what they need in plain language. Dispatch classifies the request, selects the appropriate live provider agent from its known pool (initially VeriMath for computational verification, ChainGuard for smart contract security), places a real CAP order on the user's behalf, pays the provider from Dispatch's own agent wallet, and returns the result. No wallet connection or login is required from the end user — Dispatch fronts the transaction as a legitimate CAP buyer.

This directly answers CROO's own framing question — "you've built an agent that works, how do you make it earn?" — for a category of agents that don't do end-tasks themselves, but make the market itself function.

## 3. Goals

- Ship a working, live, CAP-integrated broker before the July 12 deadline
- Route real requests to real, independently-built agents already on the Agent Store — not simulated counterparties
- Maximize Technical Execution (30%) and A2A Composability (25%) — the two heaviest-weighted judging criteria
- Produce a demo that is legible and convincing in under 5 minutes without narration

## 4. Non-Goals (explicitly out of scope for the hackathon build)

- User accounts, authentication, or per-user history
- Wallet-connect / user-funded requests (Dispatch fronts all costs for the demo)
- Dynamic onboarding of new provider agents by third parties
- Reputation-weighted routing (PTS-based agent selection)
- Any UI beyond a single-page request + ledger view

---

## 5. User Stories

**As a buyer (human or agent) with a task:**
- I want to describe what I need in plain language, so I don't have to browse the Agent Store myself.
- I want to know immediately which agent is handling my request, so I can trust the process.
- I want to see proof that my request was actually completed and paid for, so I know it's real and not simulated.
- I don't want to connect a wallet or create an account just to try this once.

**As a judge evaluating the submission:**
- I want to see real CAP orders with real settlement, not mocked data, so I can verify Technical Execution.
- I want to see Dispatch transact with agents it did not build itself, so I can verify genuine A2A Composability.
- I want to understand in under 5 minutes what Dispatch does and why it couldn't exist without CAP.

**As a provider agent (VeriMath, ChainGuard):**
- I want incoming orders from Dispatch to look like any other legitimate CAP order, so my own metrics and behavior are unaffected.

---

## 6. Features

See companion MVP Feature List for full Must/Nice/Future breakdown. Summary of Must Have scope:

| # | Feature | Notes |
|---|---|---|
| 1 | Store listing | Required for submission validity |
| 2 | CAP integration | Dispatch has its own agent wallet, callable, settles on-chain |
| 3 | Request intake UI | Single text input, no auth |
| 4 | Routing classifier | Keyword/intent match → VeriMath or ChainGuard |
| 5 | Order placement | Real CAP order to selected provider |
| 6 | Escrow/settlement tracking | Order lifecycle: queued → routed → settled |
| 7 | Result return | Display the provider's actual delivered output |
| 8 | Live public ledger | Shows real orders + settlement proof |
| 9 | Failure handling | Graceful behavior when a provider is offline/fails |
| 10 | README + demo video | Submission requirement; explains anti-sybil framing |

---

## 7. User Flow

```
1. User lands on Dispatch (no login)
   ↓
2. User types a request in plain language
   e.g. "audit 0x4f2a...9e01 for reentrancy"
   ↓
3. Dispatch classifies the request
   → contract/token/audit keywords → ChainGuard
   → math/number/verify keywords → VeriMath
   ↓
4. Dispatch places a real CAP order to the selected agent,
   paying from its own wallet
   ↓
5. Order appears in the live ledger as "queued" → "routed"
   ↓
6. Provider agent (VeriMath/ChainGuard) delivers the result
   via CAP; escrow settles on-chain
   ↓
7. Ledger updates to "settled"; user sees the actual result
   returned inline
   ↓
8. (Failure path) If provider is unreachable or delivery fails,
   Dispatch surfaces a clear failed state and does not
   silently hang or fake a result
```

---

## 8. System Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Frontend   │─────▶│  Dispatch Agent   │─────▶│   CAP Protocol   │
│ (React UI)   │◀─────│  (routing logic + │◀─────│  (on-chain, Base)│
│              │      │   agent wallet)   │      │                  │
└─────────────┘      └──────────────────┘      └────────┬─────────┘
                                                            │
                                          ┌─────────────────┼─────────────────┐
                                          ▼                                   ▼
                                  ┌───────────────┐                 ┌────────────────┐
                                  │   VeriMath     │                 │   ChainGuard    │
                                  │ (external,     │                 │ (external,      │
                                  │  live agent)   │                 │  live agent)    │
                                  └───────────────┘                 └────────────────┘
```

Dispatch is a client of CAP, not a fork of it. It does not modify or control VeriMath/ChainGuard — it transacts with them exactly as any other buyer would.

---

## 9. Data Requirements

Given the "no login, no accounts" scope, Dispatch's data needs are narrow. No relational database is required for MVP; a lightweight persistence layer is sufficient.

**Order record** (the core entity):
```
{
  id: string (CAP order id or internal uuid),
  request_text: string,
  agent_id: "verimath" | "chainguard",
  status: "queued" | "routed" | "settled" | "failed",
  price_usdc: number,
  cap_order_ref: string,        // on-chain reference once placed
  settlement_proof: string,     // hash / attestation once settled
  result_payload: string,       // delivered output once available
  created_at: timestamp,
  settled_at: timestamp | null
}
```

**Agent registry record** (static/config for MVP, not user-editable):
```
{
  id: string,
  name: string,
  cap_wallet: string,
  service_tags: string[],       // used by the routing classifier
  price_usdc: number,
  store_url: string
}
```

**Storage recommendation for hackathon scope:** a single append-only store (e.g. simple hosted Postgres/SQLite, or even a flat JSON log persisted server-side) is sufficient. The public ledger view reads directly from the order record table, most recent first. No user table, no auth table, no relational joins beyond order → agent lookup by `agent_id`.

---

## 10. APIs

**Consumed (external):**
| API | Purpose |
|---|---|
| CROO CAP SDK | Register Dispatch as an agent, discover/hire other agents, place orders, handle escrow and settlement |
| VeriMath `Computational Verification` service | Provider call for math/verification requests |
| ChainGuard `Smart Contract Audit` / `Token Contract Analyzer` / `Gas Optimizer` services | Provider call for contract/token requests |

**Exposed (internal, by Dispatch's own backend):**
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/dispatch` | POST | Accepts `{ request_text }`, runs classifier, places CAP order, returns order id |
| `/api/orders` | GET | Returns recent order records for the public ledger |
| `/api/orders/:id` | GET | Returns full detail for a single order (for expandable ledger rows, if built) |
| `/api/agents` | GET | Returns the static agent registry (for the "Routes to" panel) |

**Stretch (if Dispatch itself becomes CAP-callable by other agents, per Future Features):**
| Endpoint | Method | Purpose |
|---|---|---|
| CAP-registered `Dispatch Routing` service | — | Allows other agents, not just the frontend, to submit requests via CAP directly |

---

## 11. Routing Logic (MVP specification)

Deterministic, keyword-based classifier — intentionally simple for reliability under demo conditions:

```
IF request contains any of:
  ["contract", "audit", "token", "mint", "rug", "0x", "scan"]
THEN route to ChainGuard

ELSE route to VeriMath
```

This is explicitly documented in the README as MVP-simple; Future Features section covers upgrading to intent classification via an LLM call if time allows post-deadline.

---

## 12. Success Criteria

**Submission validity (binary — must all be true):**
- [ ] Listed and discoverable on CROO Agent Store
- [ ] CAP-integrated, places real orders, settles on-chain
- [ ] Public repo, permissive license
- [ ] Demo video ≤ 5 minutes
- [ ] BUIDL filed before July 12, 10:00

**Judging performance (targets against the rubric):**
| Criterion | Weight | Target |
|---|---|---|
| Technical Execution | 30% | 10+ real CAP orders placed during hackathon window; clean escrow lifecycle with no stuck/ambiguous states |
| A2A Composability | 25% | Real transactions with 2+ independently-built agents (VeriMath, ChainGuard confirmed live) |
| Innovation | 20% | Judges can clearly answer "would this be impossible on a normal API marketplace" — yes, because routing requires agents to have independent identity, wallets, and callable pricing |
| Usability & Adoption | 15% | Zero-friction demo (no wallet/login); judges can self-serve the flow without narration |
| Presentation | 10% | Demo video shows a real request traveling through the full lifecycle to a real settled result |

**Qualitative bar:** a judge who has seen 90 other submissions should be able to state, unprompted, what Dispatch does differently — "it doesn't do the task, it decides who does" — within the first 30 seconds of the demo.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Provider agents (VeriMath/ChainGuard) go offline before Demo Day | Build failure-state handling into MVP scope (item 9); consider a 3rd backup live agent if time allows |
| Self-authored order pattern reads as sybil/fake-diversity | README explicitly frames Dispatch's transaction pattern and routes to independently-built third-party agents, not self-authored ones — this is a factual distinction, not just framing |
| CAP SDK integration bugs cause stuck escrow | Prioritize this work on Opus per team's model-allocation pattern; test settlement lifecycle early, not last |
| Time pressure cuts polish | Must Have list is deliberately minimal; Nice to Have items are cut first under time pressure, not core flow |

---

## 14. Open Questions for Build Kickoff

- Exact CAP SDK method names/signatures for order placement and escrow polling (pull from CAP SDK quickstart before writing routing code)
- Whether VeriMath/ChainGuard's services require structured input beyond free text (their Store pages listed "Requirements" dropdowns — needs checking before integration)
- Hosting target for the backend (needs to be live and stable through July 16 Demo Day, not just July 12 submission)
