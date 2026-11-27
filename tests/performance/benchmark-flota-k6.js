const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');

const ROOT = path.resolve(__dirname, '../..');
const ARCHIVO_K6 = 'tests/performance/k6/escenario-flota.js';
const IMAGEN_K6 = process.env.K6_IMAGE || 'grafana/k6:0.54.0';

function ejecutarComando(comando, argumentos) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, argumentos, {
      cwd: ROOT,
      windowsHide: true
    });
    let salida = '';
    const guardar = (trozo, destino) => {
      const texto = trozo.toString();
      salida += texto;
      if (salida.length > 200000) salida = salida.slice(-200000);
      destino.write(texto);
    };
    proceso.stdout.on('data', (trozo) => guardar(trozo, process.stdout));
    proceso.stderr.on('data', (trozo) => guardar(trozo, process.stderr));
    proceso.once('error', reject);
    proceso.once('close', (codigo) => {
      if (codigo === 0) resolve(salida);
      else reject(new Error(`${comando} terminó con código ${codigo}:\n${salida.slice(-5000)}`));
    });
  });
}

async function ejecutarK6({
  repoRoot,
  directorioTemporal,
  rutaFixtures,
  rutaResumen,
  baseUrl,
  runId,
  passengerIndex,
  config
}) {
  const argumentos = [
    'run', '--rm',
    '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${repoRoot}:/workspace:ro`,
    '-v', `${directorioTemporal}:/bench:rw`,
    '-w', '/workspace',
    '-e', `BENCH_BASE_URL=${baseUrl}`,
    '-e', `BENCH_FIXTURE_PATH=${rutaFixtures}`,
    '-e', `BENCH_DRIVER_COUNT=${config.cantidadChoferes}`,
    '-e', `BENCH_DURATION_SECONDS=${config.duracionSegundos}`,
    '-e', `BENCH_RUN_ID=${runId}`,
    '-e', `BENCH_PASSENGER_INDEX=${passengerIndex}`,
    '-e', `BENCH_STRATEGY=${config.estrategia}`,
    IMAGEN_K6,
    'run',
    `--summary-export=${rutaResumen}`,
    ARCHIVO_K6
  ];
  const salida = await ejecutarComando('docker', argumentos);
  const resumen = JSON.parse(await fs.readFile(
    path.join(directorioTemporal, path.basename(rutaResumen)),
    'utf8'
  ));
  return { resumen, salida };
}

function percentiles(metrica) {
  const valores = metrica?.values || metrica || {};
  return {
    p50: valores['p(50)'] ?? valores.med ?? null,
    p95: valores['p(95)'] ?? null,
    p99: valores['p(99)'] ?? null
  };
}

function valorMetrica(metrica, nombre, predeterminado = null) {
  return metrica?.values?.[nombre] ?? metrica?.[nombre] ?? predeterminado;
}

function extraerResultadosK6(resumen) {
  const metricas = resumen.metrics || {};
  const totalRequests = valorMetrica(metricas.http_reqs, 'count', 0);
  const totalHttpFailures = valorMetrica(metricas.benchmark_http_failures, 'count', 0);
  const totalTrips = valorMetrica(metricas.trip_requests, 'count', 0);
  const viajesExitosos = valorMetrica(metricas.successful_journeys, 'count', 0);
  return {
    requestLatencyMs: percentiles(metricas.trip_request_latency_ms),
    healthLatencyMs: percentiles(metricas.health_endpoint_latency_ms),
    locationLatencyMs: percentiles(metricas.driver_location_latency_ms),
    candidateSearchLatencyMs: percentiles(metricas.candidate_search_latency_ms),
    assignmentLatencyMs: percentiles(metricas.trip_assignment_latency_ms),
    timeToAssignmentMs: percentiles(metricas.time_to_assignment_ms),
    totalRequestsPerSecond: valorMetrica(metricas.http_reqs, 'rate'),
    httpFailures: totalHttpFailures,
    httpFailureRate: totalRequests > 0 ? totalHttpFailures / totalRequests : null,
    locationRequests: valorMetrica(metricas.driver_location_requests, 'count', 0),
    locationFailures: valorMetrica(metricas.driver_location_failures, 'count', 0),
    tripRequests: totalTrips,
    tripRequestFailures: valorMetrica(metricas.trip_request_failures, 'count', 0),
    assignmentRequests: valorMetrica(metricas.trip_assignment_requests, 'count', 0),
    assignmentFailures: valorMetrica(metricas.trip_assignment_failures, 'count', 0),
    successfulJourneyRate: totalTrips > 0 ? viajesExitosos / totalTrips : null
  };
}

module.exports = {
  ejecutarComando,
  ejecutarK6,
  extraerResultadosK6,
  IMAGEN_K6
};
