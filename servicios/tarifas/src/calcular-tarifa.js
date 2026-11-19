const { ErrorDeValidacion } = require('../../viajes/src/dominio/errores/errores');

const PARAMETROS_TARIFA = Object.freeze({
  moneda: 'ARS',
  tarifaBase: 500,
  precioKm: 200,
  precioMinuto: 30,
  distanciaMaximaKm: 100
});

function validarDistanciaYTiempo(distanciaKm, tiempoMinutos) {
  if (!Number.isFinite(distanciaKm) || distanciaKm < 0) {
    throw new ErrorDeValidacion('distanciaKm debe ser mayor o igual a cero');
  }
  if (!Number.isFinite(tiempoMinutos) || tiempoMinutos < 0) {
    throw new ErrorDeValidacion('tiempoMinutos debe ser mayor o igual a cero');
  }
  if (distanciaKm > PARAMETROS_TARIFA.distanciaMaximaKm) {
    throw new ErrorDeValidacion(
      `La distancia supera el máximo permitido de ${PARAMETROS_TARIFA.distanciaMaximaKm} km`
    );
  }
}

function redondearPesosCentavos(valor) {
  return Math.round(valor);
}

function calcularTarifa({ distanciaKm, tiempoMinutos }, parametros = PARAMETROS_TARIFA) {
  validarDistanciaYTiempo(distanciaKm, tiempoMinutos);
  const monto = parametros.tarifaBase +
    distanciaKm * parametros.precioKm +
    tiempoMinutos * parametros.precioMinuto;
  return {
    amount: redondearPesosCentavos(monto),
    currency: parametros.moneda,
    parameters: {
      base: parametros.tarifaBase,
      perKm: parametros.precioKm,
      perMinute: parametros.precioMinuto,
      maxDistanceKm: parametros.distanciaMaximaKm
    }
  };
}

function haversineKm(origen, destino) {
  const radianes = (grados) => grados * Math.PI / 180;
  const lat1 = radianes(origen.latitude);
  const lon1 = radianes(origen.longitude);
  const lat2 = radianes(destino.latitude);
  const lon2 = radianes(destino.longitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = lon2 - lon1;
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = {
  PARAMETROS_TARIFA,
  calcularTarifa,
  haversineKm
};
