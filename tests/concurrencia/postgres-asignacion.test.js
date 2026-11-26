const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { RepositorioViajesPostgres } = require('../../servicios/viajes/src/infra/db/repositorio-viajes-postgres');
const { aplicarMigraciones } = require('../../servicios/viajes/src/infra/db/aplicar-migraciones');
const { ConflictoDeEstado } = require('../../servicios/viajes/src/dominio/errores/errores');
const { PoliticaCancelaciones } = require('../../servicios/viajes/src/dominio/politica-cancelaciones');
const { ESTADOS } = require('../../servicios/viajes/src/dominio/entidades/viaje');

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

async function limpiarViajes(pool, identificadores, usuarioIds = []) {
  await pool.query(
    'DELETE FROM historial_estados_viaje WHERE viaje_id = ANY($1::uuid[])',
    [identificadores]
  );
  await pool.query('DELETE FROM viajes WHERE id = ANY($1::uuid[])', [identificadores]);
  if (usuarioIds.length > 0) {
    await pool.query(
      'DELETE FROM bloqueos_cancelacion WHERE usuario_id = ANY($1::uuid[])',
      [usuarioIds]
    );
  }
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
  const conductorIds = Array.from({ length: 50 }, () => crypto.randomUUID());
  let viajeCreado = false;
  try {
    await aplicarMigraciones(pool);
    await crearViaje(pool, identificadorViaje);
    viajeCreado = true;

    const resultados = await Promise.allSettled(conductorIds.map((conductorId) =>
      repositorio.asignarConductor({
        identificadorViaje,
        conductorId
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
        await limpiarViajes(pool, [identificadorViaje], conductorIds);
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
        actor: { identificador: pasajeroId, roles: ['pasajero'] },
        motivo: 'Cancelación concurrente'
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
    if (final.estado === 'CANCELLED_BY_PASSENGER') {
      assert.equal(final.conductor_id, null);
    } else {
      assert.equal(final.estado, 'ASSIGNED');
      assert.equal(final.conductor_id, conductorId);
    }
  } finally {
    try {
      if (viajeCreado) await limpiarViajes(pool, [identificadorViaje], [pasajeroId, conductorId]);
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
      if (viajesCreados) await limpiarViajes(pool, [viajeActivo, segundoViaje], [conductorId]);
    } finally {
      await pool.end();
    }
  }
});

test('cancelación y llegada concurrentes calculan penalidad según el orden que gana', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const pool = crearPoolPrueba();
  const politicaCancelaciones = new PoliticaCancelaciones({
    penalidadPasajeroAlLlegarArs: 3145
  });
  const repositorio = new RepositorioViajesPostgres({ pool, politicaCancelaciones });
  const identificadorViaje = crypto.randomUUID();
  const pasajeroId = crypto.randomUUID();
  const conductorId = crypto.randomUUID();
  let viajeCreado = false;
  try {
    await aplicarMigraciones(pool);
    await crearViaje(pool, identificadorViaje, pasajeroId);
    viajeCreado = true;
    await repositorio.asignarConductor({ identificadorViaje, conductorId });
    const resultados = await Promise.allSettled([
      repositorio.cancelarViaje({
        identificadorViaje,
        actor: { identificador: pasajeroId, roles: ['pasajero'] },
        motivo: 'Cancelación contra llegada',
        politicaCancelaciones
      }),
      repositorio.actualizarEstadoOperativo({
        identificadorViaje,
        actorId: conductorId,
        estado: ESTADOS.EN_ORIGEN
      })
    ]);
    const cancelacion = resultados[0];
    const llegada = resultados[1];
    const final = (await pool.query(
      'SELECT estado FROM viajes WHERE id = $1',
      [identificadorViaje]
    )).rows[0];
    const historial = (await pool.query(
      `SELECT estado, estado_previo, motivo, penalidad_ars
         FROM historial_estados_viaje
        WHERE viaje_id = $1 AND estado = 'CANCELLED_BY_PASSENGER'`,
      [identificadorViaje]
    )).rows[0];

    if (cancelacion.status === 'rejected') {
      assert.ok(cancelacion.reason instanceof ConflictoDeEstado);
      assert.equal(llegada.status, 'fulfilled');
      assert.equal(final.estado, 'DRIVER_ARRIVING');
      assert.equal(historial, undefined);
    } else {
      assert.equal(final.estado, 'CANCELLED_BY_PASSENGER');
      assert.equal(historial.motivo, 'Cancelación contra llegada');
      assert.equal(llegada.status, 'fulfilled');
      assert.equal(historial.estado_previo, 'DRIVER_ARRIVING');
      assert.equal(historial.penalidad_ars, 3145);
    }
  } finally {
    try {
      if (viajeCreado) {
        await limpiarViajes(pool, [identificadorViaje], [pasajeroId, conductorId]);
      }
    } finally {
      await pool.end();
    }
  }
});

test('cancelación e inicio concurrentes dejan el viaje cancelado o iniciado, nunca ambos', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const pool = crearPoolPrueba();
  const politicaCancelaciones = new PoliticaCancelaciones({
    penalidadPasajeroAlLlegarArs: 3145
  });
  const repositorio = new RepositorioViajesPostgres({ pool, politicaCancelaciones });
  const identificadorViaje = crypto.randomUUID();
  const pasajeroId = crypto.randomUUID();
  const conductorId = crypto.randomUUID();
  let viajeCreado = false;
  try {
    await aplicarMigraciones(pool);
    await crearViaje(pool, identificadorViaje, pasajeroId);
    viajeCreado = true;
    await repositorio.asignarConductor({ identificadorViaje, conductorId });
    await repositorio.actualizarEstadoOperativo({
      identificadorViaje,
      actorId: conductorId,
      estado: ESTADOS.EN_ORIGEN
    });
    const resultados = await Promise.allSettled([
      repositorio.cancelarViaje({
        identificadorViaje,
        actor: { identificador: pasajeroId, roles: ['pasajero'] },
        motivo: 'Cancelación contra inicio',
        politicaCancelaciones
      }),
      repositorio.actualizarEstadoOperativo({
        identificadorViaje,
        actorId: conductorId,
        estado: ESTADOS.EN_CURSO
      })
    ]);
    const cancelacion = resultados[0];
    const inicio = resultados[1];
    const final = (await pool.query(
      'SELECT estado FROM viajes WHERE id = $1',
      [identificadorViaje]
    )).rows[0];
    const penalidades = (await pool.query(
      `SELECT penalidad_ars FROM historial_estados_viaje
        WHERE viaje_id = $1 AND estado = 'CANCELLED_BY_PASSENGER'`,
      [identificadorViaje]
    )).rows;

    if (cancelacion.status === 'fulfilled') {
      assert.equal(inicio.status, 'rejected');
      assert.ok(inicio.reason instanceof ConflictoDeEstado);
      assert.equal(final.estado, 'CANCELLED_BY_PASSENGER');
      assert.deepEqual(penalidades.map((fila) => fila.penalidad_ars), [3145]);
    } else {
      assert.ok(cancelacion.reason instanceof ConflictoDeEstado);
      assert.equal(inicio.status, 'fulfilled');
      assert.equal(final.estado, 'IN_PROGRESS');
      assert.deepEqual(penalidades, []);
    }
  } finally {
    try {
      if (viajeCreado) {
        await limpiarViajes(pool, [identificadorViaje], [pasajeroId, conductorId]);
      }
    } finally {
      await pool.end();
    }
  }
});

test('una cancelación concurrente con la misma clave persiste un solo efecto', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const pool = crearPoolPrueba();
  const repositorio = new RepositorioViajesPostgres({ pool });
  const identificadorViaje = crypto.randomUUID();
  const pasajeroId = crypto.randomUUID();
  const clave = `cancel-concurrente:${crypto.randomUUID()}`;
  const idempotencia = {
    clave: `${pasajeroId}:${clave}`,
    huella: JSON.stringify({ identificadorViaje, motivo: 'Reintento simultáneo' }),
    tiempoVidaMs: 86400000
  };
  let viajeCreado = false;
  try {
    await aplicarMigraciones(pool);
    await crearViaje(pool, identificadorViaje, pasajeroId);
    viajeCreado = true;
    const resultados = await Promise.all([
      repositorio.cancelarViaje({
        identificadorViaje,
        actor: { identificador: pasajeroId, roles: ['pasajero'] },
        motivo: 'Reintento simultáneo',
        idempotencia
      }),
      repositorio.cancelarViaje({
        identificadorViaje,
        actor: { identificador: pasajeroId, roles: ['pasajero'] },
        motivo: 'Reintento simultáneo',
        idempotencia
      })
    ]);
    assert.deepEqual(
      JSON.parse(JSON.stringify(resultados[0])),
      JSON.parse(JSON.stringify(resultados[1]))
    );
    const historial = await pool.query(
      `SELECT COUNT(*)::integer AS total
         FROM historial_estados_viaje
        WHERE viaje_id = $1 AND estado = 'CANCELLED_BY_PASSENGER'`,
      [identificadorViaje]
    );
    assert.equal(historial.rows[0].total, 1);
  } finally {
    try {
      await pool.query('DELETE FROM idempotencia WHERE clave = $1', [idempotencia.clave]);
      if (viajeCreado) {
        await limpiarViajes(pool, [identificadorViaje], [pasajeroId]);
      }
    } finally {
      await pool.end();
    }
  }
});

test('PostgreSQL bloquea el excedente y permite resolver una cancelación ya activa', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const pool = crearPoolPrueba();
  const politicaCancelaciones = new PoliticaCancelaciones({
    limiteCancelaciones: 1,
    periodoCancelacionesMs: 60000,
    bloqueoCancelacionesMs: 60000,
    penalidadPasajeroAlLlegarArs: 525
  });
  const repositorio = new RepositorioViajesPostgres({ pool, politicaCancelaciones });
  const pasajeroId = crypto.randomUUID();
  const primerViaje = crypto.randomUUID();
  const segundoViaje = crypto.randomUUID();
  const viajePendiente = crypto.randomUUID();
  const conductorId = crypto.randomUUID();
  let viajesCreados = false;
  try {
    await aplicarMigraciones(pool);
    await crearViaje(pool, primerViaje, pasajeroId);
    await crearViaje(pool, segundoViaje, pasajeroId);
    await crearViaje(pool, viajePendiente, crypto.randomUUID());
    viajesCreados = true;
    await repositorio.cancelarViaje({
      identificadorViaje: primerViaje,
      actor: { identificador: pasajeroId, roles: ['pasajero'] },
      motivo: 'Primera cancelación',
      politicaCancelaciones
    });
    await repositorio.asignarConductor({
      identificadorViaje: segundoViaje,
      conductorId
    });
    await repositorio.actualizarEstadoOperativo({
      identificadorViaje: segundoViaje,
      actorId: conductorId,
      estado: ESTADOS.EN_ORIGEN
    });
    await assert.rejects(
      () => repositorio.cancelarViaje({
        identificadorViaje: segundoViaje,
        actor: { identificador: pasajeroId, roles: ['pasajero'] },
        motivo: 'Excede límite',
        politicaCancelaciones
      }),
      (error) => error instanceof ConflictoDeEstado && /Límite de cancelaciones/.test(error.message)
    );
    const antesDeResolver = (await pool.query(
      'SELECT estado FROM viajes WHERE id = $1',
      [segundoViaje]
    )).rows[0];
    assert.equal(antesDeResolver.estado, 'DRIVER_ARRIVING');
    await assert.rejects(
      () => repositorio.guardar({
        identificador: crypto.randomUUID(),
        pasajeroId,
        conductorId: null,
        origen: { latitud: -34, longitud: -58, direccion: 'Origen' },
        destino: { latitud: -35, longitud: -59, direccion: 'Destino' },
        fechaProgramada: null,
        estado: 'REQUESTED',
        creadoEn: new Date().toISOString(),
        actualizadoEn: new Date().toISOString(),
        toJSON() {
          return {};
        }
      }),
      (error) => error instanceof ConflictoDeEstado
    );
    const canceladoActivo = await repositorio.cancelarViaje({
      identificadorViaje: segundoViaje,
      actor: { identificador: pasajeroId, roles: ['pasajero'] },
      motivo: 'Cancelar viaje activo durante bloqueo',
      politicaCancelaciones
    });
    assert.equal(canceladoActivo.estado, 'CANCELLED_BY_PASSENGER');
    assert.equal(canceladoActivo.cancelacion.penalidadArs, 525);
    await assert.rejects(
      () => repositorio.asignarConductor({
        identificadorViaje: viajePendiente,
        conductorId: pasajeroId
      }),
      (error) => error instanceof ConflictoDeEstado
    );
  } finally {
    try {
      if (viajesCreados) {
        await limpiarViajes(pool, [primerViaje, segundoViaje, viajePendiente], [
          pasajeroId,
          conductorId
        ]);
      }
    } finally {
      await pool.end();
    }
  }
});
