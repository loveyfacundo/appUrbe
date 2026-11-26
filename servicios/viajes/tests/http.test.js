const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { crearServidor } = require('../src/servidor');

const SECRET = 'clave-de-prueba-de-al-menos-32-caracteres';
const pasajeroId = '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const otroUsuarioId = '8a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const correlationId = '9a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const claveIdempotencia = '3a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const ubicaciones = {
  origin: { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco, CABA' },
  destination: { latitude: -34.6158, longitude: -58.4333, address: 'Palermo, CABA' }
};

const { crearTokenParaTest } = require('./test-jwt');

function crearToken(sub, extra = {}) {
  return crearTokenParaTest(sub, extra, SECRET);
}

function crearViajeRequest(baseUrl, opciones = {}) {
  return fetch(`${baseUrl}/api/v1/viajes`, {
    method: 'POST',
    headers: { ...headers(), 'idempotency-key': claveIdempotencia, ...opciones.headers },
    body: opciones.body !== undefined ? opciones.body : JSON.stringify(ubicaciones)
  });
}

function cambiarEstadoRequest(baseUrl, tripId, token, idempotencyKey, status, mediciones = {}) {
  return fetch(`${baseUrl}/api/v1/viajes/${tripId}/estado`, {
    method: 'PATCH',
    headers: {
      ...headers(token),
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify({ status, ...mediciones })
  });
}

async function iniciarApp(t, opciones = {}) {
  const app = crearServidor({
    secret: SECRET,
    verificadorPostgres: { verificar: async () => {} },
    ...opciones
  });
  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    servidor.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${servidor.address().port}`;
}

function headers(token = crearToken(pasajeroId)) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-correlation-id': correlationId
  };
}

function crearLectorSse(cuerpo) {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  return {
    lector,
    async siguiente() {
      while (true) {
        const separador = buffer.indexOf('\n\n');
        if (separador >= 0) {
          const trama = buffer.slice(0, separador);
          buffer = buffer.slice(separador + 2);
          const evento = {};
          for (const linea of trama.split('\n')) {
            const separadorCampo = linea.indexOf(':');
            if (separadorCampo < 0) continue;
            const campo = linea.slice(0, separadorCampo);
            const valor = linea.slice(separadorCampo + 1).trimStart();
            if (campo === 'data') evento.data = valor;
            if (campo === 'event') evento.event = valor;
            if (campo === 'id') evento.id = valor;
          }
          if (evento.event) return { ...evento, data: JSON.parse(evento.data) };
          continue;
        }
        const { value, done } = await lector.read();
        if (done) throw new Error('El canal SSE terminó antes de recibir un evento');
        buffer += decodificador.decode(value, { stream: true });
      }
    }
  };
}

test('HTTP crea, consulta y cancela viajes según el contrato', async (t) => {
  const baseUrl = await iniciarApp(t);
  const crear = await crearViajeRequest(baseUrl);
  assert.equal(crear.status, 201);
  assert.equal(crear.headers.get('x-correlation-id'), correlationId);
  const viaje = await crear.json();
  assert.equal(viaje.passengerId, pasajeroId);
  assert.equal(viaje.status, 'REQUESTED');
  assert.equal(viaje.origin.latitude, ubicaciones.origin.latitude);

  const reintento = await crearViajeRequest(baseUrl);
  assert.equal(reintento.status, 201);
  assert.deepEqual(await reintento.json(), viaje);

  const consultar = await fetch(`${baseUrl}/api/v1/viajes/${viaje.id}`, {
    headers: headers()
  });
  assert.equal(consultar.status, 200);
  assert.equal((await consultar.json()).id, viaje.id);

  const cancelar = await fetch(`${baseUrl}/api/v1/viajes/${viaje.id}/cancelacion`, {
    method: 'POST',
    headers: { ...headers(), 'idempotency-key': '4a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765' },
    body: JSON.stringify({ reason: 'Cambio de planes' })
  });
  assert.equal(cancelar.status, 200);
  const cancelado = await cancelar.json();
  assert.equal(cancelado.status, 'CANCELLED_BY_PASSENGER');
  assert.equal(cancelado.cancellation.penaltyAmount, 0);
});

test('HTTP valida entrada y devuelve errores con correlationId', async (t) => {
  const baseUrl = await iniciarApp(t);
  const respuesta = await fetch(`${baseUrl}/api/v1/viajes`, {
    method: 'POST',
    headers: { ...headers(), 'idempotency-key': claveIdempotencia },
    body: JSON.stringify({
      ...ubicaciones,
      origin: { ...ubicaciones.origin, latitude: 91 }
    })
  });
  assert.equal(respuesta.status, 422);
  const error = await respuesta.json();
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.equal(error.correlationId, correlationId);
  assert.ok(Array.isArray(error.details));
});

test('HTTP informa errores de recursos inexistentes y encabezados requeridos', async (t) => {
  const baseUrl = await iniciarApp(t);
  const inexistente = await fetch(
    `${baseUrl}/api/v1/viajes/7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a`,
    { headers: headers() }
  );
  assert.equal(inexistente.status, 404);
  assert.equal((await inexistente.json()).code, 'NOT_FOUND');

  const faltaCorrelacion = await fetch(`${baseUrl}/api/v1/viajes`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${crearToken(pasajeroId)}`,
      'content-type': 'application/json',
      'idempotency-key': claveIdempotencia
    },
    body: JSON.stringify(ubicaciones)
  });
  assert.equal(faltaCorrelacion.status, 422);
  const error = await faltaCorrelacion.json();
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.match(error.correlationId, /^[0-9a-f-]{36}$/i);
});

test('HTTP rechaza tokens ausentes, inválidos y actores sin permiso', async (t) => {
  const baseUrl = await iniciarApp(t);
  const sinToken = await fetch(`${baseUrl}/api/v1/viajes/7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a`, {
    headers: { 'x-correlation-id': correlationId }
  });
  assert.equal(sinToken.status, 401);

  const tokenInvalido = await fetch(`${baseUrl}/api/v1/viajes/7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a`, {
    headers: { ...headers(), authorization: 'Bearer no-es-un-jwt' }
  });
  assert.equal(tokenInvalido.status, 401);

  const crear = await crearViajeRequest(baseUrl);
  const viaje = await crear.json();
  const noAutorizado = await fetch(`${baseUrl}/api/v1/viajes/${viaje.id}`, {
    headers: headers(crearToken(otroUsuarioId))
  });
  assert.equal(noAutorizado.status, 403);
  assert.equal((await noAutorizado.json()).code, 'FORBIDDEN');
});

test('HTTP permite cancelar a un operador solo con el permiso del contrato', async (t) => {
  const baseUrl = await iniciarApp(t);
  const crear = await crearViajeRequest(baseUrl);
  const viaje = await crear.json();
  const operador = crearToken(otroUsuarioId, {
    roles: ['operador'],
    permissions: ['trips:cancel']
  });
  const cancelar = await fetch(`${baseUrl}/api/v1/viajes/${viaje.id}/cancelacion`, {
    method: 'POST',
    headers: {
      ...headers(operador),
      'idempotency-key': '4a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765'
    },
    body: JSON.stringify({ reason: 'Cancelación operativa' })
  });
  assert.equal(cancelar.status, 200);
  const cancelado = await cancelar.json();
  assert.equal(cancelado.status, 'CANCELLED_BY_OPERATOR');
  assert.equal(cancelado.cancellation.actorType, 'OPERADOR');
});

test('HTTP rechaza JSON mal formado con error consistente', async (t) => {
  const baseUrl = await iniciarApp(t);
  const respuesta = await fetch(`${baseUrl}/api/v1/viajes`, {
    method: 'POST',
    headers: { ...headers(), 'idempotency-key': claveIdempotencia },
    body: '{'
  });
  assert.equal(respuesta.status, 400);
  const error = await respuesta.json();
  assert.equal(error.code, 'BAD_REQUEST');
  assert.equal(error.correlationId, correlationId);
});

test('health check permanece disponible sin autenticación', async (t) => {
  const baseUrl = await iniciarApp(t);
  const respuesta = await fetch(`${baseUrl}/health`);
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { status: 'ok' });
});

test('readiness check informa que PostgreSQL está disponible', async (t) => {
  const baseUrl = await iniciarApp(t, {
    verificadorPostgres: { verificar: async () => {} }
  });
  const respuesta = await fetch(`${baseUrl}/health/ready`);
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), {
    status: 'ok',
    dependencies: { postgres: 'ok' }
  });
});

test('readiness check devuelve 503 si PostgreSQL no está disponible', async (t) => {
  const baseUrl = await iniciarApp(t, {
    verificadorPostgres: {
      verificar: async () => {
        throw new Error('connection refused');
      }
    }
  });
  const respuesta = await fetch(`${baseUrl}/health/ready`);
  assert.equal(respuesta.status, 503);
  assert.deepEqual(await respuesta.json(), {
    status: 'unavailable',
    dependencies: { postgres: 'unavailable' }
  });
});

test('readiness informa qué dependencia auxiliar no está disponible', async (t) => {
  const { crearModuloViajes } = require('../src/composicion');
  const modulo = crearModuloViajes();
  modulo.verificar = async () => {
    const error = new Error('RabbitMQ caído');
    error.dependencia = 'rabbitmq';
    throw error;
  };
  const baseUrl = await iniciarApp(t, { modulo });
  const respuesta = await fetch(`${baseUrl}/health/ready`);
  assert.equal(respuesta.status, 503);
  assert.deepEqual(await respuesta.json(), {
    status: 'unavailable',
    dependencies: { postgres: 'ok', rabbitmq: 'unavailable' }
  });
});

test('HTTP permite al conductor asignado avanzar el estado operativo', async (t) => {
  const { crearModuloViajes } = require('../src/composicion');
  const modulo = crearModuloViajes();
  const conductorId = '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
  const creado = await modulo.casosUso.solicitar.ejecutar({
    pasajeroId,
    ...{
      origen: { latitud: ubicaciones.origin.latitude, longitud: ubicaciones.origin.longitude, direccion: ubicaciones.origin.address },
      destino: { latitud: ubicaciones.destination.latitude, longitud: ubicaciones.destination.longitude, direccion: ubicaciones.destination.address }
    },
    claveIdempotencia: claveIdempotencia,
    idCorrelacion: correlationId
  });
  const viaje = await modulo.repositorio.buscarPorId(creado.identificador);
  viaje.asignar(conductorId);
  await modulo.repositorio.guardar(viaje);
  const baseUrl = await iniciarApp(t, { modulo });
  const token = crearToken(conductorId, { roles: ['conductor'] });
  const respuesta = await fetch(`${baseUrl}/api/v1/viajes/${creado.identificador}/estado`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
      'idempotency-key': '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765'
    },
    body: JSON.stringify({ status: 'DRIVER_ARRIVING' })
  });
  assert.equal(respuesta.status, 200);
  assert.equal((await respuesta.json()).status, 'DRIVER_ARRIVING');
  const iniciar = await cambiarEstadoRequest(
    baseUrl,
    creado.identificador,
    token,
    '7a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    'IN_PROGRESS'
  );
  assert.equal(iniciar.status, 200);
  const viajeIniciado = await iniciar.json();
  assert.equal(viajeIniciado.status, 'IN_PROGRESS');

  const iniciarRepetido = await cambiarEstadoRequest(
    baseUrl,
    creado.identificador,
    token,
    '7a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    'IN_PROGRESS'
  );
  assert.equal(iniciarRepetido.status, 200);
  assert.deepEqual(await iniciarRepetido.json(), viajeIniciado);

  const completar = await cambiarEstadoRequest(
    baseUrl,
    creado.identificador,
    token,
    '8a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    'COMPLETED',
    { distanceKm: 0, durationMinutes: 0 }
  );
  assert.equal(completar.status, 200);
  const viajeCompletado = await completar.json();
  assert.equal(viajeCompletado.status, 'COMPLETED');
  assert.deepEqual(
    modulo.publicador.eventos.slice(-2).map((evento) => evento.eventType),
    ['TripStarted', 'TripCompleted']
  );
  assert.equal(
    modulo.publicador.eventos.at(-2).payload.startedAt,
    viajeIniciado.updatedAt
  );
  assert.equal(
    modulo.publicador.eventos.at(-1).payload.completedAt,
    viajeCompletado.updatedAt
  );
  assert.equal(modulo.publicador.eventos.at(-1).payload.finalAmount, 500);
  assert.equal(modulo.publicador.eventos.at(-1).payload.currency, 'ARS');
});

test('HTTP permite que solo un conductor acepte el viaje y deduplica el reintento', async (t) => {
  const { crearModuloViajes } = require('../src/composicion');
  const modulo = crearModuloViajes();
  const creado = await modulo.casosUso.solicitar.ejecutar({
    pasajeroId,
    origen: {
      latitud: ubicaciones.origin.latitude,
      longitud: ubicaciones.origin.longitude,
      direccion: ubicaciones.origin.address
    },
    destino: {
      latitud: ubicaciones.destination.latitude,
      longitud: ubicaciones.destination.longitude,
      direccion: ubicaciones.destination.address
    },
    claveIdempotencia,
    idCorrelacion: correlationId
  });
  const baseUrl = await iniciarApp(t, { modulo });
  const conductores = [
    '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    '7a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765'
  ];
  const claves = [
    '8a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    '9a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765'
  ];
  const respuestas = await Promise.all(conductores.map((conductorId, indice) =>
    fetch(`${baseUrl}/api/v1/viajes/${creado.identificador}/asignacion`, {
      method: 'POST',
      headers: {
        ...headers(crearToken(conductorId, { roles: ['conductor'] })),
        'idempotency-key': claves[indice]
      }
    })
  ));
  assert.deepEqual(respuestas.map((respuesta) => respuesta.status).sort(), [200, 409]);
  const ganador = respuestas.find((respuesta) => respuesta.status === 200);
  const viajeAsignado = await ganador.json();
  assert.equal(viajeAsignado.status, 'ASSIGNED');
  assert.ok(conductores.includes(viajeAsignado.driverId));

  const indiceGanador = conductores.indexOf(viajeAsignado.driverId);
  const reintento = await fetch(
    `${baseUrl}/api/v1/viajes/${creado.identificador}/asignacion`,
    {
      method: 'POST',
      headers: {
        ...headers(crearToken(viajeAsignado.driverId, { roles: ['conductor'] })),
        'idempotency-key': claves[indiceGanador]
      }
    }
  );
  assert.equal(reintento.status, 200);
  assert.deepEqual(await reintento.json(), viajeAsignado);
  assert.equal(modulo.publicador.eventos.filter((evento) =>
    evento.eventType === 'DriverAssigned').length, 1);
});

test('HTTP protege ubicación y seguimiento del viaje por pasajero y conductor asignados', async (t) => {
  const { crearModuloViajes } = require('../src/composicion');
  const modulo = crearModuloViajes();
  const app = crearServidor({
    modulo,
    secret: SECRET,
    verificadorPostgres: { verificar: async () => {} }
  });
  const conductorId = '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
  const creado = await modulo.casosUso.solicitar.ejecutar({
    pasajeroId,
    origen: {
      latitud: ubicaciones.origin.latitude,
      longitud: ubicaciones.origin.longitude,
      direccion: ubicaciones.origin.address
    },
    destino: {
      latitud: ubicaciones.destination.latitude,
      longitud: ubicaciones.destination.longitude,
      direccion: ubicaciones.destination.address
    },
    claveIdempotencia,
    idCorrelacion: correlationId
  });
  const viaje = await modulo.repositorio.buscarPorId(creado.identificador);
  viaje.asignar(conductorId);
  await modulo.repositorio.guardar(viaje);
  const repositorioFlota = app.locals.repositorioFlota;
  repositorioFlota.perfiles.set(conductorId, {
    id: conductorId,
    habilitado: true,
    disponible: true
  });
  await repositorioFlota.guardarUbicacion({
    conductorId,
    latitude: -34.602,
    longitude: -58.38,
    accuracyMeters: 8,
    recordedAt: new Date().toISOString()
  });

  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    servidor.close((error) => error ? reject(error) : resolve());
  }));
  const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
  const ubicacionPath = `${baseUrl}/api/v1/viajes/${creado.identificador}/ubicacion`;
  const seguimientoPath = `${baseUrl}/api/v1/viajes/${creado.identificador}/seguimiento`;

  const ubicacionPasajero = await fetch(ubicacionPath, { headers: headers() });
  assert.equal(ubicacionPasajero.status, 200);
  const respuestaUbicacion = await ubicacionPasajero.json();
  assert.equal(respuestaUbicacion.driverId, conductorId);
  assert.equal(respuestaUbicacion.location.latitude, -34.602);

  const ubicacionAjena = await fetch(ubicacionPath, {
    headers: headers(crearToken(otroUsuarioId))
  });
  assert.equal(ubicacionAjena.status, 403);

  const tokenConductor = crearToken(conductorId, { roles: ['chofer'] });
  const seguimientoConductor = await fetch(seguimientoPath, {
    headers: headers(tokenConductor)
  });
  assert.equal(seguimientoConductor.status, 200);
  assert.equal((await seguimientoConductor.json()).driverId, conductorId);

  const seguimientoAjeno = await fetch(seguimientoPath, {
    headers: headers(crearToken(otroUsuarioId, { roles: ['chofer'] }))
  });
  assert.equal(seguimientoAjeno.status, 403);

  const ubicacionSolicitadaPorConductor = await fetch(ubicacionPath, {
    headers: headers(tokenConductor)
  });
  assert.equal(ubicacionSolicitadaPorConductor.status, 403);
});

test('SSE autoriza pasajero y conductor, actualiza y reconecta con una instantánea actual', async (t) => {
  const { crearModuloViajes } = require('../src/composicion');
  const modulo = crearModuloViajes();
  const app = crearServidor({
    modulo,
    secret: SECRET,
    intervaloSeguimientoMs: 20,
    verificadorPostgres: { verificar: async () => {} }
  });
  const conductorId = '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
  const creado = await modulo.casosUso.solicitar.ejecutar({
    pasajeroId,
    origen: {
      latitud: ubicaciones.origin.latitude,
      longitud: ubicaciones.origin.longitude,
      direccion: ubicaciones.origin.address
    },
    destino: {
      latitud: ubicaciones.destination.latitude,
      longitud: ubicaciones.destination.longitude,
      direccion: ubicaciones.destination.address
    },
    claveIdempotencia,
    idCorrelacion: correlationId
  });
  const viaje = await modulo.repositorio.buscarPorId(creado.identificador);
  viaje.asignar(conductorId);
  await modulo.repositorio.guardar(viaje);
  const repositorioFlota = app.locals.repositorioFlota;
  repositorioFlota.perfiles.set(conductorId, {
    id: conductorId,
    habilitado: true,
    disponible: true
  });
  await repositorioFlota.guardarUbicacion({
    conductorId,
    latitude: -34.602,
    longitude: -58.38,
    accuracyMeters: 8,
    recordedAt: new Date().toISOString()
  });

  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    servidor.close((error) => error ? reject(error) : resolve());
  }));
  const endpoint = `http://127.0.0.1:${servidor.address().port}/api/v1/viajes/${creado.identificador}/seguimiento/eventos`;
  const respuestaPasajero = await fetch(endpoint, { headers: headers() });
  assert.equal(respuestaPasajero.status, 200);
  assert.match(respuestaPasajero.headers.get('content-type'), /text\/event-stream/);
  const lectorPasajero = crearLectorSse(respuestaPasajero.body);
  const inicial = await lectorPasajero.siguiente();
  assert.equal(inicial.event, 'snapshot');
  assert.equal(inicial.data.status, 'ASSIGNED');
  assert.equal(inicial.data.location.latitude, -34.602);

  viaje.iniciarEnCurso(conductorId);
  await modulo.repositorio.guardar(viaje);
  await repositorioFlota.guardarUbicacion({
    conductorId,
    latitude: -34.603,
    longitude: -58.381,
    accuracyMeters: 5,
    recordedAt: new Date(Date.now() + 1).toISOString()
  });
  const actualizacion = await lectorPasajero.siguiente();
  assert.equal(actualizacion.event, 'update');
  assert.equal(actualizacion.data.status, 'IN_PROGRESS');
  assert.equal(actualizacion.data.location.latitude, -34.603);

  await lectorPasajero.lector.cancel();
  const respuestaReconectada = await fetch(endpoint, { headers: headers() });
  const lectorReconectado = crearLectorSse(respuestaReconectada.body);
  const instantaneaReconectada = await lectorReconectado.siguiente();
  assert.equal(instantaneaReconectada.event, 'snapshot');
  assert.equal(instantaneaReconectada.data.status, 'IN_PROGRESS');
  assert.equal(instantaneaReconectada.data.location.latitude, -34.603);
  await lectorReconectado.lector.cancel();

  const tokenConductor = crearToken(conductorId, { roles: ['conductor'] });
  const respuestaConductor = await fetch(endpoint, { headers: headers(tokenConductor) });
  const lectorConductor = crearLectorSse(respuestaConductor.body);
  const instantaneaConductor = await lectorConductor.siguiente();
  assert.equal(instantaneaConductor.data.status, 'IN_PROGRESS');
  assert.equal(instantaneaConductor.data.location.latitude, -34.603);
  await lectorConductor.lector.cancel();

  const respuestaAjena = await fetch(endpoint, {
    headers: headers(crearToken(otroUsuarioId, { roles: ['conductor'] }))
  });
  assert.equal(respuestaAjena.status, 403);
  assert.equal((await respuestaAjena.json()).code, 'FORBIDDEN');
});
