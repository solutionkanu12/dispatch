import 'dotenv/config';
import express from 'express';
import { Pool } from 'pg';
import agentsRouter from './routes/agents';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Create a .env file based on .env.example.');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const app = express();
app.use(express.json());

app.use('/api/agents', agentsRouter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'error', error: (error as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`Dispatch backend listening on port ${PORT}`);
});
