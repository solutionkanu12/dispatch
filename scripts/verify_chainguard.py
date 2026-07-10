import asyncio
import dataclasses
import os
import sys

from croo import AgentClient, Config, NegotiateOrderRequest

TEST_REQUIREMENTS = '{"text": "0x6B175474E89094C44Da98b954EedeAC495271d0F"}'


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
    service_id = os.environ.get("CROO_CHAINGUARD_SERVICE_ID", "")

    missing = []
    if not api_key:
        missing.append("CROO_API_KEY")
    if not base_url:
        missing.append("CROO_BASE_URL")
    if not service_id:
        missing.append("CROO_CHAINGUARD_SERVICE_ID")

    if missing:
        print("Cannot run: missing required environment variables:")
        for name in missing:
            print("  " + name)
        sys.exit(1)

    client = AgentClient(Config(base_url=base_url), api_key)

    req = NegotiateOrderRequest(
        service_id=service_id,
        requirements=TEST_REQUIREMENTS,
    )

    print("Calling negotiate_order against ChainGuard...")
    print("  service_id:", service_id)
    print("  requirements:", TEST_REQUIREMENTS)
    print()

    try:
        result = await client.negotiate_order(req)
    finally:
        await client.close()

    print("negotiate_order returned:")
    dump(result)


if __name__ == "__main__":
    asyncio.run(main())