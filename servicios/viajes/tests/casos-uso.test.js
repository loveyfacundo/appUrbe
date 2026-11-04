const test = require('node:test');
const assert = require('node:assert/strict');
const { crearModuloViajes } = require('../src/composicion');
const { ConflictoDeEstado, OperacionNoPermitida, RecursoNoEncontrado } = require('../src/dominio/errores/errores');

const pasajero = '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const otroUsuario = '8a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const idCorrelacion = '9a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const base = {
  origen: { latitud: -34.6037, longitud: -58.3816, direccion: 'Obelisco, CABA' },
  destino: { latitud: -34.6158, longitud: -58.4333, direccion: 'Palermo, CABA' }
};

async function solicitar(modulo, claveIdempotencia = 'clave-1') {
  return modulo.casosUso.solicitar.ejecutar({
    pasajeroId: pasajero,
    ...base,
    claveIdempotencia,
    idCorrelacion
  });
}

test('solicitar es idempotente y publica TripRequested', async () => {
  const modulo = crearModuloViajes();
  const first = await solicitar(modulo);
  const second = await solicitar(modulo);
  assert.deepEqual(second, first);
  assert.equal(modulo.publicador.eventos.length, 1);
  assert.equal(modulo.publicador.eventos[0].eventType, 'TripRequested');
});

test('rechaza reutilizar idempotencia con payload diferente', async () => {
  const modulo = crearModuloViajes();
  await solicitar(modulo);
  await assert.rejects(() => modulo.casosUso.solicitar.ejecutar({
    pasajeroId: pasajero,
    ...base,
    destino: { ...base.destino, direccion: 'Retiro, CABA' },
    claveIdempotencia: 'clave-1',
    idCorrelacion
  }), ConflictoDeEstado);
});

test('solo el propietario puede consultar y cancelar un viaje', async () => {
  const modulo = crearModuloViajes();
  const viaje = await solicitar(modulo);
  await assert.rejects(() => modulo.casosUso.obtener.ejecutar({
    identificadorViaje: viaje.identificador,
    actor: { identificador: otroUsuario, roles: [] }
  }), OperacionNoPermitida);
  const cancelado = await modulo.casosUso.cancelar.ejecutar({
    identificadorViaje: viaje.identificador,
    actor: { identificador: pasajero, roles: [] },
    motivo: 'Cambio de planes',
    claveIdempotencia: 'cancel-1',
    idCorrelacion
  });
  assert.equal(cancelado.estado, 'CANCELLED');
  assert.equal(modulo.publicador.eventos[1].eventType, 'TripCancelled');
});

test('devuelve not found para un viaje inexistente', async () => {
  const modulo = crearModuloViajes();
  await assert.rejects(() => modulo.casosUso.obtener.ejecutar({
    identificadorViaje: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    actor: { identificador: pasajero, roles: [] }
  }), RecursoNoEncontrado);
});
