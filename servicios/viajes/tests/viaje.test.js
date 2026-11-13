const test = require('node:test');
const assert = require('node:assert/strict');
const { Viaje, ESTADOS } = require('../src/dominio/entidades/viaje');
const { ConflictoDeEstado, ErrorDeValidacion } = require('../src/dominio/errores/errores');

const ids = {
  viaje: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
  pasajero: '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
  conductor: '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765'
};
const ubicacion = { latitud: -34.6037, longitud: -58.3816, direccion: 'Obelisco, CABA' };

function crearViaje() {
  return new Viaje({
    identificador: ids.viaje,
    pasajeroId: ids.pasajero,
    origen: ubicacion,
    destino: { ...ubicacion, longitud: -58.4333, direccion: 'Palermo, CABA' }
  });
}

test('aplica las transiciones válidas del viaje', () => {
  const viaje = crearViaje();
  viaje.asignar(ids.conductor).iniciar(ids.conductor).completar(ids.conductor);
  assert.equal(viaje.estado, ESTADOS.COMPLETADO);
});

test('rechaza iniciar sin conductor asignado y transiciones fuera de orden', () => {
  const viaje = crearViaje();
  assert.throws(() => viaje.iniciar(ids.conductor), ConflictoDeEstado);
  viaje.asignar(ids.conductor);
  assert.throws(() => viaje.completar(ids.conductor), ConflictoDeEstado);
  viaje.iniciar(ids.conductor);
  assert.throws(() => viaje.cancelar(), ConflictoDeEstado);
});

test('valida coordenadas y direcciones según el contrato', () => {
  assert.throws(() => new Viaje({
    identificador: ids.viaje,
    pasajeroId: ids.pasajero,
    origen: { ...ubicacion, latitud: 91 },
    destino: ubicacion
  }), ErrorDeValidacion);
});

test('aplica el ciclo operativo requerido y exige al conductor asignado', () => {
  const viaje = crearViaje();
  viaje.despachar().asignar(ids.conductor).llegarAlOrigen(ids.conductor);
  assert.equal(viaje.estado, ESTADOS.EN_ORIGEN);
  assert.throws(() => viaje.iniciarEnCurso(ids.pasajero), ConflictoDeEstado);
  viaje.iniciarEnCurso(ids.conductor).finalizar(ids.conductor);
  assert.equal(viaje.estado, ESTADOS.FINALIZADO);
});

test('permite marcar que no hubo conductor durante el despacho', () => {
  const viaje = crearViaje();
  viaje.despachar().marcarSinConductor();
  assert.equal(viaje.estado, ESTADOS.SIN_CONDUCTOR);
});
