const test = require('node:test');
const assert = require('node:assert/strict');
const { GestorOfertas } = require('../src/gestionar-ofertas');
const { RepositorioViajesMemoria } = require('../../viajes/src/infra/memoria/repositorio-viajes-memoria');
const { Viaje } = require('../../viajes/src/dominio/entidades/viaje');
const crypto = require('node:crypto');

function crearViaje() {
  return new Viaje({
    identificador: crypto.randomUUID(),
    pasajeroId: crypto.randomUUID(),
    origen: { latitud: -34, longitud: -58, direccion: 'Origen' },
    destino: { latitud: -35, longitud: -59, direccion: 'Destino' }
  });
}

test('vence una oferta y pasa al siguiente candidato', async () => {
  const repositorio = new RepositorioViajesMemoria();
  const viaje = crearViaje();
  await repositorio.guardar(viaje);
  let ahora = 1000;
  const callbacks = [];
  const gestor = new GestorOfertas({
    repositorioViajes: repositorio,
    ttlMs: 20000,
    temporizador: (callback, delay) => {
      const temporizador = { callback, delay };
      callbacks.push(temporizador);
      return temporizador;
    },
    cancelarTemporizador: () => {},
    reloj: () => ahora
  });
  const conductores = [{ id: crypto.randomUUID() }, { id: crypto.randomUUID() }];
  const primero = await gestor.iniciar({
    identificadorViaje: viaje.identificador,
    candidatos: conductores
  });
  assert.equal(primero.offer.ttlSeconds, 20);
  assert.equal(callbacks[0].delay, 20000);

  ahora = 21000;
  await callbacks.shift().callback();

  const segundo = gestor.ofertasActivas.get(viaje.identificador);
  assert.ok(segundo);
  assert.equal(segundo.indice, 1);
  assert.equal(segundo.candidatos[1].id, conductores[1].id);
});

test('sin candidatos deja el viaje en NO_DRIVERS_AVAILABLE', async () => {
  const repositorio = new RepositorioViajesMemoria();
  const viaje = crearViaje();
  await repositorio.guardar(viaje);
  const gestor = new GestorOfertas({
    repositorioViajes: repositorio,
    buscadorConductores: async () => []
  });
  const resultado = await gestor.iniciar({ identificadorViaje: viaje.identificador });
  assert.equal(resultado.status, 'NO_DRIVERS_AVAILABLE');
  assert.equal((await repositorio.buscarPorId(viaje.identificador)).estado, 'NO_DRIVERS_AVAILABLE');
});

test('aceptar la oferta asigna al conductor y cancela el vencimiento', async () => {
  const repositorio = new RepositorioViajesMemoria();
  const viaje = crearViaje();
  await repositorio.guardar(viaje);
  const conductor = { id: crypto.randomUUID() };
  let temporizadorCancelado = false;
  const gestor = new GestorOfertas({
    repositorioViajes: repositorio,
    ttlMs: 15000,
    temporizador: () => ({ id: 'timeout' }),
    cancelarTemporizador: () => { temporizadorCancelado = true; }
  });
  await gestor.iniciar({ identificadorViaje: viaje.identificador, candidatos: [conductor] });

  const resultado = await gestor.responder({
    identificadorViaje: viaje.identificador,
    conductorId: conductor.id,
    aceptar: true
  });

  assert.equal(resultado.status, 'ASSIGNED');
  assert.equal(resultado.driverId, conductor.id);
  assert.equal((await repositorio.buscarPorId(viaje.identificador)).conductorId, conductor.id);
  assert.equal(gestor.ofertasActivas.has(viaje.identificador), false);
  assert.equal(temporizadorCancelado, true);
});

test('el vencimiento agota candidatos sin respuesta del cliente', async () => {
  const repositorio = new RepositorioViajesMemoria();
  const viaje = crearViaje();
  await repositorio.guardar(viaje);
  let ahora = 0;
  const temporizadores = [];
  const gestor = new GestorOfertas({
    repositorioViajes: repositorio,
    ttlMs: 15000,
    temporizador: (callback) => {
      temporizadores.push(callback);
      return callback;
    },
    cancelarTemporizador: () => {},
    reloj: () => ahora
  });
  const resultado = await gestor.iniciar({
    identificadorViaje: viaje.identificador,
    candidatos: [{ id: crypto.randomUUID() }]
  });
  assert.equal(resultado.offer.ttlSeconds, 15);

  ahora = 15000;
  await temporizadores[0]();

  assert.equal(gestor.ofertasActivas.has(viaje.identificador), false);
  assert.equal((await repositorio.buscarPorId(viaje.identificador)).estado, 'NO_DRIVERS_AVAILABLE');
});

test('rechaza plazos de oferta fuera del rango configurado', () => {
  assert.throws(() => new GestorOfertas({
    repositorioViajes: new RepositorioViajesMemoria(),
    ttlMs: 14999
  }), RangeError);
  assert.throws(() => new GestorOfertas({
    repositorioViajes: new RepositorioViajesMemoria(),
    ttlMs: 30001
  }), RangeError);
});
