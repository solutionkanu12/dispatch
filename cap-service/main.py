"""Dispatch CAP service: a thin HTTP wrapper around the croo Python SDK.

Why this exists
---------------
The Dispatch backend is Node/Express, but the only proven CAP SDK in this repo
is the Python "croo" package (exercised by scripts/*.py). Rather than shelling
out to Python per request from Node, this small FastAPI process exposes the SDK
calls that are verified to work against the real CROO network.

Node talks to this service over plain HTTP/JSON. Field names in the responses
are the SDK's own snake_case dataclass fields, serialized untouched, so the
Node side (server/services/capClient.ts Order and Negotiation interfaces) can
consume them without any renaming.

Endpoints
---------
  GET  /health                liveness plus a non sensitive view of config
  POST /orders/negotiate      raw negotiate_order; returns the Negotiation
  POST /orders/place          negotiate + resolve to an order_id (the bridge
                              that backs the Node capService.placeOrder port)
  GET  /orders/{order_id}     get_order; returns the full Order
  POST /presence/connect      open and hold the websocket so Dispatch shows ONLINE
  POST /presence/disconnect   close the websocket keepalive
  GET  /presence              websocket keepalive status

The negotiation to order_id bridge
----------------------------------
negotiate_order returns a Negotiation, not an Order. An Order (and its order_id)
only comes into existence once the provider accepts the negotiation. The Node
port capService.placeOrder is defined to return a capOrderRef that is later
passed to get_order, so it needs an order_id, not a negotiation_id. POST
/orders/place closes that gap: it negotiates, then briefly polls the buyer's
orders for the one whose negotiation_id matches, and returns that order_id as
capOrderRef. It waits only for provider acceptance (fast for the known auto
accepting providers), never for settlement; payment and delivery remain the
job of the separate Node poller against get_order.

Env vars (read from os.environ, never hardcoded, never logged):

  CROO_BASE_URL   required. The CROO API base URL.
  CROO_API_KEY    required. Dispatch's own agent SDK key. Never returned by any
                  endpoint and never written to logs.
  CROO_WS_URL     required only for the /presence websocket keepalive. The
                  order endpoints do not need it. Passed through to Config.

  DISPATCH_REQUESTER_AGENT_ID  optional. If set, it is used as the default
                  requester_agent_id for negotiate when the request body does
                  not supply one. This is a convenience for "requests are always
                  from Dispatch's own agent" and is specific to this service.

  DISPATCH_WS_KEEPALIVE  optional. When truthy (1/true/yes/on) the websocket
                  keepalive is opened automatically at startup, so Dispatch
                  shows ONLINE as soon as the service boots. Otherwise call
                  POST /presence/connect to open it.

Websocket keepalive / ONLINE presence
-------------------------------------
The croo SDK has no register or set-status call. An agent shows as ONLINE only
while it holds an open websocket to the CROO backend (see test-provider). The
order endpoints are stateless HTTP and never open one. The /presence endpoints
manage a single long lived websocket for this process (the SDK rejects two
connections sharing one SDK key, so there is exactly one) purely to keep that
presence alive; it registers no event handlers and does no work beyond staying
connected. The SDK's own auto-reconnect keeps it up across transient drops.

Run it (from inside the cap-service directory):

  uvicorn main:app --host 127.0.0.1 --port 8001

See README.md for full details.
"""

import asyncio
import dataclasses
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger("dispatch-cap-service")


def _load_env_file(path: Path) -> list[str]:
    """Load KEY=VALUE pairs from this service's own .env into os.environ.

    Why this exists: the order and presence endpoints read CROO_BASE_URL,
    CROO_WS_URL, and CROO_API_KEY from os.environ, but nothing else in the
    process guarantees the .env sitting next to this file is loaded (there is no
    dotenv dependency, and uvicorn only reads an env file when python-dotenv is
    installed). Without this, the service would authenticate with whatever stale
    CROO_* values happened to be in the shell, which is exactly what caused the
    websocket handshake to be rejected with HTTP 401: the wrong key was sent.

    This file is treated as authoritative for the service, so it overrides any
    pre-existing value in the environment. Parsing is intentionally minimal
    (KEY=VALUE, optional surrounding quotes, optional leading "export", comments
    and blank lines skipped) which covers this repo's .env format without adding
    a dependency. Returns the names loaded (never the values) for a one line log.
    """
    if not path.exists():
        return []
    loaded: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        if not key:
            continue
        os.environ[key] = val
        loaded.append(key)
    return loaded


# Load the .env colocated with this module, before any env var is read. Doing it
# at import time means it is in place for both request handlers and the startup
# keepalive, regardless of the process working directory.
_ENV_PATH = Path(__file__).with_name(".env")
_LOADED_ENV_NAMES = _load_env_file(_ENV_PATH)
if _LOADED_ENV_NAMES:
    # Names only, never values: the API key must never reach the logs.
    logger.info("loaded %s from %s", ", ".join(sorted(_LOADED_ENV_NAMES)), _ENV_PATH)

from croo import (  # noqa: E402 - imported after .env load so nothing reads env first
    AgentClient,
    APIError,
    Config,
    InsufficientBalanceError,
    ListOptions,
    NegotiateOrderRequest,
    NegotiationStatus,
)

# Values of DISPATCH_WS_KEEPALIVE that turn on auto-connect at startup.
_TRUTHY = {"1", "true", "yes", "on"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Optionally open the websocket keepalive at startup and always close it at shutdown.

    Auto-connect is best effort: if it fails (missing CROO_WS_URL, a bad url, a
    duplicate-key rejection) the service still starts and serves the order
    endpoints, and the failure is logged so an operator can open presence
    manually via POST /presence/connect.
    """
    if os.environ.get("DISPATCH_WS_KEEPALIVE", "").strip().lower() in _TRUTHY:
        try:
            await _presence.connect()
            logger.info("websocket keepalive opened at startup")
        except Exception as err:  # noqa: BLE001 - never block startup on presence
            logger.warning("startup websocket keepalive failed: %s", err)
    try:
        yield
    finally:
        await _presence.disconnect()


app = FastAPI(
    title="Dispatch CAP service",
    description="HTTP wrapper around the proven croo SDK calls for the Node backend.",
    version="0.3.0",
    lifespan=lifespan,
)

# Defaults for the /orders/place acceptance wait. These bound how long a single
# place call blocks waiting for the provider to accept and an order to be
# created. They only cover acceptance, never settlement.
DEFAULT_PLACE_WAIT_SECONDS = 20.0
DEFAULT_PLACE_POLL_INTERVAL_SECONDS = 2.0
# Hard ceiling so a caller cannot make the service block for an unreasonable
# time; the Node dispatch route must stay responsive.
MAX_PLACE_WAIT_SECONDS = 120.0
# Bound on how deep the buyer order list is scanned per poll when matching a
# negotiation_id. Generous for a single requester demo, still bounded.
_ORDER_SCAN_PAGE_SIZE = 50
_ORDER_SCAN_MAX_PAGES = 10


class _ServiceNotConfigured(Exception):
    """Raised when a required env var is absent. Carries only names, no values."""

    def __init__(self, missing: list[str]) -> None:
        self.missing = missing
        super().__init__("missing required environment variables: " + ", ".join(missing))


def _require_env() -> tuple[str, str, str]:
    """Return (base_url, api_key, ws_url) or raise if the required ones are missing.

    Called at the start of every SDK backed request so a misconfigured process
    fails with a clear message instead of a confusing SDK level error. The api
    key value is never included in any raised message.
    """
    base_url = os.environ.get("CROO_BASE_URL", "")
    api_key = os.environ.get("CROO_API_KEY", "")
    ws_url = os.environ.get("CROO_WS_URL", "")

    missing = []
    if not base_url:
        missing.append("CROO_BASE_URL")
    if not api_key:
        missing.append("CROO_API_KEY")
    if missing:
        raise _ServiceNotConfigured(missing)

    return base_url, api_key, ws_url


def _require_ws_env() -> tuple[str, str, str]:
    """Like _require_env, but also requires CROO_WS_URL for the presence keepalive.

    The websocket connection needs a ws url, so this is stricter than the order
    endpoints. The api key value is never included in any raised message.
    """
    base_url, api_key, ws_url = "", "", ""
    try:
        base_url, api_key, ws_url = _require_env()
    except _ServiceNotConfigured as err:
        missing = list(err.missing)
    else:
        missing = []
    if not ws_url:
        missing.append("CROO_WS_URL")
    if missing:
        raise _ServiceNotConfigured(missing)
    return base_url, api_key, ws_url


def _build_client() -> AgentClient:
    """Create a fresh AgentClient, matching the proven per call pattern in scripts/.

    The scripts create a client, make one call, and close it. We do the same per
    request rather than sharing a long lived client, which keeps behavior
    identical to what has already been verified to work and avoids assuming the
    client is safe to reuse across concurrent requests.
    """
    base_url, api_key, ws_url = _require_env()
    # Only pass ws_url when set. The negotiate and get_order paths do not use a
    # websocket, and the scripts that only negotiate build Config(base_url=...)
    # without a ws_url at all.
    if ws_url:
        config = Config(base_url=base_url, ws_url=ws_url)
    else:
        config = Config(base_url=base_url)
    return AgentClient(config, api_key)


class _Presence:
    """Owns the single long lived websocket that makes Dispatch appear ONLINE.

    Exactly one connection exists per process. The croo backend rejects a second
    websocket sharing the same SDK key (policy violation, surfaced via
    EventStream.err), so opening more than one would defeat itself; the lock and
    the "already active" short circuit keep it to one. This holds a dedicated
    AgentClient separate from the per request order clients, so closing those
    never touches the presence socket.

    No event handlers are registered. The socket exists only to keep the agent
    marked online; the SDK's EventStream handles ping and auto-reconnect on its
    own, so a transient network drop self heals without intervention.
    """

    def __init__(self) -> None:
        self._client: Optional[AgentClient] = None
        self._stream: Any = None  # croo EventStream
        self._connected_at: Optional[float] = None
        self._lock = asyncio.Lock()

    def _active_error(self) -> Optional[str]:
        """The stream's last fatal error as a string, or None while healthy."""
        if self._stream is None:
            return None
        err = self._stream.err()
        return str(err) if err is not None else None

    async def connect(self) -> None:
        """Open the keepalive, or recover it if a previous socket died.

        Idempotent: if a healthy socket is already held this is a no op. If a
        socket is held but has recorded a fatal error (for example a duplicate
        key rejection), it is torn down and reopened. Raises _ServiceNotConfigured
        if CROO_WS_URL (or another required var) is missing, and re-raises any
        error from the underlying dial.
        """
        async with self._lock:
            if self._stream is not None and self._active_error() is None:
                return  # already online, nothing to do

            # A dead-but-held stream: clean it up before reconnecting.
            await self._teardown_locked()

            base_url, api_key, ws_url = _require_ws_env()
            client = AgentClient(Config(base_url=base_url, ws_url=ws_url), api_key)
            try:
                stream = await client.connect_websocket()
            except Exception:
                await client.close()
                raise
            self._client = client
            self._stream = stream
            self._connected_at = time.time()

    async def disconnect(self) -> None:
        """Close the keepalive if it is open. Safe to call when already closed."""
        async with self._lock:
            await self._teardown_locked()

    async def _teardown_locked(self) -> None:
        """Close stream and client. Caller must hold the lock."""
        if self._stream is not None:
            try:
                await self._stream.close()
            except Exception:  # noqa: BLE001 - closing must never raise out
                pass
            self._stream = None
        if self._client is not None:
            try:
                await self._client.close()
            except Exception:  # noqa: BLE001
                pass
            self._client = None
        self._connected_at = None

    def status(self) -> dict:
        """A non sensitive snapshot of the keepalive state. Never includes the key."""
        held = self._stream is not None
        last_error = self._active_error()
        return {
            "keepalive_held": held,
            # online is the honest signal: we hold a socket and it has not
            # recorded a fatal error.
            "online": held and last_error is None,
            "connected_since_epoch": self._connected_at,
            "uptime_seconds": (
                round(time.time() - self._connected_at, 1)
                if self._connected_at is not None
                else None
            ),
            "ws_url_configured": bool(os.environ.get("CROO_WS_URL")),
            "last_error": last_error,
        }


# The single process wide keepalive instance.
_presence = _Presence()


def _to_dict(obj: Any) -> dict:
    """Serialize an SDK dataclass (Negotiation, Order) to a plain JSON safe dict.

    Field names are left exactly as the SDK defines them (snake_case) so the
    Node side can consume the object without renaming anything.
    """
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)
    # Should not happen for the calls we make, but never fabricate a shape.
    raise TypeError("expected an SDK dataclass, got " + type(obj).__name__)


def _not_configured_response(err: _ServiceNotConfigured) -> JSONResponse:
    """503 response listing the missing env var names (values are never shown)."""
    return JSONResponse(
        status_code=503,
        content={"error": "not_configured", "missing": err.missing},
    )


def _error_response(err: Exception) -> JSONResponse:
    """Map an SDK exception to an HTTP error carrying its real details.

    Never turns a real failure into a fake success. croo APIError has an upstream
    http_status which is passed straight through so a 400 stays a 400 and a 404
    stays a 404. InsufficientBalanceError becomes a 402. Anything else is a 502,
    treating an unexpected SDK or network failure as an upstream problem.
    """
    if isinstance(err, APIError):
        status = err.http_status if 400 <= int(err.http_status) <= 599 else 502
        return JSONResponse(
            status_code=status,
            content={
                "error": "cap_api_error",
                "message": str(err),
                "code": err.code,
                "reason": err.reason,
                "http_status": err.http_status,
            },
        )
    if isinstance(err, InsufficientBalanceError):
        return JSONResponse(
            status_code=402,
            content={"error": "insufficient_balance", "message": str(err)},
        )
    return JSONResponse(
        status_code=502,
        content={"error": "cap_call_failed", "message": str(err)},
    )


class NegotiateRequest(BaseModel):
    """Body for POST /orders/negotiate and the base for POST /orders/place.

    Every field maps one to one onto a real NegotiateOrderRequest field. None is
    treated as "not supplied". service_id is required. requester_agent_id falls
    back to DISPATCH_REQUESTER_AGENT_ID when omitted. metadata, fund_amount, and
    fund_token are optional passthroughs; fund_amount and fund_token are proven
    in scripts/verify_cap_funded.py and are what make an order actually payable.
    """

    service_id: str
    requirements: Optional[str] = None
    requester_agent_id: Optional[str] = None
    metadata: Optional[str] = None
    fund_amount: Optional[str] = None
    fund_token: Optional[str] = None


class PlaceRequest(NegotiateRequest):
    """Body for POST /orders/place: a NegotiateRequest plus acceptance wait tuning.

    wait_seconds bounds how long the call blocks waiting for the provider to
    accept and an order to be created. poll_interval_seconds is the gap between
    checks. Both are optional with safe defaults and are clamped to sane ranges.
    """

    wait_seconds: Optional[float] = None
    poll_interval_seconds: Optional[float] = None


def _build_negotiate_request(body: NegotiateRequest) -> NegotiateOrderRequest:
    """Turn a request body into a real NegotiateOrderRequest.

    Only supplied fields are set, letting the SDK apply its own defaults for the
    rest. requester_agent_id resolves to the body value, else the Dispatch
    default from the environment, else the SDK default (empty, which the SDK
    reads as "the agent bound to this SDK key").
    """
    requester_agent_id = body.requester_agent_id
    if requester_agent_id is None:
        requester_agent_id = os.environ.get("DISPATCH_REQUESTER_AGENT_ID", "")

    kwargs: dict[str, str] = {"service_id": body.service_id}
    if body.requirements is not None:
        kwargs["requirements"] = body.requirements
    if requester_agent_id:
        kwargs["requester_agent_id"] = requester_agent_id
    if body.metadata is not None:
        kwargs["metadata"] = body.metadata
    if body.fund_amount is not None:
        kwargs["fund_amount"] = body.fund_amount
    if body.fund_token is not None:
        kwargs["fund_token"] = body.fund_token

    return NegotiateOrderRequest(**kwargs)


async def _find_order_for_negotiation(client: AgentClient, negotiation_id: str):
    """Return the buyer Order whose negotiation_id matches, or None if not yet found.

    The SDK has no "get order by negotiation" call and a Negotiation carries no
    order_id, so the requester side path to an order_id is to list the buyer's
    orders and match on the negotiation_id field that every Order carries. The
    scan is paged and bounded; for a single requester placing one order at a
    time the match is on the first page, and deeper pages are a safety net.
    """
    page = 1
    while page <= _ORDER_SCAN_MAX_PAGES:
        orders = await client.list_orders(
            ListOptions(role="buyer", page=page, page_size=_ORDER_SCAN_PAGE_SIZE)
        )
        for order in orders:
            if order.negotiation_id == negotiation_id and order.order_id:
                return order
        if len(orders) < _ORDER_SCAN_PAGE_SIZE:
            break
        page += 1
    return None


@app.get("/health")
async def health() -> dict:
    """Liveness plus a non sensitive view of configuration.

    Reports only whether each env var is present, never its value. The api key
    is never included, even partially.
    """
    return {
        "status": "ok",
        "service": "dispatch-cap-service",
        "config": {
            "CROO_BASE_URL": bool(os.environ.get("CROO_BASE_URL")),
            "CROO_API_KEY": bool(os.environ.get("CROO_API_KEY")),
            "CROO_WS_URL": bool(os.environ.get("CROO_WS_URL")),
            "DISPATCH_REQUESTER_AGENT_ID": bool(
                os.environ.get("DISPATCH_REQUESTER_AGENT_ID")
            ),
        },
    }


@app.post("/orders/negotiate")
async def negotiate(body: NegotiateRequest) -> Any:
    """Place a real negotiate_order call and return the full Negotiation as JSON.

    Returns the SDK Negotiation serialized as is, which includes negotiation_id,
    status, and expires_at among other fields. This does not resolve an order_id;
    use POST /orders/place for that. Errors from the SDK are surfaced as real
    HTTP errors; success is never faked.
    """
    try:
        _require_env()
    except _ServiceNotConfigured as err:
        return _not_configured_response(err)

    req = _build_negotiate_request(body)
    client = _build_client()
    try:
        negotiation = await client.negotiate_order(req)
    except Exception as err:  # noqa: BLE001 - surface any real SDK/network failure
        return _error_response(err)
    finally:
        await client.close()

    return _to_dict(negotiation)


@app.post("/orders/place")
async def place(body: PlaceRequest) -> Any:
    """Negotiate, then resolve to an order_id: the bridge behind placeOrder.

    Steps:
      1. negotiate_order to create the negotiation.
      2. Poll the buyer's orders for one whose negotiation_id matches, which
         appears once the provider accepts. Between polls, check the negotiation
         itself so a rejected or expired negotiation fails fast instead of
         waiting out the full timeout.
      3. On success return capOrderRef (the order_id) plus the full order.

    It waits only for acceptance, never for payment or delivery. On timeout it
    returns 504 with the negotiation_id so the caller can keep polling later
    rather than being told the order failed outright.
    """
    try:
        _require_env()
    except _ServiceNotConfigured as err:
        return _not_configured_response(err)

    wait_seconds = body.wait_seconds
    if wait_seconds is None:
        wait_seconds = DEFAULT_PLACE_WAIT_SECONDS
    wait_seconds = max(0.0, min(float(wait_seconds), MAX_PLACE_WAIT_SECONDS))

    interval = body.poll_interval_seconds
    if interval is None:
        interval = DEFAULT_PLACE_POLL_INTERVAL_SECONDS
    interval = max(0.25, float(interval))

    req = _build_negotiate_request(body)
    client = _build_client()
    try:
        # 1. Create the negotiation. A failure here surfaces immediately.
        try:
            negotiation = await client.negotiate_order(req)
        except Exception as err:  # noqa: BLE001
            return _error_response(err)

        negotiation_id = negotiation.negotiation_id

        # 2. Poll for the resulting order, bailing early on a terminal negotiation.
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                order = await _find_order_for_negotiation(client, negotiation_id)
            except APIError as err:
                # A real API error (bad key, invalid params, invalid agent
                # status) will not fix itself by retrying, so surface it now.
                return _error_response(err)
            except Exception:  # noqa: BLE001
                # Treat a transient non-API error as retryable until the deadline.
                order = None

            if order is not None:
                return {
                    "capOrderRef": order.order_id,
                    "order_id": order.order_id,
                    "negotiation_id": negotiation_id,
                    "negotiation_status": negotiation.status,
                    "order": _to_dict(order),
                }

            # No order yet. Check whether the negotiation has terminally failed.
            try:
                negotiation = await client.get_negotiation(negotiation_id)
            except APIError as err:
                return _error_response(err)
            except Exception:  # noqa: BLE001
                pass  # transient; try again next tick

            if negotiation.status == NegotiationStatus.REJECTED:
                return JSONResponse(
                    status_code=409,
                    content={
                        "error": "negotiation_rejected",
                        "message": "provider rejected the negotiation",
                        "negotiation_id": negotiation_id,
                        "reject_reason": negotiation.reject_reason,
                    },
                )
            if negotiation.status == NegotiationStatus.EXPIRED:
                return JSONResponse(
                    status_code=409,
                    content={
                        "error": "negotiation_expired",
                        "message": "negotiation expired before an order was created",
                        "negotiation_id": negotiation_id,
                    },
                )

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            await asyncio.sleep(min(interval, remaining))

        # 3. Acceptance did not happen inside the wait window. Not a hard failure:
        # the negotiation may still be accepted shortly. Hand back the
        # negotiation_id and its last known status so the caller can decide.
        return JSONResponse(
            status_code=504,
            content={
                "error": "order_not_ready",
                "message": (
                    "negotiation was created but no order appeared within "
                    f"{wait_seconds:g} seconds; the provider may not have accepted yet"
                ),
                "negotiation_id": negotiation_id,
                "negotiation_status": negotiation.status,
            },
        )
    finally:
        await client.close()


@app.get("/orders/{order_id}")
async def get_order(order_id: str) -> Any:
    """Fetch a real Order by id and return the full Order object as JSON.

    The returned field set matches the croo Order dataclass exactly, which is
    the same shape the Node capClient.ts Order interface expects.
    """
    try:
        _require_env()
    except _ServiceNotConfigured as err:
        return _not_configured_response(err)

    client = _build_client()
    try:
        order = await client.get_order(order_id)
    except Exception as err:  # noqa: BLE001 - surface any real SDK/network failure
        return _error_response(err)
    finally:
        await client.close()

    return _to_dict(order)


@app.get("/presence")
async def presence_status() -> dict:
    """Report whether the websocket keepalive is held and whether it looks online."""
    return _presence.status()


@app.post("/presence/connect")
async def presence_connect() -> Any:
    """Open (or recover) the websocket keepalive so Dispatch shows ONLINE.

    Idempotent: calling it while already online just returns the current status.
    Returns 503 if CROO_WS_URL (or another required var) is missing, and surfaces
    a real dial or auth failure via the shared error mapping.
    """
    try:
        await _presence.connect()
    except _ServiceNotConfigured as err:
        return _not_configured_response(err)
    except Exception as err:  # noqa: BLE001 - surface a real connect failure
        return _error_response(err)
    return _presence.status()


@app.post("/presence/disconnect")
async def presence_disconnect() -> dict:
    """Close the websocket keepalive. Safe to call when it is already closed."""
    await _presence.disconnect()
    return _presence.status()
