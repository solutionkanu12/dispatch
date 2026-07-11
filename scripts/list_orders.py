import asyncio
import dataclasses
import os
import sys

from croo import AgentClient, Config, ListOptions


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
    if not api_key or not base_url:
        print("Set CROO_API_KEY and CROO_BASE_URL first.")
        sys.exit(1)

    client = AgentClient(Config(base_url=base_url), api_key)
    try:
        orders = await client.list_orders(ListOptions(role="buyer"))
        print("list_orders returned", len(orders), "orders")
        for order in orders:
            print()
            dump(order)

        print()
        negotiations = await client.list_negotiations(ListOptions(role="requester"))
        print("list_negotiations returned", len(negotiations), "negotiations")
        for negotiation in negotiations:
            print()
            dump(negotiation)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())