const fs = require('node:fs');
const path = require('node:path');
const { ejecutarEnTransaccion } = require('./transaccion');

const DIRECTORIO_MIGRACIONES = path.resolve(
  __dirname,
  '../../../../infraestructura/postgres/migrations'
);

async function aplicarMigraciones(pool) {
  const directorioBase = fs.realpathSync(
    DIRECTORIO_MIGRACIONES
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS esquema_migraciones (
      archivo VARCHAR(255) PRIMARY KEY,
      aplicado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const entradas = fs.readdirSync(directorioBase, {
    withFileTypes: true
  });

  const archivos = entradas
    .filter((entrada) =>
      entrada.isFile() &&
      /^\d+.*\.sql$/i.test(entrada.name)
    )
    .map((entrada) => entrada.name)
    .sort();

  for (const archivo of archivos) {
    const rutaMigracion = path.resolve(
      directorioBase,
      archivo
    );

    const rutaReal = fs.realpathSync(rutaMigracion);

    const rutaRelativa = path.relative(
      directorioBase,
      rutaReal
    );

    if (
      rutaRelativa.startsWith('..') ||
      path.isAbsolute(rutaRelativa)
    ) {
      throw new Error(
        `Ruta de migración no permitida: ${archivo}`
      );
    }

    await ejecutarEnTransaccion(pool, async (cliente) => {
      await cliente.query(
        "SELECT pg_advisory_xact_lock(hashtext('appurbe:migraciones'))"
      );

      const aplicada = await cliente.query(
        'SELECT archivo FROM esquema_migraciones WHERE archivo = $1',
        [archivo]
      );

      if (aplicada.rowCount > 0) return;

      const sql = fs.readFileSync(rutaReal, 'utf8');

      await cliente.query(sql);

      await cliente.query(
        'INSERT INTO esquema_migraciones (archivo) VALUES ($1)',
        [archivo]
      );
    });
  }
}

module.exports = {
  aplicarMigraciones,
  DIRECTORIO_MIGRACIONES
};
