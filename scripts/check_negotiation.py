import asyncio
import dataclasses
import os
import sys

from croo import AgentClient, Config


async def main():
    api_key = os.environ.get("CROO_API_KEY", "")
    base_url = os.environ.get("CROO_BASE_URL", "")
    if not api_key or not base_url:
        print("Set CROO_API_KEY and CROO_BASE_URL first.")
        sys.exit(1)

    if len(sys.argv) < 2:
        print("Usage: python3 scripts/check_negotiation.py <negotiation_id>")
        sys.exit(1)

    client = AgentClient(Config(base_url=base_url), api_key)
    try:
        result = await client.get_negotiation(sys.argv[1])
    finally:
        await client.close()

    print("get_negotiation returned:")
    print("type:", type(result).__module__ + "." + type(result).__name__)
    if dataclasses.is_dataclass(result) and not isinstance(result, type):
        for field in dataclasses.fields(result):
            print("  " + field.name + " =", repr(getattr(result, field.name)))
    else:
        print("  repr:", repr(result))


if __name__ == "__main__":
    asyncio.run(main())