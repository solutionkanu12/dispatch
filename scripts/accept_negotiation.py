import asyncio
import dataclasses
import os
import sys

from croo import AgentClient, Config


def dump(label, obj):
    print(label)
    print("type:", type(obj).__module__ + "." + type(obj).__name__)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        for field in dataclasses.fields(obj):
            print("  " + field.name + " =", repr(getattr(obj, field.name)))
    else:
        print("  repr:", repr(obj))


async def main():
    api_key = os.environ.get("CROO_API_KEY", "")
    base_url = os.environ.get("CROO_BASE_URL", "")
    if not api_key or not base_url:
        print("Set CROO_API_KEY and CROO_BASE_URL first.")
        sys.exit(1)

    if len(sys.argv) < 2:
        print("Usage: python3 scripts/accept_negotiation.py <negotiation_id>")
        sys.exit(1)

    negotiation_id = sys.argv[1]

    client = AgentClient(Config(base_url=base_url), api_key)
    try:
        result = await client.accept_negotiation(negotiation_id)
        dump("accept_negotiation returned:", result)

        print()
        again = await client.get_negotiation(negotiation_id)
        dump("get_negotiation after accept:", again)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())