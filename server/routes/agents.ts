import { Router } from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, cap_wallet, service_tags, price_usdc::float8 AS price_usdc, store_url, sla_minutes
       FROM agents
       ORDER BY id`
    );
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ status: 'error', error: (error as Error).message });
  }
});

export default router;
