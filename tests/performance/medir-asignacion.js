const crypto = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const { crearModuloViajes } = require('../../servicios/viajes/src/composicion');
const { crearServidor } = require('../../servicios/viajes/src/servidor');
const { BloqueadorMemoria } = require('../../servicios/viajes/src/infra/memoria/bloqueador-memoria');
const { PublicadorEventosSimulado } = require('../../servicios/viajes/src/infra/mensajeria/publicador-eventos-simulado');

function codificar(valor) {
  return Buffer.from(JSON.stringify(valor)).toString('base64url');
}

function crearToken(conductorId, secret) {
  const header = codificar({ alg: 'HS256', typ: 'JWT' });
  const payload = codificar({
    sub: conductorId,
    roles: ['conductor'],
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  const firma = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${firma}`;
}

function percentil(valores, p) {
  return valores[Math.ceil((p / 100) * valores.length) - 1];
}

async function main() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('Configurar TEST_DATABASE_URL con una base PostgreSQL dedicada');
  }
  const cantidad = Number(process.env.BENCH_ITERATIONS || 100);
  if (!Number.isInteger(cantidad) || cantidad < 20 || cantidad > 2000) {
    throw new Error('BENCH_ITERATIONS debe ser un entero entre 20 y 2000');
  }

  const pool = new Pool({ connectionString });
  const secret = crypto.randomBytes(32).toString('hex');
  const correlationId = crypto.randomUUID();
  const viajes = Array.from({ length: cantidad }, () => ({
    tripId: crypto.randomUUID(),
    conductorId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID()
  }));
  const modulo = crearModuloViajes({
    pool,
    publicador: new PublicadorEventosSimulado(),
    bloqueador: new BloqueadorMemoria(),
    consumidor: {
      iniciar: async () => {},
      verificar: async () => {},
      cerrar: async () => {}
    }
  });
  const app = crearServidor({
    modulo,
    secret,
    verificadorPostgres: { verificar: async () => pool.query('SELECT 1') }
  });
  let servidor;

  try {
    await modulo.iniciar();
    servidor = app.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const url = `http://127.0.0.1:${servidor.address().port}`;
    await pool.query(
      `INSERT INTO viajes
        (id, pasajero_id, origen, destino, estado, creado_en, actualizado_en)
       SELECT input.id::uuid, gen_random_uuid(),
              '{"latitud":-34,"longitud":-58,"direccion":"Origen"}'::jsonb,
              '{"latitud":-35,"longitud":-59,"direccion":"Destino"}'::jsonb,
              'REQUESTED', NOW(), NOW()
         FROM unnest($1::text[]) AS input(id)`,
      [viajes.map(({ tripId }) => tripId)]
    );

    await Promise.all(
      Array.from({ length: pool.options.max }, () => pool.query('SELECT 1'))
    );
    const inicio = process.hrtime.bigint();
    const latencias = await Promise.all(viajes.map(async (viaje) => {
      const inicioRequest = process.hrtime.bigint();
      const respuesta = await fetch(`${url}/api/v1/viajes/${viaje.tripId}/asignacion`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${crearToken(viaje.conductorId, secret)}`,
          'content-type': 'application/json',
          'x-correlation-id': correlationId,
          'idempotency-key': viaje.idempotencyKey
        }
      });
      if (respuesta.status !== 200) {
        throw new Error(`Asignación ${viaje.tripId} devolvió HTTP ${respuesta.status}`);
      }
      const resultado = await respuesta.json();
      if (resultado.driverId !== viaje.conductorId || resultado.status !== 'ASSIGNED') {
        throw new Error(`Respuesta incorrecta para el viaje ${viaje.tripId}`);
      }
      return Number(process.hrtime.bigint() - inicioRequest) / 1e6;
    }));
    const duracionTotalMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    latencias.sort((a, b) => a - b);
    console.log(JSON.stringify({
      scenario: 'concurrent-http-trip-assignment',
      iterations: cantidad,
      completed: latencias.length,
      durationMs: Number(duracionTotalMs.toFixed(2)),
      throughputPerSecond: Number((cantidad / (duracionTotalMs / 1000)).toFixed(2)),
      latencyMs: {
        min: Number(latencias[0].toFixed(2)),
        median: Number(percentil(latencias, 50).toFixed(2)),
        p95: Number(percentil(latencias, 95).toFixed(2)),
        max: Number(latencias.at(-1).toFixed(2))
      },
      correlationId
    }, null, 2));
  } finally {
    if (servidor) {
      await new Promise((resolve, reject) => {
        servidor.close((error) => error ? reject(error) : resolve());
      });
    }
    try {
      await modulo.despachadorOutbox?.cerrar();
      await pool.query('DELETE FROM idempotencia WHERE clave = ANY($1::varchar[])',
        [viajes.map(({ conductorId, idempotencyKey }) => `${conductorId}:${idempotencyKey}`)]);
      await pool.query('DELETE FROM eventos_outbox WHERE correlation_id = $1', [correlationId]);
      await pool.query('DELETE FROM historial_estados_viaje WHERE viaje_id = ANY($1::uuid[])',
        [viajes.map(({ tripId }) => tripId)]);
      await pool.query('DELETE FROM viajes WHERE id = ANY($1::uuid[])',
        [viajes.map(({ tripId }) => tripId)]);
    } finally {
      await modulo.cerrar();
    }
  }
}

main().catch((error) => {
  console.error('Falló la medición de asignaciones', error.message);
  process.exitCode = 1;
});
