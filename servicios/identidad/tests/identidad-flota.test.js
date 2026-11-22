const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { ServicioIdentidad } = require('../src/servicio-identidad');
const { RepositorioIdentidadPostgres } = require('../src/repositorio-identidad');
const { ServicioFlota } = require('../../conductores/src/servicio-flota');
const { RepositorioFlotaPostgres } = require('../../conductores/src/repositorio-flota');
const { aplicarMigraciones } = require('../../viajes/src/infra/db/aplicar-migraciones');
const {
  ErrorDeValidacion,
  ConflictoDeEstado,
  OperacionNoPermitida,
  RecursoNoEncontrado
} = require('../../viajes/src/dominio/errores/errores');

const secret = 'clave-de-prueba-de-al-menos-32-caracteres';

test('registro e inicio de sesión cumplen roles y contraseñas', async () => {
  const identidad = new ServicioIdentidad({ secret });
  const chofer = await identidad.registrar({
    name: 'Conductor Uno',
    email: 'chofer@appurbe.test',
    password: 'secreto123',
    role: 'chofer'
  });
  assert.equal(chofer.user.role, 'chofer');
  assert.ok(chofer.accessToken);
  assert.deepEqual(
    (await identidad.login({ email: 'chofer@appurbe.test', password: 'secreto123' })).user,
    chofer.user
  );
  await assert.rejects(
    () => identidad.login({ email: 'chofer@appurbe.test', password: 'incorrecta' }),
    (error) => error.estado === 401
  );
  await assert.rejects(
    () => identidad.registrar({ name: 'Corto', email: 'x', password: '123' }),
    ErrorDeValidacion
  );
});

test('chofer necesita perfil, vehículo y habilitación antes de disponibilidad', async () => {
  const identidad = new ServicioIdentidad({ secret });
  const chofer = await identidad.registrar({
    name: 'Conductor Uno',
    email: 'chofer2@appurbe.test',
    password: 'secreto123',
    role: 'chofer'
  });
  const flota = new ServicioFlota();
  const actorChofer = {
    identificador: chofer.user.id,
    roles: ['chofer'],
    permisos: chofer.user.permissions
  };

  await assert.rejects(
    () => flota.cambiarDisponibilidad({ actor: actorChofer, conductorId: chofer.user.id, disponible: true }),
    (error) => error instanceof RecursoNoEncontrado || error instanceof ConflictoDeEstado
  );

  await flota.crearPerfil({
    actor: actorChofer,
    licenseNumber: 'LIC-123',
    licenseExpiresAt: '2030-01-01'
  });
  await flota.registrarVehiculo({
    actor: actorChofer,
    plate: 'AB123CD',
    brand: 'Toyota',
    model: 'Corolla',
    year: 2024,
    capacity: 4
  });

  await assert.rejects(
    () => flota.cambiarDisponibilidad({ actor: actorChofer, conductorId: chofer.user.id, disponible: true }),
    /no está habilitado/
  );

  const administrador = await identidad.registrar({
    name: 'Admin',
    email: 'admin@appurbe.test',
    password: 'secreto123',
    role: 'administrador'
  });
  const perfil = await flota.habilitar({
    actor: { identificador: administrador.user.id, roles: ['administrador'] },
    conductorId: chofer.user.id,
    habilitado: true
  });
  assert.equal(perfil.habilitado, true);

  await flota.cambiarDisponibilidad({
    actor: actorChofer,
    conductorId: chofer.user.id,
    disponible: true
  });
  const ubicacion = await flota.actualizarUbicacion({
    actor: actorChofer,
    conductorId: chofer.user.id,
    latitude: -34.6037,
    longitude: -58.3816
  });
  assert.equal(ubicacion.latitude, -34.6037);
  await assert.rejects(
    () => flota.listarDisponibles({ actor: actorChofer }),
    OperacionNoPermitida
  );
  assert.equal((await flota.listarDisponibles({
    actor: { identificador: administrador.user.id, roles: ['administrador'] }
  })).length, 1);
});

test('roles no autorizados no pueden habilitar ni cambiar otro perfil', async () => {
  const flota = new ServicioFlota();
  const actorChofer = {
    identificador: '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
    roles: ['chofer']
  };
  await assert.rejects(
    () => flota.habilitar({
      actor: actorChofer,
      conductorId: '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
      habilitado: true
    }),
    OperacionNoPermitida
  );
  await assert.rejects(
    () => flota.cambiarDisponibilidad({
      actor: actorChofer,
      conductorId: '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765',
      disponible: true
    }),
    OperacionNoPermitida
  );
});

test('identidad y flota persisten en PostgreSQL entre instancias', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let driverId;
  let adminId;
  try {
    await aplicarMigraciones(pool);
    const identidad = new ServicioIdentidad({
      secret,
      repositorio: new RepositorioIdentidadPostgres({ pool })
    });
    const flota = new ServicioFlota({
      repositorio: new RepositorioFlotaPostgres({ pool })
    });
    const driver = await identidad.registrar({
      name: 'Conductor Persistente',
      email: `driver-${crypto.randomUUID()}@appurbe.test`,
      password: 'secreto123',
      role: 'chofer'
    });
    driverId = driver.user.id;
    const admin = await identidad.registrar({
      name: 'Admin Persistente',
      email: `admin-${crypto.randomUUID()}@appurbe.test`,
      password: 'secreto123',
      role: 'administrador'
    });
    adminId = admin.user.id;

    const actorChofer = {
      identificador: driverId,
      roles: ['chofer']
    };
    await flota.crearPerfil({
      actor: actorChofer,
      licenseNumber: `LIC-${crypto.randomUUID()}`,
      licenseExpiresAt: '2035-01-01'
    });
    await flota.registrarVehiculo({
      actor: actorChofer,
      plate: `TEST${crypto.randomUUID().slice(0, 8)}`,
      brand: 'Toyota',
      model: 'Corolla',
      year: 2024,
      capacity: 4
    });
    await flota.habilitar({
      actor: { identificador: adminId, roles: ['administrador'] },
      conductorId: driverId,
      habilitado: true
    });
    await flota.cambiarDisponibilidad({
      actor: actorChofer,
      conductorId: driverId,
      disponible: true
    });
    await flota.actualizarUbicacion({
      actor: actorChofer,
      conductorId: driverId,
      latitude: -34.6037,
      longitude: -58.3816,
      accuracyMeters: 8
    });

    const identidadTrasReinicio = new ServicioIdentidad({
      secret,
      repositorio: new RepositorioIdentidadPostgres({ pool })
    });
    const flotaTrasReinicio = new ServicioFlota({
      repositorio: new RepositorioFlotaPostgres({ pool })
    });
    const sesion = await identidadTrasReinicio.login({
      email: driver.user.email,
      password: 'secreto123'
    });
    assert.equal(sesion.user.id, driverId);
    assert.deepEqual(await flotaTrasReinicio.validarHabilitacion(driverId, {
      identificador: adminId,
      roles: ['administrador']
    }), {
      driverId,
      enabled: true,
      available: true,
      vehicleRegistered: true
    });
    const disponibles = await flotaTrasReinicio.listarDisponibles({
      actor: { identificador: adminId, roles: ['administrador'] }
    });
    const persistido = disponibles.find((conductor) => conductor.id === driverId);
    assert.equal(persistido.location.latitude, -34.6037);
    assert.equal(persistido.vehicle.brand, 'Toyota');
  } finally {
    if (driverId) {
      await pool.query('DELETE FROM ubicaciones WHERE conductor_id = $1', [driverId]);
      await pool.query('DELETE FROM vehiculos WHERE conductor_id = $1', [driverId]);
      await pool.query('DELETE FROM conductores WHERE id = $1', [driverId]);
    }
    if (driverId || adminId) {
      await pool.query('DELETE FROM usuarios WHERE id = ANY($1::uuid[])', [
        [driverId, adminId].filter(Boolean)
      ]);
    }
    await pool.end();
  }
});

test('el servidor usa PostgreSQL para registrar y autenticar usuarios', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const { Pool } = require('pg');
  const { crearServidor } = require('../../viajes/src/servidor');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let userId;
  const app = crearServidor({
    modulo: { pool },
    secret,
    verificadorPostgres: { verificar: async () => {} }
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const correlationId = crypto.randomUUID();
  const email = `http-${crypto.randomUUID()}@appurbe.test`;

  try {
    const registro = await fetch(`${baseUrl}/api/v1/identidad/registro`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': correlationId
      },
      body: JSON.stringify({
        name: 'Usuario HTTP Persistente',
        email,
        password: 'secreto123',
        role: 'pasajero'
      })
    });
    assert.equal(registro.status, 201);
    const sesion = await registro.json();
    userId = sesion.user.id;

    const login = await fetch(`${baseUrl}/api/v1/identidad/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': correlationId
      },
      body: JSON.stringify({ email, password: 'secreto123' })
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.id, userId);

    const consulta = await pool.query('SELECT id FROM usuarios WHERE id = $1', [userId]);
    assert.equal(consulta.rowCount, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (userId) await pool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
    await pool.end();
  }
});

test('HTTP completa el alta segura de administrador y el ciclo de flota', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const { Pool } = require('pg');
  const { crearServidor } = require('../../viajes/src/servidor');
  const esquema = `test_identidad_${crypto.randomUUID().replace(/-/g, '')}`;
  const poolAdministrativo = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let pool;
  let server;
  try {
    await poolAdministrativo.query(`CREATE SCHEMA ${esquema}`);
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${esquema}`
    });
    await aplicarMigraciones(pool);

    const bootstrapToken = crypto.randomBytes(32).toString('hex');
    const app = crearServidor({
      modulo: { pool },
      secret,
      identityBootstrapToken: bootstrapToken,
      verificadorPostgres: { verificar: async () => {} }
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const correlationId = crypto.randomUUID();
    const jsonHeaders = {
      'content-type': 'application/json',
      'x-correlation-id': correlationId
    };
    const request = (path, { method = 'GET', token, bootstrap, body } = {}) => fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...jsonHeaders,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(bootstrap ? { 'x-bootstrap-token': bootstrap } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    const badBootstrap = await request('/api/v1/identidad/bootstrap/administrador', {
      method: 'POST',
      bootstrap: 'token-incorrecto',
      body: { name: 'Admin', email: 'admin@test.local', password: 'secreto123' }
    });
    assert.equal(badBootstrap.status, 401);

    const bootstraps = await Promise.all([
      request('/api/v1/identidad/bootstrap/administrador', {
        method: 'POST',
        bootstrap: bootstrapToken,
        body: {
          name: 'Administrador inicial',
          email: 'admin@test.local',
          password: 'secreto123'
        }
      }),
      request('/api/v1/identidad/bootstrap/administrador', {
        method: 'POST',
        bootstrap: bootstrapToken,
        body: {
          name: 'Administrador concurrente',
          email: 'admin2@test.local',
          password: 'secreto123'
        }
      })
    ]);
    assert.deepEqual(bootstraps.map((response) => response.status).sort(), [201, 409]);
    const bootstrap = bootstraps.find((response) => response.status === 201);
    const adminSession = await bootstrap.json();
    assert.equal(adminSession.user.role, 'administrador');

    const registroChofer = await request('/api/v1/identidad/registro', {
      method: 'POST',
      body: {
        name: 'Chofer de integración',
        email: 'chofer@test.local',
        password: 'secreto123',
        role: 'chofer'
      }
    });
    assert.equal(registroChofer.status, 201);
    const driverSession = await registroChofer.json();
    const driverId = driverSession.user.id;

    const perfil = await request('/api/v1/conductores/perfil', {
      method: 'POST',
      token: driverSession.accessToken,
      body: {
        licenseNumber: 'LIC-HTTP-1',
        licenseExpiresAt: '2035-01-01'
      }
    });
    assert.equal(perfil.status, 201);

    const vehiculo = await request('/api/v1/conductores/vehiculos', {
      method: 'POST',
      token: driverSession.accessToken,
      body: {
        plate: 'HTTP123',
        brand: 'Toyota',
        model: 'Corolla',
        year: 2024,
        capacity: 4
      }
    });
    assert.equal(vehiculo.status, 201);

    const habilitar = await request(`/api/v1/conductores/${driverId}/habilitacion`, {
      method: 'PATCH',
      token: adminSession.accessToken,
      body: { enabled: true }
    });
    assert.equal(habilitar.status, 200);
    assert.equal((await habilitar.json()).habilitado, true);

    const disponibilidad = await request(`/api/v1/conductores/${driverId}/disponibilidad`, {
      method: 'PATCH',
      token: driverSession.accessToken,
      body: { available: true }
    });
    assert.equal(disponibilidad.status, 200);

    const ubicacion = await request(`/api/v1/conductores/${driverId}/ubicacion`, {
      method: 'POST',
      token: driverSession.accessToken,
      body: { latitude: -34.6037, longitude: -58.3816, accuracyMeters: 10 }
    });
    assert.equal(ubicacion.status, 200);

    const listadoProhibido = await request('/api/v1/conductores/disponibles', {
      token: driverSession.accessToken
    });
    assert.equal(listadoProhibido.status, 403);

    const disponibles = await request('/api/v1/conductores/disponibles', {
      token: adminSession.accessToken
    });
    assert.equal(disponibles.status, 200);
    const candidato = (await disponibles.json()).find((conductor) => conductor.id === driverId);
    assert.equal(candidato.location.latitude, -34.6037);
    assert.equal(candidato.vehicle.plate, 'HTTP123');
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    if (pool) await pool.end();
    await poolAdministrativo.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await poolAdministrativo.end();
  }
});
