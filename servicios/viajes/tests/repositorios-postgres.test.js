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
  const viaje = {
    identificador: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    pasajeroId: '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    conductorId: null,
    origen: { latitud: -34, longitud: -58, direccion: 'Origen' },
    destino: { latitud: -35, longitud: -59, direccion: 'Destino' },
    fechaProgramada: null,
    estado: 'REQUESTED',
    creadoEn: '2026-01-01T00:00:00.000Z',
    actualizadoEn: '2026-01-01T00:00:00.000Z'
  };
  await repositorio.guardar(viaje);
  assert.equal(pool.consultas[0].texto, 'BEGIN');
  assert.match(pool.consultas[3].texto, /INSERT INTO historial_estados_viaje/);
  assert.equal(pool.consultas[4].texto, 'COMMIT');
});

test('repositorio de idempotencia conserva la respuesta y consulta por clave', async () => {
  const pool = crearPool([
    { rows: [], rowCount: 0 },
    { rows: [{ huella: 'hash', respuesta: { id: 'viaje' }, expira_en: '4102444800000' }] }
  ]);
  const repositorio = new RepositorioIdempotenciaPostgres({ pool });
  const resultado = await repositorio.buscar('pasajero:clave');
  assert.deepEqual(resultado.respuesta, { id: 'viaje' });
  assert.equal(pool.consultas[0].parametros[0], 'pasajero:clave');
  assert.equal(pool.consultas[1].parametros[0], 'pasajero:clave');
});
