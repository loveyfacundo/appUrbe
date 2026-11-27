const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { Pool } = require('pg');
const { crearTokenParaTest } = require('../../servicios/viajes/tests/test-jwt');
const {
  ejecutarComando,
  ejecutarK6,
  extraerResultadosK6,
  IMAGEN_K6
} = require('./benchmark-flota-k6');

const ROOT = path.resolve(__dirname, '../..');
const ARCHIVO_SERVIDOR = path.join(__dirname, 'servidor-benchmark-flota.js');

function enteroPositivo(nombre, predeterminado, minimo = 1) {
  const valor = Number(process.env[nombre] || predeterminado);
  if (!Number.isSafeInteger(valor) || valor < minimo) {
    throw new Error(`${nombre} debe ser un entero mayor o igual a ${minimo}`);
  }
  return valor;
}

function leerConfiguracion() {
  const cantidadChoferes = enteroPositivo('BENCH_DRIVER_COUNT', 500, 500);
  const duracionSegundos = enteroPositivo('BENCH_DURATION_SECONDS', 180);
  const repeticiones = enteroPositivo('BENCH_REPEATS', 3);
  return { cantidadChoferes, duracionSegundos, repeticiones };
}

function crearCanalProceso(proceso) {
  function esperar(tipoEsperado, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const finalizar = (fn, valor) => {
        clearTimeout(temporizador);
        proceso.off('message', alRecibir);
        proceso.off('error', alFallar);
        proceso.off('exit', alSalir);
        fn(valor);
      };
      const alRecibir = (mensaje) => {
        if (mensaje.type === 'error') {
          finalizar(reject, new Error(mensaje.stack || mensaje.message));
        } else if (mensaje.type === tipoEsperado) {
          finalizar(resolve, mensaje);
        }
      };
      const alFallar = (error) => finalizar(reject, error);
      const alSalir = (codigo) => finalizar(
        reject,
        new Error(`El servidor de benchmark terminó antes de responder (${codigo})`)
      );
      const temporizador = setTimeout(() => {
        finalizar(reject, new Error(`Tiempo agotado esperando ${tipoEsperado}`));
      }, timeoutMs);

      proceso.on('message', alRecibir);
      proceso.once('error', alFallar);
      proceso.once('exit', alSalir);
    });
  }

  return {
    esperar,
    enviar: (mensaje) => proceso.send(mensaje),
    esperarSalida: () => new Promise((resolve, reject) => {
      proceso.once('error', reject);
      proceso.once('exit', (codigo) => {
        if (codigo === 0) resolve();
        else reject(new Error(`El servidor de benchmark terminó con código ${codigo}`));
      });
    })
  };
}

async function iniciarServidor({ connectionString, schema, estrategia, secret, tokenBootstrap }) {
  const proceso = fork(ARCHIVO_SERVIDOR, [], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: {
      ...process.env,
      TEST_DATABASE_URL: connectionString,
      BENCH_SCHEMA: schema,
      BENCH_STRATEGY: estrategia,
      BENCH_JWT_SECRET: secret,
      BENCH_BOOTSTRAP_TOKEN: tokenBootstrap,
      REDIS_URL: '',
      RABBITMQ_URL: ''
    }
  });
  const canal = crearCanalProceso(proceso);
  let listo;
  try {
    listo = await canal.esperar('ready', 60000);
  } catch (error) {
    if (proceso.connected) proceso.disconnect();
    if (proceso.exitCode === null) proceso.kill();
    throw error;
  }

  return {
    url: `http://127.0.0.1:${listo.port}`,
    resetMetricas: async () => {
      const respuesta = canal.esperar('metrics-reset');
      canal.enviar({ type: 'reset-metrics' });
      await respuesta;
    },
    leerMetricas: async () => {
      const respuesta = canal.esperar('metrics');
      canal.enviar({ type: 'read-metrics' });
      return (await respuesta).data;
    },
    cerrar: async () => {
      const detenido = canal.esperar('stopped');
      const salida = canal.esperarSalida();
      canal.enviar({ type: 'stop' });
      await detenido;
      if (proceso.connected) proceso.disconnect();
      await salida;
    }
  };
}

async function solicitarApi(baseUrl, ruta, {
  metodo = 'GET',
  token,
  bootstrapToken,
  cuerpo
} = {}) {
  const headers = { 'x-correlation-id': crypto.randomUUID() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (bootstrapToken) headers['x-bootstrap-token'] = bootstrapToken;
  if (cuerpo !== undefined) headers['content-type'] = 'application/json';
  const respuesta = await fetch(`${baseUrl}${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const texto = await respuesta.text();
  let resultado;
  try {
    resultado = texto ? JSON.parse(texto) : null;
  } catch {
    resultado = texto;
  }
  if (!respuesta.ok) {
    throw new Error(`HTTP ${respuesta.status} ${ruta}: ${texto.slice(0, 300)}`);
  }
  return resultado;
}

async function enLotes(elementos, tamanoLote, ejecutar) {
  const resultados = [];
  for (let inicio = 0; inicio < elementos.length; inicio += tamanoLote) {
    const lote = elementos.slice(inicio, inicio + tamanoLote);
    resultados.push(...await Promise.all(lote.map(ejecutar)));
  }
  return resultados;
}

function ubicacionDeChofer(indice) {
  const columnas = 25;
  return {
    latitude: Number((-34.7 + Math.floor(indice / columnas) * 0.01).toFixed(6)),
    longitude: Number((-58.5 + (indice % columnas) * 0.01).toFixed(6))
  };
}

async function crearActores({ url, tokenBootstrap, secret, cantidadChoferes, expiraEn }) {
  const administrador = await solicitarApi(url, '/api/v1/identidad/bootstrap/administrador', {
    metodo: 'POST',
    bootstrapToken: tokenBootstrap,
    cuerpo: {
      name: 'Administrador benchmark flota',
      email: `admin-${crypto.randomUUID()}@appurbe.test`,
      password: 'benchmark-password-2026'
    }
  });
  const adminToken = crearTokenParaTest(administrador.user.id, {
    roles: ['administrador'],
    exp: expiraEn
  }, secret);

  const indices = Array.from({ length: cantidadChoferes }, (_, indice) => indice);
  const choferes = await enLotes(indices, 20, async (indice) => {
    const sufijo = `${Date.now()}-${indice}-${crypto.randomUUID().slice(0, 8)}`;
    const sesion = await solicitarApi(url, '/api/v1/identidad/registro', {
      metodo: 'POST',
      cuerpo: {
        name: `Chofer benchmark ${indice}`,
        email: `driver-${sufijo}@appurbe.test`,
        password: 'benchmark-password-2026',
        role: 'chofer'
      }
    });
    const conductorId = sesion.user.id;
    const token = crearTokenParaTest(conductorId, {
      roles: ['chofer'],
      exp: expiraEn
    }, secret);
    const actor = { token };
    const vehiculo = `B${String(indice).padStart(4, '0')}${crypto.randomUUID().slice(0, 4)}`;

    await solicitarApi(url, '/api/v1/conductores/perfil', {
      metodo: 'POST',
      token: actor.token,
      cuerpo: {
        licenseNumber: `LIC-${sufijo}`,
        licenseExpiresAt: '2035-01-01'
      }
    });
    await solicitarApi(url, '/api/v1/conductores/vehiculos', {
      metodo: 'POST',
      token: actor.token,
      cuerpo: {
        plate: vehiculo,
        brand: 'Benchmark',
        model: 'Simulado',
        year: 2024,
        capacity: 4
      }
    });
    await solicitarApi(url, `/api/v1/conductores/${conductorId}/habilitacion`, {
      metodo: 'PATCH',
      token: adminToken,
      cuerpo: { enabled: true }
    });
    await solicitarApi(url, `/api/v1/conductores/${conductorId}/disponibilidad`, {
      metodo: 'PATCH',
      token: actor.token,
      cuerpo: { available: true }
    });
    return { id: conductorId, token, ...ubicacionDeChofer(indice) };
  });

  const pasajeros = Array.from({ length: 10 }, () => {
    const id = crypto.randomUUID();
    return {
      id,
      token: crearTokenParaTest(id, {
        roles: ['pasajero'],
        exp: expiraEn
      }, secret)
    };
  });
  return { admin: { id: administrador.user.id, token: adminToken }, drivers: choferes, passengers: pasajeros };
}

async function actualizarUbicacionesIniciales(url, actores) {
  await enLotes(actores.drivers, 40, async (driver) => {
    await solicitarApi(url, `/api/v1/conductores/${driver.id}/ubicacion`, {
      metodo: 'POST',
      token: driver.token,
      cuerpo: {
        latitude: driver.latitude,
        longitude: driver.longitude,
        accuracyMeters: 8
      }
    });
  });
}

async function limpiarDatosDePrueba(pool) {
  await pool.query('DELETE FROM historial_estados_viaje');
  await pool.query('DELETE FROM eventos_outbox');
  await pool.query('DELETE FROM idempotencia');
  await pool.query('DELETE FROM viajes');
}

function compararRepeticiones(resultados) {
  const repeticiones = [...new Set(resultados.map((resultado) => resultado.repetition))];
  return repeticiones.map((repeticion) => {
    const ingenua = resultados.find((resultado) =>
      resultado.repetition === repeticion && resultado.strategy === 'naive');
    const postgis = resultados.find((resultado) =>
      resultado.repetition === repeticion && resultado.strategy === 'postgis');
    const p95Ingenua = ingenua?.k6.timeToAssignmentMs.p95;
    const p95Postgis = postgis?.k6.timeToAssignmentMs.p95;
    const mejoraPorcentual = Number.isFinite(p95Ingenua) && p95Ingenua > 0 &&
      Number.isFinite(p95Postgis)
      ? Number((((p95Ingenua - p95Postgis) / p95Ingenua) * 100).toFixed(2))
      : null;
    return {
      repetition: repeticion,
      naiveAssignmentP95Ms: p95Ingenua,
      postgisAssignmentP95Ms: p95Postgis,
      postgisImprovementPercent: mejoraPorcentual,
      reasonableAssignmentTimeMet: Number.isFinite(p95Postgis) && p95Postgis <= 2000,
      expectedImprovementMet: mejoraPorcentual !== null && mejoraPorcentual >= 20
    };
  });
}

async function prepararBaseDeDatos(connectionString) {
  const pool = new Pool({ connectionString });
  const schema = `benchmark_${crypto.randomUUID().replace(/-/g, '')}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  return { pool, schema };
}

async function main() {
  const config = leerConfiguracion();
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('Define TEST_DATABASE_URL con una base PostgreSQL dedicada');
  }

  const { pool: poolAdministrativo, schema } = await prepararBaseDeDatos(connectionString);
  const poolDatos = new Pool({
    connectionString,
    options: `-c search_path=${schema},public`
  });
  const directorioTemporal = path.join(os.tmpdir(), `appurbe-benchmark-${crypto.randomUUID()}`);
  const fs = require('node:fs/promises');
  await fs.mkdir(directorioTemporal);
  const rutaFixtures = path.join(directorioTemporal, 'fixtures.json');
  const secretoJwt = crypto.randomBytes(32).toString('hex');
  const tokenBootstrap = crypto.randomBytes(32).toString('hex');
  const expiracionToken = Math.floor(Date.now() / 1000) +
    config.duracionSegundos * config.repeticiones * 2 + 7200;
  const resultados = [];
  let servidor;

  try {
    await ejecutarComando('docker', ['pull', IMAGEN_K6]);
    await poolAdministrativo.query('CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public');
    let versionDb;

    for (let repeticion = 1; repeticion <= config.repeticiones; repeticion += 1) {
      const estrategias = repeticion % 2 === 1 ? ['naive', 'postgis'] : ['postgis', 'naive'];
      for (let indiceEstrategia = 0; indiceEstrategia < estrategias.length; indiceEstrategia += 1) {
        const estrategia = estrategias[indiceEstrategia];
        console.log(
          `Iniciando repetición ${repeticion}/${config.repeticiones}: ${estrategia}, ` +
          `${config.cantidadChoferes} choferes, ${config.duracionSegundos}s`
        );
        const runId = crypto.randomUUID();
        servidor = await iniciarServidor({
          connectionString,
          schema,
          estrategia,
          secret: secretoJwt,
          tokenBootstrap
        });
        if (!versionDb) {
          versionDb = await poolDatos.query(
            `SELECT current_setting('server_version') AS postgres,
                    PostGIS_Full_Version() AS postgis`
          );
        }

        let actores;
        if (repeticion === 1 && indiceEstrategia === 0) {
          actores = await crearActores({
            url: servidor.url,
            tokenBootstrap,
            secret: secretoJwt,
            cantidadChoferes: config.cantidadChoferes,
            expiraEn: expiracionToken
          });
          await fs.writeFile(rutaFixtures, JSON.stringify(actores));
        } else {
          actores = JSON.parse(await fs.readFile(rutaFixtures, 'utf8'));
        }

        await actualizarUbicacionesIniciales(servidor.url, actores);
        await servidor.resetMetricas();
        const inicio = Date.now();
        const passengerIndex = (repeticion * 2 + indiceEstrategia) % actores.passengers.length;
        const salidaK6 = await ejecutarK6({
          repoRoot: ROOT,
          directorioTemporal,
          rutaFixtures: '/bench/fixtures.json',
          rutaResumen: '/bench/summary.json',
          baseUrl: `http://host.docker.internal:${new URL(servidor.url).port}`,
          runId,
          passengerIndex,
          config: { ...config, estrategia }
        });
        const duracionRealSegundos = (Date.now() - inicio) / 1000;
        const metricasServidor = await servidor.leerMetricas();
        const resultadosK6 = extraerResultadosK6(salidaK6.resumen);
        const resultado = {
          strategy: estrategia,
          repetition: repeticion,
          durationSeconds: Number(duracionRealSegundos.toFixed(2)),
          driverCount: config.cantidadChoferes,
          expectedLocationUpdatesPerSecond: config.cantidadChoferes / 2,
          observedLocationUpdatesPerSecond: Number(
            ((resultadosK6.locationRequests - resultadosK6.locationFailures) /
              config.duracionSegundos).toFixed(2)
          ),
          k6: resultadosK6,
          server: metricasServidor
        };
        resultados.push(resultado);
        console.log(`BENCHMARK_RESULT ${JSON.stringify(resultado)}`);

        await servidor.cerrar();
        servidor = null;
        await limpiarDatosDePrueba(poolDatos);
      }
    }

    const reporte = {
      hypothesis: {
        reasonableAssignmentP95Ms: 2000,
        optimizedAssignmentP95ImprovementPercent: 20,
        expectedLocationUpdatesPerSecond: config.cantidadChoferes / 2
      },
      environment: {
        node: process.version,
        k6Image: IMAGEN_K6,
        os: `${os.type()} ${os.release()} ${os.arch()}`,
        logicalCpuCount: os.cpus().length,
        memoryGiB: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
        postgres: versionDb.rows[0].postgres,
        postgis: versionDb.rows[0].postgis
      },
      config,
      results: resultados
    };
    reporte.comparisons = compararRepeticiones(resultados);
    console.log(JSON.stringify(reporte, null, 2));
  } finally {
    try {
      if (servidor) await servidor.cerrar();
    } finally {
      try {
        await poolDatos.end();
      } finally {
        try {
          await poolAdministrativo.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        } finally {
          await poolAdministrativo.end();
          await fs.rm(directorioTemporal, { recursive: true, force: true });
        }
      }
    }
  }
}

main().catch((error) => {
  console.error('Falló la medición del benchmark de flota', error);
  process.exitCode = 1;
});
