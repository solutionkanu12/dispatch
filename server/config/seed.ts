import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

interface AgentRecord {
  id: string;
  name: string;
  cap_wallet: string;
  service_tags: string[];
  price_usdc: number;
  store_url: string;
  sla_minutes: number;
}

async function seed(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Create a .env file based on .env.example.');
    process.exit(1);
  }

  const agentsPath = path.join(__dirname, 'agents.json');
  const agents: AgentRecord[] = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    for (const agent of agents) {
      await pool.query(
        `INSERT INTO agents (id, name, cap_wallet, service_tags, price_usdc, store_url, sla_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           cap_wallet = EXCLUDED.cap_wallet,
           service_tags = EXCLUDED.service_tags,
           price_usdc = EXCLUDED.price_usdc,
           store_url = EXCLUDED.store_url,
           sla_minutes = EXCLUDED.sla_minutes`,
        [
          agent.id,
          agent.name,
          agent.cap_wallet,
          agent.service_tags,
          agent.price_usdc,
          agent.store_url,
          agent.sla_minutes,
        ]
      );
    }
    console.log(`Seeded ${agents.length} agents.`);
  } finally {
    await pool.end();
  }
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
