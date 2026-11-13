const { RepositorioIdempotencia } = require('../../dominio/puertos/repositorio-idempotencia');

class RepositorioIdempotenciaPostgres extends RepositorioIdempotencia {
  constructor({ pool, tiempoVidaMs = 24 * 60 * 60 * 1000 }) {
    super();
    if (!pool || typeof pool.query !== 'function') {
      throw new TypeError('RepositorioIdempotenciaPostgres requiere un pool PostgreSQL');
    }
    this.pool = pool;
    this.tiempoVidaMs = tiempoVidaMs;
  }

  async buscar(clave) {
    const resultado = await this.pool.query(
      `DELETE FROM idempotencia
        WHERE clave = $1 AND expira_en <= NOW()
        RETURNING clave`,
      [clave]
    );
    if (resultado.rowCount > 0) return null;

    const vigente = await this.pool.query(
      `SELECT huella, respuesta, EXTRACT(EPOCH FROM expira_en) * 1000 AS expira_en
         FROM idempotencia
        WHERE clave = $1 AND expira_en > NOW()`,
      [clave]
    );
    return vigente.rows[0] || null;
  }

  async guardar(clave, huella, respuesta) {
    const expiraEn = new Date(Date.now() + this.tiempoVidaMs);
    const resultado = await this.pool.query(
      `INSERT INTO idempotencia (clave, huella, respuesta, expira_en)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (clave) DO NOTHING`,
      [clave, huella, JSON.stringify(respuesta), expiraEn]
    );
    return resultado.rowCount === 1;
  }

  async limpiarExpiradas() {
    const resultado = await this.pool.query(
      'DELETE FROM idempotencia WHERE expira_en <= NOW()'
    );
    return resultado.rowCount;
  }
}

module.exports = { RepositorioIdempotenciaPostgres };
