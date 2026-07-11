/**
 * POST /api/dispatch
 *
 * The core flow from docs/dispatch-architecture.md section 3:
 *   1. Validate request_text is a non-empty string (400 otherwise)
 *   2. Classify it to a provider agent (existing classifier)
 *   3. Create the order record with status 'queued'
 *   4. Place the CAP order, then move the record to 'routed' once a real
 *      cap_order_ref exists
 *   5. Return the order id immediately, never blocking on settlement
 *   6. Poll the order to settlement in the background and resolve the record to
 *      'settled' or 'failed'
 *
 * All CAP logic reuses existing pieces: the classifier, the CAP service port,
 * and pollOrderUntilSettled / assessOrder / toFailureReason from capClient.ts.
 * None of that logic is reimplemented here.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { classifyRequest } from '../services/classifier';
import { pollOrderUntilSettled, toFailureReason } from '../services/capClient';
import { getCapService } from '../services/capService';
import {
  buildQueuedOrder,
  getAgentPriceUsdc,
  insertQueuedOrder,
  markRouted,
  markSettled,
  markFailed,
} from '../services/orderStore';

const router = Router();

/**
 * IP based throttle protecting Dispatch's agent wallet during public demo
 * access (Task 11). Ten placements per minute per IP is generous for a live
 * demo yet bounds how fast a single source can spend the wallet. The provider
 * prices are small (VeriMath 0.01, ChainGuard 0.10 USDC), so this cap keeps
 * worst case spend per source modest while not getting in a demo's way.
 */
const dispatchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', error: 'Too many requests, please slow down.' },
});

/**
 * Poll a placed order to a terminal state and update its record. Runs in the
 * background, never awaited by the HTTP handler. pollOrderUntilSettled only
 * ever returns a terminal verdict (settled, rejected, or timed_out), so the
 * switch below is exhaustive over the states that can arrive here.
 */
async function settleInBackground(orderId: string, capOrderRef: string): Promise<void> {
  try {
    const verdict = await pollOrderUntilSettled(getCapService(), capOrderRef);
    switch (verdict.state) {
      case 'settled':
        // settlement_proof is the clear tx hash from the verdict. result_payload
        // is left null: fetching the delivered output needs the CAP delivery
        // wrapper (get_delivery), part of the missing Task 6 / 7 network layer.
        await markSettled(orderId, {
          settlementProof: verdict.clearTxHash,
          resultPayload: null,
        });
        break;
      case 'rejected':
        await markFailed(orderId, verdict.reason);
        break;
      case 'timed_out':
        await markFailed(orderId, 'order did not settle before its deadline');
        break;
    }
  } catch (error) {
    // Any error during polling still resolves the order to failed with a
    // readable reason, so it never stays stuck in 'routed'.
    await markFailed(orderId, toFailureReason({ source: 'error', error }));
  }
}

router.post('/', dispatchLimiter, async (req, res) => {
  const body = (req.body ?? {}) as { request_text?: unknown };
  const requestText = body.request_text;

  // 1. Validate.
  if (typeof requestText !== 'string' || requestText.trim().length === 0) {
    return res.status(400).json({
      status: 'error',
      error: 'request_text is required and must be a non-empty string.',
    });
  }

  // 2. Classify.
  const agentId = classifyRequest(requestText);

  try {
    // 3. Create the queued record. The price comes from the seeded agents table
    // so orders.price_usdc (NOT NULL) reflects the real provider price.
    const priceUsdc = await getAgentPriceUsdc(agentId);
    if (priceUsdc === null) {
      // The classifier returned an agent id that is not seeded. This is a
      // server misconfiguration rather than a bad request.
      return res.status(500).json({
        status: 'error',
        error: `No seeded agent found for id "${agentId}".`,
      });
    }

    const draft = buildQueuedOrder(requestText, priceUsdc, agentId);
    await insertQueuedOrder(draft);

    // 4. Place the CAP order. A throw here means placement failed (agent
    // offline, CAP error, or the integration not being wired yet); resolve the
    // order to failed with a readable reason and report it.
    try {
      const { capOrderRef } = await getCapService().placeOrder({
        agentId,
        requestText,
        priceUsdc,
      });
      await markRouted(draft.id, capOrderRef);

      // 5. Respond immediately with the order id. Settlement is not awaited.
      res.status(201).json({
        id: draft.id,
        status: 'routed',
        agent_id: agentId,
        cap_order_ref: capOrderRef,
      });

      // 6. Track settlement in the background.
      void settleInBackground(draft.id, capOrderRef);
    } catch (placementError) {
      const reason = toFailureReason({ source: 'error', error: placementError });
      await markFailed(draft.id, reason);
      return res.status(502).json({
        id: draft.id,
        status: 'failed',
        agent_id: agentId,
        failure_reason: reason,
      });
    }
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: (error as Error).message,
    });
  }
});

export default router;
