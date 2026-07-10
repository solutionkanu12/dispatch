import asyncio
import os
from croo import AgentClient, Config, NegotiateOrderRequest

async def main():
    client = AgentClient(
        Config(
            base_url=os.environ["CROO_BASE_URL"],
            ws_url=os.environ["CROO_WS_URL"],
        ),
        os.environ["CROO_API_KEY"],
    )

    negotiation = await client.negotiate_order(
        NegotiateOrderRequest(
            service_id="4562e560-3a4e-4b94-95a8-de1fc95cdec5",
            requester_agent_id="35d0f860-7a82-4a31-8b39-9b60b662d4d3",
            requirements='{"text": "hello from dispatch"}',
        )
    )

    print("negotiation_id:", negotiation.negotiation_id)
    print("status:", negotiation.status)

    await client.close()

asyncio.run(main())
