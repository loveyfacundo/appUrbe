const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { RepositorioViajesPostgres } = require('../../servicios/viajes/src/infra/db/repositorio-viajes-postgres');
const { aplicarMigraciones } = require('../../servicios/viajes/src/infra/db/aplicar-migraciones');
const { ConflictoDeEstado } = require('../../servicios/viajes/src/dominio/errores/errores');

test('dos aceptaciones simultáneas en PostgreSQL producen un solo ganador', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const repositorio = new RepositorioViajesPostgres({ pool });
  const identificadorViaje = crypto.randomUUID();
  const conductorA = crypto.randomUUID();
  const conductorB = crypto.randomUUID();
  let viajeCreado = false;
  try {
    await aplicarMigraciones(pool);
    await pool.query(
      `INSERT INTO viajes
        (id, pasajero_id, origen, destino, estado, creado_en, actualizado_en)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, 'REQUESTED', NOW(), NOW())`,
      [
        identificadorViaje,
        crypto.randomUUID(),
        JSON.stringify({ latitud: -34, longitud: -58, direccion: 'Origen' }),
        JSON.stringify({ latitud: -35, longitud: -59, direccion: 'Destino' })
      ]
    );
    viajeCreado = true;

    const resultados = await Promise.allSettled([
      repositorio.asignarConductor({ identificadorViaje, conductorId: conductorA }),
      repositorio.asignarConductor({ identificadorViaje, conductorId: conductorB })
    ]);
    const ganadores = resultados.filter((resultado) => resultado.status === 'fulfilled');
    const perdedores = resultados.filter((resultado) => resultado.status === 'rejected');
    assert.equal(ganadores.length, 1);
    assert.equal(perdedores.length, 1);
    assert.ok(perdedores[0].reason instanceof ConflictoDeEstado);
    assert.equal(
      (await pool.query(
        'SELECT conductor_id FROM viajes WHERE id = $1',
        [identificadorViaje]
      )).rows[0].conductor_id,
      ganadores[0].value.conductorId
    );
  } finally {
    try {
      if (viajeCreado) {
        await pool.query('DELETE FROM historial_estados_viaje WHERE viaje_id = $1', [identificadorViaje]);
        await pool.query('DELETE FROM viajes WHERE id = $1', [identificadorViaje]);
      }
    } finally {
      await pool.end();
    }
  }
});
