const { Pool } = require('pg');
require('dotenv').config();

// If DATABASE_URL is set (e.g. from Neon or Supabase), use that connection
// string directly. Hosted providers like Neon require SSL, so we enable it
// whenever a connection string is used. Otherwise, fall back to individual
// PG_* fields for a local Postgres install.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || 'postgres',
      database: process.env.PG_DATABASE || 'url_shortener',
    });

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(1);
});

module.exports = pool;
