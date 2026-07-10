import asyncio
import dataclasses
import os
import sys

from croo import AgentClient, Config, NegotiateOrderRequest

TEST_REQUIREMENTS = '{"wallet_address": "0x000000000000000000000000000000000000dEaD"}'


def dump(obj):
    print("type:", type(obj).__module__ + "." + type(obj).__name__)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        for field in dataclasses.fields(obj):
            print("  " + field.name + " =", repr(getattr(obj, field.name)))
    else:
        print("  repr:", repr(obj))


async def main():
    api_key = os.environ.get("CROO_API_KEY", "")
    base_url = os.environ.get("CROO_BASE_URL", "")
    service_id = os.environ.get("CROO_POLYMARKET_SERVICE_ID", "")

    if not api_key or not base_url or not service_id:
        print("Missing env vars.")
        sys.exit(1)

    client = AgentClient(Config(base_url=base_url), api_key)

    req = NegotiateOrderRequest(
        service_id=service_id,
        requirements=TEST_REQUIREMENTS,
    )

    print("Calling negotiate_order against Polymarket agent...")
    try:
        result = await client.negotiate_order(req)
    finally:
        await client.close()

    print("negotiate_order returned:")
    dump(result)


if __name__ == "__main__":
    asyncio.run(main())