/**
 * Order read endpoints for the public ledger.
 *
 *   GET /api/orders      list, most recent first
 *   GET /api/orders/:id  single order detail, 404 if not found
 *
 * Both read through orderStore, whose row shape matches the orders table and
 * the order record described in PRD section 9.
 */

import { Router } from 'express';

import { getOrderById, listOrders } from '../services/orderStore';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const orders = await listOrders();
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ status: 'error', error: (error as Error).message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ status: 'error', error: 'Order not found.' });
    }
    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ status: 'error', error: (error as Error).message });
  }
});

export default router;
