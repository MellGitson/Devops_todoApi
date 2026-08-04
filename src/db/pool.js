const { Pool } = require('pg');

const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = requiredEnvVars.filter((name) => !process.env[name]);

if (missing.length > 0) {
  throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Sans ce handler, une erreur sur un client inactif du pool (ex: base coupée) fait planter le process Node.
pool.on('error', (err) => {
  console.error('Erreur inattendue sur le pool PostgreSQL :', err.message);
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      description VARCHAR(1000) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'todo',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, ensureSchema };
