const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432'),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:      { rejectUnauthorized: false },
});

// Verify connection on startup
pool.connect().then(() => {
  console.log('[DB] Connected to PostgreSQL');
}).catch((err) => {
  console.error('[DB] Connection failed:', err.message);
  process.exit(1);
});

module.exports = pool;
