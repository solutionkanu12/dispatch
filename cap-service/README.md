# Dispatch CAP service

A small FastAPI process that wraps the two croo SDK calls already proven to work
against the real CROO network in `scripts/`, so the Node/Express backend can
place and poll real CAP orders over plain HTTP instead of spawning Python per
request.

It wraps exactly two SDK calls and nothing else:

- `negotiate_order(NegotiateOrderRequest(...))` returns a `Negotiation`
- `get_order(order_id)` returns an `Order`

Responses are the SDK's own dataclasses serialized field for field in
snake_case, so the Node side (`server/services/capClient.ts` `Order` and
`Negotiation` interfaces) consumes them without renaming anything.

## Endpoints

### `GET /health`

Liveness plus a non sensitive view of which env vars are set. It reports only
whether each variable is present, never any value, and never the API key.

```json
{
  "status": "ok",
  "service": "dispatch-cap-service",
  "config": {
    "CROO_BASE_URL": true,
    "CROO_API_KEY": true,
    "CROO_WS_URL": false,
    "DISPATCH_REQUESTER_AGENT_ID": true
  }
}
```

### `POST /orders/negotiate`

Places a real `negotiate_order` call. Request body (JSON):

| Field                | Required | Notes                                                                 |
| -------------------- | -------- | --------------------------------------------------------------------- |
| `service_id`         | yes      | The provider service to negotiate with.                               |
| `requirements`       | no       | JSON string describing the task, for example `{"op":"verify_prime","n":17}`. |
| `requester_agent_id` | no       | Falls back to `DISPATCH_REQUESTER_AGENT_ID` if omitted, else SDK default. |
| `metadata`           | no       | Optional passthrough to the SDK.                                      |
| `fund_amount`        | no       | Escrow amount in token base units, for example `"10000"` for 0.01 USDC (6 decimals). Proven in `scripts/verify_cap_funded.py`. |
| `fund_token`         | no       | Token address, for example USDC on Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. |

`fund_amount` and `fund_token` are what make an order payable, so they matter
for a real end to end order even though the minimal negotiate call works
without them.

On success it returns the full `Negotiation` object (HTTP 200), which includes
`negotiation_id`, `status`, and `expires_at` among other fields.

Example:

```bash
curl -s -X POST http://127.0.0.1:8001/orders/negotiate \
  -H 'content-type: application/json' \
  -d '{"service_id":"<verimath-service-id>","requirements":"{\"op\":\"verify_prime\",\"n\":17}"}'
```

### `POST /orders/place`

The negotiation to order_id bridge, and the endpoint the Node
`capService.placeOrder` port is meant to call. It negotiates, then briefly polls
for the resulting order and returns its `order_id` as `capOrderRef`.

Body: everything `POST /orders/negotiate` accepts, plus two optional knobs:

| Field                   | Required | Notes                                                         |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `wait_seconds`          | no       | Max time to wait for provider acceptance. Default 20, clamped to 120. |
| `poll_interval_seconds` | no       | Gap between polls. Default 2, floor 0.25.                     |

Why it exists: `negotiate_order` returns a `Negotiation`, not an `Order`. An
`Order` (and its `order_id`) only comes into being once the provider accepts the
negotiation. Since the SDK exposes no "get order by negotiation" call and a
`Negotiation` carries no `order_id`, this endpoint lists the buyer's orders and
matches on the `negotiation_id` field every `Order` carries.

It waits only for acceptance, never for settlement. Payment and delivery remain
the job of the separate Node poller against `GET /orders/{order_id}`, so this
does not violate the architecture rule that placement must not block on
settlement.

Outcomes:

- Order created: HTTP 200 with `{ capOrderRef, order_id, negotiation_id, negotiation_status, order }` where `order` is the full `Order`.
- Provider rejected the negotiation: HTTP 409 `negotiation_rejected` (fast, does not wait out the timeout), with `reject_reason`.
- Negotiation expired: HTTP 409 `negotiation_expired`.
- Not accepted within `wait_seconds`: HTTP 504 `order_not_ready` with the `negotiation_id` and last `negotiation_status`, so the caller can keep polling rather than treat it as a hard failure.

```bash
curl -s -X POST http://127.0.0.1:8001/orders/place \
  -H 'content-type: application/json' \
  -d '{"service_id":"<verimath-service-id>","requirements":"{\"op\":\"verify_prime\",\"n\":17}","fund_amount":"10000","fund_token":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"}'
```

### `GET /orders/{order_id}`

Fetches a real `Order` by id and returns the full `Order` object (HTTP 200). The
field set matches the croo `Order` dataclass exactly.

```bash
curl -s http://127.0.0.1:8001/orders/<order-id>
```

### `POST /presence/connect`, `POST /presence/disconnect`, `GET /presence`

Manage the websocket keepalive that makes Dispatch appear ONLINE. See the
"Agent presence" section below for why a websocket is what drives ONLINE status.

- `POST /presence/connect` opens and holds a single websocket for this process.
  Idempotent: calling it while already online just returns the current status.
  It recovers a socket that died (for example a duplicate-key rejection) by
  tearing it down and reopening. Returns HTTP 503 if `CROO_WS_URL` is missing,
  or a real dial/auth failure via the shared error mapping.
- `POST /presence/disconnect` closes the keepalive. Safe to call when closed.
- `GET /presence` returns the status, for example:

```json
{
  "keepalive_held": true,
  "online": true,
  "connected_since_epoch": 1752192000.0,
  "uptime_seconds": 42.0,
  "ws_url_configured": true,
  "last_error": null
}
```

`online` is `true` only when the socket is held and has not recorded a fatal
error. If the backend rejects the connection (for example a duplicate SDK-Key),
`online` becomes `false` and `last_error` carries the reason.

```bash
curl -s -X POST http://127.0.0.1:8001/presence/connect
curl -s http://127.0.0.1:8001/presence
```

Set `DISPATCH_WS_KEEPALIVE=1` to open the keepalive automatically at startup
instead of calling connect by hand.

## Errors

Failures are surfaced as real HTTP errors, never swallowed or faked:

- A croo `APIError` is returned with its upstream `http_status` passed straight
  through (a 400 stays a 400, a 404 stays a 404), plus a body of
  `{ "error": "cap_api_error", "message", "code", "reason", "http_status" }`.
- An `InsufficientBalanceError` returns HTTP 402 with a readable message.
- Any other SDK or network failure returns HTTP 502 with the real message.
- A missing required env var returns HTTP 503 listing the missing names.

## Environment variables

Read from the process environment, never hardcoded, never logged, never
returned by any endpoint.

| Variable                      | Required | Purpose                                                              |
| ----------------------------- | -------- | -------------------------------------------------------------------- |
| `CROO_BASE_URL`               | yes      | CROO API base URL.                                                   |
| `CROO_API_KEY`                | yes      | Dispatch's own agent SDK key. Never exposed by this service.         |
| `CROO_WS_URL`                 | for presence | Required only for the `/presence` websocket keepalive. The order endpoints do not need it. |
| `DISPATCH_REQUESTER_AGENT_ID` | no       | Default `requester_agent_id` for negotiate when the body omits it.   |
| `DISPATCH_WS_KEEPALIVE`       | no       | When truthy (`1`/`true`/`yes`/`on`), open the websocket keepalive at startup so Dispatch shows ONLINE on boot. |

## Configuration loading

On import, the service loads a `.env` file **sitting next to `main.py`**
(`cap-service/.env`) into the environment, so the credentials placed there are
the ones actually used. This file is treated as authoritative for the service:
it **overrides** any pre-existing `CROO_*` value in the shell. That override is
deliberate, because a stale key left in the shell silently shadowing the correct
one in `.env` is what caused the websocket handshake to be rejected with HTTP
401 (the wrong key was sent). The loader is dependency-free and logs only the
variable names it loaded, never their values.

If you would rather supply configuration purely from the real environment, leave
`cap-service/.env` absent and export the variables yourself.

## Running it

There is no separate virtualenv in this repo. The croo SDK is already installed
in the same Python that runs `scripts/`. Install the web deps into that same
environment:

```bash
pip install -r cap-service/requirements.txt
```

Put the real values in `cap-service/.env` (loaded automatically):

```
CROO_BASE_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws
CROO_API_KEY=croo_...
```

Then run from inside the `cap-service` directory (the directory name contains a
hyphen, so it is not an importable package, run it from within instead):

```bash
cd cap-service
uvicorn main:app --host 127.0.0.1 --port 8001
```

Interactive API docs are then at `http://127.0.0.1:8001/docs`.

## Agent presence (DRAFT vs LIVE / ONLINE)

The order endpoints alone (`negotiate`, `place`, `get_order`) are stateless HTTP
and do **not** make Dispatch show as ONLINE. The `/presence` endpoints do: they
hold the websocket that drives ONLINE status.

The croo SDK has no register, publish, set-status, online, or heartbeat call of
any kind. The only presence mechanism in the SDK is `connect_websocket()`, which
opens a persistent `/ws` connection (authenticated by SDK key, with a ping loop,
and explicit handling for a "duplicate SDK-Key connection" rejection). That is
what `test-provider/provider.py` did to show as ONLINE: it held that socket open
and stayed alive. The `/presence/connect` endpoint does the same thing for
Dispatch, holding one connection for the life of the process (the backend allows
only one per SDK key). It registers no event handlers and performs no work; it
exists solely to keep the agent marked online, and the SDK's own auto-reconnect
keeps it up across transient drops.

One honest caveat that the SDK cannot settle: whether the dashboard's DRAFT to
LIVE flip is driven purely by a live websocket connection, or also needs a
separate out-of-band dashboard/registration action, is not confirmed here. The
SDK surfaces an `INVALID_AGENT_STATUS` error (`croo.is_invalid_status`), which
suggests agent status is enforced by the backend. Holding the websocket is the
same thing that flipped the test provider to ONLINE, so it is the right lever to
pull; if the dashboard still shows DRAFT after `/presence/connect` reports
`online: true`, the remaining step is a dashboard/registration action outside
this SDK, not something more this service can do.

## Known gaps (proven vs assumed)

This service now covers negotiate through to obtaining an `order_id`, but not the
full lifecycle:

- **Closed by `/orders/place`:** the earlier gap where only a `negotiation_id`
  was available. `/orders/place` resolves the `order_id` and returns it as
  `capOrderRef`, matching the Node `capService.placeOrder` port shape.
- **Acceptance is inferred by polling, not confirmed by an event.** The bridge
  matches the new order by scanning the buyer's order list for the
  `negotiation_id`. This assumes list ordering and low request volume typical of
  a single-requester demo; the scan is paged and bounded as a safety net. A
  websocket `ORDER_CREATED` event would be more direct, but even when the
  `/presence` keepalive is open it registers no handlers, so `/orders/place`
  does not consume events from it; wiring events into placement is future work.
- **No settlement.** `pay_order` and `deliver_order` exist in the SDK, and
  `accept_negotiation` / `deliver_order` appear on the provider side in
  `test-provider/provider.py`, but a requester-side pay-and-settle flow is out of
  scope here. After `/orders/place` returns an `order_id`, the Node poller drives
  settlement via `GET /orders/{order_id}`. Whether payment happens automatically
  on the requester side or needs an explicit `pay_order` call is **not** verified
  in this repo's scripts, so it is deliberately not implemented here.
