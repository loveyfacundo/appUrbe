const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularTarifa, haversineKm } = require('../src/calcular-tarifa');
const { CotizarViaje } = require('../src/cotizar-viaje');
const { ErrorDeValidacion } = require('../../viajes/src/dominio/errores/errores');

test('la distancia cero usa la tarifa base y la misma función sirve al monto final', () => {
  const estimacion = calcularTarifa({ distanciaKm: 0, tiempoMinutos: 0 });
  const final = calcularTarifa({ distanciaKm: 0, tiempoMinutos: 0 });
  assert.equal(estimacion.amount, 500);
  assert.deepEqual(final, estimacion);
});

test('rechaza una distancia real superior al máximo configurado', () => {
  assert.throws(
    () => calcularTarifa({ distanciaKm: 100.01, tiempoMinutos: 10 }),
    ErrorDeValidacion
  );
});

test('cotización calcula distancia, vigencia y monto en el servidor', () => {
  const fija = new Date('2026-11-19T18:00:00.000Z');
  const cotizador = new CotizarViaje({ ahora: () => fija });
  const cotizacion = cotizador.ejecutar({
    origin: { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco' },
    destination: { latitude: -34.6158, longitude: -58.4333, address: 'Palermo' }
  });
  assert.ok(cotizacion.quoteId);
  assert.ok(cotizacion.amount > 500);
  assert.equal(cotizacion.currency, 'ARS');
  assert.equal(cotizacion.expiresAt, '2026-11-19T18:05:00.000Z');
  assert.ok(haversineKm(
    { latitude: -34.6037, longitude: -58.3816 },
    { latitude: -34.6037, longitude: -58.3816 }
  ) === 0);
});
