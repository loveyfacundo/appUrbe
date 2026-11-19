const test = require('node:test');
const assert = require('node:assert/strict');
const { RepositorioViajesPostgres } = require('../src/infra/db/repositorio-viajes-postgres');
const { RepositorioIdempotenciaPostgres } = require('../src/infra/db/repositorio-idempotencia-postgres');

function crearPool(respuestas) {
  const consultas = [];
  const cliente = {
    async query(texto, parametros) {
      consultas.push({ texto, parametros });
      return respuestas.shift() || { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return {
    consultas,
    async query(texto, parametros) {
      consultas.push({ texto, parametros });
      return respuestas.shift() || { rows: [], rowCount: 0 };
    },
    async connect() {
      return cliente;
    }
  };
}

function crearViajePrueba(overrides = {}) {
  return {
    identificador: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    pasajeroId: '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    conductorId: null,
    origen: { latitud: -34, longitud: -58, direccion: 'Origen' },
    destino: { latitud: -35, longitud: -59, direccion: 'Destino' },
    fechaProgramada: null,
    estado: 'REQUESTED',
    creadoEn: '2026-01-01T00:00:00.000Z',
    actualizadoEn: '2026-01-01T00:00:00.000Z',
    toJSON() {
      return { identificador: this.identificador, estado: this.estado };
    },
    ...overrides
  };
}

test('repositorio de viajes usa SQL parametrizado y reconstruye la entidad', async () => {
  const pool = crearPool([{
      rows: [{
        id: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
        pasajero_id: '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
        conductor_id: null,
        origen: { latitud: -34, longitud: -58, direccion: 'Origen' },
        destino: { latitud: -35, longitud: -59, direccion: 'Destino' },
        fecha_programada: null,
        estado: 'REQUESTED',
        creado_en: '2026-01-01T00:00:00.000Z',
        actualizado_en: '2026-01-01T00:00:00.000Z'
      }]
    }]);
  const repositorio = new RepositorioViajesPostgres({ pool });
  const viaje = await repositorio.buscarPorId('7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a');
  assert.equal(viaje.estado, 'REQUESTED');
  assert.deepEqual(pool.consultas[0].parametros, ['7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a']);
});

test('guardar confirma viaje e historial en una única transacción', async () => {
  const pool = crearPool([
    { rows: [] },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 }
  ]);
  const repositorio = new RepositorioViajesPostgres({ pool });
  const viaje = crearViajePrueba();
  await repositorio.guardar(viaje);
  assert.equal(pool.consultas[0].texto, 'BEGIN');
  assert.match(pool.consultas[3].texto, /INSERT INTO historial_estados_viaje/);
  assert.equal(pool.consultas[4].texto, 'COMMIT');
});

test('guardar agrega el evento al outbox y conserva idempotencia en la misma transacción', async () => {
  const pool = crearPool([
    { rows: [] },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 }
  ]);
  const repositorio = new RepositorioViajesPostgres({ pool });
  const viaje = crearViajePrueba();
  const evento = {
    eventId: '9d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    eventType: 'TripRequested',
    eventVersion: 1,
    occurredAt: '2026-01-01T00:00:00.000Z',
    correlationId: '8d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    causationId: null,
    producer: 'viajes',
    payload: { tripId: viaje.identificador }
  };
  await repositorio.guardar(viaje, evento, {
    clave: 'pasajero:clave',
    huella: 'hash',
    tiempoVidaMs: 86400000
  });
  const sql = pool.consultas.map(({ texto }) => texto);
  assert.ok(sql.findIndex((texto) => texto.includes('INSERT INTO eventos_outbox')) <
    sql.findIndex((texto) => texto.includes('INSERT INTO idempotencia')));
  assert.equal(sql.at(-1), 'COMMIT');
});

test('asignarConductor usa una actualización condicional y guarda el historial en la transacción', async () => {
  const pool = crearPool([
    { rows: [] },
    {
      rows: [{
        id: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
        pasajero_id: '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
        conductor_id: '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
        origen: { latitud: -34, longitud: -58, direccion: 'Origen' },
        destino: { latitud: -35, longitud: -59, direccion: 'Destino' },
        fecha_programada: null,
        estado: 'ASSIGNED',
        creado_en: '2026-01-01T00:00:00.000Z',
        actualizado_en: '2026-01-01T00:00:01.000Z'
      }],
      rowCount: 1
    },
    { rows: [], rowCount: 1 }
  ]);
  const repositorio = new RepositorioViajesPostgres({ pool });
  const viaje = await repositorio.asignarConductor({
    identificadorViaje: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    conductorId: '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765'
  });
  assert.equal(viaje.estado, 'ASSIGNED');
  assert.equal(pool.consultas[0].texto, 'BEGIN');
  assert.match(pool.consultas[1].texto, /conductor_id IS NULL/);
  assert.match(pool.consultas[1].texto, /estado IN \('REQUESTED', 'DISPATCHING'\)/);
  assert.match(pool.consultas[2].texto, /INSERT INTO historial_estados_viaje/);
  assert.equal(pool.consultas[3].texto, 'COMMIT');
});

test('el consumidor persiste la deduplicación del evento en la misma transacción', async () => {
  const pool = crearPool([
    { rows: [] },
    { rows: [{ event_id: '9d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a' }], rowCount: 1 },
    { rows: [{ actualizado_en: '2026-01-01T00:00:01.000Z' }], rowCount: 1 },
    { rows: [], rowCount: 1 }
  ]);
  const repositorio = new RepositorioViajesPostgres({ pool });
  const resultado = await repositorio.procesarAsignacionEvento({
    eventId: '9d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    identificadorViaje: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    conductorId: '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765'
  });
  assert.deepEqual(resultado, { duplicado: false });
  assert.match(pool.consultas[1].texto, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.match(pool.consultas[2].texto, /UPDATE viajes/);
  assert.match(pool.consultas[3].texto, /historial_estados_viaje/);
  assert.equal(pool.consultas[4].texto, 'COMMIT');
});

test('repositorio de idempotencia conserva la respuesta y consulta por clave', async () => {
  const pool = crearPool([
    { rows: [{ huella: 'hash', respuesta: { id: 'viaje' }, expira_en: '4102444800000' }] }
  ]);
  const repositorio = new RepositorioIdempotenciaPostgres({ pool });
  const resultado = await repositorio.buscar('pasajero:clave');
  assert.deepEqual(resultado.respuesta, { id: 'viaje' });
  assert.equal(pool.consultas[0].parametros[0], 'pasajero:clave');
  assert.match(pool.consultas[0].texto, /DELETE FROM idempotencia/);
  assert.match(pool.consultas[0].texto, /SELECT huella, respuesta/);
});

test('idempotencia real borra claves vencidas y devuelve claves vigentes', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const repositorio = new RepositorioIdempotenciaPostgres({ pool });
  const clave = `test:${require('node:crypto').randomUUID()}`;
  try {
    await pool.query(
      `INSERT INTO idempotencia (clave, huella, respuesta, expira_en)
       VALUES ($1, 'huella', '{"id":"vigente"}', NOW() + INTERVAL '1 hour')`,
      [clave]
    );
    assert.deepEqual((await repositorio.buscar(clave)).respuesta, { id: 'vigente' });
    await pool.query(
      'UPDATE idempotencia SET expira_en = NOW() - INTERVAL \'1 second\' WHERE clave = $1',
      [clave]
    );
    assert.equal(await repositorio.buscar(clave), null);
    const resultado = await pool.query('SELECT clave FROM idempotencia WHERE clave = $1', [clave]);
    assert.equal(resultado.rowCount, 0);
  } finally {
    await pool.query('DELETE FROM idempotencia WHERE clave = $1', [clave]);
    await pool.end();
  }
});
