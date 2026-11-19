const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { RepositorioViajesPostgres } = require('../../servicios/viajes/src/infra/db/repositorio-viajes-postgres');
const { aplicarMigraciones } = require('../../servicios/viajes/src/infra/db/aplicar-migraciones');
const { ConflictoDeEstado } = require('../../servicios/viajes/src/dominio/errores/errores');

function datosViaje(identificadorViaje, pasajeroId = crypto.randomUUID()) {
  return [
    identificadorViaje,
    pasajeroId,
    JSON.stringify({ latitud: -34, longitud: -58, direccion: 'Origen' }),
    JSON.stringify({ latitud: -35, longitud: -59, direccion: 'Destino' })
  ];
}

async function crearViaje(pool, identificadorViaje, pasajeroId) {
  await pool.query(
    `INSERT INTO viajes
      (id, pasajero_id, origen, destino, estado, creado_en, actualizado_en)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, 'REQUESTED', NOW(), NOW())`,
    datosViaje(identificadorViaje, pasajeroId)
  );
}

async function limpiarViajes(pool, identificadores) {
  await pool.query(
    'DELETE FROM historial_estados_viaje WHERE viaje_id = ANY($1::uuid[])',
    [identificadores]
  );
  await pool.query('DELETE FROM viajes WHERE id = ANY($1::uuid[])', [identificadores]);
}

function crearPoolPrueba() {
  return new Pool({ connectionString: process.env.TEST_DATABASE_URL });
}

test('50 aceptaciones simultáneas producen exactamente un ganador', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const pool = crearPoolPrueba();
  const repositorio = new RepositorioViajesPostgres({ pool });
  const identificadorViaje = crypto.randomUUID();
  let viajeCreado = false;
  try {
    await aplicarMigraciones(pool);
    await crearViaje(pool, identificadorViaje);
    viajeCreado = true;

    const resultados = await Promise.allSettled(Array.from({ length: 50 }, () =>
      repositorio.asignarConductor({
        identificadorViaje,
        conductorId: crypto.randomUUID()
      })
    ));
    const ganadores = resultados.filter((resultado) => resultado.status === 'fulfilled');
    const perdedores = resultados.filter((resultado) => resultado.status === 'rejected');
    assert.equal(ganadores.length, 1);
    assert.equal(perdedores.length, 49);
    perdedores.forEach((resultado) => assert.ok(resultado.reason instanceof ConflictoDeEstado));
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
        await limpiarViajes(pool, [identificadorViaje]);
      }
    } finally {
      await pool.end();
    }
  }
});

test('cancelación y aceptación concurrentes dejan un único resultado válido', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const pool = crearPoolPrueba();
  const repositorio = new RepositorioViajesPostgres({ pool });
  const identificadorViaje = crypto.randomUUID();
  const pasajeroId = crypto.randomUUID();
  const conductorId = crypto.randomUUID();
  let viajeCreado = false;
  try {
    await aplicarMigraciones(pool);
    await crearViaje(pool, identificadorViaje, pasajeroId);
    viajeCreado = true;
    const resultados = await Promise.allSettled([
      repositorio.cancelarViaje({
        identificadorViaje,
        actorId: pasajeroId
      }),
      repositorio.asignarConductor({ identificadorViaje, conductorId })
    ]);
    const ganadores = resultados.filter((resultado) => resultado.status === 'fulfilled');
    const perdedores = resultados.filter((resultado) => resultado.status === 'rejected');
    assert.equal(ganadores.length, 1);
    assert.equal(perdedores.length, 1);
    assert.ok(perdedores[0].reason instanceof ConflictoDeEstado);

    const final = (await pool.query(
      'SELECT estado, conductor_id FROM viajes WHERE id = $1',
      [identificadorViaje]
    )).rows[0];
    if (final.estado === 'CANCELLED') {
      assert.equal(final.conductor_id, null);
    } else {
      assert.equal(final.estado, 'ASSIGNED');
      assert.equal(final.conductor_id, conductorId);
    }
  } finally {
    try {
      if (viajeCreado) await limpiarViajes(pool, [identificadorViaje]);
    } finally {
      await pool.end();
    }
  }
});

test('un conductor con un viaje activo no puede aceptar otro', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const pool = crearPoolPrueba();
  const repositorio = new RepositorioViajesPostgres({ pool });
  const viajeActivo = crypto.randomUUID();
  const segundoViaje = crypto.randomUUID();
  const conductorId = crypto.randomUUID();
  let viajesCreados = false;
  try {
    await aplicarMigraciones(pool);
    await crearViaje(pool, viajeActivo);
    await crearViaje(pool, segundoViaje);
    viajesCreados = true;
    await repositorio.asignarConductor({
      identificadorViaje: viajeActivo,
      conductorId
    });
    await assert.rejects(
      () => repositorio.asignarConductor({
        identificadorViaje: segundoViaje,
        conductorId
      }),
      (error) => error instanceof ConflictoDeEstado &&
        error.message === 'El conductor ya tiene un viaje activo'
    );
  } finally {
    try {
      if (viajesCreados) await limpiarViajes(pool, [viajeActivo, segundoViaje]);
    } finally {
      await pool.end();
    }
  }
});
