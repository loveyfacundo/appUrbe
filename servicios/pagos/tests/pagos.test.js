const test = require('node:test');
const assert = require('node:assert/strict');
const { CobroSimulado } = require('../src/cobro-simulado');
const { ConflictoDeEstado } = require('../../viajes/src/dominio/errores/errores');

test('un reintento idempotente no captura el cobro dos veces', async () => {
  const cobro = new CobroSimulado();
  const datos = {
    tripId: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    passengerId: '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    amount: 1250,
    claveIdempotencia: '3a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765'
  };
  const primero = await cobro.capturar(datos);
  const segundo = await cobro.capturar(datos);
  assert.equal(primero.id, segundo.id);
  assert.equal((await cobro.buscarPorViaje(datos.tripId)).status, 'CAPTURED');
});

test('rechaza reutilizar la clave de cobro con otro monto', async () => {
  const cobro = new CobroSimulado();
  await cobro.capturar({
    tripId: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    passengerId: '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    amount: 1250,
    claveIdempotencia: 'clave-cobro'
  });
  await assert.rejects(
    () => cobro.capturar({
      tripId: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
      passengerId: '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
      amount: 1300,
      claveIdempotencia: 'clave-cobro'
    }),
    ConflictoDeEstado
  );
});
