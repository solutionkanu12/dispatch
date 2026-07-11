import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { Pool } from 'pg';
import agentsRouter from './routes/agents';
import dispatchRouter from './routes/dispatch';
import ordersRouter from './routes/orders';
import { setCapService } from './services/capService';
import { HttpCapService } from './services/httpCapService';

// The deployed frontend (Vercel) and local dev (Vite) origins allowed to call
// this API cross origin. The frontend builds absolute request URLs against
// VITE_API_URL in production (see frontend/src/lib/apiUrl.js), which makes
// every call cross origin from the browser's perspective, so without this the
// deployed frontend gets CORS errors calling the deployed backend. Local dev
// normally goes through Vite's own proxy (same origin, no CORS needed), but
// both localhost and 127.0.0.1 are kept here too for direct/manual testing
// against the backend without the proxy.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://dispatch-one-beige.vercel.app',
];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Create a .env file based on .env.example.');
  process.exit(1);
}

// Registers the real CAP integration: HttpCapService calls the running
// cap-service FastAPI process (cap-service/main.py) over HTTP. See
// server/services/capService.ts and httpCapService.ts for the full port and
// implementation. This does not verify cap-service is reachable at startup;
// a real placement attempt surfaces that as a normal failed order instead.
setCapService(new HttpCapService());

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

app.use('/api/agents', agentsRouter);
app.use('/api/dispatch', dispatchRouter);
app.use('/api/orders', ordersRouter);

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
