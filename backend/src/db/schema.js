const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function getDb() {
  return pool;
}

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS platforms (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        currency TEXT DEFAULT 'GBP',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
        share_name TEXT NOT NULL,
        ticker TEXT NOT NULL,
        exchange TEXT NOT NULL DEFAULT 'LSE',
        purchase_date DATE NOT NULL,
        purchase_price NUMERIC NOT NULL,
        units NUMERIC NOT NULL,
        risk_level TEXT NOT NULL CHECK(risk_level IN ('Low','Medium','High','Very High')),
        risk_score INTEGER CHECK(risk_score BETWEEN 1 AND 5),
        currency TEXT DEFAULT 'GBP',
        notes TEXT,
        manual_price NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS live_prices (
        id SERIAL PRIMARY KEY,
        ticker TEXT NOT NULL,
        exchange TEXT NOT NULL,
        price NUMERIC NOT NULL,
        currency TEXT DEFAULT 'USD',
        source TEXT,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(ticker, exchange)
      );

      CREATE TABLE IF NOT EXISTS historical_valuations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        valuation_date DATE NOT NULL,
        total_invested NUMERIC NOT NULL,
        total_value NUMERIC NOT NULL,
        total_pnl NUMERIC NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
}

module.exports = { getDb, initSchema, pool };
