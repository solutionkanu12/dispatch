import asyncio
import dataclasses
import os
import sys

from croo import AgentClient, Config, NegotiateOrderRequest

TEST_REQUIREMENTS = '{"op": "verify_prime", "n": 17}'
USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
FUND_AMOUNT = "10000"  # 0.01 USDC in base units (6 decimals)


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
    service_id = os.environ.get("CROO_VERIMATH_SERVICE_ID", "")

    if not api_key or not base_url or not service_id:
        print("Missing env vars.")
        sys.exit(1)

    client = AgentClient(Config(base_url=base_url), api_key)

    req = NegotiateOrderRequest(
        service_id=service_id,
        requirements=TEST_REQUIREMENTS,
        fund_amount=FUND_AMOUNT,
        fund_token=USDC_BASE,
    )

    print("Calling negotiate_order WITH fund fields set...")
    try:
        result = await client.negotiate_order(req)
    finally:
        await client.close()

    print("negotiate_order returned:")
    dump(result)


if __name__ == "__main__":
    asyncio.run(main())