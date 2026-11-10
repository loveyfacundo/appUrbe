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

function codificar(valor) {
  return Buffer.from(JSON.stringify(valor)).toString('base64url');
}

function crearToken(sub, extra = {}) {
  const header = codificar({ alg: 'HS256', typ: 'JWT' });
  const payload = codificar({
    sub,
    roles: ['pasajero'],
    exp: Math.floor(Date.now() / 1000) + 60,
    ...extra
  });
  const firma = crypto
    .createHmac('sha256', SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${firma}`;
}

async function iniciarApp(t, opciones = {}) {
  const app = crearServidor({ secret: SECRET, ...opciones });
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

test('HTTP crea, consulta y cancela viajes según el contrato', async (t) => {
  const baseUrl = await iniciarApp(t);
  const crear = await fetch(`${baseUrl}/api/v1/viajes`, {
    method: 'POST',
    headers: { ...headers(), 'idempotency-key': claveIdempotencia },
    body: JSON.stringify(ubicaciones)
  });
  assert.equal(crear.status, 201);
  assert.equal(crear.headers.get('x-correlation-id'), correlationId);
  const viaje = await crear.json();
  assert.equal(viaje.passengerId, pasajeroId);
  assert.equal(viaje.status, 'REQUESTED');
  assert.equal(viaje.origin.latitude, ubicaciones.origin.latitude);

  const reintento = await fetch(`${baseUrl}/api/v1/viajes`, {
    method: 'POST',
    headers: { ...headers(), 'idempotency-key': claveIdempotencia },
    body: JSON.stringify(ubicaciones)
  });
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
  assert.equal((await cancelar.json()).status, 'CANCELLED');
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

  const crear = await fetch(`${baseUrl}/api/v1/viajes`, {
    method: 'POST',
    headers: { ...headers(), 'idempotency-key': claveIdempotencia },
    body: JSON.stringify(ubicaciones)
  });
  const viaje = await crear.json();
  const noAutorizado = await fetch(`${baseUrl}/api/v1/viajes/${viaje.id}`, {
    headers: headers(crearToken(otroUsuarioId))
  });
  assert.equal(noAutorizado.status, 403);
  assert.equal((await noAutorizado.json()).code, 'FORBIDDEN');
});

test('HTTP permite cancelar a un operador solo con el permiso del contrato', async (t) => {
  const baseUrl = await iniciarApp(t);
  const crear = await fetch(`${baseUrl}/api/v1/viajes`, {
    method: 'POST',
    headers: { ...headers(), 'idempotency-key': claveIdempotencia },
    body: JSON.stringify(ubicaciones)
  });
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
  assert.equal((await cancelar.json()).status, 'CANCELLED');
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
