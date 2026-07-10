"""Standalone CAP SDK smoke test.

Proves that a single croo-sdk negotiate_order call works end to end against
the real CROO network, before any of that logic is built into the Node
backend. This script is intentionally separate from the backend and shares
no code with it.

It reads every real value from the environment so nothing is hardcoded:

  CROO_API_KEY              the SDK key, sent as the X-SDK-Key header
  CROO_BASE_URL             the CROO API base URL (required by Config)
  CROO_VERIMATH_SERVICE_ID  VeriMath's service id for negotiate_order

If any of those are missing the script prints what is needed and exits
before making the negotiate_order call.
"""

import asyncio
import dataclasses
import os
import sys

from croo import AgentClient, Config, NegotiateOrderRequest

# Fixed test input for this smoke test. VeriMath performs computational
# verification, so a small provable claim is enough to exercise the flow.
TEST_REQUIREMENTS = '{"op": "verify_prime", "n": 17}'


def read_env():
    """Return (api_key, base_url, service_id), or exit if any are missing."""
    api_key = os.environ.get("CROO_API_KEY", "")
    base_url = os.environ.get("CROO_BASE_URL", "")
    service_id = os.environ.get("CROO_VERIMATH_SERVICE_ID", "")

    missing = []
    if not api_key:
        missing.append("CROO_API_KEY")
    if not base_url:
        missing.append("CROO_BASE_URL")
    if not service_id:
        missing.append("CROO_VERIMATH_SERVICE_ID")

    if missing:
        print("Cannot run: missing required environment variables:")
        for name in missing:
            print("  " + name)
        print()
        print("Set all three, then run this script again. The negotiate_order")
        print("call is not made until every value above is present.")
        sys.exit(1)

    return api_key, base_url, service_id


def dump_result(result):
    """Print every field that came back, without assuming its shape."""
    print("type:", type(result).__module__ + "." + type(result).__name__)
    if dataclasses.is_dataclass(result) and not isinstance(result, type):
        for field in dataclasses.fields(result):
            print("  " + field.name + " =", repr(getattr(result, field.name)))
    else:
        print("  repr:", repr(result))


async def main():
    api_key, base_url, service_id = read_env()

    config = Config(base_url=base_url)
    client = AgentClient(config, api_key)

    req = NegotiateOrderRequest(
        service_id=service_id,
        requirements=TEST_REQUIREMENTS,
    )

    print("Calling negotiate_order against VeriMath...")
    print("  service_id:", service_id)
    print("  requirements:", TEST_REQUIREMENTS)
    print()

    try:
        result = await client.negotiate_order(req)
    finally:
        await client.close()

    print("negotiate_order returned:")
    dump_result(result)


if __name__ == "__main__":
    asyncio.run(main())
