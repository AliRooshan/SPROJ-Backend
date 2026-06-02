const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Supabase hosted Postgres
});

// Test connection and run migrations on startup
pool.connect(async (err, client, release) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Connected to Supabase PostgreSQL');
    
    // Auto-migrate: ensure password_resets table exists
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS password_resets (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      console.log('Database schema verified: password_resets table is ready.');
    } catch (dbErr) {
      console.error('Failed to run schema migrations for password_resets:', dbErr.message);
    } finally {
      release();
    }
  }
});

module.exports = pool;

