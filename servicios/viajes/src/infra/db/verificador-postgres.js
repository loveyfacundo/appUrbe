const { Pool } = require('pg');

function crearVerificadorPostgres({
  connectionString = process.env.DATABASE_URL,
  pool = new Pool({ connectionString })
} = {}) {
  async function verificar() {
    await pool.query('SELECT 1');
  }

  async function cerrar() {
    await pool.end();
  }

  return { verificar, cerrar, pool };
}

module.exports = { crearVerificadorPostgres };
