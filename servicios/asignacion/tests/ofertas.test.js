const test = require('node:test');
const assert = require('node:assert/strict');
const { GestorOfertas } = require('../src/gestionar-ofertas');
const { RepositorioViajesMemoria } = require('../../viajes/src/infra/memoria/repositorio-viajes-memoria');
const { Viaje } = require('../../viajes/src/dominio/entidades/viaje');
const crypto = require('node:crypto');

test('vence una oferta y pasa al siguiente candidato', async () => {
  const repositorio = new RepositorioViajesMemoria();
  const viaje = new Viaje({
    identificador: crypto.randomUUID(),
    pasajeroId: crypto.randomUUID(),
    origen: { latitud: -34, longitud: -58, direccion: 'Origen' },
    destino: { latitud: -35, longitud: -59, direccion: 'Destino' }
  });
  await repositorio.guardar(viaje);
  let temporizador;
  const callbacks = [];
  const gestor = new GestorOfertas({
    repositorioViajes: repositorio,
    ttlMs: 20,
    temporizador: (callback) => callbacks.push(callback),
    reloj: () => 1000
  });
  const primero = await gestor.iniciar({
    identificadorViaje: viaje.identificador,
    candidatos: [{ id: crypto.randomUUID() }, { id: crypto.randomUUID() }]
  });
  temporizador = callbacks.shift();
  temporizador();
  const segundo = gestor.ofertasActivas.get(viaje.identificador);
  assert.equal(primero.offer.ttlSeconds, 1);
  assert.ok(segundo);
  assert.equal(segundo.indice, 1);
});

test('sin candidatos deja el viaje en NO_DRIVERS_AVAILABLE', async () => {
  const repositorio = new RepositorioViajesMemoria();
  const viaje = new Viaje({
    identificador: crypto.randomUUID(),
    pasajeroId: crypto.randomUUID(),
    origen: { latitud: -34, longitud: -58, direccion: 'Origen' },
    destino: { latitud: -35, longitud: -59, direccion: 'Destino' }
  });
  await repositorio.guardar(viaje);
  const gestor = new GestorOfertas({
    repositorioViajes: repositorio,
    buscadorConductores: async () => []
  });
  const resultado = await gestor.iniciar({ identificadorViaje: viaje.identificador });
  assert.equal(resultado.status, 'NO_DRIVERS_AVAILABLE');
  assert.equal((await repositorio.buscarPorId(viaje.identificador)).estado, 'NO_DRIVERS_AVAILABLE');
});
